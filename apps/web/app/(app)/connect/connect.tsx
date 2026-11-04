'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { decodeDriveKey } from '../../../../../packages/agent-drive/src/crypto.ts';
import { parseRecoveryFile, sealDriveKey, type SealedKey } from '@/src/device/seal';

type Drive = { id: string; name: string };
type DeviceRequest = {
  user_code: string;
  client_name: string;
  machine: string | null;
  created_at: string;
  expires_at: string;
  public_key: string;
};
type Page<T> = { items: T[]; nextCursor: string | null };

const NEW = 'new';
const scopeChoices = [
  { id: 'read', label: 'Read files' },
  { id: 'write', label: 'Write files' },
  { id: 'delete', label: 'Delete files' },
  { id: 'share', label: 'Create share links' },
];
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

export default function Connect({ initialCode }: { initialCode: string }) {
  const [codeInput, setCodeInput] = useState(initialCode);
  const [request, setRequest] = useState<DeviceRequest | null>(null);
  const [drives, setDrives] = useState<Drive[]>([]);
  const [problem, setProblem] = useState<{ kind: 'missing' | 'error'; message: string } | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<'approved' | 'denied' | null>(null);
  const [driveChoice, setDriveChoice] = useState(NEW);
  const [newDriveName, setNewDriveName] = useState('');
  const [picked, setPicked] = useState<string[]>(['read', 'write']);
  const [keyInput, setKeyInput] = useState('');
  const [formError, setFormError] = useState('');

  async function load(raw: string) {
    const code = normalizeCode(raw);
    setProblem(null);
    setRequest(null);
    if (!codePattern.test(code)) {
      setProblem({ kind: 'error', message: 'Enter the code in the form XXXX-XXXX.' });
      return;
    }
    setLoading(true);
    try {
      const found = await api<DeviceRequest>(`device/${encodeURIComponent(code)}`);
      const items: Drive[] = [];
      let cursor: string | null = null;
      do {
        const page: Page<Drive> = await api(
          `drives?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        );
        items.push(...page.items);
        cursor = page.nextCursor;
      } while (cursor);
      setDrives(items);
      setDriveChoice(items[0]?.id ?? NEW);
      setNewDriveName(found.client_name);
      setRequest(found);
    } catch (error) {
      if (error instanceof HttpError && error.status === 404)
        setProblem({
          kind: 'missing',
          message:
            'This code is wrong, expired, or already used. Run agent-drive login in your agent to get a new one.',
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

  useEffect(() => {
    // Load the prefilled code once on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (initialCode) void load(initialCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function readKeyFile(file?: File) {
    if (!file) return;
    setFormError('');
    try {
      const key = parseRecoveryFile(await file.text(), driveChoice);
      decodeDriveKey(key);
      setKeyInput(key);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'This is not a valid drive key file.');
    }
  }

  async function approve(event: FormEvent) {
    event.preventDefault();
    if (!request) return;
    setFormError('');
    if (!picked.length) return setFormError('Choose at least one permission.');
    const creating = driveChoice === NEW;
    if (creating && !newDriveName.trim()) return setFormError('Name the new drive.');
    setBusy(true);
    try {
      const sealedDriveKeys: Record<string, SealedKey> = {};
      const key = keyInput.trim();
      if (!creating && key) {
        try {
          decodeDriveKey(key);
        } catch {
          throw new Error('That drive key is not valid.');
        }
        sealedDriveKeys[driveChoice] = await sealDriveKey(request.public_key, driveChoice, key);
      }
      await api(`device/${encodeURIComponent(request.user_code)}/approve`, 'POST', {
        scopes: picked,
        ...(creating
          ? { newDriveName: newDriveName.trim() }
          : { driveIds: [driveChoice], sealedDriveKeys }),
      });
      setKeyInput('');
      setDone('approved');
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Approval failed.');
    } finally {
      setBusy(false);
    }
  }

  async function deny() {
    if (!request) return;
    setBusy(true);
    setFormError('');
    try {
      await api(`device/${encodeURIComponent(request.user_code)}/deny`, 'POST', {});
      setDone('denied');
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Denying failed.');
    } finally {
      setBusy(false);
    }
  }

  if (done)
    return (
      <section className="panel" role="status">
        <h1>{done === 'approved' ? 'Approved' : 'Denied'}</h1>
        <p>
          {done === 'approved'
            ? 'Approved. Return to your agent; it will finish setup on its own.'
            : 'Denied. The agent was not given access.'}
        </p>
      </section>
    );

  if (!request)
    return (
      <section className="panel">
        <h1>Connect an agent</h1>
        <p>Enter the code your agent printed after running agent-drive login.</p>
        {problem && (
          <div role="alert" className={`banner ${problem.kind === 'missing' ? 'info' : 'error'}`}>
            {problem.message}
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
          <button className="button primary" disabled={loading}>
            {loading ? 'Looking up…' : 'Continue'}
          </button>
        </form>
      </section>
    );

  const creating = driveChoice === NEW;
  const selectedDrive = drives.find((d) => d.id === driveChoice);
  return (
    <section className="panel">
      <h1>Approve {request.client_name}?</h1>
      <dl className="connect-facts">
        <dt>Code</dt>
        <dd className="connect-code">{request.user_code}</dd>
        <dt>Agent</dt>
        <dd>{request.client_name}</dd>
        {request.machine && (
          <>
            <dt>Machine</dt>
            <dd>{request.machine}</dd>
          </>
        )}
        <dt>Requested</dt>
        <dd>{new Date(request.created_at).toLocaleString()}</dd>
      </dl>
      <p className="banner info">
        Check that this code matches the one in your agent’s terminal. If it does not, deny.
      </p>
      {formError && (
        <div role="alert" className="banner error">
          {formError}
        </div>
      )}
      <form onSubmit={approve}>
        <label>
          Drive
          <select
            value={driveChoice}
            onChange={(event) => {
              setDriveChoice(event.target.value);
              setKeyInput('');
            }}
          >
            {drives.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
            <option value={NEW}>Create a new drive for this agent</option>
          </select>
        </label>
        {creating ? (
          <>
            <label>
              New drive name
              <input
                value={newDriveName}
                onChange={(event) => setNewDriveName(event.target.value)}
                maxLength={64}
                required
              />
            </label>
            <p className="banner info">
              The agent creates this drive’s encryption key on its machine and keeps it there. Back
              the key up from the agent’s config if you need to open this drive in the console.
            </p>
          </>
        ) : (
          <>
            <label>
              Drive key for {selectedDrive?.name} (optional)
              <input
                type="password"
                autoComplete="off"
                value={keyInput}
                onChange={(event) => setKeyInput(event.target.value)}
              />
            </label>
            <label>
              Or choose a recovery file
              <input
                type="file"
                accept="application/json,.json"
                onChange={(event) => void readKeyFile(event.target.files?.[0])}
              />
            </label>
            <p className="banner info">
              {keyInput
                ? 'The key is encrypted in this browser for the agent only. The service never sees it.'
                : 'Without the key, the agent can list file names but cannot decrypt or add readable files.'}
            </p>
          </>
        )}
        <fieldset>
          <legend>Permissions</legend>
          {scopeChoices.map((s) => (
            <label className="check-label" key={s.id}>
              <input
                type="checkbox"
                checked={picked.includes(s.id)}
                onChange={(event) =>
                  setPicked((cur) =>
                    event.target.checked ? [...cur, s.id] : cur.filter((x) => x !== s.id),
                  )
                }
              />
              {s.label}
            </label>
          ))}
        </fieldset>
        <div className="connect-actions">
          <button className="button primary" disabled={busy}>
            {busy ? 'Working…' : 'Approve agent'}
          </button>
          <button type="button" className="button secondary" disabled={busy} onClick={deny}>
            Deny
          </button>
        </div>
      </form>
    </section>
  );
}
