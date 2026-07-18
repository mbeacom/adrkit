import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export const TEST_OUTPUT_ROOT = resolve(process.cwd(), '.test-output');

export async function resetTestDir(name: string): Promise<string> {
  const path = resolve(TEST_OUTPUT_ROOT, name);
  await rm(path, { recursive: true, force: true });
  await mkdir(path, { recursive: true });
  return path;
}

export async function cleanupTestDir(name: string): Promise<void> {
  await rm(resolve(TEST_OUTPUT_ROOT, name), { recursive: true, force: true });
}

export async function writeText(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf8');
}

export function recordMarkdown(id: string, title = `Use test decision ${id}`, extra = ''): string {
  return `---
schemaVersion: 0.1.0
id: "${id}"
title: ${title}
status: draft
date: 2026-07-18
deciders: []
tags: []
scope: component
reversibility: unknown
blastRadius: component
relatesTo: []
affects: []
provenance:
  authoredBy: human
${extra}---

# ADR-${id}: ${title}
`;
}
