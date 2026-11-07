/** Plain words for the audit action names recorded by actionFor() in src/api/handler.ts. */
const LABELS: Record<string, string> = {
  'drive.put': 'Uploaded a file',
  'drive.commit': 'Finished an upload',
  'drive.get': 'Downloaded a file',
  'drive.list': 'Listed files',
  'drive.versions': 'Listed file versions',
  'drive.recent': 'Listed recent files',
  'drive.search': 'Searched files',
  'drive.trash': 'Listed Trash',
  'drive.delete': 'Moved a file to Trash',
  'drive.restore': 'Restored a file',
  'drive.move': 'Moved a file',
  'drive.copy': 'Copied a file',
  'drive.key_backup': 'Backed up a drive key',
  'drives.list': 'Listed drives',
  'drives.create': 'Created a drive',
  'share.create': 'Created a share link',
  'share.list': 'Listed share links',
  'share.revoke': 'Revoked a share link',
  'share.access': 'Opened a share link',
  'agents.list': 'Listed agents',
  'agents.create': 'Created an agent',
  'agents.revoke': 'Revoked an agent',
  'keys.list': 'Listed API keys',
  'keys.create': 'Created an API key',
  'keys.revoke': 'Revoked an API key',
  'device.read': 'Checked an agent login',
  'device.grant': 'Connected an agent',
  'console.device.read': 'Viewed an agent approval',
  'console.device.approve': 'Approved an agent',
  'console.device.deny': 'Denied an agent',
  'console.deletions.list': 'Viewed deletion requests',
  'console.audit.list': 'Viewed activity',
  'console.session.read': 'Opened the console',
  'console.usage.read': 'Viewed usage',
  'console.drive.delete': 'Requested drive deletion',
  'console.account.delete': 'Requested account deletion',
  'whoami.read': 'Checked who the key belongs to',
  'billing.read': 'Viewed billing',
  'billing.statements.list': 'Viewed billing statements',
  'billing.settings.update': 'Changed spending controls',
  'billing.checkout': 'Started checkout',
  'billing.portal': 'Opened the billing portal',
};

export function auditLabel(action: string): string {
  return LABELS[action] ?? 'Other request';
}

const ERROR_LABELS: Record<string, string> = {
  validation_error: 'invalid request',
  unauthorized: 'not signed in',
  permission_denied: 'not allowed',
  not_found: 'not found',
  conflict: 'conflict',
  quota_exceeded: 'over quota',
  payment_required: 'payment required',
  rate_limited: 'too many requests',
  share_revoked: 'link was revoked',
  share_expired: 'link expired',
  share_unavailable: 'link unavailable',
  internal_error: 'server error',
};

/** Plain words for an ApiError code recorded on a failed audit event. */
export function errorLabel(code: string | null | undefined): string {
  return (code && ERROR_LABELS[code]) || 'error';
}
