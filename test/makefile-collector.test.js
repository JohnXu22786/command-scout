import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { parseMakefile } from '../src/collectors/makefile-collector.js'

const FIXTURE = fileURLToPath(new URL('./fixtures/mixed/Makefile', import.meta.url))
const MAKEFILE_TEXT = `# comment
VERSION ?= 1.0.0

build: clean ## Compile the release bundle
	@echo "building $(VERSION)"
	$(CC) -o app main.c

clean: ## Remove build artifacts
	rm -rf dist

%.o: %.c
	$(CC) -c $<

lint:
	@echo linting
`

test('parses targets, descriptions, dependencies and variables', () => {
  const recipes = parseMakefile(MAKEFILE_TEXT, 'Makefile')
  const byName = new Map(recipes.map(r => [r.name, r]))

  assert.deepEqual([...byName.keys()].sort(), ['build', 'clean', 'lint'])

  const build = byName.get('build')
  assert.equal(build.kind, 'makefile')
  assert.equal(build.command, 'make build')
  assert.equal(build.description, 'Compile the release bundle')
  assert.deepEqual(build.dependsOn, ['clean'])
  // $(VERSION) and $(CC) inside the recipe body surface as user variables;
  // the automatic $< variable and the assignment lines do not.
  assert.deepEqual(build.variables, ['VERSION', 'CC'])

  const clean = byName.get('clean')
  assert.equal(clean.description, 'Remove build artifacts')
  assert.deepEqual(clean.dependsOn, [])

  const lint = byName.get('lint')
  assert.equal(lint.description, '')
  assert.deepEqual(lint.variables, [])
})

test('usage hints mention variables when present', () => {
  const recipes = parseMakefile(MAKEFILE_TEXT, 'Makefile')
  const build = recipes.find(r => r.name === 'build')
  assert.equal(build.usage, 'make build [VAR=value ...]')
  const lint = recipes.find(r => r.name === 'lint')
  assert.equal(lint.usage, 'make lint')
})

test('ignores special targets, assignments, directives and pattern rules', () => {
  const recipes = parseMakefile(MAKEFILE_TEXT, 'Makefile')
  const names = recipes.map(r => r.name)
  assert.ok(!names.includes('.PHONY'))
  assert.ok(!names.includes('VERSION'))
  assert.ok(!names.includes('%.o'))
})

test('several targets on one line produce one recipe each', () => {
  const recipes = parseMakefile('all debug: ## build everything\n\tmake\n', 'Makefile')
  assert.deepEqual(recipes.map(r => r.name), ['all', 'debug'])
  assert.equal(recipes[0].description, 'build everything')
  assert.equal(recipes[0].dependsOn.length, 0)
})

test('double-colon rules and following ## lines are honored', () => {
  const text = 'docs::\n\tmake docs\n\t## more docs\nrelease: ## ship it\n\t## follow-up note\n\techo hi\n'
  const recipes = parseMakefile(text, 'Makefile')
  const docs = recipes.find(r => r.name === 'docs')
  assert.ok(docs, 'double-colon target parsed')
  const release = recipes.find(r => r.name === 'release')
  assert.equal(release.description, 'ship it follow-up note')
})

test('single # comments never leak into deps or descriptions', () => {
  const recipes = parseMakefile(
    'build: clean # plain comment\n\tmake\n',
    'Makefile',
  )
  assert.deepEqual(recipes[0].dependsOn, ['clean'])
  assert.equal(recipes[0].description, '')

  const empty = parseMakefile('note: # nothing here\n\ttrue\n', 'Makefile')
  assert.deepEqual(empty[0].dependsOn, [])
})

test('backslash continuations join before parsing', () => {
  const recipes = parseMakefile(
    'build: dep1 \\\n\tdep2 ## desc here\n\tmake\n',
    'Makefile',
  )
  assert.deepEqual(recipes[0].dependsOn, ['dep1', 'dep2'])
  assert.equal(recipes[0].description, 'desc here')
})

test('order-only prerequisites are dropped from dependsOn', () => {
  const recipes = parseMakefile('serve: app | logs ## run it\n\t./app\n', 'Makefile')
  assert.deepEqual(recipes[0].dependsOn, ['app'])
})

test('escaped dollar signs are not reported as variables', () => {
  const recipes = parseMakefile('print:\n\techo $$(LITERAL) $${OTHER}\n', 'Makefile')
  assert.deepEqual(recipes[0].variables, [])
})

test('returns empty list for empty input', () => {
  assert.deepEqual(parseMakefile('', 'Makefile'), [])
})
