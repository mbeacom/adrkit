// @ts-check
/**
 * The extension's SDK wiring, with the SDK passed in so it can be tested.
 *
 * `extension.mjs` imports `@github/copilot-sdk/extension` and hands its
 * functions here. Each registration is built inside its own `try`: an invalid
 * workflow definition was measured to throw at import and take the whole
 * extension down, canvas included, so one failing definition must not cost the
 * other. A failure is reported through `session.log` once the session is
 * joined, because stdout carries the JSON-RPC connection.
 *
 * There is one `joinSession` and one extension directory on purpose: the app
 * starts one extension process per restored session (measured: 181 loads), so
 * a second directory would double that.
 *
 * The read-only adrkit tools (ADR-0048) join the same session. They are
 * optional here so a caller that registers only the workflow and canvas is
 * unchanged.
 */

/** @param {unknown} error */
const messageOf = (error) => (error instanceof Error ? error.message : String(error));

/**
 * @template S
 * @param {{
 *   defineWorkflow: (definition: any) => unknown,
 *   createCanvas: (options: any) => unknown,
 *   joinSession: (config: Record<string, unknown>) => Promise<S>,
 *   workflow: () => unknown,
 *   canvas: (getSession: () => S | undefined) => unknown,
 *   tools?: () => unknown[],
 *   onEvent?: (event: unknown) => void,
 * }} deps
 * @returns {Promise<S>}
 */
export async function register({ defineWorkflow, createCanvas, joinSession, workflow, canvas, tools, onEvent }) {
  /** @type {string[]} */
  const failures = [];
  /** @type {S | undefined} */
  let joined;

  /** @type {Record<string, unknown>} */
  const config = {};
  try {
    config['workflows'] = [defineWorkflow(workflow())];
  } catch (error) {
    failures.push(`failed to register the adr-review workflow: ${messageOf(error)}`);
  }
  try {
    // The canvas is built before the session exists, but needs it later for
    // `send` and `rpc.workflow`; the getter is filled in once joined.
    config['canvases'] = [createCanvas(canvas(() => joined))];
  } catch (error) {
    failures.push(`failed to register the decision-review canvas: ${messageOf(error)}`);
  }

  if (tools) {
    try {
      config['tools'] = tools();
    } catch (error) {
      failures.push(`failed to register the adrkit tools: ${messageOf(error)}`);
    }
  }

  // Passed as `onEvent`, which the SDK registers before it issues the join
  // RPC, so events delivered while the join is in flight reach the tools'
  // directory tracking. A throwing handler must not reach the SDK's dispatch.
  if (onEvent) {
    config['onEvent'] = (/** @type {unknown} */ event) => {
      try {
        onEvent(event);
      } catch {
        // Nothing to report it through that could not itself throw here.
      }
    };
  }

  // Isolating the factories is not enough if the runtime itself refuses the
  // join, so each refusal drops the newest optional piece and tries again, at
  // most three joins in all. Measured on Copilot CLI 1.0.93: an invalid tool
  // definition rejects the whole join, which would take the workflow and the
  // canvas down with it. A runtime that does not know `canvases` (an older CLI
  // or app) would do the same, so the last attempt keeps the workflow alone.
  // The refusal does not say which piece it was about, so the log names what
  // was dropped and quotes the refusals, rather than blaming one piece.
  const { tools: _tools, ...withoutTools } = config;
  /** @type {Array<{ config: Record<string, unknown>, dropped: string[] }>} */
  const attempts = [{ config, dropped: [] }];
  if (config['tools']) attempts.push({ config: withoutTools, dropped: ['adrkit tools'] });
  if (config['canvases'] && config['workflows']) {
    const workflowOnly = { workflows: config['workflows'], ...(config['onEvent'] ? { onEvent: config['onEvent'] } : {}) };
    attempts.push({
      config: workflowOnly,
      dropped: [...(config['tools'] ? ['adrkit tools'] : []), 'decision-review canvas'],
    });
  }
  /** @type {string[]} */
  const refusals = [];
  for (let index = 0; ; index++) {
    const attempt = /** @type {{ config: Record<string, unknown>, dropped: string[] }} */ (attempts[index]);
    try {
      joined = await joinSession(attempt.config);
      if (refusals.length > 0) {
        failures.push(
          `joined without the ${attempt.dropped.join(' and the ')} after the session refused ` +
            `${refusals.length === 1 ? 'a join' : `${refusals.length} joins`} (${refusals.join('; ')})`,
        );
      }
      break;
    } catch (error) {
      if (!attempts[index + 1]) throw error;
      refusals.push(messageOf(error));
    }
  }

  for (const failure of failures) {
    // Reporting must not become a second way to take the extension down.
    try {
      await /** @type {any} */ (joined).log(`adrkit: ${failure}`, { level: 'error' });
    } catch {
      // Nothing else can reach the user: stdout is the RPC channel.
    }
  }
  return joined;
}
