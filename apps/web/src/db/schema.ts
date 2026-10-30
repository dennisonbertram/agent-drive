import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    externalClerkUserId: text('external_clerk_user_id'),
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
    quotaBytes: bigint('quota_bytes', { mode: 'number' }).notNull().default(5_368_709_120),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('drives_account_name_unique').on(table.accountId, table.name),
    uniqueIndex('drives_id_account_id_unique').on(table.id, table.accountId),
    check('drives_quota_bytes_positive', sql`${table.quotaBytes} > 0`),
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
    tokenHash: text('token_hash').notNull(),
    driveIds: uuid('drive_ids')
      .array()
      .notNull()
      .default(sql`ARRAY[]::uuid[]`),
    scopes: text('scopes').array().notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('api_keys_token_hash_unique').on(table.tokenHash),
    index('api_keys_account_idx').on(table.accountId),
    check(
      'api_keys_scopes_check',
      sql`${table.scopes} <@ ARRAY['read', 'write', 'delete', 'share', 'manage']::text[]`,
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
    action: text('action').notNull(),
    outcome: text('outcome').notNull(),
    errorCode: text('error_code'),
    httpStatus: integer('http_status').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('audit_events_account_created_idx').on(table.accountId, table.createdAt),
    check('audit_events_outcome_check', sql`${table.outcome} IN ('success', 'failure')`),
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
  },
  (table) => [
    index('file_events_drive_created_idx').on(table.driveId, table.createdAt, table.id),
    check(
      'file_events_operation_check',
      sql`${table.operation} IN ('put', 'copy', 'restore', 'move', 'delete')`,
    ),
  ],
);
