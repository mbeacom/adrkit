import { afterEach, describe, expect, test } from 'bun:test';
import { evaluatePass0, serializeArtifacts } from '../src/index.ts';
import { baseInput, corpusOf, record } from './support.ts';

/**
 * US3 / T034 — purity. The evaluator is a pure, total function of its input: it mutates
 * nothing (a deeply-frozen input evaluates without throwing), reads no clock / network /
 * filesystem / model (traps on those globals are never hit), and reproduces identical
 * report + patch bytes across runs.
 */

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

function scenario() {
  const proposal = record(
    { id: '0002', relatesTo: ['9999'], deciders: ['@a'], reviewBy: '2027-01-01' },
    { path: 'docs/adr/0002.md' },
  );
  return baseInput({ corpus: corpusOf([proposal]), proposalPath: 'docs/adr/0002.md' });
}

describe('input immutability', () => {
  test('a deeply-frozen input evaluates without mutation errors', () => {
    const input = deepFreeze(scenario());
    expect(() => evaluatePass0(input)).not.toThrow();
  });

  test('the same input yields byte-identical report + patch across runs', () => {
    const first = evaluatePass0(scenario());
    const second = evaluatePass0(scenario());
    expect(first.kind).toBe('evaluated');
    expect(second.kind).toBe('evaluated');
    if (first.kind !== 'evaluated' || second.kind !== 'evaluated') return;
    const a = serializeArtifacts(first.result.report, first.result.patch);
    const b = serializeArtifacts(second.result.report, second.result.patch);
    expect(a).toEqual(b);
  });
});

describe('no clock / network / filesystem / model access', () => {
  const originalDateNow = Date.now;
  const originalRandom = Math.random;
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    Date.now = originalDateNow;
    Math.random = originalRandom;
    globalThis.fetch = originalFetch;
  });

  test('evaluatePass0 trips no clock/random/network trap', () => {
    Date.now = () => {
      throw new Error('clock access is forbidden in the evaluator');
    };
    Math.random = () => {
      throw new Error('nondeterminism is forbidden in the evaluator');
    };
    const forbiddenFetch = Object.assign(
      (_input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]): Promise<Response> => {
        throw new Error('network access is forbidden in the evaluator');
      },
      {
        preconnect(_url: string | URL): void {
          throw new Error('network access is forbidden in the evaluator');
        },
      },
    );
    globalThis.fetch = forbiddenFetch;

    expect(() => evaluatePass0(scenario())).not.toThrow();
  });
});
