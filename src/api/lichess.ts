// Lichess public APIs (https://lichess.org/api). All responses are open data.
//
// - Cloud eval: no authentication required.
// - Game export: no authentication required for public games.
// - Opening explorer: requires a personal API token (any token, no scopes),
//   created at https://lichess.org/account/oauth/token.

import { Chess } from 'chess.js';
import { uciToMove } from '../chess/openings';

export interface EvalLine {
  /** Centipawns from White's point of view (absent when mate). */
  cp?: number;
  /** Moves to mate from White's point of view. */
  mate?: number;
  uci: string[];
  san: string[];
}

export interface CloudEval {
  depth: number;
  knodes: number;
  lines: EvalLine[];
}

export interface ExplorerMove {
  uci: string;
  san: string;
  white: number;
  draws: number;
  black: number;
  averageRating?: number;
  opening: { eco: string; name: string } | null;
}

export interface ExplorerResult {
  white: number;
  draws: number;
  black: number;
  moves: ExplorerMove[];
  opening: { eco: string; name: string } | null;
}

export type ExplorerDb = 'masters' | 'lichess';

export interface ExplorerFilters {
  /** Lichess db only: speeds such as blitz, rapid, classical. */
  speeds?: string[];
  /** Lichess db only: rating group lower bounds, e.g. [1600, 1800]. */
  ratings?: number[];
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

/**
 * Converts a line of UCI moves to SAN. Lichess sends castling as king-to-rook
 * (e1h1) for Chess960 compatibility, so translate that to standard e1g1.
 */
export function uciLineToSan(fen: string, uci: string[], maxPlies = uci.length): { uci: string[]; san: string[] } {
  const chess = new Chess(fen);
  const outUci: string[] = [];
  const san: string[] = [];
  for (const raw of uci.slice(0, maxPlies)) {
    let u = raw;
    const piece = chess.get(u.slice(0, 2) as never);
    if (piece?.type === 'k') {
      const castle: Record<string, string> = { e1h1: 'e1g1', e1a1: 'e1c1', e8h8: 'e8g8', e8a8: 'e8c8' };
      if (castle[u]) u = castle[u];
    }
    try {
      san.push(chess.move(uciToMove(u)).san);
      outUci.push(u);
    } catch {
      break;
    }
  }
  return { uci: outUci, san };
}

const evalCache = new Map<string, CloudEval | null>();

/** Cached engine evaluation for a position, or null if Lichess has none. */
export async function cloudEval(fen: string, multiPv = 3, signal?: AbortSignal): Promise<CloudEval | null> {
  const key = `${fen}|${multiPv}`;
  if (evalCache.has(key)) return evalCache.get(key)!;
  const url = `https://lichess.org/api/cloud-eval?fen=${encodeURIComponent(fen)}&multiPv=${multiPv}`;
  const res = await fetch(url, { signal });
  if (res.status === 404) {
    evalCache.set(key, null);
    return null;
  }
  if (!res.ok) throw new ApiError(`Cloud eval failed (${res.status})`, res.status);
  const data = (await res.json()) as {
    depth: number;
    knodes: number;
    pvs: { cp?: number; mate?: number; moves: string }[];
  };
  const result: CloudEval = {
    depth: data.depth,
    knodes: data.knodes,
    lines: data.pvs.map((pv) => ({ cp: pv.cp, mate: pv.mate, ...uciLineToSan(fen, pv.moves.split(' '), 10) })),
  };
  evalCache.set(key, result);
  return result;
}

const explorerCache = new Map<string, ExplorerResult>();

/** Move statistics for a position from the Lichess opening explorer. */
export async function explorer(
  db: ExplorerDb,
  fen: string,
  token: string,
  filters: ExplorerFilters = {},
  signal?: AbortSignal,
): Promise<ExplorerResult> {
  const params = new URLSearchParams({ fen, moves: '15', topGames: '0', recentGames: '0' });
  if (db === 'lichess') {
    if (filters.speeds?.length) params.set('speeds', filters.speeds.join(','));
    if (filters.ratings?.length) params.set('ratings', filters.ratings.join(','));
  }
  const url = `https://explorer.lichess.org/${db}?${params}`;
  if (explorerCache.has(url)) return explorerCache.get(url)!;
  const res = await fetch(url, { signal, headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) throw new ApiError('Lichess rejected the API token. Check it in Settings.', 401);
  if (res.status === 429) throw new ApiError('Lichess rate limit reached; wait a minute and try again.', 429);
  if (!res.ok) throw new ApiError(`Explorer request failed (${res.status})`, res.status);
  const result = (await res.json()) as ExplorerResult;
  explorerCache.set(url, result);
  return result;
}

export interface LichessGame {
  id: string;
  variant: string;
  speed: string;
  rated: boolean;
  status: string;
  winner?: 'white' | 'black';
  players: {
    white: { user?: { name: string }; rating?: number };
    black: { user?: { name: string }; rating?: number };
  };
  moves: string;
}

/** Parses newline-delimited JSON, ignoring blank lines. */
export function parseNdjson<T>(text: string): T[] {
  return text
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as T);
}

/** A user's most recent finished games (public data, no token required). */
export async function lichessUserGames(
  username: string,
  max: number,
  onProgress?: (count: number) => void,
  signal?: AbortSignal,
): Promise<LichessGame[]> {
  const params = new URLSearchParams({
    max: String(max),
    moves: 'true',
    opening: 'false',
    clocks: 'false',
    evals: 'false',
    finished: 'true',
  });
  const res = await fetch(`https://lichess.org/api/games/user/${encodeURIComponent(username)}?${params}`, {
    headers: { Accept: 'application/x-ndjson' },
    signal,
  });
  if (res.status === 404) throw new ApiError(`Lichess user "${username}" not found.`, 404);
  if (res.status === 429) throw new ApiError('Lichess rate limit reached; wait a minute and try again.', 429);
  if (!res.ok || !res.body) throw new ApiError(`Could not load games (${res.status})`, res.status);

  // Stream the response so progress can be shown for large exports.
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  const games: LichessGame[] = [];
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buffer += value;
    const lines = buffer.split('\n');
    buffer = done ? '' : lines.pop()!;
    for (const l of lines) if (l.trim()) games.push(JSON.parse(l));
    onProgress?.(games.length);
    if (done) break;
  }
  return games;
}
