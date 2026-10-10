import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { ConfigError, isLoopbackHost, loadServerConfig, parseCorporaSpec, parseHost, parsePort } from '../src/config.ts';
import { removeScratch, scratch } from './helpers.ts';

const NAME = 'config';
afterEach(async () => {
  await removeScratch(NAME);
  await removeScratch(`${NAME}-outside`);
});

function codeOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return error instanceof ConfigError ? error.code : 'not-a-config-error';
  }
  return undefined;
}

async function asyncCodeOf(run: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await run();
  } catch (error) {
    return error instanceof ConfigError ? error.code : 'not-a-config-error';
  }
  return undefined;
}

describe('ADRKIT_SERVER_CORPORA', () => {
  test('the list form: bare keys and key=dir, sorted by key', () => {
    expect(parseCorporaSpec(' zeta , alpha=repos/alpha ')).toEqual([
      { key: 'alpha', dir: 'repos/alpha', adrDir: 'docs/adr' },
      { key: 'zeta', dir: undefined, adrDir: 'docs/adr' },
    ]);
  });

  test('the JSON form: a string dir, or an object with dir and adrDir', () => {
    expect(parseCorporaSpec('{"b":"repos/b","a":{"adrDir":"./decisions/"},"c":{"dir":"/srv/c"}}')).toEqual([
      { key: 'a', dir: undefined, adrDir: 'decisions' },
      { key: 'b', dir: 'repos/b', adrDir: 'docs/adr' },
      { key: 'c', dir: '/srv/c', adrDir: 'docs/adr' },
    ]);
  });

  test('refuses what it cannot read exactly', () => {
    const cases: Array<[string | undefined, string]> = [
      [undefined, 'corpora-missing'],
      ['   ', 'corpora-missing'],
      ['{}', 'corpora-missing'],
      ['a,,b', 'corpora-malformed'],
      ['a=', 'corpora-malformed'],
      ['{not json', 'corpora-malformed'],
      ['{"a":1}', 'corpora-malformed'],
      ['{"a":{"dir":"x","extra":true}}', 'corpora-malformed'],
      ['{"a":{"dir":7}}', 'corpora-malformed'],
      ['Upper', 'corpus-key-invalid'],
      ['-lead', 'corpus-key-invalid'],
      [`k${'x'.repeat(64)}`, 'corpus-key-invalid'],
      ['a/b', 'corpus-key-invalid'],
      ['a,a=x', 'corpus-key-duplicate'],
      ['{"a":{"adrDir":"../up"}}', 'adr-dir-invalid'],
      ['{"a":{"adrDir":"/abs"}}', 'adr-dir-invalid'],
      ['{"a":"x\\u0000y"}', 'corpus-dir-invalid'],
    ];
    for (const [value, code] of cases) expect([value, codeOf(() => parseCorporaSpec(value))]).toEqual([value, code]);
  });
});

describe('host and port', () => {
  test('defaults are loopback 127.0.0.1 and 8080', () => {
    expect(parseHost(undefined)).toBe('127.0.0.1');
    expect(parsePort(undefined)).toBe(8080);
    expect(parsePort('0')).toBe(0);
    for (const value of ['-1', '65536', '80a', '1e3']) expect(codeOf(() => parsePort(value))).toBe('port-invalid');
    for (const value of ['', ' ', 'a b']) expect(codeOf(() => parseHost(value))).toBe('host-invalid');
  });

  test('only loopback addresses are loopback', () => {
    for (const host of ['127.0.0.1', '127.1.2.3', 'localhost', '::1', '[::1]', '::ffff:127.0.0.1']) expect([host, isLoopbackHost(host)]).toEqual([host, true]);
    for (const host of ['0.0.0.0', '::', '10.0.0.5', '192.168.1.1', 'example.com', '128.0.0.1']) expect([host, isLoopbackHost(host)]).toEqual([host, false]);
  });
});

describe('confinement (clause 6)', () => {
  test('a bare key resolves to <root>/<key>, realpath-resolved', async () => {
    const root = await scratch(NAME);
    await mkdir(join(root, 'demo'));
    const config = await loadServerConfig({ ADRKIT_SERVER_ROOT: root, ADRKIT_SERVER_CORPORA: 'demo,later' }, '/');
    expect(config.root).toBe(root);
    expect(config.corpora).toEqual([
      { key: 'demo', dir: join(root, 'demo'), adrDir: 'docs/adr' },
      { key: 'later', dir: join(root, 'later'), adrDir: 'docs/adr' },
    ]);
    expect([config.host, config.port]).toEqual(['127.0.0.1', 8080]);
  });

  test('a directory outside the root, lexically or through a symlink, refuses to start', async () => {
    const root = await scratch(NAME);
    const outside = await scratch(`${NAME}-outside`);
    await symlink(outside, join(root, 'link'));
    for (const corpora of ['a=../x', `a=${outside}`, 'a=link', 'a=link/inner']) {
      expect([corpora, await asyncCodeOf(() => loadServerConfig({ ADRKIT_SERVER_ROOT: root, ADRKIT_SERVER_CORPORA: corpora }, '/'))]).toEqual([
        corpora,
        'corpus-escapes-root',
      ]);
    }
  });

  test('a root that does not exist refuses to start', async () => {
    expect(await asyncCodeOf(() => loadServerConfig({ ADRKIT_SERVER_ROOT: '/definitely/not/here', ADRKIT_SERVER_CORPORA: 'a' }, '/'))).toBe(
      'root-unreadable',
    );
  });
});
