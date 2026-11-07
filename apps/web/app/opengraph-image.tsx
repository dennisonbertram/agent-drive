import { ImageResponse } from 'next/og';

export const alt = 'Agent Drive: agent files that outlive the sandbox.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

// Brand style: white paper, ink text, one orange signal. Uses the default font bundled with next/og.
export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: '#ffffff',
          color: '#111111',
          padding: 72,
          border: '12px solid #111111',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', fontSize: 36, fontWeight: 600 }}>
          <div
            style={{
              width: 22,
              height: 22,
              borderRadius: 11,
              background: '#ff4a1c',
              marginRight: 16,
            }}
          />
          Agent Drive
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 92, lineHeight: 1, letterSpacing: -3, fontWeight: 600 }}>
            Agent files that outlive the sandbox.
          </div>
          <div style={{ fontSize: 34, marginTop: 32, color: '#3b3a37' }}>
            Encrypted storage your agents keep across sandboxes, machines and platforms.
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
