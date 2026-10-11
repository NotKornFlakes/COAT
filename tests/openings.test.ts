import { describe, expect, it } from 'vitest';
import raw from '../src/data/openings.json';
import { OpeningBook, OpeningData, openingFamily } from '../src/chess/openings';

const book = new OpeningBook(raw as OpeningData);

describe('OpeningBook', () => {
  it('loads the whole dataset', () => {
    expect(book.openings.length).toBeGreaterThan(3000);
  });

  it('classifies the Ruy Lopez from SAN moves', () => {
    const r = book.classifyMoves(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']);
    expect(r?.opening.name).toBe('Ruy Lopez');
    expect(r?.opening.eco).toBe('C60');
  });

  it('classifies from UCI moves and keeps the deepest match', () => {
    const r = book.classifyMoves('e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 a7a6 h2h3 h7h6'.split(' '));
    expect(r?.opening.name).toMatch(/^Sicilian Defense: Najdorf Variation/);
  });

  it('recognises transpositions', () => {
    // Queen's Gambit Declined reached via 1.c4 move order.
    const r = book.classifyMoves(['c4', 'e6', 'Nc3', 'd5', 'd4']);
    expect(r?.opening.name).toMatch(/Queen's Gambit Declined/);
  });

  it('lists book continuations from the start position', () => {
    const moves = book.continuations('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    const sans = moves.map((m) => m.san);
    expect(sans).toEqual(expect.arrayContaining(['e4', 'd4', 'c4', 'Nf3']));
    expect(moves.find((m) => m.san === 'e4')?.line.name).toBe("King's Pawn Game");
  });

  it('searches by name and ECO', () => {
    expect(book.search('najdorf').length).toBeGreaterThan(3);
    expect(book.search('C60')[0].eco).toBe('C60');
    expect(book.search('')).toEqual([]);
  });

  it('extracts the opening family', () => {
    expect(openingFamily('Sicilian Defense: Najdorf Variation, English Attack')).toBe('Sicilian Defense');
  });
});
