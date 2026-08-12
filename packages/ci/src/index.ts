import * as core from '@actions/core';
import { context } from '@actions/github';
import { lintCorpus, readSourceMarkersBatch } from '@adrkit/core';
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
  // `action.yml` defaults this input to ${{ github.token }}, so it is normally set.
  // GITHUB_TOKEN is only a fallback for a workflow that blanks the input and exports
  // the variable instead; it is NOT used to identify the token (issue #107/ADR-0026).
  const token = core.getInput('token') || process.env.GITHUB_TOKEN || '';

  if (!context.payload.pull_request) {
    core.info('adrkit: not a pull_request event; nothing to check.');
    return;
  }
  if (!token) {
    core.setFailed('adrkit: no token available; set the `token` input or GITHUB_TOKEN.');
    return;
  }

  const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd();

  await runAction({
    client: createOctokitClient(token),
    dir,
    loadLint: (corpusDir) => lintCorpus({ dir: corpusDir }),
    readMarkers: (paths) => readSourceMarkersBatch(paths, workspace),
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
