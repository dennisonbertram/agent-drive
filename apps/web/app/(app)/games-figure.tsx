'use client';
// Games illustration: a 16x16 pixel screen draws one asset of each type, each snaps into the
// fourth row of a 4x4 library, then session two flips through every asset. At the end of the
// loop the library scrolls up one row; nothing is deleted and the asset count keeps growing.
import {
  C,
  TeFigure,
  chrome,
  cl,
  glyph,
  ob,
  pad,
  seg,
  sq,
  strip,
  tx,
  typed,
  vc,
} from './te-figure';
import type { Frame } from './te-figure';

const T = 12;
const A = (s: string) => s.trim().split(/\s+/);
const gen = (f: (x: number, y: number) => string) => {
  const r: string[] = [];
  for (let y = 0; y < 16; y++) {
    let s = '';
    for (let x = 0; x < 16; x++) s += f(x, y);
    r.push(s);
  }
  return r;
};
const bot = A(
  `................ .......oo....... .......xx....... ...xxxxxxxxxx... ...x........x... ...x.oo..oo.x... ...x.oo..oo.x... ...x........x... ...x..xxxx..x... ...x........x... ...xxxxxxxxxx... .....x....x..... ....xxx..xxx.... ................ ................ ................`,
);
const slime = A(
  `................ ................ ................ ................ ......xxxx...... ....xxxxxxxx.... ...xxxxxxxxxx... ..xxx..xx..xxx.. ..xxx..xx..xxx.. ..xxxxxxxxxxxx.. ..xxxxxxxxxxxx.. ..xxoxxxxxxoxx.. ...xxxxxxxxxx... ................ ................ ................`,
);
const coin = A(
  `................ ................ ......xxxx...... ....xxooooxx.... ...xoooooooox... ..xooooxxoooox.. ..xooooxxoooox.. ..xooooxxoooox.. ..xooooxxoooox.. ..xooooxxoooox.. ...xoooooooox... ....xxooooxx.... ......xxxx...... ................ ................ ................`,
);
const tree = A(
  `................ .......xx....... ......xxxx...... .....xxxxxx..... ....xxxxxxxx.... ...xxxxxxxxxx... ......xxxx...... .....xxxxxx..... ....xxxxxxxx.... ...xxxxxxxxxx... ..xxxxxxxxxxxx.. .......oo....... .......oo....... ................ ................ ................`,
);
const brick = gen((x, y) => {
  const b = y >> 2;
  return y % 4 === 3 || (x + (b % 2) * 4) % 8 === 7 ? '.' : b === 1 && x < 7 ? 'o' : 'x';
});
const check = gen((x, y) => (((x >> 2) + (y >> 2)) % 2 ? 'x' : '.'));
const stripe = gen((x, y) => ((x + y) % 6 < 3 ? 'x' : '.'));
const noise = gen((x, y) => {
  const d = Math.abs((x % 8) - 3.5) + Math.abs((y % 8) - 3.5);
  return d < 1.5 ? 'o' : d < 3.5 ? 'x' : '.';
});
const wave = (fq: number, ph: number) =>
  gen((x, y) => {
    if (x % 2) return '.';
    const h = Math.max(
      1,
      Math.round(6.5 * Math.abs(Math.sin(x * fq + ph)) * (1 - Math.abs(x - 7.5) / 10)),
    );
    return Math.abs(y - 7.5) <= h ? 'x' : '.';
  });
const level = (pl: number[][], g: number) =>
  gen((x, y) => {
    if (y >= 14) return x >= g && x < g + 2 ? '.' : 'x';
    for (const [px, py, w] of pl as [number, number, number][]) {
      if (y === py && x >= px && x < px + w) return 'x';
      if (y === py - 2 && x === px + Math.floor(w / 2)) return 'o';
    }
    return '.';
  });
// Library columns are asset types; row R of column c shows ART[c][R % 4].
const TYPES = ['SPR', 'TEX', 'SFX', 'LVL'];
const ART = [
  [bot, slime, coin, tree],
  [brick, check, stripe, noise],
  [wave(0.9, 0.3), wave(1.5, 1), wave(0.55, 2), wave(2.2, 0.4)],
  [
    level(
      [
        [1, 10, 3],
        [6, 7, 4],
        [12, 4, 3],
      ],
      7,
    ),
    level(
      [
        [10, 10, 4],
        [5, 7, 3],
        [1, 4, 3],
      ],
      4,
    ),
    level(
      [
        [2, 11, 2],
        [5, 9, 2],
        [8, 7, 2],
        [11, 5, 3],
      ],
      14,
    ),
    level(
      [
        [1, 5, 4],
        [7, 8, 3],
        [11, 11, 4],
      ],
      5,
    ),
  ],
];
const NAMES = ['TREE', 'NOISE', 'JUMP', 'LEVEL'];
const EXT = ['PNG', 'PNG', 'WAV', 'TMX'];
const artPath = (a: string[], x0: number, y0: number, p: number, s: number, ch: string) => {
  let d = '';
  a.forEach((r, y) => [...r].forEach((c, x) => c === ch && (d += sq(x0 + x * p, y0 + y * p, s))));
  return d;
};
const tileSvg = (a: string[], x: number, y: number) =>
  `<rect x="${x}" y="${y}" width="48" height="48" rx="6" fill="${C.w}"/><path d="${artPath(a, x + 8, y + 8, 2, 2, 'x')}" fill="${C.ink}"/><path d="${artPath(a, x + 8, y + 8, 2, 2, 'o')}" fill="${C.or}"/>`;

const SX = 24;
const SY = 64;
const SW = 216;
const PP = 11;
const PS = 9;
const P0 = SX + (SW - (16 * PP - 2)) / 2;
const P0Y = SY + (SW - (16 * PP - 2)) / 2;
const LX = 280;
const LY = 64;
const TS = 48;
const TG = 8;
const tcx = (c: number) => LX + c * (TS + TG);
const tcy = (r: number) => LY + r * (TS + TG);
const G = [0.6, 2.4, 4.2, 6.0]; // generation start per type
const DRAW = 1.0;
const SAVE = 1.3;
const FLIP0 = 8.5;
const FS = 0.14;

const frame: Frame = (t, env) => {
  const lt = t % T;
  const lap = Math.floor(t / T);
  const slide = seg(lt, 11.3, 11.9);
  const sl = slide * slide * (3 - 2 * slide); // smoothstep for the one-row scroll
  const artAt = (c: number, R: number) => ART[c]![R % 4]!;
  const names = (c: number) => `${NAMES[c]}_${pad(4 + lap, 2)}.${EXT[c]}`;
  // which art is on the screen, and how much of it is drawn
  let art: string[] | null = null;
  let rows = 16;
  let scan = -1;
  let ac = -1;
  G.forEach((g, c) => {
    if (lt >= g && lt < g + 1.8) {
      art = artAt(c, lap + 3);
      ac = c;
      const p = seg(lt, g, g + DRAW);
      rows = Math.floor(p * 16);
      scan = p < 1 ? rows : -1;
    }
  });
  const fi = Math.floor((lt - FLIP0) / FS);
  if (fi >= 0 && fi < 16) {
    art = artAt(fi % 4, lap + Math.floor(fi / 4));
    ac = fi % 4;
  }
  let dx = '';
  let dO = '';
  (art as string[] | null)?.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      const px = P0 + x * PP;
      const py = P0Y + y * PP;
      if (y === scan) dO += sq(px, py, PS);
      else if (y < rows) {
        if (ch === 'x') dx += sq(px, py, PS);
        if (ch === 'o') dO += sq(px, py, PS);
      }
    }),
  );
  let saved = 0;
  G.forEach((g) => {
    if (seg(lt, g + SAVE, g + SAVE + 0.35) > 0) saved++;
  });
  const total = 12 + 4 * lap + saved;
  // the "16" readout: the library size once session two has flipped through it
  const rd = seg(lt, FLIP0 + 16 * FS, FLIP0 + 16 * FS + 0.2) * (1 - seg(lt, 11.3, 11.6));
  if (rd > 0 && !art)
    [...String(Math.min(99, total))].forEach((ch, k) => {
      const g = glyph(ch)!;
      for (let i = 0; i < 35; i++)
        if (g[i] === '1')
          dO += sq(P0 + (2 + k * 6 + (i % 5)) * PP, P0Y + (4 + Math.floor(i / 5)) * PP, PS);
    });
  const scr =
    `<defs><pattern id="te-gp" width="${PP}" height="${PP}" patternUnits="userSpaceOnUse" x="${P0}" y="${P0Y}"><rect width="${PS}" height="${PS}" fill="${C.off}"/></pattern></defs>` +
    `<rect x="${SX}" y="${SY}" width="${SW}" height="${SW}" rx="12" fill="${C.ink}"/><rect x="${P0}" y="${P0Y}" width="${16 * PP - 2}" height="${16 * PP - 2}" fill="url(#te-gp)"/>` +
    `<path d="${dx}" fill="${C.g0}"/><path d="${dO}" fill="${C.or}"/>`;
  // pills under the screen
  let pl = '';
  TYPES.forEach((n, c) => {
    const on = c === ac;
    const x = 24 + c * 56;
    pl +=
      `<rect x="${x}" y="296" width="48" height="24" rx="12" fill="${on ? C.ink : C.g1}"/>` +
      tx(x + 24, vc(308, env), n, on ? C.g0 : C.ink, { a: 'middle' });
    pl += tx(tcx(c) + TS / 2, vc(308, env), n, C.ink, { a: 'middle' });
  });
  // library: rows lap..lap+4 (the last one scrolls in), shifted up by `sl` rows
  let lb = `<defs><clipPath id="te-gc"><rect x="${LX - 4}" y="${LY - 2}" width="${4 * (TS + TG) + 4}" height="${4 * (TS + TG) - TG + 4}"/></clipPath></defs><g clip-path="url(#te-gc)"><g transform="translate(0 ${(-(TS + TG) * sl).toFixed(2)})">`;
  const dash = (x: number, y: number) =>
    `<rect x="${x + 0.5}" y="${y + 0.5}" width="${TS - 1}" height="${TS - 1}" rx="6" fill="none" stroke="${C.g2}" stroke-dasharray="2 3"/>`;
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 5; r++) {
      const x = tcx(c);
      const y = tcy(r);
      if (r < 3) lb += tileSvg(artAt(c, lap + r), x, y);
      else {
        lb += dash(x, y);
        if (r === 4) continue;
        const p = seg(lt, G[c]! + SAVE, G[c]! + SAVE + 0.35);
        if (p > 0) {
          const yy = y - 10 * (1 - ob(p));
          lb += `<g opacity="${cl(p * 3).toFixed(3)}">${tileSvg(artAt(c, lap + 3), x, +yy.toFixed(2))}<circle cx="${x + 41}" cy="${(yy + 7).toFixed(2)}" r="2.5" fill="${C.or}" opacity="${(1 - sl).toFixed(3)}"/></g>`;
        }
      }
    }
  }
  for (let i = 0; i < 16; i++) {
    const h = seg(lt, FLIP0 + i * FS, FLIP0 + i * FS + 0.1) * (1 - seg(lt, 11.3, 11.7));
    if (h <= 0) continue;
    const cur = i === fi;
    lb += `<rect x="${tcx(i % 4) + 0.5}" y="${tcy(Math.floor(i / 4)) + 0.5}" width="${TS - 1}" height="${TS - 1}" rx="5.5" fill="none" stroke="${cur ? C.or : C.ink}" stroke-width="${cur ? 2 : 1}" opacity="${h.toFixed(3)}"/>`;
  }
  lb += '</g></g>';
  const meta =
    tx(24, 344, `16×16 PX · GEN ${pad(saved, 2)}/04`, C.g2) +
    tx(280, 344, 'LIBRARY', C.g2) +
    tx(496, 344, `${pad(total, 2)} ASSETS`, C.ink, { a: 'end' });
  // strip message
  const MSG: [number, string][] = [
    [0, 'NEW SESSION'],
    ...G.flatMap((g, c): [number, string][] => [
      [g, 'GEN ' + names(c)],
      [g + SAVE, 'SAVED ' + names(c)],
    ]),
    [7.7, 'SESSION ENDED'],
    [8.4, 'OPEN LIBRARY'],
  ];
  let msg = typed(MSG, lt);
  if (fi >= 0 && fi < 16) msg = 'LOAD ' + pad(fi + 1, 2) + '/16';
  else if (fi >= 16 && lt < 11.3)
    msg = typed(
      [
        [0, ''],
        [FLIP0 + 16 * FS, lap ? `LATEST 16 OF ${total}` : '16 ASSETS READY'],
      ],
      lt,
    );
  else if (lt >= 11.3) msg = typed([[11.3, 'NEW SESSION']], lt);
  return {
    bg: chrome(
      'AD—02',
      env.narrow ? 'GAME ASSETS' : 'GAME ASSETS · KEPT BETWEEN SESSIONS',
      t,
      T,
      env,
    ),
    scr,
    pills: pl,
    lib: lb,
    meta,
    strip: strip(
      'te-gs',
      24,
      366,
      472,
      32,
      3,
      msg,
      'S' + pad(1 + 2 * lap + (lt >= 8.4 ? 1 : 0), 2),
    ),
  };
};

export function GamesFigure() {
  return (
    <TeFigure
      name="games"
      frame={frame}
      still={11.05}
      label="A game agent draws a sprite, texture, sound and level on a pixel screen and saves each one to the library. The next session opens with all sixteen assets."
    />
  );
}
