import {normalizeKey} from '../../shared/constants';
import type {ContentRef, LinkCheck, LinksResult, ShareLink} from '../../shared/types';
import {CmsClient, CmsVersion} from './cms';
import {ApiError} from './http';
import type {SiteConfig} from './settings';
import {shareUrl} from './shareLink';

/** A request the UI can fix (bad input, wrong state) - answered as HTTP 400. */
export class ActionError extends Error {
  public readonly code: string;

  public constructor(code: string, message: string) {
    super(message);
    this.name = 'ActionError';
    this.code = code;
  }
}

export interface Deps {
  cms: CmsClient;
  site: SiteConfig;
}

// The share page renders the whole page server-side; give it time, but stay well
// inside the function's own budget.
const CHECK_TIMEOUT_MS = 20_000;

/**
 * The item's versions in `locale`. The editor reports its UI locale even for items
 * without language versions (media, folders), and the CMS answers those with a 404, so
 * look the item up once to say what's wrong instead of passing the raw error on.
 */
export async function listVersionsOrExplain(cms: CmsClient, key: string, locale: string): Promise<CmsVersion[]> {
  try {
    return await cms.listVersions(key, locale);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 404) throw error;
    const item = await cms.getItem(key);
    if (!item) throw new ActionError('content_missing', 'This item no longer exists in the CMS.');
    const locales = (item.locales ?? []).filter(Boolean);
    if (locales.length === 0) {
      const what = item.contentType ? ` (${item.contentType})` : '';
      throw new ActionError(
        'unsupported_content',
        `Preview links are for pages. This item${what} has no language versions, so the site can't render it.`,
      );
    }
    throw new ActionError('locale_missing', `This item has no "${locale}" version. It exists in: ${locales.join(', ')}.`);
  }
}

/**
 * The newest version of the original page and of each variation, original first.
 * The CMS lists versions newest first, so the first one seen per variation wins.
 */
export function latestPerVariation(versions: CmsVersion[]): CmsVersion[] {
  const seen = new Map<string, CmsVersion>();
  for (const v of versions) {
    const name = v.variation ?? '';
    if (!seen.has(name)) seen.set(name, v);
  }
  return [...seen.entries()].sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b))).map(([, v]) => v);
}

interface Target {
  key: string;
  locale: string;
}

async function resolveTarget({cms}: Deps, ref: ContentRef): Promise<Target> {
  if (!ref?.key) throw new ActionError('missing_content', 'No content item is open.');
  const key = normalizeKey(ref.key);
  return {key, locale: ref.locale || (await cms.primaryLocale(key))};
}

function toLink({site}: Deps, {key, locale}: Target, v: CmsVersion): ShareLink {
  const version = String(v.version);
  return {
    url: shareUrl(site.url, {key, loc: locale, ver: version}, site.previewSecret),
    version,
    variation: v.variation ?? null,
    status: v.status,
  };
}

export async function getLinks(deps: Deps, ref: ContentRef): Promise<LinksResult> {
  const target = await resolveTarget(deps, ref);
  const versions = await listVersionsOrExplain(deps.cms, target.key, target.locale);

  let current: ShareLink | null = null;
  if (ref.version) {
    const open =
      versions.find((v) => String(v.version) === String(ref.version)) ??
      (await deps.cms.getVersion(target.key, ref.version));
    if (!open) throw new ActionError('version_missing', `Version ${ref.version} isn't in the CMS any more.`);
    current = toLink(deps, target, open);
  }

  const latest = latestPerVariation(versions);
  const original = latest.find((v) => !v.variation);
  return {
    content: {key: target.key, locale: target.locale, displayName: original?.displayName || target.key},
    current,
    latest: latest.map((v) => toLink(deps, target, v)),
  };
}

/**
 * Opens the version's link the way a recipient would. A 404 means the site rejected the
 * signature (wrong preview secret or site URL), or Graph doesn't have that version yet.
 */
export async function checkLink(deps: Deps, ref: ContentRef, version: string): Promise<LinkCheck> {
  if (!version) throw new ActionError('missing_version', 'No version to check.');
  const target = await resolveTarget(deps, ref);
  const url = shareUrl(deps.site.url, {key: target.key, loc: target.locale, ver: version}, deps.site.previewSecret);
  try {
    const res = await fetch(url, {redirect: 'follow', signal: AbortSignal.timeout(CHECK_TIMEOUT_MS)});
    return {status: res.status, ok: res.status === 200};
  } catch (error) {
    const reason = error instanceof Error && error.name === 'TimeoutError' ? 'timed out' : 'failed';
    throw new ActionError('site_unreachable', `Opening the link on ${deps.site.url} ${reason}.`);
  }
}
