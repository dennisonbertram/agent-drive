'use client';

import { UserButton } from '@clerk/nextjs';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FocusEvent,
  type FormEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { decryptFile, generateDriveKey } from '../../../../../packages/agent-drive/src/crypto.ts';
import { validateDownloadUrl } from '@/src/share/url';
import { BrandLogo, BrandMark } from '../../brand-mark';
import { CopyButton } from '../copy-button';
import { DriveMenu } from './drive-menu';
import { ListState } from './list-state';
import '../../styles/console.css';
import { startIdleLock } from '@/src/console/idle-lock';
import { KeyChip } from './key-chip';
import { UnlockDialog } from './unlock-dialog';
import { FileIcon } from './file-icon';
import { MenuButton } from './menu-button';
import { Toast, type Announcement, type ToastItem } from './toast';
import { ConfirmBody } from './confirm-dialog';
import { versionWhen } from '@/src/console/when';
import {
  ROOT,
  childrenOf,
  crumbs,
  fileKind,
  folderFromParam,
  listPrefix,
  recentFiles,
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
};
type Agent = { id: string; name: string };
type ApiKey = {
  id: string;
  label: string;
  agent_id: string;
  drive_ids: string[];
  scopes: string[];
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
  storageBytes: number;
  operations: number;
  drives: {
    id: string;
    name: string;
    quotaBytes: number;
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
  | null;
const scopes = ['read', 'write', 'delete', 'share', 'manage'];
// A folder or Recent view loads at most this many rows; the list says so when it stops early.
const LIST_CAP = 1000;
const LAST_DRIVE = 'agent-drive:last-drive';
const DEFAULT_SORT_DIR = { name: 'asc', modified: 'desc', size: 'desc' } as const;

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

async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  let result: Response;
  try {
    result = await fetch(`/api/console/${path}`, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
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
  if (!result.ok) throw new Error(data.error?.message ?? 'The request could not be completed.');
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
      '[mcp_servers.agent-drive]\ncommand = "agent-drive"\nargs = ["mcp"]',
    ],
    [
      'Cursor or any MCP client',
      '{"mcpServers":{"agent-drive":{"command":"agent-drive","args":["mcp"]}}}',
    ],
  ];
  return (
    <>
      <p>
        Paste this into your agent. It installs the CLI and gives you a link; open it and click
        Approve. The agent sets up its own encrypted drive, or you add it to a drive your other
        agents already use.
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

function authorLabel(name: string) {
  return name === '__console__' ? 'Console' : name;
}

function size(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
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
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  closable?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
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
  }, []);
  return (
    <dialog
      ref={ref}
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

export default function Console({ clerkEnabled }: { clerkEnabled: boolean }) {
  const [tab, setTab] = useState<Tab>('Files');
  const [drives, setDrives] = useState<Drive[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [chosenDrive, setSelected] = useState('');
  const [driveKeys, setDriveKeys] = useState<Record<string, string>>({});
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [modal, setModal] = useState<ModalName>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const toastSeq = useRef(0);
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
  const focusRequest = useRef<{ driveId: string; path: string } | null>(null);
  const [focusTick, setFocusTick] = useState(0);
  const [navOpen, setNavOpen] = useState(false);
  const [driveReceipt, setDriveReceipt] = useState<{ id: string; key: string } | null>(null);
  const [keyReceipt, setKeyReceipt] = useState('');
  const [saved, setSaved] = useState(false);
  const [downloadingId, setDownloadingId] = useState('');
  // The row whose Download asked for the key; it continues once the key loads.
  const [pendingDownload, setPendingDownload] = useState<{
    driveId: string;
    file: FileEntry;
  } | null>(null);
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
  } | null>(null);
  // Where the Files list is: drive, folder and view live in the URL so reload and Back work.
  const params = useSearchParams();
  const folder = folderFromParam(params.get('path'));
  const view = params.get('view') === 'recent' ? 'recent' : 'browse';
  const urlDrive = params.get('drive');
  // Back and Forward change the drive in the URL; that wins over the last one chosen here.
  const selected = urlDrive && drives.some((item) => item.id === urlDrive) ? urlDrive : chosenDrive;
  const fileScope = `${selected}:${tab}:${view}:${folder}:${fileRefresh}`;
  const fileItems = (filePage?.scope === fileScope ? filePage.items : []).filter(
    (file) => !hiddenRows.has(`${selected}:${file.id}:${file.version_id}`),
  );
  const countKeys = (agentId: string) =>
    apiKeys.filter((key) => key.agent_id === agentId && !key.revoked_at).length;
  const issuedBy = (id?: string | null) =>
    id ? `issued by ${agents.find((agent) => agent.id === id)?.name ?? 'another agent'}` : '';
  const activeKeyCount = apiKeys.filter((key) => !key.revoked_at).length;
  const query = filter.toLowerCase();
  // Trash is a flat list of full paths. Files shows folder rows (Browse) or the newest files (Recent).
  const shownFiles = fileItems.filter((file) => file.path.toLowerCase().includes(query));
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
    const children = childrenOf(fileItems, folder);
    // Searching lists every loaded file below this folder, at any depth.
    const matches = query
      ? fileItems
          .filter(
            (file) =>
              file.path.startsWith(folderBase) &&
              file.path.slice(folderBase.length).toLowerCase().includes(query),
          )
          .map(fileRowOf)
      : children;
    rows = sortRows(matches, sort.key, sort.dir);
  }
  const listed = tab === 'Files' ? rows.length : shownFiles.length;
  const drive = drives.find((item) => item.id === selected);
  const agentInstruction = useAgentInstruction();
  const origin =
    typeof window === 'undefined' ? 'https://your-agent-drive-host' : window.location.origin;
  // The backend's current version, not the newest timestamp: concurrent writes can commit out of order.
  const newestVersionId = fileItems.find((file) => file.path === selectedPath)?.version_id;
  const hasKey = Boolean(driveKeys[selected]);
  const loaded = filePage?.scope === fileScope;
  const failed = fileFailure?.scope === fileScope;
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

  const refresh = useCallback(async () => {
    const [nextDrives, nextAgents, nextKeys, nextUsage] = await Promise.all([
      all<Drive>('drives'),
      all<Agent>('agents'),
      all<ApiKey>('keys'),
      api<Usage>('usage'),
    ]);
    setDrives(
      nextDrives.map((item) => {
        const recorded = recordedBackups.current[item.id];
        return recorded && !item.key_backup_at
          ? { ...item, key_backup_at: recorded.at, key_backup_method: recorded.method }
          : item;
      }),
    );
    setAgents(nextAgents);
    setApiKeys(nextKeys);
    setUsage(nextUsage);
    setSelected((current) =>
      nextDrives.some((item) => item.id === current) ? current : pickDrive(nextDrives),
    );
    setReady(true);
    setFileRefresh((value) => value + 1);
  }, []);

  useEffect(() => {
    void Promise.resolve()
      .then(refresh)
      .catch((reason: Error) => setError(reason.message));
  }, [refresh]);
  useEffect(() => {
    if (!selected || (tab !== 'Files' && tab !== 'Trash')) return;
    let active = true;
    void (async () => {
      const prefix = tab === 'Files' && view === 'browse' ? listPrefix(folder) : null;
      const path = `drives/${selected}/${tab === 'Trash' ? 'trash' : 'list'}`;
      const items: FileEntry[] = [];
      let cursor: string | null = null;
      let capped = false;
      do {
        const query = new URLSearchParams({ limit: '100' });
        if (prefix) query.set('prefix', prefix);
        if (cursor) query.set('cursor', cursor);
        const result: Page<FileEntry> = await api(`${path}?${query}`);
        if (!active) return;
        items.push(...result.items);
        cursor = result.nextCursor;
        if (cursor && items.length >= LIST_CAP) capped = true;
      } while (cursor && !capped);
      setFilePage({ items, capped, scope: fileScope });
      setFileFailure(null);
    })().catch((reason: Error) => {
      if (active) setFileFailure({ scope: fileScope, message: reason.message });
    });
    return () => {
      active = false;
    };
  }, [selected, tab, view, folder, fileScope]);
  useEffect(() => {
    // A drive switch, tab switch or Retry changes fileScope, which restarts this timer.
    if (!selected || (tab !== 'Files' && tab !== 'Trash')) return;
    const timer = setTimeout(() => setSlowScope(fileScope), 10_000);
    return () => {
      clearTimeout(timer);
      // Leaving a scope forgets that it was slow, so coming back starts a fresh 10 s.
      setSlowScope('');
    };
  }, [selected, tab, fileScope]);
  // Back and Forward leave other tabs for the list they changed.
  useEffect(() => {
    const onPop = () => {
      setTab((current) => (current === 'Trash' ? current : 'Files'));
      setFilter('');
      // A key prompt belongs to the drive it was opened for.
      setModal((current) => (current === 'unlock' ? null : current));
      setPendingDownload(null);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  // After opening a folder by link, keep keyboard users' place at the current folder.
  useEffect(() => {
    if (!focusCrumb.current) return;
    focusCrumb.current = false;
    const nav = crumbsRef.current;
    (nav?.querySelector<HTMLElement>('[aria-current="page"]') ?? nav)?.focus();
  }, [folder, view]);
  // "Show file": once the file's folder has loaded, bring its row into view and focus it.
  useEffect(() => {
    const wanted = focusRequest.current;
    if (!wanted || tab !== 'Files' || listStatus !== 'ready') return;
    const cut = wanted.path.lastIndexOf('/');
    const where = cut > 0 ? wanted.path.slice(0, cut) : ROOT;
    if (selected !== wanted.driveId || folder !== where || view !== 'browse') return;
    focusRequest.current = null;
    const button = [...document.querySelectorAll<HTMLElement>('.file-panel .file-row-name')].find(
      (item) => item.getAttribute('title') === wanted.path,
    );
    button?.scrollIntoView({ block: 'nearest' });
    button?.focus();
  }, [focusTick, tab, listStatus, selected, folder, view]);
  // A drive in the URL that does not exist is replaced by the one that opened.
  useEffect(() => {
    if (!ready || !selected || !urlDrive || drives.some((item) => item.id === urlDrive)) return;
    window.history.replaceState(null, '', `?${new URLSearchParams({ drive: selected })}`);
  }, [ready, selected, urlDrive, drives]);
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

  // Clear every key after 30 minutes without use. Never touches driveReceipt: that dialog holds
  // the only copy of a new drive's key. A download already running holds its key and finishes.
  const anyKey = Object.keys(driveKeys).length > 0;
  useEffect(() => {
    if (!anyKey) return;
    const lock = startIdleLock({
      onIdle: () => {
        setDriveKeys({});
        setKeylineConfirm('');
        setNotice(
          'The key was cleared after 30 minutes without use. You’ll be asked for the recovery file at the next download.',
        );
      },
    });
    idleLock.current = lock;
    return () => {
      lock.stop();
      idleLock.current = null;
    };
  }, [anyKey]);

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
    if (!busy) {
      setPendingDownload(null);
      setModal(null);
      setError('');
    }
  }
  function form(event: FormEvent<HTMLFormElement>, operation: (data: FormData) => Promise<void>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void act(() => operation(data));
  }

  // Move inside the Files list. History entries, not page loads: no server round trip per folder.
  function go(next: { drive?: string; path?: string | undefined; view?: 'browse' | 'recent' }) {
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
    setModal((current) => (current === 'unlock' ? null : current));
    setPendingDownload(null);
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
    });
    if (!created.created)
      throw new Error(
        'A drive with this name already exists. Load its original drive key instead.',
      );
    setDriveKeys((current) => ({ ...current, [created.id]: key }));
    setDriveReceipt({ id: created.id, key });
    setReceiptSaved(false);
    setSaved(false);
    setModal('driveReceipt');
    await refresh();
    selectDrive(created.id);
  }

  async function download(file: FileEntry, key = driveKeys[selected]) {
    if (!key) {
      setPendingDownload({ driveId: selected, file });
      open('unlock');
      return;
    }
    setDownloadingId(file.id);
    try {
      await decryptAndSave(file, key);
    } finally {
      setDownloadingId('');
    }
    idleLock.current?.touch();
  }

  async function decryptAndSave(file: FileEntry, key: string) {
    const metadata = await api<{ wrappedKey: string; downloadUrl: string }>(
      `drives/${selected}/get?path=${encodeURIComponent(file.path)}`,
    );
    const url = validateDownloadUrl(metadata.downloadUrl);
    const response = await fetch(url, {
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
    }).catch(() => null);
    if (!response?.ok) throw new Error('The encrypted file could not be downloaded.');
    const bytes = await decryptFile(
      new Uint8Array(await response.arrayBuffer()),
      metadata.wrappedKey,
      key,
    );
    const name = file.path.split('/').at(-1) || 'download';
    save(new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' }), name);
    setNotice(`${name} decrypted in your browser and downloaded.`);
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
  const selectedNow = useRef(selected);
  const tabNow = useRef(tab);
  useEffect(() => {
    selectedNow.current = selected;
    tabNow.current = tab;
  }, [selected, tab]);
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
    setFocusTick((value) => value + 1);
    const cut = path.lastIndexOf('/');
    go({ drive: driveId, path: cut > 0 ? path.slice(0, cut) : undefined, view: 'browse' });
  }
  function restoredToast(driveId: string, path: string, replaceId?: number) {
    showToast(
      `Restored “${baseName(path)}”.`,
      {
        action: {
          label: 'Show file',
          run: (id) => {
            dismissToast(id);
            showFile(driveId, path);
          },
        },
      },
      replaceId,
    );
  }

  async function restore(driveId: string, path: string, versionId?: string) {
    await api(`drives/${driveId}/restore`, 'POST', { path, ...(versionId ? { versionId } : {}) });
    unhide(driveId, path);
    setModal(null);
    await refresh();
    restoredToast(driveId, path);
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
        api<Usage>('usage')
          .then(setUsage)
          .catch(() => undefined);
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
    toastId = showToast(`Moved “${name}” to Trash.`, {
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
  }

  function askConfirm(next: NonNullable<typeof confirmState>) {
    setConfirmState(next);
    open('confirm');
  }

  function keyLoaded(key: string) {
    const pending = pendingDownload;
    setPendingDownload(null);
    setDriveKeys((current) => ({ ...current, [selected]: key }));
    setModal(null);
    if (pending?.driveId === selected) void act(() => download(pending.file, key));
  }

  function saveRecoveryFile(driveId: string, key: string) {
    save(
      new Blob([JSON.stringify({ format: 'agent-drive-key-v1', driveId, key }, null, 2)], {
        type: 'application/json',
      }),
      `agent-drive-${driveId}.key.json`,
    );
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
                    <button type="button" className="notice-dismiss" onClick={() => setNotice('')}>
                      Dismiss
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
                onClick={() => void act(refresh)}
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
                  onClick={() => open('key')}
                >
                  + New API key
                </button>
              )}
            </div>
          </div>
          {!ready ? (
            <section className={`panel empty ${error ? '' : 'loading'}`}>
              <h2>{error ? 'Workspace unavailable' : 'Opening your workspace…'}</h2>
              <p>
                {error
                  ? 'Check the connection, then refresh to try again.'
                  : 'Loading your drives and access settings.'}
              </p>
              {error && (
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
                    Paste this line into your agent. It installs the CLI and gives you a link; open
                    it and click Approve. The agent sets up its own encrypted drive.
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
                      <i>3</i> You approve it once.
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
                            {folder === ROOT ? (
                              <span className="crumb">All files</span>
                            ) : (
                              <a className="crumb" href={hrefFor(ROOT)} onClick={openFolder(ROOT)}>
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
                              disabled={busy || !ready}
                            />
                            {crumbs(folder).map((crumb, index, all) => (
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
                              : view === 'recent'
                                ? 'Search recent files'
                                : 'Search this folder'
                          }
                          placeholder={
                            tab === 'Trash'
                              ? 'Search deleted files…'
                              : view === 'recent'
                                ? 'Search recent files…'
                                : 'Search this folder…'
                          }
                          ref={filterRef}
                          value={filter}
                          disabled={!fileItems.length}
                          onChange={(event) => setFilter(event.target.value)}
                        />
                      </div>
                      <div className="toolbar-key">
                        {tab === 'Files' && (
                          <KeyChip
                            hasKey={hasKey}
                            backedUp={Boolean(drive?.key_backup_at)}
                            backupText={backupText}
                            confirming={keylineConfirm === selected}
                            busy={busy}
                            onLoad={() => {
                              setPendingDownload(null);
                              open('unlock');
                            }}
                            onDownload={() => {
                              saveRecoveryFile(selected, driveKeys[selected]!);
                              setKeylineConfirm(selected);
                            }}
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
                        )}
                      </div>
                    </div>
                    {listStatus !== 'ready' && (
                      <ListState
                        status={listStatus}
                        message={fileFailure?.message}
                        onRetry={() => setFileRefresh((value) => value + 1)}
                      />
                    )}
                    {listStatus === 'ready' && filePage?.capped && (
                      <p className="list-cap" role="note">
                        {tab === 'Trash'
                          ? 'Showing the first 1,000 deleted files. Some are not listed here.'
                          : view === 'recent'
                            ? 'Showing the 50 most recent of the first 1,000 files. Newer files beyond them may be missing.'
                            : 'Showing the first 1,000 files, in path order. Some folders and files are not listed here.'}
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
                    {listed > 0 && tab === 'Files' && (
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
                              return (
                                <tr key={row.key} role="row" data-kind="file">
                                  <td className="file-cell" role="cell">
                                    <button
                                      type="button"
                                      className="file-row-name"
                                      title={file.path}
                                      aria-busy={downloadingId === file.id || undefined}
                                      onClick={() => {
                                        if (!busy) void act(() => download(file));
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
                                      <button
                                        className="row-primary"
                                        disabled={busy}
                                        title="Decrypt and download"
                                        onClick={() => void act(() => download(file))}
                                      >
                                        {downloadingId === file.id ? 'Downloading…' : 'Download'}
                                      </button>
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
                    {listStatus === 'ready' && !listed && !(query && fileItems.length) && (
                      <div className="empty">
                        {tab === 'Trash' ? (
                          <>
                            <h3>Nothing in the trash.</h3>
                            <p>Deleted files appear here until permanently removed.</p>
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
                    {listStatus === 'ready' && !listed && query && fileItems.length > 0 && (
                      <div className="empty">
                        <h3>{`No ${filePage?.capped ? 'loaded files' : 'files'} match “${filter}”.`}</h3>
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
                    <div className="panel-footer">
                      <span className="footer-count">
                        {loaded
                          ? query
                            ? `${listed} ${listed === 1 ? 'match' : 'matches'}`
                            : tab === 'Trash'
                              ? `${listed} loaded`
                              : view === 'recent'
                                ? `${listed} recent files`
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
                          : apiKeys.some((key) => key.agent_id === agent.id)
                            ? 'Access revoked'
                            : 'No API keys'}
                      </span>
                      {countKeys(agent.id) > 0 && (
                        <button
                          className="button secondary"
                          disabled={busy}
                          onClick={() => {
                            const n = countKeys(agent.id);
                            askConfirm({
                              title: `Revoke access for ${agent.name}?`,
                              message: `${n} active API ${n === 1 ? 'key stops' : 'keys stop'} working now. Commands and MCP sessions that use ${n === 1 ? 'it' : 'them'} fail at their next request. Files this agent wrote stay in your drives.`,
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
                  </section>
                  <section className="panel connection-guide">
                    <p className="eyebrow">FROM YOUR TERMINAL</p>
                    <h2>Connect without sharing your identity.</h2>
                    <p>
                      Run the CLI from the repository after building it. Set your API URL and API
                      key through <code>agent-drive login</code>. In Bash, read the secrets without
                      putting them in shell history:
                    </p>
                    <pre>
                      {`read -rs -p "API key: " AGENT_DRIVE_API_KEY; export AGENT_DRIVE_API_KEY\nagent-drive login --api ${origin}\nread -rs -p "Drive key: " AGENT_DRIVE_KEY; export AGENT_DRIVE_KEY\nagent-drive put ./handoff.md /memory/handoff.md --drive ${selected || '<drive-id>'}\nagent-drive mcp`}
                    </pre>
                    <p>
                      To rotate access, create a replacement API key, update the agent, then revoke
                      the old key. Decryption keys and API keys are different: neither replaces the
                      other.
                    </p>
                  </section>
                </>
              )}
              {tab === 'Usage' && usage && (
                <>
                  <div className="stat-grid">
                    <article className="panel stat">
                      <p>ENCRYPTED STORAGE</p>
                      <strong>{size(usage.storageBytes)}</strong>
                      <small>All committed versions, including trash</small>
                    </article>
                    <article className="panel stat">
                      <p>API OPERATIONS</p>
                      <strong>{usage.operations.toLocaleString()}</strong>
                      <small>Successful operations this calendar month</small>
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
                            {size(item.storageBytes)}
                            {item.quotaBytes === Number.MAX_SAFE_INTEGER
                              ? ' · account limits apply'
                              : ` / ${size(item.quotaBytes)}`}
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
                      <h2>Usage by author</h2>
                      <span className="muted">Versions attributed to their author</span>
                    </div>
                    <div className="table-scroll table-stack">
                      <table role="table">
                        <thead role="rowgroup">
                          <tr role="row">
                            <th role="columnheader">AGENT</th>
                            <th role="columnheader">STORAGE</th>
                            <th role="columnheader">VERSIONS</th>
                            <th role="columnheader">OPERATIONS</th>
                          </tr>
                        </thead>
                        <tbody role="rowgroup">
                          {usage.agents.map((item) => (
                            <tr key={item.id} role="row">
                              <td className="primary" role="cell">
                                {authorLabel(item.name)}
                              </td>
                              <td role="cell" data-label="Storage">
                                {size(item.storageBytes)}
                              </td>
                              <td role="cell" data-label="Versions">
                                {item.versions}
                              </td>
                              <td role="cell" data-label="Operations">
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
          title={
            {
              drive: 'Create a drive',
              unlock: `Load the key for ${drive?.name ?? 'this drive'}`,
              agent: 'Create an agent',
              connect: 'Connect an agent',
              key: 'Create API key',
              driveReceipt: 'Your drive. Your key.',
              keyReceipt: 'Save your API key',
              versions: 'Version history',
              confirm: confirmState?.title ?? '',
            }[modal]
          }
          onClose={close}
          closable={!busy && modal !== 'driveReceipt' && modal !== 'keyReceipt'}
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
                  <p>
                    Without it nobody, including us, can open this drive. Check your downloads
                    before you continue.
                  </p>
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
              pendingName={pendingDownload?.file.path.split('/').at(-1)}
              onKey={keyLoaded}
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
                  setNotice('Agent created. Create an API key to connect it.');
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
              <p>
                Use a different key for each agent or machine. New keys do not grant access to
                future drives automatically.
              </p>
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
              <button className="button primary" disabled={busy}>
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
                    <strong>
                      {current ? 'Current version · ' : ''}
                      {versionWhen(version.createdAt)} · {size(version.ciphertextSize)} ·{' '}
                      {authorLabel(
                        agents.find((agent) => agent.id === version.agentId)?.name ??
                          version.agentId,
                      )}
                    </strong>
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
