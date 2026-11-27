import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  createInstaboxLiveWorkspaceTransport,
  createLiveWorkspaceProvider,
  LIVE_WORKSPACE_HELPER_SOURCE,
} from './live-workspace.js';

class FakeChild extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  killed = false;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  closed = false;
  argsForTest: string[] = [];

  kill(signal: NodeJS.Signals = 'SIGTERM') {
    if (this.closed) return false;
    this.killed = true;
    this.signalCode = signal;
    this.stdin.end();
    this.stdout.end();
    queueMicrotask(() => {
      this.closed = true;
      this.emit('close', null, signal);
    });
    return true;
  }

  finish(output = '') {
    this.exitCode = 0;
    this.stdout.end(output);
    queueMicrotask(() => {
      this.closed = true;
      this.emit('close', 0, null);
    });
  }
}

function fakeInstabox(
  options: {
    malformedFirstList?: boolean;
    changedMachineOnSecondLookup?: boolean;
    changedRootOnReconnect?: boolean;
    failInit?: boolean;
  } = {},
) {
  const children: FakeChild[] = [];
  const argsSeen: string[][] = [];
  const helperInitPayloads: Array<Record<string, unknown>> = [];
  const listPayloads: Array<Record<string, unknown>> = [];
  let machineLookups = 0;
  let helperSessions = 0;

  const spawnFake = ((_: string, args: readonly string[]) => {
    argsSeen.push([...args]);
    const child = new FakeChild();
    child.argsForTest = [...args];
    children.push(child);
    if (!args.includes('python3')) {
      let output = '';
      if (args[0] === 'get') {
        machineLookups += 1;
        const id =
          options.changedMachineOnSecondLookup && machineLookups > 1 ? 'm_other' : 'm_synthetic';
        output = JSON.stringify({ id, status: 'running' });
      } else if (args.includes('sha256sum')) {
        const hash = createHash('sha256').update(LIVE_WORKSPACE_HELPER_SOURCE).digest('hex');
        output = `${hash}  ${args.at(-1)}\n`;
      }
      setImmediate(() => child.finish(output));
      return child;
    }

    helperSessions += 1;
    const session = helperSessions;
    let buffered = '';
    child.stdin.on('data', (chunk: Buffer) => {
      buffered += chunk.toString('utf8');
      for (;;) {
        const newline = buffered.indexOf('\n');
        if (newline < 0) return;
        const request = JSON.parse(buffered.slice(0, newline)) as Record<string, unknown>;
        buffered = buffered.slice(newline + 1);
        if (request.op === 'init') helperInitPayloads.push(request);
        if (request.op === 'list') listPayloads.push(request);
        if (options.malformedFirstList && session === 1 && request.op === 'list') {
          child.stdout.write('{broken-json}\n');
          continue;
        }
        const response =
          request.op === 'init' && options.failInit
            ? { id: request.id, ok: false, errno: 'ENOENT' }
            : {
                id: request.id,
                ok: true,
                ...(request.op === 'init'
                  ? {
                      rootIdentity:
                        options.changedRootOnReconnect && session > 1
                          ? 'another-device:another-inode'
                          : 'root-device:root-inode',
                    }
                  : {}),
                ...(request.op === 'list'
                  ? {
                      entries: [
                        {
                          name: 'page-entry.txt',
                          kind: 'file',
                          size: 4,
                          mtimeMs: 10,
                          versionId: 'v1',
                        },
                      ],
                      nextCursor: null,
                    }
                  : {}),
              };
        child.stdout.write(`${JSON.stringify(response)}\n`);
      }
    });
    return child;
  }) as unknown as typeof import('node:child_process').spawn;

  return { spawnFake, children, argsSeen, helperInitPayloads, listPayloads };
}

describe('Instabox live workspace transport', () => {
  it('advertises helper-supported file and directory create, and maps page requests and replies', async () => {
    const requests: Array<Record<string, unknown>> = [];
    const provider = await createLiveWorkspaceProvider({
      sandboxId: 'm_synthetic',
      root: '/work/project',
      transport: {
        request: async (payload) => {
          requests.push(payload);
          return payload.op === 'list'
            ? { id: payload.id as string | number, ok: true, entries: [], nextCursor: 'next-page' }
            : { id: payload.id as string | number, ok: true, path: payload.path };
        },
        close: async () => undefined,
      },
    });
    try {
      const caps = await provider.dispatch({ id: 'caps', op: 'capabilities' });
      expect(caps).toMatchObject({
        capabilities: { write: true, ops: expect.arrayContaining(['openWrite', 'mkdir']) },
      });
      expect(
        await provider.dispatch({ id: 'page', op: 'list', path: '/docs', cursor: 'cursor-2' }),
      ).toMatchObject({ id: 'page', ok: true, entries: [], nextCursor: 'next-page' });
      expect(
        await provider.dispatch({ id: 'mkdir', op: 'mkdir', path: '/new-folder' }),
      ).toMatchObject({
        id: 'mkdir',
        ok: true,
        path: '/new-folder',
      });
      expect(requests).toEqual([
        { id: 'page', op: 'list', path: '/docs', cursor: 'cursor-2' },
        { id: 'mkdir', op: 'mkdir', path: '/new-folder' },
      ]);
    } finally {
      await provider.close();
    }
  });

  it('resolves a registered name once, pins the ID and root, and preserves bounded list cursors', async () => {
    const fake = fakeInstabox();
    const beforeIOIds: string[] = [];
    const transport = createInstaboxLiveWorkspaceTransport({
      sandboxId: 'registered-workspace',
      root: '/work/project',
      beforeIO: async (machineId) => {
        beforeIOIds.push(machineId);
      },
      spawnProcess: fake.spawnFake,
    });
    try {
      const response = await transport.request({
        id: 1,
        op: 'list',
        path: '/docs',
        cursor: 'c-12',
      });
      expect(response).toMatchObject({ id: 1, ok: true, entries: [{ name: 'page-entry.txt' }] });
      expect(fake.argsSeen[0]).toEqual(['get', 'registered-workspace', '--json']);
      expect(
        fake.argsSeen
          .filter((args) => args[0] === 'ssh')
          .every((args) => args[1] === 'm_synthetic'),
      ).toBe(true);
      expect(beforeIOIds).toEqual(['m_synthetic']);
      expect(fake.helperInitPayloads).toEqual([{ id: 'init', op: 'init', root: '/work/project' }]);
      expect(fake.listPayloads).toEqual([{ id: 1, op: 'list', path: '/docs', cursor: 'c-12' }]);
    } finally {
      await transport.close();
    }
  });

  it('rejects a malformed reply without hanging, resets the session, and pins root identity on reconnect', async () => {
    const fake = fakeInstabox({ malformedFirstList: true });
    const transport = createInstaboxLiveWorkspaceTransport({
      sandboxId: 'm_synthetic',
      root: '/work/project',
      spawnProcess: fake.spawnFake,
    });
    try {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const response = await Promise.race([
        transport.request({ id: 7, op: 'list', path: '/', cursor: '0' }),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error('transport request hung')), 1500);
        }),
      ]);
      if (timeout) clearTimeout(timeout);
      expect(response).toMatchObject({ id: 7, ok: true, nextCursor: null });
      expect(fake.helperInitPayloads).toEqual([
        { id: 'init', op: 'init', root: '/work/project' },
        { id: 'init', op: 'init', root: '/work/project', rootIdentity: 'root-device:root-inode' },
      ]);
      expect(fake.argsSeen.filter((args) => args[0] === 'get')).toEqual([
        ['get', 'm_synthetic', '--json'],
        ['get', 'm_synthetic', '--json'],
      ]);
    } finally {
      await transport.close();
    }
    expect(
      fake.children
        .filter((child) => child.argsForTest.includes('python3'))
        .every((child) => child.closed),
    ).toBe(true);
  });

  it('stops and cleans an SSH attempt when the helper rejects root initialization', async () => {
    const fake = fakeInstabox({ failInit: true });
    const transport = createInstaboxLiveWorkspaceTransport({
      sandboxId: 'm_synthetic',
      root: '/missing/root',
      spawnProcess: fake.spawnFake,
    });
    let helperPath = '';
    try {
      await expect(transport.request({ id: 1, op: 'list', path: '/' })).rejects.toThrow(
        'initialization failed (ENOENT)',
      );
      const copy = fake.argsSeen.find((args) => args[0] === 'cp');
      helperPath = copy?.[1] ?? '';
      expect(helperPath).not.toBe('');
    } finally {
      await transport.close();
    }
    expect(existsSync(helperPath)).toBe(false);
    expect(fake.children.some((child) => child.killed && child.closed)).toBe(true);
  });

  it('refuses reconnect if a registered machine name resolves to a different machine ID', async () => {
    const fake = fakeInstabox({ malformedFirstList: true, changedMachineOnSecondLookup: true });
    const transport = createInstaboxLiveWorkspaceTransport({
      sandboxId: 'registered-workspace',
      root: '/work/project',
      spawnProcess: fake.spawnFake,
    });
    try {
      await expect(transport.request({ id: 1, op: 'list', path: '/' })).rejects.toThrow(
        'different machine ID',
      );
      expect(fake.argsSeen.filter((args) => args.includes('python3'))).toHaveLength(1);
    } finally {
      await transport.close();
    }
  });

  it('refuses to serve a different root after reconnect', async () => {
    const fake = fakeInstabox({ malformedFirstList: true, changedRootOnReconnect: true });
    const transport = createInstaboxLiveWorkspaceTransport({
      sandboxId: 'm_synthetic',
      root: '/work/project',
      spawnProcess: fake.spawnFake,
    });
    try {
      await expect(transport.request({ id: 1, op: 'list', path: '/' })).rejects.toThrow(
        'root identity changed',
      );
      expect(fake.helperInitPayloads[1]).toEqual({
        id: 'init',
        op: 'init',
        root: '/work/project',
        rootIdentity: 'root-device:root-inode',
      });
    } finally {
      await transport.close();
    }
  });
});
