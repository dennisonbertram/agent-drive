'use client';

import { UserButton, useReverification, useUser } from '@clerk/nextjs';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  Fragment,
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  type FocusEvent,
  type FormEvent,
  type MouseEvent,
  type RefObject,
  type ReactNode,
} from 'react';
import {
  DriveCryptoError,
  generateDriveKey,
  plaintextSize,
} from '../../../../../packages/agent-drive/src/crypto.ts';
import type { TraceInboxRecord } from '../../../../../packages/agent-drive/src/trace-inbox.ts';
import {
  loadInbox,
  openVersion,
  openVersionStream,
  type InboxCache,
} from '@/src/console/open-version';
import { BrandLogo, BrandMark } from '../../brand-mark';
import { CopyButton } from '../copy-button';
import { DriveMenu } from './drive-menu';
import { ListState } from './list-state';
import '../../styles/console.css';
import { startIdleLock } from '@/src/console/idle-lock';
import { KeyChip } from './key-chip';
import { UnlockDialog, type UnlockMode } from './unlock-dialog';
import { TracesDialog, type TracesKey } from './traces-dialog';
import {
  assertKeyForDrive,
  isDriveBoundSource,
  keySourceFor,
  type Source,
} from '@/src/console/webhook-setup';
import {
  BROWSER_KEY_DELETE_FAILED,
  Vault,
  vaultRequest,
  type LockReason,
} from '@/src/console/vault';
import { persistedAccountKey, vaultLockPeers } from '@/src/console/persisted-key';
import { PreviewBody, type PreviewView } from './preview-panel';
import { PREVIEW_MAX_BYTES, previewKind } from '@/src/console/preview';
import { FileIcon } from './file-icon';
import { MenuButton } from './menu-button';
import { Toast, type Announcement, type ToastItem } from './toast';
import { ConfirmBody } from './confirm-dialog';
import { RevokeControl, STATUS_LABEL, ShareDialog, type SharesState } from './share-dialog';
import { suspendNativeDialog } from '@/src/console/native-dialog-suspension';
import { addShareRow, type ShareRow } from '@/src/console/share-link';
import { versionWhen } from '@/src/console/when';
import { formatBytes, formatMetered } from '@/src/format/bytes';
import {
  cleanupDownloadScratch,
  createDownloadSink,
  DownloadSaveError,
} from '@/src/share/download';
import {
  ROOT,
  crumbs,
  fileKind,
  folderFromParam,
  listPrefix,
  recentFiles,
  rowsFromListing,
  sortRows,
  type FileRow,
  type Row,
  type SortKey,
} from '@/src/console/file-tree';

type Drive = {
  id: string;
  name: string;
  quota_bytes: string | number;
  key_backup_at?: string | null;
  key_backup_method?: string | null;
  agentOnly?: boolean;
};
type Agent = {
  id: string;
  name: string;
  active_key_count: number;
  total_key_count: number;
};
type ApiKey = {
  id: string;
  label: string;
  agent_id: string;
  drive_ids: string[];
  scopes: string[];
  write_paths?: string[];
  issued_by_agent_id?: string | null;
  revoked_at: string | null;
};
type FileEntry = {
  id: string;
  path: string;
  version_id?: string;
  ciphertext_size?: number;
  agent_id?: string;
  created_at?: string;
  deletedAt?: string;
  // Folder listing rows (delimiter=/): a folder has no id or version.
  kind?: 'file' | 'folder';
  items?: number;
};
type Version = {
  id: string;
  path: string;
  ciphertextSize: number;
  createdAt: string;
  agentId: string;
  userId: string | null;
};
type Page<T> = { items: T[]; nextCursor: string | null };
type Usage = {
  plan: string;
  limits: { storageBytes: string; operations: string; drives: string };
  storageBytes: number;
  operations: number;
  drives: {
    id: string;
    name: string;
    quotaBytes: number;
    deleting: boolean;
    storageBytes: number;
    liveFiles: number;
    versions: number;
  }[];
  agents: {
    id: string;
    name: string;
    storageBytes: number;
    versions: number;
    operations: number;
  }[];
};
type FolderUsage = {
  prefix: string;
  totalBytes: number;
  folders: { name: string; path: string; bytes: number; files: number }[];
  moreFolders: { count: number; bytes: number };
  directBytes: number;
  directFiles: number;
};
type Tab = 'Files' | 'Agents' | 'API keys' | 'Usage' | 'Trash';
type ModalName =
  | 'drive'
  | 'unlock'
  | 'agent'
  | 'connect'
  | 'key'
  | 'driveReceipt'
  | 'keyReceipt'
  | 'versions'
  | 'confirm'
  | 'preview'
  | 'share'
  | 'traces'
  | null;
const scopes = ['read', 'write', 'delete', 'share', 'manage'];
const isInternal = (path: string) => path.split('/').includes('.agent-drive');
const itemKey = (item: FileEntry) =>
  item.kind === 'folder' ? `folder:${item.path}` : `file:${item.id}`;
const LAST_DRIVE = 'agent-drive:last-drive';
const DEFAULT_SORT_DIR = { name: 'asc', modified: 'desc', size: 'desc' } as const;
// A job lives in /jobs/<id> (one ASCII identifier, up to 64 chars): the user drafts
// request.md, Submit renames it to submitted.md — the submission the runner looks
// for — and the runner records its claim in /jobs/.agent-drive/claims/<id>.json.
const JOB_FOLDER = /^\/jobs\/[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const JOB_REQUEST = /^\/jobs\/([A-Za-z0-9][A-Za-z0-9_-]{0,63})\/request\.md$/;

// What a row inside an open /jobs/<id> folder shows: Submit on the draft, or the one
// submission/pickup indicator on submitted.md — or on the draft when it is the only
// marker. The claims receipt is authoritative: a submitted.md or status.json file can
// exist without any worker claiming the job, so only `claimed` marks pickup and
// status.json stays a normal openable file.
function jobRowState(
  file: FileEntry,
  folder: string,
  submittedMarker: boolean,
  submitted: boolean | null,
  claimed: boolean,
): 'submit' | 'submitted' | 'not-submitted' | 'picked' | null {
  const cut = file.path.lastIndexOf('/');
  if ((file.path.slice(0, cut) || ROOT) !== folder) return null;
  const name = file.path.slice(cut + 1);
  if (name === 'submitted.md') {
    if (claimed) return 'picked';
    if (submitted === true) return 'submitted';
    if (submitted === false) return 'not-submitted';
    return null;
  }
  if (name !== 'request.md') return null;
  // A draft coexisting with a submitted or claimed job never submits again.
  if (submittedMarker) return null;
  return claimed ? 'picked' : 'submit';
}

function rememberedDrive() {
  try {
    return localStorage.getItem(LAST_DRIVE);
  } catch {
    return null;
  }
}

// The drive named in the URL, else the last one used in this browser, else the first.
function pickDrive(list: { id: string }[]) {
  const wanted = new URLSearchParams(window.location.search).get('drive');
  for (const id of [wanted, rememberedDrive()])
    if (id && list.some((item) => item.id === id)) return id;
  return list[0]?.id ?? '';
}

function baseName(path: string) {
  return path.slice(path.lastIndexOf('/') + 1);
}

function shortDate(value?: string) {
  return value ? new Date(value).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '—';
}

function count(n: number, noun: string) {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

// Whole percents; a real but sub-1% share reads "<1%" instead of rounding to 0%.
function shareOf(part: number, total: number) {
  if (total <= 0 || part <= 0) return '0%';
  const pct = (part / total) * 100;
  return pct < 1 ? '<1%' : `${Math.round(pct)}%`;
}

// Identical GETs started within half a second of each other share one request (React strict mode
// and a refresh that overlaps a page load would otherwise ask twice).
const inflight = new Map<string, { request: Promise<unknown>; at: number }>();
function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  if (method !== 'GET') return send<T>(path, method, body);
  // Only a request that just started is shared; a Retry later must ask again.
  const known = inflight.get(path);
  if (known && Date.now() - known.at < 500) return known.request as Promise<T>;
  const request = send<T>(path, method, body).finally(() => {
    if (inflight.get(path)?.request === request) inflight.delete(path);
  });
  inflight.set(path, { request, at: Date.now() });
  return request;
}
async function send<T>(
  path: string,
  method: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  let result: Response;
  try {
    result = await fetch(`/api/console/${path}`, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      ...(signal ? { signal } : {}),
      ...(body === undefined
        ? {}
        : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    });
  } catch {
    throw new Error('Could not reach Agent Drive. Check your connection and try again.');
  }
  if (result.status === 401) {
    window.location.assign('/sign-in');
    throw new Error('Your session expired. Sign in again.');
  }
  const data = await result.json().catch(() => {
    throw new Error('Agent Drive returned an unexpected response. Try again.');
  });
  if (!result.ok)
    throw Object.assign(new Error(data.error?.message ?? 'The request could not be completed.'), {
      status: result.status,
    });
  return data as T;
}

function useAgentInstruction() {
  const origin = useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => 'https://agentdrive.xyz',
  );
  return `Set up Agent Drive: ${origin}/llms.txt`;
}

function ConnectAgentBody() {
  const instruction = useAgentInstruction();
  const snippets = [
    ['Claude Code', 'claude mcp add agent-drive -- agent-drive mcp'],
    [
      'Codex (~/.codex/config.toml)',
      '[mcp_servers.agent-drive]\ncommand = "agent-drive"\nargs = ["mcp"]\n\n[mcp_servers.agent-drive.tools.put]\napproval_mode = "approve"\n[mcp_servers.agent-drive.tools.download]\napproval_mode = "approve"',
    ],
    [
      'Cursor or any MCP client',
      '{"mcpServers":{"agent-drive":{"command":"agent-drive","args":["mcp"]}}}',
    ],
  ];
  return (
    <>
      <p>
        Paste this into your agent. It installs the CLI and gives you a link and a verification
        code. Open the link, type the verification code from the terminal, and click Approve agent.
        The agent sets up its own encrypted drive, or you add it to a drive your other agents
        already use.
      </p>
      <div className="agent-give">
        <div className="terminal-command">
          <code>{instruction}</code>
          <CopyButton text={instruction} label="Copy agent instruction" />
        </div>
      </div>
      <p>
        <a href="/llms.txt">Read what your agent will see (llms.txt)</a>
      </p>
      {snippets.map(([name, text]) => (
        <details key={name}>
          <summary>MCP setup: {name}</summary>
          <pre>{text}</pre>
          <CopyButton text={text!} label={`Copy ${name} setup`} />
        </details>
      ))}
    </>
  );
}

function ConnectAgentPanel({ open }: { open: boolean }) {
  return (
    <details className="panel agent-panel" open={open}>
      <summary>Connect an agent</summary>
      <ConnectAgentBody />
    </details>
  );
}

async function firstPage<T>(path: string): Promise<Page<T>> {
  return api(`${path}${path.includes('?') ? '&' : '?'}limit=100`);
}

async function all<T>(path: string): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | null = null;
  do {
    const result: Page<T> = await api(
      `${path}${path.includes('?') ? '&' : '?'}limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    );
    items.push(...result.items);
    cursor = result.nextCursor;
  } while (cursor);
  return items;
}

function mergePage<T extends { id: string }>(items: T[], next: T[]) {
  const known = new Set(items.map((item) => item.id));
  return [...items, ...next.filter((item) => !known.has(item.id))];
}

function authorLabel(name: string) {
  return name === '__console__' ? 'Console' : name;
}

function size(bytes: number) {
  return formatBytes(bytes);
}

function deletedOn(value?: string) {
  return value
    ? new Date(value).toLocaleString([], {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : '—';
}

function modifiedAt(value?: string) {
  return value
    ? new Date(value).toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : '—';
}

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function Dialog({
  title,
  children,
  onClose,
  closable = true,
  className,
  dialogRef,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  closable?: boolean;
  className?: string | undefined;
  dialogRef: RefObject<HTMLDialogElement | null>;
}) {
  useEffect(() => {
    const dialog = dialogRef.current;
    const opener = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    // Land on the first field, or the Copy button of a secret receipt, not on Close.
    (
      dialog?.querySelector<HTMLElement>('[data-autofocus]') ??
      dialog?.querySelector<HTMLElement>(
        'input:not([type=checkbox]):not([type=file]):not([readonly]), select, .copy-button, .version-row button',
      )
    )?.focus();
    return () => {
      dialog?.close();
      // Give focus back to whatever opened the dialog, unless it has left the page.
      if (opener?.isConnected) opener.focus();
    };
  }, [dialogRef]);
  return (
    <dialog
      ref={dialogRef}
      tabIndex={-1}
      className={className}
      onCancel={(event) => {
        event.preventDefault();
        if (closable) onClose();
      }}
      aria-labelledby="dialog-title"
    >
      <div className="dialog-heading">
        <h2 id="dialog-title">{title}</h2>
        {closable && (
          <button type="button" className="icon-button" aria-label="Close dialog" onClick={onClose}>
            ×
          </button>
        )}
      </div>
      {children}
    </dialog>
  );
}

function SortHeader({
  label,
  sortable,
  active,
  dir,
  onSort,
}: {
  label: string;
  sortable: boolean;
  active: boolean;
  dir: 'asc' | 'desc';
  onSort: () => void;
}) {
  if (!sortable) return <th role="columnheader">{label}</th>;
  return (
    <th
      role="columnheader"
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button type="button" className="sort-button" onClick={onSort}>
        {label}
        {active && <span aria-hidden> {dir === 'asc' ? '▲' : '▼'}</span>}
      </button>
    </th>
  );
}

const IDLE_MESSAGE = 'Locked after 30 minutes without use. Enter your passphrase to continue.';
const NOT_IN_ACCOUNT =
  'Load this drive’s recovery file to open it. We’ll try to save its key for passphrase unlock.';
const MISMATCH = 'This drive’s account copy is invalid — load its recovery file to repair it.';
const AGENT_ONLY = 'Agent-only: open with a recovery file.';
const passThrough = <A extends unknown[], R>(fn: (...args: A) => Promise<R>) => fn;
function isClerkReverificationResult(value: unknown): boolean {
  return typeof value === 'object' && value !== null && 'clerk_error' in value;
}
function useClerkIdentity() {
  const { isLoaded, user } = useUser();
  return {
    loaded: isLoaded,
    userId: user?.id ?? null,
    email: user?.primaryEmailAddress?.emailAddress ?? '',
  };
}
function useNoIdentity() {
  return { loaded: true, userId: null as string | null, email: '' };
}
// Clerk's reverification cancel, or any other failure, as one line for a form.
function vaultFailure(reason: unknown, doing: string) {
  if ((reason as { code?: string } | null)?.code === 'reverification_cancelled')
    return `Confirm it’s you to ${doing}.`;
  return reason instanceof Error ? reason.message : 'Something went wrong. Please try again.';
}

/**
 * Can this browser run a passkey ceremony with the PRF extension? WebAuthn missing or an
 * explicit `extension:prf: false` means no; an unknown answer still gets the option — the
 * ceremony itself reports when this device cannot run it.
 */
async function detectPasskey() {
  if (
    typeof PublicKeyCredential === 'undefined' ||
    typeof navigator.credentials?.create !== 'function'
  )
    return false;
  try {
    const capabilities = await PublicKeyCredential.getClientCapabilities?.();
    return capabilities?.['extension:prf'] !== false;
  } catch {
    return true;
  }
}

export default function Console({ clerkEnabled }: { clerkEnabled: boolean }) {
  // clerkEnabled is constant for the life of the deployment, so the hook order never changes.
  const useIdentity = clerkEnabled ? useClerkIdentity : useNoIdentity;
  const identity = useIdentity();
  // The vault reads the current user id through this ref, so a mid-load identity change is seen.
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const resumeDialogRef = useRef<(() => void) | null>(null);
  const strictFetcher = useCallback(async (path: string, method?: string, body?: unknown) => {
    const result = await vaultRequest(path, method, body);
    if (isClerkReverificationResult(result) && !resumeDialogRef.current)
      resumeDialogRef.current = suspendNativeDialog(dialogRef.current);
    return result;
  }, []);
  const useWrap = (clerkEnabled ? useReverification : passThrough) as typeof passThrough;
  const strictRequest = useWrap(strictFetcher);
  const strictRequestRef = useRef(strictRequest);
  strictRequestRef.current = strictRequest;
  const resumeStrictDialog = useCallback(() => {
    const resume = resumeDialogRef.current;
    resumeDialogRef.current = null;
    resume?.();
  }, []);
  // `Request` is generic; vaultRequest is not. Keep the call pointed at the current
  // reverification wrapper and return from Clerk's external prompt before restoring the dialog.
  const strictApi = useCallback(
    async <T,>(path: string, method?: string, body?: unknown) => {
      try {
        return (await strictRequestRef.current(path, method, body)) as T;
      } finally {
        resumeStrictDialog();
      }
    },
    [resumeStrictDialog],
  );
  const lockedRef = useRef<(reason: LockReason) => void>(() => {});
  const [, bumpVault] = useReducer((count: number) => count + 1, 0);
  const inboxCache = useRef<InboxCache>(new Map());
  const loadDriveInbox = (id: string) => loadInbox(api, inboxCache.current, id);
  const [vault] = useState(
    () =>
      new Vault({
        request: (path, method, body) => api(path, method, body),
        strict: (path, method, body) => strictApi(path, method, body),
        envelope: async (driveId, path) => {
          const result = await api<{ items: { wrappedKey?: string }[] }>(
            `drives/${driveId}/versions?path=${encodeURIComponent(path)}&limit=1`,
          );
          const wrapped = result.items[0]?.wrappedKey;
          if (!wrapped) throw new Error('The file’s key could not be read.');
          return wrapped;
        },
        anyPath: async (driveId) => {
          const result = await api<{ items: { path: string }[] }>(
            `drives/${driveId}/search?limit=1`,
          );
          const live = result.items[0]?.path;
          if (live) return live;
          // Trash retains versions too. Check one retained path so a key can still be proven
          // when every file has been deleted.
          const trash = await api<{ items: { path: string }[] }>(`drives/${driveId}/trash?limit=1`);
          return trash.items[0]?.path;
        },
        inbox: async (driveId) =>
          (await api<{ inbox: TraceInboxRecord | null }>(`drives/${driveId}/trace-inbox`)).inbox,
        persisted: persistedAccountKey,
        peers: vaultLockPeers,
        owner: () => identityRef.current.userId,
        onLocked: (reason) => lockedRef.current(reason),
        onChange: () => bumpVault(),
        onNotice: (line) => setNotice(line),
      }),
  );
  const [unlockMode, setUnlockMode] = useState<UnlockMode>('recovery');
  const [recoveryNote, setRecoveryNote] = useState('');
  // WebAuthn + PRF support, probed once; drives the passkey affordances in menu and dialog.
  const [passkeyCapable, setPasskeyCapable] = useState(false);
  useEffect(() => {
    void cleanupDownloadScratch();
  }, []);
  useEffect(() => {
    let on = true;
    void detectPasskey().then((ok) => {
      if (on) setPasskeyCapable(ok);
    });
    return () => {
      on = false;
    };
  }, []);
  const [passkeyOffer, setPasskeyOffer] = useState<string | null>(null);
  const hasPasskey = vault.record?.passkey != null;
  // The unlock dialog opens on the strongest method this account+device pair has.
  const unlockEntry = (): UnlockMode => (hasPasskey && passkeyCapable ? 'passkey' : 'passphrase');
  // Increases when the drive changes, the unlock dialog closes, or a new action waits for a key.
  const actionEpoch = useRef(0);
  // Drives whose key this tab generated itself; those are sealed without a file check.
  const trustedDrives = useRef(new Map<string, string>());
  // Where each cached drive key came from; a raw pasted key cannot be matched to an empty drive.
  const keySources = useRef(new Map<string, Source>());
  const [tab, setTab] = useState<Tab>('Files');
  const [drives, setDrives] = useState<Drive[]>([]);
  const drivesNow = useRef<Drive[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [collectionPages, setCollectionPages] = useState<
    Record<'drives' | 'agents' | 'keys', { cursor: string | null; loading: boolean; error: string }>
  >({
    drives: { cursor: null, loading: false, error: '' },
    agents: { cursor: null, loading: false, error: '' },
    keys: { cursor: null, loading: false, error: '' },
  });
  const collectionCursors = useRef<Record<'drives' | 'agents' | 'keys', string | null>>({
    drives: null,
    agents: null,
    keys: null,
  });
  const collectionLoads = useRef(new Set<'drives' | 'agents' | 'keys'>());
  const collectionEpoch = useRef<Record<'drives' | 'agents' | 'keys', number>>({
    drives: 0,
    agents: 0,
    keys: 0,
  });
  const [usage, setUsage] = useState<Usage | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageError, setUsageError] = useState('');
  const [folderDrive, setFolderDrive] = useState('');
  const [folderPrefix, setFolderPrefix] = useState('/');
  const [folderUsage, setFolderUsage] = useState<{ key: string; data: FolderUsage } | null>(null);
  const [folderFailure, setFolderFailure] = useState<{ key: string; message: string } | null>(null);
  const [chosenDrive, setSelected] = useState('');
  const preferredDrive = useRef('');
  const [driveKeys, setDriveKeys] = useState<Record<string, string>>({});
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Set when the workspace load fails; unlike `error` it survives Dismiss, so the card stays.
  const [loadFailed, setLoadFailed] = useState(false);
  const [notice, setNotice] = useState('');
  const [modal, setModal] = useState<ModalName>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const toastSeq = useRef(0);
  const toastsNow = useRef<ToastItem[]>([]);
  // Rows moved to Trash but not yet gone from a loaded list: "fileId:versionId" -> path.
  const [hiddenRows, setHiddenRows] = useState<Map<string, { driveId: string; path: string }>>(
    new Map(),
  );
  const [confirmState, setConfirmState] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    run: () => Promise<void>;
  } | null>(null);
  // A file to scroll to and focus once its folder has loaded ("Show file").
  // The Restored toast waiting for its list to render: if the row is on screen, "Show file" goes.
  const [restoredWatch, setRestoredWatch] = useState<{
    id: number;
    message: string;
    driveId: string;
    path: string;
  } | null>(null);
  const focusRequest = useRef<{ driveId: string; path: string } | null>(null);
  const [focusTick, setFocusTick] = useState(0);
  const [navOpen, setNavOpen] = useState(false);
  const [driveReceipt, setDriveReceipt] = useState<{ id: string; key: string } | null>(null);
  const [keyReceipt, setKeyReceipt] = useState('');
  const [saved, setSaved] = useState(false);
  const [downloadingId, setDownloadingId] = useState('');
  const downloadAborters = useRef(new Map<string, AbortController>());
  // The "driveId:path" pair a job Submit is running for; the click pinned both and the version.
  const [jobSubmitting, setJobSubmitting] = useState('');
  const jobSubmittingNow = useRef('');
  // The open /jobs/<id> folder's receipt answer, scoped to `${driveId}:${folder}`
  // and the listing scope it answered: true = a worker claimed the id, false =
  // confirmed free, null = unknown. A non-404 answer or a lookup failure is
  // "unknown" — never queued, never claimed.
  const [jobClaim, setJobClaim] = useState<{
    key: string;
    scope: string;
    held: boolean | null;
    submitted: boolean | null;
    markerPresent: boolean;
  } | null>(null);
  const [memoryDownloadFile, setMemoryDownloadFile] = useState<FileEntry | null>(null);
  const [pickerRetry, setPickerRetry] = useState<FileEntry | null>(null);
  // The row whose Download or Preview asked for the key; it continues once the key loads.
  const [pendingAction, setPendingAction] = useState<
    | { driveId: string; file: FileEntry; kind: 'download' | 'preview' | 'share' }
    // The webhook setup and a fresh recovery file need a key but no file.
    | { driveId: string; kind: 'webhook' }
    | { driveId: string; kind: 'recovery' }
    | null
  >(null);
  // The key the unlock dialog just loaded for the webhook dialog, handed over once as it opens.
  const [tracesBusy, setTracesBusy] = useState(false);
  const [tracesResume, setTracesResume] = useState<TracesKey | undefined>();
  // The open preview. The decrypted bytes live only here; closing sets it to null.
  const [preview, setPreview] = useState<{ file: FileEntry; view: PreviewView } | null>(null);
  const previewRequest = useRef(0);
  // The file whose Share dialog is open, and the drive's share links (loaded when a dialog or the Shared view opens).
  const [shareFile, setShareFile] = useState<FileEntry | null>(null);
  const [shares, setShares] = useState<SharesState | null>(null);
  const sharesNow = useRef<SharesState | null>(null);
  const sharesSeq = useRef(0);
  const [selectedPath, setSelectedPath] = useState('');
  const [versions, setVersions] = useState<Version[]>([]);
  const [fileRefresh, setFileRefresh] = useState(0);
  const [filter, setFilter] = useState('');
  const [slowScope, setSlowScope] = useState('');
  // Stage of the key receipt, and the drive whose key-line download awaits "I saved it".
  const [receiptSaved, setReceiptSaved] = useState(false);
  const [keylineConfirm, setKeylineConfirm] = useState('');
  // Backups recorded in this page, so a refresh that started earlier cannot hide them.
  const recordedBackups = useRef<Record<string, { at: string; method: string }>>({});
  // The row whose Download asked for the key; it continues once the key loads.
  const idleLock = useRef<ReturnType<typeof startIdleLock> | null>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const crumbsRef = useRef<HTMLElement>(null);
  const focusCrumb = useRef(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({
    key: 'modified',
    dir: 'desc',
  });
  const [fileFailure, setFileFailure] = useState<{ scope: string; message: string } | null>(null);
  const [filePage, setFilePage] = useState<{
    scope: string;
    items: FileEntry[];
    capped: boolean;
    // The cursor of the next page (Browse and Recent), and whether this page answered a search.
    next: string | null;
    searched: boolean;
  } | null>(null);
  // Load more belongs to one listing (drive, folder, view, search and sort), never to another.
  const [more, setMore] = useState<{
    key: string;
    loading: boolean;
    error: string;
    changed: boolean;
    done: string;
  } | null>(null);
  const pageKeyNow = useRef('');
  const focusPages = useRef(0);
  // The search box text the server is asked about, 250 ms after the last keystroke.
  const [typed, setTyped] = useState('');
  // Where the Files list is: drive, folder and view live in the URL so reload and Back work.
  const params = useSearchParams();
  const folder = folderFromParam(params.get('path'));
  const viewParam = params.get('view');
  const view = viewParam === 'recent' || viewParam === 'shared' ? viewParam : 'browse';
  const sharedView = tab === 'Files' && view === 'shared';
  const urlDrive = params.get('drive');
  // Back and Forward change the drive in the URL; that wins over the last one chosen here.
  const requestedDrive = urlDrive || preferredDrive.current;
  const selected =
    (requestedDrive && drives.some((item) => item.id === requestedDrive) ? requestedDrive : '') ||
    chosenDrive;
  const deepLinkPending = Boolean(
    requestedDrive &&
      !drives.some((item) => item.id === requestedDrive) &&
      (collectionPages.drives.cursor || collectionPages.drives.loading),
  );
  // The drive the link names is known missing only once every drive page has been
  // seen; until then it may be past the first page (deepLinkPending). Its path
  // belongs to that drive, so it must not be fetched or shown under another one.
  const linkedDriveMissing = Boolean(
    ready && urlDrive && !drives.some((item) => item.id === urlDrive) && !deepLinkPending,
  );
  const fileScope = `${selected}:${tab}:${view}:${folder}:${fileRefresh}`;
  const searchTerm = tab === 'Files' && filter.trim() ? typed : '';
  const pageKey = `${fileScope}|${searchTerm}|${sort.key}:${sort.dir}`;
  const moreNow = more?.key === pageKey ? more : null;
  const loadingMore = Boolean(moreNow?.loading);
  // Search results are flat paths below the folder. Once the box is cleared they are stale.
  const pageNow =
    filePage?.scope === fileScope && (!filePage.searched || filter.trim()) ? filePage : null;
  const fileItems = (pageNow?.items ?? []).filter(
    (file) =>
      file.kind === 'folder' || !hiddenRows.has(`${selected}:${file.id}:${file.version_id}`),
  );
  const loadedFiles = fileItems.filter((file) => file.kind !== 'folder');
  const countKeys = (agentId: string) =>
    agents.find((agent) => agent.id === agentId)?.active_key_count ?? 0;
  const issuedBy = (id?: string | null) =>
    id ? `issued by ${agents.find((agent) => agent.id === id)?.name ?? 'another agent'}` : '';
  const activeKeyCount = apiKeys.filter((key) => !key.revoked_at).length;
  const hasRestrictedKeys = apiKeys.some((key) => key.write_paths?.length);
  const query = filter.toLowerCase();
  // Trash is a flat list of full paths. Files shows folder rows (Browse) or the newest files (Recent).
  const shownFiles = loadedFiles.filter((file) => file.path.toLowerCase().includes(query));
  const folderBase = folder === ROOT ? '/' : `${folder}/`;
  const fileRowOf = (file: FileEntry): FileRow => {
    const cut = file.path.lastIndexOf('/');
    return {
      kind: 'file',
      key: `file:${file.id}`,
      name: file.path.slice(cut + 1),
      parent: cut === 0 ? ROOT : file.path.slice(0, cut),
      file,
    };
  };
  let rows: Row[] = [];
  if (tab === 'Files' && view === 'recent') {
    rows = recentFiles(shownFiles);
  } else if (tab === 'Files') {
    // A search answer lists every matching file below this folder, at any depth. Until it
    // arrives, the folder's own rows are narrowed by name.
    const matches = pageNow?.searched
      ? loadedFiles
          .filter(
            (file) =>
              file.path.startsWith(folderBase) &&
              file.path.slice(folderBase.length).toLowerCase().includes(query),
          )
          .map(fileRowOf)
      : rowsFromListing(fileItems, folder).filter((row) => row.name.toLowerCase().includes(query));
    rows = sortRows(matches, sort.key, sort.dir);
  }
  // Only inside one canonical /jobs/<id> folder in ordinary browse — never root, Recent,
  // Shares, Trash, or a nested folder — inspect that folder's own loaded rows for the
  // submission markers. A marker the server has not sent yet — another page, a
  // filtered-out sibling — cannot veto a submit; the click-time receipt check and the
  // server's if-version guards decide instead.
  const inJobFolder = tab === 'Files' && view === 'browse' && JOB_FOLDER.test(folder);
  let jobSubmitted = false;
  let jobDraft = false;
  if (inJobFolder)
    for (const file of loadedFiles) {
      const cut = file.path.lastIndexOf('/');
      if ((file.path.slice(0, cut) || ROOT) !== folder) continue;
      const name = file.path.slice(cut + 1);
      if (name === 'submitted.md') jobSubmitted = true;
      else if (name === 'request.md') jobDraft = true;
      if (jobSubmitted && jobDraft) break;
    }
  // The claims receipt answers "picked up" for this one open folder — one metadata
  // lookup per folder view, never a per-row check. It is keyed to the drive and
  // folder it was asked about, so a late answer can never label another job.
  const jobMarkerNeeded = inJobFolder && (jobSubmitted || jobDraft);
  const jobClaimKey = `${selected}:${folder}`;
  const jobClaimed =
    jobClaim?.key === jobClaimKey && (jobClaim.scope === fileScope || jobClaim.held === true)
      ? jobClaim.held
      : null;
  const jobSubmission =
    jobClaim?.key === jobClaimKey && jobClaim.scope === fileScope ? jobClaim.submitted : null;
  const drive = drives.find((item) => item.id === selected);
  // Storage by folder: drives pending deletion still count in the account total but are
  // not offered here — the folders endpoint already refuses them. The select defaults to
  // the open drive, then the first drive with usage.
  const folderDrives = usage?.drives.filter((item) => !item.deleting) ?? [];
  const folderDriveId =
    (folderDrive && folderDrives.some((item) => item.id === folderDrive) ? folderDrive : '') ||
    (selected && folderDrives.some((item) => item.id === selected) ? selected : '') ||
    (folderDrives[0]?.id ?? '');
  const [folderDriveSeen, setFolderDriveSeen] = useState('');
  if (folderDriveSeen !== folderDriveId) {
    // The effective drive changed — maybe the open drive did — so the old prefix does not apply.
    setFolderDriveSeen(folderDriveId);
    setFolderPrefix('/');
  }
  const folderScope = `${folderDriveId}:${folderPrefix}`;
  const folderData = folderUsage?.key === folderScope ? folderUsage.data : null;
  const folderError = folderFailure?.key === folderScope ? folderFailure.message : '';
  const folderDriveTotal =
    usage?.drives.find((item) => item.id === folderDriveId)?.storageBytes ?? 0;
  const folderSegments = folderPrefix === '/' ? [] : folderPrefix.slice(1).split('/');
  const agentInstruction = useAgentInstruction();
  const origin =
    typeof window === 'undefined' ? 'https://your-agent-drive-host' : window.location.origin;
  // The backend's current version, not the newest timestamp: concurrent writes can commit out of order.
  const newestVersionId = loadedFiles.find((file) => file.path === selectedPath)?.version_id;
  const hasKey = Boolean(driveKeys[selected]);
  const sharedNow = shares?.driveId === selected && !shares.path ? shares : null;
  const sharedShown = (sharedNow?.items ?? [])
    .filter((row) => row.path.toLowerCase().includes(query))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const listed = sharedView
    ? sharedShown.length
    : tab === 'Files'
      ? rows.length
      : shownFiles.length;
  const loaded = sharedView ? sharedNow?.status === 'ready' : Boolean(pageNow);
  const failed = sharedView ? sharedNow?.status === 'error' : fileFailure?.scope === fileScope;
  const listStatus = failed
    ? 'error'
    : loaded
      ? 'ready'
      : slowScope === fileScope
        ? 'slow'
        : 'loading';
  const backupText = `Key backed up ${
    drive?.key_backup_at ? new Date(drive.key_backup_at).toLocaleDateString() : ''
  } (${drive?.key_backup_method})`;
  const activeAgents = agents.filter((agent) => agent.name !== '__console__');
  const keyOptionsLoaded =
    !collectionPages.drives.cursor &&
    !collectionPages.drives.loading &&
    !collectionPages.agents.cursor &&
    !collectionPages.agents.loading;

  const refreshOwner = useRef(0);
  const readyNow = useRef(false);
  const usageOwner = useRef(0);
  const usageRequest = useRef<Promise<void> | null>(null);
  const loadUsage = useCallback(() => {
    if (usageRequest.current) return usageRequest.current;
    const owner = ++usageOwner.current;
    setUsageLoading(true);
    setUsageError('');
    const request = api<Usage>('usage')
      .then((nextUsage) => {
        if (owner === usageOwner.current) setUsage(nextUsage);
      })
      .catch((reason: unknown) => {
        if (owner === usageOwner.current)
          setUsageError(reason instanceof Error ? reason.message : 'Could not load usage.');
      })
      .finally(() => {
        if (owner === usageOwner.current) setUsageLoading(false);
        if (usageRequest.current === request) usageRequest.current = null;
      });
    usageRequest.current = request;
    return request;
  }, []);
  const refresh = useCallback(async () => {
    const owner = ++refreshOwner.current;
    preferredDrive.current =
      new URLSearchParams(window.location.search).get('drive') || rememberedDrive() || '';
    collectionEpoch.current = {
      drives: collectionEpoch.current.drives + 1,
      agents: collectionEpoch.current.agents + 1,
      keys: collectionEpoch.current.keys + 1,
    };
    try {
      const [drivePage, agentPage, keyPage] = await Promise.all([
        firstPage<Drive>('drives'),
        firstPage<Agent>('agents'),
        firstPage<ApiKey>('keys'),
      ]);
      if (owner !== refreshOwner.current) return;
      // The first page is authoritative; stale cached rows must not survive a refresh.
      const nextDrives = drivePage.items.map((item) => {
        const recorded = recordedBackups.current[item.id];
        return recorded && !item.key_backup_at
          ? { ...item, key_backup_at: recorded.at, key_backup_method: recorded.method }
          : item;
      });
      drivesNow.current = nextDrives;
      setDrives(nextDrives);
      setAgents(agentPage.items);
      setApiKeys(keyPage.items);
      collectionCursors.current = {
        drives: drivePage.nextCursor,
        agents: agentPage.nextCursor,
        keys: keyPage.nextCursor,
      };
      setCollectionPages({
        drives: { cursor: drivePage.nextCursor, loading: false, error: '' },
        agents: { cursor: agentPage.nextCursor, loading: false, error: '' },
        keys: { cursor: keyPage.nextCursor, loading: false, error: '' },
      });
      setSelected((current) => {
        const requested = preferredDrive.current;
        if (requested && drivePage.nextCursor) return current || pickDrive(nextDrives);
        return nextDrives.some((item) => item.id === current) ? current : pickDrive(nextDrives);
      });
      readyNow.current = true;
      setReady(true);
      setLoadFailed(false);
      setFileRefresh((value) => value + 1);
    } catch (reason) {
      if (owner === refreshOwner.current) {
        if (!readyNow.current) setLoadFailed(true);
        throw reason;
      }
    }
  }, []);

  useEffect(() => {
    drivesNow.current = drives;
  }, [drives]);

  useEffect(() => {
    if (tab === 'Usage') void loadUsage();
  }, [tab, loadUsage]);

  async function loadCollectionPages(collection: 'drives' | 'agents' | 'keys', allPages = false) {
    if (collectionLoads.current.has(collection)) return;
    collectionLoads.current.add(collection);
    const epoch = collectionEpoch.current[collection];
    setCollectionPages((current) => ({
      ...current,
      [collection]: { ...current[collection], loading: true, error: '' },
    }));
    let cursor = collectionCursors.current[collection];
    try {
      do {
        if (!cursor) break;
        const page: Page<Drive | Agent | ApiKey> = await api(
          `${collection}?limit=100&cursor=${encodeURIComponent(cursor)}`,
        );
        if (epoch !== collectionEpoch.current[collection]) return;
        if (collection === 'drives')
          setDrives((current) => mergePage(current, page.items as Drive[]));
        else if (collection === 'agents')
          setAgents((current) => mergePage(current, page.items as Agent[]));
        else setApiKeys((current) => mergePage(current, page.items as ApiKey[]));
        cursor = page.nextCursor;
        collectionCursors.current[collection] = cursor;
        setCollectionPages((current) => ({
          ...current,
          [collection]: { cursor, loading: allPages && Boolean(cursor), error: '' },
        }));
      } while (allPages && cursor);
    } catch (reason) {
      if (epoch !== collectionEpoch.current[collection]) return;
      setCollectionPages((current) => ({
        ...current,
        [collection]: {
          cursor,
          loading: false,
          error: reason instanceof Error ? reason.message : 'Could not load more items.',
        },
      }));
    } finally {
      collectionLoads.current.delete(collection);
      setCollectionPages((current) => ({
        ...current,
        [collection]: { ...current[collection], loading: false },
      }));
    }
  }

  async function loadAllKeyOptions() {
    await Promise.all([loadCollectionPages('drives', true), loadCollectionPages('agents', true)]);
  }

  useEffect(() => {
    // Preserve direct links to drives beyond the first page without delaying the first render.
    if (
      requestedDrive &&
      !drives.some((item) => item.id === requestedDrive) &&
      collectionCursors.current.drives
    )
      void loadCollectionPages('drives');
    // The loader is stable in behavior and reads the current cursor from a ref.
  }, [requestedDrive, drives]);

  useEffect(() => {
    let active = true;
    void Promise.resolve()
      .then(() => {
        if (active) return refresh();
      })
      .catch((reason: Error) => {
        if (active) {
          setLoadFailed(true);
          setError(reason.message);
        }
      });
    return () => {
      active = false;
      refreshOwner.current += 1;
    };
  }, [refresh]);
  useEffect(() => {
    if (!filter.trim()) return setTyped('');
    const timer = setTimeout(() => setTyped(filter.trim()), 250);
    return () => clearTimeout(timer);
  }, [filter]);
  useEffect(() => {
    if (
      !selected ||
      deepLinkPending ||
      linkedDriveMissing ||
      (tab !== 'Files' && tab !== 'Trash') ||
      sharedView
    )
      return;
    let active = true;
    void (async () => {
      const searched = tab === 'Files' && Boolean(searchTerm);
      const browse = tab === 'Files' && view === 'browse';
      const recent = tab === 'Files' && view === 'recent';
      // Recent lists the newest changes under the open folder (all of them at the root).
      const prefix = browse || recent ? listPrefix(folder) : null;
      const path = `drives/${selected}/${tab === 'Trash' ? 'trash' : 'list'}`;
      // Browse, Trash, and search show a page first. Recent fills up to 50 visible files
      // (internal rows do not count), with a bounded traversal for sparse roots.
      const items: FileEntry[] = [];
      let cursor: string | null = null;
      let capped = false;
      let pages = 0;
      // Recent shows 50 user files; internal .agent-drive rows do not count, so it keeps
      // paging (up to 10 pages) until it has them or the list ends.
      const recentShort = () => items.filter((file) => !isInternal(file.path)).length < 50;
      do {
        pages += 1;
        const query = new URLSearchParams({ limit: '100' });
        if (tab === 'Files') {
          if (searched) query.set('q', searchTerm);
          else if (browse) query.set('delimiter', '/');
          if (!searched || !browse) query.set('sort', 'modified');
        }
        if (prefix) query.set('prefix', prefix);
        if (cursor) query.set('cursor', cursor);
        const result: Page<FileEntry> = await api(`${path}?${query}`);
        if (!active) return;
        items.push(...result.items);
        cursor = result.nextCursor;
        if (cursor && recent && recentShort() && pages >= 10) capped = true;
      } while (cursor && !capped && recent && recentShort());
      setFilePage({
        items,
        capped,
        next: recent && !recentShort() ? null : cursor,
        searched,
        scope: fileScope,
      });
      setFileFailure(null);
    })().catch((reason: Error) => {
      if (active) setFileFailure({ scope: fileScope, message: reason.message });
    });
    return () => {
      active = false;
    };
  }, [
    selected,
    tab,
    view,
    folder,
    fileScope,
    sharedView,
    searchTerm,
    deepLinkPending,
    linkedDriveMissing,
  ]);
  // Check the durable claim first; only its 404 allows a submitted.md approval
  // probe. Both answers belong to this drive, folder and listing generation.
  useEffect(() => {
    if (!jobMarkerNeeded || !selected) return;
    if (
      jobClaim?.key === jobClaimKey &&
      (jobClaim.held === true ||
        (jobClaim.scope === fileScope && jobClaim.markerPresent === jobSubmitted))
    )
      return;
    const key = jobClaimKey;
    const scope = fileScope;
    const jobId = folder.slice('/jobs/'.length);
    const receiptQuery = new URLSearchParams({
      path: `/jobs/.agent-drive/claims/${jobId}.json`,
      metadataOnly: '1',
    });
    const approvalQuery = new URLSearchParams({
      path: `/jobs/${jobId}/submitted.md`,
      metadataOnly: '1',
      jobApproval: '1',
    });
    const controller = new AbortController();
    let active = true;
    void (async () => {
      try {
        await send(`drives/${selected}/get?${receiptQuery}`, 'GET', undefined, controller.signal);
        if (active)
          setJobClaim({
            key,
            scope,
            held: true,
            submitted: null,
            markerPresent: jobSubmitted,
          });
        return;
      } catch (reason) {
        if ((reason as { status?: number }).status !== 404) {
          if (active)
            setJobClaim({
              key,
              scope,
              held: null,
              submitted: null,
              markerPresent: jobSubmitted,
            });
          return;
        }
      }

      if (!jobSubmitted) {
        if (active)
          setJobClaim({
            key,
            scope,
            held: false,
            submitted: null,
            markerPresent: false,
          });
        return;
      }

      try {
        const approval = await send<{
          path?: string;
          jobApproval?: boolean;
        }>(`drives/${selected}/get?${approvalQuery}`, 'GET', undefined, controller.signal);
        if (active)
          setJobClaim({
            key,
            scope,
            held: false,
            submitted:
              approval.path === `/jobs/${jobId}/submitted.md` && approval.jobApproval === true
                ? true
                : null,
            markerPresent: true,
          });
      } catch (reason) {
        if (active)
          setJobClaim({
            key,
            scope,
            held: false,
            submitted: (reason as { status?: number }).status === 404 ? false : null,
            markerPresent: true,
          });
      }
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [jobMarkerNeeded, jobSubmitted, jobClaim, jobClaimKey, fileScope, selected, folder]);
  // Load more: the next page of this folder, added below the rows already shown.
  async function loadMore() {
    const page = filePage;
    const key = pageKey;
    if (!page?.next || (more?.key === key && more.loading)) return;
    const mark = (patch: Partial<NonNullable<typeof more>>) =>
      setMore((current) =>
        pageKeyNow.current === key
          ? {
              loading: false,
              error: '',
              changed: false,
              done: '',
              ...(current?.key === key ? current : {}),
              ...patch,
              key,
            }
          : current,
      );
    setMore({ key, loading: true, error: '', changed: false, done: '' });
    try {
      const searched = page.searched;
      const browse = tab === 'Files' && view === 'browse';
      const recent = tab === 'Files' && view === 'recent';
      const path = `drives/${selected}/${tab === 'Trash' ? 'trash' : 'list'}`;
      const query = new URLSearchParams({ limit: '100', cursor: page.next });
      if (tab === 'Files') {
        if (searched) query.set('q', searchTerm);
        else if (browse) query.set('delimiter', '/');
        if (!searched || !browse) query.set('sort', 'modified');
      }
      const prefix = tab === 'Files' && (browse || recent) ? listPrefix(folder) : null;
      if (prefix) query.set('prefix', prefix);
      const result: Page<FileEntry> = await api(`${path}?${query}`);
      // The listing changed while the page loaded: drop it.
      if (pageKeyNow.current !== key) return;
      const known = new Set(page.items.map(itemKey));
      const fresh = result.items.filter((item) => !known.has(itemKey(item)));
      setFilePage((current) =>
        current && current.scope === page.scope && current.next === page.next
          ? {
              ...current,
              items: [...current.items, ...fresh],
              next:
                recent &&
                [...current.items, ...fresh].filter((file) => !isInternal(file.path)).length >= 50
                  ? null
                  : result.nextCursor,
            }
          : current,
      );
      mark({
        loading: false,
        done: result.nextCursor ? '' : `All ${page.items.length + fresh.length} items loaded.`,
      });
    } catch (reason) {
      if ((reason as { status?: number }).status === 400) {
        // The server no longer accepts this cursor: stop paging and ask for a refresh.
        setFilePage((current) => (current === page ? { ...current, next: null } : current));
        mark({ loading: false, changed: true });
      } else mark({ loading: false, error: (reason as Error).message });
    }
  }
  useEffect(() => {
    if (selected && sharedView) void loadShares(selected);
    // loadShares only uses refs and setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, sharedView, fileRefresh]);
  useEffect(() => {
    // A drive switch, tab switch or Retry changes fileScope, which restarts this timer.
    if (!selected || (tab !== 'Files' && tab !== 'Trash') || sharedView) return;
    const timer = setTimeout(() => setSlowScope(fileScope), 10_000);
    return () => {
      clearTimeout(timer);
      // Leaving a scope forgets that it was slow, so coming back starts a fresh 10 s.
      setSlowScope('');
    };
  }, [selected, tab, fileScope, sharedView]);
  // `usage` is a dependency on purpose: a reload of the summary (Refresh, or any other
  // usage refetch) reruns the folder request so both numbers describe the same moment.
  useEffect(() => {
    if (tab !== 'Usage' || !folderDriveId) return;
    let active = true;
    api<FolderUsage>(
      `usage/folders?drive=${encodeURIComponent(folderDriveId)}&prefix=${encodeURIComponent(folderPrefix)}`,
    )
      .then((data) => {
        if (!active) return;
        setFolderUsage({ key: folderScope, data });
        setFolderFailure((current) => (current?.key === folderScope ? null : current));
      })
      .catch((reason: Error) => {
        if (!active) return;
        setFolderFailure({ key: folderScope, message: reason.message });
        setFolderUsage((current) => (current?.key === folderScope ? null : current));
      });
    return () => {
      active = false;
    };
  }, [tab, folderDriveId, folderPrefix, folderScope, usage]);
  // Back and Forward leave other tabs for the list they changed.
  useEffect(() => {
    const onPop = () => {
      setTab((current) => (current === 'Trash' ? current : 'Files'));
      setFilter('');
      // A key prompt belongs to the drive it was opened for.
      setModal((current) =>
        current === 'unlock' || current === 'preview' || current === 'share' || current === 'traces'
          ? null
          : current,
      );
      setPendingAction(null);
      setPasskeyOffer(null);
      actionEpoch.current += 1;
      vault.cancelUnlock();
      previewRequest.current += 1;
      setPreview(null);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [vault]);
  // After opening a folder by link, keep keyboard users' place at the current folder.
  useEffect(() => {
    if (!focusCrumb.current) return;
    focusCrumb.current = false;
    const nav = crumbsRef.current;
    (nav?.querySelector<HTMLElement>('[aria-current="page"]') ?? nav)?.focus();
  }, [folder, view]);
  useEffect(() => {
    pageKeyNow.current = pageKey;
  }, [pageKey]);
  // "Show file": once the file's folder has loaded, bring its row into view and focus it.
  // A file past the first page is found by loading more pages (up to 10).
  useEffect(() => {
    const wanted = focusRequest.current;
    if (!wanted || tab !== 'Files' || listStatus !== 'ready') return;
    const cut = wanted.path.lastIndexOf('/');
    const where = cut > 0 ? wanted.path.slice(0, cut) : ROOT;
    if (selected !== wanted.driveId || folder !== where || view !== 'browse') return;
    const button = [...document.querySelectorAll<HTMLElement>('.file-panel .file-row-name')].find(
      (item) => item.dataset.path === wanted.path,
    );
    if (!button && pageNow?.next && focusPages.current < 10) {
      if (!loadingMore && !moreNow?.error) {
        focusPages.current += 1;
        void loadMore();
      }
      return;
    }
    focusRequest.current = null;
    button?.scrollIntoView({ block: 'nearest' });
    button?.focus();
    // loadMore only reads current state through its closure; this runs after every page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTick, tab, listStatus, selected, folder, view, filePage, loadingMore, moreNow]);
  // After the list renders: a restored file already in view needs no "Show file" button.
  useEffect(() => {
    if (!restoredWatch || tab !== 'Files' || listStatus !== 'ready') return;
    const { id, message, driveId, path } = restoredWatch;
    if (!toasts.some((item) => item.id === id && item.message === message)) {
      setRestoredWatch(null);
      return;
    }
    const row = [...document.querySelectorAll<HTMLElement>('.file-panel .file-row-name')].find(
      (item) => item.dataset.path === path,
    );
    const rect = row?.getBoundingClientRect();
    if (!rect || selected !== driveId || rect.top < 0 || rect.bottom > window.innerHeight) return;
    setRestoredWatch(null);
    showToast(message, {}, id);
  }, [restoredWatch, toasts, tab, listStatus, selected, filePage, hiddenRows]);
  // A drive the link names that is not in this account is replaced by the one
  // that opened — at that drive's root, since the linked path belongs to the
  // missing drive. With no drive to open, the link still gets its explanation.
  useEffect(() => {
    if (!linkedDriveMissing) return;
    // The open drive can be the one that vanished: a refresh keeps the stale
    // selection while later pages could still contain it. Once paging is done,
    // open a drive that is still there — the remembered one, else the first.
    const fallback =
      drives.find((item) => item.id === selected) ??
      drives.find((item) => item.id === pickDrive(drives));
    if (!fallback) {
      setNotice('The linked drive isn’t available in this account.');
      return;
    }
    if (fallback.id !== selected) setSelected(fallback.id);
    const next = new URLSearchParams(window.location.search);
    if (next.get('drive') !== fallback.id || next.has('path')) {
      next.set('drive', fallback.id);
      next.delete('path');
      window.history.replaceState(null, '', `${window.location.pathname}?${next}`);
    }
    setNotice(`The linked drive isn’t available in this account. Opened ${fallback.name} instead.`);
  }, [linkedDriveMissing, selected, drives]);
  useEffect(() => {
    if (!selected) return;
    try {
      localStorage.setItem(LAST_DRIVE, selected);
    } catch {
      // Storage can be blocked; the first drive opens next time.
    }
  }, [selected]);
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setNavOpen(false);
      document.querySelector<HTMLElement>('.nav-toggle')?.focus();
    };
    const onPointer = (event: PointerEvent) => {
      if (!(event.target as Element).closest('.sidebar')) setNavOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [navOpen]);
  useEffect(() => {
    if (!driveReceipt && !keyReceipt) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [driveReceipt, keyReceipt]);

  // Clear every key (and the account private key) after 30 minutes without use. Never touches
  // driveReceipt: that dialog holds the only copy of a new drive's key. A download already
  // running holds its key and finishes.
  const anyKey = Object.keys(driveKeys).length > 0;
  const vaultOpen = vault.status === 'unlocked';
  const unlockOpen = modal === 'unlock';
  // Everything that depends on a key goes away at once. Called by Lock, idle and stale records.
  function lockAll(message: string) {
    actionEpoch.current += 1;
    // Plaintext must not stay on screen after the key is cleared.
    previewRequest.current += 1;
    setPreview(null);
    // Closing the dialogs unmounts them, which clears typed passphrases and pasted keys and
    // cancels any recovery-file read still in flight.
    setModal((current) =>
      current === 'preview' || current === 'share' || current === 'unlock' || current === 'traces'
        ? null
        : current,
    );
    setPendingAction(null);
    setTracesResume(undefined);
    setPasskeyOffer(null);
    trustedDrives.current.clear();
    keySources.current.clear();
    setDriveKeys({});
    setKeylineConfirm('');
    setNotice(message);
  }
  lockedRef.current = (reason) =>
    lockAll(
      reason === 'idle'
        ? IDLE_MESSAGE
        : reason === 'stale'
          ? 'Your passphrase was changed elsewhere. Enter it again to continue.'
          : '',
    );
  useEffect(() => {
    if (!anyKey && !vaultOpen && !unlockOpen) return;
    const lock = startIdleLock({
      onIdle: () => {
        if (vault.status === 'unlocked' || vault.status === 'locked') vault.lock('idle');
        else
          lockAll(
            'The key was cleared after 30 minutes without use. You’ll be asked for the recovery file at the next download.',
          );
      },
    });
    idleLock.current = lock;
    return () => {
      lock.stop();
      idleLock.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anyKey, vaultOpen, unlockOpen]);
  // Load the passphrase record once Clerk reports a real identity — before isLoaded, userId
  // would read as signed-out and a stored key could be judged against the wrong owner.
  // Unmounting (leaving the page) drops the account key.
  useEffect(() => {
    if (!identity.loaded) return;
    void vault.load();
    return () => vault.clear();
  }, [vault, identity.loaded]);
  // Sign-out or another user in the same tab: nothing from the old user may stay.
  const lastUser = useRef(identity.userId);
  useEffect(() => {
    if (lastUser.current === identity.userId) return;
    const hadUser = lastUser.current !== null;
    lastUser.current = identity.userId;
    const refreshQuietly = () => void refresh().catch((reason: Error) => setError(reason.message));
    if (!hadUser) {
      refreshQuietly();
      return;
    }
    vault.clearBrowser();
    inboxCache.current.clear();
    recordedBackups.current = {};
    setDrives([]);
    drivesNow.current = [];
    setAgents([]);
    setApiKeys([]);
    collectionCursors.current = { drives: null, agents: null, keys: null };
    setCollectionPages({
      drives: { cursor: null, loading: false, error: '' },
      agents: { cursor: null, loading: false, error: '' },
      keys: { cursor: null, loading: false, error: '' },
    });
    setUsage(null);
    usageOwner.current += 1;
    usageRequest.current = null;
    setUsageLoading(false);
    setUsageError('');
    setFolderDrive('');
    setFolderPrefix('/');
    setFolderUsage(null);
    setFolderFailure(null);
    setSelected('');
    readyNow.current = false;
    setReady(false);
    setLoadFailed(false);
    lockAll('');
    void vault.load();
    refreshQuietly();
  }, [identity.userId, refresh, vault]);
  // A key prompt or resume belongs to one drive.
  useEffect(() => {
    actionEpoch.current += 1;
  }, [selected]);

  async function act(operation: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await operation();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Something went wrong. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  function open(name: ModalName) {
    setError('');
    setSaved(false);
    setModal(name);
  }
  function close() {
    if (modal === 'preview' || !busy) {
      setPendingAction(null);
      actionEpoch.current += 1;
      vault.cancelUnlock();
      setPasskeyOffer(null);
      closePreview();
      setShareFile(null);
      setModal(null);
      if (modal === 'share' && sharedView && selected) void loadShares(selected);
      setError('');
    }
  }
  function form(event: FormEvent<HTMLFormElement>, operation: (data: FormData) => Promise<void>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void act(() => operation(data));
  }

  // Move inside the Files list. History entries, not page loads: no server round trip per folder.
  function go(next: {
    drive?: string;
    path?: string | undefined;
    view?: 'browse' | 'recent' | 'shared';
  }) {
    const query = new URLSearchParams(window.location.search);
    if (selected && !query.get('drive')) {
      // Give the entry we leave a drive, so Back returns to it.
      const current = new URLSearchParams(query);
      current.set('drive', selected);
      window.history.replaceState(null, '', `?${current}`);
      query.set('drive', selected);
    }
    for (const [name, value] of Object.entries(next)) {
      if (value && value !== ROOT && value !== 'browse') query.set(name, value);
      else query.delete(name);
    }
    const text = query.toString();
    window.history.pushState(null, '', text ? `?${text}` : window.location.pathname);
    setFilter('');
  }
  function selectDrive(id: string) {
    if (id === selected && !new URLSearchParams(window.location.search).get('path')) return;
    setSelected(id);
    setNotice('');
    setModal((current) =>
      current === 'unlock' || current === 'preview' || current === 'share' || current === 'traces'
        ? null
        : current,
    );
    setPendingAction(null);
    setPasskeyOffer(null);
    actionEpoch.current += 1;
    vault.cancelUnlock();
    closePreview();
    go({ drive: id, path: undefined });
  }
  const hrefFor = (path: string) =>
    `?${new URLSearchParams({ ...(selected ? { drive: selected } : {}), ...(path !== ROOT ? { path } : {}) })}`;
  // A plain click moves in place; modified clicks keep the link's normal behaviour.
  const openFolder =
    (path: string, nextView?: 'browse') => (event: MouseEvent<HTMLAnchorElement>) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)
        return;
      event.preventDefault();
      focusCrumb.current = true;
      go(nextView ? { path, view: nextView } : { path });
    };
  const sortBy = (key: SortKey) =>
    setSort((current) => ({
      key,
      dir: current.key === key ? (current.dir === 'asc' ? 'desc' : 'asc') : DEFAULT_SORT_DIR[key],
    }));

  async function createDrive(data: FormData) {
    const key = generateDriveKey();
    const created = await api<Drive & { created: boolean }>('drives', 'POST', {
      name: String(data.get('name')).trim(),
      agentOnly: data.get('agentOnly') === 'on',
    });
    if (!created.created)
      throw new Error(
        'A drive with this name already exists. Load its original drive key instead.',
      );
    setDriveKeys((current) => ({ ...current, [created.id]: key }));
    // Skipped by the vault itself if it is locked before the write. Agent-only drives are never
    // sealed to the account, by definition.
    trustedDrives.current.set(created.id, key);
    if (vault.status === 'unlocked' && !created.agentOnly)
      void vault.addKey(created.id, key, { trusted: true });
    setDriveReceipt({ id: created.id, key });
    setReceiptSaved(false);
    setSaved(false);
    setModal('driveReceipt');
    await refresh();
    selectDrive(created.id);
  }

  // The drive key for a file action: the tab's copy, else the account's slot (verified against
  // this file). With neither, asks for it and returns undefined; the action resumes through
  // keyLoaded or the passphrase dialog. Returns undefined, doing nothing, if Lock, a drive change
  // or a newer action happened while it waited.
  async function keyFor(
    file: FileEntry,
    kind: 'download' | 'preview' | 'share',
  ): Promise<string | undefined> {
    const driveId = selected;
    const agentOnly = drives.find((item) => item.id === driveId)?.agentOnly === true;
    const cached = driveKeys[driveId];
    if (cached) {
      if (vault.status === 'unlocked' && !vault.hasSlot(driveId) && !agentOnly)
        void addToAccount(driveId, cached, file.path);
      return cached;
    }
    let note = '';
    if (vault.status === 'unlocked' && !agentOnly) {
      note = NOT_IN_ACCOUNT;
      const mark = actionEpoch.current;
      const epoch = vault.epochNow;
      const enrolled = await vault.ensureSlot(driveId);
      if (mark !== actionEpoch.current || epoch !== vault.epochNow) return undefined;
      if (enrolled) {
        const result = await vault.keyFor(driveId, file.path);
        if (mark !== actionEpoch.current || epoch !== vault.epochNow) return undefined;
        if (result.status === 'key') {
          setDriveKeys((current) => ({ ...current, [driveId]: result.key }));
          keySources.current.set(driveId, 'vault');
          return result.key;
        }
        if (result.status === 'stale') return undefined;
        note = result.status === 'mismatch' ? MISMATCH : NOT_IN_ACCOUNT;
      }
    }
    actionEpoch.current += 1;
    setPendingAction({ driveId, file, kind });
    setRecoveryNote(agentOnly ? AGENT_ONLY : note);
    setUnlockMode(vault.status === 'locked' && !agentOnly ? unlockEntry() : 'recovery');
    open('unlock');
    return undefined;
  }

  // The drive key for the webhook dialog, which needs no file: the tab's copy, else the account's
  // slot. With neither, asks for it (the dialog comes back through keyLoaded or the passphrase).
  async function webhookKey(): Promise<TracesKey | undefined> {
    const driveId = selected;
    const cached = driveKeys[driveId];
    if (cached)
      return {
        key: cached,
        source: keySourceFor(
          trustedDrives.current.get(driveId),
          keySources.current.get(driveId),
          cached,
        ),
      };
    const agentOnly = drives.find((item) => item.id === driveId)?.agentOnly === true;
    let invalid = false;
    const mark = actionEpoch.current;
    const epoch = vault.epochNow;
    const enrolled = vault.status === 'unlocked' && !agentOnly && (await vault.ensureSlot(driveId));
    if (mark !== actionEpoch.current || epoch !== vault.epochNow) return undefined;
    if (enrolled) {
      const key = await vault.slotKey(driveId);
      if (mark !== actionEpoch.current || epoch !== vault.epochNow) return undefined;
      if (key) {
        setDriveKeys((current) => ({ ...current, [driveId]: key }));
        keySources.current.set(driveId, 'vault');
        return { key, source: 'vault' };
      }
      // The slot exists but could not be opened with the account key: a recovery file repairs it.
      invalid = true;
    }
    actionEpoch.current += 1;
    setPendingAction({ driveId, kind: 'webhook' });
    setRecoveryNote(
      agentOnly
        ? AGENT_ONLY
        : invalid
          ? MISMATCH
          : vault.status === 'unlocked'
            ? NOT_IN_ACCOUNT
            : '',
    );
    setUnlockMode(vault.status === 'locked' && !agentOnly ? unlockEntry() : 'recovery');
    open('unlock');
    return undefined;
  }
  function showTraces() {
    go({ path: '/traces', view: 'recent' });
    setFileRefresh((n) => n + 1);
  }
  // Opens the webhook dialog; with a key it starts setting up straight away.
  function openTraces(key?: TracesKey) {
    setTracesResume(key);
    open('traces');
  }
  async function resumeWebhook() {
    const found = await webhookKey();
    if (found) openTraces(found);
  }

  function retryVault() {
    if (vault.status === 'error') void vault.load();
  }

  async function addToAccount(driveId: string, key: string, path?: string, recovery = false) {
    const mark = actionEpoch.current;
    const epoch = vault.epochNow;
    const live = () => mark === actionEpoch.current && epoch === vault.epochNow;
    const result = await vault
      .addKey(driveId, key, {
        ...(path === undefined ? {} : { path }),
        trusted: trustedDrives.current.get(driveId) === key,
      })
      .catch(() => 'skipped' as const);
    if (!live()) return;
    if (result === 'added') setNotice('Added to your account. Next time your passphrase opens it.');
    else if (recovery && result === 'skipped')
      setNotice(
        'We couldn’t confirm this key was saved for passphrase unlock. Keep your recovery file.',
      );
  }

  async function download(file: FileEntry, key?: string, allowMemory = false) {
    key ??= await keyFor(file, 'download');
    if (!key) return;
    const active = downloadAborters.current.get(file.id);
    if (active) {
      active.abort();
      return;
    }
    const controller = new AbortController();
    downloadAborters.current.set(file.id, controller);
    setDownloadingId(file.id);
    let sink: Awaited<ReturnType<typeof createDownloadSink>> | undefined;
    try {
      const listedCiphertextBytes = Number(file.ciphertext_size);
      if (!Number.isSafeInteger(listedCiphertextBytes) || listedCiphertextBytes < 1)
        throw new Error('The listed file size is invalid. Reload the file list and try again.');
      const expectedPlaintextBytes = plaintextSize(listedCiphertextBytes);
      const name = file.path.split('/').at(-1) || 'download';
      sink = await createDownloadSink(name, expectedPlaintextBytes, {
        allowLargeBlob: allowMemory,
      });
      const versionQuery = file.version_id
        ? `&versionId=${encodeURIComponent(file.version_id)}`
        : '';
      const metadata = await api<{
        wrappedKey: string;
        downloadUrl: string;
        ciphertextSize: number;
      }>(`drives/${selected}/get?path=${encodeURIComponent(file.path)}${versionQuery}`);
      if (Number(metadata.ciphertextSize) !== listedCiphertextBytes)
        throw new Error(
          'This file changed since the list loaded. Refresh the file list and try again.',
        );
      let bytesWritten = 0;
      for await (const bytes of openVersionStream(
        api,
        selected,
        metadata,
        key,
        inboxCache.current,
        controller.signal,
      )) {
        if (controller.signal.aborted) {
          bytes.fill(0);
          throw new DOMException('The download was canceled.', 'AbortError');
        }
        bytesWritten += bytes.byteLength;
        await sink.write(bytes);
      }
      if (bytesWritten !== expectedPlaintextBytes)
        throw new Error('The decrypted file did not match its expected size.');
      await sink.finish();
      sink = undefined;
      setMemoryDownloadFile(null);
      setPickerRetry(null);
      showToast(`Download started: ${name}. Check your downloads.`);
      idleLock.current?.touch();
    } catch (reason) {
      await sink?.abort(reason).catch(() => {
        reason = new Error(
          'The download failed, and the temporary plaintext file could not be removed.',
        );
      });
      if (
        (reason instanceof DownloadSaveError && reason.code === 'unsupported-large-download') ||
        (reason instanceof DOMException && reason.name === 'QuotaExceededError')
      ) {
        setMemoryDownloadFile(file);
        setNotice(
          'The browser could not stage this large download to disk. Continuing may use memory equal to the file size.',
        );
      } else if (reason instanceof DownloadSaveError && reason.code === 'save-gesture-required') {
        setPickerRetry(file);
        setNotice(
          'Your browser needs a fresh save click. Choose Save file again to select a destination.',
        );
      } else if (
        controller.signal.aborted ||
        (reason instanceof DOMException && reason.name === 'AbortError')
      ) {
        showToast('Download canceled.');
      } else {
        const message =
          reason instanceof Error ? reason.message : 'The file could not be downloaded.';
        if (reason instanceof DriveCryptoError && reason.code === 'decryption_failed') {
          const driveId = selected;
          showToast(`${message} You can try another recovery key if you have one.`, {
            tone: 'error',
            action: {
              label: 'Try another key',
              run: (toastId) => {
                dismissToast(toastId);
                if (!driveId || selectedNow.current !== driveId) return;
                setDriveKeys((current) => {
                  const next = { ...current };
                  delete next[driveId];
                  return next;
                });
                keySources.current.delete(driveId);
                trustedDrives.current.delete(driveId);
                setPendingAction({ driveId, file, kind: 'download' });
                setRecoveryNote('');
                setUnlockMode('recovery');
                open('unlock');
              },
            },
          });
        } else {
          showToast(message, { tone: 'error' });
        }
      }
    } finally {
      if (downloadAborters.current.get(file.id) === controller)
        downloadAborters.current.delete(file.id);
      setDownloadingId((current) => (current === file.id ? '' : current));
    }
  }

  // Preview keeps at most the preview limit in memory; downloads use a disk-backed sink.
  async function fetchPlaintext(
    driveId: string,
    path: string,
    key: string,
    expectedCiphertextBytes: number,
    versionId?: string,
  ): Promise<Uint8Array> {
    const metadata = await api<{
      wrappedKey: string;
      downloadUrl: string;
      ciphertextSize: number;
    }>(
      `drives/${driveId}/get?path=${encodeURIComponent(path)}${versionId ? `&versionId=${versionId}` : ''}`,
    );
    if (Number(metadata.ciphertextSize) !== expectedCiphertextBytes)
      throw new Error(
        'This file changed since the list loaded. Refresh the file list and try again.',
      );
    return openVersion(api, driveId, metadata, key, inboxCache.current, PREVIEW_MAX_BYTES);
  }

  function closePreview() {
    previewRequest.current += 1;
    setPreview(null);
  }

  async function openPreview(file: FileEntry, key?: string) {
    const mine = ++previewRequest.current;
    const name = file.path.split('/').at(-1) || file.path;
    const show = (view: PreviewView) => {
      if (mine === previewRequest.current) setPreview({ file, view });
    };
    open('preview');
    show({ status: 'loading' });
    const kind = previewKind(name);
    const listed = Number(file.ciphertext_size ?? 0);
    if (kind === 'none') return show({ status: 'unsupported' });
    if (listed > PREVIEW_MAX_BYTES) return show({ status: 'too-large', sizeLabel: size(listed) });
    try {
      key ??= await keyFor(file, 'preview');
      if (mine !== previewRequest.current || !key) return;
      // Pin the listed version, so the size checked above is the size fetched.
      const bytes = await fetchPlaintext(selected, file.path, key, listed, file.version_id);
      if (bytes.length > PREVIEW_MAX_BYTES)
        return show({ status: 'too-large', sizeLabel: size(bytes.length) });
      show({ status: 'ready', kind, bytes });
      if (mine === previewRequest.current) idleLock.current?.touch();
    } catch (reason) {
      show({
        status: 'error',
        message: reason instanceof Error ? reason.message : 'The file could not be previewed.',
      });
    }
  }

  async function showVersions(path: string) {
    const result = await all<Version>(
      `drives/${selected}/versions?path=${encodeURIComponent(path)}`,
    );
    setVersions(result);
    setSelectedPath(path);
    setModal('versions');
  }

  const dismissToast = useCallback(
    (id: number) => setToasts((current) => current.filter((item) => item.id !== id)),
    [],
  );
  // Adds a toast (at most 3; the oldest goes first), or updates the one with `id` in place.
  // A result that arrives after its toast was dismissed gets a new toast.
  function showToast(
    message: string,
    extra: Partial<Omit<ToastItem, 'id' | 'rev' | 'message'>> = {},
    id?: number,
  ) {
    const next = ++toastSeq.current;
    const tone = extra.tone ?? 'info';
    const opener = document.activeElement;
    const returnTo =
      opener instanceof HTMLElement && !opener.closest('.toast-stack') && opener !== document.body
        ? opener
        : null;
    setToasts((current) => {
      const item: ToastItem = { id: id ?? next, rev: next, message, returnTo, ...extra };
      const at = id === undefined ? -1 : current.findIndex((entry) => entry.id === id);
      if (at >= 0) return current.map((entry, index) => (index === at ? item : entry));
      return [...current, item].slice(-3);
    });
    setAnnouncement({ text: message, tone, n: next });
    return id ?? next;
  }
  useEffect(() => {
    toastsNow.current = toasts;
  }, [toasts]);
  const selectedNow = useRef(selected);
  const tabNow = useRef(tab);
  const folderNow = useRef(folder);
  useEffect(() => {
    selectedNow.current = selected;
    tabNow.current = tab;
    folderNow.current = folder;
  }, [selected, tab, folder]);
  function unhide(driveId: string, path: string, exactKey?: string) {
    setHiddenRows((current) => {
      const next = new Map(
        [...current].filter(([key, hidden]) =>
          exactKey ? key !== exactKey : !(hidden.driveId === driveId && hidden.path === path),
        ),
      );
      return next.size === current.size ? current : next;
    });
  }
  // Go to the folder that holds a file, then scroll to its row and focus it.
  function showFile(driveId: string, path: string) {
    setTab('Files');
    setSelected(driveId);
    focusRequest.current = { driveId, path };
    focusPages.current = 0;
    setFocusTick((value) => value + 1);
    const cut = path.lastIndexOf('/');
    go({ drive: driveId, path: cut > 0 ? path.slice(0, cut) : undefined, view: 'browse' });
  }
  function restoredToast(driveId: string, path: string, replaceId?: number) {
    const message = `Restored “${baseName(path)}”.`;
    const id = showToast(
      message,
      {
        action: {
          label: 'Show file',
          run: (toastId) => {
            dismissToast(toastId);
            showFile(driveId, path);
          },
        },
      },
      replaceId,
    );
    setRestoredWatch({ id, message, driveId, path });
  }

  async function restore(driveId: string, path: string, versionId?: string) {
    await api(`drives/${driveId}/restore`, 'POST', { path, ...(versionId ? { versionId } : {}) });
    unhide(driveId, path);
    setModal(null);
    await refresh();
    restoredToast(driveId, path);
  }

  // Submit renames the draft to submitted.md — the submission the runner looks for.
  // The click pinned the drive, path and observed version; the server still has the
  // final say through the if-version checks, so a stale row or an existing
  // submitted.md answers a conflict. Browsing alone never submits; only this
  // explicit click does.
  async function submitJob(file: FileEntry) {
    const job = JOB_REQUEST.exec(file.path);
    const driveId = selected;
    const versionId = file.version_id;
    // No version means the row cannot prove what it is submitting; wait for a fresh list.
    // A second click while one is in flight, or a stale drive, never submits.
    if (!job || !driveId || !versionId || jobSubmittingNow.current) return;
    const jobId = job[1]!;
    const destinationPath = `/jobs/${jobId}/submitted.md`;
    const marker = `${driveId}:${file.path}`;
    jobSubmittingNow.current = marker;
    setJobSubmitting(marker);
    // The reply is only news while the click's drive and folder are still open — after
    // navigation the fresh listing carries the result and a stale toast would just confuse.
    const stillHere = () =>
      selectedNow.current === driveId && folderNow.current === folder && tabNow.current === 'Files';
    try {
      // The claims receipt is authoritative for "already picked up" and the listing
      // may predate it, so the click checks it fresh — no dedupe, no cached answer.
      // Only 404 proves the id is free; any other failure leaves it unknown and an
      // unknown job never gets a new submission.
      try {
        const query = new URLSearchParams({
          path: `/jobs/.agent-drive/claims/${jobId}.json`,
          metadataOnly: '1',
        });
        await send(`drives/${driveId}/get?${query}`, 'GET');
        if (stillHere()) {
          setJobClaim({
            key: `${driveId}:${folder}`,
            scope: fileScope,
            held: true,
            submitted: null,
            markerPresent: jobSubmitted,
          });
          showToast(`Job ${jobId} is already picked up — a worker claimed it.`, {
            tone: 'error',
          });
        }
        return;
      } catch (reason) {
        if ((reason as { status?: number }).status !== 404) {
          if (stillHere())
            showToast(
              `Could not check whether job ${jobId} is already claimed. ${
                reason instanceof Error ? reason.message : 'Try again.'
              } The list was refreshed.`,
              { tone: 'error' },
            );
          return;
        }
      }
      await api(`drives/${driveId}/rename`, 'POST', {
        path: file.path,
        destinationPath,
        ifSourceVersionId: versionId,
        ifDestinationVersionId: null,
        operationId: crypto.randomUUID(),
      });
      if (stillHere()) showToast(`Job ${jobId} submitted — the runner can pick it up now.`);
    } catch (reason) {
      if (stillHere()) {
        const status = (reason as { status?: number }).status;
        showToast(
          status === 409
            ? `Could not submit job ${jobId}: request.md changed or submitted.md already exists. The list was refreshed.`
            : `Could not confirm the submit for job ${jobId}. ${
                reason instanceof Error ? reason.message : 'Try again.'
              } The list was refreshed, but the submit result is still unconfirmed.`,
          { tone: 'error' },
        );
      }
    } finally {
      if (jobSubmittingNow.current === marker) jobSubmittingNow.current = '';
      setJobSubmitting((current) => (current === marker ? '' : current));
      // Whatever the reply, a fresh listing tells the truth — including an ambiguous reply
      // whose rename had actually committed.
      if (driveId === selectedNow.current) setFileRefresh((value) => value + 1);
    }
  }

  // Trash is instant: the row leaves at once, the request runs behind the toast, Undo restores.
  function trashFile(file: FileEntry, row: HTMLElement | null) {
    const driveId = selected;
    const name = baseName(file.path);
    const hideKey = `${driveId}:${file.id}:${file.version_id}`;
    (
      row?.nextElementSibling?.querySelector<HTMLElement>('.file-row-name') ??
      row?.previousElementSibling?.querySelector<HTMLElement>('.file-row-name') ??
      filterRef.current
    )?.focus();
    setHiddenRows((current) => new Map(current).set(hideKey, { driveId, path: file.path }));
    let toastId = 0;
    const moved = api(`drives/${driveId}/delete`, 'POST', { path: file.path }).then(
      () => {
        // A Trash list that loaded while the delete was running would miss this file.
        if (tabNow.current === 'Trash' && driveId === selectedNow.current)
          setFileRefresh((value) => value + 1);
        return true;
      },
      (reason: unknown) => {
        unhide(driveId, file.path, hideKey);
        // Update this file's own toast, never another file's.
        showToast(
          `Could not move “${name}” to Trash. ${reason instanceof Error ? reason.message : ''}`.trim(),
          { tone: 'error' },
          toastId,
        );
        return false;
      },
    );
    const movedText = `Moved “${name}” to Trash.`;
    toastId = showToast(movedText, {
      action: {
        label: 'Undo',
        run: async (id) => {
          if (!(await moved)) return;
          try {
            // No versionId: the same call as the Trash tab, so a newer write by an agent stays current.
            await api(`drives/${driveId}/restore`, 'POST', { path: file.path });
          } catch (reason) {
            showToast(
              `Could not restore “${name}”. ${reason instanceof Error ? reason.message : ''} It is still in Trash.`,
              { tone: 'error' },
              id,
            );
            return;
          }
          unhide(driveId, file.path, hideKey);
          if (driveId === selectedNow.current) setFileRefresh((value) => value + 1);
          restoredToast(driveId, file.path, id);
        },
      },
    });
    // Never delays the toast: once the delete is done, mention links that just stopped working.
    void moved.then(async (ok) => {
      if (!ok) return;
      const n = await fetchShareCount(driveId, file.path).catch(() => 0);
      if (!n) return;
      const message = `${movedText} Its ${n} share ${n === 1 ? 'link stops' : 'links stop'} working until you restore it.`;
      // Only the still-unchanged toast: not one that was dismissed, or already replaced by Undo.
      // Nothing is announced otherwise, so a screen reader never hears links stopped after an Undo.
      if (!toastsNow.current.some((item) => item.id === toastId && item.message === movedText))
        return;
      const seq = ++toastSeq.current;
      setToasts((current) =>
        current.map((item) =>
          item.id === toastId && item.message === movedText ? { ...item, message, rev: seq } : item,
        ),
      );
      setAnnouncement({ text: message, tone: 'info', n: seq });
    });
  }

  function askConfirm(next: NonNullable<typeof confirmState>) {
    setConfirmState(next);
    open('confirm');
  }

  async function fetchShareCount(driveId: string, path: string) {
    const query = new URLSearchParams({ path, countOnly: '1' });
    const result = await api<{ count: number }>(`drives/${driveId}/shares?${query}`);
    return result.count;
  }
  async function fetchSharePage(driveId: string, cursor?: string | null, path?: string) {
    const query = new URLSearchParams({ limit: '100' });
    if (path) query.set('path', path);
    if (cursor) query.set('cursor', cursor);
    return api<Page<ShareRow>>(`drives/${driveId}/shares?${query}`);
  }
  async function loadShares(driveId: string, path?: string) {
    const mine = ++sharesSeq.current;
    const put = (next: (current: SharesState | null) => SharesState) => {
      if (mine !== sharesSeq.current) return;
      const value = next(sharesNow.current);
      sharesNow.current = value;
      setShares(value);
    };
    const same = (current: SharesState | null) =>
      current?.driveId === driveId && current.path === path ? current : null;
    put((current) => ({
      driveId,
      ...(path ? { path } : {}),
      items: same(current)?.items ?? [],
      capped: same(current)?.capped ?? false,
      nextCursor: same(current)?.nextCursor ?? null,
      status: 'loading',
    }));
    try {
      const result = await fetchSharePage(driveId, null, path);
      // A link created while this load was running is not in its answer yet (it has no versionId here).
      put((current) => {
        const known = new Set(result.items.map((row) => row.id));
        const fresh = (same(current)?.items ?? []).filter(
          (row) => row.versionId === '' && !known.has(row.id),
        );
        return {
          driveId,
          ...(path ? { path } : {}),
          items: [...fresh, ...result.items],
          capped: false,
          nextCursor: result.nextCursor,
          status: 'ready',
        };
      });
    } catch (reason) {
      put((current) => ({
        driveId,
        ...(path ? { path } : {}),
        items: same(current)?.items ?? [],
        capped: false,
        nextCursor: same(current)?.nextCursor ?? null,
        status: 'error',
        message: reason instanceof Error ? reason.message : 'Could not load links.',
      }));
    }
  }
  async function loadMoreShares(driveId: string) {
    const current = sharesNow.current;
    if (current?.driveId !== driveId || !current.nextCursor || current.loadingMore) return;
    const cursor = current.nextCursor;
    const mine = ++sharesSeq.current;
    const put = (next: (state: SharesState) => SharesState) => {
      if (mine !== sharesSeq.current) return;
      const value = next(sharesNow.current ?? current);
      sharesNow.current = value;
      setShares(value);
    };
    put((state) => ({ ...state, loadingMore: true, message: '' }));
    try {
      const result = await fetchSharePage(driveId, cursor, current.path);
      put((state) => ({
        ...state,
        items: mergePage(state.items, result.items),
        nextCursor: result.nextCursor,
        loadingMore: false,
      }));
    } catch (reason) {
      put((state) => ({
        ...state,
        loadingMore: false,
        message: reason instanceof Error ? reason.message : 'Could not load more links.',
      }));
    }
  }
  // Only the list of that drive: a result that arrives after a drive switch must not enter another list.
  function updateShares(driveId: string, change: (items: ShareRow[]) => ShareRow[]) {
    setShares((current) => {
      const value =
        current?.driveId === driveId ? { ...current, items: change(current.items) } : current;
      sharesNow.current = value;
      return value;
    });
  }
  async function revokeShare(driveId: string, id: string) {
    const result = await api<{ revokedAt: string }>(`drives/${driveId}/shares/${id}`, 'DELETE');
    updateShares(driveId, (items) =>
      items.map((row) =>
        row.id === id ? { ...row, revokedAt: result.revokedAt, status: 'revoked' } : row,
      ),
    );
  }
  async function openShare(file: FileEntry, key?: string) {
    key ??= await keyFor(file, 'share');
    if (!key) return;
    setShareFile(file);
    void loadShares(selected, file.path);
    open('share');
  }

  function keyLoaded(key: string, source: Exclude<Source, 'trusted'>) {
    const pending = pendingAction;
    // The webhook dialog caches the key only after it has proven the key belongs to this drive.
    // A key that does not match is refused here, with the unlock dialog still open.
    if (pending?.kind === 'webhook') {
      assertKeyForDrive((id, k) => vault.verifyKey(id, k), pending.driveId, key).then(
        () => {
          setPendingAction(null);
          setModal(null);
          if (pending.driveId === selected) openTraces({ key, source });
        },
        (reason: unknown) =>
          setRecoveryNote(reason instanceof Error ? reason.message : 'That key could not be used.'),
      );
      return;
    }
    setPendingAction(null);
    setModal(null);
    // Recovery keys must not enter the cache or account until the recovery export verifies them.
    if (pending?.kind === 'recovery') {
      if (pending.driveId === selected) void act(() => downloadRecovery(key, source));
      return;
    }
    setDriveKeys((current) => ({ ...current, [selected]: key }));
    keySources.current.set(selected, source);
    // A key the user supplied also goes into the account, once it opens a real file.
    if (
      vault.status === 'unlocked' &&
      drives.find((item) => item.id === selected)?.agentOnly !== true
    )
      void addToAccount(
        selected,
        key,
        (pending && 'file' in pending ? pending.file : loadedFiles[0])?.path,
        true,
      );
    if (pending?.driveId !== selected) return;
    if (pending.kind === 'preview') void openPreview(pending.file, key);
    else if (pending.kind === 'share') void openShare(pending.file, key);
    else void act(() => download(pending.file, key));
  }

  function resume(pending: NonNullable<typeof pendingAction>) {
    if (pending.kind === 'webhook') void act(resumeWebhook);
    else if (pending.kind === 'recovery') void act(() => downloadRecovery());
    else if (pending.kind === 'preview') void openPreview(pending.file);
    else if (pending.kind === 'share') void act(() => openShare(pending.file));
    else void act(() => download(pending.file));
  }

  async function unlockWithPassphrase(passphrase: string, keepUnlocked: boolean) {
    const mark = actionEpoch.current;
    const pending = pendingAction;
    try {
      if (!(await vault.unlock(passphrase, keepUnlocked))) return '';
    } catch (reason) {
      return vaultFailure(reason, 'unlock');
    }
    setModal(null);
    // Closed, changed drive or locked meanwhile: stay unlocked, resume nothing.
    if (mark !== actionEpoch.current || !pending || pending.driveId !== selected) return '';
    setPendingAction(null);
    resume(pending);
    return '';
  }
  async function unlockWithPasskey(keepUnlocked: boolean) {
    const mark = actionEpoch.current;
    const pending = pendingAction;
    try {
      if (!(await vault.unlockWithPasskey(keepUnlocked))) return '';
    } catch (reason) {
      return vaultFailure(reason, 'unlock with your passkey');
    }
    setModal(null);
    // Same pending action resumes as a passphrase unlock: the download, preview or share the
    // user asked for continues with no second click.
    if (mark !== actionEpoch.current || !pending || pending.driveId !== selected) return '';
    setPendingAction(null);
    resume(pending);
    return '';
  }
  async function addPasskey(passphrase: string) {
    try {
      if (!(await vault.addPasskey(passphrase, identity.email || 'Agent Drive'))) return '';
    } catch (reason) {
      return vaultFailure(reason, 'add the passkey');
    }
    setModal(null);
    setNotice('Passkey added. Use it to unlock this account on this device.');
    return '';
  }
  async function setUpPassphrase(_old: string, passphrase: string) {
    try {
      const result = await vault.setup(
        passphrase,
        Object.fromEntries(
          Object.entries(driveKeys)
            // Agent-only drives never get a slot, including via passphrase setup — and neither
            // does a held key for a drive the listing does not show (deleted or foreign).
            .filter(([id]) => drives.some((item) => item.id === id && item.agentOnly !== true))
            .map(([id, key]) => [id, { key, trusted: trustedDrives.current.get(id) === key }]),
        ),
      );
      if (!result) return '';
      const text = result.total
        ? `Passphrase set up. ${count(result.added, 'drive')} added to your account.`
        : 'Passphrase set up. Your agent can now add its drives to your account.';
      setModal(null);
      setNotice(text);
      if (passkeyCapable) setPasskeyOffer(text);
      return '';
    } catch (reason) {
      return vaultFailure(reason, 'set up the passphrase');
    }
  }
  async function changePassphrase(oldPassphrase: string, newPassphrase: string) {
    try {
      if (!(await vault.change(oldPassphrase, newPassphrase))) return '';
      setModal(null);
      setNotice('Passphrase changed. Use the new one from now on.');
      return '';
    } catch (reason) {
      return vaultFailure(reason, 'change the passphrase');
    }
  }
  async function resetPassphrase() {
    try {
      await vault.reset();
      setUnlockMode('setup');
      return '';
    } catch (reason) {
      return vaultFailure(reason, 'reset the passphrase');
    }
  }
  function openVaultDialog(mode: UnlockMode) {
    setPendingAction(null);
    actionEpoch.current += 1;
    setRecoveryNote('');
    setUnlockMode(mode);
    open('unlock');
  }

  function saveRecoveryFile(driveId: string, key: string) {
    save(
      new Blob([JSON.stringify({ format: 'agent-drive-key-v1', driveId, key }, null, 2)], {
        type: 'application/json',
      }),
      `agent-drive-${driveId}.key.json`,
    );
  }

  async function downloadRecovery(
    suppliedKey?: string,
    suppliedSource?: Exclude<Source, 'trusted'>,
  ) {
    const driveId = selected;
    const mark = actionEpoch.current;
    const epoch = vault.epochNow;
    const current = () => mark === actionEpoch.current && epoch === vault.epochNow;
    let key = suppliedKey ?? driveKeys[driveId];
    const rejectKey = (rejectedKey: string, message: string): never => {
      setDriveKeys((current) => {
        if (current[driveId] !== rejectedKey) return current;
        const next = { ...current };
        delete next[driveId];
        return next;
      });
      if (driveKeys[driveId] === rejectedKey) keySources.current.delete(driveId);
      setPendingAction({ driveId, kind: 'recovery' });
      setRecoveryNote(message);
      setUnlockMode('recovery');
      open('unlock');
      throw new Error(message);
    };
    let fromAccount = false;
    let invalidAccountSlot = false;
    if (!key && vault.status === 'unlocked' && !drive?.agentOnly) {
      const enrolled = await vault.ensureSlot(driveId);
      if (!current()) return;
      if (enrolled) {
        key = (await vault.slotKey(driveId)) ?? undefined;
        if (!current()) return;
        if (!key) {
          invalidAccountSlot = true;
          if (await vault.ensureSlot(driveId, true))
            key = (await vault.slotKey(driveId)) ?? undefined;
          if (!current()) return;
        }
        fromAccount = true;
      }
    }
    if (!key) {
      actionEpoch.current += 1;
      setPendingAction({ driveId, kind: 'recovery' });
      setRecoveryNote(
        drive?.agentOnly
          ? AGENT_ONLY
          : invalidAccountSlot
            ? MISMATCH
            : 'No usable copy of this key is in your account.',
      );
      setUnlockMode(vault.status === 'locked' && !drive?.agentOnly ? unlockEntry() : 'recovery');
      open('unlock');
      return;
    }
    const source: Source = fromAccount
      ? 'vault'
      : (suppliedSource ??
        keySourceFor(trustedDrives.current.get(driveId), keySources.current.get(driveId), key));
    if (source !== 'trusted') {
      let verdict = await vault.verifyKey(driveId, key);
      if (!current()) return;
      // Another tab may have repaired this account slot while the current tab was unlocked.
      if (fromAccount && (verdict === 'mismatch' || verdict === 'unverifiable')) {
        if (await vault.ensureSlot(driveId, true)) {
          const refreshed = await vault.slotKey(driveId);
          if (!current()) return;
          if (refreshed) {
            key = refreshed;
            verdict = await vault.verifyKey(driveId, key);
            if (!current()) return;
          }
        }
      }
      if (verdict === 'mismatch') rejectKey(key, MISMATCH);
      if (verdict === 'unverifiable' && !isDriveBoundSource(source))
        rejectKey(
          key,
          'This drive has no file or trace inbox to confirm the key. Use a recovery file or credentials bundle for an empty drive.',
        );
    }
    if (fromAccount || suppliedKey) {
      setDriveKeys((keys) => ({ ...keys, [driveId]: key }));
      keySources.current.set(driveId, source);
      if (suppliedKey && vault.status === 'unlocked' && !drive?.agentOnly)
        void addToAccount(driveId, key, undefined, true);
    }
    saveRecoveryFile(driveId, key);
    setKeylineConfirm(driveId);
  }

  // Called only after the user confirms the file saved. Records the method; the key never leaves this page.
  async function recordBackup(driveId: string) {
    let recorded: { keyBackupAt: string; keyBackupMethod: string };
    try {
      recorded = await api(`drives/${driveId}/key-backup`, 'POST', { method: 'file' });
    } catch {
      throw new Error(
        'The backup was not recorded. Use Download recovery file, then I saved it, to try again.',
      );
    }
    recordedBackups.current[driveId] = {
      at: recorded.keyBackupAt,
      method: recorded.keyBackupMethod,
    };
    // Patch this drive from the response so a failing list or usage call cannot hide the backup.
    setDrives((current) =>
      current.map((item) =>
        item.id === driveId
          ? {
              ...item,
              key_backup_at: recorded.keyBackupAt,
              key_backup_method: recorded.keyBackupMethod,
            }
          : item,
      ),
    );
    setNotice('Recovery file saved. Store it in a password manager.');
  }

  const errorBanner = error && (
    <div role="alert" className="banner error">
      {error}
    </div>
  );
  const unlockStep = unlockMode === 'recovery' ? 'the key loads' : 'you unlock';
  return (
    <div className="console-shell">
      <aside className="sidebar" data-nav-open={navOpen}>
        <BrandMark />
        <div className="workspace-label">
          <span className="workspace-avatar">P</span>
          <div>
            Personal workspace<small>OPERATOR CONSOLE</small>
          </div>
        </div>
        <p className="nav-label">WORKSPACE</p>
        <button
          type="button"
          className="nav-toggle"
          aria-expanded={navOpen}
          aria-controls="console-nav"
          onClick={() => setNavOpen((value) => !value)}
        >
          {tab} <span aria-hidden>▾</span>
        </button>
        <nav aria-label="Workspace" id="console-nav">
          {(['Files', 'Agents', 'API keys', 'Usage', 'Trash'] as Tab[]).map((item, index) => (
            <button
              key={item}
              className={`nav-item ${tab === item ? 'active' : ''}`}
              aria-current={tab === item ? 'page' : undefined}
              onClick={() => {
                setTab(item);
                setError('');
                setNotice('');
                setFilter('');
                setNavOpen(false);
              }}
            >
              <span className="nav-icon" aria-hidden>
                {['▤', '⌘', '⚿', '▥', '⌫'][index]}
              </span>
              {item}
            </button>
          ))}
          <Link className="nav-item" href="/console/billing">
            <span className="nav-icon" aria-hidden>
              $
            </span>
            Billing &amp; limits
          </Link>
          <Link className="nav-item" href="/console/settings">
            <span className="nav-icon" aria-hidden>
              ↺
            </span>
            Activity &amp; deletion
          </Link>
        </nav>
        <div className="sidebar-bottom">
          <div className="privacy-note">
            <span className="status-dot" />
            <strong>Keys stay with you.</strong>
            <p>Only encrypted file contents reach our storage.</p>
          </div>
          <div className="profile-row">
            {clerkEnabled ? <UserButton /> : <span className="workspace-avatar">T</span>}
            <span>{clerkEnabled ? 'Your account' : 'Local test session'}</span>
          </div>
        </div>
      </aside>
      <main className="console-main">
        <header className="topbar">
          <span>
            Workspace <span className="breadcrumb">/</span> <strong>{tab}</strong>
          </span>
          <span className="encrypted-label">
            <span className="status-dot" /> CLIENT-SIDE ENCRYPTED
          </span>
        </header>
        <div className="console-content">
          <div className="page-heading">
            <div className="heading-text">
              <h1>{tab}</h1>
              <p
                role={error && !modal ? 'alert' : 'status'}
                className={
                  error && !modal ? 'notice-slot error' : notice ? 'notice-slot' : 'heading-sub'
                }
                title={(error && !modal ? error : notice) || undefined}
              >
                {error && !modal ? (
                  <>
                    <span className="notice-text">{error}</span>
                    <button type="button" className="notice-dismiss" onClick={() => setError('')}>
                      Dismiss
                    </button>
                  </>
                ) : notice ? (
                  <>
                    <span className="notice-text">{notice}</span>
                    {passkeyOffer === notice && (
                      <button
                        type="button"
                        className="notice-dismiss"
                        data-testid="passkey-offer"
                        onClick={() => {
                          setUnlockMode('passkeyAdd');
                          open('unlock');
                        }}
                      >
                        Add a passkey
                      </button>
                    )}
                    <button
                      type="button"
                      className="notice-dismiss"
                      onClick={() => {
                        setNotice('');
                        setPasskeyOffer(null);
                      }}
                    >
                      Dismiss
                    </button>
                  </>
                ) : vault.status === 'none' && tab === 'Files' && drives.length > 0 ? (
                  <>
                    <span className="notice-text">
                      Set a passphrase and agents will add every drive’s key to your account — then
                      each one opens here automatically.
                    </span>
                    <button
                      type="button"
                      className="notice-dismiss"
                      data-testid="setup-passphrase-banner"
                      onClick={() => openVaultDialog('setup')}
                    >
                      Set up
                    </button>
                  </>
                ) : (
                  {
                    Files: '',
                    Agents: 'Separate identities. Purpose-built permissions.',
                    'API keys': 'Give each agent access to exactly what it needs.',
                    Usage: 'Understand what your workspace stores and serves.',
                    Trash: 'Recover deleted files without losing their history.',
                  }[tab]
                )}
              </p>
            </div>
            <div className="actions">
              <button
                className="button secondary"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    await refresh();
                    if (tab === 'Usage' || usage) await loadUsage();
                  })
                }
              >
                Refresh
              </button>
              {tab === 'Files' && drives.length > 0 && (
                <button
                  className="button primary"
                  disabled={busy || !ready}
                  onClick={() => open('connect')}
                >
                  Connect an agent
                </button>
              )}
              {tab === 'Agents' && (
                <button className="button primary" disabled={busy} onClick={() => open('agent')}>
                  + New agent
                </button>
              )}
              {tab === 'API keys' && (
                <button
                  className="button primary"
                  disabled={busy || !drives.length || !activeAgents.length}
                  title={
                    !drives.length
                      ? 'Create a drive first.'
                      : !activeAgents.length
                        ? 'Create an agent first.'
                        : undefined
                  }
                  onClick={() => open('key')}
                >
                  + New API key
                </button>
              )}
            </div>
          </div>
          {!ready ? (
            <section className={`panel empty ${loadFailed ? '' : 'loading'}`}>
              <h2>{loadFailed ? 'Workspace unavailable' : 'Opening your workspace…'}</h2>
              <p>
                {loadFailed
                  ? 'Check the connection, then refresh to try again.'
                  : 'Loading your drives and access settings.'}
              </p>
              {loadFailed && (
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => void act(refresh)}
                >
                  Try again
                </button>
              )}
            </section>
          ) : (
            <>
              {tab === 'Files' && !drives.length && (
                <section className="onboarding panel">
                  <BrandLogo className="onboarding-logo" />
                  <p className="eyebrow">CONNECT YOUR AGENT</p>
                  <h2>Give your first agent a home.</h2>
                  <p>
                    Paste this line into your agent. It installs the CLI and gives you a link and a
                    verification code. Open the link, type the verification code from the terminal,
                    and click Approve agent. The agent sets up its own encrypted drive.
                  </p>
                  <div className="onboarding-command">
                    <code>{agentInstruction}</code>
                    <CopyButton
                      text={agentInstruction}
                      label="Copy agent instruction"
                      caption="Copy"
                      className="button primary"
                    />
                  </div>
                  <ol className="onboarding-steps">
                    <li>
                      <i>1</i> Paste one line into your agent.
                    </li>
                    <li>
                      <i>2</i> The agent shows a pairing code.
                    </li>
                    <li>
                      <i>3</i> You type its verification code and approve it once.
                    </li>
                  </ol>
                  <div className="onboarding-alt">
                    <p>Prefer to set up a drive yourself?</p>
                    <button className="button secondary" onClick={() => open('drive')}>
                      New drive
                    </button>
                  </div>
                </section>
              )}
              {(tab === 'Files' || tab === 'Trash') && drives.length > 0 && (
                <>
                  <section className={`panel file-panel ${tab === 'Trash' ? 'trash' : ''}`}>
                    <div className="panel-toolbar">
                      {tab === 'Files' ? (
                        <>
                          <h2 className="sr-only">Files</h2>
                          <nav
                            aria-label="Folder path"
                            className="crumbs"
                            ref={crumbsRef}
                            tabIndex={-1}
                          >
                            {folder === ROOT && !sharedView ? (
                              <span className="crumb">All files</span>
                            ) : (
                              <a
                                className="crumb"
                                href={hrefFor(ROOT)}
                                onClick={openFolder(ROOT, 'browse')}
                              >
                                All files
                              </a>
                            )}
                            <span className="crumb-sep" aria-hidden>
                              /
                            </span>
                            <DriveMenu
                              drives={drives}
                              usage={usage}
                              selected={selected}
                              formatSize={size}
                              onSelect={selectDrive}
                              onNewDrive={() => open('drive')}
                              onTraces={showTraces}
                              onCapture={() => openTraces()}
                              onOpen={loadUsage}
                              hasMore={Boolean(collectionPages.drives.cursor)}
                              loadingMore={collectionPages.drives.loading}
                              loadMoreError={collectionPages.drives.error}
                              onLoadMore={() => void loadCollectionPages('drives')}
                              disabled={busy || !ready}
                            />
                            {(sharedView ? [] : crumbs(folder)).map((crumb, index, all) => (
                              <Fragment key={crumb.path}>
                                <span className="crumb-sep" aria-hidden>
                                  /
                                </span>
                                {index === all.length - 1 ? (
                                  <>
                                    <a
                                      className="crumb-up"
                                      aria-label={`Up to ${all[index - 1]?.name ?? drive?.name}`}
                                      href={hrefFor(all[index - 1]?.path ?? ROOT)}
                                      onClick={openFolder(all[index - 1]?.path ?? ROOT)}
                                    >
                                      ‹
                                    </a>
                                    <span className="crumb-last" aria-current="page" tabIndex={-1}>
                                      {crumb.name}
                                    </span>
                                  </>
                                ) : (
                                  <a
                                    className="crumb"
                                    href={hrefFor(crumb.path)}
                                    onClick={openFolder(crumb.path)}
                                  >
                                    {crumb.name}
                                  </a>
                                )}
                              </Fragment>
                            ))}
                          </nav>
                        </>
                      ) : (
                        <div className="toolbar-title">
                          <h2>Deleted files</h2>
                          <DriveMenu
                            drives={drives}
                            usage={usage}
                            selected={selected}
                            formatSize={size}
                            onSelect={selectDrive}
                            onNewDrive={() => open('drive')}
                            onOpen={loadUsage}
                            hasMore={Boolean(collectionPages.drives.cursor)}
                            loadingMore={collectionPages.drives.loading}
                            loadMoreError={collectionPages.drives.error}
                            onLoadMore={() => void loadCollectionPages('drives')}
                            disabled={busy || !ready}
                          />
                        </div>
                      )}
                      <div className="toolbar-tools">
                        {tab === 'Files' && (
                          <>
                            <div className="view-switch" role="group" aria-label="View">
                              <button
                                type="button"
                                aria-pressed={view === 'browse'}
                                onClick={() => go({ view: 'browse' })}
                              >
                                Browse
                              </button>
                              <button
                                type="button"
                                aria-pressed={view === 'recent'}
                                onClick={() => go({ view: 'recent' })}
                              >
                                Recent
                              </button>
                              <button
                                type="button"
                                aria-pressed={view === 'shared'}
                                onClick={() => go({ view: 'shared' })}
                              >
                                Shared
                              </button>
                            </div>
                            {view === 'browse' && (
                              <select
                                className="sort-select"
                                aria-label="Sort by"
                                value={sort.key}
                                onChange={(event) => {
                                  const key = event.target.value as SortKey;
                                  setSort({ key, dir: DEFAULT_SORT_DIR[key] });
                                }}
                              >
                                <option value="modified">Modified</option>
                                <option value="name">Name</option>
                                <option value="size">Size</option>
                              </select>
                            )}
                          </>
                        )}
                        <input
                          aria-label={
                            tab === 'Trash'
                              ? 'Search deleted files'
                              : view === 'shared'
                                ? 'Search shared files'
                                : view === 'recent'
                                  ? 'Search recent files'
                                  : 'Search this folder'
                          }
                          placeholder={
                            tab === 'Trash'
                              ? 'Search deleted files…'
                              : view === 'shared'
                                ? 'Search shared files…'
                                : view === 'recent'
                                  ? 'Search recent files…'
                                  : 'Search this folder…'
                          }
                          ref={filterRef}
                          value={filter}
                          disabled={
                            sharedView
                              ? !sharedNow?.items.length
                              : !filePage?.items.length && !query
                          }
                          onChange={(event) => setFilter(event.target.value)}
                        />
                      </div>
                      <div className="toolbar-key">
                        {tab === 'Files' && (
                          <>
                            <button
                              type="button"
                              className="button secondary trace-btn"
                              data-testid="traces-link"
                              onClick={showTraces}
                            >
                              View traces
                            </button>
                            <button
                              type="button"
                              className="button secondary trace-btn"
                              data-testid="capture-link"
                              onClick={() => openTraces()}
                            >
                              Set up trace capture
                            </button>
                            <KeyChip
                              hasKey={hasKey}
                              backedUp={Boolean(drive?.key_backup_at)}
                              backupText={backupText}
                              confirming={keylineConfirm === selected}
                              busy={busy}
                              onLoad={() => openVaultDialog('recovery')}
                              vault={vault.status}
                              fingerprint={vault.fingerprint}
                              agentOnly={drive?.agentOnly === true}
                              passkey={
                                hasPasskey && passkeyCapable
                                  ? 'use'
                                  : !hasPasskey && passkeyCapable
                                    ? 'add'
                                    : undefined
                              }
                              vaultActions={{
                                onSetup: () => openVaultDialog('setup'),
                                onUnlock: () => openVaultDialog('passphrase'),
                                onPasskeyUnlock: () => openVaultDialog('passkey'),
                                onAddPasskey: () => openVaultDialog('passkeyAdd'),
                                onLock: () => vault.lock('manual'),
                                onLockBrowser: () => {
                                  void vault
                                    .lockBrowser()
                                    .catch(() => setNotice(BROWSER_KEY_DELETE_FAILED));
                                },
                                onChange: () => openVaultDialog('change'),
                                onReset: () => openVaultDialog('reset'),
                                onRetry: retryVault,
                              }}
                              onDownload={() => void act(() => downloadRecovery())}
                              onSaved={() =>
                                void act(async () => {
                                  setKeylineConfirm('');
                                  await recordBackup(selected);
                                })
                              }
                              onForget={() => {
                                setDriveKeys((current) => {
                                  const next = { ...current };
                                  delete next[selected];
                                  return next;
                                });
                                setKeylineConfirm('');
                                setNotice('Drive key removed from this browser session.');
                              }}
                            />
                          </>
                        )}
                      </div>
                    </div>
                    {listStatus !== 'ready' && (
                      <ListState
                        status={listStatus}
                        message={sharedView ? sharedNow?.message : fileFailure?.message}
                        noun={sharedView ? 'links' : 'files'}
                        onRetry={() => setFileRefresh((value) => value + 1)}
                      />
                    )}
                    {listStatus === 'ready' &&
                      (sharedView ? sharedNow?.capped : pageNow?.capped) && (
                        <p className="list-cap" role="note">
                          {sharedView
                            ? 'Showing the first 1,000 links.'
                            : tab === 'Trash'
                              ? 'Showing the first 1,000 deleted files. Some are not listed here.'
                              : view === 'recent'
                                ? 'Showing the newest files; some may be missing.'
                                : 'Showing the first 1,000 matches.'}
                        </p>
                      )}
                    {listStatus === 'ready' &&
                      pageNow?.next &&
                      (sort.key !== 'modified' || sort.dir !== 'desc') && (
                        <p className="list-cap" role="note" aria-live="polite">
                          {`Sorted within the ${listed} items loaded so far. Load more to include the rest.`}
                        </p>
                      )}
                    {listed > 0 && tab === 'Trash' && (
                      <div className="table-scroll table-stack">
                        <table role="table">
                          <thead role="rowgroup">
                            <tr role="row">
                              <th role="columnheader">FILE PATH</th>
                              <th role="columnheader">DELETED</th>
                              <th role="columnheader">
                                <span className="sr-only">Actions</span>
                              </th>
                            </tr>
                          </thead>
                          <tbody role="rowgroup">
                            {shownFiles.map((file) => (
                              <tr key={file.id} role="row">
                                <td className="file-cell primary" role="cell" title={file.path}>
                                  <span className="file-path">
                                    <span className="file-dir">
                                      {file.path.slice(0, file.path.lastIndexOf('/') + 1)}
                                    </span>
                                    <span className="file-name">
                                      {file.path.slice(file.path.lastIndexOf('/') + 1)}
                                    </span>
                                  </span>
                                </td>
                                <td role="cell" data-label="Deleted">
                                  {deletedOn(file.deletedAt)}
                                </td>
                                <td className="actions" role="cell">
                                  <div className="row-actions">
                                    <button
                                      className="row-primary"
                                      disabled={busy}
                                      onClick={() => void act(() => restore(selected, file.path))}
                                    >
                                      Restore
                                    </button>
                                    <button
                                      disabled={busy}
                                      onClick={() => void act(() => showVersions(file.path))}
                                    >
                                      Versions
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {listed > 0 && sharedView && listStatus === 'ready' && (
                      <div className="table-scroll browse-list shared-list">
                        <table role="table">
                          <thead role="rowgroup">
                            <tr role="row">
                              <th role="columnheader">FILE</th>
                              <th role="columnheader">CREATED</th>
                              <th role="columnheader">EXPIRES</th>
                              <th role="columnheader">STATUS</th>
                              <th role="columnheader">
                                <span className="sr-only">Actions</span>
                              </th>
                            </tr>
                          </thead>
                          <tbody role="rowgroup">
                            {sharedShown.map((row) => {
                              const name = baseName(row.path);
                              const parent = row.path.slice(0, row.path.lastIndexOf('/')) || ROOT;
                              return (
                                <tr key={row.id} role="row" data-kind="share">
                                  <td className="file-cell" role="cell">
                                    <span className="file-row-name">
                                      <FileIcon kind={fileKind(name)} />
                                      <span className="file-text">
                                        <span className="file-label">{name}</span>
                                        <span className="share-id">Link ID: {row.id}</span>
                                        <span className="file-meta">
                                          {STATUS_LABEL[row.status]} · expires{' '}
                                          {versionWhen(row.expiresAt)}
                                        </span>
                                      </span>
                                    </span>
                                    <a
                                      className="file-parent"
                                      href={hrefFor(parent)}
                                      onClick={openFolder(parent, 'browse')}
                                    >
                                      {parent}
                                    </a>
                                  </td>
                                  <td role="cell">{versionWhen(row.createdAt)}</td>
                                  <td role="cell">
                                    {row.status === 'expired'
                                      ? 'Expired'
                                      : versionWhen(row.expiresAt)}
                                  </td>
                                  <td role="cell">
                                    <span className="share-state" data-status={row.status}>
                                      {STATUS_LABEL[row.status]}
                                    </span>
                                  </td>
                                  <td className="row-actions-cell" role="cell">
                                    {(row.status === 'active' || row.status === 'unavailable') && (
                                      <RevokeControl
                                        question={`Stop link ${row.id} for ${name}?`}
                                        onRevoke={() => revokeShare(selected, row.id)}
                                      />
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {listStatus === 'ready' && sharedView && !listed && (
                      <div className="empty">
                        {query && sharedNow?.items.length ? (
                          <h3>{`No links match “${filter}”.`}</h3>
                        ) : (
                          <>
                            <h3>No share links yet.</h3>
                            <p>
                              Share a file from its ⋯ menu. Links can only be copied when they are
                              created.
                            </p>
                          </>
                        )}
                      </div>
                    )}
                    {listed > 0 && tab === 'Files' && !sharedView && (
                      <div className="table-scroll browse-list">
                        <table role="table">
                          <thead role="rowgroup">
                            <tr role="row">
                              {(
                                [
                                  ['name', 'NAME'],
                                  ['size', 'SIZE'],
                                ] as const
                              ).map(([key, label]) => (
                                <SortHeader
                                  key={key}
                                  label={label}
                                  sortable={view === 'browse'}
                                  active={sort.key === key}
                                  dir={sort.dir}
                                  onSort={() => sortBy(key)}
                                />
                              ))}
                              <th role="columnheader">AUTHOR</th>
                              <SortHeader
                                label="MODIFIED"
                                sortable={view === 'browse'}
                                active={sort.key === 'modified'}
                                dir={sort.dir}
                                onSort={() => sortBy('modified')}
                              />
                              <th role="columnheader">
                                <span className="sr-only">Actions</span>
                              </th>
                            </tr>
                          </thead>
                          <tbody role="rowgroup">
                            {rows.map((row) => {
                              if (row.kind === 'folder')
                                return (
                                  <tr key={row.key} role="row" data-kind="folder">
                                    <td className="file-cell" role="cell">
                                      <a
                                        className="file-row-name"
                                        href={hrefFor(row.path)}
                                        onClick={openFolder(row.path)}
                                      >
                                        <FileIcon kind="folder" />
                                        <span className="file-text">
                                          <span className="file-label">{row.name}</span>
                                          <span className="file-meta">
                                            {count(row.items, 'item')} · {shortDate(row.modified)}
                                          </span>
                                        </span>
                                      </a>
                                    </td>
                                    <td role="cell">{count(row.items, 'item')}</td>
                                    <td role="cell" />
                                    <td className="modified" role="cell">
                                      {modifiedAt(row.modified)}
                                    </td>
                                    <td role="cell" />
                                  </tr>
                                );
                              const file = row.file;
                              const author = authorLabel(
                                agents.find((agent) => agent.id === file.agent_id)?.name ??
                                  file.agent_id ??
                                  '',
                              );
                              const meta = `${size(Number(file.ciphertext_size ?? 0))} · ${shortDate(file.created_at)} · ${author}`;
                              const jobState = inJobFolder
                                ? jobRowState(
                                    file,
                                    folder,
                                    jobSubmitted,
                                    jobSubmission,
                                    jobClaimed === true,
                                  )
                                : null;
                              return (
                                <tr key={row.key} role="row" data-kind="file">
                                  <td className="file-cell" role="cell">
                                    <button
                                      type="button"
                                      className="file-row-name"
                                      title={`Preview ${row.name}`}
                                      data-path={file.path}
                                      onClick={() => {
                                        if (!busy) void openPreview(file);
                                      }}
                                    >
                                      <FileIcon kind={fileKind(row.name)} />
                                      <span className="file-text">
                                        <span className="file-label">{row.name}</span>
                                        <span className="file-meta">{meta}</span>
                                      </span>
                                    </button>
                                    {(view === 'recent' || query) && (
                                      <a
                                        className="file-parent"
                                        href={hrefFor(row.parent)}
                                        onClick={openFolder(row.parent, 'browse')}
                                      >
                                        {row.parent}
                                      </a>
                                    )}
                                  </td>
                                  <td role="cell">{size(Number(file.ciphertext_size ?? 0))}</td>
                                  <td role="cell">
                                    <span className="author">
                                      <span className="led dim" aria-hidden />
                                      {author}
                                    </span>
                                  </td>
                                  <td className="modified" role="cell">
                                    {modifiedAt(file.created_at)}
                                  </td>
                                  <td className="row-actions-cell" role="cell">
                                    <div className="row-actions">
                                      {jobState === 'submit' && (
                                        <button
                                          type="button"
                                          disabled={
                                            busy || Boolean(jobSubmitting) || !file.version_id
                                          }
                                          aria-busy={
                                            jobSubmitting === `${selected}:${file.path}` ||
                                            undefined
                                          }
                                          title={
                                            file.version_id
                                              ? 'Submit this request to the job runner — it becomes submitted.md'
                                              : 'Reload the file list before submitting — this row has no version to pin.'
                                          }
                                          onClick={() => void submitJob(file)}
                                        >
                                          Submit job
                                        </button>
                                      )}
                                      {jobState === 'submitted' && (
                                        <span
                                          className="muted"
                                          title="This request was explicitly submitted; Picked up appears once a worker claims it."
                                        >
                                          Submitted
                                        </span>
                                      )}
                                      {jobState === 'not-submitted' && (
                                        <span
                                          className="muted"
                                          title="This marker was not created by submitting request.md. Submit a draft request.md to create a runnable job."
                                        >
                                          Unsent
                                        </span>
                                      )}
                                      {jobState === 'picked' && (
                                        <span
                                          className="muted"
                                          title="A worker claimed this job — its execution receipt exists."
                                        >
                                          Picked up
                                        </span>
                                      )}
                                      <button
                                        className="row-primary"
                                        disabled={busy && downloadingId !== file.id}
                                        title="Decrypt and download"
                                        aria-busy={downloadingId === file.id || undefined}
                                        onClick={() => {
                                          if (downloadAborters.current.has(file.id))
                                            downloadAborters.current.get(file.id)?.abort();
                                          else void act(() => download(file));
                                        }}
                                      >
                                        {downloadingId === file.id ? 'Cancel download' : 'Download'}
                                      </button>
                                      {memoryDownloadFile?.id === file.id ? (
                                        <button
                                          className="row-secondary"
                                          disabled={busy}
                                          onClick={() =>
                                            void act(() => download(file, undefined, true))
                                          }
                                        >
                                          Use browser memory for this download
                                        </button>
                                      ) : null}
                                      {pickerRetry?.id === file.id ? (
                                        <button
                                          className="row-secondary"
                                          disabled={busy}
                                          onClick={() => void act(() => download(file))}
                                        >
                                          Save file again
                                        </button>
                                      ) : null}
                                      <MenuButton
                                        className="more-button"
                                        ariaLabel={`More actions for ${row.name}`}
                                        label="⋯"
                                        menuTestId="row-menu"
                                        menuClassName="row-menu"
                                      >
                                        <button
                                          type="button"
                                          className="menu-item"
                                          onClick={(event) => {
                                            event.currentTarget
                                              .closest<HTMLElement>('[popover]')
                                              ?.hidePopover();
                                            void act(() => showVersions(file.path));
                                          }}
                                        >
                                          Versions
                                        </button>
                                        <button
                                          type="button"
                                          className="menu-item"
                                          onClick={(event) => {
                                            event.currentTarget
                                              .closest<HTMLElement>('[popover]')
                                              ?.hidePopover();
                                            void act(() => openShare(file));
                                          }}
                                        >
                                          Share
                                        </button>
                                        <hr className="menu-divider" aria-hidden />
                                        <button
                                          type="button"
                                          className="menu-item danger"
                                          onClick={(event) => {
                                            const row = event.currentTarget.closest('tr');
                                            event.currentTarget
                                              .closest<HTMLElement>('[popover]')
                                              ?.hidePopover();
                                            trashFile(file, row);
                                          }}
                                        >
                                          Trash
                                        </button>
                                      </MenuButton>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {listStatus === 'ready' && !sharedView && !listed && !query && (
                      <div className="empty">
                        {tab === 'Trash' ? (
                          <>
                            <h3>Nothing in the trash.</h3>
                            <p>Deleted files appear here until permanently removed.</p>
                          </>
                        ) : view === 'recent' && folder === '/traces' ? (
                          <>
                            <h3>No traces yet.</h3>
                            <p>
                              Run an agent through <code>agent-drive capture</code>, or{' '}
                              <button
                                type="button"
                                className="share-revoke trace-link"
                                onClick={() => openTraces()}
                              >
                                add an OpenRouter webhook
                              </button>
                              .
                            </p>
                          </>
                        ) : view === 'recent' ? (
                          <>
                            <h3>No recent files.</h3>
                            <p>Files your agents write appear here, newest first.</p>
                          </>
                        ) : folder === ROOT ? (
                          <>
                            <h3>Ready for your first file.</h3>
                            <p>Connect an agent with the CLI or MCP to upload encrypted files.</p>
                            <p>
                              On a Mac?{' '}
                              <a href="/docs/cli#mount-in-finder-on-macos">
                                Mount your drive in Finder
                              </a>
                              .
                            </p>
                          </>
                        ) : (
                          <>
                            <h3>Nothing in this folder.</h3>
                            <p>Its files may have been moved or deleted.</p>
                            <button
                              className="button secondary"
                              onClick={() => go({ path: undefined })}
                            >
                              Back to {drive?.name}
                            </button>
                          </>
                        )}
                      </div>
                    )}
                    {listStatus === 'ready' && !sharedView && !listed && query && (
                      <div className="empty">
                        <h3>{`No ${tab === 'Trash' ? 'deleted ' : ''}files match “${filter}”.`}</h3>
                        <button
                          className="button secondary"
                          onClick={() => {
                            setFilter('');
                            filterRef.current?.focus();
                          }}
                        >
                          Clear filter
                        </button>
                      </div>
                    )}
                    <span className="sr-only" aria-live="polite">
                      {moreNow?.done}
                    </span>
                    {listStatus === 'ready' &&
                      (pageNow?.next ||
                        moreNow?.changed ||
                        (sharedView && sharedNow?.nextCursor)) && (
                        <div className="list-more">
                          {pageNow?.next && (
                            <button
                              className="button secondary"
                              disabled={loadingMore}
                              onClick={() => void loadMore()}
                            >
                              {loadingMore ? 'Loading…' : 'Load more'}
                            </button>
                          )}
                          {moreNow?.error && (
                            <span role="alert">{`Could not load more. ${moreNow.error}`}</span>
                          )}
                          {moreNow?.changed && (
                            <>
                              <span role="alert">This list changed. Refresh to continue.</span>
                              <button
                                className="button secondary"
                                onClick={() => setFileRefresh((value) => value + 1)}
                              >
                                Refresh
                              </button>
                            </>
                          )}
                          {sharedView && sharedNow?.nextCursor && (
                            <button
                              className="button secondary"
                              disabled={sharedNow.loadingMore}
                              onClick={() => void loadMoreShares(selected)}
                            >
                              {sharedNow.loadingMore
                                ? 'Loading links…'
                                : sharedNow.message
                                  ? 'Retry loading links'
                                  : 'Load more links'}
                            </button>
                          )}
                          {sharedView && sharedNow?.message && (
                            <span role="alert">{sharedNow.message}</span>
                          )}
                        </div>
                      )}
                    <div className="panel-footer">
                      <span className="footer-count" aria-live="polite">
                        {loaded
                          ? query
                            ? `${listed} ${listed === 1 ? 'match' : 'matches'}`
                            : sharedView
                              ? count(listed, 'link')
                              : tab === 'Trash'
                                ? `${listed} loaded`
                                : view === 'recent'
                                  ? `${listed} recent files`
                                  : pageNow?.next
                                    ? `${listed} loaded`
                                    : count(listed, 'item')
                          : ''}
                      </span>
                      <span>
                        File contents encrypted · Paths and metadata visible to the service
                      </span>
                    </div>
                  </section>
                </>
              )}
              <Toast toasts={toasts} announcement={announcement} onDismiss={dismissToast} />
              {tab === 'Trash' && !drives.length && (
                <section className="panel empty">
                  <h2>No drives yet.</h2>
                  <p>Create a drive to start storing files.</p>
                </section>
              )}
              {tab === 'Agents' && (
                <ConnectAgentPanel open={!activeAgents.length && !apiKeys.length} />
              )}
              {tab === 'Agents' && (
                <section className="panel">
                  <div className="panel-toolbar">
                    <h2>Agent identities</h2>
                    <span className="badge">
                      {activeAgents.length} {activeAgents.length === 1 ? 'agent' : 'agents'}
                    </span>
                  </div>
                  {!activeAgents.length && (
                    <div className="empty">
                      <h3>Who’s doing the work?</h3>
                      <p>Create an identity for your first agent, then issue a scoped API key.</p>
                      <button className="button primary" onClick={() => open('agent')}>
                        Create your first agent
                      </button>
                    </div>
                  )}
                  {activeAgents.map((agent) => (
                    <div className="entity-row" key={agent.id}>
                      <span className="entity-avatar">{agent.name.charAt(0).toUpperCase()}</span>
                      <div className="entity-info">
                        <strong>{agent.name}</strong>
                        <code>{agent.id}</code>
                        {apiKeys.some(
                          (key) => key.agent_id === agent.id && key.issued_by_agent_id,
                        ) && (
                          <small>
                            {issuedBy(
                              apiKeys.find(
                                (key) => key.agent_id === agent.id && key.issued_by_agent_id,
                              )?.issued_by_agent_id,
                            )}
                          </small>
                        )}
                      </div>
                      <span className="badge">
                        {countKeys(agent.id) > 0
                          ? `${countKeys(agent.id)} active ${countKeys(agent.id) === 1 ? 'key' : 'keys'}`
                          : agent.total_key_count > 0
                            ? 'Access revoked'
                            : 'No API keys'}
                      </span>
                      {countKeys(agent.id) > 0 && (
                        <button
                          className="button secondary"
                          aria-label={`Revoke access for ${agent.name}`}
                          disabled={busy}
                          onClick={() => {
                            const n = countKeys(agent.id);
                            askConfirm({
                              title: `Revoke access for ${agent.name}?`,
                              message: `${n} active API ${n === 1 ? 'key stops' : 'keys stop'} working now. Commands and MCP sessions that use ${n === 1 ? 'it' : 'them'} fail at their next request. Files this agent wrote stay in your drives. This cannot be undone. If a credentials bundle for this agent leaked, it also contains the drive key, and revoking the API key does not change that.`,
                              confirmLabel: `Revoke ${n} ${n === 1 ? 'key' : 'keys'}`,
                              run: async () => {
                                await api(`agents/${agent.id}/revoke`, 'POST', {});
                                await refresh();
                                showToast(`Revoked access for ${agent.name}.`);
                              },
                            });
                          }}
                        >
                          Revoke access
                        </button>
                      )}
                    </div>
                  ))}
                  {collectionPages.agents.cursor && (
                    <div className="panel-toolbar">
                      {collectionPages.agents.error && (
                        <span role="alert">{collectionPages.agents.error}</span>
                      )}
                      <button
                        type="button"
                        className="button secondary"
                        disabled={collectionPages.agents.loading}
                        onClick={() => void loadCollectionPages('agents')}
                      >
                        {collectionPages.agents.loading
                          ? 'Loading agents…'
                          : collectionPages.agents.error
                            ? 'Retry loading agents'
                            : 'Load more agents'}
                      </button>
                    </div>
                  )}
                </section>
              )}
              {tab === 'API keys' && (
                <>
                  <ConnectAgentPanel open={!activeAgents.length && !apiKeys.length} />
                  <section className="panel">
                    <div className="panel-toolbar">
                      <h2>Agent access</h2>
                      <span className="badge">
                        {activeKeyCount} active {activeKeyCount === 1 ? 'key' : 'keys'}
                      </span>
                    </div>
                    {(!drives.length || !activeAgents.length) && (
                      <div className="empty">
                        <h3>
                          {!drives.length ? 'Create a drive first.' : 'Create an agent first.'}
                        </h3>
                        <p>API keys belong to an agent and authorize specific drives.</p>
                        <button
                          className="button primary"
                          onClick={() => open(!drives.length ? 'drive' : 'agent')}
                        >
                          {!drives.length ? 'Create drive' : 'Create agent'}
                        </button>
                      </div>
                    )}
                    {drives.length > 0 && activeAgents.length > 0 && !apiKeys.length && (
                      <div className="empty">
                        <h3>Your agent’s connection starts here.</h3>
                        <p>Issue a scoped key. You’ll see the secret only once.</p>
                        <button className="button primary" onClick={() => open('key')}>
                          Create API key
                        </button>
                      </div>
                    )}
                    {apiKeys.map((key) => (
                      <div className="entity-row" key={key.id}>
                        <div className="entity-info">
                          <strong>{key.label}</strong>
                          <span>
                            {agents.find((agent) => agent.id === key.agent_id)?.name ?? 'Agent'} ·{' '}
                            {key.scopes.join(', ')}
                            {key.issued_by_agent_id && ` · ${issuedBy(key.issued_by_agent_id)}`}
                          </span>
                          {Boolean(key.write_paths?.length) && (
                            <>
                              <span>Write paths:</span>
                              {key.write_paths?.map((path) => (
                                <code key={path}>{path}</code>
                              ))}
                              <small>
                                Write paths do not restrict reads. Reading still requires read
                                permission on an allowed drive.
                              </small>
                            </>
                          )}
                          <small>
                            {key.drive_ids
                              .map((id) => drives.find((item) => item.id === id)?.name ?? id)
                              .join(' · ') || 'No drive access'}
                          </small>
                        </div>
                        <span className={`badge ${key.revoked_at ? '' : 'positive'}`}>
                          {key.revoked_at ? 'Revoked' : 'Active'}
                        </span>
                        <button
                          className="button secondary"
                          aria-label={`Revoke ${key.label}`}
                          disabled={busy || Boolean(key.revoked_at)}
                          onClick={() =>
                            askConfirm({
                              title: `Revoke ${key.label}?`,
                              message:
                                'Commands using this key stop working at their next request. This cannot be undone.',
                              confirmLabel: 'Revoke key',
                              run: async () => {
                                await api(`keys/${key.id}`, 'DELETE');
                                await refresh();
                                showToast(`Revoked ${key.label}.`);
                              },
                            })
                          }
                        >
                          Revoke
                        </button>
                      </div>
                    ))}
                    {collectionPages.keys.cursor && (
                      <div className="panel-toolbar">
                        {collectionPages.keys.error && (
                          <span role="alert">{collectionPages.keys.error}</span>
                        )}
                        <button
                          type="button"
                          className="button secondary"
                          disabled={collectionPages.keys.loading}
                          onClick={() => void loadCollectionPages('keys')}
                        >
                          {collectionPages.keys.loading
                            ? 'Loading API keys…'
                            : collectionPages.keys.error
                              ? 'Retry loading API keys'
                              : 'Load more API keys'}
                        </button>
                      </div>
                    )}
                  </section>
                  {hasRestrictedKeys && (
                    <p>
                      Replacing a restricted key? Use the CLI or API with the same drives,
                      permissions and write paths. Update and verify the agent before revoking the
                      old key.
                    </p>
                  )}
                  <section className="panel connection-guide">
                    <p className="eyebrow">FROM YOUR TERMINAL</p>
                    <h2>Connect without sharing your identity.</h2>
                    <p>
                      Install the CLI (Node 24 or newer) with{' '}
                      <code>npm install -g @dennisonbertram/agent-drive</code>. Save an existing API
                      key with <code>agent-drive login --api URL --token-stdin</code>, which reads
                      the key from stdin. In Bash, read both keys without putting them in shell
                      history; the commands after login run only if it succeeds:
                    </p>
                    <pre>
                      {`read -rs -p "API key: " K; printf '%s' "$K" | env -u AGENT_DRIVE_API_KEY agent-drive login --api ${origin}/api --token-stdin; ok=$?; unset K\n[ "$ok" = 0 ] && read -rs -p "Drive key: " AGENT_DRIVE_KEY && export AGENT_DRIVE_KEY &&\n  env -u AGENT_DRIVE_API_KEY agent-drive put ./handoff.md /memory/handoff.md --drive ${selected || '<drive-id>'}`}
                    </pre>
                    <p>
                      To rotate access, create a replacement API key, update the agent, then revoke
                      the old key. Decryption keys and API keys are different: neither replaces the
                      other.
                    </p>
                  </section>
                </>
              )}
              {tab === 'Usage' && !usage && (
                <section className="panel empty" aria-live="polite">
                  {usageLoading || !usageError ? (
                    <p role="status">Loading usage…</p>
                  ) : (
                    <>
                      <h2>Usage could not be loaded.</h2>
                      <p role="alert">{usageError}</p>
                      <button
                        className="button secondary"
                        disabled={usageLoading}
                        onClick={() => void loadUsage()}
                      >
                        Retry usage
                      </button>
                    </>
                  )}
                </section>
              )}
              {tab === 'Usage' && usage && (
                <>
                  <div className="stat-grid">
                    <article className="panel stat">
                      <p>ENCRYPTED STORAGE</p>
                      <strong>
                        {formatMetered(usage.storageBytes)} of{' '}
                        {formatMetered(usage.limits.storageBytes)}
                      </strong>
                      <progress
                        className={
                          usage.storageBytes >= Number(usage.limits.storageBytes) * 0.9 ? 'hot' : ''
                        }
                        value={usage.storageBytes}
                        max={Number(usage.limits.storageBytes)}
                        aria-label="Storage used of plan limit"
                      />
                      <small>
                        {Number(usage.limits.storageBytes) - usage.storageBytes >= 0
                          ? `${formatMetered(Number(usage.limits.storageBytes) - usage.storageBytes)} free · ${shareOf(usage.storageBytes, Number(usage.limits.storageBytes))} used`
                          : `0 free · ${shareOf(usage.storageBytes, Number(usage.limits.storageBytes))} used · over plan limit by ${formatMetered(usage.storageBytes - Number(usage.limits.storageBytes))}`}
                      </small>
                      <small>All versions count, including Trash.</small>
                    </article>
                    <article className="panel stat">
                      <p>API OPERATIONS</p>
                      <strong>
                        {usage.operations.toLocaleString()} of{' '}
                        {Number(usage.limits.operations).toLocaleString()}
                      </strong>
                      <progress
                        className={
                          usage.operations >= Number(usage.limits.operations) * 0.9 ? 'hot' : ''
                        }
                        value={usage.operations}
                        max={Number(usage.limits.operations)}
                        aria-label="Operations used of plan limit"
                      />
                      <small>Successful operations this month</small>
                    </article>
                    <article className="panel stat">
                      <p>EGRESS & COST</p>
                      <Link className="button secondary" href="/console/billing">
                        Billing &amp; limits
                      </Link>
                      <small>Monthly estimates, observed transfers, and spending controls</small>
                    </article>
                  </div>
                  <section className="panel">
                    <div className="panel-toolbar">
                      <h2>Storage by drive</h2>
                      <span className="muted">Encrypted bytes</span>
                    </div>
                    {usage.drives.map((item) => (
                      <div className="usage-row" key={item.id}>
                        <div className="split">
                          <strong>{item.name}</strong>
                          <span>
                            {formatMetered(item.storageBytes)}
                            {item.quotaBytes === Number.MAX_SAFE_INTEGER
                              ? ' · account limits apply'
                              : ` / ${formatMetered(item.quotaBytes)}`}
                            {` · ${shareOf(item.storageBytes, usage.storageBytes)} of total`}
                          </span>
                        </div>
                        {item.quotaBytes !== Number.MAX_SAFE_INTEGER && (
                          <progress
                            value={item.storageBytes}
                            max={item.quotaBytes}
                            aria-label={`${item.name} storage usage`}
                          />
                        )}
                        <small>
                          {item.liveFiles} live files · {item.versions} stored versions
                        </small>
                      </div>
                    ))}
                    {!usage.drives.length && <p className="empty">No storage used yet.</p>}
                  </section>
                  <section className="panel">
                    <div className="panel-toolbar">
                      <h2>Storage by folder</h2>
                      <span className="muted">All versions count, including Trash.</span>
                    </div>
                    {!folderDrives.length ? (
                      <p className="empty">No files in this folder.</p>
                    ) : (
                      <>
                        <div className="usage-row folder-head">
                          <div className="split">
                            <nav className="folder-crumbs" aria-label="Folder">
                              <button
                                type="button"
                                className="crumb"
                                aria-current={folderPrefix === '/' ? 'page' : undefined}
                                onClick={() => setFolderPrefix('/')}
                              >
                                All files
                              </button>
                              {folderSegments.map((segment, index) => {
                                const path = `/${folderSegments.slice(0, index + 1).join('/')}`;
                                return (
                                  <span className="folder-crumb" key={path}>
                                    <span className="crumb-sep">/</span>
                                    <button
                                      type="button"
                                      className="crumb"
                                      aria-current={
                                        index === folderSegments.length - 1 ? 'page' : undefined
                                      }
                                      onClick={() => setFolderPrefix(path)}
                                    >
                                      {segment}
                                    </button>
                                  </span>
                                );
                              })}
                            </nav>
                            <select
                              className="folder-drive"
                              aria-label="Drive for folder usage"
                              value={folderDriveId}
                              onChange={(event) => setFolderDrive(event.target.value)}
                            >
                              {folderDrives.map((item) => (
                                <option key={item.id} value={item.id}>
                                  {item.name}
                                </option>
                              ))}
                            </select>
                          </div>
                          {folderData && (
                            <small>{formatMetered(folderData.totalBytes)} total</small>
                          )}
                        </div>
                        {folderError && <p className="empty">{folderError}</p>}
                        {!folderError && !folderData && <p className="empty">Loading…</p>}
                        {folderData && (
                          <>
                            {folderData.folders.map((item) => (
                              <button
                                type="button"
                                className="usage-row folder-row"
                                key={item.path}
                                onClick={() => setFolderPrefix(item.path)}
                              >
                                <div className="split">
                                  <strong>{item.name}</strong>
                                  <span>
                                    {formatMetered(item.bytes)} ·{' '}
                                    {shareOf(item.bytes, folderDriveTotal)} of drive
                                  </span>
                                </div>
                                <progress
                                  value={item.bytes}
                                  max={Math.max(1, folderDriveTotal)}
                                  aria-label={`${item.name} share of drive storage`}
                                />
                                <small>{count(item.files, 'file')}</small>
                              </button>
                            ))}
                            {folderData.directFiles > 0 && (
                              <div className="usage-row">
                                <div className="split">
                                  <strong>Files in this folder</strong>
                                  <span>
                                    {formatMetered(folderData.directBytes)} ·{' '}
                                    {shareOf(folderData.directBytes, folderDriveTotal)} of drive
                                  </span>
                                </div>
                                <progress
                                  value={folderData.directBytes}
                                  max={Math.max(1, folderDriveTotal)}
                                  aria-label="Files in this folder share of drive storage"
                                />
                                <small>{count(folderData.directFiles, 'file')}</small>
                              </div>
                            )}
                            {folderData.moreFolders.count > 0 && (
                              <div className="usage-row">
                                <div className="split">
                                  <strong>
                                    {count(folderData.moreFolders.count, 'more folder')}
                                  </strong>
                                  <span>{formatMetered(folderData.moreFolders.bytes)}</span>
                                </div>
                              </div>
                            )}
                            {!folderData.folders.length && !folderData.directFiles && (
                              <p className="empty">No files in this folder.</p>
                            )}
                          </>
                        )}
                      </>
                    )}
                  </section>
                  <section className="panel">
                    <div className="panel-toolbar">
                      <h2>Usage by author</h2>
                      <span className="muted">Versions attributed to their author</span>
                    </div>
                    <div className="table-scroll table-stack usage-table">
                      <table role="table">
                        <thead role="rowgroup">
                          <tr role="row">
                            <th role="columnheader">AGENT</th>
                            <th role="columnheader" className="num">
                              STORAGE
                            </th>
                            <th role="columnheader" className="num">
                              VERSIONS
                            </th>
                            <th role="columnheader" className="num">
                              OPERATIONS
                            </th>
                          </tr>
                        </thead>
                        <tbody role="rowgroup">
                          {usage.agents.map((item) => (
                            <tr key={item.id} role="row">
                              <td className="primary" role="cell">
                                {authorLabel(item.name)}
                              </td>
                              <td role="cell" className="num" data-label="Storage">
                                {formatMetered(item.storageBytes)}
                              </td>
                              <td role="cell" className="num" data-label="Versions">
                                {item.versions}
                              </td>
                              <td role="cell" className="num" data-label="Operations">
                                {item.operations}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                </>
              )}
            </>
          )}
        </div>
      </main>
      {modal && (
        <Dialog
          key={modal}
          dialogRef={dialogRef}
          title={
            {
              drive: 'Create a drive',
              unlock: {
                recovery: `Load the key for ${drive?.name ?? 'this drive'}`,
                passphrase: 'Unlock with your passphrase',
                setup: 'Set up passphrase unlock',
                change: 'Change passphrase',
                reset: 'Reset passphrase',
                passkey: 'Unlock with your passkey',
                passkeyAdd: 'Add a passkey',
              }[unlockMode],
              agent: 'Create an agent',
              connect: 'Connect an agent',
              key: 'Create API key',
              driveReceipt: 'Your drive. Your key.',
              keyReceipt: 'Save your API key',
              versions: 'Version history',
              confirm: confirmState?.title ?? '',
              preview: preview?.file.path.split('/').at(-1) ?? 'Preview',
              share: `Share ${shareFile ? baseName(shareFile.path) : ''}`,
              traces: 'Set up trace capture',
            }[modal]
          }
          className={modal === 'preview' ? 'preview' : undefined}
          onClose={close}
          closable={
            modal === 'preview' ||
            (!busy &&
              !(modal === 'traces' && tracesBusy) &&
              modal !== 'driveReceipt' &&
              modal !== 'keyReceipt')
          }
        >
          {modal !== 'unlock' && errorBanner}
          {modal === 'drive' && (
            <form onSubmit={(event) => form(event, createDrive)}>
              <p>
                We’ll generate a unique encryption key in your browser. Save it somewhere safe: the
                server cannot recover it.
              </p>
              <label>
                Drive name
                <input
                  name="name"
                  required
                  maxLength={128}
                  placeholder="Research workspace"
                  autoFocus
                  {...(drives.length === 0
                    ? {
                        defaultValue: 'my-drive',
                        onFocus: (event: FocusEvent<HTMLInputElement>) =>
                          event.currentTarget.select(),
                      }
                    : {})}
                />
              </label>
              <label className="check-label">
                <input type="checkbox" name="agentOnly" />
                Agent-only — never add this drive to passphrase unlock
              </label>
              <button className="button primary" disabled={busy}>
                Create drive
              </button>
            </form>
          )}
          {modal === 'driveReceipt' && driveReceipt && (
            <div className="form-stack">
              <p>
                This key decrypts your drive. Without it nobody, including us, can open this drive.
                It is not sent to the service or saved in browser storage.
              </p>
              <details>
                <summary>Show drive key</summary>
                <label>
                  Drive key
                  <textarea data-testid="drive-key" readOnly value={driveReceipt.key} />
                </label>
                <CopyButton text={driveReceipt.key} label="Copy drive key" />
              </details>
              <p className="warning-copy">
                The recovery file contains a secret in plaintext. Store it in a password manager or
                another secure location.
              </p>
              {!receiptSaved ? (
                <button
                  className="button primary"
                  data-autofocus
                  onClick={() => {
                    saveRecoveryFile(driveReceipt.id, driveReceipt.key);
                    setReceiptSaved(true);
                  }}
                >
                  Download recovery file and continue
                </button>
              ) : (
                <div className="receipt-confirm" role="group" aria-label="Confirm save">
                  <h3>Did the recovery file save?</h3>
                  <p>Check your downloads before you continue.</p>
                  <button
                    className="button primary"
                    autoFocus
                    onClick={() =>
                      void act(async () => {
                        const receipt = driveReceipt;
                        setDriveReceipt(null);
                        setReceiptSaved(false);
                        setModal(null);
                        setTab('Files');
                        await recordBackup(receipt.id);
                      })
                    }
                  >
                    I saved it
                  </button>
                  <button
                    className="button secondary"
                    onClick={() => saveRecoveryFile(driveReceipt.id, driveReceipt.key)}
                  >
                    Download again
                  </button>
                </div>
              )}
            </div>
          )}
          {modal === 'unlock' && (
            <UnlockDialog
              driveId={selected}
              pendingMessage={
                pendingAction?.kind === 'webhook'
                  ? `After ${unlockStep}, you can set up the OpenRouter webhook.`
                  : pendingAction?.kind === 'recovery'
                    ? `After ${unlockStep}, a fresh recovery file downloads.`
                    : pendingAction
                      ? `After ${unlockStep}, ${
                          pendingAction.kind === 'share'
                            ? `you can share ${pendingAction.file.path.split('/').at(-1)}`
                            : `${pendingAction.file.path.split('/').at(-1)} ${
                                pendingAction.kind === 'preview' ? 'opens' : 'downloads'
                              }`
                        }.`
                      : undefined
              }
              onKey={keyLoaded}
              onClose={close}
              mode={unlockMode}
              onMode={(mode) => {
                setRecoveryNote('');
                setUnlockMode(mode);
              }}
              recoveryNote={recoveryNote}
              agentOnly={drive?.agentOnly === true}
              vault={{
                email: identity.email,
                status: vault.status,
                fingerprint: vault.fingerprint,
                onRetry: retryVault,
                hasVault: vault.status === 'locked' && drive?.agentOnly !== true,
                hasPasskey: hasPasskey && passkeyCapable && drive?.agentOnly !== true,
                onUnlock: unlockWithPassphrase,
                onPasskeyUnlock: unlockWithPasskey,
                onAddPasskey: addPasskey,
                onSetup: setUpPassphrase,
                onChange: changePassphrase,
                onReset: resetPassphrase,
              }}
            />
          )}
          {modal === 'preview' && preview && (
            <>
              <PreviewBody name={preview.file.path.split('/').at(-1) ?? ''} view={preview.view} />
              <div className="preview-footer">
                <button
                  type="button"
                  className="button"
                  disabled={busy}
                  onClick={() => {
                    const { file, view } = preview;
                    if (view.status === 'ready')
                      save(
                        new Blob([new Uint8Array(view.bytes)], {
                          type: 'application/octet-stream',
                        }),
                        file.path.split('/').at(-1) || 'download',
                      );
                    else void act(() => download(file));
                  }}
                >
                  Download
                </button>
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={() => {
                    const path = preview.file.path;
                    closePreview();
                    void act(() => showVersions(path));
                  }}
                >
                  Versions
                </button>
              </div>
            </>
          )}
          {modal === 'share' && shareFile && driveKeys[selected] && (
            <ShareDialog
              inbox={loadDriveInbox}
              driveId={selected}
              path={shareFile.path}
              driveKey={driveKeys[selected]}
              origin={origin}
              request={api}
              shares={shares}
              onReload={() => void loadShares(selected, shareFile.path)}
              onLoadMore={() => void loadMoreShares(selected)}
              onCreated={(forDrive, row) =>
                updateShares(forDrive, (items) => addShareRow(items, row))
              }
              onRevoke={(id) => revokeShare(selected, id)}
            />
          )}
          {modal === 'traces' && (
            <TracesDialog
              driveId={selected}
              origin={origin}
              request={api}
              strictRequest={strictApi}
              verify={(id, key) => vault.verifyKey(id, key)}
              getKey={webhookKey}
              onBusy={setTracesBusy}
              resumeWith={tracesResume}
              onReady={(key, source) => {
                setDriveKeys((current) => ({ ...current, [selected]: key }));
                if (source !== 'trusted') keySources.current.set(selected, source);
                // The token creates the openrouter agent: reload so its traces show that author.
                void refresh();
                // The inbox may be new: drop a cached "no inbox" so v2 files open.
                inboxCache.current.delete(selected);
                if (vault.status === 'unlocked' && !drive?.agentOnly)
                  void addToAccount(selected, key);
              }}
            />
          )}
          {modal === 'connect' && <ConnectAgentBody />}
          {modal === 'agent' && (
            <form
              onSubmit={(event) =>
                form(event, async (data) => {
                  const name = String(data.get('name')).trim();
                  if (name === '__console__')
                    throw new Error('That name is reserved for the human console.');
                  await api('agents', 'POST', { name });
                  await refresh();
                  setModal(null);
                  setTab('API keys');
                  setNotice(
                    drivesNow.current.length
                      ? 'Agent created. Create an API key to connect it.'
                      : 'Agent created. Create a drive, then an API key, to connect it.',
                  );
                })
              }
            >
              <p>An agent identity groups its keys, file versions, and activity.</p>
              <label>
                Agent name
                <input
                  name="name"
                  required
                  maxLength={128}
                  placeholder="Research assistant"
                  autoFocus
                />
              </label>
              <button className="button primary" disabled={busy}>
                Create agent
              </button>
            </form>
          )}
          {modal === 'key' && (
            <form
              onSubmit={(event) =>
                form(event, async (data) => {
                  const result = await api<{ token: string }>('keys', 'POST', {
                    label: data.get('label'),
                    agentId: data.get('agentId'),
                    driveIds: data.getAll('driveIds'),
                    scopes: data.getAll('scopes'),
                  });
                  setKeyReceipt(result.token);
                  setSaved(false);
                  setModal('keyReceipt');
                  await refresh();
                })
              }
            >
              {!keyOptionsLoaded && (
                <div className="empty" role="status">
                  <p>Load every agent and drive before choosing where this key can connect.</p>
                  {(collectionPages.drives.error || collectionPages.agents.error) && (
                    <span role="alert">
                      {collectionPages.drives.error || collectionPages.agents.error}
                    </span>
                  )}
                  <button
                    type="button"
                    className="button secondary"
                    disabled={collectionPages.drives.loading || collectionPages.agents.loading}
                    onClick={() => void loadAllKeyOptions()}
                  >
                    {collectionPages.drives.loading || collectionPages.agents.loading
                      ? 'Loading all options…'
                      : collectionPages.drives.error || collectionPages.agents.error
                        ? 'Retry loading all options'
                        : 'Load all agents and drives'}
                  </button>
                </div>
              )}
              <p>
                Use a different key for each agent or machine. New keys do not grant access to
                future drives automatically.
              </p>
              {hasRestrictedKeys && (
                <p>
                  This form cannot set write-path restrictions. To replace a restricted key, use the
                  CLI or API with the same drives, permissions and write paths.
                </p>
              )}
              <label>
                Key label
                <input name="label" required maxLength={128} placeholder="Research laptop" />
              </label>
              <label>
                Agent
                <select name="agentId" required>
                  {activeAgents.map((agent) => (
                    <option key={agent.id} value={agent.id} title={agent.name}>
                      {agent.name}
                    </option>
                  ))}
                </select>
              </label>
              <fieldset>
                <legend>Allowed drives</legend>
                {drives.map((item) => (
                  <label key={item.id} className="check-label">
                    <input
                      type="checkbox"
                      name="driveIds"
                      value={item.id}
                      defaultChecked={item.id === selected}
                    />{' '}
                    {item.name}
                  </label>
                ))}
              </fieldset>
              <fieldset>
                <legend>Permissions</legend>
                {scopes.map((scope) => (
                  <label key={scope} className="check-label">
                    <input
                      type="checkbox"
                      name="scopes"
                      value={scope}
                      defaultChecked={scope === 'read' || scope === 'write'}
                    />{' '}
                    {scope}
                    {scope === 'manage' ? ' — account-wide administration; use sparingly' : ''}
                  </label>
                ))}
              </fieldset>
              <button className="button primary" disabled={busy || !keyOptionsLoaded}>
                Create API key
              </button>
            </form>
          )}
          {modal === 'keyReceipt' && (
            <div className="form-stack">
              <p>
                This secret is shown only once. Store it securely and use it with{' '}
                <code>agent-drive login</code>. The service keeps only a hash.
              </p>
              <label>
                API key
                <textarea data-testid="api-key" readOnly value={keyReceipt} />
              </label>
              <CopyButton text={keyReceipt} label="Copy API key" />
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={saved}
                  onChange={(event) => setSaved(event.target.checked)}
                />{' '}
                I saved my API key securely
              </label>
              <button
                className="button primary"
                disabled={!saved || busy}
                onClick={() => {
                  setKeyReceipt('');
                  setModal(null);
                }}
              >
                Done
              </button>
            </div>
          )}
          {modal === 'confirm' && confirmState && (
            <ConfirmBody
              message={confirmState.message}
              confirmLabel={confirmState.confirmLabel}
              busy={busy}
              onCancel={close}
              onConfirm={() =>
                void act(async () => {
                  await confirmState.run();
                  setModal(null);
                })
              }
            />
          )}
          {modal === 'versions' && (
            <div className="form-stack">
              <p className="version-file">
                <strong>{baseName(selectedPath)}</strong>
                <span className="muted">
                  {' '}
                  in {selectedPath.slice(0, selectedPath.lastIndexOf('/')) || '/'}
                </span>
              </p>
              {versions.length > 1 && (
                <p>Restore creates a new current version. Existing history stays intact.</p>
              )}
              {versions.map((version) => {
                const current = version.id === (newestVersionId ?? versions[0]?.id);
                return (
                  <div className="version-row" key={version.id} data-version-id={version.id}>
                    <div className="version-meta">
                      <strong>
                        {current ? 'Current version · ' : ''}
                        {versionWhen(version.createdAt)} · {size(version.ciphertextSize)} ·{' '}
                        {authorLabel(
                          agents.find((agent) => agent.id === version.agentId)?.name ??
                            version.agentId,
                        )}
                      </strong>
                      <details>
                        <summary>Details</summary>
                        <small>Created (UTC): {version.createdAt || '—'}</small>
                        <code>Version ID: {version.id}</code>
                      </details>
                    </div>
                    {!current && (
                      <button
                        className="button secondary"
                        disabled={busy}
                        onClick={() => void act(() => restore(selected, selectedPath, version.id))}
                      >
                        Restore this version
                      </button>
                    )}
                  </div>
                );
              })}
              {versions.length === 1 && (
                <p>
                  This is the current version. Earlier versions appear here when the file changes.
                </p>
              )}
            </div>
          )}
        </Dialog>
      )}
    </div>
  );
}
