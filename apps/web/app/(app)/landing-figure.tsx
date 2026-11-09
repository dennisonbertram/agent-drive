// Static server-rendered isometric SVG: one Agent Drive (a stack of folders) wired to four verified agent tools plus a generic tile.
const FOLDERS = ['/memory', '/outputs', '/work', '/handoff'];

// 24x24 icon paths (Simple Icons, CC0). Products without an icon show a lettered black square;
// swap in official logos later by setting `icon` on the entry.
const ICON = {
  claude:
    'm4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z',
};
type Tool = { name: string; letter: string; icon?: string };
// Only tools we have verified, plus a generic tile for everything else.
const TOOLS: Tool[] = [
  { name: 'Claude Code', letter: 'Cc', icon: ICON.claude },
  { name: 'Codex', letter: 'Cx' },
  { name: 'pi', letter: 'Pi' },
  { name: 'opencode', letter: 'Oc' },
  { name: 'Any agent with a shell or MCP', letter: '+' },
];

// Isometric projection: x runs right-down, y runs left-down, z runs up.
const C = 0.866;
const S = 0.5;
const OX = 232;
const OY = 150;
const P = (x: number, y: number, z: number) => [OX + (x - y) * C, OY + (x + y) * S - z] as const;
const pts = (a: (readonly [number, number])[]) => a.map((q) => q.join(',')).join(' ');
// Maps flat drawing coordinates onto a horizontal face, or onto the face that spans x.
const topM = (x: number, y: number, z: number) =>
  `matrix(${C} ${S} ${-C} ${S} ${P(x, y, z).join(' ')})`;
const frontM = (x: number, y: number, z: number) => `matrix(${C} ${S} 0 1 ${P(x, y, z).join(' ')})`;

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

const Tile = ({ t, x, y, w, d, h = 22 }: { t: Tool; h?: number } & Omit<BoxSpec, 'z' | 'h'>) => (
  <>
    <Box x={x} y={y} z={0} w={w} d={d} h={h} />
    <g transform={topM(x, y, h)}>
      {t.icon ? (
        <g transform={`translate(${w / 2 - 10},${d / 2 - 10}) scale(.83)`}>
          <path className="ki" d={t.icon} />
        </g>
      ) : (
        <>
          <rect className="km" x={w / 2 - 10} y={d / 2 - 10} width={20} height={20} rx={4} />
          <text className="kmt" x={w / 2} y={d / 2 + 3} textAnchor="middle">
            {t.letter}
          </text>
        </>
      )}
    </g>
    <g transform={frontM(x, y + d, 0)}>
      {t.name.length > 16 ? (
        <text className="kn" x={10} y={13} style={{ fontSize: 11 }}>
          <tspan x={10}>Any agent with </tspan>
          <tspan x={10} dy={13}>
            a shell or MCP
          </tspan>
        </text>
      ) : (
        <text className="kn" x={10} y={h - 6.5} style={{ fontSize: 12 }}>
          {t.name}
        </text>
      )}
    </g>
  </>
);

// A connector on the ground plane, from a tile edge to the drive edge.
const Wire = ({ a, b }: { a: [number, number]; b: [number, number] }) => {
  const [ax, ay] = P(a[0], a[1], 0);
  return (
    <>
      <polyline className="kl" points={pts([P(a[0], a[1], 0), P(b[0], b[1], 0)])} />
      <circle className="kdot" cx={ax} cy={ay} r={2.5} />
    </>
  );
};

const SLAB = 24;
const GAP = 6;
const D = 120;
const STACK = FOLDERS.length * SLAB + (FOLDERS.length - 1) * GAP;

export function LandingFigure() {
  const [claude, codex, pi, opencode, any] = TOOLS as [Tool, Tool, Tool, Tool, Tool];
  return (
    <figure className="landing-fig">
      <svg
        className="dsk"
        viewBox="-24 0 520 420"
        role="img"
        aria-label="One Agent Drive, shown as a stack of folders, connected to Claude Code, Codex, pi, opencode and any agent with a shell or MCP."
      >
        {/* Back to front, so nearer shapes cover farther ones. */}
        {FOLDERS.map((f, i) => {
          const z = i * (SLAB + GAP);
          return (
            <g key={f}>
              <Box x={0} y={0} z={z} w={D} d={D} h={SLAB} />
              <g transform={frontM(0, D, z)}>
                <text className="kf" x={12} y={SLAB - 8} style={{ fontSize: 12 }}>
                  {f}
                </text>
              </g>
            </g>
          );
        })}
        <g transform={topM(0, 0, STACK)}>
          <circle className="kled" cx={D - 18} cy={18} r={6} />
        </g>
        <text
          className="kn"
          x={P(60, 60, STACK)[0]}
          y={P(0, 0, STACK)[1] - 14}
          textAnchor="middle"
          style={{ fontSize: 15 }}
        >
          Agent Drive
        </text>
        <Wire a={[20, 160]} b={[20, D]} />
        <Wire a={[133, 30]} b={[D, 30]} />
        <Wire a={[72, 265]} b={[72, D]} />
        <Wire a={[225, 100]} b={[D, 100]} />
        <Wire a={[110, 190]} b={[110, D]} />
        <Tile t={claude} x={-40} y={160} w={84} d={40} h={20} />
        <Tile t={pi} x={133} y={0} w={84} d={40} h={20} />
        <Tile t={any} x={100} y={190} w={120} d={50} h={32} />
        <Tile t={codex} x={30} y={265} w={84} d={40} h={20} />
        <Tile t={opencode} x={225} y={80} w={84} d={40} h={20} />
      </svg>
    </figure>
  );
}
