export const foundationStatus = 'scaffold';
export { AgentDriveClient, AgentDriveApiError, StreamSizeLimitError } from './client.js';
export type {
  Agent,
  ApiKey,
  ClientOptions,
  Drive,
  FileEntry,
  FetchLike,
  GetOptions,
  Page,
  PutOptions,
  RecentEvent,
  Version,
  Whoami,
} from './client.js';
export { getFile, putFile } from './node-transfer.js';
export type { GetFileOptions } from './node-transfer.js';
export {
  DriveCryptoError,
  decryptFile,
  decryptWithFileKey,
  decryptWithFileKeyStream,
  decodeDriveKey,
  encodeBase64Url,
  encryptFile,
  encryptFileStream,
  envelopeVersion,
  generateDriveKey,
  unwrapFileKey,
} from './crypto.js';
export {
  createTraceInbox,
  sealFileKeyToInbox,
  unsealFileKeyFromInbox,
  unwrapInboxPrivateKey,
} from './trace-inbox.js';
export type { TraceInbox, TraceInboxRecord } from './trace-inbox.js';
