import { createHash } from 'node:crypto';

export function normalizeSourceBody(sourceBody: string): string {
  const normalizedLines = sourceBody.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return `${normalizedLines.replace(/\n*$/g, '')}\n`;
}

export function fingerprintSourceBody(sourceBody: string): string {
  return createHash('sha256').update(normalizeSourceBody(sourceBody), 'utf8').digest('hex');
}
