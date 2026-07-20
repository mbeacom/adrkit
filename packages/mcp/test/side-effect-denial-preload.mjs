/**
 * @adrkit/mcp — side-effect-denial preload (contracts/tools.md §10.1, research §R10).
 *
 * Loaded via `node --import ./side-effect-denial-preload.mjs` (or `bun --preload`).
 * Patches — through `createRequire` plus `syncBuiltinESMExports()` so ESM imports of a
 * builtin observe the patched function, never a stale facade — every enumerated
 * filesystem-mutation, write-capable open, returned-FileHandle, child-process,
 * cluster, worker, dlopen, and network/listen entry point to fail closed. Read-only
 * filesystem APIs are deliberately left intact so the server can still load its corpus.
 *
 * Passing is BOUNDED executed-path evidence only — it does not prove the absence of raw
 * native syscalls or of future, unenumerated runtime APIs.
 */

import { createRequire } from 'node:module';
import * as nodeModule from 'node:module';
import { constants as FS } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

export class SideEffectDenied extends Error {
  constructor(api) {
    super(`side-effect denied: ${api}`);
    this.name = 'SideEffectDenied';
    this.api = api;
  }
}

function syncEsm() {
  if (typeof nodeModule.syncBuiltinESMExports === 'function') {
    try {
      nodeModule.syncBuiltinESMExports();
    } catch {
      /* best-effort; a no-op when no ESM facade exists yet */
    }
  }
}

function denyAll(target, names, prefix) {
  if (!target) return;
  for (const name of names) {
    if (typeof target[name] === 'function' || name in target) {
      target[name] = function denied() {
        throw new SideEffectDenied(`${prefix}.${name}`);
      };
    }
  }
  syncEsm();
}

// ---- optional read boundary -------------------------------------------------
const READ_ROOTS = (() => {
  const encoded = process.env.ADRKIT_MCP_TEST_READ_ROOTS;
  if (!encoded) return [];
  try {
    const roots = JSON.parse(encoded);
    return Array.isArray(roots) ? roots.map((root) => resolve(String(root))) : [];
  } catch {
    throw new Error('ADRKIT_MCP_TEST_READ_ROOTS must be a JSON array');
  }
})();

function pathString(path) {
  if (typeof path === 'number') return undefined;
  if (path instanceof URL) return fileURLToPath(path);
  if (Buffer.isBuffer(path)) return path.toString();
  return String(path);
}

function isWithin(root, candidate) {
  const rel = relative(root, candidate);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function assertReadAllowed(api, path) {
  if (READ_ROOTS.length === 0) return;
  const raw = pathString(path);
  if (raw === undefined) return;
  const candidate = resolve(raw);
  if (!READ_ROOTS.some((root) => isWithin(root, candidate))) {
    throw new SideEffectDenied(`${api}:out-of-root`);
  }
}

function guardPathReads(target, names, prefix) {
  if (!target || READ_ROOTS.length === 0) return;
  for (const name of names) {
    const original = target[name];
    if (typeof original !== 'function') continue;
    target[name] = function guardedRead(path, ...rest) {
      assertReadAllowed(`${prefix}.${name}`, path);
      return original.call(this, path, ...rest);
    };
  }
  syncEsm();
}

// ---- write-capable open flag decoding -------------------------------------
function flagPermitsWrite(flags) {
  if (flags === undefined || flags === null) return false; // defaults to 'r'
  if (typeof flags === 'string') return /[wa+]/.test(flags);
  if (typeof flags === 'number') {
    const mask = FS.O_WRONLY | FS.O_RDWR | FS.O_APPEND | FS.O_CREAT | FS.O_TRUNC;
    return (flags & mask) !== 0;
  }
  return true; // unknown flag shape → fail closed
}

const FILE_HANDLE_MUTATORS = [
  'write',
  'writev',
  'writeFile',
  'appendFile',
  'truncate',
  'createWriteStream',
  'chmod',
  'chown',
  'utimes',
  'sync',
  'datasync',
];

function guardFileHandle(handle) {
  for (const name of FILE_HANDLE_MUTATORS) {
    if (typeof handle?.[name] === 'function') {
      handle[name] = function denied() {
        throw new SideEffectDenied(`FileHandle.${name}`);
      };
    }
  }
  return handle;
}

// ---- filesystem mutation ---------------------------------------------------
const FS_MUTATORS = [
  'write', 'writeSync', 'writev', 'writevSync',
  'writeFile', 'writeFileSync', 'appendFile', 'appendFileSync',
  'createWriteStream', 'truncate', 'truncateSync', 'ftruncate', 'ftruncateSync',
  'rename', 'renameSync', 'copyFile', 'copyFileSync', 'cp', 'cpSync',
  'unlink', 'unlinkSync', 'rm', 'rmSync', 'rmdir', 'rmdirSync',
  'mkdir', 'mkdirSync', 'mkdtemp', 'mkdtempSync', 'link', 'linkSync',
  'symlink', 'symlinkSync', 'chmod', 'chmodSync', 'fchmod', 'fchmodSync',
  'lchmod', 'lchmodSync', 'chown', 'chownSync', 'fchown', 'fchownSync',
  'lchown', 'lchownSync', 'utimes', 'utimesSync', 'futimes', 'futimesSync',
  'lutimes', 'lutimesSync',
];

function patchFs() {
  const fs = require('node:fs');
  denyAll(fs, FS_MUTATORS, 'fs');
  guardPathReads(
    fs,
    [
      'access', 'accessSync', 'existsSync', 'lstat', 'lstatSync', 'stat', 'statSync',
      'realpath', 'realpathSync', 'readFile', 'readFileSync', 'readdir', 'readdirSync',
      'opendir', 'opendirSync', 'createReadStream',
    ],
    'fs',
  );

  // Write-capable open only; a read open is allowed but its handle is not writable.
  for (const openName of ['open', 'openSync']) {
    const original = fs[openName];
    if (typeof original === 'function') {
      fs[openName] = function guardedOpen(path, flags, ...rest) {
        if (flagPermitsWrite(flags)) throw new SideEffectDenied(`fs.${openName}`);
        assertReadAllowed(`fs.${openName}`, path);
        return original.call(this, path, flags, ...rest);
      };
    }
  }
  syncEsm();

  const fsp = require('node:fs/promises');
  denyAll(
    fsp,
    [
      'writeFile', 'appendFile', 'truncate', 'rename', 'copyFile', 'cp', 'unlink', 'rm',
      'rmdir', 'mkdir', 'mkdtemp', 'link', 'symlink', 'chmod', 'lchmod', 'chown', 'lchown',
      'utimes', 'lutimes',
    ],
    'fs/promises',
  );
  guardPathReads(
    fsp,
    ['access', 'lstat', 'stat', 'realpath', 'readFile', 'readdir', 'opendir'],
    'fs/promises',
  );
  const originalOpen = fsp.open;
  if (typeof originalOpen === 'function') {
    fsp.open = async function guardedOpen(path, flags, ...rest) {
      if (flagPermitsWrite(flags)) throw new SideEffectDenied('fs/promises.open');
      assertReadAllowed('fs/promises.open', path);
      return guardFileHandle(await originalOpen.call(this, path, flags, ...rest));
    };
  }
  syncEsm();
}

// ---- process / runtime escape ---------------------------------------------
function patchProcessEscape() {
  const cp = require('node:child_process');
  denyAll(
    cp,
    ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'],
    'child_process',
  );

  const cluster = require('node:cluster');
  denyAll(cluster, ['fork'], 'cluster');

  const worker = require('node:worker_threads');
  if (worker && typeof worker.Worker === 'function') {
    worker.Worker = class DeniedWorker {
      constructor() {
        throw new SideEffectDenied('worker_threads.Worker');
      }
    };
    syncEsm();
  }

  if (typeof process.dlopen === 'function') {
    process.dlopen = function denied() {
      throw new SideEffectDenied('process.dlopen');
    };
  }
}

// ---- network / listen ------------------------------------------------------
function patchNetwork() {
  globalThis.fetch = function denied() {
    throw new SideEffectDenied('fetch');
  };

  const net = require('node:net');
  denyAll(net, ['connect', 'createConnection'], 'net');
  if (net?.Server?.prototype && typeof net.Server.prototype.listen === 'function') {
    net.Server.prototype.listen = function denied() {
      throw new SideEffectDenied('net.Server.listen');
    };
  }

  const http = require('node:http');
  denyAll(http, ['request', 'get'], 'http');
  const https = require('node:https');
  denyAll(https, ['request', 'get'], 'https');

  const dgram = require('node:dgram');
  denyAll(dgram, ['createSocket'], 'dgram');
  syncEsm();
}

// ---- Bun companion ---------------------------------------------------------
// NOTE: `Bun.file(...).writer()` and `Bun.file(...).delete()` are deliberately NOT
// patched at runtime: `Bun.file()`/its `writer()` back the runtime's OWN stdout/stderr
// WriteStreams, so wrapping them breaks the very stdio channel this server speaks on.
// Per research §R10 they are covered by import discipline (this package's source never
// imports or references them), which check-deps and the static source audit enforce,
// not by a runtime patch that has no safe injection point. `Bun.write`/`Bun.spawn`/
// `Bun.spawnSync` DO have safe patch points and are trapped here.
function patchBun() {
  if (typeof globalThis.Bun === 'undefined') return;
  const bun = globalThis.Bun;
  try {
    bun.write = function denied() {
      throw new SideEffectDenied('Bun.write');
    };
    bun.spawn = function denied() {
      throw new SideEffectDenied('Bun.spawn');
    };
    bun.spawnSync = function denied() {
      throw new SideEffectDenied('Bun.spawnSync');
    };
  } catch {
    /* Bun globals may be read-only in some builds; the Node traps remain authoritative. */
  }
}

patchFs();
patchProcessEscape();
patchNetwork();
patchBun();
