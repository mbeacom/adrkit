---
schemaVersion: 0.2.0
id: "0060"
title: "Drive the probabilistic evaluator passes through the harness with typed questions over a versioned wire contract"
status: proposed
date: 2026-10-11
deciders:
  - "@mbeacom"
tags:
  - evaluator
  - architecture
  - ai
  - calibration
  - governance
scope: org
reversibility: two-way-door
blastRadius: org
relatesTo:
  - "0003"
  - "0004"
  - "0007"
  - "0009"
  - "0010"
  - "0014"
  - "0016"
  - "0027"
  - "0031"
  - "0037"
affects:
  - type: path
    pattern: "packages/evaluator/**"
  - type: path
    pattern: "packages/cli/src/evaluate*.ts"
  - type: path
    pattern: "specs/011-probabilistic-evaluator-passes/**"
  - type: path
    pattern: "specs/012-evaluator-calibration/**"
    note: "012 owns the snapshot shapes this contract parses into; it is constrained, not changed."
provenance:
  authoredBy: agent-drafted
review:
  tier: arb
  tierReason: >-
    Fixes the only path by which model output can reach the evaluator, which
    ADR-0027 governs as the gate deciding where human judgment is required.
---

# ADR-0060: Drive the probabilistic evaluator passes through the harness with typed questions over a versioned wire contract

> **Status: proposed.** Agent-drafted. This record is gate T003 of
> [`specs/011-probabilistic-evaluator-passes/`](../../specs/011-probabilistic-evaluator-passes/tasks.md).
> It **ratifies** the harness-driven architecture that spec already selected,
> and it **resolves** that spec's [Q6](../../specs/011-probabilistic-evaluator-passes/spec.md#q6),
> the wire contract. It does **not** amend the constitution, and it ships no
> code. It clears one of 011's four Phase 0 gates. T001 and T002 (012's frozen
> holdout and its observed-failing gate) and T004 (Q4 and Q5) stay open, so no
> probabilistic pass is authorized by this record. Under ADR-0027 §2 nothing
> here describes the evaluator as having more than its deterministic pass; every
> statement about Passes 1–3 is conditional.

## Context

[ADR-0027](./0027-ratify-the-deterministic-evaluator-and-bind-calibration-reporting-to-the-first-probabilistic-pass.md)
carries Passes 1–3 forward as intent and forbids escalation by model
discretion. Spec 011 turns that into an architecture: **the model produces
evidence and deterministic code does the deciding**, and the model call
happens in the agent harness that invoked adrkit, never inside adrkit (011
FR-003, FR-004). 011 makes that choice and leaves two things to a record: the
choice itself must be ratified, and the bundle/response wire contract (Q6)
must be settled rather than deferred, because Passes 2 and 3 cannot be built
without it.

What exists, measured in this tree on 2026-10-11:

- **adrkit has never been a model client.** No package calls a model. Three
  landed gates enforce that for the evaluator and must stay green unmodified:
  `packages/evaluator/test/purity.test.ts` traps `globalThis.fetch`,
  `Date.now`, and `Math.random`; `packages/evaluator/test/contracts.test.ts`
  bans `node:fs`, `node:net`, `node:http`, `node:child_process`, and every
  `@adrkit/adapter*` import under `packages/evaluator/src/`; and feature 005's
  SC-006 bars model, prompt, embedding, and retrieval libraries.
- **The constitution forbids the alternative without an amendment.**
  Principle II: "Network-dependent tests and runtime behavior are forbidden".
  Its rationale names "offline use, IP provenance, and the mechanical boundary
  between this Apache-2.0 project and any employer-internal IP".
  [ADR-0003](./0003-ship-as-spec-kit-extension.md) already ships adrkit inside
  a harness that holds model access, and
  [ADR-0010](./0010-bun-toolchain.md) makes published artifacts Node programs
  that need no network.
- **There is a precedent for a strict structured input.**
  `packages/cli/src/evaluate-snapshot.ts` validates the
  `adrkit.pass0.snapshot/v1` bundle: a versioned envelope token, a
  duplicate-key-aware JSON reader, `rejectUnknownKeys` on every object, and
  `SnapshotContractError` mapped to exit `2`. Malformed data that is present is
  an error, and the CLI never invents defaults for it. Absent optional data
  degrades to inert ([ADR-0009](./0009-affects-resolution-and-catalog-binding.md)).
- **The spec already fixes most of what the wire must carry.** FR-010 requires
  each score above 0 to cite a span of the proposal, and the citation to be
  *validated*, not merely present. FR-011 makes two cap antecedents model
  evidence. FR-014 requires Pass 3 to be a separate call with four outputs,
  each present or explicitly absent, and never invented. FR-016 sets
  `low-confidence` to citation coverage over a constant 8 and forbids a model's
  self-reported confidence "alone or as a term". FR-017 requires each Pass 3
  output to carry `bearsOn` over D1–D8. FR-005 makes the snapshot the
  determinism boundary. Feature 012 owns the `RubricScoreSnapshot` and
  `AdversarialSnapshot` field shapes (012 T008) and every metric.
- **No relevance primitive exists** (011 Q3). `packages/mcp/src/search/normalize.ts`
  says "No stemming, fuzzy, weighting, or ranking". Feature 012 has withdrawn
  its relevance floor, so `novel-no-precedent` is expected to stay
  `evidence-absent`.
- **A class of model now exists that answers typed questions without
  generating text.** On 2026-10-10 the maintainer asked for an evaluation of
  TypeSafe's Jev and Microsoft's Microsoft-Decision-1. Both take a `state` plus
  named questions of three types: yes/no (`noul`), pick-one (`choice`, at most
  255 options), and ordered levels (`score`, 2 to 10 levels). Both return
  probabilities, not prose. Microsoft serves the same request shape at
  `…/providers/microsoft/v1/systemone`, the path TypeSafe uses at
  `api.typesafe.ai/v1/systemone`. Neither vendor's documentation mentions
  published weights or self-hosting; both are served only through hosted
  endpoints. Both charge $0.042 per million input tokens. Their own
  documentation sets the limits that matter here: neither generates text or a
  rationale; both say a fractional score is not a calibrated rating
  (TypeSafe's Jev 1.13 limitations page: "score levels poorly calibrated";
  Microsoft: "Prefer scores for relative ordering and thresholds rather than as
  absolute, calibrated ratings"); TypeSafe says "injected or misleading content
  in the state can move its answers" and that the model leans toward the first
  option; Microsoft says wording and option order change scores. Neither vendor
  claim is evidence for this project. ADR-0027 requires adrkit's own figures.

The evaluation showed that the wire contract's real choice is between two
shapes. One is a free-form prompt that a generative model answers with JSON and
quoted citations. The other is a set of typed questions whose answers adrkit can
validate exactly. Only generative models can answer the first. Both kinds of
responder can answer the typed parts of the second. The second also makes
several of 011's requirements mechanical instead of hopeful.

## Decision

**We will run every probabilistic pass through the harness, over a versioned
wire contract of typed questions. adrkit authors every question and validates
every answer. The record text travels only as data.**

### 1. The architecture is ratified, and the constitution is not amended

adrkit emits a **bundle** and consumes a **response**. The harness that
invoked adrkit makes the model call. **No adrkit package calls a model or holds
model credentials, and that includes `packages/adapters/*`** (011 FR-004). A
relay that forwards a bundle to a hosted endpoint is a harness and lives outside
this repository. Because adrkit opens no model connection, Principles II and IV
hold as written, and this record ratifies an architecture rather than amending
one.

The three landed purity and contract gates named in the Context stay green and
unmodified. No probabilistic pass may be a precondition for any adrkit command
completing (011 FR-004, US5).

### 2. Two envelopes, versioned on their own

- The request is `adrkit.evaluator.bundle/v1`. The response is
  `adrkit.evaluator.response/v1`. These tokens are independent of
  `schemaVersion` and of the CLI's version. Any change that alters how a valid
  document is read takes a new token and a record.
- **One bundle covers one pass of one proposal.** Pass 1, Pass 2, and Pass 3
  each get their own bundle. A Pass 3 bundle never contains Pass 2 output
  (FR-014).
- Every bundle carries `bundleId`, the lowercase hex SHA-256 of its canonical
  bytes with `bundleId` itself omitted. Canonical means keys sorted by
  `compareCodeUnits`, no insignificant whitespace, and UTF-8. A response must
  echo the `bundleId`. A mismatch is a contract error, so a response cannot be
  replayed against a different proposal or pass.
- Documents travel as JSON files or over stdio. The CLI flags are 011's to name
  in implementation, and they are additive under
  [ADR-0031](./0031-publish-a-narrow-consumer-sdk-as-the-contract-and-document-the-cli-json-as-its-s.md).

### 3. What a bundle contains

- **`state`**: the proposal and, for Pass 1 and Pass 2, the context 011 FR-006
  assembles. It is data. Record text appears **only** here.
- **`spans`**: the proposal body cut deterministically before any call (clause
  4).
- **`questions`**: a map from question id to a typed question. Ids, types,
  `instructions`, and option or level descriptions come from **a committed
  question catalog** in `@adrkit/evaluator`, keyed by id and versioned with the
  envelope. They are constants. No question text is interpolated from record
  content. The only per-proposal variation allowed is *which* catalog questions
  appear, and the span and candidate ids they range over.

That is the injection boundary. Hostile text in a record can try to move an
answer, as both vendors warn, but it cannot rewrite a question, add one, or
widen an answer's domain, because the validator checks every answer against the
catalog and not against anything in `state`.

Five question types:

| Type | Answer `value` | Optional evidence | Read by the kernel |
|---|---|---|---|
| `yes-no` | `true` / `false` | `probability` in [0, 1] | `value` |
| `one-of` | one declared option key | `probabilities` over every option | `value` |
| `level` | integer index into the declared levels | `probabilities` over every level | `value` |
| `cite` | list of span ids from this bundle | none | `value` |
| `text` | string, at most 2,000 code points | none | presence only |

When optional probabilities are supplied, every one must be a finite number in
[0, 1], and they must agree with `value`. For `yes-no`, `value` must equal
`probability >= 0.5`. For `one-of` and `level`, there must be exactly one
probability per declared option or level, keyed by it, they must sum to 1
within 1e-6, and `value` must be the argmax, with ties broken by declared
order. A vector such as `[-1, 2]` sums to 1 and is still refused. Any
violation is a contract error. Any threshold other than 0.5 is a calibration
decision and belongs to 012, by record. Probabilities are recorded as separate
evidence, beside the scores and not inside them. 012's FR-019 drift metric is
defined over raw and post-drop surviving scores and does not read them; any
metric that does needs 012 to define it first. **They are never a routing
input.** FR-016 already bars a model's
confidence from `low-confidence`, and this contract gives no other trigger a
path to it. A fractional score is never accepted: `level` is an integer,
because both vendors disclaim the interpolated value.

`bearsOn` (FR-017) is not a set type. It is one `yes-no` question per dimension
per Pass 3 output. That keeps the contract to primitives every responder can
answer, and it matches how decision models evaluate questions in isolation.

### 4. Citations are span ids, so validation is membership

The proposal body is the text after the closing `---` of its frontmatter,
normalized to `\n` line endings and taken as UTF-8. It is cut into **blocks**
separated by one or more blank lines. A fenced code block (```` ``` ```` or
`~~~`, matching ADR-0023's fence rule) is one block however many blank lines it
contains. Blocks are numbered `s1` … `sN` in document order. Each span carries
`id`, `start`, and `end` as byte offsets into the normalized body (half-open),
and its `text`. The cut is a pure function with no clock or filesystem, and it
lives in `@adrkit/evaluator`.

A `cite` answer is a list of ids. The validator refuses an id that is not in
this bundle's `spans`, a duplicate, or a non-list. A refused citation is a
contract error. An **empty** list is valid and means *uncited*. That makes
FR-010's "validated, not merely present" a set-membership check. A model
cannot cite a span that quotes nothing, because it cannot name one that adrkit
did not issue. Whether a cited span actually supports the score remains the
model's evidence and 012's to measure. This record does not claim it.

Citations live in the report and are discarded with it. That is the default
answer to 011 [Q4](../../specs/011-probabilistic-evaluator-passes/spec.md#q4),
stated here so nobody assumes an audit trail that does not exist. Keeping
citations inside a record is a schema change, which makes it a one-way door
under Principle V. It needs its own record, and the maintainer still has to
rule on Q4.

### 5. Absent, refused, and malformed are three different outcomes

| Outcome | Example | Result |
|---|---|---|
| **Malformed** | Wrong envelope token, unknown key, duplicate key, wrong type, value outside the declared domain, a probability outside [0, 1] or missing for a declared option, probabilities that disagree with `value`, an omitted Pass 3 output, unknown span id, `bundleId` mismatch | Typed contract error at the boundary. Exit `2`, as for `SnapshotContractError`. Nothing from the response is used. **Never `PassAbsence`.** |
| **Refused** | `{ "refused": true }` with no answers, or no response at all | `PassAbsence` for that pass, with the reason. Evidence was never produced. |
| **Unanswered** | A question id missing from `answers`, other than a Pass 3 output | That item is `evidence-absent`. Every other answer is used. |

The one exception is the four Pass 3 outputs. FR-014 requires each to be
present or **explicitly** absent, so an omitted Pass 3 output answer is
malformed, not unanswered: the explicit absence is an empty-string `value`
(clause 8). Omission cannot stand in for it, or a harness that dropped a slot
would read as one that judged it empty.

A malformed response is a broken integration, not missing evidence. Counting it
as absence would drain 012's marginal denominator silently, which is the
failure 011 calls "absence reported as evidence". Every object rejects unknown
keys, as `rejectUnknownKeys` does today. The reader rejects duplicate JSON keys,
as the snapshot reader does.

### 6. The response declares its responder, and adrkit records it as declared

Each response carries `responder: { kind, model }`. `kind` is one of
`decision-model`, `generative-model`, or `human`. `model` is required unless
`kind` is `human`, and it must be the **resolved, versioned** model id the
provider returned. Both System One APIs return one in their `model` field, for
example `jev-1.13.0` rather than `jev-latest`. adrkit cannot verify either
field. It records them verbatim, labelled as declared, because 012's
per-dimension drift is measured per model version (012 FR-019) and is
meaningless across an alias that moved underneath it.

### 7. Obligations on the harness that adrkit cannot check

The harness contract states them, because adrkit can only state them:

- **Fresh context per bundle.** No state carries over between a proposal's
  Pass 2 and Pass 3 bundles, or between proposals. adrkit can guarantee only
  that it did not put Pass 2 output into a Pass 3 bundle (FR-014). Decision
  models evaluate each question in isolation by construction. That supports the
  claim, but the claim still rests on the harness.
- **Questions are asked as written.** The harness must not rewrite `instructions`
  or options. It may translate them mechanically, for example `one-of` to a
  vendor's `choice`, a `cite` to one yes/no or pick-one per span, or `level` to
  `score` with the argmax taken.
- **Option order is the harness's to vary.** Both vendors report order effects.
  A harness may shuffle options when it asks, but it must answer with the
  declared keys.
- **Data egress is the operator's decision.** A bundle carries the full
  proposal and the text of the records retrieved for it. Where that goes is
  decided by whoever runs the harness. adrkit holds no credential and makes no
  call.

### 8. What a decision-only responder can and cannot supply

This is a stated limit of that class of responder, not a defect:

| Need | Typed shape | Decision model |
|---|---|---|
| Pass 1 relevance of a category (a) candidate (not emitted; clause 9) | `yes-no` per candidate | Yes |
| Pass 2 level per dimension | `level` (5 levels, the 0–4 anchors) | Yes |
| Pass 2 citations | `cite` | Yes, by per-span questions |
| FR-011 cap antecedents (D2 shared assumption, D3 negative consequence) | `yes-no` | Yes |
| Pass 2 "name the missing thing" for a score below 3 | `text` | **No** |
| Pass 3 outputs and their presence | `text`, with presence meaning non-empty `value` | **No** |
| Pass 3 `bearsOn` | `yes-no` per dimension | Only alongside a present output |

A Pass 3 slot is present **only** when its `text` answer is non-empty, and
explicitly absent when it is the empty string. Every Pass 3 output must be
answered one way or the other (clause 5), so a slot can never be filled with
invented content or dropped silently (FR-014). A relay for a responder that
cannot generate answers a Pass 3 bundle with `refused`, which produces a
Pass 3 `PassAbsence`, and
`pass-disagreement` records `evidence-absent`. What an unanswered
"missing thing" does to a Pass 2 score is 011 and 012's to define. This record
carries the question and its absence, nothing more.

### 9. Relevance has a shape and a candidate owner, and is not emitted yet

This gives 011 [Q3](../../specs/011-probabilistic-evaluator-passes/spec.md#q3)
a candidate owner: a relevance judgment for retrieval category (a) can be
harness-supplied evidence, one `yes-no` per candidate, and adrkit would still
implement no ranker. The question catalog defines that question's shape.

**Under this record, no Pass 1 bundle emits it.** Admitting a candidate on a
`true` answer would make the 0.5 rule in clause 3 a ranking function with a
floor, which is the floor 012 withdrew. Recording answers that admit nothing
would still be observed ranking output under FR-018, and would move
`novel-no-precedent`'s absence class without anyone deciding it should. So
category (a) stays empty, nothing ranks, and `novel-no-precedent` stays
`evidence-absent` with its class derived from observed state, until 012
decides by its own record whether harness relevance counts as a ranking
function and with what floor. Categories (b) and (c) stay rule-based and
unconditional either way (FR-006).

### 10. Where the code goes

- The span cutter, the question catalog, and the response validator will be
  pure modules in `@adrkit/evaluator` (under `src/harness/`). They will take an
  already-parsed JSON value and return either a snapshot in 012's shapes or a
  typed contract error, and will import nothing the contract test bans.
- The duplicate-key-aware reader and the file and stdio I/O will stay at the
  CLI boundary, next to `evaluate-snapshot.ts`.
- Response parsing must be deterministic: the same response bytes give the same
  snapshot bytes. Responses themselves are not deterministic, which is why the
  snapshot is the determinism boundary (FR-005).

## Options considered

### Option A: Typed questions over a versioned envelope, harness-driven (chosen)

| Dimension | Assessment |
|---|---|
| Constitution | Unchanged. No adrkit package makes a model call. |
| Injection surface | Questions are catalog constants. Record text is only data. |
| FR-010 citation validation | Exact, by span-id membership |
| Responders | Generative models, decision models, and humans |
| Cost | A catalog to maintain, and a span cutter whose output the contract depends on |

### Option B: A free-form prompt bundle, answered with JSON and quoted citations

**Pros:** easiest for a generative harness, since it is one prompt per pass;
nothing to translate; the model can explain itself.
**Cons:** validating a quoted citation means fuzzy-matching model text against
the proposal, so FR-010's "validated" becomes a similarity threshold that would
itself need calibrating. Prompt text mixes instructions with record content,
so a record can address the model directly. Decision models cannot answer it at
all. It is also the shape that turns into a single-judge "looks good", which
ADR-0005 was written against (superseded by ADR-0027, which keeps the point).

### Option C: An injected model-client port inside adrkit

**Pros:** `adr evaluate` could run Passes 2 and 3 itself, with no integration
work for adopters.
**Cons:** it requires amending Principle II ("Network-dependent tests and
runtime behavior are forbidden"), which by the constitution's own Governance
section needs a record first. It breaks the offline-use and IP-boundary
rationale, puts credentials in a published package, and fails the three landed
purity gates. **Rejected unless the constitution is amended first**, as 011
states. The cost is recorded so a future reader can see exactly what this
option would take.

### Option D: Adopt the vendors' `/v1/systemone` request shape verbatim

**Pros:** two vendors would need no translation; the format is proven in
production.
**Cons:** it binds a published contract to formats this project does not
version. It has no `cite` or `text` type, so FR-010's citations and every Pass
3 output would have to be bolted on outside it. It returns fractional scores
that both vendors call uncalibrated, and it carries a 255-option ceiling. Option
A keeps the three primitives aligned one-to-one with that shape, so a relay
harness is a thin translation, without inheriting it.

### Option E: Do nothing, and leave Q6 open

**Pros:** no commitment before 012 freezes its holdout.
**Cons:** 011 T003 says it plainly: deferring Q6 unblocks nothing, and T020
would invent the contract ad hoc in the middle of implementation, which is
exactly when a contract gets fitted to whatever the first model happened to
return.

## Trade-offs

- **More round trips for a decision model.** A `cite` becomes one question per
  span. A 40-block proposal scored on eight dimensions is hundreds of yes/no
  answers. Decision models answer them in parallel and cheaply, but the harness
  has to compose them.
- **Generative responders lose some freedom.** A model that would cite a phrase
  must cite a block. Blocks are coarser than phrases, and a block that only
  partly supports a score still validates. Precision is traded for
  checkability.
- **The span cutter becomes contract.** Changing how blocks are cut changes
  which ids a citation names, so it takes a new envelope token.
- **The catalog is a second place rubric wording lives.** It must quote
  `docs/EVALUATOR_RUBRIC.md`, not paraphrase it. Under ADR-0005 action item 4,
  carried forward by ADR-0027 §4, a catalog change that alters a rubric
  judgment is a rubric change and needs a record.
- **Harness obligations are unverifiable.** Fresh context, unmodified questions,
  and honest responder declarations are claims adrkit records and cannot check.

## Consequences

- **Easier:** implementing 011 Phase 1 against a fixed contract; testing every
  validator branch with handwritten responses, with no model involved; running
  the same bundle through a generative and a decision-model harness and letting
  012's figures compare them.
- **Harder:** the first harness integration is real work. The contract is
  stricter than "return JSON", and a sloppy integration fails loudly with exit
  `2` instead of degrading quietly. That is the intended direction of error.
- **Unchanged:** Pass 0, its report bytes, its reason codes, the eight landed
  triggers, the schema, `adr lint`, `adr check`, MCP, and the CI Action.
- **How we would know this was wrong:**
  - After 012's holdout is frozen and a first pass runs under it, more than 5%
    of responses from any one supported harness are contract errors. That would
    mean the contract is too strict to integrate against, not that the harness
    is careless.
  - Citation coverage, and so `low-confidence`, tracks block granularity rather
    than proposal quality. 012's per-dimension figures would show that as
    `low-confidence` firing mostly on proposals with few, long blocks.
  - A supported harness cannot honor the fresh-context obligation, and nothing
    lets a reader tell.
- **Revisit if:** 012 rules on whether harness relevance counts as a ranking
  function (clause 9), or a responder class appears that can neither generate nor answer
  typed questions.

## Action items

1. [ ] The maintainer rules on 011 Q4 (citations in the record or not) and Q5
       (exact per-tier weights, by its own record). Both remain open, and 011
       T004 stays open with them.
2. [ ] 012 T008 defines `RubricScoreSnapshot` and `AdversarialSnapshot` so they
       can express validated span-id citations, per-slot presence, per-dimension
       `bearsOn`, the declared responder, and optional probabilities as
       evidence kept separate from the scores FR-019 reads.
       This record constrains those shapes and does not define them.
3. [ ] After 011's Phase 0 clears, and no earlier: the span cutter, the
       question catalog, and the response validator in `@adrkit/evaluator`,
       with every contract-error branch observed failing against a handwritten
       malformed response (ADR-0016). No model call is involved.
4. [ ] After 011's Phase 0 clears: the CLI's bundle emission and response
       consumption, additive under ADR-0031, mapping contract errors to exit `2`.
5. [x] Amend 011's Q6 to point here, and Q3 to name the candidate owner.
