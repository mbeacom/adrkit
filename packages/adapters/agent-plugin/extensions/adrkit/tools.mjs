// @ts-check
/**
 * Read-only adrkit tools for GitHub Copilot, registered through
 * `joinSession({ tools })` (ADR-0048).
 *
 * The plugin ships no `.mcp.json` (ADR-0028): Copilot spawns a plugin's MCP
 * servers outside any repository, so the adrkit server exits during
 * `initialize`. An extension process, by contrast, was measured starting in the
 * session's directory, so the extension can offer the same read-only answers as
 * tools. Each one runs one read-only `adr` subcommand with `--json` and returns
 * its report.
 *
 * Kept free of the Copilot SDK like `review.mjs`: the process runner, the
 * environment, the filesystem probe, and the working directory are injected.
 *
 * Three rules shape this file:
 * - What runs is chosen by the environment only (`resolveCli`), never by a
 *   tool argument: a model that has just read untrusted repository text writes
 *   the arguments, and extension code runs outside Copilot's permission prompts.
 * - Every argument is validated here, because the host passes the schema to the
 *   model but does not enforce it. A rejection returns a fixed message chosen by
 *   code; it never echoes the input or any exception text back to the model.
 * - A non-zero `adr` exit with a report is data. `adr` uses 1 for "found
 *   something", with a complete report on stdout.
 */

import { realpathSync } from 'node:fs';
import { isAbsolute, resolve, sep, win32 } from 'node:path';
import { FILES_ECHO_LIMIT, capFiles, checkInBatches, cliOverhead, collectChangedFiles, isSafeBaseRef, resolveCli } from './review.mjs';

/** @import { CommandResult } from './review.mjs' */

/**
 * Measured on Copilot CLI 1.0.93: a name outside `/^[a-zA-Z0-9_-]+$/` makes the
 * runtime refuse the whole join, and a name that collides with a built-in tool
 * fails tool initialization for the entire session. These three do neither.
 */
export const ADR_TOOL_NAMES = /** @type {const} */ (['adr_check', 'adr_explain', 'adr_lint']);

/** Caps on what a caller may pass. Generous for real use, small enough to bound argv. */
export const TOOL_LIMITS = Object.freeze({ maxPaths: 200, maxPathLength: 1024, maxRefLength: 256 });

/**
 * Fixed messages, selected by code. Nothing the caller sent and no exception
 * text is ever interpolated into a tool result (CodeQL `js/stack-trace-exposure`).
 */
const MESSAGES = Object.freeze({
  'args-type': 'Invalid arguments: pass an object.',
  'unknown-key': 'Invalid arguments: an argument this tool does not take was passed. See the tool schema.',
  'paths-type': 'Invalid arguments: paths must be an array of repository-relative path strings.',
  'paths-count': `Invalid arguments: paths must list between 1 and ${TOOL_LIMITS.maxPaths} files.`,
  'paths-and-base': 'Invalid arguments: pass either paths or base, not both.',
  'path-type': 'Invalid arguments: each path must be a non-empty string.',
  'path-absolute': 'Invalid arguments: paths must be relative to the repository root, not absolute.',
  'path-escape': "Invalid arguments: paths must stay inside the repository; a '..' segment is not allowed.",
  'path-option': "Invalid arguments: a path must not start with '-'.",
  'path-control': 'Invalid arguments: a path must not contain control characters.',
  'path-length': `Invalid arguments: a path must be at most ${TOOL_LIMITS.maxPathLength} characters.`,
  'base-invalid':
    `Invalid arguments: base must be a git revision of at most ${TOOL_LIMITS.maxRefLength} characters ` +
    "using letters, digits, and . _ / @ { } ~ ^ -, must not start with '-', and may use '..' only as part of a '...' range.",
  'cli-unresolved':
    'The adr CLI could not be resolved: ADRKIT_CLI is set but nothing exists at that path. ' +
    'Fix ADRKIT_CLI in the environment Copilot was started from.',
  'cli-unavailable':
    'The adr CLI could not be started. Install @adrkit/cli on PATH, or set ADRKIT_CLI ' +
    '(or ADRKIT_ALLOW_REPO_CLI=1 to use ./node_modules/.bin/adr) in the environment Copilot was started from.',
  'git-base-unresolved':
    'git could not list the changed files against the given base. Pass a base that resolves in this repository, or pass paths.',
  'git-no-changes':
    'git could not list any changed files. Either origin/main did not resolve and there are no uncommitted ' +
    'changes against HEAD, or this directory is not a git repository, or git is not available. In a ' +
    'repository, pass a base that resolves or pass paths; otherwise pass paths.',
  'output-too-large': 'adr produced more output than the tool accepts (64 MiB). Narrow the request: fewer paths, or one path at a time.',
  'args-too-long':
    'The command line was too long for this system. Pass fewer or shorter paths per call (a large diff from base can do this too).',
  'cli-killed': 'The adr process was ended by a signal before it exited.',
  'cli-timeout': 'The adr process did not finish within its time limit (120 s), and was ended.',
  'cwd-missing': 'The session directory no longer exists, so nothing was run.',
  'symlink-escape':
    'The corpus directory resolves, through a symbolic link, outside the session repository. Nothing was run.',
  'no-report': 'adr exited without a readable report.',
  'cli-failed': 'adr exited with an unexpected code and no readable report.',
});

/**
 * Does `relative`, resolved against `cwd`, stay inside the session root once
 * symbolic links are followed? The lexical checks cannot see a committed
 * symlink (`docs/adr` -> an outside directory), and the tools run without a
 * permission prompt. A target that does not exist yet reads nothing, so it
 * passes; any other failure to resolve is refused. An unresolvable root
 * leaves nothing to compare against, and the CLI then fails on its own.
 *
 * @param {string} cwd
 * @param {string} relative
 */
export function staysInside(cwd, relative) {
  let root;
  try {
    root = realpathSync.native(cwd);
  } catch {
    return true;
  }
  let real;
  try {
    real = realpathSync.native(resolve(cwd, relative));
  } catch (error) {
    return /** @type {any} */ (error)?.code === 'ENOENT';
  }
  return real === root || real.startsWith(root.endsWith(sep) ? root : root + sep);
}

/** @typedef {keyof typeof MESSAGES} MessageCode */
/** @typedef {{ paths?: string[], base?: string, path?: string, dir?: string }} ToolArgs */
/** @typedef {{ ok: true, args: ToolArgs } | { ok: false, code: MessageCode, index?: number }} Validation */

/** Keys each tool accepts. Anything else is refused, including any attempt to pick the executable. */
const TOOL_KEYS = Object.freeze({
  adr_check: new Set(['paths', 'base', 'dir']),
  adr_explain: new Set(['path', 'dir']),
  adr_lint: new Set(['dir']),
});

// C0, DEL, C1, the line and paragraph separators, and the bidi embedding,
// override, and isolate controls: none belongs in a path, and a bidi control
// makes a path in a report display as something it is not.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/;
/** `C:foo` is drive-relative on Windows: neither absolute nor inside the repository. */
const DRIVE = /^[A-Za-z]:/;

/**
 * Validate one repository-relative path. Lexical on purpose: the CLI matches
 * paths against `affects` patterns and reads a file's first 8 KiB for `@adr`
 * markers, so a path is kept from naming anything outside the worktree.
 *
 * @param {unknown} value
 * @returns {MessageCode | null}
 */
function pathProblem(value) {
  if (typeof value !== 'string' || value.length === 0) return 'path-type';
  if (value.length > TOOL_LIMITS.maxPathLength) return 'path-length';
  if (CONTROL.test(value)) return 'path-control';
  if (isAbsolute(value) || win32.isAbsolute(value) || value.startsWith('\\') || DRIVE.test(value)) return 'path-absolute';
  if (value.split(/[\\/]/).includes('..')) return 'path-escape';
  // After `--` a leading `-` is safe for adr, but `--dir` is not behind `--`,
  // and no real repository path needs one.
  if (value.startsWith('-')) return 'path-option';
  return null;
}

/**
 * Validate a tool's arguments. Never throws; a rejection names a code, and
 * the caller turns that into a fixed message.
 *
 * @param {string} tool One of {@link ADR_TOOL_NAMES}.
 * @param {unknown} raw
 * @returns {Validation}
 */
export function validateToolArgs(tool, raw) {
  const keys = TOOL_KEYS[/** @type {keyof typeof TOOL_KEYS} */ (tool)];
  if (!keys) return { ok: false, code: 'unknown-key' };
  if (raw === undefined || raw === null) raw = {};
  if (typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, code: 'args-type' };
  const input = /** @type {Record<string, unknown>} */ (raw);
  for (const key of Object.keys(input)) {
    if (!keys.has(key)) return { ok: false, code: 'unknown-key' };
  }

  /** @type {ToolArgs} */
  const args = {};

  if (input['paths'] !== undefined) {
    const paths = input['paths'];
    if (!Array.isArray(paths)) return { ok: false, code: 'paths-type' };
    if (paths.length === 0 || paths.length > TOOL_LIMITS.maxPaths) return { ok: false, code: 'paths-count' };
    for (let index = 0; index < paths.length; index++) {
      const code = pathProblem(paths[index]);
      if (code) return { ok: false, code, index };
    }
    args.paths = /** @type {string[]} */ ([...paths]);
  }

  if (tool === 'adr_explain') {
    const code = pathProblem(input['path']);
    if (code) return { ok: false, code };
    args.path = /** @type {string} */ (input['path']);
  }

  if (input['base'] !== undefined) {
    if (args.paths) return { ok: false, code: 'paths-and-base' };
    const base = input['base'];
    if (
      typeof base !== 'string' ||
      base.length === 0 ||
      base.length > TOOL_LIMITS.maxRefLength ||
      !isSafeBaseRef(base)
    ) {
      return { ok: false, code: 'base-invalid' };
    }
    args.base = base;
  }

  if (input['dir'] !== undefined) {
    const code = pathProblem(input['dir']);
    if (code) return { ok: false, code };
    args.dir = /** @type {string} */ (input['dir']);
  }

  return { ok: true, args };
}

/**
 * Tool results must never name a command that writes or ratifies a record: a
 * host model reads an example as an instruction (see the plugin's wiring test).
 * A record's own title or text can contain one, so every string in a result is
 * scrubbed before it is serialized. Matching is tolerant: the separator is any
 * run of whitespace (newlines and tabs included) and format characters
 * (`\p{Cf}`: zero-width spaces and joiners, word joiner, BOM, soft hyphen,
 * bidi marks). Scrubbing the serialized JSON instead would miss a newline,
 * which JSON writes as the two characters `\n`.
 *
 * @param {string} text
 */
export function redactWritingCommands(text) {
  return text.replace(/\badr[\s\p{Cf}]+(?:accept|new|migrate|approve|object|resolve)\b/giu, 'adr [a writing command, omitted]');
}

/**
 * Scrub every string in a value, keys included.
 *
 * @param {unknown} value
 * @returns {unknown}
 */
function scrub(value) {
  if (typeof value === 'string') return redactWritingCommands(value);
  if (Array.isArray(value)) return value.map(scrub);
  if (value !== null && typeof value === 'object') {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const [key, entry] of Object.entries(value)) out[redactWritingCommands(key)] = scrub(entry);
    return out;
  }
  return value;
}

/** Cap on the CLI stderr returned for a usage error. */
const STDERR_LIMIT = 2048;

/**
 * The CLI's own usage-error text, without stack-frame lines and capped. Only
 * an exit of 2 (the CLI's usage-error path) returns it; any other exit could be
 * a crash, whose stderr is a stack with install paths.
 *
 * @param {string} stderr
 */
const usageText = (stderr) => {
  const text = stderr
    .split(/\r?\n/)
    .filter((line) => !/^\s+at /.test(line))
    .join('\n')
    .trim();
  return text.length > STDERR_LIMIT ? `${text.slice(0, STDERR_LIMIT)}…` : text;
};

/**
 * Map a runner rejection to a fixed code. Only the error's `code` and
 * `signal` fields are read, never its message.
 *
 * @param {unknown} error
 * @returns {MessageCode}
 */
function runFailureCode(error) {
  const fields = /** @type {{ code?: unknown, signal?: unknown, missing?: unknown }} */ (error ?? {});
  if (fields.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return 'output-too-large';
  if (fields.code === 'E2BIG' || fields.code === 'ENAMETOOLONG') return 'args-too-long';
  if (fields.code === 'ETIMEDOUT') return 'cli-timeout';
  if (fields.code === 'ENOENT' && fields.missing === 'cwd') return 'cwd-missing';
  if (typeof fields.signal === 'string' && fields.signal.length > 0) return 'cli-killed';
  return 'cli-unavailable';
}

/**
 * @param {Record<string, unknown>} payload
 * @param {'success' | 'failure'} resultType
 */
const resultOf = (payload, resultType) => ({
  textResultForLlm: JSON.stringify(scrub(payload)),
  resultType,
});

/** @param {string} tool @param {MessageCode} code */
const failure = (tool, code) => resultOf({ tool, error: code, message: MESSAGES[code] }, 'failure');

/**
 * A report's `changedFiles` echoes every path it was given; over
 * FILES_ECHO_LIMIT it is capped and the rest counted in `changedFilesOmitted`.
 *
 * @param {unknown} report
 */
function capChangedFiles(report) {
  if (report === null || typeof report !== 'object' || Array.isArray(report)) return report;
  const changed = /** @type {Record<string, unknown>} */ (report)['changedFiles'];
  if (!Array.isArray(changed) || changed.length <= FILES_ECHO_LIMIT) return report;
  const shown = capFiles(changed.filter((file) => typeof file === 'string'));
  return { ...report, changedFiles: shown.files, changedFilesOmitted: changed.length - shown.files.length };
}

/**
 * @typedef {(command: string, args: string[], options: { cwd: string, signal?: AbortSignal }) => Promise<CommandResult>} ToolRunner
 */

/**
 * Build the three tools. Plain `Tool` objects, so no SDK helper is needed.
 *
 * `skipPermission` matches the workflow and the canvas's `refresh`, which run
 * the same environment-chosen CLI on a model-initiated path without a prompt:
 * the executable comes from the environment only, every path is validated, and
 * every subcommand reached here is read-only.
 *
 * @param {{
 *   run: ToolRunner,
 *   env: Record<string, string | undefined>,
 *   exists: (path: string) => boolean,
 *   getCwd: () => string,
 * }} deps `getCwd` is the session directory tracker's `get`
 *   (`session-dir.mjs`): a tool invocation carries no directory, and
 *   `process.cwd()` does not follow `/cd`.
 */
export function createAdrTools({ run, env, exists, getCwd }) {
  /**
   * Run one `adr` subcommand and shape its outcome.
   *
   * @param {string} tool
   * @param {string[]} cliArgs
   * @param {{ cwd: string, signal?: AbortSignal }} options
   * @param {Record<string, unknown>} [extra]
   * @param {string[]} [files] Paths for `adr check`, appended after `cliArgs`
   *   in batches that fit the command-line budget (see `checkInBatches`).
   */
  async function runAdr(tool, cliArgs, options, extra = {}, files) {
    let cli;
    try {
      cli = resolveCli({ env, cwd: options.cwd, exists });
    } catch {
      return failure(tool, 'cli-unresolved');
    }
    /** @type {CommandResult} */
    let result;
    try {
      result = files
        ? await checkInBatches((batchArgs) => run(cli.command, [...cli.args, ...batchArgs], options), cliArgs, files, {
            overhead: cliOverhead(cli),
          })
        : await run(cli.command, [...cli.args, ...cliArgs], options);
    } catch (error) {
      if (options.signal?.aborted) throw new Error('cancelled');
      return failure(tool, runFailureCode(error));
    }
    if (result.exitCode === 0 || result.exitCode === 1) {
      try {
        const report = JSON.parse(result.stdout);
        return resultOf({ tool, exitCode: result.exitCode, ...extra, report: capChangedFiles(report) }, 'success');
      } catch {
        // Falls through: a 0 or 1 without JSON is not a report.
      }
    }
    if (result.exitCode === 2) {
      // The CLI's usage-error path: its own message (a missing corpus
      // directory, a bad flag) tells the caller what to fix.
      return resultOf(
        { tool, exitCode: 2, ...extra, error: 'no-report', message: MESSAGES['no-report'], stderr: usageText(result.stderr) },
        'failure',
      );
    }
    // Anything else may be a crash: a fixed message and the exit code only.
    const code = result.exitCode === 0 || result.exitCode === 1 ? 'no-report' : 'cli-failed';
    return resultOf({ tool, exitCode: result.exitCode, ...extra, error: code, message: MESSAGES[code] }, 'failure');
  }

  /**
   * The corpus directory, computed once so the value that is checked is the
   * value the CLI receives: the argument, else a non-empty `$ADRKIT_DIR`, else
   * `docs/adr`. A directory from the user's own environment is trusted (it may
   * be absolute or outside the repository); one from the tool argument or the
   * default lives in repository content, where a committed symlink could point
   * outside the session root.
   *
   * @param {string | undefined} dir
   */
  const corpusDir = (dir) => {
    const fromEnv = env['ADRKIT_DIR'];
    const value = dir ?? (fromEnv ? fromEnv : 'docs/adr');
    return { value, trusted: dir === undefined && Boolean(fromEnv) };
  };

  /** @param {string | undefined} dir */
  const dirArgs = (dir) => ['--dir', corpusDir(dir).value];

  /**
   * Only the corpus directory is realpath-checked. Corpus discovery keeps
   * regular files only, and the CLI's marker reader refuses any path with a
   * symlink component, so a symlinked file never reads outside the root.
   *
   * @param {string} cwd @param {string | undefined} dir
   */
  const escapes = (cwd, dir) => {
    const corpus = corpusDir(dir);
    return !corpus.trusted && !staysInside(cwd, corpus.value);
  };

  /**
   * @param {string} tool
   * @param {(args: ToolArgs, options: { cwd: string, signal?: AbortSignal }) => Promise<{ textResultForLlm: string, resultType: string }>} body
   */
  const handlerFor = (tool, body) =>
    /** @param {unknown} raw @param {any} invocation */
    async (raw, invocation) => {
      const validation = validateToolArgs(tool, raw);
      if (!validation.ok) return failure(tool, validation.code);
      return body(validation.args, { cwd: getCwd(), signal: invocation?.signal });
    };

  const dirSchema = {
    type: 'string',
    description: 'ADR corpus directory, repository-relative. Default: $ADRKIT_DIR, else docs/adr.',
  };

  return [
    {
      name: 'adr_check',
      description:
        'Read-only. Report which architecture decisions (ADRs) govern a set of changed files, using adrkit: ' +
        'runs `adr check --json` in the session repository. Pass repository-relative `paths`, or a git `base` ' +
        '(the change is `git diff <base>...HEAD`); with neither, the change against origin/main. exitCode 1 ' +
        'with a report means findings, not a failure. Governing records are in report.governing. A change too ' +
        'wide for one command line is checked in batches and the reports merged: a merged report carries ' +
        'batches (the count) and no markerScan, and lists at most 200 changedFiles with changedFilesOmitted.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          paths: {
            type: 'array',
            items: { type: 'string' },
            maxItems: TOOL_LIMITS.maxPaths,
            description: 'Repository-relative paths of the changed files.',
          },
          base: { type: 'string', description: 'Git revision to diff against, e.g. origin/main. Not with paths.' },
          dir: dirSchema,
        },
      },
      skipPermission: true,
      handler: handlerFor('adr_check', async (args, options) => {
        /** @type {{ files: string[], source: string, notes: string[] }} */
        let collected;
        try {
          collected = await collectChangedFiles(
            { files: args.paths, base: args.base },
            (command, gitArgs) => run(command, gitArgs, options),
          );
        } catch {
          if (options.signal?.aborted) throw new Error('cancelled');
          return failure('adr_check', args.base === undefined ? 'git-no-changes' : 'git-base-unresolved');
        }
        if (escapes(options.cwd, args.dir)) return failure('adr_check', 'symlink-escape');
        const shown = capFiles(collected.files);
        const extra = { files: shown.files, filesOmitted: shown.omitted, filesSource: collected.source, notes: collected.notes };
        if (collected.files.length === 0) {
          return resultOf(
            { tool: 'adr_check', exitCode: null, ...extra, notes: [...collected.notes, 'No changed files; nothing was checked.'] },
            'success',
          );
        }
        return runAdr('adr_check', ['check', '--json', ...dirArgs(args.dir), '--'], options, extra, collected.files);
      }),
    },
    {
      name: 'adr_explain',
      description:
        'Read-only. Explain which architecture decisions (ADRs) govern one file, and why, using adrkit: runs ' +
        '`adr explain --json` in the session repository, including inbound `@adr` markers. Pass one ' +
        'repository-relative `path`.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['path'],
        properties: {
          path: { type: 'string', description: 'Repository-relative path of the file to explain.' },
          dir: dirSchema,
        },
      },
      skipPermission: true,
      handler: handlerFor('adr_explain', async (args, options) =>
        escapes(options.cwd, args.dir)
          ? failure('adr_explain', 'symlink-escape')
          : runAdr('adr_explain', ['explain', '--json', ...dirArgs(args.dir), '--', /** @type {string} */ (args.path)], options),
      ),
    },
    {
      name: 'adr_lint',
      description:
        'Read-only. Validate every ADR in the corpus with adrkit: runs `adr lint --json` in the session ' +
        'repository. exitCode 1 with a report means error findings. A record that fails to parse is invisible ' +
        'to adr_check, so lint before trusting an empty check.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: { dir: dirSchema },
      },
      skipPermission: true,
      handler: handlerFor('adr_lint', async (args, options) =>
        escapes(options.cwd, args.dir) ? failure('adr_lint', 'symlink-escape') : runAdr('adr_lint', ['lint', '--json', ...dirArgs(args.dir)], options),
      ),
    },
  ];
}
