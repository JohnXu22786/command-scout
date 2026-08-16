import test from 'node:test'
import assert from 'node:assert/strict'
import { parseJustfile } from '../src/collectors/justfile-collector.js'

const TEXT = `# demo justfile
default: build

build: Compile everything
    cc main.c

lint ARGS*: Lint with optional args
    echo {{ARGS}}

x := ignored assignment
alias b := build
`

test('parses recipes with descriptions, args and body variables', () => {
  const recipes = parseJustfile(TEXT, 'justfile')
  const byName = new Map(recipes.map(r => [r.name, r]))

  assert.deepEqual([...byName.keys()].sort(), ['build', 'default', 'lint'])

  const build = byName.get('build')
  assert.equal(build.command, 'just build')
  assert.equal(build.description, 'Compile everything')
  assert.equal(build.usage, 'just build')

  const lint = byName.get('lint')
  assert.equal(lint.description, 'Lint with optional args')
  assert.equal(lint.usage, 'just lint ARGS*')
  assert.deepEqual(lint.variables, ['ARGS'])
})

test('ignores assignments and aliases', () => {
  const recipes = parseJustfile(TEXT, 'justfile')
  const names = recipes.map(r => r.name)
  assert.ok(!names.includes('x'))
  assert.ok(!names.includes('b'))
})

test('export/import/mod statements are not parsed as recipes', () => {
  const recipes = parseJustfile(
    'export FOO := "bar"\nimport other/*\nmod utils\nbuild:\n\tmake\n',
    'justfile',
  )
  assert.deepEqual(recipes.map(r => r.name), ['build'])
})

test('descriptions may contain colons', () => {
  const recipes = parseJustfile('build: ship it: fast\n\tmake\n', 'justfile')
  assert.equal(recipes[0].description, 'ship it: fast')
})

test('argument defaults with = are still parsed as recipes', () => {
  const recipes = parseJustfile(
    "build arch='x86_64' target=x86: Cross-compile\n\tmake TARGET={{target}}\n",
    'justfile',
  )
  assert.equal(recipes.length, 1)
  assert.equal(recipes[0].name, 'build')
  assert.equal(recipes[0].description, 'Cross-compile')
  assert.equal(recipes[0].usage, 'just build arch=\'x86_64\' target=x86')
  assert.deepEqual(recipes[0].variables, ['target'])
})

test('empty input yields no recipes', () => {
  assert.deepEqual(parseJustfile('', 'justfile'), [])
})
