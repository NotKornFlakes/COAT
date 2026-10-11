// Runs Stockfish (WebAssembly, GPL-3.0, see public/engine/) in a Web Worker
// and talks to it over the UCI text protocol.

import { Chess } from 'chess.js';
import { uciLineToSan, type EvalLine } from '../api/lichess';

export const ENGINE_FILE = 'engine/stockfish-19-lite-single.js';
export const ENGINE_NAME = 'Stockfish 19';

export interface InfoLine {
  depth: number;
  multipv: number;
  /** Score from the side to move's point of view. */
  cp?: number;
  mate?: number;
  nodes?: number;
  nps?: number;
  pv: string[];
}

/**
 * Parses a UCI "info" line. Returns null for lines without a principal
 * variation and for bound-only scores (lowerbound / upperbound), which are
 * provisional and make the display jump around.
 */
export function parseInfo(line: string): InfoLine | null {
  if (!line.startsWith('info ') || line.includes(' lowerbound') || line.includes(' upperbound')) return null;
  const t = line.split(' ');
  const info: InfoLine = { depth: 0, multipv: 1, pv: [] };
  let hasScore = false;
  for (let i = 1; i < t.length; i++) {
    switch (t[i]) {
      case 'depth':
        info.depth = Number(t[++i]);
        break;
      case 'multipv':
        info.multipv = Number(t[++i]);
        break;
      case 'nodes':
        info.nodes = Number(t[++i]);
        break;
      case 'nps':
        info.nps = Number(t[++i]);
        break;
      case 'score':
        if (t[i + 1] === 'cp') info.cp = Number(t[i + 2]);
        else if (t[i + 1] === 'mate') info.mate = Number(t[i + 2]);
        hasScore = true;
        i += 2;
        break;
      case 'pv':
        info.pv = t.slice(i + 1).filter(Boolean);
        i = t.length;
        break;
    }
  }
  return hasScore && info.pv.length && info.depth ? info : null;
}

export interface Analysis {
  fen: string;
  depth: number;
  maxDepth: number;
  /** Scores from White's point of view, best line first. */
  lines: EvalLine[];
  nps?: number;
  /** True once the search has reached its target depth. */
  done: boolean;
}

/** The parts of a Worker the engine uses (so tests can pass a fake). */
export interface WorkerLike {
  postMessage(message: string): void;
  terminate(): void;
  onmessage: ((e: MessageEvent<string>) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
}

export interface EngineOptions {
  multiPv?: number;
  depth?: number;
  hashMb?: number;
  createWorker?: () => WorkerLike;
}

type Search = { fen: string; onUpdate: (a: Analysis) => void; expected: number };

export class LocalEngine {
  private worker: WorkerLike | null = null;
  private ready: Promise<void> | null = null;
  private resolveReady: (() => void) | null = null;
  private rejectReady: ((e: Error) => void) | null = null;
  /** 'stopping' means a "stop" was sent and the old search's bestmove is still due. */
  private state: 'idle' | 'searching' | 'stopping' = 'idle';
  private current: Search | null = null;
  private pending: Search | null = null;
  private lines = new Map<number, InfoLine>();
  private depth = 0;
  readonly multiPv: number;
  readonly maxDepth: number;
  private readonly hashMb: number;
  private readonly createWorker: () => WorkerLike;

  constructor(opts: EngineOptions = {}) {
    this.multiPv = opts.multiPv ?? 3;
    this.maxDepth = opts.depth ?? 20;
    this.hashMb = opts.hashMb ?? 32;
    this.createWorker =
      opts.createWorker ?? (() => new Worker(new URL(ENGINE_FILE, document.baseURI)) as unknown as WorkerLike);
  }

  /** Loads the engine (once). Resolves when it is ready for commands. */
  start(): Promise<void> {
    if (this.ready) return this.ready;
    const ready = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.ready = ready;
    try {
      const w = this.createWorker();
      this.worker = w;
      w.onmessage = (e) => this.onLine(String(e.data));
      w.onerror = (e) => this.fail(new Error(e.message || 'The engine failed to load.'));
      w.postMessage('uci');
    } catch (e) {
      this.fail(e as Error);
    }
    // After a failure `this.ready` is cleared so a later call can retry.
    return ready;
  }

  /**
   * Analyses a position, replacing any running search. `onUpdate` is called
   * each time a full set of lines is available at a new depth.
   */
  async analyze(fen: string, onUpdate: (a: Analysis) => void): Promise<void> {
    const legal = new Chess(fen).moves().length;
    const search: Search = { fen, onUpdate, expected: Math.min(this.multiPv, legal) };
    await this.start();
    if (!legal) return;
    if (this.state === 'idle') {
      this.begin(search);
    } else {
      this.pending = search;
      if (this.state === 'searching') {
        this.state = 'stopping';
        this.worker!.postMessage('stop');
      }
    }
  }

  /** Stops the current search (the last result stays where it was). */
  stop() {
    this.pending = null;
    if (this.state === 'searching') {
      this.state = 'stopping';
      this.worker?.postMessage('stop');
    }
  }

  terminate() {
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
    this.state = 'idle';
    this.current = this.pending = null;
  }

  private fail(err: Error) {
    this.rejectReady?.(err);
    this.terminate();
  }

  private begin(search: Search) {
    this.current = search;
    this.state = 'searching';
    this.lines.clear();
    this.depth = 0;
    this.worker!.postMessage(`position fen ${search.fen}`);
    this.worker!.postMessage(`go depth ${this.maxDepth}`);
  }

  private onLine(line: string) {
    if (line === 'uciok') {
      const w = this.worker!;
      w.postMessage(`setoption name Hash value ${this.hashMb}`);
      w.postMessage(`setoption name MultiPV value ${this.multiPv}`);
      w.postMessage('isready');
    } else if (line === 'readyok') {
      this.resolveReady?.();
      this.resolveReady = this.rejectReady = null;
    } else if (line.startsWith('bestmove')) {
      const finished = this.state === 'searching' ? this.current : null;
      this.state = 'idle';
      if (finished) this.emit(finished, true);
      const next = this.pending;
      this.pending = null;
      if (next) this.begin(next);
    } else if (this.state === 'searching' && this.current) {
      const info = parseInfo(line);
      if (!info) return;
      if (info.depth > this.depth && info.multipv === 1) {
        this.depth = info.depth;
        this.lines.clear();
      }
      if (info.depth !== this.depth) return;
      this.lines.set(info.multipv, info);
      if (this.lines.size >= this.current.expected) this.emit(this.current, false);
    }
  }

  private emit(search: Search, done: boolean) {
    if (!this.lines.size) return;
    const whiteToMove = search.fen.split(' ')[1] === 'w';
    const sign = whiteToMove ? 1 : -1;
    const infos = [...this.lines.values()].sort((a, b) => a.multipv - b.multipv);
    search.onUpdate({
      fen: search.fen,
      depth: this.depth,
      maxDepth: this.maxDepth,
      done,
      nps: infos[0].nps,
      lines: infos.map((i) => ({
        cp: i.cp === undefined ? undefined : i.cp * sign,
        mate: i.mate === undefined ? undefined : i.mate * sign,
        ...uciLineToSan(search.fen, i.pv, 10),
      })),
    });
  }
}
