# Security policy

## Reporting a vulnerability

Please report security problems privately through GitHub:
**Security → Report a vulnerability** on this repository. Please don't open a
public issue for them.

## How COAT is built to be safe

COAT is a static site with no backend, no database and no accounts.

- **No HTML injection.** All text from APIs, PGN files and the URL is inserted
  as plain text (`textContent`), never as HTML. Links are limited to `http(s)`.
- **Content-Security-Policy.** The built site only runs its own scripts and
  styles. It may only contact `lichess.org`, `explorer.lichess.org` and
  `api.chess.com`. See `vite.config.ts`.
- **No third-party assets.** Fonts are bundled with the site, so visitors'
  browsers don't contact any other server.
- **Lichess token.** The optional token for the opening explorer needs no
  permissions. It is kept only for the current tab unless the user ticks
  "Remember on this device", and is only ever sent to `explorer.lichess.org`.
  A remembered token is readable by any page on the same origin
  (`notkornflakes.github.io`), which includes the owner's other GitHub Pages
  projects.
- **Validated API data.** Chess.com archive links are only followed when they
  point to `https://api.chess.com/pub/player/<user>/games/<yyyy>/<mm>`.
- **Supply chain.** GitHub Actions are pinned to exact commits, workflows get
  read-only permissions by default, and Dependabot keeps npm packages and
  actions up to date.
