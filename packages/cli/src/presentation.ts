export type ColorMode = 'auto' | 'always' | 'never';

export interface PresentationOptions {
  readonly colorMode?: ColorMode;
  readonly stdoutIsTTY?: boolean;
  readonly stderrIsTTY?: boolean;
  readonly noColor?: boolean;
}

export interface StreamStyle {
  readonly enabled: boolean;
  bold(text: string): string;
  dim(text: string): string;
  red(text: string): string;
  yellow(text: string): string;
  green(text: string): string;
  cyan(text: string): string;
  magenta(text: string): string;
  heading(text: string): string;
  label(text: string): string;
  command(text: string): string;
  path(text: string): string;
  note(text: string): string;
  severity(text: string): string;
  status(text: string): string;
  outcome(text: string): string;
}

export interface Presentation {
  readonly stdout: StreamStyle;
  readonly stderr: StreamStyle;
}

const RESET = '\u001b[0m';
const BOLD = '\u001b[1m';
const DIM = '\u001b[2m';
const RED = '\u001b[31m';
const GREEN = '\u001b[32m';
const YELLOW = '\u001b[33m';
const MAGENTA = '\u001b[35m';
const CYAN = '\u001b[36m';

const STYLE_HEADING = [BOLD, CYAN];

let activePresentation = createPresentation();

function colorize(enabled: boolean, codes: readonly string[], text: string): string {
  return enabled ? `${codes.join('')}${text}${RESET}` : text;
}

function normalizeNoColor(value: boolean | undefined): boolean {
  if (value !== undefined) return value;
  return process.env.NO_COLOR !== undefined;
}

function colorEnabled(mode: ColorMode, isTTY: boolean, noColor: boolean): boolean {
  if (mode === 'never') return false;
  if (mode === 'always') return true;
  return isTTY && !noColor;
}

function createStreamStyle(enabled: boolean): StreamStyle {
  return {
    enabled,
    bold: (text: string) => colorize(enabled, [BOLD], text),
    dim: (text: string) => colorize(enabled, [DIM], text),
    red: (text: string) => colorize(enabled, [RED], text),
    yellow: (text: string) => colorize(enabled, [YELLOW], text),
    green: (text: string) => colorize(enabled, [GREEN], text),
    cyan: (text: string) => colorize(enabled, [CYAN], text),
    magenta: (text: string) => colorize(enabled, [MAGENTA], text),
    heading: (text: string) => colorize(enabled, STYLE_HEADING, text),
    label: (text: string) => colorize(enabled, [BOLD], text),
    command: (text: string) => colorize(enabled, [BOLD], text),
    path: (text: string) => colorize(enabled, [CYAN], text),
    note: (text: string) => colorize(enabled, [DIM], text),
    severity: (text: string) => {
      switch (text) {
        case 'error':
          return colorize(enabled, [RED, BOLD], text);
        case 'warn':
          return colorize(enabled, [YELLOW, BOLD], text);
        case 'info':
          return colorize(enabled, [CYAN], text);
        default:
          return colorize(enabled, [BOLD], text);
      }
    },
    status: (text: string) => {
      switch (text) {
        case 'accepted':
        case 'decided':
        case 'within-sla':
        case 'migrated':
          return colorize(enabled, [GREEN, BOLD], text);
        case 'proposed':
        case 'due':
        case 'missing-sla':
        case 'updated':
          return colorize(enabled, [YELLOW, BOLD], text);
        case 'draft':
        case 'not-queued':
        case 'unchanged':
          return colorize(enabled, [DIM], text);
        case 'rejected':
        case 'superseded':
        case 'overdue':
        case 'diverged':
          return colorize(enabled, [RED, BOLD], text);
        case 'deprecated':
        case 'skipped':
          return colorize(enabled, [MAGENTA, BOLD], text);
        case 'escalated':
          return colorize(enabled, [MAGENTA, BOLD], text);
        default:
          return colorize(enabled, [BOLD], text);
      }
    },
    outcome: (text: string) => {
      switch (text) {
        case 'migrated':
          return colorize(enabled, [GREEN, BOLD], text);
        case 'updated':
          return colorize(enabled, [CYAN, BOLD], text);
        case 'unchanged':
          return colorize(enabled, [DIM], text);
        case 'diverged':
          return colorize(enabled, [RED, BOLD], text);
        case 'skipped':
          return colorize(enabled, [YELLOW, BOLD], text);
        default:
          return colorize(enabled, [BOLD], text);
      }
    },
  };
}

export function createPresentation(options: PresentationOptions = {}): Presentation {
  const noColor = normalizeNoColor(options.noColor);
  const mode = options.colorMode ?? 'auto';
  const stdoutIsTTY = options.stdoutIsTTY ?? process.stdout.isTTY === true;
  const stderrIsTTY = options.stderrIsTTY ?? process.stderr.isTTY === true;

  return {
    stdout: createStreamStyle(colorEnabled(mode, stdoutIsTTY, noColor)),
    stderr: createStreamStyle(colorEnabled(mode, stderrIsTTY, noColor)),
  };
}

export function setPresentation(options: PresentationOptions = {}): Presentation {
  activePresentation = createPresentation(options);
  return activePresentation;
}

export function getPresentation(): Presentation {
  return activePresentation;
}

export function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}

export function styleUsageBlock(text: string, style: StreamStyle): string {
  const lines = text.split('\n');
  return lines
    .map((line) => {
      if (line.startsWith('Usage:')) return style.heading(line);
      if (/^(Commands|Options|Arguments|Examples|Exit codes):$/.test(line)) return style.heading(line);
      if (line.startsWith('  -h, --help')) return `${style.label('  -h, --help')}${line.slice('  -h, --help'.length)}`;
      if (line.startsWith('  -V, --version')) return `${style.label('  -V, --version')}${line.slice('  -V, --version'.length)}`;
      return line;
    })
    .join('\n');
}

export function styleMarkdownReport(text: string, style: StreamStyle): string {
  return text
    .split('\n')
    .map((line) => {
      if (line.startsWith('# ')) return style.heading(line);
      if (line.startsWith('## ')) return style.heading(line);
      if (line.startsWith('### ')) return style.heading(line);
      if (line.startsWith('#### ')) return style.heading(line);
      if (line.startsWith('Corpus fingerprint: ')) {
        return `${style.label('Corpus fingerprint: ')}${line.slice('Corpus fingerprint: '.length)}`;
      }
      if (line.startsWith('*No proposed records found.*')) return style.note(line);
      return line;
    })
    .join('\n');
}
