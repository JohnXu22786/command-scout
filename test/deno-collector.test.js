import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { collect, stripJsonComments } from '../src/collectors/deno-collector.js'

const FIXTURES = fileURLToPath(new URL('./fixtures', import.meta.url))

test('parses tasks from deno.jsonc (comments and trailing commas stripped)', () => {
  const notes = []
  const { recipes } = collect(path.join(FIXTURES, 'mixed'), {}, notes)
  const byName = new Map(recipes.map(r => [r.name, r]))

  assert.deepEqual([...byName.keys()].sort(), ['check', 'lint', 'serve'])
  assert.equal(byName.get('serve').command, 'deno task serve')
  assert.equal(byName.get('serve').description, 'deno run --allow-net server.ts')
  assert.equal(byName.get('serve').source, 'deno.jsonc')
})

test('stripJsonComments preserves string content', () => {
  const text = '{ "a": "http://x/y", "b": "/* not a comment */", "c": [1, 2,], }'
  const stripped = stripJsonComments(text)
  const parsed = JSON.parse(stripped)
  assert.deepEqual(parsed, { a: 'http://x/y', b: '/* not a comment */', c: [1, 2] })
})

test('a UTF-8 BOM does not break parsing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-bom-'))
  fs.writeFileSync(
    path.join(dir, 'deno.json'),
    `\uFEFF${JSON.stringify({ tasks: { run: 'deno run main.ts' } })}`,
    'utf8',
  )
  try {
    const notes = []
    const { recipes } = collect(dir, {}, notes)
    assert.equal(recipes.length, 1)
    assert.equal(recipes[0].name, 'run')
    assert.deepEqual(notes, [])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('no deno files yields no recipes', () => {
  const notes = []
  const { recipes } = collect(path.join(FIXTURES, 'empty'), {}, notes)
  assert.deepEqual(recipes, [])
})
