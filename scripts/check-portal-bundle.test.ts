import { describe, expect, test } from 'bun:test';
import { inspectBundle, lintRecordCount, REQUIRED_FILES } from './check-portal-bundle.ts';

const HTML =
  '<link rel="stylesheet" href="./app.css"><script type="module" src="./page/app.mjs"></script>' +
  '<a href="#/">Records</a><a href="#/graph">Graph</a>';

function data(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ version: '1', commit: 'abc', records: [{ id: '0001' }, { id: '0002' }], issues: [], ...overrides });
}

function bundle(files: Record<string, string | null> = {}) {
  const all: Record<string, string | null> = {
    'index.html': HTML,
    'app.css': 'body{}',
    'page/app.mjs': 'export {};',
    'vendor/board-layout.mjs': 'export {};',
    'vendor/board-view.mjs': 'export {};',
    'portal-data.json': data(),
    ...files,
  };
  return (rel: string) => all[rel] ?? null;
}

describe('inspectBundle', () => {
  test('accepts a complete version-1 bundle with the expected record count', () => {
    const report = inspectBundle(bundle(), 2);
    expect(report.problems).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.summary).toBe('version "1", 2 record(s), abc');
  });

  test('fails on a missing directory: every required file is reported', () => {
    expect(inspectBundle(() => null, 2).problems).toEqual(REQUIRED_FILES.map((f) => `${f} is missing from the bundle`));
  });

  test.each(REQUIRED_FILES.map((f) => [f]))('fails when %s is missing', (file) => {
    expect(inspectBundle(bundle({ [file]: null }), 2).problems).toContain(`${file} is missing from the bundle`);
  });

  test('fails on a data file that does not parse', () => {
    expect(inspectBundle(bundle({ 'portal-data.json': '{' }), 2).problems).toEqual(['portal-data.json does not parse as JSON']);
  });

  test.each([['2'], [1], [null], [undefined]])('fails on version %p', (version) => {
    expect(inspectBundle(bundle({ 'portal-data.json': data({ version }) }), 2).problems[0]).toContain('expected "1"');
  });

  test('fails on a record count that differs from adr lint', () => {
    expect(inspectBundle(bundle(), 3).problems).toEqual(['portal-data.json has 2 record(s); adr lint checked 3']);
  });

  test('fails when there is no lint count to compare against', () => {
    expect(inspectBundle(bundle(), null).problems[0]).toContain('no record count from adr lint');
  });

  test('fails on a data file with no records array', () => {
    expect(inspectBundle(bundle({ 'portal-data.json': data({ records: {} }) }), 2).problems).toEqual([
      'portal-data.json has no records array',
    ]);
  });

  // Clause 9: an exit-1 corpus still publishes, and a record that does not parse
  // is counted by lint but cannot be a portal record.
  test('downgrades a count mismatch to a warning when the corpus has error findings', () => {
    const errored = data({ issues: [{ code: 'frontmatter-parse', severity: 'error', message: 'x', path: 'docs/adr/0003-x.md' }] });
    const report = inspectBundle(bundle({ 'portal-data.json': errored }), 3);
    expect(report.problems).toEqual([]);
    expect(report.warnings).toHaveLength(1);
  });

  test('a warn-severity issue does not excuse a count mismatch', () => {
    const warned = data({ issues: [{ code: 'x', severity: 'warn', message: 'x', path: null }] });
    expect(inspectBundle(bundle({ 'portal-data.json': warned }), 3).problems).toHaveLength(1);
  });

  // Clause 8: the bundle must load at /decisions/, not only at a domain root.
  test.each([['/app.css'], ['//cdn.example/app.css'], ['https://adrkit.dev/decisions/app.css']])(
    'fails on a non-relative asset reference %p',
    (href) => {
      const html = HTML.replace('./app.css', href);
      expect(inspectBundle(bundle({ 'index.html': html }), 2).problems).toEqual([
        `index.html references "${href}", which is not relative or a hash route; it breaks at a subpath`,
      ]);
    },
  );
});

test('accepts a bare relative reference', () => {
  expect(inspectBundle(bundle({ 'index.html': HTML.replace('./app.css', 'app.css') }), 2).problems).toEqual([]);
});

describe('lintRecordCount', () => {
  test('reads the integer checked field', () => {
    expect(lintRecordCount('{"checked":59,"findings":[]}')).toBe(59);
  });

  test.each([[null], ['not json'], ['{}'], ['{"checked":true}'], ['{"checked":"59"}'], ['{"checked":-1}'], ['{"checked":1.5}'], ['null']])(
    'returns null for %p',
    (text) => {
      expect(lintRecordCount(text)).toBeNull();
    },
  );
});
