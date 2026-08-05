/**
 * T047 — `duplicate-yaml-key` and `invalid-yaml-syntax` emerge as **two distinct
 * outcomes**, never collapsed into one.
 *
 * Expected values come from `research.md` R8 (the `yaml` package's `uniqueKeys`
 * default), `data-model.md` §3's three `parseOutcome` values, and §8's trigger
 * enumeration. Nothing is derived by running the code under test.
 *
 * ADR-0016 evidence:
 * `specs/010-catalog-backstage/evidence/negative-cases/yaml-read/`.
 */

import { describe, expect, test } from 'bun:test';
import {
  DUPLICATE_KEY_CODE,
  readAnnotationNode,
  readDescriptorDocuments,
} from '../src/descriptor/read.ts';

const VALID = [
  'apiVersion: backstage.io/v1alpha1',
  'kind: Component',
  'metadata:',
  '  name: payments',
  '',
].join('\n');

function only(text: string, path = 'catalog-info.yaml') {
  const documents = readDescriptorDocuments(path, text);
  expect(documents).toHaveLength(1);
  return documents[0] as NonNullable<(typeof documents)[0]>;
}

describe('T047 — a well-formed descriptor parses', () => {
  test('the outcome is `parsed` and the raw fields are carried', () => {
    const document = only(VALID);
    expect(document.parseOutcome).toBe('parsed');
    expect(document.rejection).toBeUndefined();
    expect(document.rawApiVersion).toBe('backstage.io/v1alpha1');
    expect(document.rawKind).toBe('Component');
    expect(document.rawMetadata).toEqual({ name: 'payments' });
  });

  test('a document is addressed by (sourcePath, documentIndexInFile)', () => {
    const documents = readDescriptorDocuments('multi.yaml', `---\nkind: A\n---\nkind: B\n`);
    expect(documents.map((document) => document.documentIndexInFile)).toEqual([0, 1]);
    expect(documents.every((document) => document.sourcePath === 'multi.yaml')).toBe(true);
  });
});

describe('T047 — the two failure outcomes are distinct', () => {
  test('a repeated top-level key is `duplicate-yaml-key`', () => {
    const document = only('kind: Component\nkind: API\n');
    expect(document.parseOutcome).toBe('duplicate-yaml-key');
    expect(document.rejection?.reason).toBe('duplicate-yaml-key');
    expect(document.rejection?.triggerClass).toBe('duplicate-yaml-key');
    expect(document.rejection?.detail).toContain(DUPLICATE_KEY_CODE);
  });

  test('a repeated nested key is also `duplicate-yaml-key`', () => {
    // R8 relies on the library reporting a duplicate "at any level".
    const document = only('metadata:\n  name: a\n  name: b\n');
    expect(document.parseOutcome).toBe('duplicate-yaml-key');
    expect(document.rejection?.reason).toBe('duplicate-yaml-key');
  });

  test('an unterminated quoted scalar is `invalid-yaml-syntax`, not a duplicate', () => {
    const document = only('kind: "Component\n');
    expect(document.parseOutcome).toBe('yaml-parse-error');
    expect(document.rejection?.reason).toBe('invalid-yaml-syntax');
    expect(document.rejection?.triggerClass).toBe('invalid-yaml-syntax');
  });

  test('a malformed flow collection is `invalid-yaml-syntax`', () => {
    const document = only('kind: [unterminated\n');
    expect(document.parseOutcome).toBe('yaml-parse-error');
    expect(document.rejection?.reason).toBe('invalid-yaml-syntax');
  });

  test('the two reasons, and the two trigger classes, are different values', () => {
    const duplicate = only('kind: Component\nkind: API\n');
    const syntax = only('kind: "Component\n');
    expect(duplicate.rejection?.reason).not.toBe(syntax.rejection?.reason);
    expect(duplicate.rejection?.triggerClass).not.toBe(syntax.rejection?.triggerClass);
    expect(duplicate.parseOutcome).not.toBe(syntax.parseOutcome);
  });

  test('a duplicate key in the second document does not contaminate the first', () => {
    const documents = readDescriptorDocuments('multi.yaml', '---\nkind: A\n---\nkind: B\nkind: C\n');
    expect(documents[0]?.parseOutcome).toBe('parsed');
    expect(documents[1]?.parseOutcome).toBe('duplicate-yaml-key');
  });
});

describe('T047 — a duplicate key still resolves to a value, and that is the trap', () => {
  test('the reported outcome is the error, never the last-wins value', () => {
    // `yaml` resolves `kind: Component` / `kind: API` last-wins *and* records
    // DUPLICATE_KEY. An implementation reading `toJSON()` without checking
    // `errors` would see a plausible descriptor and never notice.
    const document = only('kind: Component\nkind: API\n');
    expect(document.parseOutcome).toBe('duplicate-yaml-key');
    expect(document.raw).toBeUndefined();
    expect(document.rawKind).toBeUndefined();
  });
});

describe('T047 — `uniqueKeys` is left at its library default', () => {
  test('the module never names `uniqueKeys`', async () => {
    // R8: the design "does not introduce a custom duplicate-key scanner"; naming
    // the option here would invite someone to make it configurable, and
    // `uniqueKeys: false` would silently remove the duplicate outcome entirely.
    const source = await Bun.file(
      new URL('../src/descriptor/read.ts', import.meta.url),
    ).text();
    const code = source.replace(/\/\*\*[\s\S]*?\*\//gu, '').replace(/\/\/[^\n]*/gu, '');
    expect(code).not.toContain('uniqueKeys');
  });
});

describe('T047 — reading the annotation node', () => {
  const withAnnotation = (value: string) =>
    only(
      [
        'apiVersion: backstage.io/v1alpha1',
        'kind: Component',
        'metadata:',
        '  name: payments',
        '  annotations:',
        `    adrkit.io/owned-paths: ${value}`,
        '',
      ].join('\n'),
    );

  test('a present string scalar is reported present, with a string value', () => {
    const node = readAnnotationNode(withAnnotation("'[\"packages/**\"]'"), 'adrkit.io/owned-paths');
    expect(node.present).toBe(true);
    expect(typeof node.value).toBe('string');
  });

  test('a YAML sequence arrives as an array, so a `typeof` check can reject it', () => {
    // This is what makes `owned-paths-annotation.md` §1 step 2 a real check rather
    // than a formality: the caller must be able to receive a non-string.
    const node = readAnnotationNode(withAnnotation('["[]"]'), 'adrkit.io/owned-paths');
    expect(node.present).toBe(true);
    expect(Array.isArray(node.value)).toBe(true);
    expect(typeof node.value).not.toBe('string');
  });

  test('an absent annotation is reported absent', () => {
    const node = readAnnotationNode(only(VALID), 'adrkit.io/owned-paths');
    expect(node.present).toBe(false);
  });

  test('presence is an explicit discriminant, not `value !== undefined`', () => {
    // `owned-paths-annotation.md` §1 step 1: presence is "never inferred from
    // whether a raw value happens to be `undefined`". A YAML key with no value is
    // present and null.
    const node = readAnnotationNode(withAnnotation(''), 'adrkit.io/owned-paths');
    expect(node.present).toBe(true);
    expect(node.value).toBeNull();
  });
});
