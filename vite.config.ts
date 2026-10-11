import { defineConfig, type Plugin } from 'vite';

/**
 * Content-Security-Policy for the built site. GitHub Pages cannot send HTTP
 * headers, so the policy is delivered as a <meta> tag. It is only added to
 * production builds because the dev server relies on inline scripts and
 * styles for hot reloading.
 *
 * - Scripts, styles and fonts may only come from this site (no inline code).
 * - Network requests may only go to the Lichess and Chess.com APIs.
 * (frame-ancestors cannot be set from a meta tag; it needs a real header.)
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'self' data:",
  'connect-src https://lichess.org https://explorer.lichess.org https://api.chess.com',
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  'upgrade-insecure-requests',
].join('; ');

function contentSecurityPolicy(): Plugin {
  return {
    name: 'coat-csp',
    apply: 'build',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' },
      { tag: 'meta', attrs: { name: 'referrer', content: 'strict-origin-when-cross-origin' }, injectTo: 'head-prepend' },
    ],
  };
}

// Relative base so the build works from any sub-path (e.g. GitHub Pages /COAT/).
export default defineConfig({
  base: './',
  plugins: [contentSecurityPolicy()],
  // The bundled opening dataset (~1.2 MB raw, ~170 kB gzipped) is the bulk of the JS.
  build: { chunkSizeWarningLimit: 1600 },
});
