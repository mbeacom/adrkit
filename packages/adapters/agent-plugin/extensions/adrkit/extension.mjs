/**
 * Registers the advisory `adr-review` dynamic workflow (ADR-0045), the
 * read-only `decision-review` canvas (ADR-0046), the read-only `adr_check`,
 * `adr_explain`, and `adr_lint` tools (ADR-0048), and the advisory session
 * hooks (ADR-0049) with GitHub Copilot.
 *
 * This is the only file that imports the Copilot SDK, which the host resolves
 * when it forks the extension; the plugin ships no dependencies. All logic
 * lives in `review.mjs`, `canvas.mjs`, `tools.mjs`, and `hooks.mjs`, and the
 * registration itself in `register.mjs`, so each can be tested without the SDK.
 *
 * Location is manifest-coupled: for a `.claude-plugin/plugin.json` plugin,
 * Copilot loads `<plugin-root>/extensions/<dir>/extension.mjs` (measured). The
 * workflow runs in the process's working directory, measured to be the
 * workspace repository under the CLI; the canvas takes its directory from each
 * request's session context instead, because the app's runtime runs from `/`.
 * The tools start from `process.cwd()` and follow `session.context_changed`
 * (through `onEvent`, registered before the join RPC),
 * because a tool invocation carries no directory and `process.cwd()` does not
 * move when the session's does (measured on 1.0.93).
 * Never write to stdout here: it carries the JSON-RPC connection, so progress
 * goes through `ctx.log` and `session.log`.
 */

import { CanvasError, createCanvas, defineWorkflow, joinSession } from '@github/copilot-sdk/extension';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createDecisionReviewCanvas } from './canvas.mjs';
import { createAdvisoryHooks } from './hooks.mjs';
import { register } from './register.mjs';
import { ADR_REVIEW_META, reviewWorkflow, runCommand } from './review.mjs';
import { createAdrTools, trackWorkingDirectory } from './tools.mjs';

const toolsCwd = trackWorkingDirectory(process.cwd());

await register({
  defineWorkflow,
  createCanvas,
  joinSession,
  workflow: () => ({
    meta: ADR_REVIEW_META,
    run: async (/** @type {any} */ ctx) => {
      const cwd = process.cwd();
      return reviewWorkflow(ctx, {
        run: (command, args) => runCommand(command, args, { cwd, signal: ctx.signal, execFile }),
        env: process.env,
        cwd,
        exists: existsSync,
      });
    },
  }),
  canvas: (getSession) =>
    createDecisionReviewCanvas({
      run: (command, args, { cwd, signal }) => runCommand(command, args, { cwd, signal, execFile }),
      env: process.env,
      exists: existsSync,
      getSession,
      makeError: (code, message) => new CanvasError(code, message),
    }),
  tools: () =>
    createAdrTools({
      run: (command, args, { cwd, signal }) => runCommand(command, args, { cwd, signal, execFile }),
      env: process.env,
      exists: existsSync,
      getCwd: toolsCwd.get,
    }),
  onEvent: toolsCwd.observe,
  // Hooks take their directory from each hook input, like the canvas, and
  // return undefined (registering nothing) when ADRKIT_HOOKS=0.
  hooks: ({ getSession, refreshCanvas }) =>
    createAdvisoryHooks({
      run: (command, args, { cwd, signal }) => runCommand(command, args, { cwd, signal, execFile }),
      env: process.env,
      exists: existsSync,
      getSession,
      refreshCanvas,
    }),
});
