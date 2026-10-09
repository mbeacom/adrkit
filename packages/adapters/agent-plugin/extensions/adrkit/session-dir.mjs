// @ts-check
/**
 * The session's working directory, followed in one place.
 *
 * Measured on Copilot CLI 1.0.93 with a headless SDK host: a tool invocation
 * carries no directory (its keys are sessionId, toolCallId, toolName,
 * arguments, availableTools, traceparent, tracestate, signal), and the
 * extension's `process.cwd()` is the session directory at start but does not
 * move when the session's directory changes (`metadata.setWorkingDirectory`,
 * what `/cd` uses). The extension does receive `session.context_changed` with
 * the new `cwd`, so that event is the live source.
 *
 * `extension.mjs` builds one tracker and hands `get` to the workflow and the
 * tools. `observe` is passed to `joinSession` as `onEvent`, which the SDK
 * registers before it issues the join RPC, so a change delivered while the join
 * is in flight is not lost. A change before the extension process was forked
 * is already in `process.cwd()`, the initial value.
 *
 * The canvas does not use this: each canvas request carries
 * `ctx.session.workingDirectory`, the documented source. The hooks do not
 * either: each hook input carries its own `workingDirectory`.
 */

import { isAbsolute } from 'node:path';

/**
 * @param {string} initial
 */
export function trackWorkingDirectory(initial) {
  let current = initial;
  return {
    get: () => current,
    /** @param {any} event */
    observe: (event) => {
      if (event?.type !== 'session.context_changed') return;
      const cwd = event?.data?.cwd;
      // The runtime validates the target as an existing absolute path; a value
      // that is not one is ignored rather than trusted.
      if (typeof cwd === 'string' && isAbsolute(cwd)) current = cwd;
    },
  };
}
