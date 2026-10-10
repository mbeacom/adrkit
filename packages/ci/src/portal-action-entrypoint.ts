/**
 * @adrkit/ci — the decision-portal Action entrypoint (ADR-0054 clause 2). This is the ONLY
 * portal file that imports `@actions/core` / `@actions/github`; the behavior is
 * `runPortalAction` in `portal-action.ts`, which takes these as arguments.
 *
 * `github.context` reads the event payload from `GITHUB_EVENT_PATH` once, at import. The
 * Action holds no token and constructs no GitHub client.
 */

import * as core from '@actions/core';
import { context } from '@actions/github';
import { generatePortal } from '@adrkit/portal/src/generate.ts';
import { CRASH_MESSAGE, runPortalAction } from './portal-action.ts';

await runPortalAction({
  inputs: {
    dir: core.getInput('dir'),
    out: core.getInput('out'),
    baseUrl: core.getInput('base-url'),
    asOf: core.getInput('as-of'),
    publishPrivate: core.getInput('publish-private'),
  },
  repository: context.payload.repository,
  workspace: process.env.GITHUB_WORKSPACE ?? process.cwd(),
  generate: generatePortal,
  core,
}).catch(() => {
  core.setFailed(CRASH_MESSAGE);
});
