/** Explicit integration check: never runs implicitly or installs tooling. */
import { strict as assert } from 'node:assert';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { type ExtensionManifest, packageRoot } from './manifest-fixture.ts';

const [specifyArg, adrArg, archiveArg] = process.argv.slice(2);
if (!specifyArg || !adrArg) {
  throw new Error('Usage: bun run test/verify-live.ts /path/to/specify /path/to/adr [extension.zip]');
}
const specify = resolve(specifyArg);
const adr = resolve(adrArg);
assert(existsSync(specify), `missing specify entrypoint: ${specify}`);
assert(existsSync(adr), `missing adr entrypoint: ${adr}`);
const workspace = mkdtempSync(join(tmpdir(), 'adrkit-speckit-live-'));
const project = join(workspace, 'project');
const env = { ...process.env };
for (const key of Object.keys(env)) {
  if (key.startsWith('SPECIFY_') || key.startsWith('ADRKIT_')) delete env[key];
}

async function run(argv: string[], cwd: string, input?: string): Promise<string> {
  const result = Bun.spawn(argv, { cwd, env, stdin: input ? new Blob([input]) : 'ignore', stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, code] = await Promise.all([
    new Response(result.stdout).text(), new Response(result.stderr).text(), result.exited,
  ]);
  assert.equal(code, 0, `${argv.join(' ')} exited ${code}\n${stdout}\n${stderr}`);
  return stdout;
}
function tree(root: string): Record<string, string> {
  const files: Record<string, string> = {};
  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else files[path.slice(root.length)] = Bun.hash(readFileSync(path)).toString(16);
    }
  }
  walk(root);
  return files;
}

await run([specify, 'init', project, '--integration', 'codex', '--integration-options=--skills', '--ignore-agent-tools', '--non-interactive'], workspace);
if (archiveArg) {
  const archive = Bun.file(resolve(archiveArg));
  assert(await archive.exists(), `missing extension archive: ${archiveArg}`);
  // The official URL installer accepts loopback HTTP; no public endpoint or
  // published release is needed to verify its real archive path.
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
    return new URL(request.url).pathname === '/adrkit.zip'
      ? new Response(archive) : new Response('Not found', { status: 404 });
  } });
  try {
    await run([specify, 'extension', 'add', 'adrkit', '--from', `http://127.0.0.1:${server.port}/adrkit.zip`], project, 'y\n');
  } finally {
    server.stop(true);
  }
} else {
  await run([specify, 'extension', 'add', '--dev', packageRoot], project);
}
const info = JSON.parse(await run([specify, 'extension', 'info', 'adrkit', '--json'], project)) as Record<string, unknown>;
assert.equal(info['id'], 'adrkit');
const installed = join(project, '.specify/extensions/adrkit');
// The official installer has validated the manifest; these assertions verify
// that its installed schema and registered hook retain our runtime boundary.
const extension = Bun.YAML.parse(readFileSync(join(installed, 'extension.yml'), 'utf8')) as ExtensionManifest;
const declaredHook = extension.hooks?.['after_plan'];
assert(declaredHook);
assert.equal(declaredHook.optional, true);
assert.equal(declaredHook.command, 'speckit.adrkit.check');
const registration = Bun.YAML.parse(readFileSync(join(project, '.specify/extensions.yml'), 'utf8')) as {
  hooks: { after_plan: Array<{ optional: boolean; command: string }> };
};
assert.equal(registration.hooks.after_plan.length, 1);
const registeredHook = registration.hooks.after_plan[0];
assert(registeredHook);
assert.equal(registeredHook.optional, true);
assert.equal(registeredHook.command, 'speckit.adrkit.check');
for (const name of ['context', 'check', 'draft']) {
  const skillPath = join(project, '.agents/skills', `speckit-adrkit-${name}`, 'SKILL.md');
  assert(existsSync(skillPath), `Codex skill was not registered: ${skillPath}`);
  const skill = readFileSync(skillPath, 'utf8');
  assert(skill.includes(`.specify/extensions/adrkit/scripts/${name}.sh`), `rendered script path absent in ${skillPath}`);
  assert(!skill.includes('{SCRIPT}'), `unrendered script token in ${skillPath}`);
  assert(existsSync(join(installed, 'scripts', `${name}.sh`)));
}
for (const excluded of ['test', 'package.json', 'tsconfig.json', 'node_modules']) {
  assert(!existsSync(join(installed, excluded)), `development artifact installed: ${excluded}`);
}
const feature = join(project, 'specs', '900-selected-by-pointer');
mkdirSync(feature, { recursive: true });
for (const file of ['spec.md', 'plan.md', 'tasks.md']) writeFileSync(join(feature, file), `# ${file}\n`);
const pointer = join(project, '.specify/feature.json');
writeFileSync(pointer, JSON.stringify({ feature_directory: 'specs/900-selected-by-pointer' }) + '\n');
mkdirSync(join(project, 'docs/adr'), { recursive: true });
await run([adr, 'new', 'Fixture decision', '--dir', 'docs/adr', '--json'], project);
env['ADRKIT_CLI'] = adr;
const before = tree(project);
await run(['/bin/sh', join(installed, 'scripts/context.sh'), 'specs/900-selected-by-pointer/plan.md'], project);
await run(['/bin/sh', join(installed, 'scripts/check.sh')], project);
assert.deepEqual(tree(project), before, 'read-only commands mutated the fixture');
const drafted = await run(['/bin/sh', join(installed, 'scripts/draft.sh'), 'Selected feature decision'], project);
const draft = JSON.parse(drafted) as { id: string; path: string };
assert.equal(draft.id, '0002');
assert(readFileSync(resolve(project, draft.path), 'utf8').includes('title: "Selected feature decision"'));
const after = tree(project);
const changed = Object.keys(after).filter((file) => after[file] !== before[file]);
assert.equal(changed.length, 1, 'draft must create exactly one ADR');
assert(changed[0]?.startsWith('/docs/adr/'));
assert.equal(Object.keys(before).filter((file) => !(file in after)).length, 0);
assert.equal(readFileSync(pointer, 'utf8'), JSON.stringify({ feature_directory: 'specs/900-selected-by-pointer' }) + '\n');
console.log(JSON.stringify({ status: 'PASS', project, install: archiveArg ? 'archive' : 'dev', integration: 'codex', skills: 3, feature_resolution: 'feature.json', readonly_mutations: 0, draft_files: changed }, null, 2));
