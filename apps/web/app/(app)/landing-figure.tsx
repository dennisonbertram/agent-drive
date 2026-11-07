import type { ReactNode } from 'react';

// Static server-rendered SVG of the hub figure: one Agent Drive and four verified agent tools plus a generic tile.
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

const Tile = ({ t, x, y, w }: { t: Tool; x: number; y: number; w: number }) => (
  <>
    <rect className="ka" x={x} y={y} width={w} height={34} rx={4} />
    {t.icon ? (
      <g transform={`translate(${x + 10},${y + 8}) scale(.75)`}>
        <path className="ki" d={t.icon} />
      </g>
    ) : (
      <>
        <rect className="km" x={x + 9} y={y + 8} width={18} height={18} rx={4} />
        <text className="kmt" x={x + 18} y={y + 20.5} textAnchor="middle">
          {t.letter}
        </text>
      </>
    )}
    {t.name.length > 16 ? (
      <text className="kn" x={x + 36} y={y + 14} style={{ fontSize: 11 }}>
        <tspan x={x + 36}>Any agent with </tspan>
        <tspan x={x + 36} dy={13}>
          a shell or MCP
        </tspan>
      </text>
    ) : (
      <text className="kn" x={x + 36} y={y + 21.5}>
        {t.name}
      </text>
    )}
  </>
);
const Drive = ({ x, y, w }: { x: number; y: number; w: number }) => (
  <>
    <rect
      className="ka"
      x={x}
      y={y}
      width={w}
      height={48 + FOLDERS.length * 32}
      rx={5}
      strokeWidth={1.5}
    />
    <text className="kn" x={x + 14} y={y + 26} style={{ fontSize: 15 }}>
      Agent Drive
    </text>
    <circle className="kled" cx={x + w - 18} cy={y + 21} r={5} />
    {FOLDERS.map((f, i) => (
      <g key={f}>
        <rect className="ka" x={x + 14} y={y + 42 + i * 32} width={w - 28} height={26} rx={2} />
        <text className="kf" x={x + 24} y={y + 60 + i * 32}>
          {f}
        </text>
      </g>
    ))}
  </>
);
const Link = ({ p }: { p: number[][] }) => (
  <polyline className="kl" points={p.map((q) => q.join(',')).join(' ')} />
);
const Svg = ({
  cls,
  box,
  label,
  children,
}: {
  cls: string;
  box: string;
  label: string;
  children: ReactNode;
}) => (
  <svg className={cls} viewBox={box} role="img" aria-label={label}>
    {children}
  </svg>
);

export function LandingFigure() {
  return (
    <figure className="landing-fig">
      <Svg
        cls="dsk"
        box="0 0 580 392"
        label="One Agent Drive connected to Claude Code, Codex, pi, opencode and any agent with a shell or MCP."
      >
        <Drive x={220} y={104} w={140} />
        {TOOLS.map((t, i) => {
          const left = i < 3;
          const k = left ? i : i - 3;
          const y = left ? 40 + k * 100 : 90 + k * 100;
          const x = left ? 0 : 420;
          const ty = y + 17;
          const dy = left ? 130 + k * 46 : 150 + k * 56;
          return (
            <g key={t.name}>
              <Link p={[left ? [160, ty] : [420, ty], left ? [220, dy] : [360, dy]]} />
              <Tile t={t} x={x} y={y} w={160} />
            </g>
          );
        })}
      </Svg>
      <Svg
        cls="mob"
        box="0 0 340 340"
        label="One Agent Drive connected to Claude Code, Codex, pi, opencode and any agent with a shell or MCP."
      >
        <Drive x={100} y={0} w={140} />
        <Link
          p={[
            [170, 176],
            [170, 206 + 2 * 44 + 17],
          ]}
        />
        {TOOLS.map((t, i) => {
          const right = i % 2 === 1;
          const x = right ? 190 : 0;
          const y = 206 + Math.floor(i / 2) * 44;
          const ty = y + 17;
          return (
            <g key={t.name}>
              <Link
                p={[
                  [right ? 190 : 150, ty],
                  [170, ty],
                ]}
              />
              <Tile t={t} x={x} y={y} w={150} />
            </g>
          );
        })}
      </Svg>
    </figure>
  );
}
