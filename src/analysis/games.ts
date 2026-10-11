// Turns games from any source into a common shape and aggregates
// results per opening, from the point of view of one player.

import type { LichessGame } from '../api/lichess';
import { chessComOutcome, type ChessComGame } from '../api/chesscom';
import { OpeningBook, openingFamily, type Opening } from '../chess/openings';

export type Color = 'white' | 'black';
export type Outcome = 'win' | 'draw' | 'loss';

export interface PlayerGame {
  color: Color;
  outcome: Outcome;
  /** SAN moves from the start position. */
  moves: string[];
  opponent: string;
  speed?: string;
  url?: string;
}

// ---------- PGN ----------

export interface PgnGame {
  headers: Record<string, string>;
  moves: string[];
}

/** Splits a (multi-game) PGN file into games: headers plus SAN mainline moves. */
export function parsePgn(text: string): PgnGame[] {
  const games: PgnGame[] = [];
  const chunks = text.replace(/\r\n?/g, '\n').split(/\n\s*\n(?=\s*\[)/);
  for (const chunk of chunks) {
    const headers: Record<string, string> = {};
    for (const m of chunk.matchAll(/^\s*\[(\w+)\s+"((?:[^"\\]|\\.)*)"\]\s*$/gm)) headers[m[1]] = m[2];
    const movetext = chunk.replace(/^\s*\[.*\]\s*$/gm, ' ');
    const moves = sanTokens(movetext);
    if (moves.length || Object.keys(headers).length) games.push({ headers, moves });
  }
  return games;
}

/** Extracts mainline SAN moves from PGN movetext (drops comments, variations, NAGs). */
export function sanTokens(movetext: string): string[] {
  let text = movetext.replace(/\{[^}]*\}/g, ' ').replace(/;[^\n]*/g, ' ');
  // Remove (possibly nested) variations from the inside out.
  let prev;
  do {
    prev = text;
    text = text.replace(/\([^()]*\)/g, ' ');
  } while (text !== prev);
  return text
    .replace(/\$\d+/g, ' ')
    .replace(/\d+\.(\.\.)?/g, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/[!?]+$/, ''))
    .filter((t) => t && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t));
}

function outcomeFromResult(result: string | undefined, color: Color): Outcome | undefined {
  if (result === '1/2-1/2') return 'draw';
  if (result === '1-0') return color === 'white' ? 'win' : 'loss';
  if (result === '0-1') return color === 'black' ? 'win' : 'loss';
  return undefined;
}

/** PGN games where `player` (case-insensitive) took part; others are skipped. */
export function fromPgn(games: PgnGame[], player: string): PlayerGame[] {
  const me = player.trim().toLowerCase();
  const out: PlayerGame[] = [];
  for (const g of games) {
    const white = (g.headers.White ?? '').toLowerCase();
    const black = (g.headers.Black ?? '').toLowerCase();
    const color: Color | undefined = white === me ? 'white' : black === me ? 'black' : undefined;
    if (!color) continue;
    const outcome = outcomeFromResult(g.headers.Result, color);
    if (!outcome) continue;
    out.push({
      color,
      outcome,
      moves: g.moves,
      opponent: (color === 'white' ? g.headers.Black : g.headers.White) ?? '?',
      url: g.headers.Site?.startsWith('http') ? g.headers.Site : undefined,
    });
  }
  return out;
}

// ---------- Lichess ----------

export function fromLichess(games: LichessGame[], username: string): PlayerGame[] {
  const me = username.toLowerCase();
  return games
    .filter((g) => g.variant === 'standard' && g.moves)
    .flatMap((g): PlayerGame[] => {
      const color: Color = g.players.white.user?.name.toLowerCase() === me ? 'white' : 'black';
      const opp = g.players[color === 'white' ? 'black' : 'white'];
      const outcome: Outcome = !g.winner ? 'draw' : g.winner === color ? 'win' : 'loss';
      return [
        {
          color,
          outcome,
          moves: g.moves.split(' '),
          opponent: opp.user?.name ?? 'Anonymous',
          speed: g.speed,
          url: `https://lichess.org/${g.id}`,
        },
      ];
    });
}

// ---------- Chess.com ----------

export function fromChessCom(games: ChessComGame[], username: string): PlayerGame[] {
  const me = username.toLowerCase();
  return games.map((g) => {
    const color: Color = g.white.username.toLowerCase() === me ? 'white' : 'black';
    return {
      color,
      outcome: chessComOutcome(g[color].result),
      moves: parsePgn(g.pgn ?? '')[0]?.moves ?? [],
      opponent: g[color === 'white' ? 'black' : 'white'].username,
      speed: g.time_class,
      url: g.url,
    };
  });
}

// ---------- Aggregation ----------

export interface OpeningStats {
  /** Display name (full variation or family, depending on grouping). */
  name: string;
  eco: string;
  color: Color;
  /** A representative named line, for loading on the board. */
  line: Opening | undefined;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  /** (wins + draws / 2) / games, 0..1 */
  score: number;
  examples: PlayerGame[];
}

export type Grouping = 'family' | 'variation';

export function aggregate(book: OpeningBook, games: PlayerGame[], grouping: Grouping): OpeningStats[] {
  const groups = new Map<string, OpeningStats>();
  for (const game of games) {
    const c = book.classifyMoves(game.moves);
    const fullName = c?.opening.name ?? 'Unknown opening';
    const name = grouping === 'family' ? openingFamily(fullName) : fullName;
    const key = `${game.color}|${name}`;
    let s = groups.get(key);
    if (!s) {
      s = {
        name,
        eco: c?.opening.eco ?? '',
        color: game.color,
        line: c?.opening,
        games: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        score: 0,
        examples: [],
      };
      groups.set(key, s);
    }
    // For families, prefer the shortest line as the representative one.
    if (c && (!s.line || c.opening.uci.length < s.line.uci.length)) {
      s.line = c.opening;
      s.eco = c.opening.eco;
    }
    s.games++;
    if (game.outcome === 'win') s.wins++;
    else if (game.outcome === 'draw') s.draws++;
    else s.losses++;
    if (s.examples.length < 5) s.examples.push(game);
  }
  for (const s of groups.values()) s.score = (s.wins + s.draws / 2) / s.games;
  return [...groups.values()].sort((a, b) => b.games - a.games || a.name.localeCompare(b.name));
}
