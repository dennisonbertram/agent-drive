'use client';

import { UserButton } from '@clerk/nextjs';
import Link from 'next/link';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FocusEvent,
  type FormEvent,
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
  | null;
const scopes = ['read', 'write', 'delete', 'share', 'manage'];

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

function date(value?: string) {
  return value ? new Date(value).toLocaleString() : '—';
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

export default function Console({ clerkEnabled }: { clerkEnabled: boolean }) {
  const [tab, setTab] = useState<Tab>('Files');
  const [drives, setDrives] = useState<Drive[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [selected, setSelected] = useState('');
  const [driveKeys, setDriveKeys] = useState<Record<string, string>>({});
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [modal, setModal] = useState<ModalName>(null);
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
  const [fileFailure, setFileFailure] = useState<{ scope: string; message: string } | null>(null);
  const [filePage, setFilePage] = useState<{
    scope: string;
    items: FileEntry[];
    nextCursor: string | null;
  } | null>(null);
  const fileScope = `${selected}:${tab}:${fileRefresh}`;
  const fileItems = filePage?.scope === fileScope ? filePage.items : [];
  const countKeys = (agentId: string) =>
    apiKeys.filter((key) => key.agent_id === agentId && !key.revoked_at).length;
  const issuedBy = (id?: string | null) =>
    id ? `issued by ${agents.find((agent) => agent.id === id)?.name ?? 'another agent'}` : '';
  const activeKeyCount = apiKeys.filter((key) => !key.revoked_at).length;
  const shownFiles = fileItems.filter((file) =>
    file.path.toLowerCase().includes(filter.toLowerCase()),
  );
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
      nextDrives.some((item) => item.id === current) ? current : (nextDrives[0]?.id ?? ''),
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
    void api<Page<FileEntry>>(`drives/${selected}/${tab === 'Trash' ? 'trash' : 'list'}?limit=100`)
      .then((result) => {
        if (!active) return;
        setFilePage({ ...result, scope: fileScope });
        setFileFailure(null);
      })
      .catch((reason: Error) => {
        if (active) setFileFailure({ scope: fileScope, message: reason.message });
      });
    return () => {
      active = false;
    };
  }, [selected, tab, fileScope]);
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
    setSelected(created.id);
    setFilter('');
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

  async function restore(path: string, versionId?: string) {
    await api(`drives/${selected}/restore`, 'POST', { path, ...(versionId ? { versionId } : {}) });
    setModal(null);
    await refresh();
    setNotice('Restored as a new version. Previous versions are preserved.');
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
                      <h2>
                        {tab === 'Trash' ? 'Deleted files' : 'All files'}{' '}
                        <span className="muted">/</span>{' '}
                        <DriveMenu
                          drives={drives}
                          usage={usage}
                          selected={selected}
                          formatSize={size}
                          onSelect={(id) => {
                            setSelected(id);
                            setNotice('');
                            setFilter('');
                          }}
                          onNewDrive={() => open('drive')}
                          disabled={busy || !ready}
                        />
                      </h2>
                      <div className="toolbar-tools">
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
                        <input
                          aria-label="Filter loaded files"
                          placeholder="Filter loaded files…"
                          ref={filterRef}
                          value={filter}
                          disabled={!fileItems.length}
                          onChange={(event) => setFilter(event.target.value)}
                        />
                      </div>
                    </div>
                    {listStatus !== 'ready' && (
                      <ListState
                        status={listStatus}
                        message={fileFailure?.message}
                        onRetry={() => setFileRefresh((value) => value + 1)}
                      />
                    )}
                    {shownFiles.length > 0 && (
                      <div className="table-scroll table-stack">
                        <table role="table">
                          <thead role="rowgroup">
                            <tr role="row">
                              <th role="columnheader">FILE PATH</th>
                              <th
                                role="columnheader"
                                title={tab === 'Trash' ? undefined : 'Encrypted size'}
                              >
                                {tab === 'Trash' ? 'DELETED' : 'SIZE'}
                              </th>
                              {tab !== 'Trash' && (
                                <>
                                  <th role="columnheader">AUTHOR</th>
                                  <th role="columnheader">MODIFIED</th>
                                </>
                              )}
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
                                <td role="cell" data-label={tab === 'Trash' ? 'Deleted' : 'Size'}>
                                  {tab === 'Trash'
                                    ? deletedOn(file.deletedAt)
                                    : size(Number(file.ciphertext_size ?? 0))}
                                </td>
                                {tab !== 'Trash' && (
                                  <>
                                    <td role="cell" data-label="Author">
                                      <span className="author">
                                        <span className="led dim" aria-hidden />
                                        {authorLabel(
                                          agents.find((agent) => agent.id === file.agent_id)
                                            ?.name ??
                                            file.agent_id ??
                                            '',
                                        )}
                                      </span>
                                    </td>
                                    <td className="modified" role="cell" data-label="Modified">
                                      {modifiedAt(file.created_at)}
                                    </td>
                                  </>
                                )}
                                <td className="actions" role="cell">
                                  <div className="row-actions">
                                    {tab === 'Trash' ? (
                                      <>
                                        <button
                                          className="row-primary"
                                          disabled={busy}
                                          onClick={() => void act(() => restore(file.path))}
                                        >
                                          Restore
                                        </button>
                                        <button
                                          disabled={busy}
                                          onClick={() => void act(() => showVersions(file.path))}
                                        >
                                          Versions
                                        </button>
                                      </>
                                    ) : (
                                      <>
                                        <button
                                          className="row-primary"
                                          disabled={busy}
                                          title="Decrypt and download"
                                          aria-busy={downloadingId === file.id || undefined}
                                          onClick={() => void act(() => download(file))}
                                        >
                                          {downloadingId === file.id ? 'Downloading…' : 'Download'}
                                        </button>
                                        <button
                                          disabled={busy}
                                          onClick={() => void act(() => showVersions(file.path))}
                                        >
                                          Versions
                                        </button>
                                        <button
                                          disabled={busy}
                                          onClick={() =>
                                            void act(async () => {
                                              await api(`drives/${selected}/delete`, 'POST', {
                                                path: file.path,
                                              });
                                              await refresh();
                                              setNotice(
                                                `Moved ${file.path} to Trash. Restore it from the Trash tab.`,
                                              );
                                            })
                                          }
                                        >
                                          Trash
                                        </button>
                                      </>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {listStatus === 'ready' && !fileItems.length && (
                      <div className="empty">
                        <h3>
                          {tab === 'Trash' ? 'Nothing in the trash.' : 'Ready for your first file.'}
                        </h3>
                        <p>
                          {tab === 'Trash'
                            ? 'Deleted files appear here until permanently removed.'
                            : 'Connect an agent with the CLI or MCP to upload encrypted files.'}
                        </p>
                      </div>
                    )}
                    {listStatus === 'ready' && fileItems.length > 0 && !shownFiles.length && (
                      <div className="empty">
                        <h3>{`No ${filePage?.nextCursor ? 'loaded files' : 'files'} match “${filter}”.`}</h3>
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
                    {filePage?.scope === fileScope && filePage.nextCursor && (
                      <button
                        className="button secondary load-more"
                        disabled={busy}
                        onClick={() =>
                          void act(async () => {
                            const result = await api<Page<FileEntry>>(
                              `drives/${selected}/${tab === 'Trash' ? 'trash' : 'list'}?limit=100&cursor=${encodeURIComponent(filePage.nextCursor!)}`,
                            );
                            setFilePage({
                              scope: fileScope,
                              items: [...fileItems, ...result.items],
                              nextCursor: result.nextCursor,
                            });
                          })
                        }
                      >
                        Load more files
                      </button>
                    )}
                    <div className="panel-footer">
                      {loaded
                        ? filter
                          ? `${shownFiles.length} of ${fileItems.length}`
                          : `${fileItems.length} loaded`
                        : ''}{' '}
                      <span>
                        File contents encrypted · Paths and metadata visible to the service
                      </span>
                    </div>
                  </section>
                </>
              )}
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
                        {countKeys(agent.id)} active {countKeys(agent.id) === 1 ? 'key' : 'keys'}
                      </span>
                      <button
                        className="button secondary"
                        disabled={busy}
                        onClick={() =>
                          void act(async () => {
                            if (
                              !window.confirm(
                                `Revoke all API keys for ${agent.name}? This stops this agent’s current access.`,
                              )
                            )
                              return;
                            await api(`agents/${agent.id}/revoke`, 'POST', {});
                            await refresh();
                            setNotice(`All API keys for ${agent.name} have been revoked.`);
                          })
                        }
                      >
                        Revoke access
                      </button>
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
                            void act(async () => {
                              if (
                                !window.confirm(
                                  `Revoke ${key.label}? Commands using this key will stop working.`,
                                )
                              )
                                return;
                              await api(`keys/${key.id}`, 'DELETE');
                              await refresh();
                              setNotice('API key revoked. It can no longer authenticate.');
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
          {modal === 'versions' && (
            <div className="form-stack">
              <p className="file-path">{selectedPath}</p>
              <p>Restore creates a new current version. Existing history stays intact.</p>
              {versions.map((version) => (
                <div className="version-row" key={version.id}>
                  <div>
                    <strong>
                      {date(version.createdAt)}
                      {version.id === newestVersionId ? ' · Current' : ''}
                    </strong>
                    <small>
                      {size(version.ciphertextSize)} ·{' '}
                      {authorLabel(
                        agents.find((agent) => agent.id === version.agentId)?.name ??
                          version.agentId,
                      )}
                    </small>
                    <code>{version.id}</code>
                  </div>
                  {version.id !== newestVersionId && (
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={() => void act(() => restore(selectedPath, version.id))}
                    >
                      Restore this version
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </Dialog>
      )}
    </div>
  );
}
