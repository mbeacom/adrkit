# id-unique fixtures

Log-scoped identity cannot be produced by `lintCorpus` (which yields single-repo
records with `log = undefined`). These cases are therefore constructed as **in-memory
immutable records** in `id-unique.test.ts` via `test/support.ts`, which is offline,
deterministic, and model-free. Identity is scoped by `[record.log ?? "", id]`:

- duplicate id in one local (unnamed) log → `id-unique.collision` (fail, error)
- duplicate id in one named log → `id-unique.collision`
- same id across two different named logs → `id-unique.ok` (pass)
