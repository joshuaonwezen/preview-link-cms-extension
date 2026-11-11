# Share preview

## Setup
1. **Site**: the public `https://` address of the site that renders `/preview/share` for this CMS
   instance, and that site's `OPTIMIZELY_PREVIEW_SECRET`. Local addresses and IP addresses aren't
   accepted.
2. **CMS API client**: a client ID and secret from CMS → Settings → API Keys, used to read the open
   item's versions.

## Using it
Open a page or experience and open the **Share preview** tab on the right-hand rail.

- **This version** is the version open in the editor, with Copy and Open. Switch variation in the
  editor and the link follows. The sidebar then checks that the link opens on the site; if it
  doesn't, wait a few seconds and choose **Check again**.
- **Other variations** links the newest version of the original page and of every other variation.

Links show exactly one version and don't change when the page is edited later. Share a new link after
editing. Images and folders can't be shared: the site only renders pages.

## Revoking links
Links never expire. To revoke every link shared so far, rotate the site's `OPTIMIZELY_PREVIEW_SECRET`
and save the new secret in the **Site** settings. Single links can't be revoked.
