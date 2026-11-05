'use client';

import '../../styles/connect.css';

import { useEffect, useState } from 'react';

type Drive = { id: string; name: string };
type DeviceRequest = {
  user_code: string;
  client_name: string;
  machine: string | null;
  created_at: string;
  expires_at: string;
  drives?: Drive[];
  creates_drive?: boolean;
  scopes?: string[] | null;
  write_paths?: string[] | null;
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
      setRequest(found);
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
      await api(`device/${encodeURIComponent(request.user_code)}/approve`, 'POST', {});
      setDone(true);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Approval failed.');
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
      <p className="banner info">
        {reconnect.length > 0
          ? `Reconnects to: ${reconnect.map((d) => d.name).join(', ')}`
          : 'This agent gets its own encrypted drive. Its key is created and kept on that machine; Agent Drive never sees it.'}
        {request.scopes
          ? ` Keeps its previous permissions (${request.scopes.join(', ')}${request.write_paths?.length ? `; writes under ${request.write_paths.join(', ')}` : ''}).`
          : ''}
      </p>
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
