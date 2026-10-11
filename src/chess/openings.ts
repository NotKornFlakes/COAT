import { Chess } from 'chess.js';

/** One named opening from the Lichess chess-openings dataset. */
export interface Opening {
  index: number;
  eco: string;
  name: string;
  /** Moves in UCI notation from the start position. */
  uci: string[];
  /** Same moves in SAN. */
  san: string[];
}

/** A "book" move: a move from a position that some named line continues with. */
export interface BookMove {
  san: string;
  uci: string;
  /** Position key after the move. */
  to: string;
  /** The shortest (most general) named line passing through this move. */
  line: Opening;
}

/** Shape of src/data/openings.json, produced by scripts/build-openings.mjs. */
export interface OpeningData {
  keys: string[];
  openings: [eco: string, name: string, uci: string, san: string, positions: number[]][];
}

export interface Classification {
  opening: Opening;
  /** Ply (1-based) at which the named position was reached. */
  ply: number;
}

/**
 * Position key: FEN without the half-move and full-move counters, so the same
 * position reached by different move orders (transpositions) shares a key.
 */
export function positionKey(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ');
}

export function isUci(move: string): boolean {
  return /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move);
}

export function uciToMove(uci: string): { from: string; to: string; promotion?: string } {
  return {
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promotion: uci.length > 4 ? uci[4] : undefined,
  };
}

export class OpeningBook {
  readonly openings: Opening[] = [];
  private byPosition = new Map<string, Opening>();
  private children = new Map<string, Map<string, BookMove>>();

  constructor(data: OpeningData) {
    const { keys } = data;
    data.openings.forEach(([eco, name, uciStr, sanStr, positions], index) => {
      const uci = uciStr.split(' ');
      const san = sanStr.split(' ');
      const opening: Opening = { index, eco, name, uci, san };
      let key = keys[0];

      uci.forEach((u, i) => {
        const next = keys[positions[i]];
        let edges = this.children.get(key);
        if (!edges) this.children.set(key, (edges = new Map()));
        const existing = edges.get(u);
        if (!existing) {
          edges.set(u, { san: san[i], uci: u, to: next, line: opening });
        } else if (uci.length < existing.line.uci.length) {
          existing.line = opening;
        }
        key = next;
      });

      // Several dataset entries can share a final position; keep the first
      // (the broader name comes first in the dataset).
      if (!this.byPosition.has(key)) this.byPosition.set(key, opening);
      this.openings.push(opening);
    });
  }

  /** The named opening for exactly this position, if any. */
  lookup(fen: string): Opening | undefined {
    return this.byPosition.get(positionKey(fen));
  }

  /** Whether any named line passes through this position. */
  inBook(fen: string): boolean {
    const key = positionKey(fen);
    return this.children.has(key) || this.byPosition.has(key);
  }

  /** Book continuations from this position, most general lines first. */
  continuations(fen: string): BookMove[] {
    const edges = this.children.get(positionKey(fen));
    if (!edges) return [];
    return [...edges.values()].sort(
      (a, b) => a.line.uci.length - b.line.uci.length || a.line.name.localeCompare(b.line.name),
    );
  }

  /**
   * Classifies a sequence of positions (FENs after each move): the deepest
   * position that matches a named opening wins. Transposition-aware, since
   * it looks up positions, not move orders.
   */
  classifyFens(fens: string[]): Classification | undefined {
    let best: Classification | undefined;
    fens.forEach((fen, i) => {
      const o = this.byPosition.get(positionKey(fen));
      if (o) best = { opening: o, ply: i + 1 };
    });
    return best;
  }

  /**
   * Classifies a game given as SAN or UCI moves from the start position.
   * Stops replaying once the game has been out of book for `outOfBookPlies`
   * consecutive plies, which keeps bulk game imports fast.
   */
  classifyMoves(moves: string[], outOfBookPlies = 8): Classification | undefined {
    const chess = new Chess();
    let best: Classification | undefined;
    let miss = 0;
    for (let i = 0; i < moves.length && miss < outOfBookPlies; i++) {
      try {
        chess.move(isUci(moves[i]) ? uciToMove(moves[i]) : moves[i]);
      } catch {
        break;
      }
      const fen = chess.fen();
      const o = this.lookup(fen);
      if (o) best = { opening: o, ply: i + 1 };
      miss = this.inBook(fen) ? 0 : miss + 1;
    }
    return best;
  }

  /** Case-insensitive search over name and ECO code (all words must match). */
  search(query: string, limit = 60): Opening[] {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    const results: Opening[] = [];
    for (const o of this.openings) {
      const hay = `${o.eco} ${o.name}`.toLowerCase();
      if (terms.every((t) => hay.includes(t))) {
        results.push(o);
        if (results.length >= limit) break;
      }
    }
    return results;
  }
}

/** "Sicilian Defense: Najdorf Variation" -> "Sicilian Defense" */
export function openingFamily(name: string): string {
  return name.split(':')[0].trim();
}
