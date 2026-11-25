---
name: verifying-tests
description: Holds the quality rubric for this repository's unit tests and the loop that runs, repairs and reviews them until they pass and typecheck, including what to do when a test fails because the code under test may be wrong. Use before writing or changing tests, and again to run and check them afterwards.
---

# Verifying tests

`suspected_bugs` and the decision reason below are fields of the `unit-test-writer` agent's report; in a chat, tell the user instead.

## Commands
| Purpose | Command |
|---|---|
| Chosen test files (paths relative to the package) | `npm --prefix backend test -- tests/factory.test.ts tests/router.test.ts`, `npm --prefix frontend test -- src/hooks/useNotice.test.ts` |
| Typecheck (covers test files) | `npm --prefix backend run typecheck`, `npm --prefix frontend run typecheck` |
| Whole package with coverage | `npm --prefix backend run test:coverage`, `npm --prefix frontend run test:coverage` |
| Format frontend files (paths relative to the repository root) | `npm --prefix frontend exec -- prettier --write frontend/src/hooks/useNotice.test.ts` |

## Loop, for each package you touched
1. Run all test files you created or changed, in one command.
2. Fix the test when it is at fault: setup, a query, or an expectation that misread the code. When the code may be wrong, follow "Failures caused by the code". Repeat until every test you wrote passes.
3. Typecheck and fix type errors in the tests.
4. Review every test you wrote against the rubric, fix violations, and rerun what you changed. Then format every frontend file you created or changed.
5. Run coverage after your last edit, even if it ran earlier in this run. It runs the whole package, which catches interference through shared fixtures, `mocks.tsx`, or leaked timers, env or globals. Confirm in `lcov.info` that the target lines and branches now ran. A non-zero exit can come from a per-file threshold in the vitest config rather than a failing test; read the output. Close the remaining gaps; a gap you leave needs a concrete cause in the decision reason.

Done when, in every touched package, typecheck passes and the coverage run after your last edit shows the whole suite passing, except failures recorded in `suspected_bugs`, none of them in a test you wrote. If a test case you wrote this run still fails after three attempts, remove it and say why in the decision reason.

## Failures caused by the code
Sources of truth: `backend/openapi.json`, the Zod schemas in `backend/src/features/todos/validators.ts`, and tests the diff did not touch. Comments, names and UI strings are hints only.
- New test: never leave one failing; one red test keeps the whole run from being delivered. If a source of truth shows the code is wrong, or nothing settles the intended behaviour, remove the case and add a `suspected_bugs` entry with the actual behaviour and, if known, the expected one.
- Existing assertion: change it only when the diff deliberately changes exactly that behaviour (the changed lines produce the asserted value) and the new behaviour agrees with the other sources of truth. Change only the expected value, not the scenario. Otherwise leave it failing and report it in `suspected_bugs`. State old and new value in the decision reason, and whether a source of truth confirms the new one.
- Otherwise never make a failure go away by weakening an assertion, deleting or skipping a test, or mocking the code under test. A test must never lock in a product bug.

## Quality rubric
Applies to every test written or changed:
1. Tests observable behaviour: return values, thrown errors, HTTP status and body, rendered roles, text and states, cache contents, and calls the unit makes across its boundary (repository, API, callback props). Not private state, internal helper calls or render counts.
2. Every test asserts something specific to its scenario; `toBeDefined` or a bare `toHaveBeenCalled` where the arguments matter is not enough.
3. An absence assertion uses a query or spy that does match in the positive case, e.g. the same `queryByRole` that finds the element when it is shown.
4. No snapshots (`toMatchSnapshot`, `toMatchInlineSnapshot`); no `.only`, `.skip`, `.todo` or `.fails`; no commented-out tests.
5. The module under test is real; only its collaborators are mocked.
6. Deterministic: no real network, database, clock, timers, randomness or environment. Pin today with `vi.setSystemTime(new Date(2026, 9, 15, 12))` (local noon) without `vi.useFakeTimers()`, and `afterEach(() => vi.useRealTimers())`. Every stub, spy, fake timer, env or global change is undone after the test.
7. Each test would fail if the behaviour in its name broke. Check this by reading the code path, since source cannot be edited.
8. Covers the branches of the target lines (both sides of conditions, error paths, and for a comparison the boundary value itself) without duplicating existing tests.
