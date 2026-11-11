# Share preview

Share preview adds a sidebar to the Optimizely CMS (SaaS) editor that gives you a link to the exact page version you are editing, including its variation. Anyone with the link can open that version on your website without a CMS login, and the link never expires. Copy it, open it, or pick the newest version of any other variation of the page.

Documentation: https://opti.joshuaonwezen.dev/demo/cms-ui-extensions#share-preview

## What editors get

- A **Share preview** tab on the editor's right-hand rail, with the page's name and whether you are on the original page or a variation.
- **Copy** and **Open** for the version open in the editor, marked Published, Draft or Older version. Switch variation in the editor and the link follows.
- A check that the link really opens on the site, with **Check again**, and what to ask an admin when it keeps failing.
- Under **Other variations**, links to the newest version of the original page and of each variation.
- A plain note instead of an error for images and folders, which a website doesn't render as pages.

## Setup

1. Add a share route to your website (see [What your site needs](#what-your-site-needs)) and give it a preview secret.
2. In the CMS, create an API key under **Settings > API Keys**. Copy the client secret: it is shown only once.
3. Install the app on your CMS instance (see [Deploy](#deploy)).
4. Open the app's settings page and fill in both sections. Each section is checked when you save it.

| Setting | Required | Where to find it | Used for |
|---|---|---|---|
| Site URL | No | Your website's public `https://` address, for example `https://www.example.com`. Leave it blank to use the address set for the page's application in CMS **Settings > Applications**. | Overrides where links point. When saved, it is checked once that it answers. |
| Preview secret | Yes | You choose it: a long random value, for example from `openssl rand -base64 32`. Set the same value on your website. | Signing every link. Your site checks the signature with it. |
| Client ID | Yes | CMS **Settings > API Keys**. | Reading the open page's versions and variations, and the site addresses in **Settings > Applications**. |
| Client secret | Yes | Shown once when the API key is created. | Same as the client ID. |

Secret fields come back blank on the settings page. Leave them blank to keep the saved value.

**How the site address is chosen**, for every link:
1. the Site URL setting, when one is saved;
2. otherwise the open page's own address, when its host is one of the hosts in CMS **Settings > Applications**;
3. otherwise the only primary host in **Settings > Applications**.

If none applies (for example, the CMS has several sites and the page's address isn't one of them), the sidebar asks the editor to have an admin set the Site URL. Only `https://` hosts count.

## What your site needs

The app signs links itself, so your site needs one route and no extra API. Links look like this:

```
https://www.example.com/preview/share?key=<content-key>&loc=<locale>&ver=<version>&sig=<signature>
```

- **Path.** The app always appends `/preview/share` to the site address. If the Site URL includes a path (`https://www.example.com/site`), the route is `/site/preview/share`.
- **Query parameters.**
  - `key`: the content key, 32 lowercase hexadecimal characters without dashes.
  - `loc`: the language version, as the CMS names it (`en`, `nl-BE`). When the editor doesn't report one, the page's primary language.
  - `ver`: the CMS version number. The app always sends it.
  - `sig`: the signature.
- **Signature.** HMAC-SHA256, keyed with the preview secret, over the UTF-8 text `key + "\n" + ver + "\n" + loc` (key, version, language, separated by line feeds), encoded as base64url without padding. Compare it in constant time:

  ```ts
  import {createHmac, timingSafeEqual} from 'node:crypto';

  export function isValidShareLink(params: URLSearchParams, secret: string): boolean {
    const [key, ver, loc] = ['key', 'ver', 'loc'].map((name) => params.get(name) ?? '');
    const expected = Buffer.from(createHmac('sha256', secret).update(`${key}\n${ver}\n${loc}`).digest('base64url'));
    const actual = Buffer.from(params.get('sig') ?? '');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }
  ```

- **A bad or missing signature answers 404**, without saying which part was wrong. Check the format of `key`, `ver` and `loc` too before using them.
- **Render that version server-side** from Optimizely Graph, authenticating with the Graph **App Key and Secret** as HTTP Basic auth (`Authorization: Basic base64(appKey:appSecret)`). The single key sees only published content and the CMS preview token expires after a few minutes; App Key and Secret see every version, drafts included, and don't expire. Query by key, language and version, passing them as GraphQL variables. Variations are versions too, so make sure the query includes variations (Graph leaves them out unless asked).
- **Keep the App Key and Secret on the server.** The link carries no Graph credential, only the signed key, version and language.
- **Answer 200 for a valid link**, and 404 when Graph doesn't have the version (yet). The sidebar's check opens the link from Optimizely's servers, follows redirects and treats anything but a 200 within 20 seconds as "doesn't open".
- **Don't let anything cache the page** (`Cache-Control: no-store`), or a CDN keeps serving links after you rotate the secret. Add `X-Robots-Tag: noindex` so search engines don't index previews.
- **Render read-only.** Leave out the CMS's on-page editing script; recipients aren't editors.
- **Links never expire.** Rotating the secret is how you revoke them: change it on the site, then save the new value in the app's settings. Every link shared so far stops working at once.

## Limits

These come from the CMS UI extension platform or from how the app works:

- **The extension context is only the open item's key, version, language and page address (`publicUrl`).** There is no editor identity, content type or variation name; the app reads versions and variations through the CMS REST API.
- **Extensions get no CMS token.** The app needs its own CMS API key, stored in its settings.
- **One preview secret and one Site URL per install**, and the app is installed once per CMS instance. Every site on that instance must accept the same secret.
- **The site must be public.** Links are checked from Optimizely's servers, so local, internal and IP addresses can't be used, and application hosts that aren't `https` are ignored.
- **A link shows one version.** It doesn't follow later edits: share a new link after saving.
- **Single links can't be revoked**, only all links at once by rotating the secret.
- **Pages and experiences only.** Images, folders and other items without language versions get a note instead of a link.
- **Variations come from the newest 1,000 versions** of the page's language. The version open in the editor is always found, however old.

## Security

- **What a link grants.** Anyone holding a link can see that one version. The signature stops them from editing the query to open other content, versions or languages.
- **Validated input.** Every action's parameters go through an allow-list parser: unknown fields are dropped, the content key must be 32 hexadecimal characters, the language a language code, the version a number and the page address an `https://` URL. Links are signed only for a version the CMS lists for that item and language.
- **Site address.** A Site URL must be a public `https://` address: no IP addresses, `localhost`, `*.local`, `*.internal` or names without a dot, and no user name or password. The check on save doesn't follow redirects. The page address the editor reports is never opened as such: it is only compared with the hosts in CMS **Settings > Applications**, and the host it matches goes through the same rules.
- **Audit log.** Each time links are signed, the app logs the content key, language and versions, never the link or signature. Saving settings logs the Site URL or client ID and whether a new secret was entered, never the secret.
- **Errors.** CMS error details stay in the app log; editors get a plain message.

## Develop

```bash
yarn install
yarn validate      # lint, typecheck, unit tests, build, ocp-app-sdk validate
npx -p @optimizely/ocp-cli-v2 ocp dev   # the sidebar in a simulated CMS, calling the local backend
```

The live tests in `tests/live/` read a real page's versions and open its signed links on a real site. They only read. Leave `PREVIEW_SITE_URL` empty to use the hosts in CMS **Settings > Applications**.

```bash
PREVIEW_LIVE=1 OPTIMIZELY_CMS_CLIENT_ID=<client-id> OPTIMIZELY_CMS_CLIENT_SECRET=<client-secret> \
PREVIEW_SITE_URL=https://www.example.com OPTIMIZELY_PREVIEW_SECRET=<preview-secret> \
PREVIEW_LIVE_KEY=<content-key> yarn vitest run tests/live
```

## Deploy

The app is CMS-scoped: install it once per CMS instance.

```bash
npx -p @optimizely/ocp-cli-v2 ocp app register --appId cms_preview_link --name "Share preview" --product HUB --personal   # once
npx -p @optimizely/ocp-cli-v2 ocp app prepare --bump-dev-version --publish
npx -p @optimizely/ocp-cli-v2 ocp directory install cms_preview_link@<version> --scope <cms-instance-uuid>
```

If you register your own copy, choose your own app ID and set it as `app_id` in `app.yml`. Publishing a new dev version the same way moves existing installs onto it. After installing, fill in the settings (see [Setup](#setup)).

Using the app on another CMS instance: https://opti.joshuaonwezen.dev/demo/cms-ui-extensions#reuse
Troubleshooting: https://opti.joshuaonwezen.dev/demo/cms-ui-extensions#troubleshooting

## Layout

| Path | What |
|---|---|
| `src/backend/functions/CmsUiExtension.ts` | Action router, using the `{action, params}` → `{ok, result}` envelope; validates params and writes the audit log |
| `src/backend/lib/validate.ts` | One parser per action (allow-lists, unknown fields dropped) |
| `src/backend/lib/errors.ts` | `ActionError`: a request the UI can fix, answered as HTTP 400 |
| `src/backend/lib/links.ts` | `getLinks` and `checkLink`, and which site a page's links go to |
| `src/backend/lib/shareLink.ts` | The signature and the `/preview/share` URL |
| `src/backend/lib/siteUrl.ts` | Site addresses from CMS Settings > Applications, and picking one for a page |
| `src/backend/lib/cms.ts` | CMS token, items, per-language version listing and applications |
| `src/backend/lib/settings.ts` | Settings store and the Site URL rules |
| `src/backend/lifecycle/Lifecycle.ts` | Validates the settings forms before saving |
| `src/shared/` | The UI ↔ backend contract, and the version status badge mapping |
| `src/cms-ui-extensions/preview/` | `SharePreview.sidebar.tsx` |
