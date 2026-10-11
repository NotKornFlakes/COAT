import { describe, expect, it } from 'vitest';
import raw from '../src/data/openings.json';
import { OpeningBook, OpeningData } from '../src/chess/openings';
import { aggregate, fromChessCom, fromLichess, fromPgn, parsePgn, sanTokens } from '../src/analysis/games';
import { chessComOutcome } from '../src/api/chesscom';
import { parseNdjson, uciLineToSan, type LichessGame } from '../src/api/lichess';

const book = new OpeningBook(raw as OpeningData);
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const PGN = `[Event "Club"]
[White "Alice"]
[Black "Bob"]
[Result "1-0"]

1. e4 {best by test} e5 2. Nf3 Nc6 (2... d6 3. d4) 3. Bb5 $1 a6 4. Ba4 Nf6 1-0

[Event "Club"]
[White "Carol"]
[Black "alice"]
[Result "1/2-1/2"]

1. d4 d5 2. c4 e6 3. Nc3 Nf6 1/2-1/2

[Event "Club"]
[White "Dan"]
[Black "Eve"]
[Result "0-1"]

1. e4 c5 0-1
`;

describe('PGN parsing', () => {
  it('strips comments, variations, NAGs and results', () => {
    expect(sanTokens('1. e4 {c} e5 (1... c5 (1... e6)) 2. Nf3!? $2 Nc6 1-0')).toEqual(['e4', 'e5', 'Nf3', 'Nc6']);
  });

  it('splits multi-game files', () => {
    const games = parsePgn(PGN);
    expect(games).toHaveLength(3);
    expect(games[0].headers.White).toBe('Alice');
    expect(games[0].moves).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6']);
  });

  it('keeps only the named player games, with colour and outcome', () => {
    const games = fromPgn(parsePgn(PGN), 'ALICE');
    expect(games.map((g) => [g.color, g.outcome])).toEqual([
      ['white', 'win'],
      ['black', 'draw'],
    ]);
  });
});

describe('aggregation', () => {
  it('groups by family and variation with scores', () => {
    const games = fromPgn(parsePgn(PGN), 'alice');
    const fam = aggregate(book, games, 'family');
    const ruy = fam.find((s) => s.name === 'Ruy Lopez')!;
    expect(ruy).toMatchObject({ color: 'white', games: 1, wins: 1, score: 1 });
    expect(ruy.line?.name).toMatch(/^Ruy Lopez/);
    const qgd = fam.find((s) => s.color === 'black')!;
    expect(qgd.name).toBe("Queen's Gambit Declined");
    expect(qgd.score).toBe(0.5);

    const vars = aggregate(book, games, 'variation');
    expect(vars.find((s) => s.color === 'white')!.name).toMatch(/^Ruy Lopez: /);
  });
});

describe('sources', () => {
  it('normalises Lichess ndjson exports', () => {
    const text =
      JSON.stringify({
        id: 'abc',
        variant: 'standard',
        speed: 'blitz',
        rated: true,
        status: 'mate',
        winner: 'black',
        players: { white: { user: { name: 'Foo' } }, black: { user: { name: 'Me' } } },
        moves: 'e4 c5 Nf3 d6',
      }) + '\n\n';
    const [g] = fromLichess(parseNdjson<LichessGame>(text), 'me');
    expect(g).toMatchObject({ color: 'black', outcome: 'win', opponent: 'Foo', url: 'https://lichess.org/abc' });
  });

  it('maps chess.com result codes', () => {
    expect(chessComOutcome('win')).toBe('win');
    expect(chessComOutcome('repetition')).toBe('draw');
    expect(chessComOutcome('timeout')).toBe('loss');
    const [g] = fromChessCom(
      [
        {
          url: 'u',
          rules: 'chess',
          time_class: 'rapid',
          rated: true,
          pgn: '[White "Me"]\n[Black "X"]\n\n1. e4 {[%clk 0:09:58]} 1... e5 1-0',
          white: { username: 'Me', rating: 1, result: 'win' },
          black: { username: 'X', rating: 1, result: 'checkmated' },
        },
      ],
      'me',
    );
    expect(g).toMatchObject({ color: 'white', outcome: 'win', moves: ['e4', 'e5'] });
  });

  it('converts Lichess king-to-rook castling in eval lines', () => {
    const fen = 'r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3';
    const line = uciLineToSan(fen, 'g8f6 e1h1 f6e4'.split(' '));
    expect(line.san).toEqual(['Nf6', 'O-O', 'Nxe4']);
    expect(line.uci[1]).toBe('e1g1');
    expect(uciLineToSan(START, ['e2e4', 'zzzz']).san).toEqual(['e4']);
  });
});
