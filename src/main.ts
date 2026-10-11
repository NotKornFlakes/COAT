import './styles.css';
import { Chess } from 'chess.js';
import data from './data/openings.json';
import { OpeningBook, uciToMove, type Opening, type OpeningData } from './chess/openings';
import { Board } from './ui/board';
import { formatCount, formatEval, h, resultBar, storage } from './ui/dom';
import { cloudEval, explorer, ApiError, lichessUserGames, type ExplorerDb } from './api/lichess';
import { chessComUserGames } from './api/chesscom';
import {
  aggregate,
  fromChessCom,
  fromLichess,
  fromPgn,
  parsePgn,
  sanTokens,
  type Color,
  type Grouping,
  type OpeningStats,
  type PlayerGame,
} from './analysis/games';

const book = new OpeningBook(data as OpeningData);
const START = new Chess().fen();

// ---------------------------------------------------------------- state

interface Ply {
  san: string;
  uci: string;
  fen: string;
}

let rootFen = START;
let line: Ply[] = [];
let cursor = 0;

const fenAt = (i: number) => (i === 0 ? rootFen : line[i - 1].fen);
const currentFen = () => fenAt(cursor);

/** Full-move label for a ply index (0-based from root). */
function moveNumber(fen: string): { n: number; white: boolean } {
  const parts = fen.split(' ');
  return { n: Number(parts[5]), white: parts[1] === 'w' };
}

function play(uci: string) {
  if (line[cursor]?.uci === uci) {
    cursor++;
  } else {
    const chess = new Chess(currentFen());
    let move;
    try {
      move = chess.move(uciToMove(uci));
    } catch {
      return;
    }
    line = line.slice(0, cursor);
    line.push({ san: move.san, uci: move.from + move.to + (move.promotion ?? ''), fen: chess.fen() });
    cursor++;
  }
  update();
}

/** Replaces the line with moves from `fen` (UCI or SAN) and jumps to the end. */
function loadMoves(moves: string[], fen = START, at = moves.length) {
  const chess = new Chess(fen);
  const plies: Ply[] = [];
  for (const m of moves) {
    try {
      const mv = chess.move(/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(m) ? uciToMove(m) : m);
      plies.push({ san: mv.san, uci: mv.from + mv.to + (mv.promotion ?? ''), fen: chess.fen() });
    } catch {
      break;
    }
  }
  rootFen = fen;
  line = plies;
  cursor = Math.min(at, plies.length);
  update();
}

function goTo(i: number) {
  cursor = Math.max(0, Math.min(line.length, i));
  update();
}

// ---------------------------------------------------------------- layout

const app = document.getElementById('app')!;

const boardHost = h('div', { class: 'board-host' });
const evalFill = h('div', { class: 'evalbar-fill' });
const evalBar = h('div', { class: 'evalbar', 'aria-hidden': 'true' }, evalFill);
const board = new Board(boardHost, { onMove: play });

const navBtn = (label: string, title: string, fn: () => void) =>
  h('button', { type: 'button', class: 'nav', title, 'aria-label': title, onclick: fn }, label);

const moveList = h('ol', { class: 'moves', 'aria-label': 'Moves' });

const pgnInput = h('textarea', {
  rows: 4,
  placeholder: '1. e4 c5 2. Nf3 d6 …   or a FEN position',
  'aria-label': 'PGN or FEN',
});
const pgnError = h('p', { class: 'form-error', role: 'alert' });
const loadForm = h(
  'details',
  { class: 'load' },
  h('summary', null, 'Paste moves or a position'),
  h(
    'form',
    {
      onsubmit: (e: Event) => {
        e.preventDefault();
        loadPgnOrFen(pgnInput.value);
      },
    },
    pgnInput,
    pgnError,
    h('button', { type: 'submit', class: 'btn' }, 'Load on board'),
  ),
);

const ecoEl = h('span', { class: 'eco' });
const nameEl = h('h1', { class: 'opening-name' });
const lineEl = h('p', { class: 'opening-line' });

type Tab = 'explore' | 'find' | 'games';
const tabs: Record<Tab, { btn: HTMLButtonElement; panel: HTMLElement }> = {} as never;
const tabBar = h('div', { class: 'tabs', role: 'tablist' });
const panels = h('div', { class: 'panels' });
function addTab(id: Tab, label: string, panel: HTMLElement) {
  const btn = h(
    'button',
    { type: 'button', role: 'tab', id: `tab-${id}`, 'aria-controls': `panel-${id}`, onclick: () => showTab(id) },
    label,
  );
  panel.id = `panel-${id}`;
  panel.setAttribute('role', 'tabpanel');
  panel.setAttribute('aria-labelledby', `tab-${id}`);
  tabs[id] = { btn, panel };
  tabBar.append(btn);
  panels.append(panel);
}
function showTab(id: Tab) {
  for (const [k, t] of Object.entries(tabs)) {
    const on = k === id;
    t.btn.setAttribute('aria-selected', String(on));
    t.btn.tabIndex = on ? 0 : -1;
    t.panel.hidden = !on;
  }
  storage('coat.tab', id);
}

// Explore panel
const evalSummary = h('div', { class: 'eval-summary' });
const evalLines = h('ol', { class: 'eval-lines' });
const bookList = h('ul', { class: 'book' });
const explorerBody = h('div', { class: 'explorer' });
const dbSelect = h(
  'select',
  { 'aria-label': 'Games database', onchange: () => (storage('coat.db', dbSelect.value), scheduleExplorer()) },
  h('option', { value: 'masters' }, 'Master games'),
  h('option', { value: 'lichess' }, 'Lichess players'),
);
dbSelect.value = storage('coat.db') ?? 'masters';
const ratingSelect = h(
  'select',
  { 'aria-label': 'Rating range', onchange: () => (storage('coat.rating', ratingSelect.value), scheduleExplorer()) },
  h('option', { value: '' }, 'All ratings'),
  h('option', { value: '1600' }, '1600 and up'),
  h('option', { value: '2000' }, '2000 and up'),
  h('option', { value: '2200' }, '2200 and up'),
);
ratingSelect.value = storage('coat.rating') ?? '';

addTab(
  'explore',
  'Explore',
  h(
    'div',
    { class: 'panel' },
    h(
      'section',
      { class: 'block' },
      h('h2', null, 'Engine evaluation'),
      evalSummary,
      evalLines,
    ),
    h(
      'section',
      { class: 'block' },
      h('h2', null, 'Book moves'),
      h('p', { class: 'hint' }, 'Named lines that continue from this position.'),
      bookList,
    ),
    h(
      'section',
      { class: 'block' },
      h('div', { class: 'block-head' }, h('h2', null, 'Games database'), h('div', { class: 'filters' }, dbSelect, ratingSelect)),
      explorerBody,
    ),
  ),
);

// Find panel
const searchInput = h('input', {
  type: 'search',
  placeholder: 'Name or ECO code, e.g. “najdorf” or “C60”',
  'aria-label': 'Search openings',
  oninput: () => renderSearch(),
});
const searchResults = h('ul', { class: 'results' });
const QUICK = ['Sicilian', 'French', 'Caro-Kann', 'Ruy Lopez', 'Italian', "Queen's Gambit", "King's Indian", 'London', 'Scandinavian', 'English'];
addTab(
  'find',
  'Find an opening',
  h(
    'div',
    { class: 'panel' },
    searchInput,
    h(
      'div',
      { class: 'quick' },
      QUICK.map((q) =>
        h('button', { type: 'button', class: 'chip', onclick: () => ((searchInput.value = q), renderSearch()) }, q),
      ),
    ),
    searchResults,
  ),
);

// My games panel
const gamesPanel = h('div', { class: 'panel' });
addTab('games', 'My games', gamesPanel);

app.append(
  h(
    'header',
    { class: 'top' },
    h('a', { class: 'brand', href: './' }, 'COAT'),
    h('span', { class: 'tagline' }, 'Chess Opening Analysis Tool'),
  ),
  h(
    'main',
    { class: 'layout' },
    h(
      'section',
      { class: 'board-col', 'aria-label': 'Board' },
      h('div', { class: 'board-wrap' }, evalBar, boardHost),
      h(
        'div',
        { class: 'controls' },
        navBtn('⏮', 'Go to start', () => goTo(0)),
        navBtn('◀', 'Previous move', () => goTo(cursor - 1)),
        navBtn('▶', 'Next move', () => goTo(cursor + 1)),
        navBtn('⏭', 'Go to end', () => goTo(line.length)),
        navBtn('⇅', 'Flip board', () => {
          board.flip();
          evalBar.classList.toggle('flipped', board.flipped);
        }),
        navBtn('↺', 'New game', () => loadMoves([])),
      ),
      moveList,
      loadForm,
    ),
    h(
      'section',
      { class: 'side', 'aria-label': 'Analysis' },
      h('div', { class: 'title' }, ecoEl, nameEl, lineEl),
      tabBar,
      panels,
    ),
  ),
  h(
    'footer',
    { class: 'foot' },
    'Opening names: ',
    h('a', { href: 'https://github.com/lichess-org/chess-openings' }, 'lichess-org/chess-openings'),
    ' (CC0). Evaluations and game statistics: ',
    h('a', { href: 'https://lichess.org/api' }, 'Lichess API'),
    '. Game imports: Lichess and ',
    h('a', { href: 'https://www.chess.com/news/view/published-data-api' }, 'Chess.com public data'),
    '.',
  ),
);

// ---------------------------------------------------------------- rendering

function update() {
  const fen = currentFen();
  board.set(fen, line[cursor - 1]?.uci);
  renderTitle();
  renderMoveList();
  renderBook();
  scheduleEval();
  scheduleExplorer();
  if (rootFen === START) {
    const hash = line.slice(0, cursor).map((p) => p.uci).join('-');
    history.replaceState(null, '', hash ? `#${hash}` : location.pathname + location.search);
  }
}

function plyLabel(i: number): string {
  // i is the 0-based index into `line`
  const { n, white } = moveNumber(fenAt(i));
  return white ? `${n}.` : `${n}…`;
}

function renderTitle() {
  const fens = line.slice(0, cursor).map((p) => p.fen);
  const c = rootFen === START ? book.classifyFens(fens) : undefined;
  if (!c) {
    ecoEl.textContent = '';
    nameEl.textContent = cursor === 0 && rootFen === START ? 'Starting position' : rootFen === START ? 'Unnamed line' : 'Custom position';
    lineEl.textContent = cursor === 0 ? 'Make a move on the board or find an opening by name.' : '';
  } else {
    ecoEl.textContent = c.opening.eco;
    nameEl.textContent = c.opening.name;
    const out = !book.inBook(currentFen());
    lineEl.textContent = out
      ? `Left the book after ${plyLabel(c.ply - 1)} ${line[c.ply - 1].san}`
      : c.ply < cursor
        ? `Named at ${plyLabel(c.ply - 1)} ${line[c.ply - 1].san}`
        : '';
  }
  document.title = c ? `${c.opening.name} · COAT` : 'COAT · Chess Opening Analysis Tool';
}

function renderMoveList() {
  moveList.replaceChildren();
  let row: HTMLElement | null = null;
  line.forEach((p, i) => {
    const { n, white } = moveNumber(fenAt(i));
    if (white || !row) {
      row = h('li', { class: 'move-row' }, h('span', { class: 'num' }, `${n}.`));
      if (!white) row.append(h('span', { class: 'move empty' }, '…'));
      moveList.append(row);
    }
    row.append(
      h(
        'button',
        {
          type: 'button',
          class: `move${i === cursor - 1 ? ' current' : ''}${i >= cursor ? ' ahead' : ''}`,
          'aria-current': i === cursor - 1 ? 'step' : undefined,
          onclick: () => goTo(i + 1),
        },
        p.san,
      ),
    );
  });
  moveList.querySelector('.current')?.scrollIntoView({ block: 'nearest' });
}

function renderBook() {
  const moves = book.continuations(currentFen());
  bookList.replaceChildren();
  if (!moves.length) {
    bookList.append(
      h('li', { class: 'empty' }, book.inBook(currentFen()) ? 'This is the end of the named line.' : 'No named lines continue from here.'),
    );
    return;
  }
  for (const m of moves) {
    bookList.append(
      h(
        'li',
        null,
        h(
          'button',
          { type: 'button', onclick: () => play(m.uci) },
          h('span', { class: 'san' }, m.san),
          h('span', { class: 'line-name' }, m.line.name),
          h('span', { class: 'eco-small' }, m.line.eco),
        ),
      ),
    );
  }
}

// Engine evaluation (Lichess cloud eval)

let evalTimer = 0;
let evalAbort: AbortController | null = null;

function setEvalBar(cp?: number, mate?: number) {
  let pct = 50;
  if (mate !== undefined) pct = mate > 0 ? 100 : 0;
  else if (cp !== undefined) pct = 50 + 50 * (2 / (1 + Math.exp(-0.00368 * cp)) - 1);
  evalFill.style.height = `${pct}%`;
}

function scheduleEval() {
  clearTimeout(evalTimer);
  evalAbort?.abort();
  const fen = currentFen();
  const chess = new Chess(fen);
  evalLines.replaceChildren();
  if (chess.isGameOver()) {
    evalSummary.textContent = chess.isCheckmate() ? 'Checkmate.' : 'Game over: draw.';
    setEvalBar(chess.isCheckmate() ? (chess.turn() === 'w' ? -10000 : 10000) : 0);
    return;
  }
  evalSummary.textContent = 'Looking up evaluation…';
  evalSummary.className = 'eval-summary muted';
  evalTimer = window.setTimeout(async () => {
    evalAbort = new AbortController();
    try {
      const ev = await cloudEval(fen, 3, evalAbort.signal);
      if (fen !== currentFen()) return;
      if (!ev) {
        evalSummary.textContent = 'No stored evaluation for this position. Lichess keeps evaluations mainly for common positions.';
        setEvalBar(0);
        return;
      }
      const best = ev.lines[0];
      setEvalBar(best.cp, best.mate);
      evalSummary.className = 'eval-summary';
      evalSummary.replaceChildren(
        h('strong', { class: 'eval-big' }, formatEval(best.cp, best.mate)),
        h('span', { class: 'muted' }, ` depth ${ev.depth}, from White’s side`),
      );
      for (const l of ev.lines) {
        const li = h('li', null, h('span', { class: 'eval-chip' }, formatEval(l.cp, l.mate)));
        const chess = new Chess(fen);
        l.san.forEach((san, i) => {
          const { n, white } = moveNumber(chess.fen());
          if (white || i === 0) li.append(h('span', { class: 'num' }, white ? `${n}.` : `${n}…`));
          const upTo = l.uci.slice(0, i + 1);
          li.append(
            h('button', { type: 'button', class: 'pv-move', onclick: () => upTo.forEach((u) => play(u)) }, san),
          );
          chess.move(uciToMove(l.uci[i]));
        });
        evalLines.append(li);
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      evalSummary.textContent = 'Could not reach Lichess for an evaluation. Check your connection.';
    }
  }, 250);
}

// Games database (Lichess opening explorer)

let explorerTimer = 0;
let explorerAbort: AbortController | null = null;

function tokenForm(message?: string) {
  const input = h('input', { type: 'password', placeholder: 'lip_…', 'aria-label': 'Lichess API token', autocomplete: 'off' });
  explorerBody.replaceChildren(
    h(
      'p',
      { class: 'hint' },
      message ??
        'Move statistics from millions of games come from the Lichess opening explorer, which needs a free Lichess API token. No permissions are needed when you create it.',
    ),
    h(
      'form',
      {
        class: 'token-form',
        onsubmit: (e: Event) => {
          e.preventDefault();
          if (!input.value.trim()) return;
          storage('coat.token', input.value.trim());
          scheduleExplorer();
        },
      },
      input,
      h('button', { type: 'submit', class: 'btn' }, 'Save token'),
    ),
    h(
      'p',
      { class: 'hint' },
      h(
        'a',
        { href: 'https://lichess.org/account/oauth/token/create?description=COAT+opening+explorer', target: '_blank', rel: 'noopener' },
        'Create a token on Lichess',
      ),
      '. It is saved only in this browser.',
    ),
  );
}

function scheduleExplorer() {
  clearTimeout(explorerTimer);
  explorerAbort?.abort();
  const token = storage('coat.token');
  ratingSelect.hidden = dbSelect.value !== 'lichess';
  if (!token) {
    tokenForm();
    return;
  }
  const fen = currentFen();
  explorerBody.replaceChildren(h('p', { class: 'hint' }, 'Loading games…'));
  explorerTimer = window.setTimeout(async () => {
    explorerAbort = new AbortController();
    const db = dbSelect.value as ExplorerDb;
    const ratings = ratingSelect.value
      ? [1600, 1800, 2000, 2200, 2500].filter((r) => r >= Number(ratingSelect.value))
      : undefined;
    try {
      const res = await explorer(db, fen, token, { speeds: ['blitz', 'rapid', 'classical'], ratings }, explorerAbort.signal);
      if (fen !== currentFen()) return;
      const total = res.white + res.draws + res.black;
      if (!total) {
        explorerBody.replaceChildren(h('p', { class: 'hint' }, 'No games in this database reached this position.'));
        return;
      }
      const rows = res.moves.map((m) => {
        const n = m.white + m.draws + m.black;
        return h(
          'tr',
          null,
          h('th', { scope: 'row' }, h('button', { type: 'button', class: 'san', onclick: () => play(m.uci) }, m.san)),
          h('td', { class: 'num-col' }, `${Math.round((n / total) * 100)}%`),
          h('td', { class: 'num-col' }, formatCount(n)),
          h('td', { class: 'bar-col' }, resultBar(m.white, m.draws, m.black)),
        );
      });
      explorerBody.replaceChildren(
        h(
          'table',
          { class: 'stats' },
          h(
            'thead',
            null,
            h('tr', null, h('th', { scope: 'col' }, 'Move'), h('th', { scope: 'col', class: 'num-col' }, 'Played'), h('th', { scope: 'col', class: 'num-col' }, 'Games'), h('th', { scope: 'col' }, 'White / draw / Black')),
          ),
          h('tbody', null, rows),
          h(
            'tfoot',
            null,
            h('tr', null, h('th', { scope: 'row' }, 'All'), h('td', null), h('td', { class: 'num-col' }, formatCount(total)), h('td', { class: 'bar-col' }, resultBar(res.white, res.draws, res.black))),
          ),
        ),
        h(
          'p',
          { class: 'hint' },
          h('button', { type: 'button', class: 'link', onclick: () => (storage('coat.token', null), scheduleExplorer()) }, 'Remove saved token'),
        ),
      );
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      if (err instanceof ApiError && err.status === 401) {
        storage('coat.token', null);
        tokenForm('Lichess rejected the saved token. Create a new one and paste it here.');
        return;
      }
      explorerBody.replaceChildren(
        h('p', { class: 'hint' }, err instanceof ApiError ? err.message : 'Could not reach the Lichess opening explorer. Check your connection.'),
      );
    }
  }, 300);
}

// Find an opening

function renderSearch() {
  const q = searchInput.value;
  const results = book.search(q);
  searchResults.replaceChildren();
  if (!q.trim()) return;
  if (!results.length) {
    searchResults.append(h('li', { class: 'empty' }, `No opening names match “${q}”.`));
    return;
  }
  for (const o of results) searchResults.append(openingItem(o));
}

function lineText(o: Opening): string {
  return o.san.map((s, i) => (i % 2 === 0 ? `${i / 2 + 1}. ${s}` : s)).join(' ');
}

function openingItem(o: Opening) {
  return h(
    'li',
    null,
    h(
      'button',
      { type: 'button', onclick: () => (loadMoves(o.uci), showTab('explore')) },
      h('span', { class: 'eco-small' }, o.eco),
      h('span', { class: 'line-name' }, o.name),
      h('span', { class: 'line-moves' }, lineText(o)),
    ),
  );
}

// Load PGN / FEN

function loadPgnOrFen(text: string) {
  const t = text.trim();
  pgnError.textContent = '';
  if (!t) return;
  if (/^[1-8pnbrqkPNBRQK/]+\s+[wb]\b/.test(t)) {
    try {
      new Chess(t);
    } catch (e) {
      pgnError.textContent = `That FEN is not valid: ${(e as Error).message}`;
      return;
    }
    loadMoves([], t);
    return;
  }
  const game = parsePgn(t)[0];
  const moves = game?.moves ?? sanTokens(t);
  const fen = game?.headers.FEN ?? START;
  try {
    new Chess(fen);
  } catch {
    pgnError.textContent = 'The FEN header in that PGN is not valid.';
    return;
  }
  loadMoves(moves, fen);
  if (line.length < moves.length) {
    pgnError.textContent = `Stopped at move “${moves[line.length]}”, which is not legal in that position.`;
  }
}

// ---------------------------------------------------------------- My games

let games: PlayerGame[] = [];
let gamesColor: Color = 'white';
let grouping: Grouping = 'family';
let sortBy: 'games' | 'score' = 'games';

const sourceSelect = h(
  'select',
  { id: 'source', onchange: () => renderGamesForm() },
  h('option', { value: 'lichess' }, 'Lichess'),
  h('option', { value: 'chesscom' }, 'Chess.com'),
  h('option', { value: 'pgn' }, 'PGN file'),
);
sourceSelect.value = storage('coat.source') ?? 'lichess';
const userInput = h('input', { id: 'user', type: 'text', autocomplete: 'off', spellcheck: 'false', required: true });
userInput.value = storage('coat.user') ?? '';
const countSelect = h(
  'select',
  { id: 'count' },
  h('option', { value: '100' }, 'Last 100 games'),
  h('option', { value: '300' }, 'Last 300 games'),
  h('option', { value: '1000' }, 'Last 1,000 games'),
);
const fileInput = h('input', { id: 'pgnfile', type: 'file', accept: '.pgn,text/plain' });
const status = h('p', { class: 'status', role: 'status' });
const results = h('div', { class: 'game-results' });
const countField = h('div', { class: 'field' }, h('label', { for: 'count' }, 'Games'), countSelect);
const fileField = h('div', { class: 'field' }, h('label', { for: 'pgnfile' }, 'PGN file'), fileInput);
const userLabel = h('label', { for: 'user' }, 'Username');
const analyzeBtn = h('button', { type: 'submit', class: 'btn primary' }, 'Analyze games');

function renderGamesForm() {
  const pgn = sourceSelect.value === 'pgn';
  countField.hidden = pgn;
  fileField.hidden = !pgn;
  userLabel.textContent = pgn ? 'Your name as it appears in the PGN' : `${sourceSelect.value === 'lichess' ? 'Lichess' : 'Chess.com'} username`;
}

gamesPanel.append(
  h(
    'p',
    { class: 'hint' },
    'See how you score with each opening you play. Games are fetched from public data and analyzed in your browser.',
  ),
  h(
    'form',
    { class: 'games-form', onsubmit: (e: Event) => (e.preventDefault(), runImport()) },
    h('div', { class: 'field' }, h('label', { for: 'source' }, 'Source'), sourceSelect),
    h('div', { class: 'field grow' }, userLabel, userInput),
    countField,
    fileField,
    analyzeBtn,
  ),
  status,
  results,
);
renderGamesForm();

async function runImport() {
  const user = userInput.value.trim();
  if (!user) return;
  storage('coat.user', user);
  storage('coat.source', sourceSelect.value);
  analyzeBtn.disabled = true;
  results.replaceChildren();
  const max = Number(countSelect.value);
  try {
    if (sourceSelect.value === 'pgn') {
      const file = fileInput.files?.[0];
      if (!file) throw new ApiError('Choose a PGN file first.');
      status.textContent = 'Reading file…';
      const parsed = parsePgn(await file.text());
      games = fromPgn(parsed, user);
      if (!games.length)
        throw new ApiError(`None of the ${parsed.length} games in that file has a player named “${user}”. Check the White and Black names in the file.`);
    } else if (sourceSelect.value === 'lichess') {
      status.textContent = 'Downloading games from Lichess…';
      const raw = await lichessUserGames(user, max, (n) => (status.textContent = `Downloaded ${n} games from Lichess…`));
      games = fromLichess(raw, user);
    } else {
      status.textContent = 'Downloading games from Chess.com…';
      const raw = await chessComUserGames(user, max, (n) => (status.textContent = `Downloaded ${n} games from Chess.com…`));
      games = fromChessCom(raw, user);
    }
    statsCache.clear();
    if (!games.length) throw new ApiError(`No finished standard games found for “${user}”.`);
    gamesColor = games.filter((g) => g.color === 'white').length >= games.length / 2 ? 'white' : 'black';
    status.textContent = 'Classifying openings…';
    await new Promise((r) => setTimeout(r, 0));
    renderGameResults();
  } catch (err) {
    status.textContent =
      err instanceof ApiError ? err.message : 'Could not download games. Check your connection and try again.';
  } finally {
    analyzeBtn.disabled = false;
  }
}

const statsCache = new Map<Grouping, OpeningStats[]>();
function stats(): OpeningStats[] {
  if (!statsCache.has(grouping)) statsCache.set(grouping, aggregate(book, games, grouping));
  return statsCache.get(grouping)!;
}

function segmented<T extends string>(label: string, options: [T, string][], value: T, set: (v: T) => void) {
  return h(
    'div',
    { class: 'seg', role: 'radiogroup', 'aria-label': label },
    options.map(([v, text]) =>
      h('button', { type: 'button', role: 'radio', 'aria-checked': String(v === value), onclick: () => set(v) }, text),
    ),
  );
}

function renderGameResults() {
  const all = stats().filter((s) => s.color === gamesColor);
  const n = all.reduce((a, s) => a + s.games, 0);
  const score = all.reduce((a, s) => a + s.wins + s.draws / 2, 0) / (n || 1);
  const rows = [...all].sort((a, b) =>
    sortBy === 'games' ? b.games - a.games : (a.games >= 3 ? 0 : 1) - (b.games >= 3 ? 0 : 1) || a.score - b.score || b.games - a.games,
  );
  status.textContent = `${games.length} games analyzed.`;
  results.replaceChildren(
    h(
      'div',
      { class: 'result-controls' },
      segmented('Colour', [['white', 'As White'], ['black', 'As Black']], gamesColor, (v) => ((gamesColor = v), renderGameResults())),
      segmented('Grouping', [['family', 'Openings'], ['variation', 'Variations']], grouping, (v) => ((grouping = v), renderGameResults())),
      segmented('Sort', [['games', 'Most played'], ['score', 'Weakest first']], sortBy, (v) => ((sortBy = v), renderGameResults())),
    ),
    h('p', { class: 'summary' }, `${n} games as ${gamesColor === 'white' ? 'White' : 'Black'}, scoring ${Math.round(score * 100)}% overall.`),
    h(
      'table',
      { class: 'stats games' },
      h(
        'thead',
        null,
        h('tr', null, h('th', { scope: 'col' }, 'Opening'), h('th', { scope: 'col', class: 'num-col' }, 'Games'), h('th', { scope: 'col', class: 'num-col' }, 'Score'), h('th', { scope: 'col' }, 'Win / draw / loss')),
      ),
      h(
        'tbody',
        null,
        rows.map((s) =>
          h(
            'tr',
            null,
            h(
              'th',
              { scope: 'row' },
              s.line
                ? h(
                    'button',
                    { type: 'button', class: 'link-row', title: 'Show this line on the board', onclick: () => (loadMoves(s.line!.uci), showTab('explore')) },
                    h('span', { class: 'eco-small' }, s.eco),
                    s.name,
                  )
                : s.name,
            ),
            h('td', { class: 'num-col' }, s.games),
            h('td', { class: `num-col score ${s.score >= 0.55 ? 'good' : s.score < 0.45 ? 'bad' : ''}` }, `${Math.round(s.score * 100)}%`),
            h('td', { class: 'bar-col' }, resultBar(s.wins, s.draws, s.losses)),
          ),
        ),
      ),
    ),
    h('p', { class: 'hint' }, 'Score counts a win as 1 and a draw as ½. Select an opening to study its main line on the board.'),
  );
}

// ---------------------------------------------------------------- keyboard + init

document.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement;
  if (t.closest('input, textarea, select, .board, [role="tablist"]')) return;
  if (e.key === 'ArrowLeft') goTo(cursor - 1);
  else if (e.key === 'ArrowRight') goTo(cursor + 1);
  else if (e.key === 'Home') goTo(0);
  else if (e.key === 'End') goTo(line.length);
  else return;
  e.preventDefault();
});

tabBar.addEventListener('keydown', (e) => {
  const ids = Object.keys(tabs) as Tab[];
  const i = ids.findIndex((id) => tabs[id].btn === document.activeElement);
  if (i < 0 || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
  const next = ids[(i + (e.key === 'ArrowRight' ? 1 : ids.length - 1)) % ids.length];
  showTab(next);
  tabs[next].btn.focus();
});

showTab((storage('coat.tab') as Tab) ?? 'explore');
// Lines are shareable as #e2e4-e7e5-g1f3 (UCI moves from the start position).
const movesFromHash = () => location.hash.slice(1).split('-').filter(Boolean);
window.addEventListener('hashchange', () => loadMoves(movesFromHash()));
loadMoves(movesFromHash());
