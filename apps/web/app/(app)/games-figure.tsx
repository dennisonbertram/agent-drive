// Animated isometric game level: a character walks a loop on a tile island while generated assets
// travel into an Agent Drive. Static SVG; motion is CSS only (see styles/games-figure.css).
const C = 0.866;
const S = 0.5;
type Pt = readonly [number, number];
type Proj = (x: number, y: number, z: number) => Pt;
const proj =
  (ox: number, oy: number): Proj =>
  (x, y, z) => [ox + (x - y) * C, oy + (x + y) * S - z];
const r1 = (n: number) => Math.round(n * 10) / 10;
const pts = (a: Pt[]) => a.map((q) => `${r1(q[0])},${r1(q[1])}`).join(' ');

type BoxSpec = { x: number; y: number; z: number; w: number; d: number; h: number; top?: string };
// Right face is the darker grey, front face the lighter grey, matching the hero figure.
const Box = ({ P, x, y, z, w, d, h, top = 'ka' }: BoxSpec & { P: Proj }) => (
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
      className={top}
      points={pts([P(x, y, z + h), P(x + w, y, z + h), P(x + w, y + d, z + h), P(x, y + d, z + h)])}
    />
  </>
);

// ---- Island: 4x4 tiles, a few raised blocks ----
const T = 40;
const N = 4;
const H = 14;
const LIFT = 12;
const PI = proj(160, 200);
const RAISED = new Set(['1,0', '2,2', '0,3']);
const zOf = (i: number, j: number) => H + (RAISED.has(`${i},${j}`) ? LIFT : 0);
const centre = (i: number, j: number) => PI((i + 0.5) * T, (j + 0.5) * T, zOf(i, j));

const CELLS: [number, number][] = [];
for (let s = 0; s < 2 * N - 1; s++)
  for (let i = 0; i < N; i++) if (s - i >= 0 && s - i < N) CELLS.push([i, s - i]);

// Walk loop (cell coordinates): along row 2, up onto the block at (2,2), back along row 1.
const LOOP: [number, number][] = [
  [0, 2],
  [1, 2],
  [2, 2],
  [3, 2],
  [3, 1],
  [2, 1],
  [1, 1],
  [0, 1],
];
const tr = (p: Pt, lift = 0) => `transform:translate(${r1(p[0])}px,${r1(p[1] - lift)}px)`;
function walkKeyframes() {
  const step = 100 / LOOP.length;
  let css = '';
  LOOP.forEach((w, k) => {
    const nx = LOOP[(k + 1) % LOOP.length]!;
    const a = centre(w[0], w[1]);
    const b = centre(nx[0], nx[1]);
    const t0 = k * step;
    const leave = t0 + step * 0.3;
    const arrive = t0 + step;
    css += `${t0.toFixed(2)}%{${tr(a)}}${leave.toFixed(2)}%{${tr(a)}}`;
    if (zOf(w[0], w[1]) !== zOf(nx[0], nx[1])) {
      const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      css += `${((leave + arrive) / 2).toFixed(2)}%{${tr(mid, 12)}}`;
    }
  });
  return `@keyframes g-walk{${css}100%{${tr(centre(LOOP[0]![0], LOOP[0]![1]))}}}`;
}

// Scales a prop about the ground point under its anchor so it stays on its tile.
const Grow = ({ k, at, children }: { k: number; at: Pt; children: React.ReactNode }) => (
  <g
    transform={`translate(${r1(at[0])} ${r1(at[1])}) scale(${k}) translate(${-r1(at[0])} ${-r1(at[1])})`}
  >
    {children}
  </g>
);

const Tree = () => {
  const [cx, cy] = [(0 + 0.5) * T, (0 + 0.5) * T];
  return (
    <Grow k={1.25} at={PI(cx, cy, H)}>
      <Box P={PI} x={cx - 3} y={cy - 3} z={H} w={6} d={6} h={16} />
      <g className="g-sway">
        <Box P={PI} x={cx - 12} y={cy - 12} z={H + 16} w={24} d={24} h={14} />
        <Box P={PI} x={cx - 8} y={cy - 8} z={H + 30} w={16} d={16} h={12} />
      </g>
    </Grow>
  );
};

const Chest = () => {
  const [cx, cy, z] = [(3 + 0.5) * T, (0 + 0.5) * T, H];
  return (
    <Grow k={1.3} at={PI(cx, cy, z)}>
      <Box P={PI} x={cx - 9} y={cy - 6} z={z} w={18} d={12} h={8} />
      <Box P={PI} x={cx - 9.5} y={cy - 6.5} z={z + 8} w={19} d={13} h={5} />
      <polygon
        className="kled"
        points={pts([
          PI(cx - 2, cy + 6.5, z + 6),
          PI(cx + 2, cy + 6.5, z + 6),
          PI(cx + 2, cy + 6.5, z + 11),
          PI(cx - 2, cy + 6.5, z + 11),
        ])}
      />
    </Grow>
  );
};

// Local origin = foot of the character at the cell centre.
const P0 = proj(0, 0);
const Hero = () => (
  <g className="g-hero" style={{ transform: tr(centre(LOOP[0]![0], LOOP[0]![1])).slice(10) }}>
    <polygon
      className="gshadow"
      points={pts([P0(-7, -7, 0), P0(7, -7, 0), P0(7, 7, 0), P0(-7, 7, 0)])}
    />
    <g transform="scale(1.3)">
      <g className="g-bob">
        <Box P={P0} x={-4} y={-2} z={0} w={3} d={4} h={4} />
        <Box P={P0} x={1} y={-2} z={0} w={3} d={4} h={4} />
        <Box P={P0} x={-5} y={-3.5} z={4} w={10} d={7} h={10} />
        <Box P={P0} x={-5.5} y={-4.5} z={14} w={11} d={9} h={9} />
        <Box P={P0} x={-6} y={-5} z={23} w={12} d={10} h={3} top="gor" />
        <circle
          className="kdot"
          cx={r1(P0(-2.5, 4.5, 18.5)[0])}
          cy={r1(P0(-2.5, 4.5, 18.5)[1])}
          r={1.2}
        />
        <circle
          className="kdot"
          cx={r1(P0(2.5, 4.5, 18.5)[0])}
          cy={r1(P0(2.5, 4.5, 18.5)[1])}
          r={1.2}
        />
      </g>
    </g>
  </g>
);

const Coin = () => {
  const [x, y] = centre(1, 0);
  return (
    <g transform={`translate(${r1(x)} ${r1(y - 22)})`}>
      <text className="kf gl g-plus" x={-8} y={-12}>
        +1
      </text>
      <g className="g-float">
        <g className="g-spin">
          <circle className="gcoin" r={8} />
          <line className="kl" x1={0} y1={-4} x2={0} y2={4} />
        </g>
      </g>
    </g>
  );
};

// ---- Agent Drive (smaller hero drive-stack), up and to the right of the island ----
const D = 76;
const SLAB = 15;
const GAP = 4;
const FOLDERS = ['/sprites', '/levels', '/audio'];
const STACK = FOLDERS.length * SLAB + (FOLDERS.length - 1) * GAP;
const START = PI(N * T + 14, 2 * T + 10, H); // just outside the island's right edge
const DIR = [C, -S] as const; // along the iso -y axis, up and to the right
const TRAVEL = 170;
const END: Pt = [START[0] + DIR[0] * TRAVEL, START[1] + DIR[1] * TRAVEL];
// The connector meets the front face of the bottom folder, to the right of its label.
const PD0 = proj(0, 0);
const face = PD0(D - 9, D, SLAB / 2);
const PD = proj(END[0] - face[0], END[1] - face[1]);
const topD = (z: number) => `matrix(${C} ${S} ${-C} ${S} ${PD(0, 0, z).map(r1).join(' ')})`;
const frontD = (z: number) => `matrix(${C} ${S} 0 1 ${PD(0, D, z).map(r1).join(' ')})`;
const PIXELS = ['010', '111', '101'];

const ASSETS = ['hero-run.png', 'level-03.json', 'theme.ogg'];

export function GamesFigure() {
  const head = PD(D / 2, D / 2, STACK);
  return (
    <figure className="landing-fig games-fig">
      <style>{walkKeyframes()}</style>
      <svg
        viewBox="12 94 448 278"
        role="img"
        aria-label="An animated isometric video-game level: a small blocky character walks a loop across a tile island with a tree and a treasure chest while a coin spins. Generated game assets (hero-run.png, level-03.json, theme.ogg) rise along a dashed line into an Agent Drive, which keeps them for the next session."
      >
        <g aria-hidden="true">
          {/* Connector, then the drive over its upper end */}
          <polyline className="gcon" points={pts([START, END])} />
          <circle className="kdot" cx={r1(START[0])} cy={r1(START[1])} r={2.5} />
          {/* Drive, back to front */}
          {FOLDERS.map((f, i) => {
            const z = i * (SLAB + GAP);
            return (
              <g key={f}>
                <Box P={PD} x={0} y={0} z={z} w={D} d={D} h={SLAB} />
                <g transform={frontD(z)}>
                  <text className="kf gf" x={8} y={SLAB - 5}>
                    {f}
                  </text>
                </g>
              </g>
            );
          })}
          <g transform={topD(STACK)}>
            <circle className="kled" cx={D - 16} cy={16} r={5.5} />
            <circle className="gring" cx={D - 16} cy={16} r={5.5} />
          </g>
          <text
            className="kn gt"
            x={r1(head[0])}
            y={r1(PD(0, 0, STACK)[1] - 12)}
            textAnchor="middle"
          >
            Agent Drive
          </text>

          {/* Island */}
          {CELLS.map(([i, j]) => (
            <g key={`${i}${j}`}>
              <Box
                P={PI}
                x={i * T}
                y={j * T}
                z={0}
                w={T}
                d={T}
                h={H}
                top={(i + j) % 2 ? 'gtile' : 'ka'}
              />
              {RAISED.has(`${i},${j}`) && (
                <Box
                  P={PI}
                  x={i * T + 3}
                  y={j * T + 3}
                  z={H}
                  w={T - 6}
                  d={T - 6}
                  h={LIFT}
                  top={(i + j) % 2 ? 'gtile' : 'ka'}
                />
              )}
            </g>
          ))}
          <Tree />
          <Chest />
          <Coin />
          <Hero />

          {/* Assets leaving the scene, one after another */}
          {ASSETS.map((a, i) => (
            <g
              key={a}
              className={i ? 'g-extra' : undefined}
              transform={`translate(${r1(START[0])} ${r1(START[1])})`}
            >
              <ellipse
                className="gpulse"
                style={{ animationDelay: `${i * 3}s` }}
                rx={12}
                ry={6.9}
              />
              <g
                className="g-asset"
                style={{
                  animationDelay: `${i * 3}s`,
                  ['--p' as string]: 0.5,
                  ['--dx' as string]: `${r1(DIR[0] * TRAVEL)}px`,
                  ['--dy' as string]: `${r1(DIR[1] * TRAVEL)}px`,
                }}
              >
                <g transform="translate(0 -4)">
                  <Box P={P0} x={-11} y={-20} z={0} w={22} d={40} h={9} />
                  {i === 0 && (
                    <g
                      transform={`matrix(${C} ${S} ${-C} ${S} ${P0(-11, -20, 9).map(r1).join(' ')})`}
                    >
                      {PIXELS.flatMap((row, v) =>
                        [...row].map((c, u) =>
                          c === '1' ? (
                            <rect
                              key={`${u}${v}`}
                              className={u === 1 && v === 1 ? 'gor' : 'kdot'}
                              x={3 + u * 5.2}
                              y={12.5 + v * 5.2}
                              width={5.2}
                              height={5.2}
                            />
                          ) : null,
                        ),
                      )}
                    </g>
                  )}
                  <text className="kf gl" x={14} y={8}>
                    {a}
                  </text>
                </g>
              </g>
            </g>
          ))}
        </g>
      </svg>
    </figure>
  );
}
