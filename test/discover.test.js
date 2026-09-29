import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { discover } from '../src/discover.js'

const FIXTURES = fileURLToPath(new URL('./fixtures', import.meta.url))

test('mixed fixture: all collectors contribute to one book', () => {
  const { book, detectedFiles, diagnostics } = discover(path.join(FIXTURES, 'mixed'))
  const ids = book.entries().map(r => r.id)

  assert.ok(ids.includes('makefile:build'))
  assert.ok(ids.includes('makefile:clean'))
  assert.ok(ids.includes('scripts:dev'))
  assert.ok(ids.includes('justfile:build'))
  assert.ok(ids.includes('deno:serve'))
  assert.deepEqual(
    detectedFiles.sort(),
    ['Makefile', 'deno.jsonc', 'justfile', 'package.json'],
  )
  // the fixture's intentionally broken "broken" script yields one diagnostic
  assert.equal(diagnostics.length, 1)
  assert.ok(diagnostics[0].includes('broken'))
})

test('empty project: no recipes, no errors', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-empty-'))
  try {
    const { book, detectedFiles, diagnostics } = discover(empty)
    assert.equal(book.size, 0)
    assert.deepEqual(detectedFiles, [])
    assert.deepEqual(diagnostics, [])
  } finally {
    fs.rmSync(empty, { recursive: true, force: true })
  }
})

test('disabled collectors are skipped entirely', () => {
  const { book } = discover(path.join(FIXTURES, 'mixed'), {
    collectors: { makefile: { enabled: false }, deno: { enabled: false } },
  })
  const ids = book.entries().map(r => r.id)
  assert.ok(!ids.some(id => id.startsWith('makefile:')))
  assert.ok(!ids.some(id => id.startsWith('deno:')))
  assert.ok(ids.some(id => id.startsWith('scripts:')))
})

test('a corrupt package.json is isolated to a diagnostic', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-corrupt-'))
  fs.writeFileSync(path.join(dir, 'package.json'), '{ not json', 'utf8')
  fs.writeFileSync(path.join(dir, 'Makefile'), 'build:\n\tmake\n', 'utf8')
  try {
    const { book, diagnostics } = discover(dir)
    assert.equal(book.size, 1)
    assert.equal(book.entries()[0].id, 'makefile:build')
    assert.ok(diagnostics.some(d => d.includes('package.json')))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('nonexistent root throws a clear error', () => {
  assert.throws(
    () => discover(path.join(FIXTURES, 'does-not-exist')),
    /does not exist/,
  )
})
