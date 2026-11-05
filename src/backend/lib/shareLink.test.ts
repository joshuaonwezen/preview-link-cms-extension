import {describe, expect, it} from 'vitest';

import {shareUrl, signShare} from './shareLink';

// Produced by optimizely-nextjs-demo's own src/lib/preview/shareLink.ts:
//   OPTIMIZELY_PREVIEW_SECRET=test-secret-not-real tsx -e 'buildExternalPreviewQuery({key, loc: "en", ver: "3198"})'
// If this fails, the extension signs differently from the site and every link 404s.
const SITE_QUERY =
  '?key=dcf0e497951c4517ac1a7d7ecff0b853&loc=en&ver=3198&sig=yLSCMyxFnIhdgykrSBJbYvMmLutNHn20JhcmjHAnb9A';
const TARGET = {key: 'dcf0e497951c4517ac1a7d7ecff0b853', loc: 'en', ver: '3198'};
const SECRET = 'test-secret-not-real';

describe('signShare', () => {
  it('matches the signature the site itself produces', () => {
    expect(signShare(TARGET, SECRET)).toBe(new URLSearchParams(SITE_QUERY).get('sig'));
  });

  it('changes with the version, the locale and the secret', () => {
    const base = signShare(TARGET, SECRET);
    expect(signShare({...TARGET, ver: '3199'}, SECRET)).not.toBe(base);
    expect(signShare({...TARGET, loc: 'nl'}, SECRET)).not.toBe(base);
    expect(signShare(TARGET, 'another-secret')).not.toBe(base);
  });
});

describe('shareUrl', () => {
  it('builds the /preview/share URL the site verifies', () => {
    expect(shareUrl('https://optimizely-onboarding.vercel.app', TARGET, SECRET)).toBe(
      `https://optimizely-onboarding.vercel.app/preview/share${SITE_QUERY}`,
    );
  });
});
