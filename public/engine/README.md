# Stockfish engine (GPL-3.0)

These files are **Stockfish 19** compiled to WebAssembly by
[stockfish.js](https://github.com/nmrugg/stockfish.js) (the "lite,
single-threaded" build). They are **not** covered by COAT's MIT license.
They are licensed under the GNU General Public License v3; see
[COPYING.txt](COPYING.txt).

COAT runs them unmodified as a separate program in a Web Worker and talks to
them only through the UCI text protocol.

| File | SHA-256 |
| --- | --- |
| `stockfish-19-lite-single.js` | `ccb130d7ff29408531c47d859a49f91d59d4f482d05a53eb1a3231a4f624c91a` |
| `stockfish-19-lite-single.wasm` | `ee4f115bdb2d32cadf96cada104a05b5ec257d7ad6f57582190b49bc71f096de` |

## Source code

- These exact files are from the npm package `stockfish@19.0.1`.
- The source for that build is tag
  [`v19.0.1` of nmrugg/stockfish.js](https://github.com/nmrugg/stockfish.js/tree/v19.0.1).
  Build instructions are in its README (`npm run build-single-lite`).
- Upstream engine: [official-stockfish/Stockfish](https://github.com/official-stockfish/Stockfish).

## Updating

```bash
npm pack stockfish@<version>
tar xzf stockfish-<version>.tgz
cp package/bin/stockfish-*-lite-single.{js,wasm} public/engine/
cp package/Copying.txt public/engine/COPYING.txt
```

Then update `ENGINE_FILE` in `src/engine/stockfish.ts`, along with the hashes and
version in this file.
