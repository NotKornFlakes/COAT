type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, string | number | boolean | EventListener | undefined>;

/** Tiny element builder. Text is always inserted as text, never as HTML. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs | null = null,
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

/** White / draw / black result bar. */
export function resultBar(white: number, draws: number, black: number): HTMLElement {
  const total = white + draws + black || 1;
  const pct = (n: number) => Math.round((n / total) * 100);
  const seg = (cls: string, n: number) => {
    const p = pct(n);
    return h('span', { class: cls, style: `flex-grow:${n}` }, p >= 12 ? `${p}%` : '');
  };
  return h(
    'span',
    {
      class: 'bar',
      role: 'img',
      'aria-label': `White wins ${pct(white)}%, draws ${pct(draws)}%, Black wins ${pct(black)}%`,
    },
    seg('w', white),
    seg('d', draws),
    seg('b', black),
  );
}

export function formatCount(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e4) return `${Math.round(n / 1e3)}k`;
  return n.toLocaleString('en-US');
}

/** "+0.35", "−1.20", "#3", "#−2" from White's point of view. */
export function formatEval(cp?: number, mate?: number): string {
  if (mate !== undefined) return mate > 0 ? `#${mate}` : `#−${-mate}`;
  const v = (cp ?? 0) / 100;
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}`;
}

export function storage(key: string, value?: string | null): string | null {
  try {
    if (value === null) localStorage.removeItem(key);
    else if (value !== undefined) localStorage.setItem(key, value);
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
