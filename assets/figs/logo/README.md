# Kaiwen Education logo assets

The six `color-*` / `black-*` PNGs are the approved source artwork: `logo` is
the standalone crane emblem, `word` is the "Kaiwen Education" wordmark
(Avenir Next Demi Bold), and `full` is the combined banner. The root README and
translated READMEs use `color-full.png`.

The emblem sources were regenerated on 2026-11-24 from `Kaiwen Logo.gif`
(frame 0, flattened to the brand gold `#FCCD0E` and charcoal `#3C3B3C`).
`color-*` keeps the two-tone artwork; `black-*` is the monochrome treatment
(black disc with the crane knocked out). The previous DeepTutor artwork is
preserved in `assets/logo-backup-20261124/`.

After changing these sources, run:

```sh
npm --prefix web run sync:logo
```

This crops excess transparent padding without changing the artwork, creates
web-sized copies in `web/public/brand`, and regenerates square 16/32 px favicons
and the 180 px Apple touch icon. The application uses `/brand/*` URLs. Legacy
`/logo.png`, `/logo_black.png`, `/banner.png`, and `/logo-ver2.png` URLs also serve
the new artwork so existing saved documents keep working. Commit the generated
public files with any source changes; packaged builds use these public files.

Desktop icons derive from the same emblem: `apps/desktop/assets/mark.png` and
`wordmark.png` are regenerated with the sources, then
`npm --prefix apps/desktop run icon` rebuilds `icon.icns` / `icon.ico`.

`animated6-2-second-pause.gif` (byte-identical to `Kaiwen Logo.gif`) is the
animated original: 35-frame sheen loop, 5.2 s cycle with a 2 s hold. Its web
derivative `web/public/brand/kaiwen-animated.webp` is lossless and pixel-exact
per frame — native resolution, binary alpha, union crop across all frames so
the shimmer sparkles are never clipped, same timings/loop. It plays on the
chat home greeting, the session loading screen, and the desktop splash
(`apps/desktop/assets/kaiwen-animated.webp`). Icons, favicons, and header
lockups stay static — those formats cannot animate. Animated marks use plain
`<img>`, not `next/image`, whose optimizer would flatten them to static frames.
