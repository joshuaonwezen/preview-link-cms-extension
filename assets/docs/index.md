# Share preview

Share preview gives editors a link to the exact page version open in the editor, including its
variation. Anyone with the link can open that version on your website without a CMS login, and the
link never expires.

Full walkthrough: https://opti.joshuaonwezen.dev/demo/cms-ui-extensions#share-preview

## Before you start: your website

The app signs links; your website opens them. It needs a public `https` route at `/preview/share`
under the site address that:

- takes the query parameters `key` (the content key, 32 lowercase hexadecimal characters), `loc`
  (the language, for example `en`), `ver` (the version number) and `sig` (the signature);
- checks `sig`: HMAC-SHA256, keyed with your preview secret, over the text `key`, `ver` and `loc`
  joined by line feeds (`key\nver\nloc`), encoded as base64url without padding. Compare it in
  constant time, and answer **404** when it doesn't match;
- renders that version server-side from Optimizely Graph, using the Graph **App Key and Secret**
  (HTTP Basic auth) so drafts and variations are visible. Keep these credentials on the server;
- answers **200** for a valid link, sends `Cache-Control: no-store` so revoked links aren't served
  from a cache, and `X-Robots-Tag: noindex`.

## Settings

**Site**
- **Site URL** (optional): your website's public `https://` address, for example
  `https://www.example.com`. Leave it blank and each page's links go to the site set for its
  application in CMS **Settings > Applications**. Set it only to override that. Local addresses and
  IP addresses aren't accepted, and a URL you enter must answer when you save.
- **Preview secret** (required): the secret your website checks links with. Choose a long random
  value (for example from `openssl rand -base64 32`) and set the same value on your website.

**CMS API client**
- **Client ID** and **Client secret** (required): from CMS **Settings > API Keys**. The app uses them
  to read the open page's versions and variations, and the site addresses in **Settings >
  Applications**. The secret is shown only once when the key is created.

Secret fields come back blank. Leave them blank to keep the saved value.

When the Site URL is blank, the app uses the open page's own address if its host is listed in
**Settings > Applications**, otherwise the only primary host there. If the CMS has several sites
and the page's address isn't one of them, editors are asked to have an admin set the Site URL.

## Using it

Open a page or experience and open the **Share preview** tab on the right-hand rail.

- **This version** is the version open in the editor, with Copy and Open. Switch variation in the
  editor and the link follows. The sidebar then checks that the link opens on the site; if it
  doesn't, wait a few seconds and choose **Check again**.
- **Other variations** links the newest version of the original page and of every other variation.

Links show exactly one version and don't change when the page is edited later. Share a new link after
editing. Images and folders can't be shared: the site only renders pages.

## Revoking links

Links never expire. To revoke every link shared so far, change the preview secret on your website and
save the new value in the app's **Site** settings. Single links can't be revoked.

## Troubleshooting

- **"Missing or not valid in app settings"**: fill in the named settings on this page.
- **"The app can't tell which site this page is on"**: set the Site URL, or add the page's host to its
  application in CMS **Settings > Applications**.
- **"The site couldn't open this preview"**: a draft just saved can take a few seconds to reach Graph.
  If it keeps failing, check that the preview secret matches the website's and that the website has
  the `/preview/share` route.

More: https://opti.joshuaonwezen.dev/demo/cms-ui-extensions#troubleshooting

Using the app on another CMS instance: https://opti.joshuaonwezen.dev/demo/cms-ui-extensions#reuse
