import test from 'node:test'
import assert from 'node:assert/strict'
import { RecipeBook } from '../src/recipe-book.js'
import { createRecipe } from '../src/recipe.js'

function recipe(parts) {
  return createRecipe({ description: '', source: 'x', ...parts })
}

test('deduplicates identical recipe ids, first occurrence wins', () => {
  const book = new RecipeBook()
  book.addAll([
    recipe({ kind: 'makefile', name: 'build', command: 'make build', description: 'first' }),
    recipe({ kind: 'makefile', name: 'build', command: 'make build', description: 'second' }),
  ])
  assert.equal(book.size, 1)
  assert.equal(book.entries()[0].description, 'first')
  assert.ok(book.notes.some(n => n.includes('dropped duplicate')))
})

test('assignToolNames scopes by kind/runner with snake_case slugs', () => {
  const book = new RecipeBook()
  book.addAll([
    recipe({ kind: 'makefile', name: 'build', command: 'make build' }),
    recipe({ kind: 'scripts', name: 'build:css', command: 'npm run build:css', runner: 'npm' }),
    recipe({ kind: 'deno', name: 'serve', command: 'deno task serve' }),
  ])
  const names = book.assignToolNames('scoped')
  assert.equal(names.get('makefile:build'), 'make_build')
  assert.equal(names.get('scripts:build:css'), 'npm_build_css')
  assert.equal(names.get('deno:serve'), 'deno_serve')
})

test('colliding tool names get numeric suffixes deterministically', () => {
  const book = new RecipeBook()
  book.addAll([
    recipe({ kind: 'makefile', name: 'x', command: 'make x' }),
    recipe({ kind: 'scripts', name: 'x', command: 'npm run x', runner: 'make' }),
  ])
  const names = book.assignToolNames('scoped')
  assert.equal(names.get('makefile:x'), 'make_x')
  assert.equal(names.get('scripts:x'), 'make_x_2')
})

test('flat style falls back to scoped on collision', () => {
  const book = new RecipeBook()
  book.addAll([
    recipe({ kind: 'makefile', name: 'dev', command: 'make dev' }),
    recipe({ kind: 'scripts', name: 'dev', command: 'npm run dev', runner: 'npm' }),
  ])
  const names = book.assignToolNames('flat')
  assert.equal(names.get('makefile:dev'), 'dev')
  assert.equal(names.get('scripts:dev'), 'dev_2')
})

test('the reserved harness tool name is never produced', () => {
  const book = new RecipeBook()
  book.addAll([
    recipe({ kind: 'makefile', name: 'run_code', command: 'make run_code' }),
    recipe({ kind: 'scripts', name: 'run_code', command: 'npm run run_code', runner: 'npm' }),
  ])
  const scoped = book.assignToolNames('scoped')
  // scoped names carry a prefix, so they never collide with the bare
  // reserved name; flat names must move to the next free suffix
  assert.equal(scoped.get('makefile:run_code'), 'make_run_code')
  const flat = book.assignToolNames('flat')
  assert.equal(flat.get('makefile:run_code'), 'run_code_2')
  assert.equal(flat.get('scripts:run_code'), 'run_code_3')
})

test('entries are ordered by kind then name, stable across runs', () => {
  const book = new RecipeBook(['makefile', 'scripts'])
  book.addAll([
    recipe({ kind: 'scripts', name: 'z', command: 'npm run z', runner: 'npm' }),
    recipe({ kind: 'makefile', name: 'b', command: 'make b' }),
    recipe({ kind: 'makefile', name: 'a', command: 'make a' }),
  ])
  assert.deepEqual(book.entries().map(r => r.id), ['makefile:a', 'makefile:b', 'scripts:z'])
})

test('kinds absent from the constructor order appear after listed ones', () => {
  const book = new RecipeBook(['scripts'])
  book.addAll([
    recipe({ kind: 'deno', name: 'z', command: 'deno task z' }),
    recipe({ kind: 'scripts', name: 'a', command: 'npm run a', runner: 'npm' }),
  ])
  assert.deepEqual(book.entries().map(r => r.id), ['scripts:a', 'deno:z'])
})
