import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Production incident guard (VK ID routing): the Caddyfile used to be
 * bind-mounted as a SINGLE FILE (`./Caddyfile:/etc/caddy/Caddyfile`).
 * Docker pins a single-file mount to the file's inode at container
 * creation; `git pull` replaces a changed file with a new inode, so
 * the running container kept serving the old Caddyfile after a deploy
 * (`/auth/vk/start` kept returning the SPA) and neither
 * `compose up -d` (service definition unchanged) nor Caddy's `--watch`
 * (watches the stale in-container file) could notice. A DIRECTORY mount
 * follows the live directory entries. These tests pin that down against
 * the real compose file (plain text — no YAML dependency).
 */
const infraDir = fileURLToPath(new URL('../../../infra/', import.meta.url));
const compose = readFileSync(`${infraDir}docker-compose.yml`, 'utf-8');

/** Short-form `- ./host/path:/container/path[:mode]` volume entries. */
function relativeBindMounts(): { host: string; container: string; line: string }[] {
  return [...compose.matchAll(/^\s*-\s+(\.{1,2}\/[^:\s]*):(\/[^:\s]*)(?::\w+)?\s*$/gm)].map(
    (m) => ({
      host: m[1]!,
      container: m[2]!,
      line: m[0].trim(),
    }),
  );
}

describe('infra/docker-compose.yml bind mounts', () => {
  it('finds the relative bind mounts it is meant to check (the regex is not vacuous)', () => {
    expect(relativeBindMounts().length).toBeGreaterThan(0);
  });

  it('never bind-mounts a single file from the repo (stale after `git pull`: the container keeps the old inode)', () => {
    for (const { host, line } of relativeBindMounts()) {
      const path = `${infraDir}${host}`;
      expect(existsSync(path), `${line}: host path does not exist`).toBe(true);
      expect(statSync(path).isDirectory(), `${line}: mount a directory, not a file`).toBe(true);
    }
  });

  it('mounts the Caddy config as the directory infra/caddy at /etc/caddy', () => {
    expect(relativeBindMounts()).toContainEqual(
      expect.objectContaining({ host: './caddy', container: '/etc/caddy' }),
    );
    expect(existsSync(`${infraDir}caddy/Caddyfile`)).toBe(true);
    expect(existsSync(`${infraDir}Caddyfile`)).toBe(false);
  });

  it('never mounts infra/ itself (would expose infra/.env to a container)', () => {
    for (const { host, line } of relativeBindMounts()) {
      expect(['.', './', '..', '../'], line).not.toContain(host);
    }
  });
});

describe('infra/caddy/Caddyfile VK ID alias', () => {
  const caddyfile = readFileSync(`${infraDir}caddy/Caddyfile`, 'utf-8');

  it('rewrites the unprefixed VK OAuth paths to the real /api/v1 routes and proxies them to the api', () => {
    expect(caddyfile).toMatch(/@vkAuthAlias\s+path\s+\/auth\/vk\/start\s+\/auth\/vk\/callback/);
    expect(caddyfile).toMatch(
      /handle @vkAuthAlias\s*\{\s*rewrite \* \/api\/v1\{uri\}\s*reverse_proxy api:3000\s*\}/,
    );
  });

  it('declares the alias before the catch-all handle that serves the SPA', () => {
    expect(caddyfile.indexOf('handle @vkAuthAlias')).toBeGreaterThan(-1);
    expect(caddyfile.indexOf('handle @vkAuthAlias')).toBeLessThan(
      caddyfile.indexOf('reverse_proxy web:80'),
    );
  });
});
