import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('release smoke safety', () => {
  it('requires secure hosted origins and never sends synthetic authentication off loopback', () => {
    const samples = [
      ['https://drive.example.com', false],
      ['http://localhost:3100', true],
      ['http://127.0.0.1:3100', true],
      ['https://drive.example.com', true],
      ['http://drive.example.com', false],
      ['http://localhost.evil.example.com', true],
      ['https://user:secret@drive.example.com', false],
      ['https://drive.example.com?token=secret', false],
      ['https://drive.example.com#secret', false],
      ['https://drive.example.com/path', false],
    ];
    const output = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
      import { smokeOrigin } from './scripts/release-smoke.mjs';
      const results = JSON.parse(process.argv[1]).map(([url, local]) => {
        try { return smokeOrigin(url, local); } catch { return null; }
      });
      console.log(JSON.stringify(results));
    `,
        JSON.stringify(samples),
      ],
      { encoding: 'utf8' },
    );
    expect(JSON.parse(output)).toEqual([
      'https://drive.example.com',
      'http://localhost:3100',
      'http://127.0.0.1:3100',
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  it('gates promotion on local and candidate checks and checks the promoted production origin', () => {
    const output = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
      import { runRelease } from './scripts/release.mjs';
      const results = [];
      for (const failure of ['verify', 'candidate', 'production', null]) {
        const calls = [];
        let passed = true;
        try {
          await runRelease({ productionUrl: 'https://drive.example.com',
            execute: async (name, args) => {
              calls.push([name, ...args]);
              if (failure === 'verify' && name === 'pnpm') throw new Error('synthetic failure');
              return name === 'vercel' && args[0] === 'deploy' ? 'https://candidate.example.com' : '';
            },
            smoke: async ({url}) => {
              calls.push(['smoke', url]);
              return { passed: !((failure === 'candidate' && url.includes('candidate')) ||
                (failure === 'production' && url === 'https://drive.example.com')) };
            }
          });
        } catch { passed = false; }
        results.push({ passed, calls });
      }
      console.log(JSON.stringify(results));
    `,
      ],
      { encoding: 'utf8' },
    );
    const verify = ['pnpm', 'verify'];
    const deploy = ['vercel', 'deploy', '--prod', '--skip-domain'];
    const candidate = ['smoke', 'https://candidate.example.com'];
    const promote = ['vercel', 'promote', 'https://candidate.example.com'];
    const production = ['smoke', 'https://drive.example.com'];
    expect(JSON.parse(output)).toEqual([
      { passed: false, calls: [verify] },
      { passed: false, calls: [verify, deploy, candidate] },
      { passed: false, calls: [verify, deploy, candidate, promote, production] },
      { passed: true, calls: [verify, deploy, candidate, promote, production] },
    ]);
  });
});
