import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as api from '../src/index.js'

test('package main exports the public embedding API', () => {
  assert.equal(typeof api.discover, 'function')
  assert.equal(typeof api.runCommand, 'function')
  assert.equal(typeof api.RecipeBook, 'function')
  assert.equal(typeof api.createRecipe, 'function')
  assert.equal(typeof api.normalizeConfig, 'function')
  assert.equal(typeof api.renderTable, 'function')
  assert.equal(typeof api.renderJson, 'function')
  assert.equal(typeof api.renderMarkdown, 'function')
  assert.equal(typeof api.DEFAULT_CONFIG, 'object')
})

test('package main stays free of harness imports', () => {
  const source = fs.readFileSync(fileURLToPath(new URL('../src/index.js', import.meta.url)), 'utf8')
  assert.ok(!source.includes('schemastery'), 'package main must not import harness packages')
  assert.ok(!source.includes('dsh-adapter'), 'plugin contract belongs on the adapter subpath')
})

test('the adapter entry exists and exports the plugin contract', () => {
  const adapterSource = fs.readFileSync(
    fileURLToPath(new URL('../src/dsh-adapter.js', import.meta.url)),
    'utf8',
  )
  for (const declaration of [
    'export const name',
    'export const inject',
    'export const Config',
    'export function apply',
  ]) {
    assert.ok(adapterSource.includes(declaration),
      `adapter must contain ${declaration}`)
  }
  const pkg = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'))
  assert.equal(pkg.exports['./adapter'], './src/dsh-adapter.js')
})

test('toSlug degrades non-ASCII-only names deterministically', () => {
  const { toSlug } = api
  assert.equal(toSlug('build:css'), 'build_css')
  assert.equal(toSlug('构建'), toSlug('构建'))
  assert.notEqual(toSlug('构建'), toSlug('测试'))
  assert.match(toSlug('构建'), /^task_[0-9a-f]{8}$/)
})
