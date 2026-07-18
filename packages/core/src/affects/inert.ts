import picomatch from 'picomatch';
import type { CatalogSnapshot, EntityId } from './catalog.ts';

export type InertMatcherType = 'entity' | 'resource' | 'api' | 'data';

export interface EntityMatcherResult {
  matched: boolean;
  unresolvable?: boolean;
}

function compilePattern(pattern: string): (candidate: string) => boolean {
  return picomatch(pattern, { dot: false, nocase: false, nonegate: true });
}

function resolveEntityIds(pattern: string, catalog: CatalogSnapshot): Set<EntityId> {
  const ids = new Set<EntityId>();
  const isMatch = compilePattern(pattern);
  for (const entity of catalog.entities) {
    const refs = [entity.id, ...(entity.refs ?? [])];
    if (refs.some((ref) => isMatch(ref))) {
      ids.add(entity.id);
    }
  }
  return ids;
}

function entitiesForPaths(changedFiles: readonly string[], catalog: CatalogSnapshot): Set<EntityId> {
  const ids = new Set<EntityId>();
  for (const entity of catalog.entities) {
    for (const entityPath of entity.paths ?? []) {
      const isMatch = compilePattern(entityPath);
      if (changedFiles.some((path) => isMatch(path))) {
        ids.add(entity.id);
        break;
      }
    }
  }
  return ids;
}

export function matchEntityPattern(
  pattern: string,
  changedFiles: readonly string[],
  catalog: CatalogSnapshot | undefined,
): EntityMatcherResult {
  if (!catalog) {
    return { matched: false, unresolvable: true };
  }

  const entityIds = resolveEntityIds(pattern, catalog);
  if (entityIds.size === 0) {
    return { matched: false };
  }

  const changedEntityIds = entitiesForPaths(changedFiles, catalog);
  return {
    matched: [...entityIds].some((id) => changedEntityIds.has(id)),
  };
}

export function isAlwaysInertType(type: string): type is Exclude<InertMatcherType, 'entity'> {
  return type === 'resource' || type === 'api' || type === 'data';
}
