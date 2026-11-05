import {createHmac} from 'node:crypto';

export interface ShareTarget {
  key: string;
  loc: string;
  ver: string;
}

// Must stay identical to the signing in optimizely-nextjs-demo src/lib/preview/shareLink.ts:
// HMAC-SHA256 over "key\nver\nloc" with the site's OPTIMIZELY_PREVIEW_SECRET, base64url.
// The site's /preview/share checks it and renders that version through Graph's App
// Key/Secret, not the CMS's ~5-minute preview token, so the link never expires.
// Rotating the secret on the site revokes every link at once.
export function signShare(t: ShareTarget, secret: string): string {
  return createHmac('sha256', secret).update(`${t.key}\n${t.ver}\n${t.loc}`).digest('base64url');
}

/** `siteUrl` is an origin (plus optional path) without a trailing slash. */
export function shareUrl(siteUrl: string, t: ShareTarget, secret: string): string {
  const params = new URLSearchParams({key: t.key, loc: t.loc, ver: t.ver, sig: signShare(t, secret)});
  return `${siteUrl}/preview/share?${params.toString()}`;
}
