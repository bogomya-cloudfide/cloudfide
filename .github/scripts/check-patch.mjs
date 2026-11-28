#!/usr/bin/env node
// Patch guard for the unit-test-agent workflow.
//
// Decides whether the agent's patch may be applied to the PR branch. Paths, statuses and
// modes come from git itself: the patch is applied to a throwaway index built from HEAD and
// listed with `git diff-index -z`; `git apply --numstat -z` is used only to flag binary
// changes. Only additions and modifications of regular, non-executable files inside the
// write allowlist pass, and no added line may focus, skip or expect-to-fail a test. One bad
// entry rejects the whole patch.
//
// CLI: node check-patch.mjs <patch-file>
//   Prints JSON { ok, empty, missing, files: [{ path, status }], rejected: [{ path, reason }] }
//   and, when GITHUB_OUTPUT is set, appends `ok=` and `empty=` to it.
//   Exit code 0 when accepted (an empty patch is accepted), 1 otherwise.

import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const LIMITS = Object.freeze({ maxFiles: 50, maxBytes: 300 * 1024 })

// One path segment. It cannot start with a dot, so `.`, `..` and hidden names never match;
// empty segments, spaces, backslashes and non-ASCII characters never match either.
const SEGMENT = '[A-Za-z0-9_@+-][A-Za-z0-9._@+-]*'
const DIRS = `(?:${SEGMENT}/)*`
// Keep in sync with the write allowlist in .claude/ (agent permissions and skills).
const ALLOWED = [
  new RegExp(`^backend/tests/${DIRS}${SEGMENT}\\.ts$`),
  new RegExp(`^frontend/src/${DIRS}${SEGMENT}\\.test\\.tsx?$`),
  new RegExp(`^frontend/src/test/${DIRS}${SEGMENT}\\.tsx?$`),
  /^frontend\/src\/design-system\/mocks\.tsx$/,
]

export function isAllowedPath(path) {
  return path !== 'frontend/src/test/setup.ts' && ALLOWED.some((re) => re.test(path))
}

// Rubric item 4 of the verifying-tests skill, enforced: a test that does not run must not be
// pushed as verified. A hygiene check on added lines, not a defence against a determined author.
const DISABLED_TEST = /\b(?:it|test|describe|suite)(?:\.\w+)*\.(?:only|skip|todo|fails)\b/

const STATUS = { A: 'added', M: 'modified', D: 'deleted', T: 'type changed' }
const MODES = { 100755: 'executable file', 120000: 'symbolic link', 160000: 'submodule' }

function changeProblem({ status, oldMode, newMode }) {
  if (status === 'D') return 'deletion'
  if (status !== 'A' && status !== 'M') return `unsupported change type ${status}`
  if (status === 'M' && oldMode !== newMode) return `mode change ${oldMode} -> ${newMode}`
  if (newMode === '100644') return null
  return MODES[newMode] ?? `unsupported file mode ${newMode}`
}

function git(args, cwd, env = {}) {
  return execFileSync('git', args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function firstLine(error) {
  const lines = String(error?.stderr || error?.message || error).split('\n').map((l) => l.trim())
  return lines.find(Boolean)?.slice(0, 200) ?? 'git failed'
}

/** Runs the guard on a patch file against HEAD of the git repository `cwd`. */
export function checkPatch(file, cwd = process.cwd()) {
  const patchPath = resolve(cwd, file)
  let content
  try {
    content = readFileSync(patchPath)
  } catch {
    return { ok: false, empty: false, missing: true, files: [], rejected: [{ path: 'patch', reason: 'patch file is missing' }] }
  }
  if (content.toString('utf8').trim() === '') return { ok: true, empty: true, missing: false, files: [], rejected: [] }

  const rejected = []
  const reject = (path, reason) => rejected.push({ path, reason })
  if (content.length > LIMITS.maxBytes) reject('patch', `patch is larger than ${LIMITS.maxBytes / 1024} KB`)

  const dir = mkdtempSync(join(tmpdir(), 'check-patch-'))
  const index = { GIT_INDEX_FILE: join(dir, 'index') }
  const files = []
  try {
    for (const entry of git(['apply', '--numstat', '-z', patchPath], cwd).split('\0')) {
      if (entry.startsWith('-\t-\t')) reject(entry.slice(4), 'binary change')
    }
    git(['read-tree', 'HEAD'], cwd, index)
    git(['apply', '--cached', '--whitespace=nowarn', patchPath], cwd, index)
    const raw = git(['diff-index', '--cached', '-z', '--no-renames', 'HEAD'], cwd, index).split('\0')
    for (let i = 0; i + 1 < raw.length; i += 2) {
      // ":<old mode> <new mode> <old sha> <new sha> <status>" NUL "<path>" NUL
      const [oldMode, newMode, , , status = ''] = raw[i].slice(1).split(' ')
      files.push({ path: raw[i + 1], status: status.charAt(0), oldMode, newMode })
    }
    let path = 'patch'
    let header = true
    const flagged = new Set()
    for (const line of git(['diff-index', '--cached', '-p', '-U0', '--no-renames', '--no-ext-diff', '--no-textconv', 'HEAD'], cwd, index).split('\n')) {
      if (line.startsWith('diff --git ')) header = true
      else if (line.startsWith('@@ ')) header = false
      else if (header) {
        if (line.startsWith('+++ b/')) path = line.slice(6)
      } else if (line.startsWith('+') && DISABLED_TEST.test(line) && !flagged.has(path)) {
        flagged.add(path)
        reject(path, 'adds a focused, skipped or expected-to-fail test (.only, .skip, .todo, .fails)')
      }
    }
  } catch (error) {
    reject('patch', `patch does not apply cleanly: ${firstLine(error)}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }

  if (files.length > LIMITS.maxFiles) reject('patch', `patch touches ${files.length} files; the limit is ${LIMITS.maxFiles}`)
  for (const entry of files) {
    const problem = isAllowedPath(entry.path) ? changeProblem(entry) : 'outside the test-file allowlist'
    if (problem) reject(entry.path, problem)
  }
  return {
    ok: rejected.length === 0,
    empty: false,
    missing: false,
    files: files.map(({ path, status }) => ({ path, status: STATUS[status] ?? 'other' })),
    rejected,
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const result = checkPatch(process.argv[2] ?? '')
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `ok=${result.ok}\nempty=${result.empty}\n`)
  process.exitCode = result.ok ? 0 : 1
}
