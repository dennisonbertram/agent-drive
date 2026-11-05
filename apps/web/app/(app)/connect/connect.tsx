'use client';

import '../../styles/connect.css';

import { useEffect, useState } from 'react';
import { decodeDriveKey } from '../../../../../packages/agent-drive/src/crypto.ts';
import { driveKeyFromBundle, BUNDLE_PREFIX } from '@/src/console/credentials-bundle';
import { parseRecoveryFile, sealDriveKey } from '@/src/device/seal';

type Drive = { id: string; name: string };
type DeviceRequest = {
  user_code: string;
  client_name: string;
  machine: string | null;
  created_at: string;
  expires_at: string;
  drives?: Drive[];
  creates_drive?: boolean;
  public_key?: string;
  scopes?: string[] | null;
  write_paths?: string[] | null;
  offer?: {
    agentName: string;
    drive: Drive;
    scopes: string[];
    writePaths: string[];
    revision: number;
  } | null;
  offerRevision?: number;
};

const codePattern = /^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/;

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

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
    throw new HttpError(401, 'Your session expired. Sign in again.');
  }
  const data = await result.json().catch(() => ({}));
  if (!result.ok)
    throw new HttpError(
      result.status,
      data.error?.message ?? 'The request could not be completed.',
    );
  return data as T;
}

function normalizeCode(value: string) {
  const raw = value.toUpperCase().replace(/[^A-Z]/g, '');
  return raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : value.trim().toUpperCase();
}

export default function Connect({
  initialCode,
  account,
}: {
  initialCode: string;
  account: string;
}) {
  const [codeInput, setCodeInput] = useState(initialCode);
  const [request, setRequest] = useState<DeviceRequest | null>(null);
  const [problem, setProblem] = useState<{ kind: 'missing' | 'error'; message: string } | null>(
    null,
  );
  const loginCommand = <code className="connect-cmd">agent-drive login</code>;
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [formError, setFormError] = useState('');
  const [delegate, setDelegate] = useState(false);
  // Add to an existing drive (docs/agent-login.md section 12). The key lives only in this state.
  const [accountDrives, setAccountDrives] = useState<Drive[]>([]);
  const [existing, setExisting] = useState(false);
  const [driveId, setDriveId] = useState('');
  const [keyText, setKeyText] = useState('');
  const [keyFile, setKeyFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [readOnly, setReadOnly] = useState(false);
  const [folder, setFolder] = useState('');
  const [notice, setNotice] = useState('');

  async function load(raw: string) {
    const code = normalizeCode(raw);
    setProblem(null);
    setNotice('');
    setRequest(null);
    if (!codePattern.test(code)) {
      setProblem({ kind: 'error', message: 'Enter the code in the form XXXX-XXXX.' });
      return;
    }
    setLoading(true);
    try {
      const found = await api<DeviceRequest>(`device/${encodeURIComponent(code)}`);
      setRequest(found);
      setExisting(false);
      setAccountDrives([]);
      if (found.creates_drive) void loadDrives();
    } catch (error) {
      if (error instanceof HttpError && error.status === 404)
        setProblem({
          kind: 'missing',
          message: '',
        });
      else
        setProblem({
          kind: 'error',
          message: error instanceof Error ? error.message : 'The request could not be loaded.',
        });
    } finally {
      setLoading(false);
    }
  }

  // Forget any key material, including the browser's file input.
  function clearKey() {
    setKeyText('');
    setKeyFile(null);
    setFileInputKey((n) => n + 1);
  }

  async function loadDrives() {
    try {
      const items: Drive[] = [];
      let cursor: string | null = null;
      do {
        const page: { items: Drive[]; nextCursor: string | null } = await api(
          `drives?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        );
        items.push(...page.items);
        cursor = page.nextCursor;
      } while (cursor);
      setAccountDrives(items);
      setDriveId(items[0]?.id ?? '');
    } catch {
      // The one-click default still works without the drive list.
    }
  }

  useEffect(() => {
    // Load the prefilled code once on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (initialCode) void load(initialCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function approve() {
    if (!request) return;
    setFormError('');
    setBusy(true);
    try {
      // The revision binds this approval to the offer (or lack of one) the page showed.
      const offerRevision = request.offerRevision ?? 0;
      let body: unknown = delegate ? { delegate: true, offerRevision } : { offerRevision };
      if (existing) {
        // Read the key, check it, seal it to the agent in the browser, post only the sealed blob.
        const pasted = keyText.trim();
        const text = keyFile ? await keyFile.text() : pasted;
        if (!text) throw new Error('Paste the drive key or choose a recovery file.');
        if (keyFile && keyFile.size > 16_384)
          throw new Error('This is not a valid drive key file.');
        const key = text.trim().startsWith(BUNDLE_PREFIX)
          ? driveKeyFromBundle(text, driveId)
          : keyFile
            ? parseRecoveryFile(text, driveId)
            : text.trim();
        decodeDriveKey(key);
        if (!request.public_key) throw new Error('This request has no agent key. Start again.');
        const sealed = await sealDriveKey(request.public_key, driveId, key);
        body = {
          driveIds: [driveId],
          scopes: [
            ...(readOnly ? ['read'] : ['read', 'write', 'delete', 'share']),
            ...(delegate ? ['delegate'] : []),
          ],
          sealedDriveKeys: { [driveId]: sealed },
          writePaths: folder.trim() ? [folder.trim()] : [],
          offerRevision,
        };
      }
      await api(`device/${encodeURIComponent(request.user_code)}/approve`, 'POST', body);
      clearKey();
      setDone(true);
    } catch (error) {
      if (
        error instanceof HttpError &&
        error.status === 409 &&
        error.message === 'The request changed; reload the page.'
      ) {
        // The request changed since this page loaded (for example an offer arrived): show it again.
        clearKey();
        await load(request.user_code);
        setNotice('The request changed; review it again.');
      } else setFormError(error instanceof Error ? error.message : 'Approval failed.');
    } finally {
      setBusy(false);
    }
  }

  if (done)
    return (
      <section className="panel connect-card approved" role="status">
        <span className="connect-tag">
          <span className="connect-led on" aria-hidden="true" />
          Paired
        </span>
        <h1>Approved</h1>
        <p>Approved. Return to your agent; it will finish setup on its own.</p>
      </section>
    );

  if (!request)
    return (
      <section className="panel connect-card">
        <span className="connect-tag">
          <span className={`connect-led ${loading ? 'on' : 'dim'}`} aria-hidden="true" />
          {loading ? 'Looking up' : problem ? 'No pairing' : 'Awaiting code'}
        </span>
        <h1>Connect an agent</h1>
        <p>Enter the code your agent printed after running {loginCommand}.</p>
        {problem && (
          <div role="alert" className={`banner ${problem.kind === 'missing' ? 'info' : 'error'}`}>
            {problem.kind === 'missing' ? (
              <>
                This code is wrong, expired, or already used. Run {loginCommand} in your agent to
                get a new one.
              </>
            ) : (
              problem.message
            )}
          </div>
        )}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void load(codeInput);
          }}
        >
          <label>
            Code from your agent
            <input
              value={codeInput}
              onChange={(event) => setCodeInput(event.target.value)}
              placeholder="XXXX-XXXX"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              required
            />
          </label>
          <button className="button primary connect-approve" disabled={loading}>
            {loading ? 'Looking up…' : 'Continue'}
          </button>
        </form>
      </section>
    );

  const reconnect = request.drives ?? [];
  return (
    <section className="panel connect-card">
      <div className="connect-code-box">
        <span className="connect-tag">
          <span className="connect-led on" aria-hidden="true" />
          Pairing code
        </span>
        <span className="connect-code" aria-label={`Code ${request.user_code}`}>
          {request.user_code}
        </span>
        <p>
          Check that this matches your agent’s terminal. If it does not, close this page; unapproved
          requests expire on their own.
        </p>
      </div>
      <h1>Connect {request.client_name}?</h1>
      <dl className="connect-facts">
        <dt>Agent</dt>
        <dd>{request.client_name}</dd>
        {request.machine && (
          <>
            <dt>Machine</dt>
            <dd>{request.machine}</dd>
          </>
        )}
        <dt>Account</dt>
        <dd>{account}</dd>
        <dt>Requested</dt>
        <dd>{new Date(request.created_at).toLocaleString()}</dd>
      </dl>
      {existing ? (
        <div className="connect-existing">
          <p className="banner info">
            You are giving {request.client_name}
            {request.machine ? ` on ${request.machine}` : ''} the key to this drive. Your browser
            seals the key to this agent’s login; Agent Drive never sees it. Approve only if the code
            above matches the terminal you trust.
          </p>
          <label>
            Drive
            <select
              value={driveId}
              onChange={(event) => {
                setDriveId(event.target.value);
                clearKey();
              }}
            >
              {accountDrives.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Drive key or credentials bundle (adcred1.…)
            <input
              type="password"
              autoComplete="off"
              value={keyText}
              onChange={(event) => setKeyText(event.target.value)}
            />
          </label>
          <label>
            Or choose a recovery file or credentials bundle
            <input
              key={fileInputKey}
              type="file"
              onChange={(event) => setKeyFile(event.target.files?.[0] ?? null)}
            />
          </label>
          <p className="connect-note">
            A recovery file or bundle is checked against the selected drive. A pasted raw key cannot
            be checked here; a wrong key gives the agent a drive it cannot read.
          </p>
          <label className="connect-check">
            <input
              type="checkbox"
              checked={readOnly}
              onChange={(event) => setReadOnly(event.target.checked)}
            />{' '}
            Read only
          </label>
          <label>
            Only allow writes under (optional)
            <input
              value={folder}
              onChange={(event) => setFolder(event.target.value)}
              placeholder="/inbox/x"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <button
            type="button"
            className="connect-link"
            onClick={() => {
              setExisting(false);
              clearKey();
            }}
          >
            Use a new drive instead
          </button>
        </div>
      ) : request.offer ? (
        <p className="banner info">
          Offered by {request.offer.agentName}: drive {request.offer.drive.name},{' '}
          {request.offer.scopes.join(', ')}
          {request.offer.writePaths.length
            ? `, writes under ${request.offer.writePaths.join(', ')}`
            : ''}
          . That agent sealed the drive key for this login; Agent Drive never sees it.
        </p>
      ) : (
        <p className="banner info">
          {reconnect.length > 0
            ? `Reconnects to: ${reconnect.map((d) => d.name).join(', ')}`
            : 'This agent gets its own encrypted drive. Its key is created and kept on that machine; Agent Drive never sees it.'}
          {request.scopes
            ? ` Keeps its previous permissions (${request.scopes.join(', ')}${request.write_paths?.length ? `; writes under ${request.write_paths.join(', ')}` : ''}).`
            : ''}
        </p>
      )}
      {!existing &&
        !request.offer &&
        request.creates_drive &&
        !request.scopes &&
        accountDrives.length > 0 && (
          <button type="button" className="connect-link" onClick={() => setExisting(true)}>
            Add to an existing drive instead
          </button>
        )}
      <label className="connect-delegate">
        <input
          type="checkbox"
          checked={delegate}
          onChange={(event) => setDelegate(event.target.checked)}
        />{' '}
        Let this agent add other agents to its drives
        <small>
          It can hand another agent the key and permissions it holds itself, never more, and it
          cannot pass this permission on. You still approve each new agent here.
        </small>
      </label>
      {notice && (
        <div role="status" className="banner info">
          {notice}
        </div>
      )}
      {formError && (
        <div role="alert" className="banner error">
          {formError}
        </div>
      )}
      <div className="connect-actions">
        <button
          className="button primary connect-approve"
          disabled={busy}
          onClick={() => void approve()}
        >
          {busy ? 'Working…' : 'Approve agent'}
        </button>
      </div>
      <p className="connect-note">You can revoke access any time in Console, Agents.</p>
    </section>
  );
}
