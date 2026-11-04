'use client';

import { UserButton } from '@clerk/nextjs';
import Link from 'next/link';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  decodeDriveKey,
  decryptFile,
  generateDriveKey,
} from '../../../../../packages/agent-drive/src/crypto.ts';
import { validateDownloadUrl } from '@/src/share/url';
import { CopyButton } from '../copy-button';
import { BUNDLE_PREFIX, driveKeyFromBundle } from '@/src/console/credentials-bundle';

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
  | 'key'
  | 'driveReceipt'
  | 'keyReceipt'
  | 'versions'
  | null;
const scopes = ['read', 'write', 'delete', 'share', 'manage'];

async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const result = await fetch(`/api/console/${path}`, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  if (result.status === 401) {
    window.location.assign('/sign-in');
    throw new Error('Your session expired. Sign in again.');
  }
  const data = await result.json();
  if (!result.ok) throw new Error(data.error?.message ?? 'The request could not be completed.');
  return data as T;
}

function ConnectAgentPanel() {
  const origin = useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => 'https://agentdrive.xyz',
  );
  const instruction = `Set up Agent Drive: ${origin}/llms.txt`;
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
    <section className="panel agent-panel" aria-labelledby="connect-agent-title">
      <h2 id="connect-agent-title">Connect an agent</h2>
      <p>
        Paste this into your agent. It installs the CLI and gives you a link; open it and click
        Approve. The agent sets up its own encrypted drive.
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
    </section>
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
    dialog?.showModal();
    return () => dialog?.close();
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
  const [driveReceipt, setDriveReceipt] = useState<{ id: string; key: string } | null>(null);
  const [keyReceipt, setKeyReceipt] = useState('');
  const [saved, setSaved] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [selectedPath, setSelectedPath] = useState('');
  const [versions, setVersions] = useState<Version[]>([]);
  const [fileRefresh, setFileRefresh] = useState(0);
  const [filter, setFilter] = useState('');
  const [filePage, setFilePage] = useState<{
    scope: string;
    items: FileEntry[];
    nextCursor: string | null;
  } | null>(null);
  const fileScope = `${selected}:${tab}:${fileRefresh}`;
  const fileItems = filePage?.scope === fileScope ? filePage.items : [];
  const countKeys = (agentId: string) =>
    apiKeys.filter((key) => key.agent_id === agentId && !key.revoked_at).length;
  const activeKeyCount = apiKeys.filter((key) => !key.revoked_at).length;
  const shownFiles = fileItems.filter((file) =>
    file.path.toLowerCase().includes(filter.toLowerCase()),
  );
  const drive = drives.find((item) => item.id === selected);
  const origin =
    typeof window === 'undefined' ? 'https://your-agent-drive-host' : window.location.origin;
  // The backend's current version, not the newest timestamp: concurrent writes can commit out of order.
  const newestVersionId = fileItems.find((file) => file.path === selectedPath)?.version_id;
  const hasKey = Boolean(driveKeys[selected]);
  const activeAgents = agents.filter((agent) => agent.name !== '__console__');

  const refresh = useCallback(async () => {
    const [nextDrives, nextAgents, nextKeys, nextUsage] = await Promise.all([
      all<Drive>('drives'),
      all<Agent>('agents'),
      all<ApiKey>('keys'),
      api<Usage>('usage'),
    ]);
    setDrives(nextDrives);
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
        if (active) setFilePage({ ...result, scope: fileScope });
      })
      .catch((reason: Error) => {
        if (active) setError(reason.message);
      });
    return () => {
      active = false;
    };
  }, [selected, tab, fileScope]);
  useEffect(() => {
    if (!driveReceipt && !keyReceipt) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [driveReceipt, keyReceipt]);

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
    setKeyInput('');
    setModal(name);
  }
  function close() {
    if (!busy) {
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
    setSaved(false);
    setModal('driveReceipt');
    await refresh();
    setSelected(created.id);
  }

  async function download(file: FileEntry) {
    const key = driveKeys[selected];
    if (!key) throw new Error('Load the drive key to download file contents.');
    const metadata = await api<{ wrappedKey: string; downloadUrl: string }>(
      `drives/${selected}/get?path=${encodeURIComponent(file.path)}`,
    );
    const url = validateDownloadUrl(metadata.downloadUrl);
    const response = await fetch(url, {
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('The encrypted file could not be downloaded.');
    const bytes = await decryptFile(
      new Uint8Array(await response.arrayBuffer()),
      metadata.wrappedKey,
      key,
    );
    save(
      new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' }),
      file.path.split('/').at(-1) || 'download',
    );
    setNotice('File decrypted in your browser. Download started.');
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

  async function loadKeyFile(file?: File) {
    if (!file) return;
    if (file.size > 16_384) throw new Error('This is not a valid drive key file.');
    const text = await file.text();
    if (text.trim().startsWith(BUNDLE_PREFIX)) {
      const key = driveKeyFromBundle(text, selected);
      decodeDriveKey(key);
      setKeyInput(key);
      return;
    }
    let candidate: unknown;
    try {
      candidate = JSON.parse(text);
    } catch {
      throw new Error('Choose a JSON recovery key file downloaded from this console.');
    }
    if (
      !candidate ||
      typeof candidate !== 'object' ||
      !('driveId' in candidate) ||
      !('key' in candidate) ||
      candidate.driveId !== selected ||
      typeof candidate.key !== 'string'
    )
      throw new Error('This recovery file does not belong to the selected drive.');
    decodeDriveKey(candidate.key);
    setKeyInput(candidate.key);
  }

  async function downloadRecoveryFile() {
    const key = driveKeys[selected];
    if (!key) return;
    save(
      new Blob(
        [JSON.stringify({ format: 'agent-drive-key-v1', driveId: selected, key }, null, 2)],
        { type: 'application/json' },
      ),
      `agent-drive-${selected}.key.json`,
    );
    // Only the method is reported; the key never leaves this page.
    await api(`drives/${selected}/key-backup`, 'POST', { method: 'file' });
    await refresh();
    setNotice('Recovery file saved. Store it in a password manager or another secure location.');
  }

  const errorBanner = error && (
    <div role="alert" className="banner error">
      {error}
    </div>
  );
  return (
    <div className="console-shell">
      <aside className="sidebar">
        <Link href="/" className="brand">
          <span className="brand-mark">a/</span> agent drive
        </Link>
        <div className="workspace-label">
          <span className="workspace-avatar">P</span>
          <div>
            Personal workspace<small>OPERATOR CONSOLE</small>
          </div>
        </div>
        <p className="nav-label">WORKSPACE</p>
        <nav aria-label="Workspace">
          {(['Files', 'Agents', 'API keys', 'Usage', 'Trash'] as Tab[]).map((item, index) => (
            <button
              key={item}
              className={`nav-item ${tab === item ? 'active' : ''}`}
              aria-current={tab === item ? 'page' : undefined}
              onClick={() => {
                setTab(item);
                setError('');
                setFilter('');
              }}
            >
              <span className="nav-icon" aria-hidden>
                {['▤', '⌘', '⚿', '▥', '⌫'][index]}
              </span>
              {item}
              {item === 'Files' && tab === 'Files' && selected && (
                <span className="nav-count">{fileItems.length}</span>
              )}
            </button>
          ))}
          <Link className="nav-item" href="/console/billing">
            <span aria-hidden="true">$</span>Billing &amp; limits
          </Link>
          <Link className="nav-item" href="/console/settings">
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
            <div>
              <p className="eyebrow">YOUR AGENTS’ SHARED MEMORY</p>
              <h1>{tab === 'Files' ? 'Drives & files' : tab}</h1>
              <p>
                {
                  {
                    Files: 'A home for the work. A starting point for what’s next.',
                    Agents: 'Separate identities. Purpose-built permissions.',
                    'API keys': 'Give each agent access to exactly what it needs.',
                    Usage: 'Understand what your workspace stores and serves.',
                    Trash: 'Recover deleted files without losing their history.',
                  }[tab]
                }
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
              {tab === 'Files' && (
                <button
                  className="button primary"
                  disabled={busy || !ready}
                  onClick={() => open('drive')}
                >
                  + New drive
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
          {!modal && errorBanner}
          {notice && (
            <div role="status" className="banner success">
              {notice}
            </div>
          )}
          {!ready ? (
            <section className="panel empty">
              <h2>{error ? 'Workspace unavailable' : 'Opening your workspace…'}</h2>
              <p>
                {error
                  ? 'Check the connection, then refresh to try again.'
                  : 'Loading your drives and access settings.'}
              </p>
            </section>
          ) : (
            <>
              {tab === 'Files' && !drives.length && (
                <section className="onboarding panel">
                  <div className="onboarding-symbol">a/</div>
                  <p className="eyebrow">A LITTLE SETUP. A LASTING WORKSPACE.</p>
                  <h2>Give your first agent a home.</h2>
                  <p>
                    Create a drive, save your encryption key, and connect an agent. You control the
                    keys from the very first byte.
                  </p>
                  <button className="button primary" onClick={() => open('drive')}>
                    Create your first drive ↗
                  </button>
                  <div className="setup-steps">
                    <span>
                      01 <strong>Create a drive</strong>
                    </span>
                    <span>
                      02 <strong>Save your key</strong>
                    </span>
                    <span>
                      03 <strong>Connect an agent</strong>
                    </span>
                  </div>
                </section>
              )}
              {(tab === 'Files' || tab === 'Trash') && drives.length > 0 && (
                <>
                  <div className="drive-toolbar">
                    <label>
                      DRIVE
                      <select
                        aria-label="Selected drive"
                        value={selected}
                        onChange={(event) => {
                          setSelected(event.target.value);
                          setFilter('');
                        }}
                      >
                        {drives.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="drive-identity">
                      <code data-testid="drive-id">{selected}</code>
                      <span className={`badge ${hasKey ? 'positive' : ''}`}>
                        {hasKey ? 'Key loaded' : 'Key required for downloads'}
                      </span>
                    </div>
                    {hasKey ? (
                      <button
                        className="button secondary"
                        onClick={() => {
                          setDriveKeys((current) => {
                            const next = { ...current };
                            delete next[selected];
                            return next;
                          });
                          setNotice('Drive key removed from this browser session.');
                        }}
                      >
                        Forget key
                      </button>
                    ) : (
                      <button className="button secondary" onClick={() => open('unlock')}>
                        Load drive key
                      </button>
                    )}
                  </div>
                  {tab === 'Files' && drive && (
                    <div
                      className={`banner ${drive.key_backup_at ? 'info' : 'error'}`}
                      data-testid="key-backup-status"
                    >
                      {drive.key_backup_at ? (
                        <>
                          Key backed up {new Date(drive.key_backup_at).toLocaleDateString()} (
                          {drive.key_backup_method})
                        </>
                      ) : (
                        <>
                          This drive&rsquo;s key hasn&rsquo;t been backed up. If the agent&rsquo;s
                          machine is lost, these files can&rsquo;t be opened. Ask the agent to run{' '}
                          <code>agent-drive credentials export</code>{' '}
                          <CopyButton
                            text="agent-drive credentials export"
                            label="Copy credentials export command"
                          />
                        </>
                      )}
                      {hasKey && (
                        <>
                          {' '}
                          <button
                            className="button secondary"
                            onClick={() => void act(downloadRecoveryFile)}
                          >
                            Download recovery file
                          </button>
                        </>
                      )}
                    </div>
                  )}
                  {!hasKey && tab === 'Files' && (
                    <div className="banner info">
                      You can browse file names without a key. Load your drive key to decrypt and
                      download contents. Keys are kept only in this page’s memory.
                    </div>
                  )}
                  <section className="panel file-panel">
                    <div className="panel-toolbar">
                      <h2>
                        {tab === 'Trash' ? 'Deleted files' : 'All files'}{' '}
                        <span className="muted">/ {drive?.name}</span>
                      </h2>
                      <input
                        aria-label="Filter loaded files"
                        placeholder="Filter loaded files…"
                        value={filter}
                        onChange={(event) => setFilter(event.target.value)}
                      />
                    </div>
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>FILE PATH</th>
                            <th>{tab === 'Trash' ? 'DELETED' : 'ENCRYPTED SIZE'}</th>
                            <th>{tab === 'Trash' ? 'RECOVERY' : 'AUTHOR'}</th>
                            <th>
                              <span className="sr-only">Actions</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {filter && fileItems.length > 0 && !shownFiles.length && (
                            <tr>
                              <td colSpan={4}>No loaded files match “{filter}”.</td>
                            </tr>
                          )}
                          {shownFiles.map((file) => (
                            <tr key={file.id}>
                              <td>
                                <span className="file-icon" aria-hidden>
                                  ▤
                                </span>
                                <span className="file-path">{file.path}</span>
                                {file.created_at && (
                                  <small className="cell-subtext">{date(file.created_at)}</small>
                                )}
                              </td>
                              <td>
                                {tab === 'Trash'
                                  ? date(file.deletedAt)
                                  : size(Number(file.ciphertext_size ?? 0))}
                              </td>
                              <td>
                                {tab === 'Trash'
                                  ? 'Versions preserved'
                                  : authorLabel(
                                      agents.find((agent) => agent.id === file.agent_id)?.name ??
                                        file.agent_id ??
                                        '',
                                    )}
                              </td>
                              <td>
                                <div className="row-actions">
                                  {tab === 'Trash' ? (
                                    <button
                                      disabled={busy}
                                      onClick={() => void act(() => restore(file.path))}
                                    >
                                      Restore
                                    </button>
                                  ) : (
                                    <>
                                      <button
                                        disabled={busy || !hasKey}
                                        title={
                                          !hasKey
                                            ? 'Load your drive key first'
                                            : 'Decrypt and download'
                                        }
                                        onClick={() => void act(() => download(file))}
                                      >
                                        Download
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
                    {!fileItems.length && (
                      <div className="empty">
                        <h3>
                          {filePage?.scope !== fileScope
                            ? 'Loading files…'
                            : tab === 'Trash'
                              ? 'Nothing in the trash.'
                              : 'Ready for your first file.'}
                        </h3>
                        <p>
                          {tab === 'Trash'
                            ? 'Deleted files appear here until permanently removed.'
                            : 'Connect an agent with the CLI or MCP to upload encrypted files.'}
                        </p>
                        {tab === 'Files' && (
                          <button
                            className="button secondary"
                            onClick={() => {
                              setTab('API keys');
                            }}
                          >
                            Connect an agent
                          </button>
                        )}
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
                      {fileItems.length} loaded{' '}
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
              {tab === 'Agents' && <ConnectAgentPanel />}
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
                  <ConnectAgentPanel />
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
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>AGENT</th>
                            <th>STORAGE</th>
                            <th>VERSIONS</th>
                            <th>OPERATIONS</th>
                          </tr>
                        </thead>
                        <tbody>
                          {usage.agents.map((item) => (
                            <tr key={item.id}>
                              <td>{authorLabel(item.name)}</td>
                              <td>{size(item.storageBytes)}</td>
                              <td>{item.versions}</td>
                              <td>{item.operations}</td>
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
          <footer className="console-footer">
            <span>Built for the work between sessions.</span>
            <span>AGENT DRIVE / V1</span>
          </footer>
        </div>
      </main>
      {modal && (
        <Dialog
          title={
            {
              drive: 'Create a drive',
              unlock: 'Load drive key',
              agent: 'Create an agent',
              key: 'Create API key',
              driveReceipt: 'Your drive. Your key.',
              keyReceipt: 'Save your API key',
              versions: 'Version history',
            }[modal]
          }
          onClose={close}
          closable={!busy && modal !== 'driveReceipt' && modal !== 'keyReceipt'}
        >
          {errorBanner}
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
                This key decrypts your drive. Save a recovery copy before continuing. It is not sent
                to the service or saved in browser storage.
              </p>
              <label>
                Drive key
                <textarea data-testid="drive-key" readOnly value={driveReceipt.key} />
              </label>
              <button
                className="button secondary"
                onClick={() =>
                  save(
                    new Blob(
                      [
                        JSON.stringify(
                          {
                            format: 'agent-drive-key-v1',
                            driveId: driveReceipt.id,
                            key: driveReceipt.key,
                          },
                          null,
                          2,
                        ),
                      ],
                      { type: 'application/json' },
                    ),
                    `agent-drive-${driveReceipt.id}.key.json`,
                  )
                }
              >
                Save recovery key
              </button>
              <p className="warning-copy">
                The recovery file contains a secret in plaintext. Store it in a password manager or
                another secure location. Losing this key means losing access to file contents.
              </p>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={saved}
                  onChange={(event) => setSaved(event.target.checked)}
                />{' '}
                I saved my drive key securely
              </label>
              <button
                className="button primary"
                disabled={!saved || busy}
                onClick={() => {
                  setDriveReceipt(null);
                  setModal(null);
                  setTab('Files');
                }}
              >
                Continue to drive
              </button>
            </div>
          )}
          {modal === 'unlock' && (
            <form
              onSubmit={(event) =>
                form(event, async () => {
                  const pasted = keyInput.trim();
                  const key = pasted.startsWith(BUNDLE_PREFIX)
                    ? driveKeyFromBundle(pasted, selected)
                    : pasted;
                  decodeDriveKey(key);
                  setDriveKeys((current) => ({ ...current, [selected]: key }));
                  setModal(null);
                  setNotice(
                    'Key loaded into page memory. A download will verify that it matches this drive.',
                  );
                })
              }
            >
              <p>
                For {drive?.name}. Your key stays in this page’s memory and is cleared when you
                reload.
              </p>
              <label>
                Drive key or credentials bundle (adcred1.…)
                <input
                  type="password"
                  autoComplete="off"
                  required
                  value={keyInput}
                  onChange={(event) => setKeyInput(event.target.value)}
                />
              </label>
              <label>
                Or choose a recovery file or credentials bundle
                <input
                  type="file"
                  onChange={(event) => void act(() => loadKeyFile(event.target.files?.[0]))}
                />
              </label>
              <button className="button primary" disabled={busy}>
                Load key
              </button>
            </form>
          )}
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
                    <option key={agent.id} value={agent.id}>
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
