import { describe, expect, test } from 'bun:test';
import { createPresentation, stripAnsi } from '../src/presentation.ts';

describe('presentation styling', () => {
  test('auto colors only terminal-facing streams', () => {
    const presentation = createPresentation({ colorMode: 'auto', stdoutIsTTY: true, stderrIsTTY: false, noColor: false });

    expect(presentation.stdout.enabled).toBe(true);
    expect(presentation.stderr.enabled).toBe(false);
    expect(presentation.stdout.heading('Heading')).not.toBe('Heading');
    expect(stripAnsi(presentation.stdout.heading('Heading'))).toBe('Heading');
    expect(presentation.stderr.heading('Heading')).toBe('Heading');
  });

  test('NO_COLOR disables auto even when a stream is a tty', () => {
    const presentation = createPresentation({ colorMode: 'auto', stdoutIsTTY: true, stderrIsTTY: true, noColor: true });

    expect(presentation.stdout.enabled).toBe(false);
    expect(presentation.stderr.enabled).toBe(false);
    expect(presentation.stdout.status('accepted')).toBe('accepted');
    expect(presentation.stderr.status('warn')).toBe('warn');
  });

  test('explicit color always and never override terminal detection', () => {
    const always = createPresentation({ colorMode: 'always', stdoutIsTTY: false, stderrIsTTY: false, noColor: true });
    const never = createPresentation({ colorMode: 'never', stdoutIsTTY: true, stderrIsTTY: true, noColor: false });

    expect(always.stdout.enabled).toBe(true);
    expect(always.stderr.enabled).toBe(true);
    expect(always.stdout.label('checked:')).toContain('\u001b[');
    expect(stripAnsi(always.stdout.label('checked:'))).toBe('checked:');

    expect(never.stdout.enabled).toBe(false);
    expect(never.stderr.enabled).toBe(false);
    expect(never.stderr.label('checked:')).toBe('checked:');
  });
});
