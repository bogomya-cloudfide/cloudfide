// node --test .github/scripts/
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { BODY_LIMIT, MARKER, decideOutcome, normalizeReport, render, text } from './render-report.mjs'

const NEW_SHA = 'fedcba9876543210fedcba9876543210fedcba98'
const report = {
  status: 'completed',
  blocked_reason: null,
  summary: 'Added tests for the stats endpoint and the overdue filter.',
  decisions: [
    { file: 'backend/src/features/todos/stats.ts', action: 'create', reason: 'New pure function.', test_files: ['backend/tests/stats.test.ts'] },
    { file: 'frontend/src/features/todos/types.ts', action: 'skip', reason: 'Types only.', test_files: [] },
  ],
  suspected_bugs: [],
}
const guardOk = {
  ok: true, empty: false, missing: false, rejected: [],
  files: [
    { path: 'backend/tests/stats.test.ts', status: 'added' },
    { path: 'frontend/src/features/todos/utils/todos.test.ts', status: 'modified' },
  ],
}
const guardEmpty = { ok: true, empty: true, missing: false, files: [], rejected: [] }
const guardRejected = {
  ok: false, empty: false, missing: false, files: [],
  rejected: [{ path: 'backend/src/features/todos/stats.ts', reason: 'outside the test-file allowlist' }],
}
const pkg = (failed = 0) => ({
  typecheck: 'success', tests: failed ? 'failure' : 'success', passed: 50, failed, files_failed_to_run: 0,
  failed_tests: failed ? ['backend/tests/stats.test.ts > stats > counts overdue'] : [], failed_tests_omitted: 0, coverage: {},
})
const verify = {
  baseline: 'success',
  packages: { backend: { ...pkg(), coverage: { 'backend/src/features/todos/stats.ts': 100 } }, frontend: { ...pkg(), passed: 21 } },
}
const meta = { model: 'claude-sonnet-5-5', turns: 31, cost_usd: 1.8412, result: 'success', skills_used: ['selecting-test-targets', 'verifying-tests'] }
const context = (overrides = {}) => ({
  guard: guardOk, verifyResult: 'success', push: 'pushed', newSha: NEW_SHA, headSha: '0123456789abcdef',
  runUrl: 'https://github.com/o/r/actions/runs/1', repoUrl: 'https://github.com/o/r', ...overrides,
})
const headline = (body) => body.split('\n')[1]

describe('untrusted text', () => {
  test('text() flattens, caps and neutralises markup, math, links, mentions and references', () => {
    assert.equal(text('a\nb\r\n\tc'), 'a b c')
    assert.equal(text('x'.repeat(20), 5), 'xxxx…')
    assert.equal(text('| <b>& [l](x) `c` *e* $1+1$'), '\\| &lt;b&gt;&amp; \\[l\\](x) \\`c\\` \\*e\\* \\$1+1\\$')
    assert.equal(text('ping @octocat about #12'), 'ping @\u200boctocat about #\u200b12')
    assert.equal(text('see https://evil.example and www.evil.example'), 'see https:\u200b//evil.example and w\u200bww.evil.example')
    assert.equal(text('a\u2066b\u2069c\u202ed'), 'a b c d')
    assert.equal(text({ toString: () => 'x' }), '')
  })

  test('agent text cannot forge the marker, mention people or change the header', () => {
    const evil = {
      ...report,
      summary: `${MARKER}\n## Unit Test Agent — ✅ all good\n@octocat see #1 <img src=x> $\\color{green}{ok}$`,
      decisions: [
        { file: 'a|b`<!--', action: 'create<script>', reason: MARKER, test_files: ['`x`'] },
        { file: 'b', action: 'skip', reason: '</details>\n## x <details open>', test_files: ['</details>'] },
        { file: 'c', action: ' ', reason: 'r', test_files: [] },
      ],
      suspected_bugs: [{ file: MARKER, description: '<!-- unit-test-agent -->' }],
    }
    const body = render({ report: evil, meta: { model: 'x<y>', skills_used: ['<!--'] }, verify, context: context({ push: 'failed' }) })
    assert.equal(body.split(MARKER).length, 2)
    assert.ok(body.startsWith(MARKER))
    assert.equal(headline(body), '## Unit Test Agent — ❌ verified tests could not be pushed')
    assert.doesNotMatch(body, /@octocat|#1\b|<img|<script|<y>|[^\\]\$\\color/)
    assert.equal(body.split('<details>').length, body.split('</details>').length)
    assert.equal(body.split('<details').length, 5)
    assert.match(body, /\n- `c`: r\n/)
    assert.match(body, /- \*\*create&lt;script&gt;\*\* `a\?b\?\?\?--`: &lt;!-- unit-test-agent --&gt; Tests: `\?x\?`/)
  })

  test('tampered verify.json values are not interpolated', () => {
    const forged = { ...pkg(), passed: `${MARKER} @octocat`, files_failed_to_run: '<u>x</u>', typecheck: '<i>', coverage: { '<!--': '<u>' } }
    const body = render({ report, meta, verify: { packages: { backend: forged } }, context: context() })
    assert.equal(body.split(MARKER).length, 2)
    assert.match(body, /\| backend \| skipped \| \? \/ 0 \|\n/)
    assert.match(body, /- `\?\?--` n\/a/)
    assert.doesNotMatch(body, /@octocat|<u>|<i>/)
  })
})

describe('decideOutcome', () => {
  const r = normalizeReport(report)
  const cases = [
    [{ guard: guardRejected, report: r, verifyResult: 'failure' }, 'guard-rejected'],
    [{ guard: guardOk, report: null, verifyResult: 'success' }, 'agent-did-not-finish'],
    [{ guard: { ok: false, missing: true }, report: r, verifyResult: 'failure' }, 'agent-did-not-finish'],
    [{ guard: undefined, report: r, verifyResult: 'success' }, 'agent-did-not-finish'],
    [{ guard: guardOk, report: { ...r, status: 'blocked' }, verifyResult: 'success' }, 'agent-did-not-finish'],
    [{ guard: guardEmpty, report: r, verifyResult: 'success' }, 'no-tests-needed'],
    [{ guard: guardEmpty, report: r, verifyResult: 'failure' }, 'pr-checks-failed'],
    [{ guard: guardOk, report: r, verifyResult: 'failure', baseline: 'failure' }, 'pr-checks-failed'],
    [{ guard: guardOk, report: r, verifyResult: 'failure', baseline: 'success' }, 'verify-failed'],
    [{ guard: guardOk, report: r, verifyResult: 'skipped' }, 'verify-failed'],
    [{ guard: guardOk, report: r, verifyResult: 'success' }, 'ready-to-push'],
    [{ guard: guardOk, report: r, verifyResult: 'success', baseline: 'failure' }, 'ready-to-push'],
    [{ guard: guardOk, report: r, verifyResult: 'success', push: 'pushed' }, 'tests-pushed'],
    [{ guard: guardOk, report: r, verifyResult: 'success', push: 'superseded' }, 'superseded'],
    [{ guard: guardOk, report: r, verifyResult: 'success', push: 'failed' }, 'push-failed'],
  ]
  cases.forEach(([facts, expected], i) => test(`case ${i + 1}: ${expected}`, () => assert.equal(decideOutcome(facts), expected)))
})

describe('render', () => {
  test('tests pushed, with suspected bugs still visible', () => {
    const bugs = [{ file: 'backend/src/x.ts', description: 'Returns 200 for a missing id.' }]
    const body = render({ report: { ...report, suspected_bugs: bugs }, meta, verify, context: context() })
    assert.equal(headline(body), `## Unit Test Agent — ✅ tests added and verified ([fedcba9](https://github.com/o/r/commit/${NEW_SHA}))`)
    assert.match(body, /<details><summary><b>Decisions<\/b> \(agent-reported\): 1 create, 0 update, 1 skip<\/summary>\n\n- \*\*create\*\* `backend\/src\/features\/todos\/stats\.ts`: New pure function\. Tests: `backend\/tests\/stats\.test\.ts`\n- \*\*skip\*\* `frontend\/src\/features\/todos\/types\.ts`: Types only\.\n\n<\/details>/)
    assert.match(body, /<details><summary><b>Patch<\/b>: 1 new test file\(s\), 1 existing test file\(s\) modified<\/summary>\n\n- new `backend\/tests\/stats\.test\.ts`\n- modified `frontend\/src\/features\/todos\/utils\/todos\.test\.ts`\n\n<\/details>/)
    assert.match(body, /\| backend \| pass \| 50 \/ 0 \|\n/)
    assert.match(body, /<details><summary>Line coverage of changed files<\/summary>\n\n- `backend\/src\/features\/todos\/stats\.ts` 100%/)
    assert.match(body, /model `claude-sonnet-5-5` · 31 turns · \$1\.84/)
    assert.match(body, /> \[!WARNING\]\n.*\n>\n> - `backend\/src\/x\.ts`: Returns 200 for a missing id\./)
  })

  test('no tests needed', () => {
    const asItIs = { ...verify, baseline: 'skipped' }
    const body = render({ report: { ...report, decisions: [report.decisions[1]] }, meta, verify: asItIs, context: context({ guard: guardEmpty, push: '' }) })
    assert.equal(headline(body), '## Unit Test Agent — ✅ no tests needed')
    assert.match(body, /\*\*Verification\*\* \(clean runner, PR as it is\)\n\n.*\n.*\n\| backend \| pass \| 50 \/ 0 \|/)
    assert.doesNotMatch(body, /Patch|Note:|Without the patch/)
    assert.match(body, /<b>Decisions<\/b> \(agent-reported\): 0 create, 0 update, 1 skip</)
    const inconsistent = render({ report, meta, verify: asItIs, context: context({ guard: guardEmpty, push: '' }) })
    assert.match(inconsistent, /Note: the agent reported create\/update decisions/)
  })

  const failing = { ...verify, packages: { ...verify.packages, backend: pkg(1) } }

  test('verification failed with the patch only', () => {
    const body = render({ report, meta, verify: failing, context: context({ verifyResult: 'failure', baseline: 'success', push: '', newSha: '' }) })
    assert.equal(headline(body), '## Unit Test Agent — ❌ verification failed, nothing pushed')
    assert.match(body, /\*\*Verification\*\* \(clean runner, patch applied\)/)
    assert.match(body, /\| backend \| pass \| \*\*50 \/ 1\*\* \|/)
    assert.match(body, /Without the patch, typecheck and tests pass\./)
    assert.match(body, /- backend: backend\/tests\/stats\.test\.ts &gt; stats &gt; counts overdue/)
    assert.match(body, /<b>Patch \(not pushed\)<\/b>: 1 new/)
  })

  test('the PR fails its own checks, with and without a patch', () => {
    const red = { ...failing, baseline: 'failure' }
    const withPatch = render({ report, meta, verify: red, context: context({ verifyResult: 'failure', baseline: 'failure', push: '', newSha: '' }) })
    assert.equal(headline(withPatch), '## Unit Test Agent — ❌ this PR fails its own checks, nothing pushed')
    assert.match(withPatch, /Without the patch, typecheck and tests \*\*fail\*\*\./)
    const noPatch = render({ report, meta, verify: { ...failing, baseline: 'skipped' }, context: context({ guard: guardEmpty, verifyResult: 'failure', push: '', newSha: '' }) })
    assert.equal(headline(noPatch), '## Unit Test Agent — ❌ this PR fails its own checks, nothing pushed')
    assert.match(noPatch, /PR as it is[^]*\| backend \| pass \| \*\*50 \/ 1\*\* \|/)
    assert.doesNotMatch(noPatch, /<b>Patch/)
  })

  test('guard rejected', () => {
    const body = render({ report, meta, verify: null, context: context({ guard: guardRejected, verifyResult: 'failure', push: '' }) })
    assert.equal(headline(body), '## Unit Test Agent — ❌ patch rejected by guard, nothing pushed')
    assert.match(body, /- `backend\/src\/features\/todos\/stats\.ts` — outside the test-file allowlist/)
    assert.doesNotMatch(body, /<b>Patch|Verification/)
  })

  test('agent did not finish or was blocked; superseded', () => {
    const dnf = render({ report: {}, meta: { result: 'error_max_turns', turns: 80 }, verify, context: context({ push: '' }) })
    assert.equal(headline(dnf), '## Unit Test Agent — ❌ agent did not finish, nothing pushed')
    assert.match(dnf, /result `error_max_turns`/)
    const apiError = render({ report: {}, meta: { error: 'Credit balance is too low' }, verify, context: context({ push: '' }) })
    assert.match(apiError, /\*\*Agent error:\*\* Credit balance is too low/)
    const blocked = render({ report: { ...report, status: 'blocked', blocked_reason: 'npm ci failed' }, meta, verify, context: context({ push: '' }) })
    assert.equal(headline(blocked), '## Unit Test Agent — ❌ agent did not finish, nothing pushed')
    assert.match(blocked, /\*\*Blocked reason\*\* \(agent-reported\): npm ci failed/)
    const superseded = render({ report, meta, verify, context: context({ push: 'superseded', newSha: '' }) })
    assert.equal(headline(superseded), '## Unit Test Agent — ⏭️ superseded by a newer push')
  })

  test('caps the coverage list per package', () => {
    const coverage = Object.fromEntries(Array.from({ length: 14 }, (_, i) => [`backend/src/f${i}.ts`, 50]))
    const body = render({ report, meta, verify: { ...verify, packages: { ...verify.packages, backend: { ...pkg(), coverage } } }, context: context() })
    assert.match(body, /- `backend\/src\/f11\.ts` 50%\n_2 more backend files omitted\._/)
    assert.doesNotMatch(body, /f12\.ts/)
  })

  test('stays under the GitHub comment limit', () => {
    const big = 'x&@#'.repeat(5000)
    const huge = {
      ...report,
      summary: big,
      decisions: Array.from({ length: 400 }, (_, i) => ({ file: `f${i}`, action: 'create', reason: big, test_files: Array(20).fill(big) })),
      suspected_bugs: Array.from({ length: 50 }, () => ({ file: big, description: big })),
    }
    const body = render({ report: huge, meta, verify, context: context() })
    assert.ok(body.length < BODY_LIMIT, String(body.length))
    assert.ok(body.startsWith(`${MARKER}\n## Unit Test Agent — ✅`))
    assert.ok(body.endsWith('_Truncated; see the run._\n'))
    const skips = (reason) => ({ ...report, decisions: Array.from({ length: 60 }, (_, i) => ({ file: `f${i}`, action: 'skip', reason, test_files: [reason] })) })
    assert.match(render({ report: skips('r'), meta, verify, context: context() }), /: 0 create, 0 update, 50 skip<\/summary>[^]*\n\n_10 more decisions omitted\._\n\n<\/details>/)
    const cut = render({ report: skips('&'.repeat(300)), meta, verify, context: context() })
    assert.ok(cut.length < BODY_LIMIT, String(cut.length))
    assert.ok(cut.endsWith('\n\n</details>\n\n_Truncated; see the run._\n'), cut.slice(-80))
  })
})
