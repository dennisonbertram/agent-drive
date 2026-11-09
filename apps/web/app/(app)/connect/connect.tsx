'use client';

import '../../styles/connect.css';

import { useEffect, useRef, useState } from 'react';
import {
  decodeDriveKey,
  DriveCryptoError,
} from '../../../../../packages/agent-drive/src/crypto.ts';
import { driveKeyFromBundle, BUNDLE_PREFIX } from '@/src/console/credentials-bundle';
import { parseRecoveryFile, sealDriveKey, type SealedKey } from '@/src/device/seal';

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

// Letters only, uppercase, at most 8, hyphen after the fourth: "bcdf ghjk" becomes "BCDF-GHJK".
function formatCode(value: string) {
  const raw = value
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, 8);
  return raw.length > 4 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw;
}

// Raised while reading or checking the key in the browser, before anything is posted.
class KeyError extends Error {}

const BAD_KEY =
  'This is not a valid drive key. Paste the key from the console, or choose a recovery file or credentials bundle.';
const DEFAULT_SCOPES = ['read', 'write', 'delete', 'share'];
const capitalize = (scopes: string[]) => {
  const text = scopes.join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1);
};
const MAX_REFETCHES = 10;

// "read", "write only", "read, write and delete": what was actually granted.
function describeScopes(scopes: string[]) {
  const list = scopes.filter((scope) => scope !== 'delegate');
  if (list.length === 0) return 'read';
  if (list.length === 1) return list[0] === 'read' ? 'read' : `${list[0]} only`;
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

function describeWrites(scopes: string[], paths: string[]) {
  if (!scopes.includes('write')) return 'No writes';
  return paths.length ? `Only under ${paths.join(', ')}` : 'Anywhere in the drive';
}

// One visible line that never hides a restriction: "full access", "read only", "can write only, writes only in /x".
function summarizeAccess(scopes: string[], paths: string[]) {
  const list = scopes.filter((scope) => scope !== 'delegate');
  const full = ['read', 'write', 'delete', 'share'].every((scope) => list.includes(scope));
  const only = describeScopes(list);
  const text = full ? 'full access' : only === 'read' ? 'read only' : `can ${only}`;
  return list.includes('write') && paths.length
    ? `${text}, writes only in ${paths.join(', ')}`
    : text;
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
  const [done, setDone] = useState<{ name: string; access: string; drive: string } | null>(null);
  const [formError, setFormError] = useState('');
  const [fieldError, setFieldError] = useState<{ field: 'key' | 'folder'; message: string } | null>(
    null,
  );
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
  const busyRef = useRef(false);
  const refetches = useRef(0);
  const refetchStopped = useRef(false);
  // Bumped when the shown request changes or an approval starts; older refetches are ignored.
  const generation = useRef(0);

  async function load(raw: string) {
    const code = normalizeCode(raw);
    generation.current += 1;
    setProblem(null);
    setNotice('');
    setRequest(null);
    if (!code) {
      setProblem({ kind: 'error', message: 'Enter the code your agent printed.' });
      return;
    }
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
    setFieldError(null);
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

  // The agent may offer a drive while this page is open (`agent-drive grant` in another
  // terminal). Look again when the user comes back to the window, not on a timer.
  // ponytail: every console device call shares a 30 per 10 minute budget with Approve and the
  // delegating agent, so no polling: at most MAX_REFETCHES focus refetches, stopped at expiry or
  // on any error.
  const shownCode = request?.user_code;
  const shownRevision = request?.offerRevision ?? 0;
  const shownExpiry = request?.expires_at;
  useEffect(() => {
    if (!shownCode || !shownExpiry || done) return;
    let inFlight = false;
    async function onFocus() {
      if (
        inFlight ||
        busyRef.current ||
        refetchStopped.current ||
        refetches.current >= MAX_REFETCHES ||
        Date.now() >= Date.parse(shownExpiry!)
      )
        return;
      inFlight = true;
      const startedAt = generation.current;
      refetches.current += 1;
      try {
        const found = await api<DeviceRequest>(`device/${encodeURIComponent(shownCode!)}`);
        if (
          startedAt === generation.current &&
          (found.offerRevision ?? 0) !== shownRevision &&
          !busyRef.current
        ) {
          generation.current += 1;
          setRequest(found);
          setExisting(false);
          clearKey();
          setNotice(
            found.offer
              ? `${found.offer.agentName} offered a drive for this login. Review it before you approve.`
              : 'The request changed; review it again.',
          );
        }
      } catch {
        refetchStopped.current = true;
      } finally {
        inFlight = false;
      }
    }
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [shownCode, shownRevision, shownExpiry, done]);

  // Bring a field error into view and put the cursor where the fix goes.
  useEffect(() => {
    if (!fieldError) return;
    const id = fieldError.field === 'key' ? 'connect-key-error' : 'connect-folder-error';
    document.getElementById(id)?.scrollIntoView({ block: 'center' });
    document.getElementById(fieldError.field === 'key' ? 'connect-key' : 'connect-folder')?.focus();
  }, [fieldError]);

  async function approve() {
    if (!request) return;
    setFormError('');
    setFieldError(null);
    generation.current += 1;
    setBusy(true);
    busyRef.current = true;
    try {
      // The revision binds this approval to the offer (or lack of one) the page showed.
      const offerRevision = request.offerRevision ?? 0;
      let body: unknown = delegate ? { delegate: true, offerRevision } : { offerRevision };
      let scopes: string[] = request.offer?.scopes ?? request.scopes ?? DEFAULT_SCOPES;
      let driveLabel = request.offer
        ? `the drive ${request.offer.drive.name}`
        : (request.drives ?? []).length > 0
          ? (request.drives ?? []).map((d) => d.name).join(', ')
          : 'its new drive';
      if (existing) {
        // Read the key, check it, seal it to the agent in the browser, post only the sealed blob.
        let sealed: SealedKey;
        try {
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
          sealed = await sealDriveKey(request.public_key, driveId, key);
        } catch (error) {
          const message = error instanceof Error ? error.message : '';
          throw new KeyError(
            error instanceof DriveCryptoError || /base64url|key length/i.test(message)
              ? BAD_KEY
              : message || BAD_KEY,
          );
        }
        scopes = readOnly ? ['read'] : DEFAULT_SCOPES;
        driveLabel = `the drive ${accountDrives.find((d) => d.id === driveId)?.name ?? ''}`.trim();
        body = {
          driveIds: [driveId],
          scopes: [...scopes, ...(delegate ? ['delegate'] : [])],
          sealedDriveKeys: { [driveId]: sealed },
          writePaths: folder.trim() ? [folder.trim()] : [],
          offerRevision,
        };
      }
      await api(`device/${encodeURIComponent(request.user_code)}/approve`, 'POST', body);
      clearKey();
      setDone({
        name: request.client_name,
        access: describeScopes(scopes),
        drive: driveLabel,
      });
    } catch (error) {
      if (error instanceof KeyError) setFieldError({ field: 'key', message: error.message });
      else if (
        error instanceof HttpError &&
        error.status === 409 &&
        error.message === 'The request changed; reload the page.'
      ) {
        // The request changed since this page loaded (for example an offer arrived): show it again.
        clearKey();
        await load(request.user_code);
        setNotice('The request changed; review it again.');
      } else if (
        error instanceof HttpError &&
        error.status === 400 &&
        error.message.startsWith('writePaths')
      )
        setFieldError({
          field: 'folder',
          message:
            'Enter a folder that starts with / and does not end with /, for example /inbox/agent.',
        });
      else if (error instanceof HttpError && error.status === 404)
        setFormError(
          'This request expired or was already used. Run `agent-drive login` in your agent to get a new code.',
        );
      else setFormError(error instanceof Error ? error.message : 'Approval failed.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  if (done)
    return (
      <section className="panel connect-card approved" role="status">
        <span className="connect-tag">
          <span className="connect-led on" aria-hidden="true" />
          Approval saved
        </span>
        <h1>Access approved for {done.name}</h1>
        <p>
          You approved {done.name} to {done.access} {done.drive}. Return to your agent to finish
          setup and confirm it is ready.
        </p>
        <a className="button secondary" href="/console">
          Open console
        </a>
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
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void load(codeInput);
          }}
        >
          <label>
            Code from your agent
            <input
              value={codeInput}
              onChange={(event) => setCodeInput(formatCode(event.target.value))}
              placeholder="XXXX-XXXX"
              autoComplete="off"
              autoCapitalize="characters"
              autoFocus={!initialCode}
              aria-invalid={problem ? true : undefined}
              aria-describedby={problem ? 'connect-code-error' : undefined}
              spellCheck={false}
            />
          </label>
          {problem && (
            <div role="alert" id="connect-code-error" className="banner error">
              {problem.kind === 'missing' ? (
                <>
                  This code is wrong, expired, or already used. Run {loginCommand} in your agent to
                  get a new code.
                </>
              ) : (
                problem.message
              )}
            </div>
          )}
          <button className="button primary connect-approve" disabled={loading}>
            {loading ? 'Looking up…' : 'Continue'}
          </button>
        </form>
      </section>
    );

  const reconnect = request.drives ?? [];
  const offer = request.offer;
  const previous = request.scopes;
  const facts: [string, string][] = [];
  if (request.machine) facts.push(['Machine', request.machine]);
  facts.push(['Account', account]);
  if (!existing) {
    const writes = offer ? offer.writePaths : (request.write_paths ?? []);
    facts.push([
      'Drive',
      offer
        ? offer.drive.name
        : reconnect.length
          ? reconnect.map((d) => d.name).join(', ')
          : 'New encrypted drive',
    ]);
    facts.push(['Access', capitalize(offer ? offer.scopes : (previous ?? DEFAULT_SCOPES))]);
    facts.push([
      'Writes',
      describeWrites(offer ? offer.scopes : (previous ?? DEFAULT_SCOPES), writes),
    ]);
  }
  if (offer) facts.push(['Offered by', offer.agentName]);
  if (!existing) facts.push(['Requested', new Date(request.created_at).toLocaleString()]);
  const grantScopes = offer ? offer.scopes : (previous ?? DEFAULT_SCOPES);
  const summary = (
    existing
      ? ['Existing drive · choose below']
      : [
          offer
            ? offer.drive.name
            : reconnect.length
              ? reconnect.map((d) => d.name).join(', ')
              : 'New encrypted drive',
          summarizeAccess(grantScopes, offer ? offer.writePaths : (request.write_paths ?? [])),
          offer ? `offered by ${offer.agentName}` : '',
        ]
  )
    .concat(delegate ? ['can add other agents'] : [])
    .filter(Boolean)
    .join(' · ');
  const explain = existing
    ? 'Your browser seals the key to this agent’s login; Agent Drive never sees it.'
    : offer
      ? `${offer.agentName} sealed the drive key for this login; Agent Drive never sees it.`
      : reconnect.length > 0
        ? `It reconnects to the drive it used before${previous ? ' and keeps its previous permissions' : ''}.`
        : `This agent gets its own encrypted drive. Its key is created and kept on that machine; Agent Drive never sees it.${previous ? ' It keeps its previous permissions.' : ''}`;
  const keyInvalid = fieldError?.field === 'key';
  const folderInvalid = fieldError?.field === 'folder';
  return (
    <section className="panel connect-card">
      <span className="connect-tag">
        <span className="connect-led on" aria-hidden="true" />
        Pairing request
      </span>
      <h1>Connect {request.client_name}?</h1>
      {notice && (
        <div role="status" className="banner info">
          {notice}
        </div>
      )}
      <p className="connect-summary">{summary}</p>
      <details className="connect-more connect-details">
        <summary>Details</summary>
        <dl className="connect-facts">
          {facts.map(([term, value]) => (
            <div key={term} className="connect-fact">
              <dt>{term}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        {!existing &&
          !offer &&
          request.creates_drive &&
          !request.scopes &&
          accountDrives.length > 0 && (
            <button
              type="button"
              className="connect-link"
              onClick={(event) => {
                event.currentTarget.closest('details')?.removeAttribute('open');
                setExisting(true);
              }}
            >
              Use one of my drives instead (needs its recovery file)
            </button>
          )}
        <label className="connect-delegate">
          <input
            type="checkbox"
            checked={delegate}
            onChange={(event) => setDelegate(event.target.checked)}
          />
          <span>
            Let this agent add other agents to its drives
            <small>
              It can hand another agent the key and permissions it holds itself, never more, and it
              cannot pass this permission on. You still approve each new agent here.
            </small>
          </span>
        </label>
      </details>
      <p className="connect-explain">{explain}</p>
      {existing && (
        <div className="connect-existing">
          <label className="cf-drive">
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
          <label className="cf-key">
            Drive key
            <input
              id="connect-key"
              type="password"
              autoComplete="off"
              placeholder="Paste the drive key or an adcred1… bundle"
              value={keyText}
              aria-invalid={keyInvalid || undefined}
              aria-describedby={keyInvalid ? 'connect-key-error' : undefined}
              className={keyInvalid ? 'invalid' : undefined}
              onChange={(event) => setKeyText(event.target.value)}
            />
          </label>
          <label className="cf-file">
            Or choose a file
            <input
              key={fileInputKey}
              type="file"
              aria-invalid={keyInvalid || undefined}
              aria-describedby={keyInvalid ? 'connect-key-error' : undefined}
              className={keyInvalid ? 'invalid' : undefined}
              onChange={(event) => setKeyFile(event.target.files?.[0] ?? null)}
            />
          </label>
          {keyInvalid ? (
            <p className="connect-field-error cf-note" role="alert" id="connect-key-error">
              {fieldError.message}
            </p>
          ) : (
            <p className="connect-hint cf-note">
              A recovery file or bundle is checked against the drive. A pasted key cannot be checked
              here.
            </p>
          )}
          <label className="connect-check cf-check">
            <input
              type="checkbox"
              checked={readOnly}
              onChange={(event) => setReadOnly(event.target.checked)}
            />
            Read only
          </label>
          <label className="cf-folder">
            Only allow writes under (optional)
            <input
              id="connect-folder"
              value={folder}
              onChange={(event) => setFolder(event.target.value)}
              placeholder="/inbox/x"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={folderInvalid || undefined}
              aria-describedby={folderInvalid ? 'connect-folder-error' : undefined}
              className={folderInvalid ? 'invalid' : undefined}
            />
          </label>
          {folderInvalid && (
            <p
              className="connect-field-error cf-folder-error"
              role="alert"
              id="connect-folder-error"
            >
              {fieldError.message}
            </p>
          )}
          <button
            type="button"
            className="button secondary connect-branch cf-back"
            onClick={() => {
              setExisting(false);
              clearKey();
            }}
          >
            Use a new drive instead
          </button>
        </div>
      )}
      {formError && (
        <div role="alert" className="banner error">
          {formError}
        </div>
      )}
      <div className="connect-code-line">
        <span>Does this code match your terminal?</span>
        <span className="connect-code" aria-label={`Code ${request.user_code}`}>
          {request.user_code}
        </span>
        <small>If it does not, close this page; the request expires on its own.</small>
      </div>
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
