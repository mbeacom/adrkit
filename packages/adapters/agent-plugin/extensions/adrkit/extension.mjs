/**
 * Registers the advisory `adr-review` dynamic workflow with GitHub Copilot CLI
 * (ADR-0045).
 *
 * This is the only file that imports the Copilot SDK, which the host resolves
 * when it forks the extension; the plugin ships no dependencies. All logic
 * lives in `review.mjs` so it can be tested without the SDK.
 *
 * Location is manifest-coupled: for a `.claude-plugin/plugin.json` plugin,
 * Copilot loads `<plugin-root>/extensions/<dir>/extension.mjs` (measured). The
 * process's working directory is the workspace repository. Never write to
 * stdout here: it carries the JSON-RPC connection, so progress goes through
 * `ctx.log`.
 */

import { defineWorkflow, joinSession } from '@github/copilot-sdk/extension';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { ADR_REVIEW_META, reviewWorkflow, runCommand } from './review.mjs';

const adrReview = defineWorkflow({
  meta: ADR_REVIEW_META,
  run: async (ctx) => {
    const cwd = process.cwd();
    return reviewWorkflow(ctx, {
      run: (command, args) => runCommand(command, args, { cwd, signal: ctx.signal, execFile }),
      env: process.env,
      cwd,
      exists: existsSync,
    });
  },
});

await joinSession({ workflows: [adrReview] });
