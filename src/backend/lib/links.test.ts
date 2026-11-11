import {afterEach, describe, expect, it, vi} from 'vitest';

import {CmsClient, CmsItem, CmsVersion} from './cms';
import {ApiError} from './http';
import {checkLink, getLinks, latestPerVariation, listVersionsOrExplain} from './links';
import {signShare} from './shareLink';
import type {CmsApplication} from './siteUrl';

const SITE = {url: 'https://site.example', previewSecret: 'secret'};
const KEY = 'dcf0e497951c4517ac1a7d7ecff0b853';

// Shape of GET /v1/content/{key}/locales/en: newest first, base versions omit `variation`.
const VERSIONS: CmsVersion[] = [
  {key: KEY, version: '4160', locale: 'en', status: 'draft', variation: 'business'},
  {key: KEY, version: '4156', locale: 'en', status: 'published', displayName: 'Homepage'},
  {key: KEY, version: '4154', locale: 'en', status: 'published', variation: 'personal'},
  {key: KEY, version: '3198', locale: 'en', status: 'published', variation: 'business'},
  {key: KEY, version: '3100', locale: 'en', status: 'previous', displayName: 'Old name'},
];

function fakeCms(versions: CmsVersion[], extra: Partial<Record<'getVersion' | 'getItem', unknown>> = {}) {
  return {
    listVersions: () => Promise.resolve(versions),
    getVersion: () => Promise.resolve(extra.getVersion ?? null),
    getItem: () => Promise.resolve(extra.getItem ?? null),
    primaryLocale: () => Promise.resolve('en'),
  } as unknown as CmsClient;
}

describe('latestPerVariation', () => {
  it('keeps the newest version per variation, original first', () => {
    expect(latestPerVariation(VERSIONS).map((v) => [v.variation ?? 'original', v.version])).toEqual([
      ['original', '4156'],
      ['business', '4160'],
      ['personal', '4154'],
    ]);
  });
});

describe('getLinks', () => {
  it('signs the open version and the newest of each variation', async () => {
    const result = await getLinks(
      {cms: fakeCms(VERSIONS), site: SITE},
      {key: 'dcf0e497-951c-4517-ac1a-7d7ecff0b853', locale: 'en', version: '3198'},
    );
    expect(result.content).toEqual({key: KEY, locale: 'en', displayName: 'Homepage'});
    expect(result.current).toMatchObject({version: '3198', variation: 'business', status: 'published'});
    const sig = signShare({key: KEY, loc: 'en', ver: '3198'}, SITE.previewSecret);
    expect(result.current?.url).toBe(`https://site.example/preview/share?key=${KEY}&loc=en&ver=3198&sig=${sig}`);
    expect(result.latest.map((l) => l.version)).toEqual(['4156', '4160', '4154']);
  });

  it('falls back to the version endpoint for a version outside the listing', async () => {
    const older = {key: KEY, version: '1200', locale: 'en', status: 'previous', variation: 'personal'};
    const result = await getLinks(
      {cms: fakeCms(VERSIONS, {getVersion: older}), site: SITE},
      {key: KEY, locale: 'en', version: '1200'},
    );
    expect(result.current).toMatchObject({version: '1200', variation: 'personal'});
  });

  it('says so when the open version is gone', async () => {
    await expect(
      getLinks({cms: fakeCms(VERSIONS), site: SITE}, {key: KEY, locale: 'en', version: '999'}),
    ).rejects.toMatchObject({code: 'version_missing'});
  });

  it('refuses a version of another language or another item', async () => {
    const dutch = {key: KEY, version: '1200', locale: 'nl', status: 'published'};
    await expect(
      getLinks({cms: fakeCms(VERSIONS, {getVersion: dutch}), site: SITE}, {key: KEY, locale: 'en', version: '1200'}),
    ).rejects.toMatchObject({code: 'locale_mismatch'});
    const otherItem = {...dutch, key: '64c52fe72b1d48b98ced7122189e986b', locale: 'en'};
    await expect(
      getLinks({cms: fakeCms(VERSIONS, {getVersion: otherItem}), site: SITE}, {key: KEY, locale: 'en', version: '1200'}),
    ).rejects.toMatchObject({code: 'version_missing'});
  });

  it('accepts the same locale written differently', async () => {
    const older = {key: KEY, version: '1200', locale: 'en_US', status: 'previous'};
    const result = await getLinks(
      {cms: fakeCms(VERSIONS, {getVersion: older}), site: SITE},
      {key: KEY, locale: 'en-us', version: '1200'},
    );
    expect(result.current?.version).toBe('1200');
  });

  it('leaves the name empty rather than showing the content key', async () => {
    const unnamed = VERSIONS.map(({displayName: _displayName, ...v}) => v);
    const result = await getLinks({cms: fakeCms(unnamed), site: SITE}, {key: KEY, locale: 'en'});
    expect(result.content.displayName).toBe('');
    expect(result.current).toBeNull();
  });
});

describe('checkLink', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('opens the signed link of a listed version', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', {status: 200}));
    vi.stubGlobal('fetch', fetchMock);
    expect(await checkLink({cms: fakeCms(VERSIONS), site: SITE}, {key: KEY, locale: 'en'}, '4160')).toEqual({
      status: 200,
      ok: true,
    });
    const sig = signShare({key: KEY, loc: 'en', ver: '4160'}, SITE.previewSecret);
    expect(fetchMock.mock.calls[0][0]).toBe(`https://site.example/preview/share?key=${KEY}&loc=en&ver=4160&sig=${sig}`);
  });

  it('signs nothing for a version the item does not have', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      checkLink({cms: fakeCms(VERSIONS), site: SITE}, {key: KEY, locale: 'en'}, '999'),
    ).rejects.toMatchObject({code: 'version_missing'});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('says in plain words when the site does not answer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    await expect(
      checkLink({cms: fakeCms(VERSIONS), site: SITE}, {key: KEY, locale: 'en'}, '4156'),
    ).rejects.toMatchObject({code: 'site_unreachable', message: expect.not.stringMatching(/HTTP|\d{3}/)});
  });
});

describe('the site a link goes to', () => {
  // Shape of GET /v1/applications: two sites and a preview host.
  const APPS: CmsApplication[] = [
    {key: 'site_a', hosts: [{authority: 'www.example.com', type: 'primary', preferredUrlScheme: 'https'}]},
    {key: 'site_b', hosts: [{authority: 'shop.example.org', type: 'primary', preferredUrlScheme: 'https'}]},
    {key: 'preview', hosts: [{authority: 'preview.example.com', type: 'preview', preferredUrlScheme: 'https'}]},
  ];
  const NO_OVERRIDE = {url: '', previewSecret: 'secret'};
  // The application list is cached per API client, so each test gets its own.
  let client = 0;

  function cmsWithApps(apps: CmsApplication[] | Error) {
    const listApplications = vi.fn(() => (apps instanceof Error ? Promise.reject(apps) : Promise.resolve(apps)));
    const cms = Object.assign(fakeCms(VERSIONS), {clientId: `client-${++client}`, listApplications});
    return {cms: cms as unknown as CmsClient, listApplications};
  }

  const linkFor = (origin: string, ver: string) =>
    `${origin}/preview/share?key=${KEY}&loc=en&ver=${ver}&sig=${signShare({key: KEY, loc: 'en', ver}, 'secret')}`;

  afterEach(() => vi.unstubAllGlobals());

  it("signs links for the open page's own site when the CMS lists that host", async () => {
    const {cms} = cmsWithApps(APPS);
    const result = await getLinks(
      {cms, site: NO_OVERRIDE},
      {key: KEY, locale: 'en', version: '4156', publicUrl: 'https://shop.example.org/en/home/'},
    );
    expect(result.current?.url).toBe(linkFor('https://shop.example.org', '4156'));
    expect(result.latest.every((l) => l.url.startsWith('https://shop.example.org/preview/share?'))).toBe(true);
  });

  it('uses the admin override without asking the CMS', async () => {
    const {cms, listApplications} = cmsWithApps(APPS);
    const result = await getLinks(
      {cms, site: {url: 'https://override.example.net/site', previewSecret: 'secret'}},
      {key: KEY, locale: 'en', version: '4156', publicUrl: 'https://shop.example.org/en/'},
    );
    expect(result.current?.url).toBe(linkFor('https://override.example.net/site', '4156'));
    expect(listApplications).not.toHaveBeenCalled();
  });

  it('falls back to the only site when the page address is missing or unknown', async () => {
    const {cms} = cmsWithApps([APPS[0], APPS[2]]);
    for (const publicUrl of [undefined, 'https://elsewhere.example.net/x']) {
      const result = await getLinks({cms, site: NO_OVERRIDE}, {key: KEY, locale: 'en', version: '4156', publicUrl});
      expect(result.current?.url, publicUrl).toBe(linkFor('https://www.example.com', '4156'));
    }
  });

  it('refuses a page on a host the CMS does not list, and opens nothing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const {cms} = cmsWithApps(APPS);
    const ref = {key: KEY, locale: 'en', version: '4156', publicUrl: 'https://169.254.169.254/latest/meta-data'};
    await expect(getLinks({cms, site: NO_OVERRIDE}, ref)).rejects.toMatchObject({
      code: 'site_unknown',
      message: expect.stringMatching(/more than one site.*Site URL/),
    });
    await expect(checkLink({cms, site: NO_OVERRIDE}, ref, '4156')).rejects.toMatchObject({code: 'site_unknown'});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('checks the link on the site it was signed for', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', {status: 200}));
    vi.stubGlobal('fetch', fetchMock);
    const {cms} = cmsWithApps(APPS);
    const ref = {key: KEY, locale: 'en', publicUrl: 'https://www.example.com/en/'};
    expect(await checkLink({cms, site: NO_OVERRIDE}, ref, '4160')).toEqual({status: 200, ok: true});
    expect(fetchMock.mock.calls[0][0]).toBe(linkFor('https://www.example.com', '4160'));
  });

  it('refuses an application host that is an IP address or an internal name', async () => {
    for (const authority of ['10.0.0.5', 'cms.corp.internal']) {
      const {cms} = cmsWithApps([{hosts: [{authority, type: 'primary', preferredUrlScheme: 'https'}]}]);
      await expect(getLinks({cms, site: NO_OVERRIDE}, {key: KEY, locale: 'en'}), authority).rejects.toMatchObject({
        code: 'site_unknown',
        message: expect.stringContaining("isn't a public one"),
      });
    }
  });

  it('asks for the Site URL when the CMS has no site or the API client may not read them', async () => {
    await expect(getLinks({cms: cmsWithApps([]).cms, site: NO_OVERRIDE}, {key: KEY, locale: 'en'})).rejects.toMatchObject({
      code: 'site_unknown',
      message: expect.stringContaining('has no https address'),
    });
    const forbidden = new ApiError(403, 'cms_unauthorized', 'List applications: HTTP 403');
    await expect(
      getLinks({cms: cmsWithApps(forbidden).cms, site: NO_OVERRIDE}, {key: KEY, locale: 'en'}),
    ).rejects.toMatchObject({code: 'site_unknown', message: expect.stringContaining("can't read the site addresses")});
  });
});

describe('listVersionsOrExplain', () => {
  const notFound = new ApiError(404, 'cms_not_found', 'List versions: HTTP 404 Unable to find content item');
  const cmsWith = (item: CmsItem | null) =>
    ({listVersions: () => Promise.reject(notFound), getItem: () => Promise.resolve(item)}) as unknown as CmsClient;

  it('says images cannot be shared', async () => {
    // GET /v1/content/{key} for an image on a SaaS CMS instance: no language versions.
    const image = {key: '64c52fe72b1d48b98ced7122189e986b', contentType: 'ImageMedia', locales: ['']};
    await expect(listVersionsOrExplain(cmsWith(image), image.key, 'en')).rejects.toMatchObject({
      code: 'unsupported_content',
      message: expect.stringContaining('ImageMedia'),
    });
  });

  it('says a deleted item has nothing to share', async () => {
    await expect(listVersionsOrExplain(cmsWith(null), KEY, 'en')).rejects.toMatchObject({code: 'content_missing'});
  });

  it('names the locales a page does exist in', async () => {
    await expect(
      listVersionsOrExplain(cmsWith({key: 'k', contentType: 'ArticlePage', locales: ['nl', 'sv']}), 'k', 'en'),
    ).rejects.toMatchObject({code: 'locale_missing', message: expect.stringContaining('nl, sv')});
  });
});
