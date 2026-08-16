import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { collect, detectRunner } from '../src/collectors/script-collector.js'
import { normalizeConfig } from '../src/config.js'

const FIXTURES = fileURLToPath(new URL('./fixtures', import.meta.url))

function collectFrom(fixtureName, overrides = {}) {
  const options = normalizeConfig({}).collectors.scripts
  const notes = []
  const result = collect(path.join(FIXTURES, fixtureName), { ...options, ...overrides }, notes)
  return { ...result, notes }
}

test('reads scripts and resolves the runner from packageManager', () => {
  const { recipes } = collectFrom('mixed')
  const byName = new Map(recipes.map(r => [r.name, r]))

  assert.equal(byName.size, 4)
  assert.equal(byName.get('dev').command, 'pnpm run dev')
  assert.equal(byName.get('build').description, 'tsc && vite build')
  assert.equal(byName.get('build').runner, 'pnpm')
  assert.equal(byName.get('build:css').command, 'pnpm run build:css')
  // tool-name scoping uses the runner, not the kind
  assert.equal(byName.get('build').id, 'scripts:build')
})

test('non-string script commands are skipped with a diagnostic', () => {
  const { recipes, notes } = collectFrom('mixed')
  const names = recipes.map(r => r.name)
  assert.ok(!names.includes('broken'))
  assert.ok(notes.some(n => n.includes('does not hold a string command')))
})

test('detectRunner: explicit runner wins over everything', () => {
  const runner = detectRunner('', {}, { runner: 'bun' }, [])
  assert.equal(runner, 'bun')
})

test('detectRunner: packageManager beats lockfiles', () => {
  const notes = []
  // npm-lock fixture has package-lock.json; the field must still win
  const runner = detectRunner(
    path.join(FIXTURES, 'npm-lock'),
    { packageManager: 'yarn@1.22.22' },
    normalizeConfig({}).collectors.scripts,
    notes,
  )
  assert.equal(runner, 'yarn')
  assert.equal(notes.length, 0)
})

test('detectRunner: unknown packageManager falls back to lockfiles', () => {
  const notes = []
  const runner = detectRunner(
    path.join(FIXTURES, 'pnpm-lock'),
    { packageManager: 'custom@1.0.0' },
    normalizeConfig({}).collectors.scripts,
    notes,
  )
  assert.equal(runner, 'pnpm')
  assert.ok(notes.some(n => n.includes('unrecognized packageManager')))
})

test('lockfile probing order follows configured priority', () => {
  const cfg = normalizeConfig({}).collectors.scripts
  const notes = []
  assert.equal(detectRunner(path.join(FIXTURES, 'pnpm-lock'), {}, cfg, notes), 'pnpm')
  assert.equal(detectRunner(path.join(FIXTURES, 'yarn-lock'), {}, cfg, notes), 'yarn')
  assert.equal(detectRunner(path.join(FIXTURES, 'bun-lock'), {}, cfg, notes), 'bun')
  assert.equal(detectRunner(path.join(FIXTURES, 'npm-lock'), {}, cfg, notes), 'npm')
  assert.equal(detectRunner(path.join(FIXTURES, 'empty'), {}, cfg, notes), 'npm')
})

test('unknown lockfile entries in the priority list are ignored', () => {
  const notes = []
  const runner = detectRunner(
    path.join(FIXTURES, 'npm-lock'),
    {},
    { lockfilePriority: ['mystery.lock', 'package-lock.json'] },
    notes,
  )
  assert.equal(runner, 'npm')
  assert.ok(notes.some(n => n.includes('unknown lockfile name')))
})

test('missing package.json yields no recipes and no error', () => {
  const { recipes, notes } = collectFrom('empty')
  assert.deepEqual(recipes, [])
  assert.deepEqual(notes, [])
})
