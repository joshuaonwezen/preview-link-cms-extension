// Read-only: lists a real page's versions, signs links and opens them on the real site.
//   PREVIEW_LIVE=1 OPTIMIZELY_CMS_CLIENT_ID=… OPTIMIZELY_CMS_CLIENT_SECRET=… \
//   PREVIEW_SITE_URL=https://optimizely-onboarding.vercel.app OPTIMIZELY_PREVIEW_SECRET=… \
//   PREVIEW_LIVE_KEY=<content key> yarn vitest run tests/live
import {describe, expect, it} from 'vitest';

import {CmsClient} from '../../src/backend/lib/cms';
import {checkLink, getLinks} from '../../src/backend/lib/links';

const live = process.env.PREVIEW_LIVE === '1';
const key = process.env.PREVIEW_LIVE_KEY ?? '';

describe.runIf(live)('share preview links (live, read-only)', () => {
  const deps = {
    cms: new CmsClient({
      clientId: process.env.OPTIMIZELY_CMS_CLIENT_ID ?? '',
      clientSecret: process.env.OPTIMIZELY_CMS_CLIENT_SECRET ?? '',
    }),
    site: {url: process.env.PREVIEW_SITE_URL ?? '', previewSecret: process.env.OPTIMIZELY_PREVIEW_SECRET ?? ''},
  };

  it('signs links the site opens, for the original and every variation', async () => {
    const result = await getLinks(deps, {key, locale: 'en'});
    console.log(result.content.displayName, result.latest.map((l) => `${l.variation ?? 'original'}@${l.version}`));
    expect(result.latest.length).toBeGreaterThan(0);
    for (const link of result.latest) {
      const check = await checkLink(deps, {key, locale: 'en'}, link.version);
      expect(check, `${link.variation ?? 'original'} v${link.version}`).toEqual({status: 200, ok: true});
    }
  });

  it('gets a 404 for a link signed with the wrong secret', async () => {
    const wrong = {...deps, site: {...deps.site, previewSecret: 'not-the-secret'}};
    const {latest} = await getLinks(wrong, {key, locale: 'en'});
    expect(await checkLink(wrong, {key, locale: 'en'}, latest[0].version)).toEqual({status: 404, ok: false});
  });
});
