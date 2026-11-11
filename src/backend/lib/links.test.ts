import {afterEach, describe, expect, it, vi} from 'vitest';

import {CmsClient, CmsItem, CmsVersion} from './cms';
import {ApiError} from './http';
import {checkLink, getLinks, latestPerVariation, listVersionsOrExplain} from './links';
import {signShare} from './shareLink';

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

describe('listVersionsOrExplain', () => {
  const notFound = new ApiError(404, 'cms_not_found', 'List versions: HTTP 404 Unable to find content item');
  const cmsWith = (item: CmsItem | null) =>
    ({listVersions: () => Promise.reject(notFound), getItem: () => Promise.resolve(item)}) as unknown as CmsClient;

  it('says images cannot be shared', async () => {
    // GET /v1/content/{key} for an image on joshCMS: no language versions.
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
