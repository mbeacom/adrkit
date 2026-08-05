/**
 * T049 — the four admissibility field validators, each separately attributed.
 *
 * Every expected value below comes from ADR-0015's table (reproduced in `spec.md`
 * FR-016) or from `contracts/admissibility.md`. None is derived by running the code
 * under test.
 *
 * **The four `apiVersion` facts ADR-0015 recorded as directly executed** against
 * the pin — "a 243-character `apiVersion` prefix passes while a 254-character one,
 * an over-63 label, and a two-separator value all fail" — are pinned below as their
 * own test, because they are the only admissibility expectations in the whole
 * document that were obtained by *running* the pinned sources rather than by
 * reading them.
 *
 * **The warrant.** Each assertion states what a pure validator predicate returns.
 * None states what Backstage as a running system does; this feature has never run
 * one.
 *
 * ADR-0016 evidence:
 * `specs/010-catalog-backstage/evidence/negative-cases/admissibility-validators/`.
 */

import { describe, expect, test } from 'bun:test';
import {
  ADMISSIBILITY_FIELDS,
  DNS_LABEL_MAX,
  DNS_SUBDOMAIN_MAX,
  FIELD_MAX,
  PINNED_BACKSTAGE_COMMIT,
  PINNED_VALIDATOR_BINDINGS,
  VALIDATORS,
  VALIDATOR_FIELDS,
  validateApiVersion,
  validateEntityName,
  validateKind,
  validateNamespace,
} from '../src/admissibility/validators.ts';

describe('T049 — the table has exactly four rows, bound as ADR-0015 binds them', () => {
  test('four fields, in ADR-0015\u2019s table order', () => {
    expect([...ADMISSIBILITY_FIELDS]).toEqual([
      'apiVersion',
      'kind',
      'metadata.name',
      'metadata.namespace',
    ]);
  });

  test('four validators, one per field', () => {
    expect(Object.keys(VALIDATORS).sort()).toEqual([
      'validateApiVersion',
      'validateEntityName',
      'validateKind',
      'validateNamespace',
    ]);
    expect(VALIDATOR_FIELDS).toEqual({
      validateApiVersion: 'apiVersion',
      validateKind: 'kind',
      validateEntityName: 'metadata.name',
      validateNamespace: 'metadata.namespace',
    });
  });

  test('each validator records the pinned binding it reproduces', () => {
    expect(PINNED_VALIDATOR_BINDINGS.validateApiVersion).toBe(
      'isValidApiVersion \u2192 CommonValidatorFunctions.isValidPrefixAndOrSuffix',
    );
    expect(PINNED_VALIDATOR_BINDINGS.validateKind).toBe('isValidKind');
    expect(PINNED_VALIDATOR_BINDINGS.validateEntityName).toBe(
      'isValidEntityName \u2192 KubernetesValidatorFunctions.isValidObjectName',
    );
    expect(PINNED_VALIDATOR_BINDINGS.validateNamespace).toBe(
      'isValidNamespace \u2192 KubernetesValidatorFunctions.isValidNamespace \u2192 CommonValidatorFunctions.isValidDnsLabel',
    );
  });

  test('the pin is ADR-0012\u2019s commit, carried unchanged', () => {
    expect(PINNED_BACKSTAGE_COMMIT).toBe('1121a4facd9e321179d0402c3f355e4a649e84d9');
  });

  test('the bounds are the ones ADR-0015 states', () => {
    expect(FIELD_MAX).toBe(63);
    expect(DNS_LABEL_MAX).toBe(63);
    expect(DNS_SUBDOMAIN_MAX).toBe(253);
  });
});

describe('T049 — `validateApiVersion`', () => {
  test('the four facts ADR-0015 recorded as executed against the pin', () => {
    // "a 243-character `apiVersion` prefix passes while a 254-character one, an
    // over-63 label, and a two-separator value all fail".
    const prefix243 = ['a'.repeat(60), 'b'.repeat(60), 'c'.repeat(60), 'd'.repeat(60)].join('.');
    expect(prefix243).toHaveLength(243);
    expect(validateApiVersion(`${prefix243}/v1`)).toBe(true);

    const prefix254 = [
      'a'.repeat(63),
      'b'.repeat(63),
      'c'.repeat(63),
      'd'.repeat(61),
    ].join('.');
    expect(prefix254).toHaveLength(253);
    const tooLong = `${prefix254}a`;
    expect(tooLong).toHaveLength(254);
    expect(validateApiVersion(`${tooLong}/v1`)).toBe(false);

    const overLongLabel = `${'a'.repeat(64)}.example`;
    expect(validateApiVersion(`${overLongLabel}/v1`)).toBe(false);

    expect(validateApiVersion('backstage.io/v1/alpha')).toBe(false);
  });

  test('a bare `v1` passes without the subdomain rule being consulted (FR-017)', () => {
    expect(validateApiVersion('v1')).toBe(true);
    expect(validateApiVersion('v1alpha1')).toBe(true);
  });

  test('the ordinary Backstage form passes', () => {
    expect(validateApiVersion('backstage.io/v1alpha1')).toBe(true);
    expect(validateApiVersion('backstage.io/v1beta3')).toBe(true);
  });

  test('the suffix predicate is `/^[a-z0-9A-Z]+$/`, so punctuation fails', () => {
    expect(validateApiVersion('backstage.io/v1-alpha')).toBe(false);
    expect(validateApiVersion('backstage.io/v1.alpha')).toBe(false);
    expect(validateApiVersion('backstage.io/')).toBe(false);
    expect(validateApiVersion('')).toBe(false);
  });

  test('the prefix is a DNS subdomain, so uppercase and underscores fail', () => {
    expect(validateApiVersion('Backstage.io/v1alpha1')).toBe(false);
    expect(validateApiVersion('backstage_io/v1alpha1')).toBe(false);
  });

  test('a non-string is not a valid apiVersion', () => {
    for (const value of [undefined, null, 1, true, ['v1'], { v: 1 }]) {
      expect(validateApiVersion(value)).toBe(false);
    }
  });
});

describe('T049 — `validateKind` is `/^[a-zA-Z][a-z0-9A-Z]*$/`, \u226463', () => {
  test('ordinary kinds pass', () => {
    for (const kind of ['Component', 'API', 'Location', 'a', 'Group2']) {
      expect(validateKind(kind)).toBe(true);
    }
  });

  test('a leading digit fails — the first character class excludes it', () => {
    expect(validateKind('1Component')).toBe(false);
  });

  test('punctuation fails', () => {
    for (const kind of ['Com-ponent', 'Com_ponent', 'Com.ponent', 'Com ponent', '']) {
      expect(validateKind(kind)).toBe(false);
    }
  });

  test('the \u226463 bound holds at the boundary', () => {
    expect(validateKind(`C${'a'.repeat(62)}`)).toBe(true);
    expect(validateKind(`C${'a'.repeat(63)}`)).toBe(false);
  });

  test('a non-string is not a valid kind', () => {
    expect(validateKind(undefined)).toBe(false);
    expect(validateKind(42)).toBe(false);
  });
});

describe('T049 — `validateEntityName` is `/^([A-Za-z0-9][-A-Za-z0-9_.]*)?[A-Za-z0-9]$/`, \u226463', () => {
  test('ordinary names pass, including mixed case, `-`, `_` and `.`', () => {
    for (const name of ['payments', 'Payments', 'payments-api', 'payments_api', 'payments.v2', 'a']) {
      expect(validateEntityName(name)).toBe(true);
    }
  });

  test('a leading or trailing separator fails', () => {
    for (const name of ['-payments', 'payments-', '.payments', 'payments.', '_payments', 'payments_']) {
      expect(validateEntityName(name)).toBe(false);
    }
  });

  test('the unsubstituted scaffolder placeholders ADR-0015 names all fail', () => {
    // ADR-0015: "All three forms fail `isValidObjectName` on character class: `$`,
    // `{`, `}` and the spaces are outside the permitted set in every case, and `|`
    // in the first". These are the sixteen descriptors' three distinct forms.
    expect(validateEntityName('${{ values.name | dump }}')).toBe(false);
    expect(validateEntityName('${{ values.name }}')).toBe(false);
    expect(validateEntityName('${{ values.entityName }}')).toBe(false);
  });

  test('the \u226463 bound holds at the boundary', () => {
    expect(validateEntityName('a'.repeat(63))).toBe(true);
    expect(validateEntityName('a'.repeat(64))).toBe(false);
  });

  test('length and character class are different populations (\u00a72.1)', () => {
    // `admissibility.md` §2.1: "Over 63 characters" and "invalid" are different
    // sets and MUST NOT be reported as one.
    const tooLongButOtherwiseValid = 'a'.repeat(64);
    const shortButInvalidCharacters = 'payments!';
    expect(validateEntityName(tooLongButOtherwiseValid)).toBe(false);
    expect(validateEntityName(shortButInvalidCharacters)).toBe(false);
    // Same verdict, different reason — which is exactly why the two populations
    // must not be collapsed in any report.
    expect(tooLongButOtherwiseValid.length > 63).toBe(true);
    expect(shortButInvalidCharacters.length <= 63).toBe(true);
  });

  test('an empty name fails', () => {
    expect(validateEntityName('')).toBe(false);
  });
});

describe('T049 — `validateNamespace` is `/^[a-z0-9]+(?:\\-+[a-z0-9]+)*$/`, \u226463', () => {
  test('ordinary DNS labels pass', () => {
    for (const namespace of ['default', 'payments', 'team-payments', 'a1', 'a--b']) {
      expect(validateNamespace(namespace)).toBe(true);
    }
  });

  test('uppercase fails — this is where ADR-0015 and `admissibility.md` \u00a72 diverge', () => {
    // `contracts/admissibility.md` §2's summary gives namespace the same character
    // class as `metadata.name` ("`[A-Za-z0-9]` plus `-`, `_`, `.`"). ADR-0015 and
    // FR-016 give it the DNS-label predicate, which admits none of uppercase, `_`
    // or `.`. FR-016 requires "exactly the four field validators in ADR-0015's
    // table", so ADR-0015 governs and this assertion is the one that would fail if
    // someone implemented §2's summary instead. Reported as a contract defect.
    expect(validateNamespace('Default')).toBe(false);
    expect(validateNamespace('team_payments')).toBe(false);
    expect(validateNamespace('team.payments')).toBe(false);
  });

  test('a leading or trailing hyphen fails', () => {
    expect(validateNamespace('-payments')).toBe(false);
    expect(validateNamespace('payments-')).toBe(false);
  });

  test('an empty namespace fails — present-and-empty is not omitted', () => {
    expect(validateNamespace('')).toBe(false);
  });

  test('the \u226463 bound holds at the boundary', () => {
    expect(validateNamespace('a'.repeat(63))).toBe(true);
    expect(validateNamespace('a'.repeat(64))).toBe(false);
  });
});

describe('T049 — the four predicates are independent', () => {
  test('each rejects an input the other three accept in their own field', () => {
    // A value valid as one field and invalid as another is what makes separate
    // attribution meaningful rather than decorative.
    expect(validateKind('Component')).toBe(true);
    expect(validateNamespace('Component')).toBe(false);

    expect(validateEntityName('payments.v2')).toBe(true);
    expect(validateNamespace('payments.v2')).toBe(false);
    expect(validateKind('payments.v2')).toBe(false);

    expect(validateApiVersion('v1')).toBe(true);
    expect(validateKind('v1')).toBe(true);
    expect(validateNamespace('v1')).toBe(true);
  });
});
