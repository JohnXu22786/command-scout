/**
 * justfile collector — reads recipes from a `just` command runner file.
 *
 * justfile recipe syntax (subset that matters here):
 *   name:                     plain recipe
 *   name ARGS*:               recipe accepting arguments
 *   name: description text    everything after the first colon is the summary
 * Recipe bodies are indented lines below the header; `{{VAR}}` references
 * inside a body are surfaced as variables.
 *
 * Ignored: settings/aliases/imports (lines starting with '.'), attribute
 * blocks (`[...]`), variable assignments (containing '='), comments, bodies.
 */
import { createRecipe } from '../recipe.js'
import { readTextIfPresent, splitLines } from './common.js'

const JUSTFILE_NAMES = ['justfile', 'Justfile']

/**
 * @param {string} root - absolute project directory
 * @param {object} [options] - unused today, kept for API symmetry
 * @param {string[]} [notes] - diagnostics sink
 * @returns {{ recipes: object[], notes: string[] }}
 */
export function collect(root, options = {}, notes = []) {
  for (const name of JUSTFILE_NAMES) {
    const text = readTextIfPresent(root, name, notes)
    if (text === null) continue
    return { recipes: parseJustfile(text, name, notes), notes }
  }
  return { recipes: [], notes }
}

/** Extract `{{NAME}}` variable references from a recipe body. */
function collectVariables(bodyLines) {
  const found = new Set()
  const pattern = /\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g
  for (const match of bodyLines.join('\n').matchAll(pattern)) {
    found.add(match[1])
  }
  return [...found]
}

/**
 * Parse justfile text into recipes. Pure function, unit-testable.
 * @returns {object[]}
 */
export function parseJustfile(text, sourceName) {
  const lines = splitLines(text)
  const recipes = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    index += 1
    const trimmed = line.trim()

    if (trimmed.length === 0 || trimmed.startsWith('#')) continue
    if (trimmed.startsWith('.')) continue // settings, aliases, imports, modules
    if (trimmed.startsWith('!')) continue // conditionals and imports
    if (trimmed.startsWith('[')) continue // attribute blocks
    if (/^[ \t]/.test(line)) continue // recipe body line

    // Non-recipe top-level lines: `set` statements, `alias` declarations,
    // `export`/`import`/`mod` statements, and variable assignments
    // (`x = ...`, `x := ...`, `x += ...`). These must be filtered BEFORE the
    // colon scan: `:=` contains a colon and would otherwise parse as a
    // recipe header.
    if (/^(?:set|alias|export|import|mod)\b/.test(trimmed)) continue
    if (/^[A-Za-z_][A-Za-z0-9_-]*\s*[:+]?=/.test(trimmed)) continue

    const colon = line.indexOf(':')
    if (colon === -1) continue
    const head = line.slice(0, colon).trim()
    if (head.length === 0) continue

    const tokens = head.split(/\s+/)
    const name = tokens[0]
    const args = tokens.slice(1)
    const description = line.slice(colon + 1).trim()

    // Collect the indented body until the next top-level line.
    const bodyLines = []
    while (index < lines.length) {
      const next = lines[index]
      if (next.trim().length === 0) {
        index += 1
        continue
      }
      if (/^[ \t]/.test(next)) {
        bodyLines.push(next)
        index += 1
        continue
      }
      break
    }

    const variables = collectVariables(bodyLines)
    recipes.push(createRecipe({
      kind: 'justfile',
      name,
      command: `just ${name}`,
      description,
      source: sourceName,
      variables,
      usage: args.length > 0 ? `just ${name} ${args.join(' ')}` : `just ${name}`,
    }))
  }
  return recipes
}
