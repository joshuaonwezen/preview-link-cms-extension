import {normalizeKey} from '../../shared/constants';
import type {ContentRef, LinkCheck, LinksResult, ShareLink} from '../../shared/types';
import {CmsClient, CmsVersion} from './cms';
import {ActionError} from './errors';
import {ApiError} from './http';
import type {SiteConfig} from './settings';
import {shareUrl} from './shareLink';

export interface Deps {
  cms: CmsClient;
  site: SiteConfig;
}

// The share page renders the whole page server-side; give it time, but stay well
// inside the function's own budget.
const CHECK_TIMEOUT_MS = 20_000;

const SITE_TIMED_OUT = 'The site took too long to open this preview. Check again in a moment.';
const SITE_UNREACHABLE =
  "The site couldn't be reached. If this keeps happening, ask a CMS admin to check the site URL in the app settings.";

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
    if (!item) {
      throw new ActionError('content_missing', "This item isn't in the CMS any more, so there is nothing to share.");
    }
    const locales = (item.locales ?? []).filter(Boolean);
    if (locales.length === 0) {
      const what = item.contentType ? ` (${item.contentType})` : '';
      throw new ActionError(
        'unsupported_content',
        `Preview links are for pages and experiences. This item${what} isn't one, so the site can't show it.`,
      );
    }
    throw new ActionError(
      'locale_missing',
      `This page has no "${locale}" language version. It exists in: ${locales.join(', ')}.`,
    );
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

// The editor and the CMS don't always agree on case or separator (en-US, en_us).
function sameLocale(a: string, b: string): boolean {
  return a.replace(/_/g, '-').toLowerCase() === b.replace(/_/g, '-').toLowerCase();
}

/**
 * `version` of the target: from the locale's listing or, for one older than the listing
 * reaches, from the version endpoint. Only a version of this item in this locale is signed;
 * a link for another item's or language's version would open nothing.
 */
async function findVersion(cms: CmsClient, target: Target, version: string, listed: CmsVersion[]): Promise<CmsVersion> {
  const found = listed.find((v) => String(v.version) === version) ?? (await cms.getVersion(target.key, version));
  if (!found || (found.key && normalizeKey(found.key) !== target.key)) {
    throw new ActionError(
      'version_missing',
      "The version open in the editor isn't in the CMS any more. Reload the page in the editor and try again.",
    );
  }
  if (found.locale && !sameLocale(found.locale, target.locale)) {
    throw new ActionError(
      'locale_mismatch',
      `The open version is the "${found.locale}" language version, not "${target.locale}". ` +
        'Reload the page in the editor and try again.',
    );
  }
  return found;
}

export async function getLinks(deps: Deps, ref: ContentRef): Promise<LinksResult> {
  const target = await resolveTarget(deps, ref);
  const versions = await listVersionsOrExplain(deps.cms, target.key, target.locale);
  const open = ref.version ? await findVersion(deps.cms, target, ref.version, versions) : null;

  const latest = latestPerVariation(versions);
  const original = latest.find((v) => !v.variation);
  return {
    content: {key: target.key, locale: target.locale, displayName: original?.displayName || open?.displayName || ''},
    current: open ? toLink(deps, target, open) : null,
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
  // Sign only what getLinks would have signed: a version listed for this item and locale.
  await findVersion(deps.cms, target, version, await listVersionsOrExplain(deps.cms, target.key, target.locale));
  const url = shareUrl(deps.site.url, {key: target.key, loc: target.locale, ver: version}, deps.site.previewSecret);
  try {
    const res = await fetch(url, {redirect: 'follow', signal: AbortSignal.timeout(CHECK_TIMEOUT_MS)});
    return {status: res.status, ok: res.status === 200};
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    throw new ActionError('site_unreachable', timedOut ? SITE_TIMED_OUT : SITE_UNREACHABLE);
  }
}
