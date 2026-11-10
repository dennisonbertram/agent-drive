'use client';
// Hero illustration: five agents press keys, packets run down a bus into one drive, tiles
// snap into its folders. The loop never deletes a saved file: the next lap starts with
// everything grey ("earlier sessions") and the agents save fresh versions on top.
import { C, TeFigure, byEnv, chrome, cl, io, mix, ob, seg, strip, tx, typed } from './te-figure';
import type { Env, Frame } from './te-figure';

const T = 12;
const FD = ['memory', 'outputs', 'work', 'handoff'];
const AGENT = [
  { l: ['CLAUDE', 'CODE'], n: ['CLAUDE', 'CODE'], s: 'CLAUDE' },
  { l: ['CODEX'], n: ['CODEX'], s: 'CODEX' },
  { l: ['PI'], n: ['PI'], s: 'PI' },
  { l: ['OPENCODE'], n: ['OPEN', 'CODE'], s: 'OPENCODE' },
  { l: ['ANY', 'SHELL+MCP'], n: ['ANY', 'AGENT'], s: 'AGENT' },
];
const kx = (i: number) => 24 + i * 98;
const kc = (i: number) => 64 + i * 98;
const col = (f: number) => 24 + f * 118;
const cc = (f: number) => 83 + f * 118;
const RAIL = 140.5;
const KB = 122;
const DT = 152;
const slot = (f: number, s: number) =>
  [col(f) + 12 + (s % 3) * 34, 204 + Math.floor(s / 3) * 34] as const;
// Key glyphs, centred on (x, y).
const GL = [
  (x: number, y: number) => `M${x - 5} ${y}a5 5 0 1 0 10 0a5 5 0 1 0 -10 0`,
  (x: number, y: number) => `M${x - 5} ${y - 5}h10v10h-10z`,
  (x: number, y: number) => `M${x} ${y - 5.5}L${x + 6} ${y + 5}H${x - 6}z`,
  (x: number, y: number) =>
    `M${x - 5.5} ${y}a5.5 5.5 0 1 0 11 0a5.5 5.5 0 1 0 -11 0M${x - 2.5} ${y}a2.5 2.5 0 1 1 5 0a2.5 2.5 0 1 1 -5 0`,
  (x: number, y: number) => `M${x - 1.5} ${y - 6}h3v4.5h4.5v3h-4.5v4.5h-3v-4.5h-4.5v-3h4.5z`,
];
const BASE = [
  [0, 0],
  [0, 1],
  [0, 2],
  [0, 3],
  [1, 0],
  [1, 1],
  [1, 2],
  [2, 0],
  [2, 1],
  [2, 2],
  [2, 3],
  [3, 0],
] as const;
// time, agent, folder, slot, isHandoff
type Drop = { t: number; a: number; f: number; s: number; h: boolean; p: number[][]; land: number };
const plen = (p: number[][]) =>
  p.slice(1).reduce((L, q, i) => L + Math.hypot(q[0]! - p[i]![0]!, q[1]! - p[i]![1]!), 0);
const dur = (p: number[][]) => 0.35 + plen(p) / 650;
const at = (p: number[][], u: number) => {
  let L = plen(p) * u;
  for (let i = 1; i < p.length; i++) {
    const s = Math.hypot(p[i]![0]! - p[i - 1]![0]!, p[i]![1]! - p[i - 1]![1]!);
    if (L <= s || i === p.length - 1) {
      const k = s ? cl(L / s) : 0;
      return [
        p[i - 1]![0]! + (p[i]![0]! - p[i - 1]![0]!) * k,
        p[i - 1]![1]! + (p[i]![1]! - p[i - 1]![1]!) * k,
      ] as const;
    }
    L -= s;
  }
  return [0, 0] as const;
};
const DROPS: Drop[] = (
  [
    [0.5, 0, 0, 4],
    [1.1, 1, 1, 3],
    [1.7, 2, 2, 4],
    [2.3, 3, 1, 4],
    [2.9, 4, 2, 5],
    [3.5, 0, 2, 6],
    [4.1, 1, 0, 5],
    [4.7, 3, 1, 5],
    [5.3, 2, 0, 6],
    [6.3, 0, 3, 1, 1],
  ] as number[][]
).map(([t, a, f, s, h]) => {
  const p = [
    [kc(a!) + 0.5, KB],
    [kc(a!) + 0.5, RAIL],
    [cc(f!) + 0.5, RAIL],
    [cc(f!) + 0.5, DT],
  ];
  return { t: t!, a: a!, f: f!, s: s!, h: !!h, p, land: t! + dur(p) };
});
const PICK = [
  [cc(3) + 0.5, DT],
  [cc(3) + 0.5, RAIL],
  [kc(1) + 0.5, RAIL],
  [kc(1) + 0.5, KB],
];
const PK0 = 8.1;
const PK1 = PK0 + dur(PICK);
const MSG: [number, string][] = [
  [0, 'SANDBOX ONLINE'],
  ...DROPS.map((D): [number, string] => [
    D.t,
    D.h ? 'SAVE NEXT.MD' : `${AGENT[D.a]!.s} > /${FD[D.f]!.toUpperCase()}`,
  ]),
  [8.1, 'CODEX OPENS NEXT.MD'],
  [9.5, 'SANDBOX ENDED'],
  [10.2, 'DRIVE KEPT 22 FILES'],
  [11.2, 'NEW SANDBOX'],
];

// Wires, drive body, folder headers and legend: depend only on the layout.
const body = byEnv((env: Env) => {
  let w = `<path d="${AGENT.map((_, i) => `M${kc(i) + 0.5} ${KB}V${RAIL}`).join('')}M${kc(0)} ${RAIL}H${kc(4) + 1}${FD.map((_, f) => `M${cc(f) + 0.5} ${RAIL}V${DT}`).join('')}" stroke="${C.ink}" fill="none"/>`;
  AGENT.forEach(
    (_, i) => (w += `<circle cx="${kc(i) + 0.5}" cy="${RAIL}" r="2" fill="${C.ink}"/>`),
  );
  FD.forEach(
    (_, f) =>
      (w += `<circle cx="${cc(f) + 0.5}" cy="${RAIL}" r="2" fill="${C.g0}" stroke="${C.ink}"/>`),
  );
  let d = `<rect x="24.5" y="${DT + 0.5}" width="471" height="159" rx="12" fill="${C.w}" stroke="${C.ink}"/>`;
  FD.forEach((n, f) => {
    const x = col(f);
    if (f) d += `<path d="M${x + 0.5} 164V300" stroke="${C.g1}"/>`;
    d +=
      tx(x + 12, 178, `/${n}`, C.ink) + `<path d="M${x + 12} 188.5H${x + 106}" stroke="${C.ink}"/>`;
    for (let s = 0; s < (f === 3 ? 3 : 9); s++) {
      const [sx, sy] = slot(f, s);
      d += `<rect x="${sx + 0.5}" y="${sy + 0.5}" width="25" height="25" rx="4" fill="none" stroke="${C.g1}"/>`;
    }
  });
  const lg: [string, string][] = env.compact
    ? [
        [C.g2, 'EARLIER'],
        [C.ink, 'THIS SESSION'],
        [C.or, 'HANDOFF'],
      ]
    : [
        [C.g2, 'EARLIER SESSIONS'],
        [C.ink, 'THIS SESSION'],
        [C.or, 'HANDOFF'],
      ];
  let lx = 24;
  lg.forEach(([c, l]) => {
    d +=
      `<rect x="${lx}" y="334" width="8" height="8" rx="2" fill="${c}"/>` +
      tx(lx + 14, 342, l, C.ink);
    lx += 14 + l.length * env.cw + 20;
  });
  if (!env.narrow) d += tx(496, 342, 'ENCRYPTED AT REST', C.g3, { a: 'end' });
  return w + d;
});

const frame: Frame = (t, env) => {
  const lt = t % T;
  const lap = Math.floor(t / T);
  const sealed = seg(lt, 11.3, 11.9); // end of the loop: this session's tiles become "earlier sessions"
  // keys
  const ls = Math.max(12, env.fs * 1.35); // line pitch: text boxes of stacked lines never touch
  let k = '';
  AGENT.forEach((A, i) => {
    let press = 0;
    DROPS.forEach((D) => {
      if (D.a === i)
        press = Math.max(press, seg(lt, D.t - 0.15, D.t) * (1 - seg(lt, D.t + 0.3, D.t + 0.55)));
    });
    const recv = i === 1 ? seg(lt, PK1 - 0.05, PK1 + 0.15) * (1 - seg(lt, 9.3, 9.6)) : 0;
    const off = seg(lt, 9.5, 9.9) * (1 - seg(lt, 11.2 + i * 0.1, 11.45 + i * 0.1));
    let fill = mix(C.g1, C.ink, press);
    fill = mix(fill, C.or, recv);
    fill = mix(fill, C.g0, off);
    // the label flips at the midpoint: blending ink to cream passes through the key's own grey
    let tc = mix(press > 0.5 ? C.g0 : C.ink, C.ink, recv);
    tc = mix(tc, C.g3, off);
    let gl = mix(mix(C.ink, C.or, press), C.ink, recv);
    gl = mix(gl, C.g2, off);
    const y = 58 + press * 1.5;
    const lines = env.narrow ? A.n : A.l;
    const kw = env.narrow ? 86 : 79; // phone keys are wider, so names fit at 12px
    const x = env.narrow ? kc(i) - kw / 2 : kx(i);
    k += `<rect x="${x + 0.5}" y="${y + 0.5}" width="${kw}" height="63" rx="10" fill="${fill}" stroke="${C.g2}" stroke-dasharray="3 3" stroke-opacity="${off.toFixed(3)}"/>`;
    k += `<path d="${GL[i]!(x + kw - (env.narrow ? 14 : 13), y + (env.narrow ? 7 : 14.5))}" fill="${gl}" fill-rule="evenodd"/>`;
    lines.forEach(
      (s, j) => (k += tx(x + 10, y + (env.narrow ? 56 : 54) - (lines.length - 1 - j) * ls, s, tc)),
    );
  });
  // tiles, packets, counters
  const cnt = [0, 0, 0, 0];
  let tl = '';
  let fx = '';
  const tile = (x: number, y: number, c: string, op = 1) =>
    `<rect x="${x}" y="${y.toFixed(2)}" width="26" height="26" rx="4" fill="${c}"${op < 1 ? ` opacity="${op.toFixed(3)}"` : ''}/>`;
  BASE.forEach(([f, s]) => {
    cnt[f]!++;
    const [x, y] = slot(f, s);
    tl += tile(x, y, C.g2);
  });
  DROPS.forEach((D) => {
    const u = (lt - D.t) / (D.land - D.t);
    if (u > 0 && u < 1) {
      const [px, py] = at(D.p, io(u));
      fx += `<circle cx="${px}" cy="${py}" r="3.5" fill="${C.or}"/>`;
    }
    const p = seg(lt, D.land, D.land + 0.32);
    const [x, y] = slot(D.f, D.s);
    if (lap > 0) tl += tile(x, y, C.g2); // saved in an earlier lap: stays on the grid
    if (lap > 0 || p > 0.5) cnt[D.f]!++;
    if (p <= 0) return;
    tl += tile(x, y - 12 * (1 - ob(p)), mix(D.h ? C.or : C.ink, C.g2, sealed), cl(p * 3));
  });
  // handoff pickup: ring on the note, packet back up to Codex
  const [hx_, hy_] = slot(3, 1);
  const rp = seg(lt, PK0 - 0.3, PK0 + 0.4);
  if (rp > 0 && rp < 1)
    fx += `<rect x="${hx_ - rp * 6}" y="${hy_ - rp * 6}" width="${26 + rp * 12}" height="${26 + rp * 12}" rx="${4 + rp * 4}" fill="none" stroke="${C.or}" opacity="${(1 - rp).toFixed(3)}"/>`;
  const pu = seg(lt, PK0, PK1);
  if (pu > 0 && pu < 1) {
    const [px, py] = at(PICK, io(pu));
    fx += `<circle cx="${px}" cy="${py}" r="3.5" fill="${C.w}" stroke="${C.or}" stroke-width="2"/>`;
  }
  const H = DROPS[9]!;
  const na = lap > 0 ? 1 : seg(lt, H.land + 0.2, H.land + 0.5);
  const nb = lap > 0 ? 1 : seg(lt, PK1, PK1 + 0.3);
  const x3 = col(3) + 12;
  const lh = Math.max(16, env.fs * 1.35);
  const y1 = 260;
  const y2 = y1 + lh;
  const y3 = y2 + lh;
  const x4 = x3 + 4 * env.cw + 6;
  if (na > 0)
    tl +=
      tx(x3, y1, 'next.md', C.ink, { op: na }) +
      (env.narrow
        ? ''
        : tx(x3, y2, 'FROM', C.g3, { op: na }) + tx(x4, y2, 'CLAUDE', C.g3, { op: na }));
  if (nb > 0)
    tl += env.narrow
      ? tx(x3, y2, 'TO CODEX', C.ot, { op: nb })
      : tx(x3, y3, 'TO', C.ot, { op: nb }) + tx(x4, y3, 'CODEX', C.ot, { op: nb });
  // the strip's right side counts the saved files while the left message is short enough to leave room
  const msg = MSG.filter((m) => lt >= m[0]).pop()![1];
  const files = cnt.reduce((a, b) => a + b, 0);
  return {
    bg: chrome('MANY AGENTS · ONE DRIVE', t, T),
    body: body(env),
    keys: k,
    tiles: tl,
    fx,
    strip: strip(
      'te-hs',
      24,
      366,
      472,
      32,
      3,
      typed(MSG, lt),
      msg.length <= 16 ? `${files} FILES` : '',
    ),
  };
};

export function HeroFigure() {
  return (
    <TeFigure
      name="hero"
      frame={frame}
      still={6.6}
      label="Five agents (Claude Code, Codex, pi, opencode and any agent with a shell or MCP) save files into the four folders of one Agent Drive. Claude Code leaves a handoff note that Codex picks up. When the sandbox ends, the files stay."
    />
  );
}
