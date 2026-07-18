export type EntityId = string;

export interface CatalogSnapshotEntity {
  id: EntityId;
  refs?: readonly string[];
  paths?: readonly string[];
}

export interface CatalogSnapshot {
  entities: readonly CatalogSnapshotEntity[];
}

export interface CatalogPort {
  resolveEntity(ref: string): readonly EntityId[];
  entitiesForPaths(paths: readonly string[]): readonly EntityId[];
  snapshot(): CatalogSnapshot;
}
