'use client';

import '../../styles/connect.css';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  decodeDriveKey,
  DriveCryptoError,
} from '../../../../../packages/agent-drive/src/crypto.ts';
import {
  normalizeVerificationCode,
  verificationCode,
} from '../../../../../packages/agent-drive/src/verification.ts';
import { driveKeyFromBundle, BUNDLE_PREFIX } from '@/src/console/credentials-bundle';
import { parseRecoveryFile, sealDriveKey, type SealedKey } from '@/src/device/seal';
import { verifyDriveKey, type DriveKeyCheck } from '@/src/device/verify-key';

type Drive = { id: string; name: string };
type DeviceRequest = {
  user_code: string;
  client_name: string;
  machine: string | null;
  created_at: string;
  expires_at: string;
  drives?: Drive[];
  held_drives?: Drive[];
  creates_drive?: boolean;
  existing_agent_name?: boolean;
  account_has_drives?: boolean;
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

// What the server committed on approval; the receipt is drawn from this, not from the page's GET.
type Receipt = {
  drives: Drive[];
  scopes: string[];
  write_paths: string[];
  created_drive: string | null;
};

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

// Raised when the drive check itself cannot run; shown as a form error, not a key complaint.
class CheckError extends Error {}

const BAD_KEY =
  'This is not a valid drive key. Paste the key from the console, or choose a recovery file or credentials bundle.';
const WRONG_DRIVE =
  'This key does not open the selected drive. Check the drive and paste its own key.';
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

// Drives the agent already holds a key for, when nothing else decides the drive: no offer, no
// reconnect, and the user did not ask for a new drive.
function heldOf(request: DeviceRequest) {
  return request.offer || (request.drives ?? []).length > 0 ? [] : (request.held_drives ?? []);
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
  const [phase, setPhase] = useState<'entry' | 'loading' | 'review' | 'approving' | 'done'>(
    'entry',
  );
  const loading = phase === 'loading';
  const busy = phase === 'approving';
  const [done, setDone] = useState<{
    denied?: boolean;
    name: string;
    access: string;
    accessDetail: string;
    drive: string;
    driveName: string;
    delegate?: boolean;
    uncheckedKey?: boolean;
  } | null>(null);
  const [formError, setFormError] = useState<ReactNode>('');
  const [fieldError, setFieldError] = useState<{
    field: 'key' | 'folder' | 'verify';
    message: string;
  } | null>(null);
  // The verification code the agent printed on its own terminal, typed here. The page never
  // displays it: typing what the terminal shows is what makes the terminal an independent
  // channel, and it commits this approval to that device's public key.
  const [verifyText, setVerifyText] = useState('');
  const [delegate, setDelegate] = useState(false);
  // Add to an existing drive (docs/agent-login.md section 12). The key lives only in this state.
  const [accountDrives, setAccountDrives] = useState<Drive[]>([]);
  const [driveCursor, setDriveCursor] = useState<string | null>(null);
  const [drivesLoading, setDrivesLoading] = useState(false);
  const [drivesError, setDrivesError] = useState('');
  const [existing, setExisting] = useState(false);
  // The user chose a new drive although the agent already holds a key for an existing one.
  const [newInstead, setNewInstead] = useState(false);
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
    if (busyRef.current) return;
    const code = normalizeCode(raw);
    const startedAt = ++generation.current;
    const live = () => startedAt === generation.current;
    refetches.current = 0;
    refetchStopped.current = false;
    clearKey();
    setVerifyText('');
    setPhase('entry');
    setProblem(null);
    setNotice('');
    setRequest(null);
    if (!code) {
      setProblem({ kind: 'error', message: 'Enter the code your agent printed.' });
      return;
    }
    if (!codePattern.test(code)) {
      setProblem({
        kind: 'error',
        message:
          'Enter the code in the form XXXX-XXXX, using only consonants: B C D F G H J K L M N P Q R S T V W X Z. Codes have no vowels and no Y.',
      });
      return;
    }
    setPhase('loading');
    try {
      const found = await api<DeviceRequest>(`device/${encodeURIComponent(code)}`);
      if (!live()) return;
      setRequest(found);
      setPhase('review');
      setExisting(false);
      setNewInstead(false);
      setAccountDrives([]);
      setDriveCursor(null);
      setDrivesError('');
      if (found.creates_drive) void loadDrives(startedAt);
    } catch (error) {
      if (!live()) return;
      setPhase('entry');
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
    }
  }

  // Forget any key material, including the browser's file input.
  function clearKey() {
    setKeyText('');
    setKeyFile(null);
    setFileInputKey((n) => n + 1);
    setFieldError(null);
  }

  async function loadDrives(startedAt: number) {
    setDrivesLoading(true);
    setDrivesError('');
    try {
      const page: { items: Drive[]; nextCursor: string | null } = await api('drives?limit=100');
      if (startedAt !== generation.current) return;
      setAccountDrives(page.items);
      setDriveCursor(page.nextCursor);
      setDriveId(page.items[0]?.id ?? '');
    } catch (error) {
      if (startedAt === generation.current)
        setDrivesError(error instanceof Error ? error.message : 'Could not load drives.');
    } finally {
      if (startedAt === generation.current) setDrivesLoading(false);
    }
  }

  async function loadMoreDrives() {
    if (!driveCursor || drivesLoading) return;
    setDrivesLoading(true);
    setDrivesError('');
    try {
      const page: { items: Drive[]; nextCursor: string | null } = await api(
        `drives?limit=100&cursor=${encodeURIComponent(driveCursor)}`,
      );
      setAccountDrives((current) => {
        const known = new Set(current.map((drive) => drive.id));
        return [...current, ...page.items.filter((drive) => !known.has(drive.id))];
      });
      setDriveCursor(page.nextCursor);
    } catch (error) {
      setDrivesError(error instanceof Error ? error.message : 'Could not load drives.');
    } finally {
      setDrivesLoading(false);
    }
  }

  useEffect(() => {
    // Load the prefilled code once on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (initialCode) void load(initialCode);
    return () => {
      generation.current += 1;
    };
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
    let active = true;
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
          active &&
          startedAt === generation.current &&
          (found.offerRevision ?? 0) !== shownRevision &&
          !busyRef.current
        ) {
          const updatedAt = ++generation.current;
          setRequest(found);
          setExisting(false);
          setNewInstead(false);
          setAccountDrives([]);
          setDriveCursor(null);
          setDrivesError('');
          if (found.creates_drive) void loadDrives(updatedAt);
          clearKey();
          setNotice(
            found.offer
              ? `${found.offer.agentName} offered a drive for this login. Review it before you approve.`
              : 'The request changed; review it again.',
          );
        }
      } catch {
        if (active && startedAt === generation.current) refetchStopped.current = true;
      } finally {
        inFlight = false;
      }
    }
    window.addEventListener('focus', onFocus);
    return () => {
      active = false;
      window.removeEventListener('focus', onFocus);
    };
  }, [shownCode, shownRevision, shownExpiry, done]);

  // Bring a field error into view and put the cursor where the fix goes.
  useEffect(() => {
    if (!fieldError) return;
    const ids = {
      key: 'connect-key',
      folder: 'connect-folder',
      verify: 'connect-verify',
    } as const;
    document.getElementById(`${ids[fieldError.field]}-error`)?.scrollIntoView({ block: 'center' });
    document.getElementById(ids[fieldError.field])?.focus();
  }, [fieldError]);

  async function approve() {
    if (!request || busyRef.current) return;
    const requested = request;
    const startedAt = generation.current;
    const live = () => startedAt === generation.current;
    setFormError('');
    setFieldError(null);
    // Recipient binding, checked before any key is sealed or posted: the typed code must be
    // the fingerprint of the public key this request carries. A wrong code means either a typo
    // or that the service showed this page a different key than the agent generated — either
    // way nothing is approved.
    const typed = normalizeVerificationCode(verifyText);
    if (!typed) {
      setFieldError({
        field: 'verify',
        message:
          'Enter the verification code your agent printed: 16 digits and letters a-f, with or without spaces or dashes, like a1b2 c3d4 e5f6 7890.',
      });
      return;
    }
    // Claim the submit before the first async digest. Otherwise a double click or an offer
    // refresh during WebCrypto can let two handlers approve a stale request.
    busyRef.current = true;
    setPhase('approving');
    let deviceVerification = '';
    try {
      if (!requested.public_key) throw new Error('This request has no agent key. Start again.');
      deviceVerification = await verificationCode(requested.public_key);
    } catch (error) {
      if (live()) {
        setPhase('review');
        setFormError(error instanceof Error ? error.message : 'The request could not be checked.');
      }
      busyRef.current = false;
      return;
    }
    if (!live()) {
      busyRef.current = false;
      return;
    }
    if (typed !== deviceVerification) {
      setFieldError({
        field: 'verify',
        message:
          'This code does not match the one your agent printed. Check the terminal again and type it exactly.',
      });
      setPhase('review');
      busyRef.current = false;
      return;
    }
    try {
      // The revision binds this approval to the offer (or lack of one) the page showed.
      const offerRevision = requested.offerRevision ?? 0;
      let body: unknown = delegate
        ? { delegate: true, offerRevision, deviceVerification }
        : { offerRevision, deviceVerification };
      let uncheckedKey = false;
      // The agent already holds these drives' keys: approve them explicitly, sealing nothing.
      const heldIds = (newInstead ? [] : heldOf(requested)).map((d) => d.id);
      if (!existing && heldIds.length > 0) {
        body = {
          driveIds: heldIds,
          scopes: [...(readOnly ? ['read'] : DEFAULT_SCOPES), ...(delegate ? ['delegate'] : [])],
          writePaths: folder.trim() ? [folder.trim()] : [],
          offerRevision,
          deviceVerification,
        };
      }
      if (existing) {
        // Read the key, check it, seal it to the agent in the browser, post only the sealed blob.
        // The selection is captured up front so a late render can never mix drives.
        const target = driveId;
        let sealed: SealedKey;
        try {
          const pasted = keyText.trim();
          if (keyFile && keyFile.size > 16_384)
            throw new Error('This is not a valid drive key file.');
          const text = keyFile ? await keyFile.text() : pasted;
          if (!text) throw new Error('Paste the drive key or choose a recovery file.');
          const key = text.trim().startsWith(BUNDLE_PREFIX)
            ? driveKeyFromBundle(text, target)
            : keyFile
              ? parseRecoveryFile(text, target)
              : text.trim();
          decodeDriveKey(key);
          if (!requested.public_key) throw new Error('This request has no agent key. Start again.');
          // A well-formed key can still belong to another drive: it must open this one before
          // sealing. Metadata GETs only — the key itself is never sent.
          let check: DriveKeyCheck;
          try {
            check = await verifyDriveKey(api, target, key);
          } catch (error) {
            if (error instanceof HttpError && error.status === 401) throw error;
            throw new CheckError(
              error instanceof HttpError && error.status === 404
                ? 'This drive is no longer available. Reload the page and pick it again.'
                : 'The key could not be checked against the drive. Try again.',
            );
          }
          if (check === 'mismatch') throw new KeyError(WRONG_DRIVE);
          // 'unverifiable' means the drive has no file or trace inbox to check against.
          uncheckedKey = check === 'unverifiable';
          sealed = await sealDriveKey(requested.public_key, target, key);
        } catch (error) {
          if (
            error instanceof KeyError ||
            error instanceof CheckError ||
            error instanceof HttpError
          )
            throw error;
          const message = error instanceof Error ? error.message : '';
          throw new KeyError(
            error instanceof DriveCryptoError || /base64url|key length/i.test(message)
              ? BAD_KEY
              : message || BAD_KEY,
          );
        }
        if (!live()) return;
        body = {
          driveIds: [target],
          scopes: [...(readOnly ? ['read'] : DEFAULT_SCOPES), ...(delegate ? ['delegate'] : [])],
          sealedDriveKeys: { [target]: sealed },
          writePaths: folder.trim() ? [folder.trim()] : [],
          offerRevision,
          deviceVerification,
        };
      }
      if (!live()) return;
      const receipt = await api<Receipt>(
        `device/${encodeURIComponent(requested.user_code)}/approve`,
        'POST',
        body,
      );
      if (!live()) return;
      clearKey();
      setPhase('done');
      const access = describeScopes(receipt.scopes);
      const names = receipt.drives.map((d) => d.name).join(', ');
      setDone({
        name: requested.client_name,
        access,
        accessDetail:
          receipt.scopes.includes('write') && receipt.write_paths.length
            ? `${access}; writes only under ${receipt.write_paths.join(', ')}`
            : access,
        drive: receipt.created_drive ? 'its new drive' : `the drive ${names}`,
        driveName: receipt.created_drive ? `New encrypted drive (${receipt.created_drive})` : names,
        delegate: receipt.scopes.includes('delegate'),
        uncheckedKey,
      });
    } catch (error) {
      if (!live()) return;
      setPhase('review');
      if (error instanceof KeyError) setFieldError({ field: 'key', message: error.message });
      else if (
        error instanceof HttpError &&
        error.status === 409 &&
        error.message === 'The request changed; reload the page.'
      ) {
        // The request changed since this page loaded (for example an offer arrived): show it again.
        clearKey();
        busyRef.current = false;
        await load(requested.user_code);
        if (generation.current === startedAt + 1)
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
          <>
            This request expired or was already used. Run {loginCommand} in your agent to get a new
            code.
          </>,
        );
      else setFormError(error instanceof Error ? error.message : 'Approval failed.');
    } finally {
      if (live()) busyRef.current = false;
    }
  }

  // Refusing is always safe, so it needs no verification code: the request is marked denied
  // and the agent's poll ends with access_denied.
  async function deny() {
    if (!request || busyRef.current) return;
    const requested = request;
    busyRef.current = true;
    setFormError('');
    setFieldError(null);
    setPhase('approving');
    try {
      await api(`device/${encodeURIComponent(requested.user_code)}/deny`, 'POST', {});
      setDone({
        denied: true,
        name: requested.client_name,
        access: '',
        accessDetail: '',
        drive: '',
        driveName: '',
      });
      setPhase('done');
    } catch (error) {
      setPhase('review');
      setFormError(
        error instanceof HttpError && error.status === 404
          ? 'This request is no longer pending, so it may already have been approved or expired. Check Agents in the console.'
          : error instanceof Error
            ? error.message
            : 'Could not deny the request.',
      );
    } finally {
      busyRef.current = false;
    }
  }

  if (done?.denied)
    return (
      <section className="panel connect-card" role="status">
        <span className="connect-tag">
          <span className="connect-led dim" aria-hidden="true" />
          Denied
        </span>
        <h1>Request denied</h1>
        <p>The agent got no access. You can close this page.</p>
      </section>
    );

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
        <dl className="connect-facts connect-rows">
          <div className="connect-fact">
            <dt>Drive</dt>
            <dd>{done.driveName}</dd>
          </div>
          <div className="connect-fact">
            <dt>Access</dt>
            <dd>{done.accessDetail}</dd>
          </div>
          {done.delegate && (
            <div className="connect-fact">
              <dt>Delegate</dt>
              <dd>Can add other agents</dd>
            </div>
          )}
          <div className="connect-fact">
            <dt>Account</dt>
            <dd>{account}</dd>
          </div>
        </dl>
        {done.uncheckedKey && (
          <p className="connect-note">
            This drive has nothing to check the key against, so it could not be checked before
            sending.
          </p>
        )}
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
  const held = !existing && !newInstead ? heldOf(request) : [];
  const shown = reconnect.length ? reconnect : held;
  const heldNames = held.map((d) => d.name).join(', ');
  const canUseExisting =
    !existing && !offer && request.creates_drive && !request.scopes && accountDrives.length > 0;
  const newDriveBanner =
    !existing &&
    !offer &&
    held.length === 0 &&
    request.creates_drive === true &&
    request.account_has_drives === true;
  const useExistingButton = (
    <button
      type="button"
      className="connect-link"
      disabled={busy}
      onClick={(event) => {
        event.currentTarget.closest('details')?.removeAttribute('open');
        setExisting(true);
      }}
    >
      Use one of my drives instead (needs its recovery file)
    </button>
  );
  const grantScopes = offer
    ? offer.scopes
    : held.length || existing
      ? readOnly
        ? ['read']
        : DEFAULT_SCOPES
      : (previous ?? DEFAULT_SCOPES);
  const grantWrites = offer
    ? offer.writePaths
    : held.length || existing
      ? folder.trim()
        ? [folder.trim()]
        : []
      : (request.write_paths ?? []);
  // The deciding facts stay visible outside Details: who is approving, which agent and machine
  // are asking, and any restriction or extra permission the approval carries.
  const facts: [string, string][] = [];
  if (!existing) {
    facts.push([
      'Drive',
      offer
        ? offer.drive.name
        : shown.length
          ? shown.map((d) => d.name).join(', ')
          : 'New encrypted drive',
    ]);
    facts.push(['Access', capitalize(grantScopes)]);
    facts.push(['Writes', describeWrites(grantScopes, grantWrites)]);
  }
  if (offer) facts.push(['Offered by', offer.agentName]);
  if (!existing) facts.push(['Requested', new Date(request.created_at).toLocaleString()]);
  const summary = (
    existing
      ? ['Existing drive · choose below', summarizeAccess(grantScopes, grantWrites)]
      : [
          offer
            ? offer.drive.name
            : shown.length
              ? shown.map((d) => d.name).join(', ')
              : 'New encrypted drive',
          summarizeAccess(grantScopes, grantWrites),
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
      : held.length > 0
        ? `This agent says it has the key for your ${held.length === 1 ? 'drive' : 'drives'} ${heldNames}. Approve only if you gave it ${held.length === 1 ? "that drive's recovery file or key" : "those drives' recovery files or keys"}.`
        : reconnect.length > 0
          ? `It reconnects to the drive it used before${previous ? ' and keeps its previous permissions' : ''}.`
          : `This agent gets its own encrypted drive. Its key is created and kept on that machine; Agent Drive never sees it.${previous ? ' It keeps its previous permissions.' : ''}`;
  const keyInvalid = fieldError?.field === 'key';
  const folderInvalid = fieldError?.field === 'folder';
  // Read only and the write folder apply to an existing drive and to drives the agent holds.
  const limits = (
    <>
      <label className="connect-check cf-check">
        <input
          type="checkbox"
          checked={readOnly}
          disabled={busy}
          onChange={(event) => setReadOnly(event.target.checked)}
        />
        Read only
      </label>
      <label className="cf-folder">
        Write folder (optional)
        <input
          id="connect-folder"
          value={folder}
          disabled={busy}
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
        <p className="connect-field-error cf-folder-error" role="alert" id="connect-folder-error">
          {fieldError.message}
        </p>
      )}
    </>
  );
  return (
    <section className="panel connect-card">
      <span className="connect-tag">
        <span className="connect-led on" aria-hidden="true" />
        Pairing request
      </span>
      <h1>Connect {request.client_name}?</h1>
      <p className="connect-account">Signed in as {account}</p>
      {notice && (
        <div role="status" className="banner info">
          {notice}
        </div>
      )}
      <p className="connect-summary">{summary}</p>
      <dl className="connect-facts connect-rows">
        <div className="connect-fact">
          <dt>Agent</dt>
          <dd>{request.client_name}</dd>
        </div>
        {request.machine && (
          <div className="connect-fact">
            <dt>Machine</dt>
            <dd>{request.machine}</dd>
          </div>
        )}
        {!existing && grantScopes.includes('write') && grantWrites.length > 0 && (
          <div className="connect-fact">
            <dt>Writes</dt>
            <dd>Only under {grantWrites.join(', ')}</dd>
          </div>
        )}
        {delegate && (
          <div className="connect-fact">
            <dt>Delegate</dt>
            <dd>Can add other agents</dd>
          </div>
        )}
      </dl>
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
        {!existing && heldOf(request).length > 0 && (
          <button
            type="button"
            className="connect-link"
            disabled={busy}
            onClick={() => setNewInstead(!newInstead)}
          >
            {newInstead ? 'Use the drive this agent holds' : 'Use a new drive instead'}
          </button>
        )}
        {canUseExisting && !newDriveBanner && useExistingButton}
        {newDriveBanner && (
          <p className="connect-grant">
            To give this agent a drive another agent already has: from an agent approved with
            &lsquo;Let this agent add other agents&rsquo;, run{' '}
            <code className="connect-cmd connect-cmd-wrap">
              agent-drive grant {request.user_code} --verify &lt;code from the new agent’s
              terminal&gt;
            </code>
            .
          </p>
        )}
        <label className="connect-delegate">
          <input
            type="checkbox"
            checked={delegate}
            disabled={busy}
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
      {!newDriveBanner && <p className="connect-explain">{explain}</p>}
      {existing && (
        <div className="connect-existing">
          <label className="cf-drive">
            Drive
            <select
              value={driveId}
              disabled={busy || drivesLoading || !accountDrives.length}
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
          {drivesError && (
            <p role="alert" className="banner error">
              {drivesError}
            </p>
          )}
          {driveCursor && (
            <button
              type="button"
              className="connect-link"
              disabled={busy || drivesLoading}
              onClick={() => void loadMoreDrives()}
            >
              {drivesLoading
                ? 'Loading drives…'
                : drivesError
                  ? 'Retry loading drives'
                  : 'Load more drives'}
            </button>
          )}
          <label className="cf-key">
            Drive key
            <input
              id="connect-key"
              type="password"
              autoComplete="off"
              placeholder="Paste the drive key"
              value={keyText}
              disabled={busy}
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
              disabled={busy}
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
              The key is checked against the drive before it is sent (an empty drive has nothing to
              check). No recovery file? Have an agent that has this drive run{' '}
              <code className="connect-cmd connect-cmd-wrap">
                agent-drive credentials export --drive {driveId || '<drive id>'} --recovery-file
                &lt;file&gt;
              </code>
              .
            </p>
          )}
          {limits}
          <button
            type="button"
            className="button secondary connect-branch cf-back"
            disabled={busy}
            onClick={() => {
              setExisting(false);
              // A request whose agent holds a drive would otherwise fall back to that drive.
              setNewInstead(true);
              clearKey();
            }}
          >
            Use a new drive instead
          </button>
        </div>
      )}
      {held.length > 0 && <div className="connect-existing connect-held">{limits}</div>}
      {formError && (
        <div role="alert" className="banner error">
          {formError}
        </div>
      )}
      <div className="connect-code-line">
        <span>Does this code match your terminal? If not, click Deny.</span>
        <span className="connect-code" aria-label={`Code ${request.user_code}`}>
          {request.user_code}
        </span>
        <label className="connect-verify">
          Verification code
          <input
            id="connect-verify"
            autoFocus
            value={verifyText}
            disabled={busy}
            onChange={(event) => setVerifyText(event.target.value)}
            placeholder="a1b2 c3d4 e5f6 7890"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            aria-invalid={fieldError?.field === 'verify' || undefined}
            aria-describedby={
              fieldError?.field === 'verify' ? 'connect-verify-error' : 'connect-verify-hint'
            }
            className={fieldError?.field === 'verify' ? 'invalid' : undefined}
          />
        </label>
        {fieldError?.field === 'verify' ? (
          <p className="connect-field-error" role="alert" id="connect-verify-error">
            {fieldError.message}
          </p>
        ) : (
          <p className="connect-hint" id="connect-verify-hint">
            Type the code from your agent’s terminal. This page never shows it.
          </p>
        )}
      </div>
      {(request.existing_agent_name === true || newDriveBanner) && (
        <div className="banner warn">
          {request.existing_agent_name === true && (
            <>
              You already have an agent named {request.client_name}. Approving signs this one in as
              that agent with a new API key.{' '}
            </>
          )}
          {newDriveBanner && (
            <>
              Approving creates a new, empty drive for this agent.
              {previous ? ' It keeps its previous permissions.' : ''}
              {canUseExisting && useExistingButton}
            </>
          )}
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
        <button type="button" className="connect-deny" disabled={busy} onClick={() => void deny()}>
          Deny
        </button>
      </div>
      <p className="connect-note">You can revoke access any time in Console, Agents.</p>
    </section>
  );
}
