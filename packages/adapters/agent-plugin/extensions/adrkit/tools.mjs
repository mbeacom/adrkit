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

import { isAbsolute, win32 } from 'node:path';
import { collectChangedFiles, resolveCli } from './review.mjs';

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
    "using letters, digits, and . _ / @ { } ~ ^ -, and must not start with '-'.",
  'cli-unresolved':
    'The adr CLI could not be resolved: ADRKIT_CLI is set but nothing exists at that path. ' +
    'Fix ADRKIT_CLI in the environment Copilot was started from.',
  'cli-unavailable':
    'The adr CLI could not be started. Install @adrkit/cli on PATH, or set ADRKIT_CLI ' +
    '(or ADRKIT_ALLOW_REPO_CLI=1 to use ./node_modules/.bin/adr) in the environment Copilot was started from.',
  'git-unavailable':
    'git could not list the changed files for that base. Pass paths explicitly, or a base that resolves in this repository.',
  'no-report': 'adr exited without a readable report.',
});

/** @typedef {keyof typeof MESSAGES} MessageCode */
/** @typedef {{ paths?: string[], base?: string, path?: string, dir?: string }} ToolArgs */
/** @typedef {{ ok: true, args: ToolArgs } | { ok: false, code: MessageCode, index?: number }} Validation */

/** Keys each tool accepts. Anything else is refused, including any attempt to pick the executable. */
const TOOL_KEYS = Object.freeze({
  adr_check: new Set(['paths', 'base', 'dir']),
  adr_explain: new Set(['path', 'dir']),
  adr_lint: new Set(['dir']),
});

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;
const REF = /^[A-Za-z0-9._/@{}~^-]+$/;

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
  if (isAbsolute(value) || win32.isAbsolute(value) || value.startsWith('\\')) return 'path-absolute';
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
      base.startsWith('-') ||
      !REF.test(base)
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
 * A record's own title or text can contain one, so the result is scrubbed.
 * The replacement contains no quote or backslash, so JSON stays valid.
 *
 * @param {string} text
 */
export function redactWritingCommands(text) {
  return text.replace(/\badr(\s+)(accept|new|migrate)\b/gi, 'adr$1[a writing command, omitted]');
}

/** @param {string} text */
const clip = (text) => (text.length > 4000 ? `${text.slice(0, 4000)}…` : text);

/**
 * @param {Record<string, unknown>} payload
 * @param {'success' | 'failure'} resultType
 */
const resultOf = (payload, resultType) => ({
  textResultForLlm: redactWritingCommands(JSON.stringify(payload)),
  resultType,
});

/** @param {string} tool @param {MessageCode} code */
const failure = (tool, code) => resultOf({ tool, error: code, message: MESSAGES[code] }, 'failure');

/**
 * Follow the session's working directory.
 *
 * Measured on Copilot CLI 1.0.93 with a headless SDK host: a tool invocation
 * carries no directory (its keys are sessionId, toolCallId, toolName,
 * arguments, availableTools, traceparent, tracestate, signal), and the
 * extension's `process.cwd()` is the session directory at start but does not
 * move when the session's directory changes (`metadata.setWorkingDirectory`,
 * what `/cd` uses). The extension does receive `session.context_changed` with
 * the new `cwd`, so that event is the live source.
 *
 * @param {string} initial
 */
export function trackWorkingDirectory(initial) {
  let current = initial;
  return {
    get: () => current,
    /** @param {{ on: (type: string, handler: (event: any) => void) => unknown }} session */
    attach(session) {
      session.on('session.context_changed', (event) => {
        const cwd = event?.data?.cwd;
        // The runtime validates the target as an existing absolute path; a value
        // that is not one is ignored rather than trusted.
        if (typeof cwd === 'string' && isAbsolute(cwd)) current = cwd;
      });
    },
  };
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
 * }} deps
 */
export function createAdrTools({ run, env, exists, getCwd }) {
  /**
   * Run one `adr` subcommand and shape its outcome.
   *
   * @param {string} tool
   * @param {string[]} cliArgs
   * @param {{ cwd: string, signal?: AbortSignal }} options
   * @param {Record<string, unknown>} [extra]
   */
  async function runAdr(tool, cliArgs, options, extra = {}) {
    let cli;
    try {
      cli = resolveCli({ env, cwd: options.cwd, exists });
    } catch {
      return failure(tool, 'cli-unresolved');
    }
    /** @type {CommandResult} */
    let result;
    try {
      result = await run(cli.command, [...cli.args, ...cliArgs], options);
    } catch {
      if (options.signal?.aborted) throw new Error('cancelled');
      return failure(tool, 'cli-unavailable');
    }
    if (result.exitCode === 0 || result.exitCode === 1) {
      try {
        const report = JSON.parse(result.stdout);
        return resultOf({ tool, exitCode: result.exitCode, ...extra, report }, 'success');
      } catch {
        // Falls through: a 0 or 1 without JSON is not a report.
      }
    }
    // The CLI's own stderr (usage errors, a missing corpus directory) is
    // subprocess output, not exception text, and tells the caller what to fix.
    return resultOf(
      { tool, exitCode: result.exitCode, ...extra, message: MESSAGES['no-report'], stderr: clip(result.stderr.trim()) },
      'failure',
    );
  }

  /** @param {string | undefined} dir */
  const dirArgs = (dir) => {
    const chosen = dir ?? env['ADRKIT_DIR'];
    return chosen ? ['--dir', chosen] : [];
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
        'with a report means findings, not a failure. Governing records are in report.governing.',
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
          return failure('adr_check', 'git-unavailable');
        }
        const extra = { files: collected.files, filesSource: collected.source, notes: collected.notes };
        if (collected.files.length === 0) {
          return resultOf(
            { tool: 'adr_check', exitCode: null, ...extra, notes: [...collected.notes, 'No changed files; nothing was checked.'] },
            'success',
          );
        }
        return runAdr('adr_check', ['check', '--json', ...dirArgs(args.dir), '--', ...collected.files], options, extra);
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
      handler: handlerFor('adr_explain', (args, options) =>
        runAdr('adr_explain', ['explain', '--json', ...dirArgs(args.dir), '--', /** @type {string} */ (args.path)], options),
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
      handler: handlerFor('adr_lint', (args, options) => runAdr('adr_lint', ['lint', '--json', ...dirArgs(args.dir)], options)),
    },
  ];
}
