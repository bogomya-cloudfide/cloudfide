// node --test .github/scripts/
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, test } from 'node:test'

import { checkPatch, isAllowedPath } from './check-patch.mjs'

// Isolate git from the developer's global/system config.
const sandbox = mkdtempSync(join(tmpdir(), 'check-patch-test-'))
after(() => rmSync(sandbox, { recursive: true, force: true }))
writeFileSync(join(sandbox, 'gitconfig'), '')
Object.assign(process.env, {
  GIT_CONFIG_GLOBAL: join(sandbox, 'gitconfig'),
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
})

let count = 0
function makeRepo() {
  const repo = join(sandbox, `repo-${count++}`)
  mkdirSync(repo)
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' })
  const write = (path, content) => {
    mkdirSync(dirname(join(repo, path)), { recursive: true })
    writeFileSync(join(repo, path), content)
  }
  git('init', '-q', '-b', 'main')
  write('backend/src/stats.ts', 'export const stats = 1\n')
  write('backend/tests/router.test.ts', 'it("a", () => {})\n')
  write('frontend/src/App.test.tsx', 'it("b", () => {})\n')
  write('frontend/src/test/setup.ts', 'import "x"\n')
  git('add', '-A')
  git('commit', '-qm', 'init')
  // Builds the patch like the generate job does (`renames` only to craft a hostile patch).
  const patch = ({ renames = false, stage = true } = {}) => {
    if (stage) git('add', '-A', '--', 'backend', 'frontend')
    const diff = git('diff', '--cached', renames ? '-M' : '--no-renames', '--no-ext-diff', '--no-textconv', 'HEAD', '--', 'backend', 'frontend')
    const file = `${repo}.patch`
    writeFileSync(file, diff)
    return file
  }
  return { repo, git, write, patch }
}

const reasons = (result) => result.rejected.map((r) => `${r.path}: ${r.reason}`).sort()
const craft = (name, lines) => {
  const file = join(sandbox, name)
  writeFileSync(file, `${lines.join('\n')}\n`)
  return file
}

test('allowlist accepts test files, fixtures and the design-system mocks only', () => {
  for (const path of [
    'backend/tests/router.test.ts', 'backend/tests/fixture.ts', 'backend/tests/features/todos/stats.test.ts',
    'frontend/src/App.test.tsx', 'frontend/src/features/todos/utils/todos.test.ts',
    'frontend/src/test/todoFixture.ts', 'frontend/src/test/render.tsx', 'frontend/src/design-system/mocks.tsx',
  ]) assert.equal(isAllowedPath(path), true, path)
  for (const path of [
    'backend/src/features/todos/router.ts', 'backend/vitest.config.ts', 'backend/package.json', 'backend/tests/data.json',
    'frontend/src/App.tsx', 'frontend/src/test/setup.ts', 'frontend/src/design-system/index.ts',
    '.github/workflows/unit-test-agent.yml', '.claude/settings.json', '/backend/tests/a.ts',
    'backend/tests/../src/main.ts', 'backend/tests/./a.ts', 'backend//tests/a.ts', 'backend/tests/.hidden/a.ts',
    'backend/tests/a b.ts', 'backend\\tests\\a.ts', 'backend/tests/\u202ea.ts', 'backend/tests/.ts',
  ]) assert.equal(isAllowedPath(path), false, path)
})

test('rejects added lines that focus, skip or expect-to-fail a test', () => {
  const r = makeRepo()
  r.write('backend/tests/stats.test.ts', 'it.skip("c", () => {})\n')
  r.write('backend/tests/router.test.ts', 'it("a", () => {})\ndescribe.only("d", () => {})\n')
  r.write('frontend/src/App.test.tsx', 'it("b", () => {})\nit.todo("f")\n')
  r.write('frontend/src/main.test.tsx', '++ b/x; test.fails.each([1])("e", () => {})\n')
  const result = checkPatch(r.patch(), r.repo)
  assert.equal(result.ok, false)
  const reason = 'adds a focused, skipped or expected-to-fail test (.only, .skip, .todo, .fails)'
  assert.deepEqual(reasons(result), ['backend/tests/router.test.ts', 'backend/tests/stats.test.ts', 'frontend/src/App.test.tsx', 'frontend/src/main.test.tsx'].map((p) => `${p}: ${reason}`))
})

test('a skipped test that is already in the file does not block new cases', () => {
  const r = makeRepo()
  r.write('backend/tests/router.test.ts', 'it.skip("a", () => {})\n')
  r.git('add', '-A')
  r.git('commit', '-qm', 'author skips a test')
  r.write('backend/tests/router.test.ts', 'it.skip("a", () => {})\nit("skips nothing; calls onlyOnce.skip()", () => {})\n')
  assert.equal(checkPatch(r.patch(), r.repo).ok, true)
})

test('accepts new and modified test files; the patch applies to a clean checkout', () => {
  const r = makeRepo()
  r.write('backend/tests/stats.test.ts', 'it("c", () => {})\n')
  r.write('frontend/src/App.test.tsx', 'it("b", () => {})\nit("d", () => {})\n')
  r.write('frontend/src/test/todoFixture.ts', 'export const todo = {}\n')
  const file = r.patch()
  const result = checkPatch(file, r.repo)
  assert.deepEqual(result.rejected, [])
  assert.deepEqual(result.files, [
    { path: 'backend/tests/stats.test.ts', status: 'added' },
    { path: 'frontend/src/App.test.tsx', status: 'modified' },
    { path: 'frontend/src/test/todoFixture.ts', status: 'added' },
  ])
  r.git('reset', '-q', '--hard')
  r.git('clean', '-qfd')
  r.git('apply', '--index', file)
  assert.match(r.git('status', '--porcelain'), /A {2}backend\/tests\/stats\.test\.ts/)
})

test('one forbidden source edit rejects the whole patch', () => {
  const r = makeRepo()
  r.write('backend/tests/stats.test.ts', 'it("c", () => {})\n')
  r.write('backend/src/stats.ts', 'export const stats = 2\n')
  const result = checkPatch(r.patch(), r.repo)
  assert.equal(result.ok, false)
  assert.deepEqual(reasons(result), ['backend/src/stats.ts: outside the test-file allowlist'])
})

test('empty and missing patches', () => {
  const r = makeRepo()
  assert.deepEqual(checkPatch(r.patch(), r.repo), { ok: true, empty: true, missing: false, files: [], rejected: [] })
  const missing = checkPatch(join(sandbox, 'nope.patch'), r.repo)
  assert.equal(missing.ok, false)
  assert.equal(missing.missing, true)
})

test('rejects deletions, the setup file, executables, mode changes and symlinks', () => {
  const r = makeRepo()
  unlinkSync(join(r.repo, 'backend/tests/router.test.ts'))
  r.write('frontend/src/test/setup.ts', 'import "y"\n')
  r.write('backend/tests/run.ts', '#!/usr/bin/env node\n')
  chmodSync(join(r.repo, 'backend/tests/run.ts'), 0o755)
  chmodSync(join(r.repo, 'frontend/src/App.test.tsx'), 0o755)
  symlinkSync('../src/stats.ts', join(r.repo, 'backend/tests/link.ts'))
  assert.deepEqual(reasons(checkPatch(r.patch(), r.repo)), [
    'backend/tests/link.ts: symbolic link',
    'backend/tests/router.test.ts: deletion',
    'backend/tests/run.ts: executable file',
    'frontend/src/App.test.tsx: mode change 100644 -> 100755',
    'frontend/src/test/setup.ts: outside the test-file allowlist',
  ])
})

test('rejects gitlinks, renames and binary files', () => {
  const r = makeRepo()
  const head = r.git('rev-parse', 'HEAD').trim()
  r.git('update-index', '--add', '--cacheinfo', `160000,${head},backend/tests/sub.ts`)
  assert.deepEqual(reasons(checkPatch(r.patch({ stage: false }), r.repo)), ['backend/tests/sub.ts: submodule'])

  const s = makeRepo()
  s.git('mv', 'backend/tests/router.test.ts', 'backend/tests/routes.test.ts')
  s.write('backend/tests/blob.ts', Buffer.from([0, 1, 2, 0, 255]))
  const found = reasons(checkPatch(s.patch({ renames: true }), s.repo))
  assert.ok(found.includes('backend/tests/blob.ts: binary change'), found.join('\n'))
  assert.ok(found.some((f) => f.startsWith('patch: patch does not apply cleanly')), found.join('\n'))

  const t = makeRepo()
  t.git('mv', 'backend/tests/router.test.ts', 'backend/tests/routes.test.ts')
  assert.deepEqual(reasons(checkPatch(t.patch({ renames: true }), t.repo)), ['backend/tests/router.test.ts: deletion'])
})

test('enforces the size and file-count limits', () => {
  const r = makeRepo()
  for (let i = 0; i < 50; i++) r.write(`backend/tests/t${i}.test.ts`, 'it("x", () => {})\n')
  r.write('backend/tests/big.test.ts', `// ${'x'.repeat(310 * 1024)}\n`)
  assert.deepEqual(reasons(checkPatch(r.patch(), r.repo)), [
    'patch: patch is larger than 300 KB',
    'patch: patch touches 51 files; the limit is 50',
  ])
})

test('rejects hand-crafted traversal, garbage and stale patches', () => {
  const r = makeRepo()
  const traversal = craft('traversal.patch', [
    'diff --git a/backend/tests/../../evil.ts b/backend/tests/../../evil.ts',
    'new file mode 100644', '--- /dev/null', '+++ b/backend/tests/../../evil.ts', '@@ -0,0 +1 @@', '+x',
  ])
  const stale = craft('stale.patch', [
    'diff --git a/backend/tests/router.test.ts b/backend/tests/router.test.ts',
    '--- a/backend/tests/router.test.ts', '+++ b/backend/tests/router.test.ts', '@@ -1 +1 @@', '-other', '+it("z", () => {})',
  ])
  for (const file of [traversal, craft('garbage.patch', ['hello world']), stale]) {
    const result = checkPatch(file, r.repo)
    assert.equal(result.ok, false, file)
    assert.match(result.rejected[0].reason, /^patch does not apply cleanly: /, file)
  }
})
