import { describe, expect, it } from 'vitest';
import { LocalEngine, parseInfo, type Analysis, type WorkerLike } from '../src/engine/stockfish';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';

describe('parseInfo', () => {
  it('parses depth, multipv, score and pv', () => {
    const i = parseInfo('info depth 12 seldepth 18 multipv 2 score cp -35 nodes 1000 nps 50000 hashfull 3 time 20 pv e7e5 g1f3 b8c6');
    expect(i).toEqual({ depth: 12, multipv: 2, cp: -35, nodes: 1000, nps: 50000, pv: ['e7e5', 'g1f3', 'b8c6'] });
  });

  it('parses mate scores', () => {
    expect(parseInfo('info depth 5 multipv 1 score mate -2 pv e1e2')?.mate).toBe(-2);
  });

  it('ignores bound scores, currmove lines and strings', () => {
    expect(parseInfo('info depth 10 multipv 1 score cp 20 lowerbound pv e2e4')).toBeNull();
    expect(parseInfo('info depth 10 currmove e2e4 currmovenumber 1')).toBeNull();
    expect(parseInfo('info string NNUE evaluation enabled')).toBeNull();
    expect(parseInfo('bestmove e2e4')).toBeNull();
  });
});

/** A scripted stand-in for the Stockfish worker. */
class FakeWorker implements WorkerLike {
  onmessage: ((e: MessageEvent<string>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  sent: string[] = [];
  postMessage(m: string) {
    this.sent.push(m);
    queueMicrotask(() => {
      if (m === 'uci') this.say('id name Stockfish 19', 'uciok');
      if (m === 'isready') this.say('readyok');
    });
  }
  terminate() {}
  say(...lines: string[]) {
    for (const l of lines) this.onmessage?.({ data: l } as MessageEvent<string>);
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('LocalEngine', () => {
  it('initialises, searches, and reports scores from White’s side', async () => {
    const w = new FakeWorker();
    const engine = new LocalEngine({ multiPv: 2, depth: 10, createWorker: () => w });
    const updates: Analysis[] = [];
    await engine.analyze(AFTER_E4, (a) => updates.push(a));
    expect(w.sent).toEqual([
      'uci',
      'setoption name Hash value 32',
      'setoption name MultiPV value 2',
      'isready',
      `position fen ${AFTER_E4}`,
      'go depth 10',
    ]);
    // Black to move: +30 for Black means -30 from White's side.
    w.say(
      'info depth 1 multipv 1 score cp 30 pv c7c5',
      'info depth 1 multipv 2 score cp 20 pv e7e5',
      'info depth 2 multipv 1 score cp 25 nps 9000 pv c7c5 g1f3',
    );
    expect(updates).toHaveLength(1); // depth 2 is not complete yet
    expect(updates[0].lines.map((l) => [l.cp, l.san[0]])).toEqual([
      [-30, 'c5'],
      [-20, 'e5'],
    ]);
    w.say('info depth 2 multipv 2 score mate 3 pv e7e5', 'bestmove c7c5');
    expect(updates.at(-1)).toMatchObject({ depth: 2, done: true, nps: 9000 });
    expect(updates.at(-1)!.lines[1].mate).toBe(-3);
  });

  it('stops the old search and ignores its output when the position changes', async () => {
    const w = new FakeWorker();
    const engine = new LocalEngine({ multiPv: 1, depth: 10, createWorker: () => w });
    const first: Analysis[] = [];
    const second: Analysis[] = [];
    await engine.analyze(START, (a) => first.push(a));
    w.say('info depth 1 multipv 1 score cp 20 pv e2e4');
    await engine.analyze(AFTER_E4, (a) => second.push(a));
    expect(w.sent.at(-1)).toBe('stop');
    // Late output from the stopped search must not leak into either callback.
    w.say('info depth 2 multipv 1 score cp 22 pv d2d4', 'bestmove d2d4');
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
    expect(w.sent.slice(-2)).toEqual([`position fen ${AFTER_E4}`, 'go depth 10']);
    w.say('info depth 1 multipv 1 score cp -10 pv e7e5');
    expect(second[0].lines[0]).toMatchObject({ cp: 10, san: ['e5'] });
  });

  it('only runs the latest of several quick requests', async () => {
    const w = new FakeWorker();
    const engine = new LocalEngine({ multiPv: 1, createWorker: () => w });
    await engine.analyze(START, () => {});
    await engine.analyze(AFTER_E4, () => {});
    await engine.analyze(START, () => {});
    expect(w.sent.filter((m) => m === 'stop')).toHaveLength(1);
    w.say('bestmove e2e4');
    await tick();
    expect(w.sent.filter((m) => m.startsWith('position')).at(-1)).toBe(`position fen ${START}`);
    expect(w.sent.filter((m) => m.startsWith('position'))).toHaveLength(2);
  });

  it('rejects when the engine fails to load', async () => {
    const engine = new LocalEngine({
      createWorker: () => {
        throw new Error('no wasm');
      },
    });
    await expect(engine.analyze(START, () => {})).rejects.toThrow('no wasm');
  });
});
