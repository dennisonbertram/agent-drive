import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { StringDecoder } from 'node:string_decoder';

export const LIVE_WORKSPACE_MAX_IO_BYTES = 1024 * 1024;
const LIVE_WORKSPACE_MAX_LINE_BYTES = 1536 * 1024;
const HELPER_FILENAME = 'agent-drive-live-workspace-v1.py';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type LiveWorkspaceRequest = {
  id: string | number;
  op: string;
  path?: unknown;
  versionId?: unknown;
  baseVersionId?: unknown;
  handleId?: unknown;
  operationId?: unknown;
  offset?: unknown;
  size?: unknown;
  data?: unknown;
  truncateOnOpen?: unknown;
};

export type LiveWorkspaceResponse = Record<string, unknown> & {
  id: string | number;
  ok: boolean;
  errno?: string;
};

export type LiveWorkspaceTransport = {
  request(payload: Record<string, unknown>, signal?: AbortSignal): Promise<LiveWorkspaceResponse>;
  /** Must coalesce activation and call the waker only when opening or reopening a session. */
  ensureReady?(signal?: AbortSignal): Promise<void>;
  close(): Promise<void>;
};

export type LiveWorkspaceOptions = {
  sandboxId: string;
  root: string;
  readOnly?: boolean;
  transport?: LiveWorkspaceTransport;
  beforeIO?: (machineId: string, signal?: AbortSignal) => Promise<unknown>;
};

const PYTHON_HELPER = String.raw`import base64, errno, hashlib, json, os, re, secrets, stat, sys, uuid

MAX_IO = 1024 * 1024
MAX_FILE = 5 * 1024 * 1024 * 1024
STAGE_PREFIX = '.agent-drive-live-staging-v1-'
STAGE = STAGE_PREFIX + secrets.token_hex(16)
ROOT = None
STAGE_FD = None
HANDLES = {}
COMMITS = {}

def fail(code):
    raise OSError(getattr(errno, code, errno.EIO), code)

def canonical(path):
    if not isinstance(path, str) or not path.startswith('/') or '\\' in path or '\0' in path or len(path.encode()) > 4096:
        fail('EINVAL')
    if path == '/': return []
    parts = path[1:].split('/')
    if any(not p or p in ('.', '..') for p in parts): fail('EINVAL')
    if parts[0].startswith(STAGE_PREFIX): fail('EACCES')
    return parts

def parent_for(path):
    parts = canonical(path)
    if not parts: fail('EINVAL')
    fd = os.dup(ROOT)
    try:
        for part in parts[:-1]:
            nxt = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=fd)
            os.close(fd); fd = nxt
        return fd, parts[-1]
    except Exception:
        os.close(fd); raise

def file_fd(parent, name):
    fd = os.open(name, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=parent)
    info = os.fstat(fd)
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
        os.close(fd); fail('EINVAL')
    return fd

def version(info):
    raw=bytearray(hashlib.sha256(('%x:%x:%x:%x:%x:%x' % (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns, info.st_mode & 0o777)).encode()).digest()[:16])
    raw[6]=(raw[6]&0x0f)|0x50; raw[8]=(raw[8]&0x3f)|0x80
    return str(uuid.UUID(bytes=bytes(raw)))

def open_root(path):
    fd=os.open('/',os.O_RDONLY|os.O_DIRECTORY|os.O_CLOEXEC)
    try:
        for part in path.split('/')[1:]:
            if not part: continue
            nxt=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=fd)
            os.close(fd); fd=nxt
        return fd
    except Exception:
        os.close(fd); raise

def ensure_stage():
    global STAGE_FD
    if STAGE_FD is not None: return
    os.mkdir(STAGE, 0o700, dir_fd=ROOT)
    stage_info = os.stat(STAGE, dir_fd=ROOT, follow_symlinks=False)
    if not stat.S_ISDIR(stage_info.st_mode) or stage_info.st_uid != os.getuid() or (stage_info.st_mode & 0o077): fail('EACCES')
    STAGE_FD = os.open(STAGE, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=ROOT)

def current(parent, name):
    try: info = os.stat(name, dir_fd=parent, follow_symlinks=False)
    except FileNotFoundError: return None
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1: fail('EINVAL')
    return version(info)

def entry(name, info):
    if stat.S_ISDIR(info.st_mode):
        return {'name': name, 'kind': 'directory', 'size': 0, 'mtimeMs': int(info.st_mtime_ns / 1000000)}
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1: return None
    return {'name': name, 'kind': 'file', 'size': info.st_size, 'mtimeMs': int(info.st_mtime_ns / 1000000), 'versionId': version(info), 'readOnly': True}

def respond(request):
    global ROOT, STAGE_FD
    op = request.get('op')
    if op == 'init':
        root = request.get('root')
        if not isinstance(root, str) or not os.path.isabs(root) or '\0' in root: fail('EINVAL')
        real = os.path.realpath(root)
        ROOT = open_root(real)
        os.fchdir(ROOT)
        return {'ok': True}
    if ROOT is None: fail('EIO')
    if op == 'capabilities':
        return {'capabilities': {'readOnly': False, 'write': True, 'delete': False, 'writePaths': ['/'], 'maxReadBytes': MAX_IO, 'maxWriteBytes': MAX_IO, 'ops': ['stat','list','read','capabilities','openWrite','write','truncate','readStaged','finalizeWrite','flushStatus','completeWrite','flush','release','closeWrite']}}
    if op == 'list':
        path = request.get('path'); parts = canonical(path)
        fd = os.dup(ROOT)
        try:
            for part in parts:
                nxt = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=fd)
                os.close(fd); fd = nxt
            values = []
            for name in sorted(os.listdir(fd)):
                if not parts and name.startswith(STAGE_PREFIX):
                    try:
                        os.stat(name,dir_fd=fd,follow_symlinks=False)
                        continue
                    except OSError: pass
                info = os.stat(name, dir_fd=fd, follow_symlinks=False)
                value = entry(name, info)
                if value is not None: values.append(value)
            cursor=request.get('cursor')
            if cursor is None: start=0
            elif isinstance(cursor,str) and cursor.isdecimal() and len(cursor)<=8: start=int(cursor)
            else: fail('EINVAL')
            if start>len(values): fail('EINVAL')
            page=values[start:start+500]
            end=start+len(page)
            return {'entries': page, 'nextCursor': str(end) if end<len(values) else None}
        finally: os.close(fd)
    if op == 'stat':
        path = request.get('path'); parts = canonical(path)
        if not parts:
            info = os.fstat(ROOT)
            return {'entry': {'name':'', 'kind':'directory', 'size':0, 'mtimeMs':int(info.st_mtime_ns / 1000000)}}
        parent, name = parent_for(path)
        try:
            info = os.stat(name, dir_fd=parent, follow_symlinks=False)
            value = entry(name, info)
            if value is None: fail('EINVAL')
            return {'entry': value}
        finally: os.close(parent)
    if op == 'read':
        path = request.get('path'); off=request.get('offset'); size=request.get('size')
        if not isinstance(off, int) or isinstance(off, bool) or off < 0 or not isinstance(size, int) or isinstance(size, bool) or size < 0 or size > MAX_IO: fail('EINVAL')
        parent, name = parent_for(path)
        try:
            fd = file_fd(parent, name)
            try:
                info=os.fstat(fd)
                if request.get('versionId') != version(info): fail('ESTALE')
                data=os.pread(fd, size, off)
                return {'data':base64.b64encode(data).decode('ascii')}
            finally: os.close(fd)
        finally: os.close(parent)
    if op == 'openWrite':
        path=request.get('path'); parent,name=parent_for(path)
        try:
            base=request.get('baseVersionId')
            if base is not None and (not isinstance(base,str) or len(base)>64): fail('EINVAL')
            actual=current(parent,name)
            if actual != base: fail('ESTALE')
            if base is not None: fail('EROFS')
            ensure_stage()
            handle=secrets.token_urlsafe(24)
            stage_name='stage-'+secrets.token_hex(16)
            stage_fd=os.open(stage_name, os.O_RDWR|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_CLOEXEC, 0o600, dir_fd=STAGE_FD)
            try:
                if actual is not None and not request.get('truncateOnOpen',False):
                    src=file_fd(parent,name)
                    try:
                        pos=0
                        while True:
                            block=os.pread(src,MAX_IO,pos)
                            if not block: break
                            os.write(stage_fd,block); pos += len(block)
                    finally: os.close(src)
                os.fsync(stage_fd)
                size=os.fstat(stage_fd).st_size
            finally: os.close(stage_fd)
            HANDLES[handle]={'path':path,'base':base,'stage':stage_name,'size':size,'result':None}
            return {'handleId':handle,'recoveryPath':STAGE+'/'+stage_name,'size':size}
        finally: os.close(parent)
    if op == 'finalizeWrite': op='flush'
    if op in ('write','truncate','readStaged','flush','release','closeWrite','completeWrite'):
        handle=request.get('handleId'); record=HANDLES.get(handle)
        if not record: fail('EBADF')
        fd=os.open(record['stage'], os.O_RDWR|os.O_NOFOLLOW|os.O_CLOEXEC, dir_fd=STAGE_FD)
        try:
            info=os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid != os.getuid() or (info.st_mode & 0o077): fail('EACCES')
            if op == 'write':
                off=request.get('offset'); raw=request.get('data')
                if not isinstance(off,int) or isinstance(off,bool) or off<0 or not isinstance(raw,str) or len(raw)>((MAX_IO+2)//3)*4: fail('EINVAL')
                try: data=base64.b64decode(raw,validate=True)
                except Exception: fail('EINVAL')
                if base64.b64encode(data).decode('ascii') != raw: fail('EINVAL')
                if len(data)>MAX_IO or off+len(data)>MAX_FILE: fail('EFBIG')
                written=os.pwrite(fd,data,off); record['size']=max(record['size'],off+written)
                return {'bytesWritten':written}
            if op == 'truncate':
                size=request.get('size')
                if not isinstance(size,int) or isinstance(size,bool) or size<0 or size>MAX_FILE: fail('EINVAL')
                os.ftruncate(fd,size); record['size']=size; return {'size':size}
            if op == 'readStaged':
                off=request.get('offset'); size=request.get('size')
                if not isinstance(off,int) or isinstance(off,bool) or off<0 or not isinstance(size,int) or isinstance(size,bool) or size<0 or size>MAX_IO: fail('EINVAL')
                data=os.pread(fd,size,off)
                return {'data':base64.b64encode(data).decode('ascii'),'eof':off+len(data)>=os.fstat(fd).st_size}
            if op == 'completeWrite': return {}
            if op in ('flush','release'):
                operation=request.get('operationId','')
                if record['result'] is not None:
                    if op != 'release' and operation != record.get('operation'): fail('ESTALE')
                    if op == 'release':
                        os.unlink(record['stage'], dir_fd=STAGE_FD)
                        HANDLES.pop(handle, None)
                    return {'version':record['result']}
                parent,name=parent_for(record['path'])
                try:
                    if current(parent,name) != record['base']: fail('ESTALE')
                    temp='commit-'+secrets.token_hex(16)
                    target=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_CLOEXEC,0o600,dir_fd=parent)
                    try:
                        pos=0
                        while True:
                            block=os.pread(fd,MAX_IO,pos)
                            if not block: break
                            view=memoryview(block)
                            while view:
                                n=os.write(target,view); view=view[n:]
                            pos+=len(block)
                        os.fchmod(target,0o600); os.fsync(target)
                    finally: os.close(target)
                    if record['base'] is None:
                        os.link(temp,name,src_dir_fd=parent,dst_dir_fd=parent,follow_symlinks=False)
                        os.unlink(temp,dir_fd=parent)
                    else:
                        os.unlink(temp,dir_fd=parent)
                        if current(parent,name) != record['base']: fail('ESTALE')
                        fail('EROFS')
                    os.fsync(parent)
                    committed=os.stat(name,dir_fd=parent,follow_symlinks=False)
                    result={'id':version(committed),'path':record['path']}
                    record['result']=result; record['operation']=operation; record['base']=result['id']
                    if op == 'release':
                        os.unlink(record['stage'], dir_fd=STAGE_FD)
                        HANDLES.pop(handle, None)
                    return {'version':result}
                finally: os.close(parent)
            if op == 'closeWrite':
                HANDLES.pop(handle, None)
                return {'recoveryPath': STAGE+'/'+record['stage']}
        finally: os.close(fd)
    if op == 'init-stop': return {}
    fail('EINVAL')

try: os.unlink(sys.argv[0])
except OSError: pass
try: os.rmdir(os.path.dirname(sys.argv[0]))
except OSError: pass
for raw in sys.stdin.buffer:
    try:
        if len(raw)>1536*1024: fail('EOVERFLOW')
        request=json.loads(raw)
        if not isinstance(request,dict) or not isinstance(request.get('id'),(str,int)) or isinstance(request.get('id'),bool): fail('EINVAL')
        response={'id':request['id'],'ok':True}
        response.update(respond(request))
    except OSError as e:
        code=errno.errorcode.get(e.errno,'EIO')
        response={'id':request.get('id') if isinstance(request,dict) else '', 'ok':False,'errno':code}
        record=HANDLES.get(request.get('handleId')) if isinstance(request,dict) else None
        if record is not None: response['recoveryPath']=STAGE+'/'+record['stage']
    except Exception:
        response={'id':request.get('id') if isinstance(request,dict) else '', 'ok':False,'errno':'EIO'}
    try: sys.stdout.write(json.dumps(response,separators=(',',':'))+'\n'); sys.stdout.flush()
    except Exception: break
`;

export const LIVE_WORKSPACE_HELPER_SOURCE = PYTHON_HELPER;

export type InstaboxTransportOptions = {
  sandboxId: string;
  root?: string;
  beforeIO?: (machineId: string, signal?: AbortSignal) => Promise<unknown>;
  spawnProcess?: typeof spawn;
};

/** Remove Agent Drive credentials before invoking the unrelated Instabox CLI. */
export function liveWorkspaceInstaboxEnvironment(
  environment: Record<string, string | undefined> = process.env,
): NodeJS.ProcessEnv {
  const filtered: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(environment))
    if (!name.startsWith('AGENT_DRIVE_')) filtered[name] = value;
  filtered.INSTABOX_NO_TELEMETRY = '1';
  return filtered as NodeJS.ProcessEnv;
}

/** Authenticated CLI transport. It uploads only the fixed helper and sends RPC as framed stdin. */
export function createInstaboxLiveWorkspaceTransport(
  options: InstaboxTransportOptions,
): LiveWorkspaceTransport {
  const spawnProcess = options.spawnProcess ?? spawn;
  const sandboxId = options.sandboxId;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(sandboxId))
    throw new Error('Invalid Instabox sandbox identifier.');
  let child: ChildProcess | undefined;
  let tempDir: string | undefined;
  let input = options.root ?? '';
  const decoder = new StringDecoder('utf8');
  let queue = Promise.resolve();
  let stdoutBuffer = '';
  const responseQueue: Array<{
    resolve(value: LiveWorkspaceResponse): void;
    reject(error: Error): void;
  }> = [];
  let startup: Promise<void> | undefined;

  const runCli = (args: string[], signal?: AbortSignal) =>
    new Promise<string>((resolve, reject) => {
      const childProcess = spawnProcess('instabox', args, {
        stdio: ['ignore', 'pipe', 'ignore'],
        env: liveWorkspaceInstaboxEnvironment(),
      });
      let output = '';
      childProcess.stdout!.on('data', (chunk: Buffer) => {
        output += chunk.toString('utf8');
        if (Buffer.byteLength(output) > 64 * 1024) {
          childProcess.kill('SIGTERM');
          reject(new Error('Instabox helper setup returned too much output.'));
        }
      });
      const abort = () => {
        childProcess.kill('SIGTERM');
        reject(new DOMException('Canceled', 'AbortError'));
      };
      signal?.addEventListener('abort', abort, { once: true });
      childProcess.once('error', (error) => {
        signal?.removeEventListener('abort', abort);
        reject(error);
      });
      childProcess.once('close', (code) => {
        signal?.removeEventListener('abort', abort);
        if (code === 0) resolve(output);
        else reject(new Error(`Instabox helper setup failed (exit ${code ?? 'unknown'}).`));
      });
    });

  const start = async (signal?: AbortSignal) => {
    if (startup) return startup;
    startup = (async () => {
      await options.beforeIO?.(sandboxId, signal);
      tempDir = await mkdtemp(join(tmpdir(), 'agent-drive-live-'));
      const helperPath = join(tempDir, HELPER_FILENAME);
      await writeFile(helperPath, LIVE_WORKSPACE_HELPER_SOURCE, { mode: 0o600, flag: 'wx' });
      const remoteDir = `/tmp/agent-drive-live-${randomUUID()}`;
      const remotePath = `${remoteDir}/${HELPER_FILENAME}`;
      await runCli(['ssh', sandboxId, '--', 'mkdir', '-m', '700', '--', remoteDir], signal);
      await runCli(['cp', helperPath, `${sandboxId}:${remotePath}`], signal);
      const checked = await runCli(['ssh', sandboxId, '--', 'sha256sum', '--', remotePath], signal);
      const expectedHash = createHash('sha256').update(LIVE_WORKSPACE_HELPER_SOURCE).digest('hex');
      if (!checked.trim().startsWith(`${expectedHash} `))
        throw new Error('Instabox helper integrity check failed.');
      child = spawnProcess('instabox', ['ssh', sandboxId, '--', 'python3', '-u', remotePath], {
        stdio: ['pipe', 'pipe', 'ignore'],
        env: liveWorkspaceInstaboxEnvironment(),
      });
      child.stdout!.on('data', (chunk: Buffer) => {
        stdoutBuffer += decoder.write(chunk);
        if (
          Buffer.byteLength(stdoutBuffer) > LIVE_WORKSPACE_MAX_LINE_BYTES &&
          !stdoutBuffer.includes('\n')
        ) {
          child?.kill('SIGTERM');
          rejectPending(new Error('Instabox helper response exceeded the size limit.'));
          return;
        }
        let newline: number;
        while ((newline = stdoutBuffer.indexOf('\n')) >= 0) {
          const line = stdoutBuffer.slice(0, newline);
          stdoutBuffer = stdoutBuffer.slice(newline + 1);
          const pending = responseQueue.shift();
          if (!pending) continue;
          try {
            pending.resolve(JSON.parse(line) as LiveWorkspaceResponse);
          } catch {
            rejectPending(new Error('Instabox helper returned an invalid response.'));
            child?.kill('SIGTERM');
          }
        }
      });
      const session = child;
      child.once('close', (code, signalName) => {
        if (child === session) {
          child = undefined;
          startup = undefined;
        }
        rejectPending(
          new Error(
            `Instabox workspace transport closed (exit ${code ?? signalName ?? 'unknown'}).`,
          ),
        );
      });
      const init = await rawRequest({ id: 'init', op: 'init', root: input }, signal);
      if (!init.ok)
        throw new Error(
          `Instabox workspace helper initialization failed (${String(init.errno ?? 'EIO')}).`,
        );
    })();
    try {
      await startup;
    } catch (error) {
      startup = undefined;
      throw error;
    }
  };

  const rejectPending = (error: Error) => {
    while (responseQueue.length) {
      responseQueue.shift()?.reject(error);
    }
  };

  const rawRequest = (payload: Record<string, unknown>, signal?: AbortSignal) =>
    new Promise<LiveWorkspaceResponse>((resolve, reject) => {
      if (signal?.aborted) return reject(new DOMException('Canceled', 'AbortError'));
      if (!child?.stdin || child.killed)
        return reject(new Error('Instabox workspace transport is unavailable.'));
      const id = payload.id;
      const abort = () => {
        child?.kill('SIGTERM');
        reject(new DOMException('Canceled', 'AbortError'));
      };
      signal?.addEventListener('abort', abort, { once: true });
      responseQueue.push({
        resolve: (response) => {
          signal?.removeEventListener('abort', abort);
          resolve(response);
        },
        reject: (error) => {
          signal?.removeEventListener('abort', abort);
          reject(error);
        },
      });
      const line = `${JSON.stringify(payload)}\n`;
      child.stdin.write(line, (error) => {
        if (error) {
          signal?.removeEventListener('abort', abort);
          reject(error);
        }
      });
      void id;
    });

  return {
    async ensureReady(signal) {
      await start(signal);
    },
    request(payload, signal) {
      const result = queue.then(async () => {
        if (payload.op === 'init') input = String(payload.root ?? '');
        if (!startup && payload.op !== 'init') await start(signal);
        else if (payload.op === 'init' && !startup) {
          input = String(payload.root ?? '');
          await start(signal);
          return { id: payload.id as string | number, ok: true };
        }
        const safeRead = ['stat', 'list', 'read'].includes(String(payload.op));
        try {
          return await rawRequest(payload, signal);
        } catch (error) {
          if (!safeRead || signal?.aborted) throw error;
          const failedSession = child;
          if (failedSession) {
            if (failedSession.exitCode === null && failedSession.signalCode === null) {
              failedSession.kill('SIGTERM');
              await once(failedSession, 'close').catch(() => undefined);
            }
            if (child === failedSession) {
              child = undefined;
              startup = undefined;
            }
          }
          await start(signal);
          return rawRequest(payload, signal);
        }
      });
      queue = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
    async close() {
      child?.kill('SIGTERM');
      child = undefined;
      if (tempDir) await rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
      startup = undefined;
    },
  };
}

/** Dispatch a mount RPC to an explicitly selected sandbox working directory. */
export async function createLiveWorkspaceProvider(options: LiveWorkspaceOptions) {
  if (!options.sandboxId || options.sandboxId.length > 128)
    throw new Error('Invalid sandbox identifier.');
  if (
    typeof options.root !== 'string' ||
    !options.root.startsWith('/') ||
    options.root.includes('\0')
  )
    throw new Error('Workspace root must be an absolute path.');
  const transport =
    options.transport ??
    createInstaboxLiveWorkspaceTransport({
      sandboxId: options.sandboxId,
      root: options.root,
      ...(options.beforeIO ? { beforeIO: options.beforeIO } : {}),
    });
  let closed = false;
  let injectedTransportActivated = false;
  const capabilities = {
    readOnly: options.readOnly === true,
    write: options.readOnly !== true,
    delete: false,
    writePaths: ['/'],
    maxReadBytes: LIVE_WORKSPACE_MAX_IO_BYTES,
    maxWriteBytes: LIVE_WORKSPACE_MAX_IO_BYTES,
    ops: [
      'stat',
      'list',
      'read',
      'capabilities',
      'openWrite',
      'write',
      'truncate',
      'readStaged',
      'finalizeWrite',
      'flushStatus',
      'completeWrite',
      'flush',
      'release',
      'closeWrite',
    ],
  };
  return {
    capabilities,
    async dispatch(input: unknown, signal?: AbortSignal): Promise<LiveWorkspaceResponse> {
      const id =
        input && typeof input === 'object' && 'id' in input
          ? (input as LiveWorkspaceRequest).id
          : '';
      if (closed) return { id, ok: false, errno: 'EIO' };
      if (!input || typeof input !== 'object' || Array.isArray(input))
        return { id, ok: false, errno: 'EINVAL' };
      const request = input as LiveWorkspaceRequest;
      if (
        !(typeof request.id === 'string' && request.id.length > 0 && request.id.length <= 256) &&
        !(typeof request.id === 'number' && Number.isSafeInteger(request.id) && request.id >= 0)
      )
        return { id: '', ok: false, errno: 'EINVAL' };
      if (request.op === 'capabilities') return { id: request.id, ok: true, capabilities };
      const supported = [
        'stat',
        'list',
        'read',
        'openWrite',
        'write',
        'truncate',
        'readStaged',
        'finalizeWrite',
        'completeWrite',
        'flush',
        'release',
        'closeWrite',
      ];
      if (!supported.includes(request.op)) return { id: request.id, ok: false, errno: 'ENOSYS' };
      try {
        if (signal?.aborted) throw new DOMException('Canceled', 'AbortError');
        const payload = { ...request } as Record<string, unknown>;
        if (
          request.op === 'read' ||
          request.op === 'stat' ||
          request.op === 'list' ||
          request.op === 'openWrite'
        ) {
          if (
            typeof request.path !== 'string' ||
            !request.path.startsWith('/') ||
            request.path.includes('\\') ||
            request.path.includes('\0') ||
            request.path
              .split('/')
              .slice(1)
              .some((p) => p === '.' || p === '..')
          )
            return { id: request.id, ok: false, errno: 'EINVAL' };
        }
        if (
          request.op === 'read' &&
          (!Number.isSafeInteger(request.offset) ||
            (request.offset as number) < 0 ||
            !Number.isSafeInteger(request.size) ||
            (request.size as number) < 0 ||
            (request.size as number) > LIVE_WORKSPACE_MAX_IO_BYTES)
        )
          return { id: request.id, ok: false, errno: 'EINVAL' };
        if (
          request.op === 'read' &&
          (typeof request.versionId !== 'string' || !UUID_PATTERN.test(request.versionId))
        )
          return { id: request.id, ok: false, errno: 'EINVAL' };
        if (
          request.op === 'openWrite' &&
          !(
            request.baseVersionId === null ||
            (typeof request.baseVersionId === 'string' && UUID_PATTERN.test(request.baseVersionId))
          )
        )
          return { id: request.id, ok: false, errno: 'EINVAL' };
        if (
          request.op === 'write' &&
          (typeof request.data !== 'string' ||
            Buffer.byteLength(request.data) > Math.ceil(LIVE_WORKSPACE_MAX_IO_BYTES / 3) * 4)
        )
          return { id: request.id, ok: false, errno: 'EINVAL' };
        if (request.op === 'init') return { id: request.id, ok: false, errno: 'EACCES' };
        if (request.op === 'stat' && request.path === '/')
          return {
            id: request.id,
            ok: true,
            entry: { name: '', kind: 'directory', size: 0, mtimeMs: 0 },
          };
        if (
          options.readOnly &&
          [
            'openWrite',
            'write',
            'truncate',
            'readStaged',
            'finalizeWrite',
            'completeWrite',
            'flush',
            'release',
            'closeWrite',
          ].includes(request.op)
        )
          return { id: request.id, ok: false, errno: 'EROFS' };
        if (transport.ensureReady) {
          await transport.ensureReady(signal);
        } else if (options.transport && !injectedTransportActivated) {
          await options.beforeIO?.(options.sandboxId, signal);
          injectedTransportActivated = true;
        }
        const response = await transport.request(payload, signal);
        if (response.id !== request.id) return { id: request.id, ok: false, errno: 'EIO' };
        return response;
      } catch (error) {
        return {
          id: request.id,
          ok: false,
          errno: error instanceof DOMException && error.name === 'AbortError' ? 'ECANCELED' : 'EIO',
        };
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      await transport.close();
    },
  };
}
