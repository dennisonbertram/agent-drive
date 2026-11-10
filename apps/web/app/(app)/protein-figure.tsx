'use client';
// Protein illustration: a stylised backbone turns once per loop as a dot-matrix point cloud
// while files fill bars on a log scale (10 MB to 10 GB) that marks GitHub's 100 MB limit.
// Each loop after the first adds one more file and scrolls the list up a row; nothing is removed.
import { C, TeFigure, chrome, cl, io, mix, pad, seg, strip, tx } from './te-figure';
import type { Frame } from './te-figure';

const T = 12;
// ---- backbone: a three-strand sheet in front, four helices packed behind, joined by loops (angstroms)
const pts: number[][] = [];
const add = (p: number[], k: number) => pts.push([...p, k]);
const helix = (x: number, z: number, y0: number, y1: number, n: number) => {
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    const a = i * 1.745;
    add([x + 2.6 * Math.cos(a), y0 + (y1 - y0) * u, z + 2.6 * Math.sin(a)], 0);
  }
};
const strand = (x: number, z: number, y0: number, y1: number, n: number) => {
  for (let i = 0; i < n; i++) add([x, y0 + ((y1 - y0) * i) / (n - 1), z + (i % 2 ? 0.6 : -0.6)], 1);
};
const loop = (b: number[], n: number, bulge: number[]) => {
  const a = pts[pts.length - 1]!;
  for (let i = 1; i <= n; i++) {
    const u = i / (n + 1);
    const s = Math.sin(Math.PI * u);
    add(
      [0, 1, 2].map((q) => a[q]! + (b[q]! - a[q]!) * u + bulge[q]! * s),
      2,
    );
  }
};
strand(-4.8, 6, -9, 9, 6);
loop([0, 9, 6], 2, [0, 3, 1]);
strand(0, 6, 9, -9, 6);
loop([4.8, -9, 6], 2, [0, -3, 1]);
strand(4.8, 6, -9, 9, 6);
loop([10, 10, -1], 4, [3, 3, 2]);
helix(10, -1, 10, -10, 14);
loop([4, -10, -8], 3, [0, -3, -1]);
helix(4, -8, -10, 10, 14);
loop([-4, 10, -8], 3, [0, 3, -1]);
helix(-4, -8, 10, -10, 14);
loop([-10, -10, -1], 3, [-1, -3, 0]);
helix(-10, -1, -10, 10, 14);
// densify between residues with Catmull-Rom curves
const cr = (a: number, b: number, c: number, d: number, u: number) =>
  0.5 *
  (2 * b +
    (-a + c) * u +
    (2 * a - 5 * b + 4 * c - d) * u * u +
    (-a + 3 * b - 3 * c + d) * u * u * u);
const P: number[][] = [];
for (let i = 0; i < pts.length - 1; i++) {
  const a = pts[Math.max(0, i - 1)]!;
  const b = pts[i]!;
  const c = pts[i + 1]!;
  const d = pts[Math.min(pts.length - 1, i + 2)]!;
  for (let k = 0; k < 8; k++)
    P.push(
      [0, 1, 2].map((q) => cr(a[q]!, b[q]!, c[q]!, d[q]!, k / 8)).concat(b[3] === c[3] ? b[3]! : 2),
    );
}
// ---- screen and dot grid
const SX = 24;
const SY = 64;
const SW = 216;
const N = 32;
const PIT = 6;
const G0 = SX + (SW - N * PIT) / 2 + PIT / 2;
const GY = G0 - SX + SY;
const CX = SX + SW / 2;
const CY = SY + SW / 2 - 2;
const SCL = 6.2;
// colour by [kind: helix, strand, loop][depth band: far, mid, near]
const COL = [
  [C.g3, mix(C.g2, C.g0, 0.3), C.g0],
  [mix(C.or, C.ink, 0.5), mix(C.or, C.ink, 0.2), C.or],
  ['#3d3c39', C.g3, C.g2],
];
const RAD = [1.2, 1.9, 2.6];
// ---- file rows on a log scale
const RX = 264;
const RW = 232;
const lg = (mb: number) => RX + RW * cl((Math.log10(Math.max(mb, 10)) - 1) / 3);
// Sizes of the density map and embeddings.npy come from the brief; the later runs are illustrative.
const FILE = (n: number) =>
  n === 0
    ? { n: '7XKA_map.mrc', gb: 1.4 }
    : n === 1
      ? { n: 'embeddings.npy', gb: 3.2 }
      : { n: `sim/run_${pad(40 + n, 3)}.dcd`, gb: 2.6 };
const START = [0.6, 2.2, 4.4]; // lap 0 upload starts; later laps upload one file from 1.0
const LEN = [2.6, 3.8, 3.2];
const RY = (i: number, narrow: boolean) => (narrow ? 114 + i * 64 : 120 + i * 56);

const frame: Frame = (t, env) => {
  const pitch = env.narrow ? 64 : 56; // phone rows put the size on its own line under the bar
  const lt = t % T;
  const lap = Math.floor(t / T);
  const slide = io(seg(lt, 11, 11.8));
  // ---- rotating point cloud
  const th = (2 * Math.PI * lt) / T;
  const ph = 0.5 + 0.1 * Math.sin(th);
  const [ct, st, cp, sp] = [Math.cos(th), Math.sin(th), Math.cos(ph), Math.sin(ph)];
  const cell = new Map<number, number[]>();
  P.forEach(([x, y, z, k]) => {
    const x1 = x! * ct! + z! * st!;
    const z1 = -x! * st! + z! * ct!;
    const y2 = y! * cp! - z1 * sp!;
    const z2 = y! * sp! + z1 * cp!;
    const i = Math.round((CX + x1 * SCL - G0) / PIT);
    const j = Math.round((CY + y2 * SCL - GY) / PIT);
    if (i < 0 || j < 0 || i >= N || j >= N) return;
    const key = i * N + j;
    const c = cell.get(key);
    if (!c || z2 > c[0]!) cell.set(key, [z2, k!, i, j]);
  });
  const D = COL.map((r) => r.map(() => ''));
  cell.forEach(([z, k, i, j]) => {
    const b = z! < -4 ? 0 : z! < 3 ? 1 : 2;
    D[k!]![b] += `M${(G0 + i! * PIT).toFixed(1)} ${(GY + j! * PIT).toFixed(1)}h0`;
  });
  const scr =
    `<defs><pattern id="te-pp" width="${PIT}" height="${PIT}" patternUnits="userSpaceOnUse" x="${G0 - PIT / 2}" y="${GY - PIT / 2}"><circle cx="${PIT / 2}" cy="${PIT / 2}" r=".8" fill="${C.off}"/></pattern></defs>` +
    `<rect x="${SX}" y="${SY}" width="${SW}" height="${SW}" rx="12" fill="${C.ink}"/><rect x="${G0 - PIT / 2}" y="${GY - PIT / 2}" width="${N * PIT}" height="${N * PIT}" fill="url(#te-pp)"/>` +
    COL.map((r, k) =>
      r
        .map(
          (c, b) =>
            `<path d="${D[k]![b]}" stroke="${c}" stroke-width="${RAD[b]! * 2}" stroke-linecap="round" fill="none"/>`,
        )
        .join(''),
    ).join('');
  // ---- files. Lap 0 uploads files 0-2; lap k>0 shows files k..k+2 and uploads file k+2.
  const first = lap === 0 ? 0 : lap;
  let before = 0; // files scrolled out of the list still count toward the total
  for (let n = 0; n < first; n++) before += FILE(n).gb;
  let tot = before;
  let done = first;
  let act: [string, number] | null = null;
  // The list scrolls inside its own band (below the axis, above the meta row); a row's text is
  // drawn only while it lies wholly inside the band, so it never passes under other labels.
  const top = env.narrow ? 92 : 98;
  const bot = env.narrow ? 285 : 254;
  const inBand = (ty: number) => ty - 1.02 * env.fs >= top && ty + 0.32 * env.fs <= bot;
  let rowsSvg = `<defs><clipPath id="te-pc"><rect x="${RX - 6}" y="${top}" width="${RW + 12}" height="${bot - top}"/></clipPath></defs><g clip-path="url(#te-pc)"><g transform="translate(0 ${(-pitch * slide).toFixed(2)})">`;
  for (let i = 0; i < 4; i++) {
    const f = FILE(first + i);
    const p =
      i === 3
        ? 0
        : lap === 0
          ? seg(lt, START[i]!, START[i]! + LEN[i]!)
          : i === 2
            ? seg(lt, 1, 1 + LEN[2]!)
            : 1;
    const v = f.gb * io(p);
    if (i < 3) {
      tot += v;
      if (p >= 1) done++;
      if (p > 0 && p < 1) act = [f.n, p];
    }
    const y = RY(i, env.narrow);
    const sy = pitch * slide;
    const nameOk = inBand(y - sy);
    const sizeOk = inBand(y - sy + (env.narrow ? 36 : 0));
    const ok = p >= 1;
    const w = v > 0 ? Math.max(8, lg(v * 1000) - RX) : 0;
    const size = ok ? `${f.gb.toFixed(1)} GB` : `${v.toFixed(2)} / ${f.gb.toFixed(1)} GB`;
    rowsSvg +=
      `<rect x="${RX}" y="${y + 8}" width="${RW}" height="8" rx="4" fill="${C.g1}"/>` +
      (w
        ? `<rect x="${RX}" y="${y + 8}" width="${w.toFixed(2)}" height="8" rx="4" fill="${C.or}"/>`
        : '') +
      `<path d="M${lg(100) + 0.5} ${y + 5}V${y + 19}" stroke="${C.ink}"/>` +
      `<rect x="${RX + 0.5}" y="${y - 7.5}" width="8" height="8" rx="1.5" fill="${ok ? C.or : 'none'}" stroke="${ok ? C.or : C.ink}"/>` +
      (nameOk ? tx(RX + 16, y, f.n, C.ink) : '') +
      (sizeOk ? tx(RX + RW, y + (env.narrow ? 36 : 0), size, ok ? C.ink : C.g3, { a: 'end' }) : '');
  }
  rowsSvg += '</g></g>';
  // ---- log axis
  let ax = `<path d="M${RX} 86.5H${RX + RW}" stroke="${C.ink}"/>`;
  const labels: [number, string, string][] = [
    [10, '10 MB', 'start'],
    [100, env.narrow ? 'GIT LIMIT' : env.compact ? 'GIT 100 MB' : 'GITHUB 100 MB', 'middle'],
    [1000, '1 GB', 'middle'],
    [10000, '10 GB', 'end'],
  ];
  labels.forEach(([mb, l, a]) => {
    const x = lg(mb) + (mb === 10000 ? -0.5 : 0.5);
    ax += `<path d="M${x} 80V86" stroke="${mb === 100 ? C.or : C.ink}"/>`;
    if (env.narrow ? mb === 100 : !(env.compact && mb === 10))
      ax += tx(mb === 10 ? RX : mb === 10000 ? RX + RW : x, 74, l, mb === 100 ? C.ot : C.g3, { a });
  });
  for (let m = 20; m < 10000; m *= 10)
    for (let k = 2; k < 10; k++)
      ax += `<path d="M${lg((m / 2) * k).toFixed(1)} 83V86" stroke="${C.g2}"/>`;
  // ---- readouts
  const gbText = tot.toFixed(2);
  const sw = env.narrow ? 14 : 18;
  let lgd = '';
  let lx = 24;
  (
    [
      ['HELIX', C.g0],
      ['STRAND', C.or],
      ['LOOP', C.g2],
    ] as const
  ).forEach(([l, c], i) => {
    const x = env.compact ? lx : 24 + i * 72;
    const box = env.narrow ? 10 : 12;
    lgd +=
      `<rect x="${x}" y="${339 - box / 2}" width="${box}" height="${box}" rx="3" fill="${C.ink}"/><circle cx="${x + box / 2}" cy="339" r="2.5" fill="${c}"/>` +
      tx(x + sw, 343, l, C.ink);
    lx += sw + l.length * env.cw + (env.narrow ? 6 : 12);
  });
  const meta =
    tx(24, 306, 'PROTEIN BACKBONE', C.g3) +
    (env.narrow ? '' : lgd) + // phones drop the dot legend (it collided with the GB readout)
    tx(RX, 306, env.compact ? 'IN DRIVE' : 'IN AGENT DRIVE', C.g3) +
    tx(
      RX + RW,
      306,
      env.narrow ? '0 IN GIT' : `${lap === 0 ? done + '/3' : done} FILES · 0 IN GIT`,
      C.g3,
      { a: 'end' },
    ) +
    `<text class="big" x="${RX - 2}" y="352" font-size="34" fill="${C.ink}">${gbText}</text>` +
    tx(RX - 2 + gbText.length * 20.4 + 6, 352, 'GB', C.ink);
  const a = act as [string, number] | null;
  const m = a
    ? ['> ' + a[0], pad(Math.floor(a[1] * 100), 3) + '%']
    : done >= first + 3
      ? [`SAVED ${done} FILES`, tot.toFixed(2) + ' GB']
      : lt >= 11
        ? ['NEXT RUN', '']
        : ['DRIVE READY', ''];
  return {
    bg: chrome('PROTEIN DATA · TOO BIG FOR GIT', t, T),
    scr,
    ax,
    rows: rowsSvg,
    meta,
    strip: strip('te-ps', 24, 366, 472, 32, 3, m[0]!, m[1]),
  };
};

export function ProteinFigure() {
  return (
    <TeFigure
      name="protein"
      frame={frame}
      still={9.5}
      label="A protein backbone rotates on a dot-matrix screen while a structure file, embeddings and a simulation run, each far above GitHub's 100 MB file limit, upload into Agent Drive."
    />
  );
}
