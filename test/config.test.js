import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeConfig, mergeConfig, DEFAULT_CONFIG } from '../src/config.js'

test('empty input folds to the defaults', () => {
  const cfg = normalizeConfig()
  assert.equal(cfg.root, '.')
  assert.equal(cfg.naming.style, 'scoped')
  assert.equal(cfg.execution.timeoutMs, 120_000)
  assert.equal(cfg.collectors.scripts.runner, 'auto')
})

test('partial input deep-merges over the defaults', () => {
  const cfg = normalizeConfig({
    root: 'src',
    collectors: { scripts: { runner: 'pnpm' } },
    execution: { timeoutMs: 5000 },
  })
  assert.equal(cfg.root, 'src')
  assert.equal(cfg.collectors.scripts.runner, 'pnpm')
  assert.equal(cfg.collectors.scripts.lockfilePriority.length, 5)
  assert.equal(cfg.collectors.makefile.enabled, true)
  assert.equal(cfg.execution.timeoutMs, 5000)
})

test('null patches leave the base intact', () => {
  const cfg = normalizeConfig({ collectors: null, naming: null })
  assert.deepEqual(cfg.collectors, DEFAULT_CONFIG.collectors)
})

test('invalid values are rejected', () => {
  assert.throws(() => normalizeConfig({ root: '' }), /root/)
  assert.throws(() => normalizeConfig({ naming: { style: 'loud' } }), /style/)
  assert.throws(() => normalizeConfig({ execution: { timeoutMs: 0 } }), /timeoutMs/)
  assert.throws(() => normalizeConfig({ collectors: { scripts: { runner: 'cargo' } } }), /runner/)
})

test('mergeConfig: arrays and scalars replace wholesale', () => {
  const merged = mergeConfig(
    { list: [1, 2], deep: { a: 1, b: 2 } },
    { list: [9], deep: { b: 3 } },
  )
  assert.deepEqual(merged.list, [9])
  assert.deepEqual(merged.deep, { a: 1, b: 3 })
})
