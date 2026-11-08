import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    externalClerkUserId: text('external_clerk_user_id'),
    deletingAt: timestamp('deleting_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('accounts_external_clerk_user_id_unique')
      .on(table.externalClerkUserId)
      .where(sql`${table.externalClerkUserId} IS NOT NULL`),
  ],
);

export const agents = pgTable(
  'agents',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('agents_account_name_unique').on(table.accountId, table.name),
    uniqueIndex('agents_id_account_id_unique').on(table.id, table.accountId),
  ],
);

export const machines = pgTable(
  'machines',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('machines_account_agent_name_unique').on(
      table.accountId,
      table.agentId,
      table.name,
    ),
    uniqueIndex('machines_id_account_agent_unique').on(table.id, table.accountId, table.agentId),
  ],
);

export const drives = pgTable(
  'drives',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    quotaBytes: bigint('quota_bytes', { mode: 'number' })
      .notNull()
      .default(Number.MAX_SAFE_INTEGER),
    deletingAt: timestamp('deleting_at', { withTimezone: true, mode: 'date' }),
    keyBackupAt: timestamp('key_backup_at', { withTimezone: true, mode: 'date' }),
    keyBackupMethod: text('key_backup_method'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('drives_account_name_unique').on(table.accountId, table.name),
    uniqueIndex('drives_id_account_id_unique').on(table.id, table.accountId),
    check('drives_quota_bytes_positive', sql`${table.quotaBytes} > 0`),
  ],
);

export const accountKeys = pgTable(
  'account_keys',
  {
    id: uuid('id').primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .unique()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    format: smallint('format').notNull(),
    publicKey: text('public_key').notNull(),
    wrappedPrivateKey: text('wrapped_private_key').notNull(),
    wrapGeneration: integer('wrap_generation').notNull().default(1),
    kdfName: text('kdf_name').notNull(),
    kdfIterations: integer('kdf_iterations').notNull(),
    kdfSalt: text('kdf_salt').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    unique('account_keys_id_account_id_unique').on(table.id, table.accountId),
    check('account_keys_format_check', sql`${table.format} = 1`),
    check('account_keys_wrap_generation_check', sql`${table.wrapGeneration} >= 1`),
    check('account_keys_kdf_name_check', sql`${table.kdfName} = 'PBKDF2-SHA256'`),
    check(
      'account_keys_kdf_iterations_check',
      sql`${table.kdfIterations} BETWEEN 600000 AND 2000000`,
    ),
  ],
);

export const accountKeySlots = pgTable(
  'account_key_slots',
  {
    driveId: uuid('drive_id').primaryKey(),
    accountId: uuid('account_id').notNull(),
    accountKeyId: uuid('account_key_id').notNull(),
    format: smallint('format').notNull(),
    sealed: jsonb('sealed').$type<{ epk: string; iv: string; ct: string }>().notNull(),
    revision: integer('revision').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'account_key_slots_drive_account_fk',
      columns: [table.driveId, table.accountId],
      foreignColumns: [drives.id, drives.accountId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'account_key_slots_key_account_fk',
      columns: [table.accountKeyId, table.accountId],
      foreignColumns: [accountKeys.id, accountKeys.accountId],
    }).onDelete('cascade'),
    index('account_key_slots_account_key_idx').on(table.accountKeyId),
    check('account_key_slots_format_check', sql`${table.format} = 1`),
    check('account_key_slots_revision_check', sql`${table.revision} >= 1`),
  ],
);

export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    issuedByAgentId: uuid('issued_by_agent_id').references(() => agents.id, {
      onDelete: 'set null',
    }),
    tokenHash: text('token_hash').notNull(),
    driveIds: uuid('drive_ids')
      .array()
      .notNull()
      .default(sql`ARRAY[]::uuid[]`),
    scopes: text('scopes').array().notNull(),
    writePaths: text('write_paths')
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('api_keys_token_hash_unique').on(table.tokenHash),
    index('api_keys_account_idx').on(table.accountId),
    check(
      'api_keys_scopes_check',
      sql`${table.scopes} <@ ARRAY['read', 'write', 'delete', 'share', 'manage', 'delegate']::text[]`,
    ),
  ],
);

export const files = pgTable(
  'files',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    driveId: uuid('drive_id')
      .notNull()
      .references(() => drives.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
    currentVersionId: uuid('current_version_id'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('files_drive_path_unique').on(table.driveId, table.path),
    index('files_drive_deleted_path_idx').on(table.driveId, table.deletedAt, table.path),
    // Folder listings (list?delimiter=/). Optional: queries work without it.
    index('files_drive_live_path_prefix_idx')
      .on(table.driveId, sql`${table.path} text_pattern_ops`)
      .where(sql`${table.deletedAt} IS NULL`),
  ],
);

export const versions = pgTable(
  'versions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    driveId: uuid('drive_id')
      .notNull()
      .references(() => drives.id, { onDelete: 'cascade' }),
    objectKey: text('object_key').notNull(),
    ciphertextSize: bigint('ciphertext_size', { mode: 'number' }).notNull(),
    wrappedKey: text('wrapped_key').notNull(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'restrict' }),
    machineId: uuid('machine_id').references(() => machines.id, { onDelete: 'set null' }),
    userId: text('user_id'),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('versions_object_key_unique').on(table.objectKey),
    index('versions_drive_created_idx').on(table.driveId, table.createdAt, table.id),
    index('versions_file_created_idx').on(table.fileId, table.createdAt, table.id),
    index('versions_agent_idx').on(table.agentId),
    index('versions_machine_idx').on(table.machineId),
    check('versions_ciphertext_size_positive', sql`${table.ciphertextSize} > 0`),
  ],
);

export const shares = pgTable(
  'shares',
  {
    id: text('id').primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    driveId: uuid('drive_id')
      .notNull()
      .references(() => drives.id, { onDelete: 'cascade' }),
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    versionId: uuid('version_id')
      .notNull()
      .references(() => versions.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    apiKeyId: uuid('api_key_id').references(() => apiKeys.id, { onDelete: 'set null' }),
    userId: text('user_id'),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('shares_drive_created_idx').on(table.driveId, table.createdAt, table.id),
    check('shares_expires_after_created_check', sql`${table.expiresAt} > ${table.createdAt}`),
  ],
);

export const uploadIntents = pgTable(
  'upload_intents',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    apiKeyId: uuid('api_key_id')
      .notNull()
      .references(() => apiKeys.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    machineId: uuid('machine_id').references(() => machines.id, { onDelete: 'set null' }),
    driveId: uuid('drive_id')
      .notNull()
      .references(() => drives.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    stagingKey: text('staging_key').notNull(),
    ciphertextSize: bigint('ciphertext_size', { mode: 'number' }).notNull(),
    wrappedKey: text('wrapped_key').notNull(),
    conditionalMode: text('conditional_mode').notNull(),
    baseVersionId: uuid('base_version_id'),
    userId: text('user_id'),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    description: text('description'),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    committedVersionId: uuid('committed_version_id').references(() => versions.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('upload_intents_staging_key_unique').on(table.stagingKey),
    index('upload_intents_drive_created_idx').on(table.driveId, table.createdAt),
    check(
      'upload_intents_conditional_mode_check',
      sql`${table.conditionalMode} IN ('unconditional', 'create', 'version')`,
    ),
    check('upload_intents_ciphertext_size_positive', sql`${table.ciphertextSize} > 0`),
  ],
);

export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    apiKeyId: uuid('api_key_id').references(() => apiKeys.id, { onDelete: 'set null' }),
    accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'set null' }),
    agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
    userId: text('user_id'),
    action: text('action').notNull(),
    outcome: text('outcome').notNull(),
    errorCode: text('error_code'),
    httpStatus: integer('http_status').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('audit_events_account_created_idx').on(table.accountId, table.createdAt),
    check('audit_events_outcome_check', sql`${table.outcome} IN ('pending', 'success', 'failure')`),
  ],
);

export const fileEvents = pgTable(
  'file_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    driveId: uuid('drive_id')
      .notNull()
      .references(() => drives.id),
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id),
    operation: text('operation').notNull(),
    path: text('path').notNull(),
    previousPath: text('previous_path'),
    versionId: uuid('version_id').references(() => versions.id),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id),
    machineId: uuid('machine_id').references(() => machines.id),
    userId: text('user_id'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    // Assigned at insert while the writer holds the drive row lock: strictly increasing in
    // commit order per drive, unlike created_at (transaction start).
    seq: bigint('seq', { mode: 'bigint' }).notNull().generatedAlwaysAsIdentity(),
  },
  (table) => [
    index('file_events_drive_created_idx').on(table.driveId, table.createdAt, table.id),
    index('file_events_drive_seq_idx').on(table.driveId, table.seq),
    check(
      'file_events_operation_check',
      sql`${table.operation} IN ('put', 'copy', 'restore', 'move', 'delete')`,
    ),
  ],
);

export const billingAccounts = pgTable(
  'billing_accounts',
  {
    accountId: uuid('account_id')
      .primaryKey()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    plan: text('plan').notNull().default('free'),
    stripeCustomerId: text('stripe_customer_id'),
    stripeSubscriptionId: text('stripe_subscription_id'),
    subscriptionStatus: text('subscription_status'),
    spendCapCents: bigint('spend_cap_cents', { mode: 'bigint' }),
    alertThresholdCents: bigint('alert_threshold_cents', { mode: 'bigint' }),
    alertEmail: text('alert_email'),
    stripeEventCreated: bigint('stripe_event_created', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    stripeEventId: text('stripe_event_id'),
    checkoutIdempotencyKey: text('checkout_idempotency_key'),
    checkoutSessionId: text('checkout_session_id'),
    checkoutCreatedAt: timestamp('checkout_created_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    uniqueIndex('billing_accounts_stripe_customer_unique').on(table.stripeCustomerId),
    uniqueIndex('billing_accounts_stripe_subscription_unique').on(table.stripeSubscriptionId),
    check('billing_accounts_plan_check', sql`${table.plan} IN ('free', 'developer', 'team')`),
    check(
      'billing_accounts_spend_cap_nonnegative',
      sql`${table.spendCapCents} IS NULL OR ${table.spendCapCents} >= 0`,
    ),
    check(
      'billing_accounts_alert_threshold_nonnegative',
      sql`${table.alertThresholdCents} IS NULL OR ${table.alertThresholdCents} >= 0`,
    ),
  ],
);

export const billingPeriods = pgTable(
  'billing_periods',
  {
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    periodStart: timestamp('period_start', { withTimezone: true, mode: 'date' }).notNull(),
    plan: text('plan').notNull(),
    peakDrives: bigint('peak_drives', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    peakStorageBytes: bigint('peak_storage_bytes', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    authorizedEgressBytes: bigint('authorized_egress_bytes', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    baselineCents: bigint('baseline_cents', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    earnedCents: bigint('earned_cents', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    baseCents: bigint('base_cents', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    rates: jsonb('rates').$type<Record<string, string>>(),
    statement: jsonb('statement').$type<Record<string, unknown>>(),
  },
  (table) => [
    primaryKey({ columns: [table.accountId, table.periodStart], name: 'billing_periods_pk' }),
    check('billing_periods_plan_check', sql`${table.plan} IN ('free', 'developer', 'team')`),
    check('billing_periods_peak_drives_nonnegative', sql`${table.peakDrives} >= 0`),
    check('billing_periods_peak_storage_nonnegative', sql`${table.peakStorageBytes} >= 0`),
    check(
      'billing_periods_authorized_egress_nonnegative',
      sql`${table.authorizedEgressBytes} >= 0`,
    ),
    check('billing_periods_baseline_nonnegative', sql`${table.baselineCents} >= 0`),
    check('billing_periods_earned_nonnegative', sql`${table.earnedCents} >= 0`),
    check('billing_periods_base_nonnegative', sql`${table.baseCents} >= 0`),
  ],
);

export const billingEgressEvents = pgTable(
  'billing_egress_events',
  {
    id: text('id').primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
    driveId: uuid('drive_id').references(() => drives.id, { onDelete: 'set null' }),
    objectKey: text('object_key').notNull(),
    bytesSent: bigint('bytes_sent', { mode: 'bigint' }).notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (table) => [
    index('billing_egress_account_time_idx').on(table.accountId, table.occurredAt),
    index('billing_egress_agent_time_idx').on(table.agentId, table.occurredAt),
    check('billing_egress_bytes_nonnegative', sql`${table.bytesSent} >= 0`),
  ],
);

export const apiKeyRateLimits = pgTable(
  'api_key_rate_limits',
  {
    apiKeyId: uuid('api_key_id')
      .primaryKey()
      .references(() => apiKeys.id, { onDelete: 'cascade' }),
    windowStart: timestamp('window_start', { withTimezone: true, mode: 'date' }).notNull(),
    requests: integer('requests').notNull(),
  },
  (table) => [check('api_key_rate_limits_requests_positive', sql`${table.requests} > 0`)],
);

// Per-account attempt budget for the console device-code endpoints (docs/agent-login.md section 2).
export const deviceConsoleLimits = pgTable(
  'device_console_limits',
  {
    accountId: uuid('account_id')
      .primaryKey()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    windowStart: timestamp('window_start', { withTimezone: true, mode: 'date' }).notNull(),
    attempts: integer('attempts').notNull(),
    failures: integer('failures').notNull(),
  },
  (table) => [
    check(
      'device_console_limits_counts_nonnegative',
      sql`${table.attempts} >= 0 AND ${table.failures} >= 0`,
    ),
  ],
);

export const billingMeterReports = pgTable(
  'billing_meter_reports',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    periodStart: timestamp('period_start', { withTimezone: true, mode: 'date' }).notNull(),
    stripeCustomerId: text('stripe_customer_id').notNull(),
    cents: bigint('cents', { mode: 'bigint' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    firstAttemptAt: timestamp('first_attempt_at', { withTimezone: true, mode: 'date' }),
    leaseUntil: timestamp('lease_until', { withTimezone: true, mode: 'date' }),
    reportedAt: timestamp('reported_at', { withTimezone: true, mode: 'date' }),
    lastError: text('last_error'),
  },
  (table) => [
    index('billing_meter_reports_pending_idx').on(table.leaseUntil, table.createdAt),
    index('billing_meter_reports_account_period_idx').on(table.accountId, table.periodStart),
    check('billing_meter_reports_cents_positive', sql`${table.cents} > 0`),
  ],
);

export const billingNotifications = pgTable(
  'billing_notifications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    periodStart: timestamp('period_start', { withTimezone: true, mode: 'date' }).notNull(),
    thresholdCents: bigint('threshold_cents', { mode: 'bigint' }).notNull(),
    email: text('email').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    firstAttemptAt: timestamp('first_attempt_at', { withTimezone: true, mode: 'date' }),
    leaseUntil: timestamp('lease_until', { withTimezone: true, mode: 'date' }),
    sentAt: timestamp('sent_at', { withTimezone: true, mode: 'date' }),
    lastError: text('last_error'),
  },
  (table) => [
    uniqueIndex('billing_notifications_account_period_threshold_unique').on(
      table.accountId,
      table.periodStart,
      table.thresholdCents,
    ),
    index('billing_notifications_pending_idx').on(table.leaseUntil, table.createdAt),
    check('billing_notifications_threshold_nonnegative', sql`${table.thresholdCents} >= 0`),
  ],
);

export const stripeEvents = pgTable('stripe_events', {
  id: text('id').primaryKey(),
  created: bigint('created', { mode: 'bigint' }).notNull(),
  type: text('type').notNull(),
  processedAt: timestamp('processed_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
});

export const billingLogObjects = pgTable(
  'billing_log_objects',
  {
    objectKey: text('object_key').notNull(),
    etag: text('etag').notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.objectKey, table.etag], name: 'billing_log_objects_pk' }),
  ],
);

export const deletionJobs = pgTable(
  'deletion_jobs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    kind: text('kind').notNull(),
    targetId: uuid('target_id').notNull(),
    accountId: uuid('account_id').notNull(),
    leaseUntil: timestamp('lease_until', { withTimezone: true, mode: 'date' }),
    requestedAt: timestamp('requested_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    notBefore: timestamp('not_before', { withTimezone: true, mode: 'date' }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),
    billingClosedAt: timestamp('billing_closed_at', { withTimezone: true, mode: 'date' }),
    identityDeletedAt: timestamp('identity_deleted_at', { withTimezone: true, mode: 'date' }),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true, mode: 'date' }),
    lastSweptAt: timestamp('last_swept_at', { withTimezone: true, mode: 'date' }),
    lastError: text('last_error'),
  },
  (table) => [
    uniqueIndex('deletion_jobs_kind_target_unique').on(table.kind, table.targetId),
    index('deletion_jobs_claim_idx').on(table.completedAt, table.notBefore, table.leaseUntil),
    check('deletion_jobs_kind_check', sql`${table.kind} IN ('drive', 'account')`),
  ],
);

export const deletionBillingReceipts = pgTable(
  'deletion_billing_receipts',
  {
    accountId: uuid('account_id').notNull(),
    periodStart: timestamp('period_start', { withTimezone: true, mode: 'date' }).notNull(),
    statement: jsonb('statement').$type<Record<string, unknown>>().notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.accountId, table.periodStart],
      name: 'deletion_billing_receipts_pk',
    }),
  ],
);

export const consoleUserTombstones = pgTable(
  'console_user_tombstones',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    externalUserHash: text('external_user_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('console_user_tombstones_hash_unique').on(table.externalUserHash)],
);

export const deviceAuthorizations = pgTable(
  'device_authorizations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    deviceCodeHash: text('device_code_hash').notNull(),
    userCode: text('user_code').notNull(),
    clientName: text('client_name').notNull(),
    machine: text('machine'),
    publicKey: text('public_key').notNull(),
    ipHash: text('ip_hash').notNull(),
    status: text('status').notNull().default('pending'),
    accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'cascade' }),
    driveIds: uuid('drive_ids')
      .array()
      .notNull()
      .default(sql`ARRAY[]::uuid[]`),
    scopes: text('scopes')
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    writePaths: text('write_paths')
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    requestedDriveIds: uuid('requested_drive_ids')
      .array()
      .notNull()
      .default(sql`ARRAY[]::uuid[]`),
    previousApiKeyId: uuid('previous_api_key_id').references(() => apiKeys.id, {
      onDelete: 'set null',
    }),
    newDriveId: uuid('new_drive_id'),
    sealedDriveKeys: jsonb('sealed_drive_keys').$type<Record<string, unknown>>(),
    apiKeyId: uuid('api_key_id').references(() => apiKeys.id, { onDelete: 'set null' }),
    approvedOfferId: uuid('approved_offer_id').references((): AnyPgColumn => deviceOffers.id, {
      onDelete: 'set null',
    }),
    // Survives deletion of the offer or its key, so exchange can fail closed.
    approvedFromOffer: boolean('approved_from_offer').notNull().default(false),
    intervalSeconds: integer('interval_seconds').notNull().default(5),
    lastPolledAt: timestamp('last_polled_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    decidedAt: timestamp('decided_at', { withTimezone: true, mode: 'date' }),
    consumedAt: timestamp('consumed_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    uniqueIndex('device_authorizations_device_code_hash_unique').on(table.deviceCodeHash),
    index('device_authorizations_user_code_idx').on(table.userCode),
    index('device_authorizations_ip_created_idx').on(table.ipHash, table.createdAt),
    index('device_authorizations_created_idx').on(table.createdAt),
    check(
      'device_authorizations_status_check',
      sql`${table.status} IN ('pending', 'approved', 'denied', 'consumed')`,
    ),
  ],
);

// An existing agent's offer of a sealed drive key for a pending login (docs/agent-login.md section 14).
// One row per (request, account): a foreign account's offer never occupies another account's slot.
export const deviceOffers = pgTable(
  'device_offers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    deviceAuthorizationId: uuid('device_authorization_id')
      .notNull()
      .references(() => deviceAuthorizations.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    apiKeyId: uuid('api_key_id')
      .notNull()
      .references(() => apiKeys.id, { onDelete: 'cascade' }),
    offeredByAgentId: uuid('offered_by_agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    driveId: uuid('drive_id')
      .notNull()
      .references(() => drives.id, { onDelete: 'cascade' }),
    scopes: text('scopes').array().notNull(),
    writePaths: text('write_paths')
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    sealedKey: jsonb('sealed_key').$type<Record<string, unknown>>().notNull(),
    revision: integer('revision').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('device_offers_request_account_unique').on(
      table.deviceAuthorizationId,
      table.accountId,
    ),
  ],
);
