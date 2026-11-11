# Share preview

Share the exact page version open in the editor - its content and its variation - with anyone,
through a link that needs no CMS login and never expires.

- **Share preview** sidebar: a signed link to the version you're editing, with Copy and Open, plus a
  link to the newest version of the original page and of each variation. It checks that the link
  opens on your website and says what to fix when it doesn't.
- **Works with your sites as set up in the CMS**: links go to the site of the page's application in
  CMS Settings > Applications, or to a site address you set.
- **Revocable**: rotating the preview secret turns off every link shared so far.

Your website needs a `/preview/share` route that checks the link's signature (HMAC-SHA256 with a
preview secret you share with the app) and renders that version from Optimizely Graph with the App
Key and Secret, so drafts are visible.

Documentation: https://opti.joshuaonwezen.dev/demo/cms-ui-extensions#share-preview
