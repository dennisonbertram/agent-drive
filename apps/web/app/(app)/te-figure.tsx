'use client';
// Shared runtime for the three landing illustrations (hero, games, protein).
// Each figure is a pure function frame(t, env) -> { group id: SVG markup }. The same function
// renders the server-side still and every animation frame; the loop writes only the groups
// whose markup changed, straight into the DOM (no React renders while animating).
import { useEffect, useRef } from 'react';

// Hex values of the site tokens: --ink, --paper-2, --al2, --al3, --sig (plus two derived greys).
export const C = {
  ink: '#111111',
  g0: '#f6f5f2',
  g1: '#e6e4df',
  g2: '#a8a69f',
  g3: '#6f6d68',
  ot: '#c2370f', // orange for text on cream (5.0:1); C.or is for marks and the dark strip
  or: '#ff4a1c',
  w: '#ffffff',
  off: '#2a2a28',
};

/** Layout facts that depend on the rendered width: font size in viewBox units, and variants. */
export type Env = { fs: number; cw: number; compact: boolean; narrow: boolean };
const W = 520;
export const envFor = (px: number): Env => {
  const f = px / W;
  const fs = Math.max(10, 12.5 / f); // labels never render below 12.5px when the figure is below ~620px
  return { fs, cw: fs * 0.6, compact: fs > 10, narrow: f < 1 }; // below 520px wide the 12px labels no longer fit the desktop key names
};
// First paint uses the phone size (the 320px figure of a 360px screen); the CSS --fs matches it.
export const ENV0: Env = envFor(320);

export const cl = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const seg = (t: number, a: number, b: number) => cl((t - a) / (b - a));
export const io = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
export const ob = (x: number) => 1 + 2.2 * Math.pow(x - 1, 3) + 1.2 * Math.pow(x - 1, 2);
export const pad = (n: number, k: number) => String(n).padStart(k, '0');
const hx = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
export const mix = (a: string, b: string, k: number) => {
  const A = hx(a);
  const B = hx(b);
  return (
    '#' +
    A.map((v, i) =>
      Math.round(v + (B[i]! - v) * cl(k))
        .toString(16)
        .padStart(2, '0'),
    ).join('')
  );
};
const r1 = (v: number) => Math.round(v * 10) / 10;
/** A dot is a zero-length round-capped segment; the path's stroke-width is its diameter. */
export const dot = (x: number, y: number) => `M${r1(x)} ${r1(y)}h0`;
export const sq = (x: number, y: number, s: number) => `M${r1(x)} ${r1(y)}h${s}v${s}h${-s}z`;
export const tx = (
  x: number,
  y: number,
  s: string | number,
  fill: string,
  o: { a?: string; b?: boolean; op?: number } = {},
) =>
  `<text class="m${o.b ? ' b' : ''}" x="${r1(x)}" y="${r1(y)}" fill="${fill}"${
    o.a ? ` text-anchor="${o.a}"` : ''
  }${o.op !== undefined ? ` opacity="${o.op}"` : ''}>${s}</text>`;
/** Baseline that vertically centres capital text on cy. */
export const vc = (cy: number, env: Env) => cy + 0.365 * env.fs;
/** Memoise markup that depends only on the layout env. */
export const byEnv = (f: (e: Env) => string) => {
  let k = '';
  let v = '';
  return (e: Env) => {
    const n = `${e.fs}|${e.narrow}`;
    if (n !== k) {
      k = n;
      v = f(e);
    }
    return v;
  };
};

// 5x7 dot-matrix glyphs, row by row.
const F: Record<string, string> = {};
`A 01110100011000111111100011000110001
B 11110100011000111110100011000111110
C 01110100011000010000100001000101110
D 11110100011000110001100011000111110
E 11111100001000011110100001000011111
F 11111100001000011110100001000010000
G 01110100011000010111100011000101111
H 10001100011000111111100011000110001
I 01110001000010000100001000010001110
J 00111000100001000010000101001001100
K 10001100101010011000101001001010001
L 10000100001000010000100001000011111
M 10001110111010110101100011000110001
N 10001100011100110101100111000110001
O 01110100011000110001100011000101110
P 11110100011000111110100001000010000
Q 01110100011000110001101011001001101
R 11110100011000111110101001001010001
S 01111100001000001110000010000111110
T 11111001000010000100001000010000100
U 10001100011000110001100011000101110
V 10001100011000110001100010101000100
W 10001100011000110101101011010101010
X 10001100010101000100010101000110001
Y 10001100011000101010001000010000100
Z 11111000010001000100010001000011111
0 01110100011001110101110011000101110
1 00100011000010000100001000010001110
2 01110100010000100010001000100011111
3 11111000100010000010000011000101110
4 00010001100101010010111110001000010
5 11111100001111000001000011000101110
6 00110010001000011110100011000101110
7 11111000010001000100010000100001000
8 01110100011000101110100011000101110
9 01110100011000101111000010001001100
/ 00000000010001000100010001000000000
. 00000000000000000000000000110001100
- 00000000000000011111000000000000000
: 00000011000110000000011000110000000
> 01000001000001000001000100010001000
< 00010001000100010000010000010000010
% 11000110010001000100010001001100011
+ 00000001000010011111001000010000000
_ 00000000000000000000000000000011111`
  .split('\n')
  .forEach((l) => {
    F[l[0]!] = l.slice(2);
  });
export const glyph = (ch: string) => F[ch];

/** Dot-matrix strip: black bar, 7-row LED grid, left text orange, right text white. */
export function strip(
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  p: number,
  l: string,
  r = '',
) {
  const n = Math.floor((w - 20) / p);
  const x0 = x + (w - n * p) / 2 + p / 2;
  const y0 = y + (h - 7 * p) / 2 + p / 2;
  const draw = (s: string, c0: number) => {
    let d = '';
    [...s.toUpperCase()].forEach((ch, i) => {
      const g = F[ch];
      if (!g) return;
      for (let k = 0; k < 35; k++)
        if (g[k] === '1') d += dot(x0 + (c0 + i * 6 + (k % 5)) * p, y0 + Math.floor(k / 5) * p);
    });
    return d;
  };
  const sw = (p * 0.8).toFixed(2);
  return (
    `<defs><pattern id="${id}" width="${p}" height="${p}" patternUnits="userSpaceOnUse" x="${x0 - p / 2}" y="${y0 - p / 2}"><circle cx="${p / 2}" cy="${p / 2}" r="${p * 0.3}" fill="${C.off}"/></pattern></defs>` +
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="${C.ink}"/>` +
    `<rect x="${x0 - p / 2}" y="${y0 - p / 2}" width="${n * p}" height="${7 * p}" fill="url(#${id})"/>` +
    `<path d="${draw(l, 0)}" stroke="${C.or}" stroke-width="${sw}" stroke-linecap="round" fill="none"/>` +
    `<path d="${draw(r, n - (r.length * 6 - 1))}" stroke="${C.g0}" stroke-width="${sw}" stroke-linecap="round" fill="none"/>`
  );
}
/** Typed-message schedule [[t, text], ...]: the latest entry types out over `dur` seconds. */
export function typed(sched: [number, string][], t: number, dur = 0.3) {
  let m = sched[0]!;
  for (const s of sched) if (t >= s[0]) m = s;
  const k = seg(t, m[0], m[0] + dur);
  return m[1].slice(0, Math.ceil(k * m[1].length));
}

/** Panel chrome: background, corner marks, title, rule and a blinking dot. */
export function chrome(title: string, t: number, T: number) {
  const lt = t % T;
  const mk = (x: number, y: number) =>
    `<path d="M${x - 4} ${y}h8M${x} ${y - 4}v8" stroke="${C.g2}"/>`;
  return (
    `<rect width="520" height="420" rx="16" fill="${C.g0}"/>${mk(12, 12)}${mk(508, 12)}${mk(12, 408)}${mk(508, 408)}` +
    tx(24, 30, title, C.g3) +
    `<circle cx="493" cy="26.5" r="3" fill="${C.or}" opacity="${lt % 1 < 0.5 ? 1 : 0.25}"/>` +
    `<path d="M24 42.5H496" stroke="${C.ink}"/>`
  );
}

export type Frame = (t: number, env: Env) => Record<string, string>;

/**
 * One figure. `still` is the representative frame (server render and reduced motion).
 * The loop starts when the figure first scrolls into view and pauses while it is
 * offscreen or the tab is hidden.
 */
export function TeFigure({
  frame,
  still,
  label,
  name,
}: {
  frame: Frame;
  still: number;
  label: string;
  name: string;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const first = frame(still, ENV0);
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const groups = Object.keys(first).map((k) => el.querySelector<SVGGElement>(`[data-g="${k}"]`)!);
    const keys = Object.keys(first);
    const cache: Record<string, string> = { ...first };
    let env = ENV0;
    let t = 0;
    let started = false;
    const paint = () => {
      const o = frame(started ? t : still, env);
      keys.forEach((k, i) => {
        if (o[k] !== cache[k]) {
          cache[k] = o[k]!;
          groups[i]!.innerHTML = o[k]!;
        }
      });
    };
    const reduce = matchMedia('(prefers-reduced-motion: reduce)');
    let onscreen = false;
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      t += Math.min(now - last, 100) / 1000;
      last = now;
      paint();
      raf = requestAnimationFrame(tick);
    };
    const sync = () => {
      cancelAnimationFrame(raf);
      raf = 0;
      if (reduce.matches) {
        started = false; // reduced motion: show the representative frame, not a mid-transition one
        paint();
        return;
      }
      if (!onscreen || document.hidden) return;
      started = true;
      last = performance.now();
      raf = requestAnimationFrame(tick);
    };
    const measure = () => {
      const next = envFor(el.getBoundingClientRect().width || W);
      if (next.fs !== env.fs || next.narrow !== env.narrow) {
        env = next;
        el.style.setProperty('--fs', `${env.fs.toFixed(2)}px`);
        paint();
      }
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const io_ = new IntersectionObserver(([e]) => {
      onscreen = !!e?.isIntersecting;
      sync();
    });
    io_.observe(el);
    reduce.addEventListener('change', sync);
    document.addEventListener('visibilitychange', sync);
    measure();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io_.disconnect();
      reduce.removeEventListener('change', sync);
      document.removeEventListener('visibilitychange', sync);
    };
    // `first` and `frame` are constant for the life of the component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <figure className={`te-fig te-${name}`}>
      <svg ref={svg} viewBox="0 0 520 420" role="img" aria-label={label}>
        <g aria-hidden="true">
          {Object.entries(first).map(([k, html]) => (
            <g key={k} data-g={k} dangerouslySetInnerHTML={{ __html: html }} />
          ))}
        </g>
      </svg>
    </figure>
  );
}
