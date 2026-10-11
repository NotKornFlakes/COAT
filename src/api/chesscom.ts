// Chess.com Published-Data API (https://www.chess.com/news/view/published-data-api).
// Public, read-only, no authentication required.

import { ApiError } from './lichess';

export interface ChessComGame {
  url: string;
  pgn?: string;
  rules: string;
  time_class: string;
  rated: boolean;
  white: { username: string; rating: number; result: string };
  black: { username: string; rating: number; result: string };
}

const DRAW_RESULTS = new Set([
  'agreed',
  'repetition',
  'stalemate',
  'insufficient',
  '50move',
  'timevsinsufficient',
]);

/** Maps a chess.com per-player result code to win / draw / loss. */
export function chessComOutcome(result: string): 'win' | 'draw' | 'loss' {
  if (result === 'win') return 'win';
  if (DRAW_RESULTS.has(result)) return 'draw';
  return 'loss';
}

/** Most recent standard-chess games for a user, newest months first. */
export async function chessComUserGames(
  username: string,
  max: number,
  onProgress?: (count: number) => void,
  signal?: AbortSignal,
): Promise<ChessComGame[]> {
  const user = encodeURIComponent(username.toLowerCase());
  const res = await fetch(`https://api.chess.com/pub/player/${user}/games/archives`, { signal });
  if (res.status === 404) throw new ApiError(`Chess.com user "${username}" not found.`, 404);
  if (!res.ok) throw new ApiError(`Could not load chess.com archives (${res.status})`, res.status);
  const { archives } = (await res.json()) as { archives: string[] };

  const games: ChessComGame[] = [];
  for (const archive of [...archives].reverse()) {
    const r = await fetch(archive, { signal });
    if (!r.ok) throw new ApiError(`Could not load ${archive} (${r.status})`, r.status);
    const month = ((await r.json()) as { games: ChessComGame[] }).games
      .filter((g) => g.rules === 'chess' && g.pgn)
      .reverse();
    games.push(...month);
    onProgress?.(Math.min(games.length, max));
    if (games.length >= max) break;
  }
  return games.slice(0, max);
}
