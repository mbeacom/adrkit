/**
 * @adrkit/core — inbound source annotations (`@adr <ref>` in a code comment).
 *
 * See [ADR-0021](../../../../docs/adr/0021-resolve-inbound-source-annotations-without-changing-the-schema.md)
 * for why this is an edge discovered at resolution time rather than a new `affects`
 * matcher type or a new frontmatter field.
 */

export { MARKER_HEADER_WINDOW_BYTES, scanSourceMarkers, type ScanSourceMarkersResult } from './scan.ts';
export { readSourceMarkers, type MarkerScanState, type SourceMarkerScan } from './read.ts';
export {
  mergeSourceDeclarations,
  resolveSourceMarkers,
  type ExplainedDecision,
  type ResolveSourceMarkersInput,
  type ResolveSourceMarkersResult,
} from './resolve.ts';
export type { MarkerDeclaration, MarkerMatch, SourceMarker } from './types.ts';
