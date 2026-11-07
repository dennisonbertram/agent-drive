import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

// The brand mark (square with a bar) on white, for iOS home screens.
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#fff',
        }}
      >
        <svg width="120" height="120" viewBox="0 0 16 16">
          <rect
            x="0.75"
            y="0.75"
            width="14.5"
            height="14.5"
            rx="3"
            fill="#fff"
            stroke="#111"
            strokeWidth="1.5"
          />
          <rect x="2" y="11" width="12" height="3" fill="#111" />
        </svg>
      </div>
    ),
    size,
  );
}
