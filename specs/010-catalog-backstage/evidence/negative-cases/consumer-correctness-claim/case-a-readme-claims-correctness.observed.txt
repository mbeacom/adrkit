# Observed: the README presents a digest-verified envelope as evidence of correctness

$ bun test packages/catalog-envelope/test/no-correctness-claim.test.ts

bun test v1.3.14 (0d9b296a)


packages/catalog-envelope/test/no-correctness-claim.test.ts:
(pass) the exported surface makes no correctness claim > no exported name asserts correctness [0.95ms]
(pass) the exported surface makes no correctness claim > the exported vocabulary is about admission and checking, not judgement [0.08ms]
(pass) the strings this package emits make no correctness claim > no emitted string carries a forbidden claim [2.33ms]
(pass) the strings this package emits make no correctness claim > the one string that mentions correctness denies it [0.02ms]
192 |       const haystack = stripLegitimateCorrectnessMentions(doc.text).toLowerCase();
193 |       for (const claim of FORBIDDEN_CLAIMS) {
194 |         if (haystack.includes(claim)) offending.push(`${doc.name}: ${claim}`);
195 |       }
196 |     }
197 |     expect(offending).toEqual([]);
                            ^
error: expect(received).toEqual(expected)

- []
+ [
+   "README.md: ownership is correct",
+   "README.md: correct ownership",
+   "README.md: tamper-proof",
+ ]

- Expected  - 1
+ Received  + 5

      at <anonymous> (/Users/markbeacom/github/mbeacom/copilot-worktrees/adrkit/mbeacom-super-succotash/packages/catalog-envelope/test/no-correctness-claim.test.ts:197:23)
(fail) the documentation makes no correctness claim > no document carries a forbidden claim [1.31ms]
(pass) the documentation makes no correctness claim > the README states the distinction before it states anything else [0.15ms]
(pass) the documentation makes no correctness claim > no document claims rung 2 or rung 3 standing [0.66ms]

 6 pass
 1 fail
 412 expect() calls
Ran 7 tests across 1 file. [52.00ms]

exit 1
