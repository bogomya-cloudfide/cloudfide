#!/usr/bin/env node
// Reporting for the unit-test-agent workflow. Zero dependencies.
//   verify  --report F --results DIR --out F   verify.json from env OUTCOME_* step outcomes,
//           DIR/vitest-<pkg>.json and <pkg>/coverage/coverage-summary.json   (verify job)
//   decide  --agent-dir DIR --verify F --guard F           may the patch be pushed?  (publish)
//   comment --agent-dir DIR --verify F --guard F --out F   PR comment markdown       (publish)
// decide/comment read env VERIFY_RESULT, PUSH_RESULT, NEW_SHA, HEAD_SHA, RUN_URL, REPO_URL and
// append `outcome=`, `ok=`, `push=` to GITHUB_OUTPUT. report.json, meta.json and verify.json are
// agent- or PR-influenced and untrusted: strings are capped, flattened and escaped, numbers
// coerced. The headline comes only from workflow facts (guard, verify, patch emptiness, push).

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

export const MARKER = '<!-- unit-test-agent -->'
export const BODY_LIMIT = 65536
const PACKAGES = ['backend', 'frontend']
const MAX_ROWS = 50
const MAX_TESTS = 20
const MAX_TEXT = 300
const MAX_COVERAGE = 12
const MAX_PROSE = 600 // maxLength of the report's prose fields in report.schema.json

const entry = (ok, title, text) => ({ ok, title, text })
export const OUTCOMES = {
  'tests-pushed': entry(true, '✅ tests added and verified',
    'Typecheck and the full test suites of both packages passed on a clean runner with the patch applied. The commit is on your branch: pull before you push again.'),
  'no-tests-needed': entry(true, '✅ no tests needed',
    'The agent made no test changes for this diff. Typecheck and the full test suites of both packages pass on a clean runner.'),
  superseded: entry(true, '⏭️ superseded by a newer push',
    'Nothing was pushed: the PR was closed, or its branch moved or was deleted, after this run started. A newer commit gets its own run and report.'),
  'verify-failed': entry(false, '❌ verification failed, nothing pushed',
    "Nothing was pushed: typecheck or tests failed on a clean runner with the agent's patch applied. The patch is attached to the run as the `agent-output` artifact."),
  'pr-checks-failed': entry(false, '❌ this PR fails its own checks, nothing pushed',
    'Nothing was pushed: typecheck or tests fail on this PR without any change from the agent, or could not run; see the verification below.'),
  'guard-rejected': entry(false, '❌ patch rejected by guard, nothing pushed',
    'Nothing was pushed: the patch breaks a rule of the patch guard, listed below.'),
  'agent-did-not-finish': entry(false, '❌ agent did not finish, nothing pushed',
    'Nothing was pushed: the agent produced no usable report (turn or budget limit, timeout, API error, or it reported being blocked). Re-run the workflow to retry.'),
  'push-failed': entry(false, '❌ verified tests could not be pushed',
    'The patch passed verification, but pushing it to the PR branch failed. See the workflow run.'),
}

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)
const asArray = (v) => (Array.isArray(v) ? v : [])
const asString = (v) => (typeof v === 'string' ? v : '')
const asNumber = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

function clip(value, max) {
  const chars = Array.from(value)
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : value
}

/** Inline-safe markdown: one line, capped; no HTML, markdown, math, links, mentions or #refs. */
export function text(value, max = MAX_TEXT) {
  if (typeof value !== 'string' && typeof value !== 'number') return ''
  const flat = String(value)
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return clip(flat, max)
    .replace(/[\\`*_[\]|~$]/g, '\\$&')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[@#]/g, '$&\u200b')
    .replace(/:\/\/|www\./gi, (m) => `${m[0]}\u200b${m.slice(1)}`)
}

/** A path-like value as a code span; characters outside a conservative set become "?". */
export function code(value, max = 200) {
  const s = typeof value === 'string' && value !== '' ? value : '?'
  return `\`${clip(s.replace(/[^A-Za-z0-9._\-/+@: ]/g, '?'), max)}\``
}

/** The agent's structured report, or null when there is none. */
export function normalizeReport(raw) {
  if (!isObject(raw) || !['completed', 'blocked'].includes(raw.status)) return null
  return {
    status: raw.status,
    blockedReason: asString(raw.blocked_reason),
    summary: asString(raw.summary),
    decisions: asArray(raw.decisions).filter(isObject).map((d) => ({
      file: asString(d.file), action: asString(d.action), reason: asString(d.reason),
      testFiles: asArray(d.test_files).filter((f) => typeof f === 'string'),
    })),
    bugs: asArray(raw.suspected_bugs).filter(isObject).map((b) => ({ file: asString(b.file), description: asString(b.description) })),
  }
}

// ---------------------------------------------------------------------------- verify.json

const repoPath = (path, root) => (typeof path === 'string' && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : '?')
const outcome = (v) => (['success', 'failure', 'cancelled'].includes(v) ? v : 'skipped')

function summarizeVitest(report, root) {
  if (!isObject(report)) return { passed: null, failed: null, files_failed_to_run: null, failed_tests: [], failed_tests_omitted: 0 }
  const names = []
  let notRun = 0
  for (const file of asArray(report.testResults).filter(isObject)) {
    const path = repoPath(file.name, root)
    const failed = asArray(file.assertionResults).filter((a) => isObject(a) && a.status === 'failed')
    for (const a of failed) names.push([path, ...asArray(a.ancestorTitles), a.title].filter((t) => typeof t === 'string').join(' > '))
    if (file.status === 'failed' && failed.length === 0) {
      notRun += 1
      names.push(`${path} (file failed to run)`)
    }
  }
  return {
    passed: asNumber(report.numPassedTests), failed: asNumber(report.numFailedTests), files_failed_to_run: notRun,
    failed_tests: names.slice(0, MAX_TESTS).map((n) => clip(n, MAX_TEXT)), failed_tests_omitted: Math.max(0, names.length - MAX_TESTS),
  }
}

/** verify.json: step outcomes, test counts, failed test names and line coverage of decided files. `baseline` is the run without the patch. */
function buildVerify({ report, outcomes, vitest, coverage, root }) {
  const decided = new Set((normalizeReport(report)?.decisions ?? []).map((d) => d.file))
  const packages = {}
  for (const pkg of PACKAGES) {
    const lines = {}
    for (const [key, value] of Object.entries(isObject(coverage[pkg]) ? coverage[pkg] : {})) {
      const path = repoPath(key, root)
      if (decided.has(path)) lines[path] = asNumber(value?.lines?.pct)
    }
    const { typecheck, test } = outcomes[pkg] ?? {}
    packages[pkg] = { typecheck: outcome(typecheck), tests: outcome(test), ...summarizeVitest(vitest[pkg], root), coverage: lines }
  }
  return { baseline: outcome(outcomes.baseline), packages }
}

// ---------------------------------------------------------------------------- outcome and comment

/**
 * Outcome from workflow facts. `report` is normalised (null when missing); `guard` is the
 * publish job's check-patch result; `baseline` is the verify job's run without the patch.
 * 'ready-to-push' means all checks passed and no push happened yet.
 */
export function decideOutcome({ guard, report, verifyResult, baseline, push }) {
  const g = guard ?? { missing: true }
  if (!g.missing && g.ok !== true) return 'guard-rejected'
  if (g.missing || report?.status !== 'completed') return 'agent-did-not-finish'
  // With an empty patch the verify job checked the PR as it is, so a failure there is the PR's own.
  if (verifyResult !== 'success') return g.empty || baseline === 'failure' ? 'pr-checks-failed' : 'verify-failed'
  if (g.empty) return 'no-tests-needed'
  return { pushed: 'tests-pushed', superseded: 'superseded', failed: 'push-failed' }[push] ?? 'ready-to-push'
}

const finalOutcome = (facts) => decideOutcome(facts).replace('ready-to-push', 'push-failed')
const LABEL = { success: 'pass', failure: '**fail**', cancelled: 'cancelled', skipped: 'skipped' }
const omitted = (n, what) => (n > 0 ? [`_${n} more ${what} omitted._`] : [])

/** Every decision in one folded list, skips last: a list wraps where a table of long paths cannot, and the comment of a large PR stays short. */
function decisionsList(decisions) {
  const shown = decisions.slice(0, MAX_ROWS)
  const count = (action) => shown.filter((d) => d.action === action).length
  const item = (d) => {
    const action = text(d.action, 20)
    const tests = d.testFiles.slice(0, 5).map((f) => code(f)).join(' ')
    return `- ${action && `**${action}** `}${code(d.file)}: ${text(d.reason)}${tests ? ` Tests: ${tests}` : ''}`
  }
  const skipsLast = [...shown.filter((d) => d.action !== 'skip'), ...shown.filter((d) => d.action === 'skip')]
  return [`<details><summary><b>Decisions</b> (agent-reported): ${count('create')} create, ${count('update')} update, ${count('skip')} skip</summary>`, '',
    ...skipsLast.map(item), ...omitted(decisions.length - MAX_ROWS, 'decisions').flatMap((note) => ['', note]), '', '</details>'].join('\n')
}

function testsCell(p) {
  if (p.tests !== 'success' && p.tests !== 'failure') return 'skipped'
  const notRun = asNumber(p.files_failed_to_run)
  const cell = `${asNumber(p.passed) ?? '?'} / ${asNumber(p.failed) ?? '?'}${notRun ? ` (${notRun} file(s) failed to run)` : ''}`
  return p.tests === 'failure' ? `**${cell}**` : cell
}

function verificationTable(verify, verifyResult, patched) {
  if (!isObject(verify)) return `**Verification:** results unavailable (verify job: ${text(verifyResult || 'unknown', 20)}).`
  const lines = [`**Verification** (clean runner, ${patched ? 'patch applied' : 'PR as it is'})`, '',
    '| Package | Typecheck | Tests (passed / failed) |', '|---|---|---|']
  const failed = []
  const coverage = []
  for (const pkg of PACKAGES) {
    const p = isObject(verify.packages?.[pkg]) ? verify.packages[pkg] : {}
    const files = Object.entries(isObject(p.coverage) ? p.coverage : {})
    coverage.push(...files.slice(0, MAX_COVERAGE).map(([file, pct]) => `- ${code(file)} ${asNumber(pct) === null ? 'n/a' : `${Math.round(pct * 10) / 10}%`}`))
    coverage.push(...omitted(files.length - MAX_COVERAGE, `${pkg} files`))
    lines.push(`| ${pkg} | ${LABEL[p.typecheck] ?? 'skipped'} | ${testsCell(p)} |`)
    failed.push(...asArray(p.failed_tests).slice(0, MAX_TESTS).map((name) => `- ${pkg}: ${text(name)}`))
    failed.push(...omitted(asNumber(p.failed_tests_omitted) ?? 0, `${pkg} failures`))
  }
  if (patched && verify.baseline !== 'skipped') lines.push('', `Without the patch, typecheck and tests ${verify.baseline === 'success' ? 'pass' : '**fail**'}.`)
  if (failed.length) lines.push('', '**Failed tests**', '', ...failed)
  if (coverage.length) lines.push('', '<details><summary>Line coverage of changed files</summary>', '', ...coverage, '', '</details>')
  return lines.join('\n')
}

function details(meta, context) {
  const m = isObject(meta) ? meta : {}
  const agent = [m.model && `model ${code(m.model, 64)}`, asNumber(m.turns) !== null && `${m.turns} turns`,
    asNumber(m.cost_usd) !== null && `$${m.cost_usd.toFixed(2)}`, m.result && `result ${code(m.result, 64)}`].filter(Boolean)
  const skills = asArray(m.skills_used).filter((s) => typeof s === 'string').slice(0, 20).map((s) => code(s, 64))
  return ['<details><summary>Run details</summary>', '', `- Workflow run: ${context.runUrl}`,
    `- PR head: \`${asString(context.headSha).slice(0, 7)}\``, ...(agent.length ? [`- Agent: ${agent.join(' · ')}`] : []),
    `- Skills used: ${skills.join(', ') || 'none recorded'}`, '', '</details>'].join('\n')
}

/** Renders the PR comment. `context`: { guard, verifyResult, baseline, push, newSha, headSha, runUrl, repoUrl }. */
export function render({ report: rawReport, meta, verify, context }) {
  const report = normalizeReport(rawReport)
  const outcome = finalOutcome({ ...context, report })
  const { title, text: explanation } = OUTCOMES[outcome]
  const commit = outcome === 'tests-pushed' && context.newSha
    ? ` ([${context.newSha.slice(0, 7)}](${context.repoUrl}/commit/${context.newSha}))` : ''
  const parts = [`${MARKER}\n## Unit Test Agent — ${title}${commit}`, explanation]

  // The CLI's own failure text, e.g. an API error; shown only when there is no report to show instead.
  const error = isObject(meta) ? asString(meta.error) : ''
  if (!report && error) parts.push(`**Agent error:** ${text(error)}`)
  if (report?.status === 'blocked') parts.push(`**Blocked reason** (agent-reported): ${text(report.blockedReason, MAX_PROSE) || 'not given'}`)
  if (report?.summary) parts.push(`**Agent summary** (agent-reported): ${text(report.summary, MAX_PROSE)}`)
  if (report?.decisions.length) parts.push(decisionsList(report.decisions))
  if (outcome === 'no-tests-needed' && report.decisions.some((d) => d.action === 'create' || d.action === 'update')) {
    parts.push('_Note: the agent reported create/update decisions, but its run left no file changes._')
  }
  const guard = isObject(context.guard) ? context.guard : {}
  if (guard.ok === true && !guard.empty) {
    const files = asArray(guard.files).filter(isObject)
    const modified = files.filter((f) => f.status === 'modified').length
    parts.push([`<details><summary><b>Patch${outcome === 'tests-pushed' ? '' : ' (not pushed)'}</b>: ${files.length - modified} new test file(s), ${modified} existing test file(s) modified</summary>`, '',
      ...files.slice(0, MAX_ROWS).map((f) => `- ${f.status === 'modified' ? 'modified' : 'new'} ${code(f.path)}`),
      ...omitted(files.length - MAX_ROWS, 'files').flatMap((note) => ['', note]), '', '</details>'].join('\n'))
  }
  if (guard.ok === true) parts.push(verificationTable(verify, context.verifyResult, !guard.empty))
  const rejected = asArray(guard.rejected).filter(isObject)
  if (rejected.length && !guard.missing) {
    parts.push(['**Rejected by the patch guard**', '',
      ...rejected.slice(0, MAX_ROWS).map((r) => `- ${code(r.path)} — ${text(r.reason)}`),
      ...omitted(rejected.length - MAX_ROWS, 'findings')].join('\n'))
  }
  if (report?.bugs.length) {
    parts.push(['> [!WARNING]', '> **Suspected bugs** (agent-reported). Review before merging; no test pins this behaviour.', '>',
      ...report.bugs.slice(0, 10).map((b) => `> - ${code(b.file)}: ${text(b.description, MAX_PROSE)}`)].join('\n'))
  }
  parts.push(details(meta, context))

  const body = `${parts.join('\n\n')}\n`
  if (body.length <= BODY_LIMIT - 100) return body
  // The trusted header comes first, and a cut cannot create a `<`. Only this script writes `<details>`
  // (text() and code() emit no `<`), so a cut inside a folded block is closed to keep the note visible.
  const cut = body.slice(0, BODY_LIMIT - 100)
  const open = cut.split('<details>').length > cut.split('</details>').length
  return `${cut}\n\n${open ? '</details>\n\n' : ''}_Truncated; see the run._\n`
}

// ---------------------------------------------------------------------------- CLI

function readJson(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return null }
}

function writeFile(file, content) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, content)
}

function writeOutputs(values) {
  process.stdout.write(`${values.outcome}\n`)
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(values).map(([k, v]) => `${k}=${v}\n`).join(''))
}

function publishFacts(args) {
  const { VERIFY_RESULT, PUSH_RESULT, NEW_SHA, HEAD_SHA, RUN_URL, REPO_URL } = process.env
  const guard = readJson(args.guard) ?? { ok: false, rejected: [{ path: 'patch', reason: 'guard result unavailable' }] }
  const verify = readJson(args.verify)
  const facts = {
    report: readJson(join(args['agent-dir'], 'report.json')),
    meta: readJson(join(args['agent-dir'], 'meta.json')),
    verify,
    context: { guard, verifyResult: VERIFY_RESULT, baseline: verify?.baseline, push: PUSH_RESULT, newSha: NEW_SHA, headSha: HEAD_SHA, runUrl: RUN_URL, repoUrl: REPO_URL },
  }
  return { facts, outcome: decideOutcome({ ...facts.context, report: normalizeReport(facts.report) }) }
}

const COMMANDS = {
  verify(args) {
    const root = process.cwd()
    const outcomes = { baseline: process.env.OUTCOME_BASELINE }
    const vitest = {}
    const coverage = {}
    for (const pkg of PACKAGES) {
      const key = pkg.toUpperCase()
      outcomes[pkg] = { typecheck: process.env[`OUTCOME_${key}_TYPECHECK`], test: process.env[`OUTCOME_${key}_TEST`] }
      vitest[pkg] = readJson(join(args.results, `vitest-${pkg}.json`))
      coverage[pkg] = readJson(join(root, pkg, 'coverage', 'coverage-summary.json'))
    }
    writeFile(args.out, `${JSON.stringify(buildVerify({ report: readJson(args.report), outcomes, vitest, coverage, root }), null, 2)}\n`)
  },
  decide(args) {
    const { outcome } = publishFacts(args)
    writeOutputs({ push: outcome === 'ready-to-push', outcome })
  },
  comment(args) {
    const { facts, outcome } = publishFacts(args)
    const final = outcome.replace('ready-to-push', 'push-failed')
    writeFile(args.out, render(facts))
    writeOutputs({ outcome: final, ok: OUTCOMES[final].ok })
  },
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: Object.fromEntries(['out', 'guard', 'report', 'results', 'verify', 'agent-dir'].map((o) => [o, { type: 'string' }])),
  })
  const command = COMMANDS[positionals[0]]
  if (!command) {
    process.stderr.write(`usage: render-report.mjs <${Object.keys(COMMANDS).join('|')}> [options]\n`)
    process.exit(2)
  }
  command(values)
}
