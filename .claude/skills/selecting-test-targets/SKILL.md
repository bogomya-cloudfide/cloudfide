---
name: selecting-test-targets
description: Builds the list of backend and frontend source files to assess for unit tests and decides create, update or skip for each, either from a pull-request diff between two commits or from one package's coverage report. Use when deciding which source files need unit tests, before writing any.
---

# Selecting test targets

The output is a list of assessed source files, each with `create`, `update` or `skip`, a specific reason, and the test files involved. In the `unit-test-writer` agent it becomes `decisions` in the report; in a chat, tell the user.

## Scope
- Source files are under `backend/src/` and `frontend/src/`. Test files and test helpers (`backend/tests/**`, `*.test.ts(x)`, `frontend/src/test/**`, `design-system/mocks.tsx`) are never assessed themselves and never get a `decisions` entry.
- What is outside coverage scope is defined by `coverage.include` and `coverage.exclude` in `backend/vitest.config.ts` and `frontend/vite.config.ts`. Read them; do not guess.

## Coverage data
`npm --prefix <backend|frontend> run test:coverage` writes `<pkg>/coverage/lcov.info`. Each `SF:` block names a file relative to the package; `DA:<line>,0` is an uncovered line and `BRDA:<line>,<block>,<branch>,0` (or `-`) is an untaken branch. The console table lists uncovered lines but hides fully covered files and truncates long lists (`...`); for those and for untaken branches open `lcov.info` with the Read tool. If any test fails, Vitest writes no coverage directory at all; then judge coverage from the tests that import the file.

## Finding the tests of a source file
Grep the test files for the module's file name in import and `vi.mock` paths. Backend tests are flat in `backend/tests/` and import `../src/...ts`; frontend tests sit next to their source and import relatively (`./TodoItem`, `../api/todos`). A test that only `vi.mock`s a module does not test it. In the backend, a router mounted by `createApp` with no test file of its own (`api/health.ts`) is tested in `tests/factory.test.ts`: add cases there.

## PR mode
1. `git merge-base <BASE_SHA> <HEAD_SHA>` gives MB. If it fails, report `blocked`.
2. `git diff --name-status -M MB <HEAD_SHA> -- backend/src backend/tests frontend/src` lists the changed files. The source files among them are the candidates; changed test files get no decision and matter only for step 6.
3. `git diff -U0 MB <HEAD_SHA> -- backend/src frontend/src` gives the changed lines (the `+start,count` side of each hunk). Read each whole file too.
4. If a candidate already has tests, run its package's coverage once before writing and check the changed lines against it, then check that a test asserts what those lines do (see "already covered" below).
5. Changes outside the source dirs are not assessed, but read them when they document intended behaviour (`backend/openapi.json`).
6. If step 2 listed test files, run `git log --format=%an --name-only MB..<HEAD_SHA> -- backend/tests frontend/src` to see who committed each. A test file whose commits are all by `github-actions[bot]` is this agent's output from an earlier push: maintain it like a test that predates the PR, and rewrite or remove a case of it when what the case exercises no longer exists (say so in the reason; the one case where an existing test case may be removed). Any other test the PR adds or changes, including one both the bot and a person committed, belongs to its author: never edit it; if it fails, report it in `suspected_bugs`.

## Backfill mode
Run coverage for the package. The `SF:` lines of `lcov.info` are the files to assess, one decision each; the console table omits fully covered files.

Coverage shows only lines that never ran. So read every listed source, several per turn, and, whatever its coverage, the tests of each file that has:
- children or hooks it passes values to: an assertion on each value passed;
- calls made for their side effect (a query-cache cancel, set or invalidate, a log, a cleanup): a test that fails without each;
- a key prefix, pattern or filter meant to match several keys or variants: a case for each.

A missing assertion is uncovered behaviour: `update`, naming it in the reason. A file with none of these and no uncovered line or branch is `skip`, already covered.

## Decision rules
**skip** only for one of these reasons, named in the decision:
- outside coverage scope per the vitest config;
- no runtime behaviour: type-only modules, styles, stories, barrels that only re-export, static constants;
- process bootstrap: `backend/src/main.ts`, and the listener, signal and `process.exit` code of `backend/src/core/lifespan.ts` (its other paths are assessed like any code). Never mock the process or the network listener to buy coverage;
- already covered: no changed (PR) or any (backfill) line or branch is uncovered, and the covering tests assert the behaviour. A line counts only if some test would fail were it deleted or its arguments changed: a line run only incidentally by another module's test does not count, whatever `lcov.info` says;
- behaviour-preserving change (type annotations, rename of a local, formatting, comments, import order) whose existing tests, if any, still pass;
- its test file belongs to the PR author (PR step 6): read that test and name in the reason the changed behaviour that no assertion covers;
- deleted source: list the now-orphaned tests in `test_files`, say in the reason that the author must remove them, and record their failures in `suspected_bugs`.

**update** when the module already has a test file and either uncovered behaviour remains (in PR mode, on changed lines) or the diff deliberately changed behaviour that existing assertions check. Add cases to that file with Edit, extending its imports as needed, and leave its existing tests untouched, apart from an assertion `verifying-tests` lets you change; extend a shared mock only when a new case needs it. For a renamed source, fix the import paths in its existing tests, keep their file names, and note the mismatch in the reason.

**create** when the module has runtime behaviour and no test file; in PR mode only when the diff adds or changes behaviour. Name it by the writing skill's convention.

An uncovered line or branch that carries behaviour (a condition, a rendered state or label, a message, a callback), in PR mode one on a changed line, is never "minor" or "for a later pass": its file gets `create` or `update`, unless the bootstrap or author-owned skip applies.
