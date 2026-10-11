// Converts the Lichess chess-openings TSV files (CC0) in data/chess-openings
// into the compact, pre-indexed JSON file the app bundles (src/data/openings.json).
//
// Positions are computed here, at build time, so the browser never has to
// replay ~30k moves on startup.
//
// Output shape:
//   {
//     keys: string[],                       // unique position keys (FEN without move counters)
//     openings: [eco, name, uci, san, posIdx][]
//        uci/san: space-separated moves; posIdx: index into keys for the
//        position after each move
//   }
//
// Usage: npm run openings
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Chess } from 'chess.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const keys = [];
const keyIndex = new Map();
const openings = [];

const positionKey = (fen) => fen.split(' ').slice(0, 4).join(' ');
const indexOf = (key) => {
  let i = keyIndex.get(key);
  if (i === undefined) {
    i = keys.length;
    keys.push(key);
    keyIndex.set(key, i);
  }
  return i;
};

indexOf(positionKey(new Chess().fen())); // start position is always key 0

for (const letter of ['a', 'b', 'c', 'd', 'e']) {
  const lines = readFileSync(join(root, 'data/chess-openings', `${letter}.tsv`), 'utf8')
    .split('\n')
    .slice(1)
    .filter((l) => l.trim());
  for (const line of lines) {
    const [eco, name, pgn] = line.split('\t');
    const chess = new Chess();
    const sans = pgn.replace(/\d+\.(\.\.)?/g, ' ').trim().split(/\s+/);
    const uci = [];
    const pos = [];
    for (const san of sans) {
      const m = chess.move(san);
      uci.push(m.from + m.to + (m.promotion ?? ''));
      pos.push(indexOf(positionKey(chess.fen())));
    }
    openings.push([eco, name, uci.join(' '), sans.join(' '), pos]);
  }
}

writeFileSync(join(root, 'src/data/openings.json'), JSON.stringify({ keys, openings }));
console.log(`Wrote ${openings.length} openings / ${keys.length} positions to src/data/openings.json`);
