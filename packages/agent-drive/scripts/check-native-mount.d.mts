export const MAX_MOUNT_HELPER_BYTES: number;

export function inspectMountHelper(path: string, expectedMachine: number): Promise<number>;

export function verifyNativeMountPackage(
  packageDirectory: string,
  options?: { allowMissing?: boolean },
): Promise<number[]>;
