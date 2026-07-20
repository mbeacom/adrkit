# routing fixtures

Escalation-trigger and named-human target scenarios are constructed as in-memory
immutable records + routing evidence + identity snapshots in `routing-triggers.test.ts`
and `routing-target.test.ts` (offline, via `test/support.ts`). Escalation is an OR over
the eight proven Pass 0 triggers; missing evidence is not-proven. Target resolution runs
only when escalation is proven and follows deciders -> CODEOWNERS -> catalog with a team
ambiguity barrier.
