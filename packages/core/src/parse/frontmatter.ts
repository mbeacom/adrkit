import { parseDocument } from 'yaml';

export type FrontmatterErrorCode =
  | 'missing-frontmatter'
  | 'unterminated-frontmatter'
  | 'invalid-yaml';

export class FrontmatterError extends Error {
  readonly code: FrontmatterErrorCode;

  constructor(code: FrontmatterErrorCode, message: string) {
    super(message);
    this.name = 'FrontmatterError';
    this.code = code;
  }
}

export interface ParsedFrontmatter {
  data: unknown;
  body: string;
}

function lineContent(source: string, start: number, end: number): string {
  const raw = source.slice(start, end);
  return raw.endsWith('\r') ? raw.slice(0, -1) : raw;
}

export function parseFrontmatter(source: string): ParsedFrontmatter {
  const firstLineEnd = source.indexOf('\n');
  const firstLine = firstLineEnd === -1 ? source : source.slice(0, firstLineEnd);

  if ((firstLine.endsWith('\r') ? firstLine.slice(0, -1) : firstLine) !== '---') {
    throw new FrontmatterError(
      'missing-frontmatter',
      'ADR files must start with a leading --- YAML frontmatter fence',
    );
  }

  if (firstLineEnd === -1) {
    throw new FrontmatterError(
      'unterminated-frontmatter',
      'ADR frontmatter is missing its closing --- fence',
    );
  }

  let lineStart = firstLineEnd + 1;
  while (lineStart <= source.length) {
    const nextNewline = source.indexOf('\n', lineStart);
    const lineEnd = nextNewline === -1 ? source.length : nextNewline;
    if (lineContent(source, lineStart, lineEnd) === '---') {
      const yamlSource = source.slice(firstLineEnd + 1, lineStart);
      const bodyStart = nextNewline === -1 ? source.length : nextNewline + 1;
      const document = parseDocument(yamlSource, { strict: true, prettyErrors: false });
      if (document.errors.length > 0) {
        throw new FrontmatterError(
          'invalid-yaml',
          document.errors.map((error) => error.message).join('; '),
        );
      }
      return { data: document.toJS(), body: source.slice(bodyStart) };
    }

    if (nextNewline === -1) {
      break;
    }
    lineStart = nextNewline + 1;
  }

  throw new FrontmatterError(
    'unterminated-frontmatter',
    'ADR frontmatter is missing its closing --- fence',
  );
}
