import test from 'node:test'
import assert from 'node:assert/strict'
import { renderTable, renderJson, renderMarkdown } from '../src/render.js'
import { createRecipe } from '../src/recipe.js'

function sample() {
  return [
    createRecipe({
      kind: 'makefile', name: 'build', command: 'make build',
      description: 'Compile the release bundle', source: 'Makefile',
      dependsOn: ['clean'], variables: ['VERSION'],
    }),
    createRecipe({
      kind: 'scripts', name: 'dev', command: 'pnpm run dev',
      description: 'vite', source: 'package.json', runner: 'pnpm',
    }),
  ]
}

test('renderTable produces an aligned header and rows', () => {
  const table = renderTable(sample())
  const lines = table.split('\n')
  assert.equal(lines.length, 3)
  assert.ok(lines[0].startsWith('source'))
  assert.ok(lines[1].includes('makefile'))
  assert.ok(lines[2].includes('pnpm run dev'))
})

test('renderTable handles an empty book', () => {
  assert.equal(renderTable([]), '(no commands found)')
})

test('renderJson round-trips the scan result shape', () => {
  const json = JSON.parse(renderJson({
    scanRoot: '/tmp/p', detectedFiles: ['Makefile'], recipes: sample(), diagnostics: [],
  }))
  assert.equal(json.root, '/tmp/p')
  assert.equal(json.commands.length, 2)
  assert.deepEqual(json.diagnostics, [])
})

test('renderMarkdown groups by kind and lists tool names', () => {
  const md = renderMarkdown(sample(), {
    root: '/tmp/p',
    generatedAt: '2026-01-01',
    toolNames: new Map([['makefile:build', 'make_build'], ['scripts:dev', 'pnpm_dev']]),
  })
  assert.ok(md.includes('# Project Commands'))
  assert.ok(md.includes('## makefile'))
  assert.ok(md.includes('## pnpm scripts'))
  assert.ok(md.includes('`make_build` — `make build`'))
  assert.ok(md.includes('Variables: `VERSION`'))
})

test('renderMarkdown handles an empty book', () => {
  assert.ok(renderMarkdown([]).includes('No build commands were discovered.'))
})
