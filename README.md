# Share preview: CMS UI extension

An Optimizely CMS (SaaS) UI extension, built as a CMS-scoped OCP app. It gives editors a link to the exact page version open in the editor - content and variation - that anyone can open without a CMS login, and that never expires.

It is built for `optimizely-nextjs-demo`, whose `/preview/share` page renders signed links:
- the signature is HMAC-SHA256 over `key\nver\nloc` with the site's `OPTIMIZELY_PREVIEW_SECRET` (see `src/lib/preview/shareLink.ts` there);
- the site reads the version through Graph's App Key/Secret, not the CMS's ~5-minute preview token.

The extension signs links itself with the same secret, so the site needs no extra endpoint. `src/backend/lib/shareLink.test.ts` pins a signature produced by the site's own code, so the two can't drift apart unnoticed.

## What it does
- **Share preview** sidebar:
  - the page's name and whether the editor is on the original page or a variation;
  - Copy and Open for the version open in the editor, with a Published / Draft / Older version badge (the URL itself isn't shown);
  - a check that the link opens on the site, with **Check again**, and what to ask an admin when it keeps failing (usually the preview secret or site URL);
  - under **Other variations**, the newest version of the original page and of each variation.
- Images and folders get a note instead of an error: the site only renders pages.

## Revoking links
Links never expire and don't follow later edits. Rotating `OPTIMIZELY_PREVIEW_SECRET` on the site, then saving the new secret in the app's **Site** settings, revokes every link shared so far at once. There is no way to revoke a single link.

## Security
- **Validated input.** `src/backend/lib/validate.ts` has one parser per action: unknown fields are dropped, the content key must be 32 hex characters (dashes stripped, lowercased), the locale a locale code and the version a number, before anything reaches a CMS URL or a signature. Both actions sign only a version the CMS lists for that item and locale.
- **Site URL.** Settings accept only a public `https://` address: no IP addresses, `localhost`, `*.local`, `*.internal` or other names without a dot, and no credentials in the URL. The reachability check on save doesn't follow redirects.
- **Audit log.** Each `getLinks` logs `audit` with the content key, locale and versions signed, never the URL or signature. Saving either settings section logs `audit` with the site URL or client ID and whether a new secret was entered, never the secret.
- **Errors.** CMS error detail stays in the app log; the editor gets a plain message for the error code.

## Platform constraints (CMS UI extensions beta, SDK 1.1.0)
- **The extension context is only `{key, version, locale, publicUrl}`.** The backend reads the versions and their variations through the CMS REST API; `publicUrl` isn't used.
- **Extensions get no CMS token.** The app stores a CMS API client in its settings.
- **Reading settings an install never saved throws** in the production runtime; `readSection` treats that as empty.

## Develop

```bash
yarn install
yarn validate      # lint + typecheck + unit tests + build + ocp-app-sdk validate
ocp dev            # the sidebar in a simulated CMS host, invokeFunction against the local backend
```

The live suite in `tests/live/` reads real CMS versions and opens the signed links on the real site (read-only):

```bash
PREVIEW_LIVE=1 OPTIMIZELY_CMS_CLIENT_ID=… OPTIMIZELY_CMS_CLIENT_SECRET=… \
PREVIEW_SITE_URL=https://optimizely-onboarding.vercel.app OPTIMIZELY_PREVIEW_SECRET=… \
PREVIEW_LIVE_KEY=<content key> yarn vitest run tests/live
```

## Layout

| Path | What |
|---|---|
| `src/backend/functions/CmsUiExtension.ts` | Action router, using the `{action, params}` → `{ok, result}` envelope; validates params and writes the audit log |
| `src/backend/lib/validate.ts` | One parser per action (allow-lists, unknown fields dropped) |
| `src/backend/lib/errors.ts` | `ActionError`: a request the UI can fix, answered as HTTP 400 |
| `src/backend/lib/links.ts` | `getLinks` and `checkLink` |
| `src/backend/lib/shareLink.ts` | The signature, identical to the site's |
| `src/backend/lib/cms.ts` | CMS token, item and per-locale version listing |
| `src/backend/lib/settings.ts` | Settings store and the site URL rules |
| `src/backend/lifecycle/Lifecycle.ts` | Validates the settings forms before saving |
| `src/shared/` | The UI ↔ backend contract, and the version status badge mapping |
| `src/cms-ui-extensions/preview/` | `SharePreview.sidebar.tsx` |

## Deploy
The app is CMS-scoped, so it is installed once per CMS instance:

```bash
ocp app register --appId cms_preview_link --name "Share preview" --product HUB --personal   # once
ocp app prepare --bump-dev-version --publish
ocp directory install cms_preview_link@<version> --scope <cms-instance-uuid>
```

Later dev versions published the same way replace the running one on existing installs. After installing, fill in both settings sections.
