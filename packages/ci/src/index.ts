import * as core from '@actions/core';
import { context } from '@actions/github';
import { lintCorpus } from '@adrkit/core';
import { runAction } from './action.ts';
import { extractChanges } from './changed-files.ts';
import { createOctokitClient } from './github.ts';

/**
 * The `@adrkit/ci` Action entrypoint. Reads inputs (`dir`, `token`), wires the real
 * GitHub client + corpus loader, and runs the neutral orchestration. Read-only and
 * comment-only — no database, no approval (ADR-0004/FR-011). Runs with only the
 * default `GITHUB_TOKEN`.
 */
async function main(): Promise<void> {
  const dir = core.getInput('dir') || 'docs/adr';
  const providedToken = core.getInput('token');
  const runnerToken = process.env.GITHUB_TOKEN ?? '';
  const token = providedToken || runnerToken;

  if (!context.payload.pull_request) {
    core.info('adrkit: not a pull_request event; nothing to check.');
    return;
  }
  if (!token) {
    core.setFailed('adrkit: no token available; set the `token` input or GITHUB_TOKEN.');
    return;
  }

  // Only treat the token as the default GITHUB_TOKEN (whose comments are authored by
  // github-actions[bot]) when it matches the runner's GITHUB_TOKEN. Absent that signal
  // we do not assume the bot identity, so a custom/App token never adopts a foreign
  // comment (it creates its own instead).
  const isDefaultToken = runnerToken !== '' && token === runnerToken;

  await runAction({
    client: createOctokitClient(token, isDefaultToken),
    dir,
    loadLint: (corpusDir) => lintCorpus({ dir: corpusDir }),
    extract: extractChanges,
    log: {
      info: (message) => core.info(message),
      notice: (message) => core.notice(message),
      warning: (message) => core.warning(message),
      setFailed: (message) => core.setFailed(message),
    },
  });
}

await main().catch((error) => {
  core.setFailed(error instanceof Error ? error.message : String(error));
});
