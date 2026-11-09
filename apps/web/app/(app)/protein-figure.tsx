'use client';
import { useEffect, useRef } from 'react';
import '../styles/protein-figure.css';

/* ---------- 3D backbone: parametric helices, strands and loops ---------- */
type V = [number, number, number];
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k];
const len = (a: V) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V) => mul(a, 1 / (len(a) || 1));
const cross = (a: V, b: V): V => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

// A prim is one drawn shape. ribbon: 4 points, only the two long edges are stroked.
// tube: 2 points, drawn as a thin ribbon. solid: any polygon, fully outlined, shade top or side. dot: one point.
type Prim = { kind: 'ribbon' | 'tube' | 'solid' | 'dot'; p: V[]; side?: boolean };

function helix(A: V, B: V, r: number, turns: number, phase: number) {
  const axis = sub(B, A);
  const a = unit(axis);
  const u = unit(cross(a, Math.abs(a[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]));
  const w = cross(a, u);
  const n = Math.round(turns * 26);
  const half = mul(a, 5.5);
  const c: V[] = [];
  for (let i = 0; i <= n; i++) {
    const s = i / n;
    const t = phase + Math.PI * 2 * turns * s;
    c.push(add(add(A, mul(axis, s)), add(mul(u, r * Math.cos(t)), mul(w, r * Math.sin(t)))));
  }
  const prims: Prim[] = [];
  for (let i = 0; i < n; i++) {
    prims.push({
      kind: 'ribbon',
      p: [sub(c[i]!, half), add(c[i]!, half), add(c[i + 1]!, half), sub(c[i + 1]!, half)],
    });
  }
  return {
    prims,
    start: c[0]!,
    end: c[n]!,
    tan0: unit(sub(c[1]!, c[0]!)),
    tan1: unit(sub(c[n]!, c[n - 1]!)),
    c,
  };
}

// A flat arrow with a little thickness: top face, bottom face and one side face per outline edge.
function strand(A: V, B: V, across: V) {
  const d = sub(B, A);
  const a = unit(d);
  const e = mul(unit(across), 8);
  const th = mul(unit(cross(a, e)), 2.5);
  const bodyEnd = add(A, mul(d, 0.66));
  const wide = mul(e, 1.9);
  const ring: V[] = [
    sub(A, e),
    sub(bodyEnd, e),
    sub(bodyEnd, wide),
    B,
    add(bodyEnd, wide),
    add(bodyEnd, e),
    add(A, e),
  ];
  const prims: Prim[] = [
    { kind: 'solid', p: ring.map((q) => add(q, th)) },
    { kind: 'solid', p: ring.map((q) => sub(q, th)) },
  ];
  for (let i = 0; i < ring.length; i++) {
    const q0 = ring[i]!;
    const q1 = ring[(i + 1) % ring.length]!;
    prims.push({
      kind: 'solid',
      side: true,
      p: [add(q0, th), add(q1, th), sub(q1, th), sub(q0, th)],
    });
  }
  return { prims, start: A, end: B, tan: a };
}

function loop(p0: V, t0: V, p3: V, t3: V, k: number) {
  const dist = len(sub(p3, p0));
  const p1 = add(p0, mul(t0, dist * k));
  const p2 = sub(p3, mul(t3, dist * k));
  const prims: Prim[] = [];
  const n = 20;
  let prev = p0;
  for (let i = 1; i <= n; i++) {
    const s = i / n;
    const m = 1 - s;
    const q = add(
      add(mul(p0, m * m * m), mul(p1, 3 * m * m * s)),
      add(mul(p2, 3 * m * s * s), mul(p3, s * s * s)),
    );
    prims.push({ kind: 'tube', p: [prev, q] });
    prev = q;
  }
  return prims;
}

function build(): Prim[] {
  const h1 = helix([-90, -80, 22], [-80, 40, 18], 20, 4.2, 0);
  const s1 = strand([-50, 72, -14], [52, 66, -14], [0, 0, 1]);
  const s2 = strand([52, 66, 14], [-50, 72, 14], [0, 0, 1]);
  const h2 = helix([-6, 22, 12], [62, -62, 12], 20, 3.6, 1);
  const h3 = helix([44, -74, -48], [-42, -36, -44], 18, 3.6, 2);
  const prims = [
    ...h1.prims,
    ...loop(h1.end, h1.tan1, s1.start, s1.tan, 0.5),
    ...s1.prims,
    ...loop(s1.end, s1.tan, s2.start, [-1, 0, 0], 0.45),
    ...s2.prims,
    ...loop(s2.end, s2.tan, h2.start, h2.tan0, 0.45),
    ...h2.prims,
    ...loop(h2.end, h2.tan1, h3.start, h3.tan0, 0.5),
    ...h3.prims,
  ];
  // Orange accent: one "active site" residue on the middle helix.
  prims.push({ kind: 'dot', p: [h2.c[Math.floor(h2.c.length * 0.55)]!] });
  // Recentre on the centroid.
  const all = prims.flatMap((q) => q.p);
  const m = all.reduce<V>((s, q) => add(s, q), [0, 0, 0]);
  const c = mul(m, -1 / all.length);
  return prims.map((q) => ({ ...q, p: q.p.map((v) => add(v, c)) }));
}

const PRIMS = build();

// Orthographic projection after a turn about the vertical axis and a fixed downward tilt.
const CX = 200;
const CY = 128;
const K = 1.15;
const TILT = (24 * Math.PI) / 180;
const f1 = (n: number) => n.toFixed(1);

type Pt = [number, number];
type Frame = { pts: Pt[]; depth: number; front: boolean; t: number; r: number };
function frame(prim: Prim, theta: number): Frame {
  const ct = Math.cos(theta);
  const st = Math.sin(theta);
  const cp = Math.cos(TILT);
  const sp = Math.sin(TILT);
  let depth = 0;
  let pts = prim.p.map(([x, y, z]) => {
    const xr = x * ct + z * st;
    const zr = -x * st + z * ct;
    depth += zr * cp + y * sp;
    return [CX + xr * K, CY - (y * cp - zr * sp) * K] as Pt;
  });
  depth /= prim.p.length;
  const t = Math.min(1, Math.max(0, (depth + 110) / 220)); // 0 far, 1 near
  let front = true;
  if (prim.kind === 'tube') {
    const [a, b] = pts as [Pt, Pt];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    const w = (1.3 + 1.4 * t) / l;
    pts = [
      [a[0] - dy * w, a[1] + dx * w],
      [a[0] + dy * w, a[1] - dx * w],
      [b[0] + dy * w, b[1] - dx * w],
      [b[0] - dy * w, b[1] + dx * w],
    ];
  } else if (prim.kind !== 'dot') {
    const [a, b, c] = pts as [Pt, Pt, Pt];
    front = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) < 0;
  }
  return { pts, depth, front, t, r: 3.5 + 2.5 * t };
}

const pairs = (q: Pt[]) => q.map((v) => `${f1(v[0])},${f1(v[1])}`);
const polyPoints = (f: Frame) => pairs(f.pts).join(' ');
const faceClass = (prim: Prim, f: Frame) => (prim.side ? 'pf-f3' : f.front ? 'pf-f1' : 'pf-f2');
// Ribbons and tubes stroke only their two long edges, so no cross lines show.
const edgePath = (prim: Prim, f: Frame) => {
  const s = pairs(f.pts);
  return prim.kind === 'solid' ? `M${s.join('L')}Z` : `M${s[0]}L${s[3]}M${s[1]}L${s[2]}`;
};
const edgeStyle = (f: Frame) => ({
  strokeWidth: f1(0.7 + 0.9 * f.t),
  strokeOpacity: f1(0.3 + 0.7 * f.t),
});

function sorted(theta: number) {
  return PRIMS.map((prim, i) => ({ prim, i, f: frame(prim, theta) })).sort(
    (a, b) => a.f.depth - b.f.depth,
  );
}

const REST_ANGLE = 2.4;
const RING_R = 108 * K;
const RING_Y = CY + 100 * K * Math.cos(TILT);
const SECONDS_PER_TURN = 26;

/* ---------- data panel: files flowing into a drive, same isometric projection as the hero ---------- */
const C = 0.866;
const S = 0.5;
const OX = 305;
const OY = 176;
const P = (x: number, y: number, z: number) => [OX + (x - y) * C, OY + (x + y) * S - z] as const;
const pts = (a: (readonly [number, number])[]) => a.map((q) => q.map(f1).join(',')).join(' ');
const topM = (x: number, y: number, z: number) =>
  `matrix(${C} ${S} ${-C} ${S} ${P(x, y, z).map(f1).join(' ')})`;
const frontM = (x: number, y: number, z: number) =>
  `matrix(${C} ${S} 0 1 ${P(x, y, z).map(f1).join(' ')})`;

type BoxSpec = { x: number; y: number; z: number; w: number; d: number; h: number };
const Box = ({ x, y, z, w, d, h }: BoxSpec) => (
  <>
    <polygon
      className="ks2"
      points={pts([P(x + w, y, z), P(x + w, y + d, z), P(x + w, y + d, z + h), P(x + w, y, z + h)])}
    />
    <polygon
      className="ks1"
      points={pts([P(x, y + d, z), P(x + w, y + d, z), P(x + w, y + d, z + h), P(x, y + d, z + h)])}
    />
    <polygon
      className="ka"
      points={pts([P(x, y, z + h), P(x + w, y, z + h), P(x + w, y + d, z + h), P(x, y + d, z + h)])}
    />
  </>
);

const FOLDERS = ['/structures', '/embeddings', '/runs'];
const SLAB = 22;
const GAP = 5;
const D = 100;
const STACK = FOLDERS.length * SLAB + (FOLDERS.length - 1) * GAP;
const FILES = [
  { name: '7XKA.pdb', size: '1.4 GB', y: 10 },
  { name: 'embeddings.npy', size: '3.2 GB', y: 48 },
  { name: 'trajectory.xtc', size: '1.8 GB', y: 86 },
];
const X0 = -170; // file start, in ground x
const TRAVEL = 190; // distance a file moves before it has vanished into the drive
const REST = [0.12, 0.12, 0.12]; // static resting progress (reduced motion shows only the first file)
const FW = 46;
const FD = 18;
const FH = 9;
const TAG_W = 122;
const TAG_H = 38;

export function ProteinFigure() {
  const g = useRef<SVGGElement>(null);
  const ring = useRef<SVGEllipseElement>(null);
  const root = useRef<HTMLElement>(null);

  useEffect(() => {
    const group = g.current;
    const el = root.current;
    if (!group || !el) return;
    const nodes: SVGElement[] = [];
    for (const n of Array.from(group.children))
      nodes[Number((n as SVGElement).dataset.i)] = n as SVGElement;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    let theta = REST_ANGLE;
    let raf = 0;
    let last = 0;
    let visible = false;

    const draw = () => {
      for (const { prim, i, f } of sorted(theta)) {
        const n = nodes[i]!;
        if (prim.kind === 'dot') {
          const [q] = f.pts as [[number, number]];
          n.setAttribute('cx', f1(q[0]));
          n.setAttribute('cy', f1(q[1]));
          n.setAttribute('r', f1(f.r));
        } else {
          const [poly, edge] = [n.firstElementChild!, n.lastElementChild as SVGElement];
          poly.setAttribute('points', polyPoints(f));
          poly.setAttribute('class', faceClass(prim, f));
          edge.setAttribute('d', edgePath(prim, f));
          const es = edgeStyle(f);
          edge.style.strokeWidth = es.strokeWidth;
          edge.style.strokeOpacity = es.strokeOpacity;
        }
        group.appendChild(n);
      }
      ring.current?.style.setProperty('stroke-dashoffset', f1(-theta * RING_R));
    };

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - last < 33) return; // ~30 fps is plenty for a slow turn
      theta += ((now - (last || now)) / 1000) * ((Math.PI * 2) / SECONDS_PER_TURN);
      last = now;
      draw();
    };
    const run = () => {
      const should = visible && !document.hidden && !reduce.matches;
      if (should && !raf) {
        last = 0;
        raf = requestAnimationFrame(tick);
      } else if (!should && raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };
    const io = new IntersectionObserver(([e]) => {
      visible = !!e?.isIntersecting;
      run();
    });
    io.observe(el);
    document.addEventListener('visibilitychange', run);
    reduce.addEventListener('change', run);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      document.removeEventListener('visibilitychange', run);
      reduce.removeEventListener('change', run);
    };
  }, []);

  const first = sorted(REST_ANGLE);
  return (
    <figure
      ref={root}
      className="landing-fig protein-fig"
      role="img"
      aria-label="A protein drawn as a slowly turning 3D line drawing of alpha helices and beta strands. Next to it, its data files (a structure file, embeddings and a simulation trajectory, gigabytes each) flow into an Agent Drive."
    >
      <svg viewBox="45 0 310 310" aria-hidden="true" focusable="false">
        <ellipse
          ref={ring}
          className="pf-ring"
          cx={CX}
          cy={RING_Y}
          rx={RING_R}
          ry={RING_R * Math.sin(TILT)}
        />
        <g ref={g}>
          {first.map(({ prim, i, f }) =>
            prim.kind === 'dot' ? (
              <circle
                key={i}
                data-i={i}
                className="kled"
                cx={f1(f.pts[0]![0])}
                cy={f1(f.pts[0]![1])}
                r={f1(f.r)}
              />
            ) : (
              <g key={i} data-i={i}>
                <polygon className={faceClass(prim, f)} points={polyPoints(f)} />
                <path className="pf-e" d={edgePath(prim, f)} style={edgeStyle(f)} />
              </g>
            ),
          )}
        </g>
        <text className="kt" x={CX} y={302} textAnchor="middle" style={{ fontSize: 12.5 }}>
          PROTEIN 7XKA · HELICES + STRANDS
        </text>
      </svg>

      <svg viewBox="20 30 410 280" aria-hidden="true" focusable="false">
        {/* Connectors first, so no line is ever drawn over a label. */}
        {FILES.map((f) => (
          <polyline
            key={f.name}
            className="kp pf-flow"
            points={pts([P(X0, f.y + FD / 2, 0), P(0, f.y + FD / 2, 0)])}
          />
        ))}
        {FILES.map((f, k) => {
          const [lx, ly] = P(FW / 2, f.y + FD / 2, FH);
          return (
            <g
              key={f.name}
              className={k === 0 ? 'pf-file' : 'pf-file pf-extra'}
              style={
                {
                  '--delay': `${k * 3}s`,
                  '--ex': `${f1(C * TRAVEL)}px`,
                  '--ey': `${f1(S * TRAVEL)}px`,
                  '--rx': `${f1(C * TRAVEL * REST[k]!)}px`,
                  '--ry': `${f1(S * TRAVEL * REST[k]!)}px`,
                } as React.CSSProperties
              }
            >
              <g transform={`translate(${f1(C * X0)} ${f1(S * X0)})`}>
                <Box x={0} y={f.y} z={0} w={FW} d={FD} h={FH} />
                <line className="kl" x1={lx} y1={ly} x2={lx} y2={ly - 10} />
                <rect
                  className="ka"
                  x={lx - TAG_W / 2}
                  y={ly - 10 - TAG_H}
                  width={TAG_W}
                  height={TAG_H}
                />
                <text
                  className="kn"
                  x={lx}
                  y={ly - 10 - TAG_H + 16}
                  textAnchor="middle"
                  style={{ fontSize: 14 }}
                >
                  {f.name}
                </text>
                <text
                  className="kt"
                  x={lx}
                  y={ly - 10 - TAG_H + 31}
                  textAnchor="middle"
                  style={{ fontSize: 13.5, letterSpacing: 0 }}
                >
                  {f.size}
                </text>
              </g>
            </g>
          );
        })}
        {FOLDERS.map((name, i) => {
          const z = i * (SLAB + GAP);
          return (
            <g key={name}>
              <Box x={0} y={0} z={z} w={D} d={D} h={SLAB} />
              <g transform={frontM(0, D, z)}>
                <text className="kf" x={10} y={SLAB - 7} style={{ fontSize: 13 }}>
                  {name}
                </text>
              </g>
            </g>
          );
        })}
        <g transform={topM(0, 0, STACK)}>
          <circle className="kled" cx={D - 16} cy={16} r={5.5} />
        </g>
        <text
          className="kn"
          x={P(D, 0, STACK)[0]}
          y={P(0, 0, STACK)[1] - 22}
          textAnchor="end"
          style={{ fontSize: 15 }}
        >
          Agent Drive
        </text>
      </svg>
    </figure>
  );
}
