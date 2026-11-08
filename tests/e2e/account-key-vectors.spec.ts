import { createRequire } from 'node:module';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { RECORD_VECTOR, SLOT_VECTOR } from '../../apps/web/src/console/account-key.vectors';

// Runs account-key.ts in the real browser engine (Chromium only). esbuild comes with tsx, which
// apps/web already depends on, so no new dependency is added.
const webDir = path.resolve(__dirname, '../../apps/web');
const tsxDir = path.dirname(createRequire(`${webDir}/`).resolve('tsx/package.json'));
const { buildSync } = createRequire(`${tsxDir}/`)('esbuild') as {
  buildSync(options: Record<string, unknown>): { outputFiles: { text: string }[] };
};

const bundle = buildSync({
  entryPoints: [path.join(webDir, 'src/console/account-key.ts')],
  bundle: true,
  write: false,
  format: 'iife',
  globalName: 'AccountKey',
  target: 'es2022',
}).outputFiles[0]!.text;

test('account key v1 works in Chromium: frozen vectors and a fresh round trip', async ({
  page,
}) => {
  await page.goto('/');
  expect(await page.evaluate(() => window.isSecureContext)).toBe(true);
  await page.addScriptTag({ content: bundle });

  const result = await page.evaluate(
    async ({ record, slot, passphrase, accountId, driveId }) => {
      // Untyped on purpose: the page-side API is the bundled account-key.ts.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const AK = (window as any).AccountKey;
      const frozen = await AK.unlockAccountKey(record, accountId, passphrase);
      const frozenKey = await AK.unsealFromAccount(frozen, slot.keyId, slot.driveId, slot.sealed);

      const made = await AK.createAccountKey(accountId, 'browser round trip passphrase');
      const key = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
      const sealed = await AK.sealToAccount(made.record.publicKey, made.record.id, driveId, key);
      const unlocked = await AK.unlockAccountKey(
        made.record,
        accountId,
        'browser round trip passphrase',
      );
      const roundTrip = await AK.unsealFromAccount(unlocked, made.record.id, driveId, sealed);
      const wrong = await AK.unlockAccountKey(made.record, accountId, 'not the passphrase').then(
        () => 'unlocked',
        (e: Error) => e.message,
      );
      return { frozenKey, roundTrip, wrong, extractable: unlocked.extractable };
    },
    {
      record: RECORD_VECTOR.record,
      slot: SLOT_VECTOR,
      passphrase: RECORD_VECTOR.passphrase,
      accountId: RECORD_VECTOR.accountId,
      driveId: SLOT_VECTOR.driveId,
    },
  );

  expect(result.frozenKey).toBe(SLOT_VECTOR.driveKey);
  expect(result.roundTrip).toBe(SLOT_VECTOR.driveKey);
  expect(result.wrong).toBe('That passphrase is not correct.');
  expect(result.extractable).toBe(false);
});
