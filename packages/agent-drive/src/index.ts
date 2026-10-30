export const foundationStatus = 'scaffold';
export { AgentDriveClient, AgentDriveApiError } from './client.js';
export type {
  Agent,
  ApiKey,
  ClientOptions,
  Drive,
  FetchLike,
  GetOptions,
  Page,
  PutOptions,
  RecentEvent,
  Version,
  Whoami,
} from './client.js';
export {
  DriveCryptoError,
  decryptFile,
  decryptWithFileKey,
  decodeDriveKey,
  encodeBase64Url,
  encryptFile,
  generateDriveKey,
  unwrapFileKey,
} from './crypto.js';
