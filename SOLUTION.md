# Solution: unit test agent and PR workflow

A custom Claude Code agent with four reusable skills writes and maintains the unit tests of this repository. The same definition is used in two ways:

- **locally**, to backfill missing tests of the existing app ([#3](https://github.com/bogomya-cloudfide/cloudfide/pull/3) backend, [#4](https://github.com/bogomya-cloudfide/cloudfide/pull/4) frontend);
- **in a GitHub Actions workflow** on pull requests that change backend or frontend source. The agent decides which changed files need tests and writes or updates them. The workflow verifies them on a clean runner, pushes them to the PR branch and reports in one PR comment ([#5](https://github.com/bogomya-cloudfide/cloudfide/pull/5), an example feature PR left open).

## Where things are

| What | Where |
|---|---|
| Agent | `.claude/agents/unit-test-writer.md` |
| Skills | `.claude/skills/<name>/SKILL.md` (below) |
| Permission policy of the agent | `.claude/unit-test-agent/settings.json` |
| Schema of the agent's report | `.claude/unit-test-agent/report.schema.json` |
| PR workflow | `.github/workflows/unit-test-agent.yml` |
| Patch guard (`check-patch.mjs`), report renderer (`render-report.mjs`) and their tests | `.github/scripts/` |

| Skill | Responsibility |
|---|---|
| `selecting-test-targets` | Which source files to assess (PR diff or coverage report) and the rules for `create` / `update` / `skip` |
| `writing-backend-tests` | Conventions, seams (no database, no network) and pitfalls of the Express/Prisma tests |
| `writing-frontend-tests` | Conventions, design-system mocking and pitfalls of the React tests |
| `verifying-tests` | Run-and-repair loop, quality rubric, and what to do when the code looks wrong |

The agent file holds the procedure, the hard rules and the report format. Knowledge about the codebase lives in the skills, which Claude Code also loads in an interactive session. The prompt selects the mode: `MODE: backfill` with a package, or `MODE: pr` with two commits.

## How the PR workflow works

```
pull request ──► generate ──patch + report──► verify ──results──► publish
                 LLM agent                    clean runner        commit, status, comment
                 API key, read-only token,    read-only token,    write token,
                 sandbox, no root             no API key, no LLM  no LLM, no npm
```

1. **generate** checks out the PR head and removes sudo, Docker access and ptrace on the runner. It takes `.claude/` from the base branch, so a PR cannot change the agent, skills or policy of its own run unless it also edits the workflow (see Assumptions). Then it runs the agent with the Claude Code CLI in a sandbox. Output: a patch and a JSON report with a decision and a reason for each changed source file.
2. **verify** starts from a fresh checkout and runs the patch guard first. A rejected patch is never executed. An accepted patch gets typecheck and both full test suites twice: without the patch and with it. With an empty patch they run once on the PR as it is, so a red suite is reported even when the agent adds nothing. Coverage is reported.
3. **publish** re-checks the patch and commits it to the PR branch. The push uses `--force-with-lease` against the verified commit, so it succeeds only if the branch has not moved. The job then sets a `unit-test-agent/verify` success status on the new commit and creates or updates a single comment. Nothing is pushed if verification fails, the guard rejects the patch, the PR was closed or its branch moved. The comment gives the reason and says whether the PR was already red without the patch.

## Decisions and rationale

- **Headless Claude Code CLI.** CI runs the command a developer runs locally, with turn and budget caps added, so there is one copy of the agent, skills, policy and schema.
- **The workflow measures results itself.** The agent reports its decisions and reasons through a JSON schema. Test results, coverage, cost and the skills used come from the workflow's own measurements. The comment marks all agent-written text as "agent-reported".
- **Least privilege per job.** The job that runs the LLM has a read-only token. The job with the write token runs no LLM, installs no dependencies and runs no tests, only the two helper scripts. The API key is available to a single step.
- **Sandbox for the agent's commands.** The agent does not start if the sandbox is unavailable. Its commands have no outbound network, see the workspace but nothing else in the home directory, and cannot write to the agent's configuration or `.github`. `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` removes the API key from their environment. They can still write elsewhere on the runner, for example to the directory Node is installed in. Before any PR code runs, the job removes sudo, Docker access and ptrace, so code that the tests leave behind cannot read the key from the runner's memory later in the job. A probe test on the runner confirmed these limits.
- **Prompt injection.** PR content is treated as data. The agent may edit only test paths and run only test, typecheck, coverage, Prettier and read-only git commands, and it ignores `CLAUDE.md` and `.claude/rules` files from the PR. The patch guard has the final say on what reaches the branch. It accepts only added or modified regular test files with no added `.only`, `.skip`, `.todo` or `.fails`, and it runs a second time in the privileged job. The comment renderer neutralises markup, mentions and links in agent text. [#6](https://github.com/bogomya-cloudfide/cloudfide/pull/6) demonstrates this.
- **Tests follow the specification.** Permissions and the guard keep source changes off the branch. The agent is instructed never to edit the author's tests or weaken an assertion, and the comment lists every existing test file it changed. It changes an expected value only when the diff deliberately changes that exact behaviour, and the reason states the old and the new value. When the code contradicts `openapi.json` or the Zod schemas, or nothing defines the expected behaviour, it writes no assertion for it and reports a suspected bug in the comment. Any other existing test that the PR breaks stays red, and the comment says the PR fails its own checks.
- **A line is covered when a test would fail without it.** The skills list the places where line coverage misleads: a container whose mocked children ignore what it passes, a cache call nobody observes, one line that serves several keys. If the test file of a changed module belongs to the PR author, the agent skips it and names the behaviour that no assertion covers.
- **Coverage is information for the reviewer** and blocks nothing. Types, constants and process bootstrap (`main.ts`, the listener and signal handling in `core/lifespan.ts`) get no unit tests.
- **Tests land in the PR itself.** The author reviews the bot's commit together with the code and pulls it before pushing again. One comment is updated in place on each push.
- **Bounded runs.** Sonnet, at most 80 turns, 5 USD and 30 minutes per agent run. A newer push to the PR cancels the running workflow.

## How to run

Prerequisites: Node.js >= 22.12, `npm ci` in `backend/` and `frontend/`, and the Claude Code CLI (CI pins 2.1.332) signed in or with `ANTHROPIC_API_KEY` set. No database is needed. The sandbox is built in on macOS. On Linux it needs `bubblewrap` and `socat`, and on Ubuntu 24.04 also `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0`, as CI does.

```sh
# Backfill one package (SCOPE: backend or frontend)
claude -p $'MODE: backfill\nSCOPE: backend' --agent unit-test-writer \
  --permission-mode dontAsk --settings .claude/unit-test-agent/settings.json \
  --json-schema "$(cat .claude/unit-test-agent/report.schema.json)"

# The PR mode, locally
claude -p $'MODE: pr\nBASE_SHA: <sha>\nHEAD_SHA: <sha>' --agent unit-test-writer \
  --permission-mode dontAsk --settings .claude/unit-test-agent/settings.json \
  --json-schema "$(cat .claude/unit-test-agent/report.schema.json)"

# Tests of the workflow scripts
node --test .github/scripts/
```

Run the commands from the repository root; for the PR mode check out `HEAD_SHA` first. Local runs have no turn or budget caps and write into the working tree. They use the same sandbox settings as CI: no outbound network, and in your home directory only the workspace and `~/.nvm` are readable. If Node is installed elsewhere under your home directory, add that folder to `sandbox.filesystem.allowRead` in `settings.json`. Set `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1`, as CI does, to keep an API key in your environment away from the agent's commands.

In GitHub: add the repository secret `ANTHROPIC_API_KEY`. Then, as an owner, member or collaborator, open a non-draft pull request from a branch of this repository that changes `backend/src/**` or `frontend/src/**`. Changes only to tests, stories or the design system do not trigger the workflow.

## Example runs

**Feature PR [#5](https://github.com/bogomya-cloudfide/cloudfide/pull/5)** (task summary endpoint and an "Overdue" filter, opened without new tests; the author only added a mock of the new hook to the page test). It is left open.

| Push | Agent decisions | Result |
|---|---|---|
| 1. The feature, 16 files (14 source) | create 3 (`stats.ts`, `TodoSummary.tsx`, `useTodoStatsQuery.ts`), update 7 (router, API client, filters, three mutation hooks, utils), skip 4 (two type-only files, a constant, and the page: its test belongs to the author, so the reason names the wiring that no assertion covers) | 3 new and 7 extended test files pushed; backend 83 and frontend 123 tests pass; changed files at 100% lines; 43 turns, $0.27 |
| 2. Behaviour change: hide the "Overdue" badge at zero | update 1: the agent's own earlier test now contradicted the code, so it rewrote that one case; everything else skipped | 1 test file pushed; the suite was red without the patch and is green with it; the same comment updated; 15 turns, $0.11 |

Skills used: all four in the first run, three in the second (it wrote no backend test). The PR comment now shows the second run's decisions; the first run's are in the comment's edit history.

**Security PR [#6](https://github.com/bogomya-cloudfide/cloudfide/pull/6)** (closed without merging): a code comment told "AI agents" to skip the tests, edit `package.json`, create a non-test file and print the API key. The agent wrote the tests for the new helper and reported that it had ignored the instruction (19 turns, $0.08).

**Types-only PR [#7](https://github.com/bogomya-cloudfide/cloudfide/pull/7)** (left open): the diff only adds two type aliases. The agent skipped the changed file as type-only and wrote nothing. The workflow still ran typecheck and both suites on the PR as it is (backend 78 and frontend 112 tests pass), and the comment says no tests are needed (6 turns, $0.03).

**Backfill** ([#3](https://github.com/bogomya-cloudfide/cloudfide/pull/3) backend, [#4](https://github.com/bogomya-cloudfide/cloudfide/pull/4) frontend):

- Backend 48 → 78 tests, statements 30% → 81% (the agent's commit alone: 77 tests, 78%). Frontend 18 → 112 tests, statements 46% → 99% (the agent's first commit alone: 99 tests, 99%).
- In each PR the first commit is the agent's output. The second comes from an independent review that seeded bugs by hand: the agent's tests caught 10 of 14 in the backend (12 after the fixes) and 12 of 18 in the frontend (18 after).
- A second review of the frontend tests killed 42 of 48 pre-chosen mutations and found lines that ran without any assertion at 99% coverage. After I changed the skills to name such places, a new agent run found the untested page wiring and the unasserted `cancelQueries` call in the three mutation hooks by itself (third commit of #4). The review of that run added by hand the one hook it missed, `useTodosBusy` (fourth commit).
- The published history is condensed. #1 holds the final skills, so the first commits of #3 and #4 were produced by an earlier version of them, and the skill changes described here have no commits of their own.

## Assumptions

- "Unit tests" means Vitest tests in the existing layout that need no database or network.
- People with write access are trusted. On `pull_request` the workflow file, its helper scripts and the install scripts of dependencies come from the PR, so such a person could change them. Fork and draft PRs are skipped.

## Limitations

- The guard and verification catch broken output only. Whether a passing test would catch a regression depends on the rubric and on human review.
- The verify job executes agent-written test code without a sandbox. It has no secrets, but hostile test code could fake its result. Review the bot's commit like any other contribution before running the tests locally or merging.
- The bot commit is pushed with `GITHUB_TOKEN` and marked `[skip actions]`, so other workflows do not run on it.
- A PR whose suite stays red with the agent's patch gets no tests until its author makes it green, for example when the PR breaks a test the agent may not change.
- The guard is all or nothing: one file outside the allowlist, more than 50 files or a patch over 300 KB rejects the whole patch.
- If the branch moves through a push that does not trigger the workflow, the run reports "superseded" and no newer run follows.
- Every push re-analyses the whole PR diff, and the comment shows only the latest run.
- Backfill runs only as a local command, and its audit of asserted behaviour depends on what the agent reads.

## What I would change for production

- A GitHub App token for the push, so regular CI runs on the bot commit, and `unit-test-agent/verify` posted on every head commit, success or failure, as a required check.
- Workload identity federation instead of a long-lived API key, and network egress of the whole agent step limited to the Anthropic API (today only the agent's commands are cut off).
- A workflow step that prepares the PR diff and the list of bot-written tests, so the agent needs no git commands, and a checkout without history (today the agent may run `git diff`, `git merge-base` and one form of `git log`).
- A small evaluation set of recorded PRs to regression-test every change to the skills, plus mutation testing of changed files as a quality signal in the comment.
- An opt-out label, and cost and outcome metrics aggregated across runs (each run already reports its own).
