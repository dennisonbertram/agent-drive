import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

type RootPackage = {
  scripts: Record<string, string | undefined>;
};

const rootPackage = JSON.parse(readFileSync('package.json', 'utf8')) as RootPackage;

describe('local service startup', () => {
  it('waits for service health before running the one-shot bucket initializer', () => {
    expect(rootPackage.scripts['services:up']).toBe(
      'docker compose up -d --wait postgres minio && docker compose run --rm minio-init',
    );
  });
});
