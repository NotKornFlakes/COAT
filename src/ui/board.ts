// A small, dependency-free interactive chessboard: click-to-move and
// drag-and-drop, legal-move hints, last-move highlight, promotion picker.

import { Chess, type Square, type PieceSymbol, type Color } from 'chess.js';

const FILES = 'abcdefgh';
// Filled glyphs for both colours (styled via CSS); U+FE0E forces text, not emoji.
const GLYPH: Record<PieceSymbol, string> = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
const VS = '︎';

export interface BoardOptions {
  /** Called with a legal move in UCI notation. */
  onMove: (uci: string) => void;
}

export class Board {
  readonly el: HTMLElement;
  private fen = new Chess().fen();
  private orientation: Color = 'w';
  private lastMove: [string, string] | null = null;
  private selected: Square | null = null;
  private squares = new Map<Square, HTMLElement>();
  private drag: { from: Square; ghost: HTMLElement; startX: number; startY: number; moved: boolean } | null = null;
  private promo: HTMLElement | null = null;

  constructor(
    container: HTMLElement,
    private opts: BoardOptions,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'board';
    this.el.setAttribute('role', 'grid');
    this.el.setAttribute('aria-label', 'Chessboard');
    container.append(this.el);
    this.el.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    window.addEventListener('pointermove', (e) => this.onPointerMove(e));
    window.addEventListener('pointerup', (e) => this.onPointerUp(e));
    this.el.addEventListener('keydown', (e) => this.onKey(e));
    this.build();
  }

  set(fen: string, lastMove?: string) {
    this.fen = fen;
    this.lastMove = lastMove ? [lastMove.slice(0, 2), lastMove.slice(2, 4)] : null;
    this.selected = null;
    this.closePromotion();
    this.render();
  }

  flip() {
    this.orientation = this.orientation === 'w' ? 'b' : 'w';
    this.build();
  }

  get flipped() {
    return this.orientation === 'b';
  }

  private build() {
    this.el.replaceChildren();
    this.squares.clear();
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const file = this.orientation === 'w' ? f : 7 - f;
        const rank = this.orientation === 'w' ? 7 - r : r;
        const sq = (FILES[file] + (rank + 1)) as Square;
        const cell = document.createElement('div');
        cell.className = `sq ${(file + rank) % 2 ? 'light' : 'dark'}`;
        cell.dataset.sq = sq;
        cell.setAttribute('role', 'gridcell');
        cell.tabIndex = r === 7 && f === 0 ? 0 : -1;
        if (f === 0) cell.dataset.rank = String(rank + 1);
        if (r === 7) cell.dataset.file = FILES[file];
        this.squares.set(sq, cell);
        this.el.append(cell);
      }
    }
    this.render();
  }

  private render() {
    const chess = new Chess(this.fen);
    const targets = new Set(
      this.selected ? chess.moves({ square: this.selected, verbose: true }).map((m) => m.to) : [],
    );
    const checkSq = chess.inCheck()
      ? chess.findPiece({ type: 'k', color: chess.turn() })[0]
      : undefined;
    for (const [sq, cell] of this.squares) {
      const piece = chess.get(sq);
      cell.textContent = piece ? GLYPH[piece.type] + VS : '';
      cell.classList.toggle('pw', piece?.color === 'w');
      cell.classList.toggle('pb', piece?.color === 'b');
      cell.classList.toggle('last', !!this.lastMove?.includes(sq));
      cell.classList.toggle('selected', sq === this.selected);
      cell.classList.toggle('target', targets.has(sq));
      cell.classList.toggle('capture', targets.has(sq) && !!piece);
      cell.classList.toggle('check', sq === checkSq);
      const name = piece ? `${piece.color === 'w' ? 'white' : 'black'} ${pieceName(piece.type)}` : 'empty';
      cell.setAttribute('aria-label', `${sq}, ${name}`);
    }
  }

  private squareAt(x: number, y: number): Square | null {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('.sq');
    return el && this.el.contains(el) ? (el.dataset.sq as Square) : null;
  }

  private ownPiece(sq: Square): boolean {
    const chess = new Chess(this.fen);
    return chess.get(sq)?.color === chess.turn();
  }

  private onPointerDown(e: PointerEvent) {
    if (e.button !== 0 || this.promo) return;
    const sq = this.squareAt(e.clientX, e.clientY);
    if (!sq) return;
    if (this.selected && this.selected !== sq && !this.ownPiece(sq)) {
      this.tryMove(this.selected, sq);
      return;
    }
    if (!this.ownPiece(sq)) {
      this.selected = null;
      this.render();
      return;
    }
    e.preventDefault();
    this.selected = sq;
    this.render();
    const cell = this.squares.get(sq)!;
    const ghost = document.createElement('div');
    ghost.className = `ghost ${cell.classList.contains('pw') ? 'pw' : 'pb'}`;
    ghost.textContent = cell.textContent;
    ghost.style.width = ghost.style.height = `${cell.offsetWidth}px`;
    ghost.style.fontSize = getComputedStyle(cell).fontSize;
    this.drag = { from: sq, ghost, startX: e.clientX, startY: e.clientY, moved: false };
  }

  private onPointerMove(e: PointerEvent) {
    const d = this.drag;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 4) return;
    if (!d.moved) {
      d.moved = true;
      document.body.append(d.ghost);
      this.squares.get(d.from)!.classList.add('dragging');
    }
    const half = d.ghost.offsetWidth / 2;
    d.ghost.style.transform = `translate(${e.clientX - half}px, ${e.clientY - half}px)`;
  }

  private onPointerUp(e: PointerEvent) {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    d.ghost.remove();
    this.squares.get(d.from)?.classList.remove('dragging');
    if (!d.moved) return; // a click: keep the selection for click-to-move
    const to = this.squareAt(e.clientX, e.clientY);
    if (to && to !== d.from) this.tryMove(d.from, to);
  }

  /** Arrow keys move focus between squares; Enter/Space selects or moves. */
  private onKey(e: KeyboardEvent) {
    const cell = (e.target as HTMLElement).closest<HTMLElement>('.sq');
    if (!cell) return;
    const cells = [...this.squares.values()];
    const i = cells.indexOf(cell);
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -8, ArrowDown: 8 };
    if (e.key in step) {
      const j = i + step[e.key];
      if (j >= 0 && j < 64) {
        e.preventDefault();
        e.stopPropagation();
        cell.tabIndex = -1;
        cells[j].tabIndex = 0;
        cells[j].focus();
      }
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const sq = cell.dataset.sq as Square;
      if (this.selected && this.selected !== sq && !this.ownPiece(sq)) this.tryMove(this.selected, sq);
      else {
        this.selected = this.ownPiece(sq) ? sq : null;
        this.render();
      }
    } else if (e.key === 'Escape') {
      this.selected = null;
      this.render();
    }
  }

  private tryMove(from: Square, to: Square) {
    const chess = new Chess(this.fen);
    const legal = chess.moves({ square: from, verbose: true }).filter((m) => m.to === to);
    this.selected = null;
    if (!legal.length) {
      this.render();
      return;
    }
    if (legal.some((m) => m.promotion)) {
      this.render();
      this.askPromotion(to, chess.turn(), (p) => this.opts.onMove(from + to + p));
      return;
    }
    this.opts.onMove(from + to);
  }

  private askPromotion(to: Square, color: Color, done: (piece: string) => void) {
    const promo = document.createElement('div');
    promo.className = 'promotion';
    promo.setAttribute('role', 'dialog');
    promo.setAttribute('aria-label', 'Choose promotion piece');
    for (const p of ['q', 'r', 'b', 'n'] as PieceSymbol[]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = color === 'w' ? 'pw' : 'pb';
      b.textContent = GLYPH[p] + VS;
      b.setAttribute('aria-label', pieceName(p));
      b.addEventListener('click', () => {
        this.closePromotion();
        done(p);
      });
      promo.append(b);
    }
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'cancel';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => this.closePromotion());
    promo.append(cancel);
    const cell = this.squares.get(to)!;
    promo.style.left = `${cell.offsetLeft}px`;
    this.el.append(promo);
    this.promo = promo;
    (promo.firstElementChild as HTMLElement).focus();
  }

  private closePromotion() {
    this.promo?.remove();
    this.promo = null;
  }
}

function pieceName(p: PieceSymbol): string {
  return { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' }[p];
}
