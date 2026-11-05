import type { ReactNode } from 'react';

// Static server-rendered SVG of the hub figure (ported from docs/design/spec-reference.html).
const FOLDERS = ['/memory', '/outputs', '/work', '/handoff'];

const Place = ({ x, y, w, h, n }: { x: number; y: number; w: number; h: number; n: string }) => (
  <>
    <rect className="kp" x={x} y={y} width={w} height={h} rx={4} />
    <text className="kt" x={x + 12} y={y + 20}>
      {n}
    </text>
  </>
);
const Agent = ({ x, y, w, h, n }: { x: number; y: number; w: number; h: number; n: string }) => (
  <>
    <rect className="ka" x={x} y={y} width={w} height={h} rx={3} />
    <text className="kn" x={x + w / 2} y={y + h / 2 + 4.5} textAnchor="middle">
      {n}
    </text>
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
// y of folder i inside a drive placed at y
const fy = (y: number, i: number) => y + 55 + i * 32;

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
        box="0 0 560 350"
        label="One Agent Drive with four folders. Codex and Gemini CLI run in a cloud sandbox, Claude Code and Cursor run on a laptop, trace-bot runs in a CI runner. All connect to the same drive."
      >
        <Place x={0} y={6} w={200} h={142} n="CLOUD SANDBOX" />
        <Agent x={16} y={34} w={168} h={40} n="Codex" />
        <Agent x={16} y={86} w={168} h={40} n="Gemini CLI" />
        <Place x={0} y={200} w={200} h={142} n="LAPTOP" />
        <Agent x={16} y={228} w={168} h={40} n="Claude Code" />
        <Agent x={16} y={280} w={168} h={40} n="Cursor" />
        <Place x={380} y={128} w={180} h={100} n="CI RUNNER" />
        <Agent x={396} y={160} w={148} h={40} n="trace-bot" />
        <Drive x={222} y={87} w={136} />
        <Link
          p={[
            [184, 54],
            [222, fy(87, 0)],
          ]}
        />
        <Link
          p={[
            [184, 106],
            [222, fy(87, 1)],
          ]}
        />
        <Link
          p={[
            [184, 248],
            [222, fy(87, 2)],
          ]}
        />
        <Link
          p={[
            [184, 300],
            [222, fy(87, 3)],
          ]}
        />
        <Link
          p={[
            [396, 180],
            [358, fy(87, 1)],
          ]}
        />
      </Svg>
      <Svg
        cls="mob"
        box="0 0 340 330"
        label="One Agent Drive with four folders. Codex and Gemini CLI in a cloud sandbox and Claude Code on a laptop connect to it."
      >
        <Place x={0} y={0} w={340} h={84} n="CLOUD SANDBOX" />
        <Agent x={14} y={32} w={150} h={40} n="Codex" />
        <Agent x={176} y={32} w={150} h={40} n="Gemini CLI" />
        <Drive x={100} y={118} w={140} />
        <Place x={0} y={284} w={340} h={46} n="LAPTOP" />
        <Agent x={176} y={288} w={150} h={38} n="Claude Code" />
        <Link
          p={[
            [89, 72],
            [89, fy(118, 0)],
            [100, fy(118, 0)],
          ]}
        />
        <Link
          p={[
            [251, 72],
            [251, fy(118, 1)],
            [240, fy(118, 1)],
          ]}
        />
        <Link
          p={[
            [251, 288],
            [251, fy(118, 3)],
            [240, fy(118, 3)],
          ]}
        />
      </Svg>
    </figure>
  );
}
