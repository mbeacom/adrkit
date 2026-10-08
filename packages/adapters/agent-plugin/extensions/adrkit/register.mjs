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
 * }} deps
 * @returns {Promise<S>}
 */
export async function register({ defineWorkflow, createCanvas, joinSession, workflow, canvas }) {
  /** @type {string[]} */
  const failures = [];
  /** @type {S | undefined} */
  let joined;

  /** @type {Record<string, unknown[]>} */
  const config = {};
  try {
    config['workflows'] = [defineWorkflow(workflow())];
  } catch (error) {
    failures.push(`adr-review workflow: ${messageOf(error)}`);
  }
  try {
    // The canvas is built before the session exists, but needs it later for
    // `send` and `rpc.workflow`; the getter is filled in once joined.
    config['canvases'] = [createCanvas(canvas(() => joined))];
  } catch (error) {
    failures.push(`decision-review canvas: ${messageOf(error)}`);
  }

  try {
    joined = await joinSession(config);
  } catch (error) {
    // Isolating the factories is not enough if the runtime itself refuses the
    // join: one that does not know `canvases` (an older CLI or app runtime)
    // would take the workflow down with it. Retry once without the canvas.
    if (!config['canvases'] || !config['workflows']) throw error;
    failures.push(`decision-review canvas: the session refused it (${messageOf(error)})`);
    joined = await joinSession({ workflows: config['workflows'] });
  }
  for (const failure of failures) {
    // Reporting must not become a second way to take the extension down.
    try {
      await /** @type {any} */ (joined).log(`adrkit: failed to register the ${failure}`, { level: 'error' });
    } catch {
      // Nothing else can reach the user: stdout is the RPC channel.
    }
  }
  return joined;
}
