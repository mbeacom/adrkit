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
 * The advisory hooks (ADR-0049) get the same isolation: a hooks factory that
 * throws costs the hooks, never the workflow or the canvas. They reach the
 * canvas only through its in-process `refreshOpen`, and only if the canvas
 * built.
 *
 * There is one `joinSession` and one extension directory on purpose: the app
 * starts one extension process per restored session (measured: 181 loads), so
 * a second directory would double that.
 */

/** What each optional join field registers, for the failure log. @type {Record<string, string>} */
const LABELS = { canvases: 'decision-review canvas', hooks: 'advisory hooks' };

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
 *   hooks?: (deps: { getSession: () => S | undefined, refreshCanvas: (options?: unknown) => Promise<unknown> }) => Record<string, unknown> | undefined,
 * }} deps
 * @returns {Promise<S>}
 */
export async function register({ defineWorkflow, createCanvas, joinSession, workflow, canvas, hooks }) {
  /** @type {string[]} */
  const failures = [];
  /** @type {S | undefined} */
  let joined;
  /** The built canvas options, for the hooks' refresh. @type {{ refreshOpen?: (options?: unknown) => Promise<unknown> } | undefined} */
  let canvasOptions;

  /** @type {Record<string, unknown>} */
  const config = {};
  try {
    config['workflows'] = [defineWorkflow(workflow())];
  } catch (error) {
    failures.push(`adr-review workflow: ${messageOf(error)}`);
  }
  try {
    // The canvas is built before the session exists, but needs it later for
    // `send` and `rpc.workflow`; the getter is filled in once joined.
    const options = canvas(() => joined);
    config['canvases'] = [createCanvas(options)];
    canvasOptions = /** @type {any} */ (options);
  } catch (error) {
    failures.push(`decision-review canvas: ${messageOf(error)}`);
  }
  if (hooks) {
    try {
      const built = hooks({
        getSession: () => joined,
        refreshCanvas: async (/** @type {unknown} */ options) => {
          if (typeof canvasOptions?.refreshOpen === 'function') await canvasOptions.refreshOpen(options);
        },
      });
      // `undefined` is the off switch (ADRKIT_HOOKS=0): nothing is registered.
      if (built) config['hooks'] = built;
    } catch (error) {
      failures.push(`advisory hooks: ${messageOf(error)}`);
    }
  }

  try {
    joined = await joinSession(config);
  } catch (error) {
    // Isolating the factories is not enough if the runtime itself refuses the
    // join: one that does not know `canvases` or `hooks` would take the rest
    // down with it. Retry without the newest optional field first, then the
    // other, then both, and blame exactly what the successful join dropped.
    const ladder = [['hooks'], ['canvases'], ['hooks', 'canvases']].filter(
      (drop) => drop.every((key) => key in config) && Object.keys(config).some((key) => !drop.includes(key)),
    );
    let recovered = false;
    for (const drop of ladder) {
      const retry = Object.fromEntries(Object.entries(config).filter(([key]) => !drop.includes(key)));
      try {
        joined = await joinSession(retry);
      } catch {
        continue;
      }
      for (const key of drop) failures.push(`${LABELS[key]}: the session refused it (${messageOf(error)})`);
      recovered = true;
      break;
    }
    if (!recovered) throw error;
  }
  for (const failure of failures) {
    // Reporting must not become a second way to take the extension down.
    try {
      await /** @type {any} */ (joined).log(`adrkit: failed to register the ${failure}`, { level: 'error' });
    } catch {
      // Nothing else can reach the user: stdout is the RPC channel.
    }
  }
  return /** @type {S} */ (joined);
}
