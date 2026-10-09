/**
 * @adrkit/core — comparing and writing review identities (ADR-0051).
 *
 * GitHub handles and team slugs are case-insensitive, and so in practice is an email
 * address. Two spellings of one person must not count twice toward `review.quorum`,
 * so every comparison folds ASCII case over the whole identity. Non-ASCII letters are
 * left alone: folding them needs locale rules this comparison does not claim.
 */

import { Identity } from './adr.schema.ts';

/** The comparison key for an identity: its ASCII letters lowercased. */
export function identityKey(identity: string): string {
  return identity.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

export function sameIdentity(a: string, b: string): boolean {
  return identityKey(a) === identityKey(b);
}

/** How many distinct people a list of identities names. */
export function distinctIdentityCount(identities: readonly string[]): number {
  return new Set(identities.map(identityKey)).size;
}

// C0/C1 controls and DEL (`\p{Cc}`), and invisible format characters (`\p{Cf}`): bidi
// overrides and isolates, zero-width spaces and joiners, and the BOM.
const INVISIBLE_OR_CONTROL = /[\p{Cc}\p{Cf}]/u;

/**
 * Whether a writing command may record `identity`. Stricter than the schema's
 * `Identity`, whose email branch admits control and format characters: those would
 * reach a terminal or render text reversed, and a record already holding one stays
 * valid, but no command writes a new one.
 */
export function isWritableIdentity(identity: string): boolean {
  return Identity.safeParse(identity).success && !INVISIBLE_OR_CONTROL.test(identity);
}

export function hasInvisibleOrControl(text: string): boolean {
  return INVISIBLE_OR_CONTROL.test(text) || /[\u2028\u2029]/.test(text);
}
