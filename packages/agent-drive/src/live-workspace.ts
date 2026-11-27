import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
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
  spawnProcess?: typeof spawn;
  beforeIO?: (machineId: string, signal?: AbortSignal) => Promise<unknown>;
};

const PYTHON_HELPER = String.raw`import base64, errno, hashlib, json, os, secrets, stat, sys, time, uuid

MAX_IO = 1024 * 1024
MAX_FILE = 5 * 1024 * 1024 * 1024
MAX_PAGE = 60000
MAX_LIST_NAMES = 20000
MAX_LIST_BYTES = 4 * 1024 * 1024
MAX_LISTINGS = 32
LIST_TTL = 60
STAGE_PREFIX = '.agent-drive-live-staging-v1-'
ROOT = None
ROOT_PATH = None
ROOT_IDENTITY = None
HANDLES = {}
COMMITS = {}
LISTINGS = {}

def fail(code):
    raise OSError(getattr(errno, code, errno.EIO), code)

def canonical(path):
    if not isinstance(path, str) or not path.startswith('/') or '\\' in path or '\0' in path or len(path.encode()) > 4096:
        fail('EINVAL')
    if path == '/': return []
    parts = path[1:].split('/')
    if any(not p or p in ('.', '..') for p in parts): fail('EINVAL')
    if any(p.startswith(STAGE_PREFIX) for p in parts): fail('EACCES')
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

def dir_for(path):
    fd = os.dup(ROOT)
    try:
        for part in canonical(path):
            nxt = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=fd)
            os.close(fd); fd = nxt
        return fd
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
    if not isinstance(path,str) or not path.startswith('/') or '\0' in path or '\\' in path or len(path.encode())>4096: fail('EINVAL')
    parts=path.split('/')[1:]
    if any(p in ('.','..') for p in parts): fail('EINVAL')
    fd=os.open('/',os.O_RDONLY|os.O_DIRECTORY|os.O_CLOEXEC)
    try:
        for part in parts:
            if not part: continue
            nxt=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=fd)
            os.close(fd); fd=nxt
        return fd
    except Exception:
        os.close(fd); raise

def recovery(record):
    suffix=record['parentPath'].strip('/')
    return ROOT_PATH.rstrip('/')+'/'+(suffix+'/' if suffix else '')+record['stageDir']+'/'+record['stage']

def create_stage(parent):
    name=STAGE_PREFIX+secrets.token_hex(16)
    os.mkdir(name,0o700,dir_fd=parent)
    fd=os.open(name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=parent)
    try:
        info=os.fstat(fd)
        if info.st_uid!=os.getuid() or info.st_mode&0o077: fail('EACCES')
        ignore=os.open('.gitignore',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_CLOEXEC,0o600,dir_fd=fd)
        try:
            os.write(ignore,b'*\n'); os.fsync(ignore)
        finally: os.close(ignore)
        os.fsync(fd)
        return name,fd
    except Exception:
        os.close(fd)
        try:
            cleanup=os.open(name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=parent)
            try: os.unlink('.gitignore',dir_fd=cleanup)
            finally: os.close(cleanup)
        except Exception: pass
        try: os.rmdir(name,dir_fd=parent)
        except Exception: pass
        raise

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

def expire_listings():
    now=time.monotonic()
    for key,value in list(LISTINGS.items()):
        if now-value['created']>LIST_TTL: LISTINGS.pop(key,None)
    while len(LISTINGS)>MAX_LISTINGS: LISTINGS.pop(next(iter(LISTINGS)))

def list_page(request):
    path=request.get('path'); parts=canonical(path); cursor=request.get('cursor')
    if cursor is None:
        fd=dir_for(path)
        try:
            info=os.fstat(fd); names=[]; total=0
            for name in sorted(os.listdir(fd)):
                if name.startswith(STAGE_PREFIX): continue
                total+=len(name.encode())
                if len(names)>=MAX_LIST_NAMES or total>MAX_LIST_BYTES: fail('EOVERFLOW')
                names.append(name)
            listing_id=secrets.token_urlsafe(12)
            LISTINGS[listing_id]={'path':path,'dev':info.st_dev,'ino':info.st_ino,'mtime':info.st_mtime_ns,'names':names,'created':time.monotonic()}
            start=0
        finally: os.close(fd)
    else:
        if not isinstance(cursor,str) or len(cursor)>80 or '.' not in cursor: fail('EINVAL')
        listing_id,offset=cursor.rsplit('.',1)
        if not offset.isdecimal() or len(offset)>8: fail('EINVAL')
        start=int(offset); listing=LISTINGS.get(listing_id)
        if listing is None or listing['path']!=path: fail('ESTALE')
        names=listing['names']
    expire_listings()
    listing=LISTINGS.get(listing_id)
    if listing is None: fail('ESTALE')
    fd=dir_for(path)
    try:
        info=os.fstat(fd)
        if (info.st_dev,info.st_ino,info.st_mtime_ns)!=(listing['dev'],listing['ino'],listing['mtime']): fail('ESTALE')
        values=[]; consumed=0
        for name in listing['names'][start:]:
            try: item=entry(name,os.stat(name,dir_fd=fd,follow_symlinks=False))
            except FileNotFoundError: fail('ESTALE')
            if item is None:
                consumed+=1
                continue
            candidate=values+[item]
            end=start+consumed+1
            next_cursor=listing_id+'.'+str(end) if end<len(listing['names']) else None
            payload={'id':request['id'],'ok':True,'entries':candidate,'nextCursor':next_cursor}
            if len(json.dumps(payload,separators=(',',':')).encode())>MAX_PAGE:
                if not values: fail('EOVERFLOW')
                break
            values=candidate; consumed+=1
        end=start+consumed
        return {'entries':values,'nextCursor':listing_id+'.'+str(end) if end<len(listing['names']) else None}
    finally: os.close(fd)

def cleanup_record(handle,record):
    parent=dir_for(record['parentPath'] or '/')
    try:
        stagefd=os.open(record['stageDir'],os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=parent)
        try:
            try: os.unlink(record['stage'],dir_fd=stagefd)
            except FileNotFoundError: pass
            try: os.unlink('.gitignore',dir_fd=stagefd)
            except FileNotFoundError: pass
            try: os.fsync(stagefd)
            except OSError: pass
        finally: os.close(stagefd)
        try: os.rmdir(record['stageDir'],dir_fd=parent)
        except FileNotFoundError: pass
        try: os.fsync(parent)
        except OSError: pass
    finally: os.close(parent)
    fd=record.pop('fd',None)
    if fd is not None:
        try: os.close(fd)
        except OSError: pass
    HANDLES.pop(handle,None)

def respond(request):
    global ROOT, ROOT_PATH, ROOT_IDENTITY
    op=request.get('op')
    if op=='init':
        path=request.get('root'); fd=open_root(path); info=os.fstat(fd)
        identity='%x-%x'%(info.st_dev,info.st_ino)
        expected=request.get('rootIdentity')
        if expected is not None and expected!=identity:
            os.close(fd); fail('ESTALE')
        if ROOT is not None: os.close(ROOT)
        ROOT=fd; ROOT_PATH=path.rstrip('/') or '/'; ROOT_IDENTITY=identity
        return {'ok':True,'rootIdentity':identity}
    if ROOT is None: fail('EIO')
    if op=='capabilities':
        return {'capabilities':{'readOnly':False,'write':True,'delete':False,'writePaths':['/'],'maxReadBytes':MAX_IO,'maxWriteBytes':MAX_IO,'ops':['stat','list','read','mkdir','capabilities','openWrite','write','truncate','readStaged','finalizeWrite','flushStatus','completeWrite','flush','release','closeWrite']}}
    if op=='mkdir':
        parent,name=parent_for(request.get('path'))
        try: os.mkdir(name,0o700,dir_fd=parent); os.fsync(parent); return {}
        finally: os.close(parent)
    if op=='list': return list_page(request)
    if op=='stat':
        path=request.get('path'); parts=canonical(path)
        if not parts:
            info=os.fstat(ROOT); return {'entry':{'name':'','kind':'directory','size':0,'mtimeMs':int(info.st_mtime_ns/1000000)}}
        parent,name=parent_for(path)
        try:
            value=entry(name,os.stat(name,dir_fd=parent,follow_symlinks=False))
            if value is None: fail('EINVAL')
            return {'entry':value}
        finally: os.close(parent)
    if op=='read':
        off=request.get('offset'); size=request.get('size')
        if not isinstance(off,int) or isinstance(off,bool) or off<0 or not isinstance(size,int) or isinstance(size,bool) or size<0 or size>MAX_IO: fail('EINVAL')
        parent,name=parent_for(request.get('path'))
        try:
            fd=file_fd(parent,name)
            try:
                info=os.fstat(fd)
                if request.get('versionId')!=version(info): fail('ESTALE')
                return {'data':base64.b64encode(os.pread(fd,size,off)).decode('ascii')}
            finally: os.close(fd)
        finally: os.close(parent)
    if op=='openWrite':
        path=request.get('path'); parent,name=parent_for(path)
        try:
            base=request.get('baseVersionId')
            if base is not None and (not isinstance(base,str) or len(base)>64): fail('EINVAL')
            actual=current(parent,name)
            if actual!=base: fail('ESTALE')
            if base is not None: fail('EROFS')
            parts=canonical(path); parent_path='/'+'/'.join(parts[:-1]) if len(parts)>1 else '/'
            stage_dir,stage_dir_fd=create_stage(parent)
            stage='stage-'+secrets.token_hex(16)
            fd=None
            try:
                fd=os.open(stage,os.O_RDWR|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_CLOEXEC,0o600,dir_fd=stage_dir_fd)
                os.fsync(fd); size=0
            except Exception:
                if fd is not None: os.close(fd)
                os.close(stage_dir_fd)
                raise
            os.close(fd)
            os.close(stage_dir_fd)
            handle=secrets.token_urlsafe(24)
            HANDLES[handle]={'path':path,'parentPath':parent_path,'base':None,'stageDir':stage_dir,'stage':stage,'size':size,'result':None,'retained':False,'committed':False}
            return {'handleId':handle,'recoveryPath':recovery(HANDLES[handle]),'size':size}
        finally: os.close(parent)
    if op=='finalizeWrite':
        handle=request.get('handleId'); operation=request.get('operationId')
        record=HANDLES.get(handle)
        if record is None:
            prior=COMMITS.get((handle,operation))
            if prior is not None: return {'version':prior}
            fail('EBADF')
        result=commit_record(handle,record,operation)
        COMMITS[(handle,operation)]=result
        while len(COMMITS)>128: COMMITS.pop(next(iter(COMMITS)))
        cleanup_record(handle,record)
        return {'version':result}
    if op in ('write','truncate','readStaged','flush','release','closeWrite','completeWrite','flushStatus'):
        handle=request.get('handleId'); record=HANDLES.get(handle)
        if record is None: fail('EBADF')
        if op in ('write','truncate') and record['committed']: fail('EROFS')
        if op=='flushStatus' and record['committed']: return {'flushed':True,'version':record['result']}
        if op in ('flush','release') and record['committed']:
            result=record['result']
            if op=='release': cleanup_record(handle,record)
            return {'version':result}
        fd=record.get('fd')
        opened_fd=False
        if fd is None:
            parentfd=dir_for(record['parentPath'] or '/')
            try: stagefd=os.open(record['stageDir'],os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=parentfd)
            finally: os.close(parentfd)
            try:
                fd=os.open(record['stage'],os.O_RDWR|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=stagefd)
                opened_fd=True
            finally: os.close(stagefd)
        try:
            info=os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or info.st_uid!=os.getuid() or info.st_mode&0o077: fail('EACCES')
            if (not record['committed'] and info.st_nlink!=1) or (record['committed'] and info.st_nlink>1): fail('EACCES')
            if op=='write':
                off=request.get('offset'); raw=request.get('data')
                if not isinstance(off,int) or isinstance(off,bool) or off<0 or not isinstance(raw,str) or len(raw)>((MAX_IO+2)//3)*4: fail('EINVAL')
                try: data=base64.b64decode(raw,validate=True)
                except Exception: fail('EINVAL')
                if base64.b64encode(data).decode('ascii')!=raw: fail('EINVAL')
                if len(data)>MAX_IO or off+len(data)>MAX_FILE: fail('EFBIG')
                pos=0
                while pos<len(data):
                    n=os.pwrite(fd,data[pos:],off+pos)
                    if n<=0: fail('EIO')
                    pos+=n
                record['size']=max(record['size'],off+pos); return {'bytesWritten':pos}
            if op=='truncate':
                size=request.get('size')
                if not isinstance(size,int) or isinstance(size,bool) or size<0 or size>MAX_FILE: fail('EINVAL')
                os.ftruncate(fd,size); record['size']=size; return {'size':size}
            if op=='readStaged':
                off=request.get('offset'); size=request.get('size')
                if not isinstance(off,int) or isinstance(off,bool) or off<0 or not isinstance(size,int) or isinstance(size,bool) or size<0 or size>MAX_IO: fail('EINVAL')
                data=os.pread(fd,size,off); return {'data':base64.b64encode(data).decode('ascii'),'eof':off+len(data)>=os.fstat(fd).st_size}
            if op=='completeWrite': return {}
            if op=='flushStatus': return {'flushed':record['committed'],'version':record['result']}
            if op in ('flush','release'):
                result=record['result'] if record['committed'] else commit_record(handle,record,request.get('operationId',''))
                if op=='release': cleanup_record(handle,record)
                return {'version':result}
            if op=='closeWrite':
                record['retained']=True; HANDLES.pop(handle,None)
                fd=record.pop('fd',None)
                if fd is not None: os.close(fd)
                return {'recoveryPath':recovery(record)}
        finally:
            if opened_fd: os.close(fd)
    if op=='init-stop': return {}
    fail('EINVAL')

def commit_record(handle,record,operation):
    if record['committed']: return record['result']
    root_path=record['parentPath'] or '/'; parent=dir_for(root_path)
    stageparent=os.open(record['stageDir'],os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=parent)
    stagefile=None
    try:
        if current(parent,record['path'].split('/')[-1])!=record['base']: fail('ESTALE')
        stagefile=os.open(record['stage'],os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=stageparent)
        selected=os.fstat(stagefile)
        if not stat.S_ISREG(selected.st_mode) or selected.st_nlink!=1 or selected.st_uid!=os.getuid() or selected.st_mode&0o077: fail('EACCES')
        os.fsync(stagefile)
        try: os.link(record['stage'],record['path'].split('/')[-1],src_dir_fd=stageparent,dst_dir_fd=parent,follow_symlinks=False)
        except FileExistsError: fail('ESTALE')
        os.unlink(record['stage'],dir_fd=stageparent)
        os.fsync(stageparent); os.fsync(parent)
        committed=os.stat(record['path'].split('/')[-1],dir_fd=parent,follow_symlinks=False)
        result={'id':version(committed),'path':record['path']}
        record['fd']=stagefile; stagefile=None
        record['result']=result; record['operation']=operation; record['committed']=True
        return result
    except Exception:
        record['retained']=True
        raise
    finally:
        if stagefile is not None: os.close(stagefile)
        os.close(stageparent); os.close(parent)

for raw in sys.stdin.buffer:
    request={}
    try:
        if len(raw)>1536*1024: fail('EOVERFLOW')
        request=json.loads(raw)
        if not isinstance(request,dict) or not isinstance(request.get('id'),(str,int)) or isinstance(request.get('id'),bool): fail('EINVAL')
        response={'id':request['id'],'ok':True}; response.update(respond(request))
    except OSError as e:
        code=errno.errorcode.get(e.errno,'EIO')
        response={'id':request.get('id') if isinstance(request,dict) else '', 'ok':False,'errno':code}
        record=HANDLES.get(request.get('handleId')) if isinstance(request,dict) else None
        if record is not None: response['recoveryPath']=recovery(record)
    except Exception:
        response={'id':request.get('id') if isinstance(request,dict) else '', 'ok':False,'errno':'EIO'}
    try: sys.stdout.write(json.dumps(response,separators=(',',':'))+'\n'); sys.stdout.flush()
    except Exception: break
for handle,record in list(HANDLES.items()):
    if not record.get('retained'):
        try: cleanup_record(handle,record)
        except Exception: pass
if ROOT is not None:
    try: os.close(ROOT)
    except OSError: pass
`;

export const LIVE_WORKSPACE_HELPER_SOURCE = PYTHON_HELPER;

export type InstaboxTransportOptions = {
  sandboxId: string;
  root?: string;
  cliPath?: string;
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

function parseMachineIdentity(output: string): { id: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error('Instabox returned invalid machine JSON.');
  }
  const value =
    parsed && typeof parsed === 'object' && 'machine' in parsed
      ? (parsed as { machine: unknown }).machine
      : parsed;
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Instabox returned an invalid machine response.');
  const machine = value as { id?: unknown; machineId?: unknown };
  const id = typeof machine.id === 'string' ? machine.id : machine.machineId;
  if (typeof id !== 'string' || !/^m_[A-Za-z0-9_-]{1,128}$/.test(id))
    throw new Error('Instabox returned an invalid machine ID.');
  return { id };
}

function parseHelperResponse(line: string, expectedId: string | number): LiveWorkspaceResponse {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new Error('Instabox helper returned an invalid response.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Instabox helper returned an invalid response.');
  const response = value as Partial<LiveWorkspaceResponse>;
  const validId =
    (typeof response.id === 'string' && response.id.length > 0 && response.id.length <= 256) ||
    (typeof response.id === 'number' && Number.isSafeInteger(response.id) && response.id >= 0);
  if (!validId || response.id !== expectedId || typeof response.ok !== 'boolean')
    throw new Error('Instabox helper returned a mismatched response.');
  if (response.errno !== undefined && typeof response.errno !== 'string')
    throw new Error('Instabox helper returned an invalid error code.');
  return response as LiveWorkspaceResponse;
}

/** Authenticated CLI transport. It uploads only the fixed helper and sends RPC as framed stdin. */
export function createInstaboxLiveWorkspaceTransport(
  options: InstaboxTransportOptions,
): LiveWorkspaceTransport {
  const spawnProcess = options.spawnProcess ?? spawn;
  const cliPath = options.cliPath ?? 'instabox';
  if (options.cliPath !== undefined && !isAbsolute(options.cliPath))
    throw new Error('Configured Instabox CLI path must be absolute.');
  const sandboxId = options.sandboxId;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(sandboxId))
    throw new Error('Invalid Instabox sandbox identifier.');
  let child: ChildProcess | undefined;
  let tempDir: string | undefined;
  let pinnedMachineId: string | undefined;
  let rootIdentity: string | undefined;
  const registeredRoot = options.root ?? '';
  let decoder = new StringDecoder('utf8');
  let queue = Promise.resolve();
  let stdoutBuffer = '';
  const responseQueue: Array<{
    id: unknown;
    resolve(value: LiveWorkspaceResponse): void;
    reject(error: Error): void;
  }> = [];
  let startup: Promise<void> | undefined;
  let sessionClosing: Promise<void> | undefined;
  let tempCleanup: Promise<void> | undefined;
  let closed = false;
  const shutdownController = new AbortController();
  const closedChildren = new WeakSet<ChildProcess>();

  const runCli = (args: string[], signal?: AbortSignal) =>
    new Promise<string>((resolve, reject) => {
      const effectiveSignal = signal
        ? AbortSignal.any([signal, shutdownController.signal])
        : shutdownController.signal;
      const childProcess = spawnProcess(cliPath, args, {
        stdio: ['ignore', 'pipe', 'ignore'],
        env: liveWorkspaceInstaboxEnvironment(),
      });
      let output = '';
      let failure: Error | undefined;
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        effectiveSignal.removeEventListener('abort', abort);
        if (error) reject(error);
        else resolve(output);
      };
      childProcess.stdout!.on('data', (chunk: Buffer) => {
        if (failure) return;
        output += chunk.toString('utf8');
        if (Buffer.byteLength(output) > 64 * 1024) {
          failure = new Error('Instabox helper setup returned too much output.');
          childProcess.kill('SIGTERM');
        }
      });
      const abort = () => {
        failure = new DOMException('Canceled', 'AbortError');
        childProcess.kill('SIGTERM');
      };
      effectiveSignal.addEventListener('abort', abort, { once: true });
      childProcess.once('error', (error) => {
        failure = error;
        childProcess.kill('SIGTERM');
      });
      childProcess.once('close', (code) => {
        if (failure) finish(failure);
        else if (code === 0) finish();
        else finish(new Error(`Instabox helper setup failed (exit ${code ?? 'unknown'}).`));
      });
      if (effectiveSignal.aborted) abort();
    });

  const start = async (signal?: AbortSignal) => {
    if (closed) throw new Error('Instabox workspace transport is closed.');
    if (startup) return startup;
    startup = (async () => {
      await sessionClosing;
      await tempCleanup;
      const startupSignal = signal
        ? AbortSignal.any([signal, shutdownController.signal])
        : shutdownController.signal;
      let attemptDir: string | undefined;
      let attemptChild: ChildProcess | undefined;
      try {
        const lookupId = pinnedMachineId ?? sandboxId;
        const machine = parseMachineIdentity(
          await runCli(['get', lookupId, '--json'], startupSignal),
        );
        if (pinnedMachineId && machine.id !== pinnedMachineId)
          throw new Error('Instabox returned a different machine ID.');
        if (!pinnedMachineId) {
          if (/^m_[A-Za-z0-9_-]+$/.test(sandboxId) && machine.id !== sandboxId)
            throw new Error('Instabox returned a different machine ID.');
          pinnedMachineId = machine.id;
        }
        await options.beforeIO?.(pinnedMachineId, startupSignal);
        attemptDir = await mkdtemp(join(tmpdir(), 'agent-drive-live-'));
        tempDir = attemptDir;
        const helperPath = join(attemptDir, HELPER_FILENAME);
        await writeFile(helperPath, LIVE_WORKSPACE_HELPER_SOURCE, { mode: 0o600, flag: 'wx' });
        const remoteDir = `/tmp/agent-drive-live-${randomUUID()}`;
        const remotePath = `${remoteDir}/${HELPER_FILENAME}`;
        await runCli(
          ['ssh', pinnedMachineId, '--', 'mkdir', '-m', '700', '--', remoteDir],
          startupSignal,
        );
        await runCli(['cp', helperPath, `${pinnedMachineId}:${remotePath}`], startupSignal);
        const checked = await runCli(
          ['ssh', pinnedMachineId, '--', 'sha256sum', '--', remotePath],
          startupSignal,
        );
        const expectedHash = createHash('sha256')
          .update(LIVE_WORKSPACE_HELPER_SOURCE)
          .digest('hex');
        if (!checked.trim().startsWith(`${expectedHash} `))
          throw new Error('Instabox helper integrity check failed.');
        stdoutBuffer = '';
        decoder = new StringDecoder('utf8');
        const session = spawnProcess(
          cliPath,
          ['ssh', pinnedMachineId, '--', 'python3', '-u', remotePath],
          {
            stdio: ['pipe', 'pipe', 'ignore'],
            env: liveWorkspaceInstaboxEnvironment(),
          },
        );
        attemptChild = session;
        child = session;
        session.stdout!.on('data', (chunk: Buffer) => {
          stdoutBuffer += decoder.write(chunk);
          if (
            Buffer.byteLength(stdoutBuffer) > LIVE_WORKSPACE_MAX_LINE_BYTES &&
            !stdoutBuffer.includes('\n')
          ) {
            failSession(session, new Error('Instabox helper response exceeded the size limit.'));
            return;
          }
          let newline: number;
          while ((newline = stdoutBuffer.indexOf('\n')) >= 0) {
            const line = stdoutBuffer.slice(0, newline);
            stdoutBuffer = stdoutBuffer.slice(newline + 1);
            const pending = responseQueue.shift();
            if (!pending) {
              failSession(session, new Error('Instabox helper returned an unexpected response.'));
              return;
            }
            try {
              if (Buffer.byteLength(line) > LIVE_WORKSPACE_MAX_LINE_BYTES)
                throw new Error('Instabox helper response exceeded the size limit.');
              const response = parseHelperResponse(line, pending.id as string | number);
              pending.resolve(response);
            } catch (error) {
              pending.reject(
                error instanceof Error ? error : new Error('Invalid helper response.'),
              );
              failSession(
                session,
                error instanceof Error ? error : new Error('Invalid helper response.'),
              );
              return;
            }
          }
        });
        session.once('close', (code, signalName) => {
          closedChildren.add(session);
          if (child === session) {
            child = undefined;
            startup = undefined;
            clearSessionBuffers();
          }
          if (tempDir === attemptDir) {
            tempDir = undefined;
            if (attemptDir) {
              const cleanup = rm(attemptDir, { recursive: true, force: true }).catch(
                () => undefined,
              );
              const trackedCleanup = cleanup.finally(() => {
                if (tempCleanup === trackedCleanup) tempCleanup = undefined;
              });
              tempCleanup = trackedCleanup;
            }
          }
          rejectPending(
            new Error(
              `Instabox workspace transport closed (exit ${code ?? signalName ?? 'unknown'}).`,
            ),
          );
        });
        const init = await rawRequest(
          {
            id: 'init',
            op: 'init',
            root: registeredRoot,
            ...(rootIdentity ? { rootIdentity } : {}),
          },
          signal,
        );
        if (!init.ok)
          throw new Error(
            `Instabox workspace helper initialization failed (${String(init.errno ?? 'EIO')}).`,
          );
        if (
          typeof init.rootIdentity !== 'string' ||
          init.rootIdentity.length === 0 ||
          init.rootIdentity.length > 256
        )
          throw new Error('Instabox workspace helper returned an invalid root identity.');
        if (rootIdentity && init.rootIdentity !== rootIdentity)
          throw new Error('Instabox workspace root identity changed.');
        rootIdentity = init.rootIdentity;
      } catch (error) {
        if (attemptDir && tempDir === attemptDir) tempDir = undefined;
        if (attemptChild) await stopChild(attemptChild);
        if (attemptDir)
          await rm(attemptDir, { recursive: true, force: true }).catch(() => undefined);
        clearSessionBuffers();
        throw error;
      }
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

  const clearSessionBuffers = () => {
    stdoutBuffer = '';
    decoder = new StringDecoder('utf8');
  };

  const stopChild = async (process: ChildProcess) => {
    if (closedChildren.has(process)) return;
    if (process.exitCode === null && process.signalCode === null) process.kill('SIGTERM');
    await once(process, 'close').catch(() => undefined);
  };

  const failSession = (process: ChildProcess, error: Error) => {
    rejectPending(error);
    clearSessionBuffers();
    if (child === process) {
      child = undefined;
      startup = undefined;
    }
    const closing = stopChild(process).finally(() => {
      if (sessionClosing === closing) sessionClosing = undefined;
    });
    sessionClosing = closing;
  };

  const rawRequest = (payload: Record<string, unknown>, signal?: AbortSignal) =>
    new Promise<LiveWorkspaceResponse>((resolve, reject) => {
      if (signal?.aborted) return reject(new DOMException('Canceled', 'AbortError'));
      if (!child?.stdin || child.killed)
        return reject(new Error('Instabox workspace transport is unavailable.'));
      const active = child;
      const removeAbort = () => signal?.removeEventListener('abort', abort);
      const waiter: (typeof responseQueue)[number] = {
        id: payload.id,
        resolve: (response) => {
          removeAbort();
          resolve(response);
        },
        reject: (error) => {
          removeAbort();
          reject(error);
        },
      };
      const abort = () => {
        const index = responseQueue.indexOf(waiter);
        if (index >= 0) responseQueue.splice(index, 1);
        failSession(active, new DOMException('Canceled', 'AbortError'));
        reject(new DOMException('Canceled', 'AbortError'));
      };
      signal?.addEventListener('abort', abort, { once: true });
      responseQueue.push(waiter);
      const line = `${JSON.stringify(payload)}\n`;
      active.stdin!.write(line, (error) => {
        if (error) {
          const index = responseQueue.indexOf(waiter);
          if (index >= 0) responseQueue.splice(index, 1);
          removeAbort();
          reject(error);
          failSession(active, error);
        }
      });
    });

  return {
    async ensureReady(signal) {
      await start(signal);
    },
    request(payload, signal) {
      const result = queue.then(async () => {
        if (closed) throw new Error('Instabox workspace transport is closed.');
        if (payload.op === 'init')
          return { id: payload.id as string | number, ok: false, errno: 'EACCES' };
        if (!startup && payload.op !== 'init') await start(signal);
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
      if (closed) return;
      closed = true;
      shutdownController.abort();
      const pendingStartup = startup;
      const active = child;
      child = undefined;
      if (active) await stopChild(active);
      await pendingStartup?.catch(() => undefined);
      await sessionClosing;
      if (tempDir) await rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
      await tempCleanup;
      startup = undefined;
      rejectPending(new Error('Instabox workspace transport is closed.'));
      clearSessionBuffers();
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
      ...(process.env.AGENT_DRIVE_INSTABOX_CLI !== undefined
        ? { cliPath: process.env.AGENT_DRIVE_INSTABOX_CLI }
        : {}),
      ...(options.beforeIO ? { beforeIO: options.beforeIO } : {}),
      ...(options.spawnProcess ? { spawnProcess: options.spawnProcess } : {}),
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
      'mkdir',
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
        'mkdir',
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
          request.op === 'mkdir' ||
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
            'mkdir',
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
