# no-orphan-refs fixtures

Reference-existence scenarios for `supersedes` / `relatesTo`, plus federated-log
resolution, are constructed as in-memory immutable records in `no-orphan-refs.test.ts`
(offline, via `test/support.ts`). A federated ref with no external-log snapshot is
inert (`no-orphan-refs.federated-log-absent`), not an orphan failure (C2).
