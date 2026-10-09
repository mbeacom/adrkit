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
 * The read-only adrkit tools (ADR-0048), the advisory hooks (ADR-0049), and the
 * read-only `decision-board` canvas (ADR-0050) get the same isolation, and all
 * three are optional here so a caller that registers only the workflow and
 * canvas is unchanged. The board is a second entry in `canvases`, built in its
 * own `try`, so a throwing board costs neither the decision-review canvas nor
 * anything else. The hooks reach the canvas only
 * through its in-process `refreshOpen`, and only if the canvas built.
 *
 * There is one `joinSession` and one extension directory on purpose: the app
 * starts one extension process per restored session (measured: 181 loads), so
 * a second directory would double that.
 */

/** What each optional join field registers, for the failure log. @type {Record<string, string>} */
const LABELS = { hooks: 'advisory hooks', tools: 'adrkit tools', canvases: 'decision-review canvas' };
const BOARD_LABEL = 'decision-board canvas';

/** The fields a join attempt can drop. `workflows` and `onEvent` are always kept. */
const OPTIONAL = ['hooks', 'tools', 'canvases'];

/**
 * What a refused join drops next, in order: the optional extras before the
 * canvas, each alone before both, the canvas alone before everything, and the
 * workflow never. A rung that names an absent field drops only what is
 * present; a rung that repeats an earlier one, or would leave nothing but
 * `onEvent`, is skipped. With all three present that is at most six joins.
 */
const LADDER = [['hooks'], ['tools'], ['hooks', 'tools'], ['canvases'], ['hooks', 'tools', 'canvases']];

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
 *   board?: () => unknown,
 *   tools?: () => unknown[],
 *   onEvent?: (event: unknown) => void,
 *   hooks?: (deps: { getSession: () => S | undefined, refreshCanvas: (options?: unknown) => Promise<unknown> }) => Record<string, unknown> | undefined,
 * }} deps
 * @returns {Promise<S>}
 */
export async function register({ defineWorkflow, createCanvas, joinSession, workflow, canvas, board, tools, onEvent, hooks }) {
  /** @type {string[]} */
  const failures = [];
  /** @type {S | undefined} */
  let joined;
  /** The built canvas options, for the hooks' refresh. @type {{ refreshOpen?: (options?: unknown) => Promise<unknown> } | undefined} */
  let canvasOptions;

  /** @type {Record<string, unknown>} */
  const config = {};
  /** The canvases that built, in order; `canvases` is joined only if one did. @type {unknown[]} */
  const canvases = [];
  /** What `canvases` holds, for the failure log. @type {string[]} */
  const canvasNames = [];
  try {
    config['workflows'] = [defineWorkflow(workflow())];
  } catch (error) {
    failures.push(`failed to register the adr-review workflow: ${messageOf(error)}`);
  }
  try {
    // The canvas is built before the session exists, but needs it later for
    // `send` and `rpc.workflow`; the getter is filled in once joined.
    const options = canvas(() => joined);
    canvases.push(createCanvas(options));
    canvasNames.push('decision-review');
    canvasOptions = /** @type {any} */ (options);
  } catch (error) {
    failures.push(`failed to register the ${LABELS['canvases']}: ${messageOf(error)}`);
  }
  if (board) {
    // Read-only and needs no session: it starts nothing and sends nothing.
    try {
      canvases.push(createCanvas(board()));
      canvasNames.push('decision-board');
    } catch (error) {
      failures.push(`failed to register the ${BOARD_LABEL}: ${messageOf(error)}`);
    }
  }
  if (canvases.length > 0) config['canvases'] = canvases;
  /** @type {Record<string, string>} */
  const labels = {
    ...LABELS,
    canvases: canvasNames.length > 1 ? `${canvasNames.join(' and ')} canvases` : `${canvasNames[0] ?? 'decision-review'} canvas`,
  };
  if (tools) {
    try {
      config['tools'] = tools();
    } catch (error) {
      failures.push(`failed to register the ${LABELS['tools']}: ${messageOf(error)}`);
    }
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
      failures.push(`failed to register the ${LABELS['hooks']}: ${messageOf(error)}`);
    }
  }

  // Passed as `onEvent`, which the SDK registers before it issues the join
  // RPC, so events delivered while the join is in flight reach the tools'
  // directory tracking. A throwing handler must not reach the SDK's dispatch.
  // It is not a component, so no rung of the ladder drops it.
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
  // join. Measured on Copilot CLI 1.0.93: an invalid tool definition rejects
  // the whole join, which would take the workflow and the canvas down with it,
  // and a runtime that does not know `canvases` or `hooks` would do the same.
  // So each refusal drops the next rung of LADDER and tries again. The refusal
  // does not say which field it was about, so the log names what the
  // successful join dropped and quotes the refusals, rather than blaming one.
  const present = OPTIONAL.filter((key) => key in config);
  /** @type {string[][]} */
  const rungs = [];
  for (const rung of LADDER) {
    const drop = rung.filter((key) => present.includes(key));
    if (drop.length === 0 || rungs.some((seen) => seen.join() === drop.join())) continue;
    const kept = Object.keys(config).filter((key) => key !== 'onEvent' && !drop.includes(key));
    if (kept.length === 0) continue;
    rungs.push(drop);
  }
  /** @type {string[]} */
  const refusals = [];
  /** @type {unknown} */
  let original;
  for (let index = 0; ; index++) {
    const drop = index === 0 ? [] : /** @type {string[]} */ (rungs[index - 1]);
    try {
      joined = await joinSession(Object.fromEntries(Object.entries(config).filter(([key]) => !drop.includes(key))));
    } catch (error) {
      if (index === 0) original = error;
      refusals.push(messageOf(error));
      // The first refusal is about the full configuration, so it is the one
      // worth surfacing when nothing joins.
      if (index >= rungs.length) throw original;
      continue;
    }
    if (drop.length > 0) {
      failures.push(
        `joined without the ${drop.map((key) => labels[key]).join(' and the ')} after the session refused ` +
          `${refusals.length === 1 ? 'a join' : `${refusals.length} joins`} (${refusals.join('; ')})` +
          // Dropping `hooks` first means a one-off join failure unrelated to
          // any field also turns them off for this session. That is accepted
          // (ADR-0049), but said plainly rather than blamed on the hooks.
          (drop.includes('hooks') ? '; the advisory hooks are off for this session, and they may not have caused it' : ''),
      );
    }
    break;
  }

  for (const failure of failures) {
    // Reporting must not become a second way to take the extension down.
    try {
      await /** @type {any} */ (joined).log(`adrkit: ${failure}`, { level: 'error' });
    } catch {
      // Nothing else can reach the user: stdout is the RPC channel.
    }
  }
  return /** @type {S} */ (joined);
}
