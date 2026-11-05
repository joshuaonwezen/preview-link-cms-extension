import {logger, resetLocalSettingsStore, storage} from '@zaiusinc/app-sdk';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {CmsClient, CmsItem, CmsVersion} from './cms';
import {ApiError} from './http';
import {getLinks, latestPerVariation, listVersionsOrExplain} from './links';
import {loadConfig, normalizeSiteUrl} from './settings';
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

  it('names the locales a page does exist in', async () => {
    await expect(
      listVersionsOrExplain(cmsWith({key: 'k', contentType: 'ArticlePage', locales: ['nl', 'sv']}), 'k', 'en'),
    ).rejects.toMatchObject({code: 'locale_missing', message: expect.stringContaining('nl, sv')});
  });
});

describe('settings', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetLocalSettingsStore();
  });

  it('normalizes the site URL', () => {
    expect(normalizeSiteUrl(' https://optimizely-onboarding.vercel.app/ ')).toBe('https://optimizely-onboarding.vercel.app');
    expect(normalizeSiteUrl('optimizely-onboarding.vercel.app')).toBeNull();
  });

  it('treats an unreadable store as empty, so loadConfig reports missing settings', async () => {
    // What the production store throws on an install that has never saved its settings.
    vi.spyOn(storage.settings, 'get').mockRejectedValue(new Error('Failed to get value at app-data/1/settings'));
    vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    expect(await loadConfig()).toEqual({
      ok: false,
      missing: ['Site URL', 'Preview secret', 'CMS client ID', 'CMS client secret'],
    });
  });
});
