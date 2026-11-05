# Share preview

Share the exact page version open in the editor - its content and its variation - with anyone,
through a link that needs no CMS login and never expires.

- **Share preview** sidebar: a signed link to the version you're editing, with Copy and Open, plus a
  link to the newest version of the original page and of each variation. It checks that the link
  opens on the site and says what to fix when it doesn't.

Built for sites that render signed `/preview/share` links, such as optimizely-nextjs-demo: the site
checks the signature and reads the version through Graph's App Key/Secret instead of the CMS's
5-minute preview token. Rotating the site's preview secret revokes every link.
