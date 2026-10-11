import { describe, expect, it } from 'vitest';
import { isSafeUrl } from '../src/ui/dom';
import { isChessComArchive } from '../src/api/chesscom';
import { parsePgn, fromPgn } from '../src/analysis/games';

describe('link safety', () => {
  it('allows http(s) and relative links only', () => {
    expect(isSafeUrl('https://lichess.org/abc')).toBe(true);
    expect(isSafeUrl('./')).toBe(true);
    expect(isSafeUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeUrl(' JavaScript:alert(1)')).toBe(false);
    expect(isSafeUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
  });

  it('drops non-http Site headers from PGN games', () => {
    const [g] = fromPgn(parsePgn('[White "me"]\n[Black "x"]\n[Result "1-0"]\n[Site "javascript:alert(1)"]\n\n1. e4 1-0'), 'me');
    expect(g.url).toBeUndefined();
  });
});

describe('chess.com archive validation', () => {
  it('accepts only monthly archives for the requested user on api.chess.com', () => {
    expect(isChessComArchive('https://api.chess.com/pub/player/hikaru/games/2026/09', 'hikaru')).toBe(true);
    expect(isChessComArchive('https://api.chess.com/pub/player/other/games/2026/09', 'hikaru')).toBe(false);
    expect(isChessComArchive('https://evil.example/pub/player/hikaru/games/2026/09', 'hikaru')).toBe(false);
    expect(isChessComArchive('http://api.chess.com/pub/player/hikaru/games/2026/09', 'hikaru')).toBe(false);
    expect(isChessComArchive('not a url', 'hikaru')).toBe(false);
  });
});
