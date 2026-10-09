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
 * workflow and the tools start from `process.cwd()`, measured to be the
 * session's directory at fork, and follow `session.context_changed` through
 * one shared tracker (`session-dir.mjs`, observed via `onEvent`, which is
 * registered before the join RPC), because a tool invocation carries no
 * directory and `process.cwd()` does not move when the session's does
 * (measured on 1.0.93). The canvas takes its directory from each request's
 * session context instead, because the app's runtime runs from `/`; the hooks
 * take it from each hook input.
 * Never write to stdout here: it carries the JSON-RPC connection, so progress
 * goes through `ctx.log` and `session.log`.
 */

import { CanvasError, createCanvas, defineWorkflow, joinSession } from '@github/copilot-sdk/extension';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createDecisionReviewCanvas } from './canvas.mjs';
import { createAdvisoryHooks } from './hooks.mjs';
import { register } from './register.mjs';
import { createReviewWorkflow, runCommand } from './review.mjs';
import { trackWorkingDirectory } from './session-dir.mjs';
import { createAdrTools } from './tools.mjs';

const sessionDir = trackWorkingDirectory(process.cwd());

await register({
  defineWorkflow,
  createCanvas,
  joinSession,
  workflow: () =>
    createReviewWorkflow({
      run: (command, args, { cwd, signal }) => runCommand(command, args, { cwd, signal, spawn }),
      env: process.env,
      exists: existsSync,
      getCwd: sessionDir.get,
    }),
  canvas: (getSession) =>
    createDecisionReviewCanvas({
      run: (command, args, { cwd, signal }) => runCommand(command, args, { cwd, signal, spawn }),
      env: process.env,
      exists: existsSync,
      getSession,
      makeError: (code, message) => new CanvasError(code, message),
    }),
  tools: () =>
    createAdrTools({
      run: (command, args, { cwd, signal }) => runCommand(command, args, { cwd, signal, spawn }),
      env: process.env,
      exists: existsSync,
      getCwd: sessionDir.get,
    }),
  onEvent: sessionDir.observe,
  // Hooks take their directory from each hook input, like the canvas, and
  // return undefined (registering nothing) when ADRKIT_HOOKS=0.
  hooks: ({ getSession, refreshCanvas }) =>
    createAdvisoryHooks({
      run: (command, args, { cwd, signal }) => runCommand(command, args, { cwd, signal, spawn }),
      env: process.env,
      exists: existsSync,
      getSession,
      refreshCanvas,
    }),
});
