/**
 * Makefile collector — reads GNU make targets from a project Makefile.
 *
 * What is recognized:
 *   - regular targets, including several targets sharing one rule (`a b: deps`)
 *   - the `## description` convention (in-line and on the following indented
 *     comment line), used by many projects as target documentation
 *   - prerequisites, surfaced as `dependsOn`
 *   - `$(VAR)` / `${VAR}` references inside recipes, surfaced as variables
 *
 * What is ignored: comment lines, variable assignments, include/conditional
 * directives, special targets (`.PHONY`, ...), pattern rules (`%.o: %.c`)
 * and lines that only contain recipes.
 */
import { createRecipe } from '../recipe.js'
import { readTextIfPresent, splitLines } from './common.js'

/** GNU make probes these files in this order; first hit wins. */
const MAKEFILE_NAMES = ['GNUmakefile', 'makefile', 'Makefile']

/** Single-character automatic variables must not surface as user variables. */
const AUTOMATIC_VARIABLE = /^[@^%*?+|<>]$/

const DIRECTIVE =
  /^(?:-?include|sinclude|export|unexport|define|endef|override|ifdef|ifndef|ifeq|ifneq|else|endif)\b/

/**
 * @param {string} root - absolute project directory
 * @param {object} [options] - collector options (unused today, kept for API symmetry)
 * @param {string[]} [notes] - diagnostics sink
 * @returns {{ recipes: object[], notes: string[] }}
 */
export function collect(root, options = {}, notes = []) {
  for (const name of MAKEFILE_NAMES) {
    const text = readTextIfPresent(root, name, notes)
    if (text === null) continue
    return { recipes: parseMakefile(text, name, notes), notes }
  }
  return { recipes: [], notes }
}

/** Extract the variable names referenced inside a recipe body. */
function collectVariables(recipeLines) {
  // `$$` is make's escape for a literal `$`, not a variable reference.
  const body = recipeLines.join('\n').replace(/\$\$/g, '')
  const found = new Set()
  const pattern = /\$\(([A-Za-z_][A-Za-z0-9_.-]*)\)|\$\{([A-Za-z_][A-Za-z0-9_.-]*)\}/g
  for (const match of body.matchAll(pattern)) {
    const name = match[1] ?? match[2]
    if (AUTOMATIC_VARIABLE.test(name)) continue
    found.add(name)
  }
  return [...found]
}

/**
 * Split the text after a rule separator into a documentation comment and the
 * rest. `##` marks the doc comment; a bare `#` (preceded by whitespace or at
 * line start) is an ordinary comment and also cuts the line. The doc comment
 * is returned separately so it can extend across following `##` lines.
 */
function splitComment(rest) {
  const doc = rest.indexOf('##')
  if (doc !== -1) {
    return { body: rest.slice(0, doc), description: rest.slice(doc + 2).trim() }
  }
  const comment = rest.search(/(?:^|\s)#/)
  if (comment !== -1) {
    return { body: rest.slice(0, comment), description: '' }
  }
  return { body: rest, description: '' }
}

/**
 * Parse one makefile's text into recipes. Pure function, unit-testable.
 * @returns {object[]}
 */
export function parseMakefile(text, sourceName) {
  const lines = splitLines(text)
  const recipes = []
  let index = 0

  while (index < lines.length) {
    let line = lines[index].trimEnd()
    index += 1

    // Backslash continuations join the following line before parsing.
    while (line.endsWith('\\') && index < lines.length) {
      line = `${line.slice(0, -1).trimEnd()} ${lines[index].trim()}`
      index += 1
    }

    if (line.length === 0 || line.startsWith('#')) continue
    if (/^[ \t]/.test(line)) continue // indented recipe / continuation line
    if (line.startsWith('.')) continue // special targets like .PHONY
    if (DIRECTIVE.test(line)) continue
    if (/^[A-Za-z0-9_.-]+[ \t]*::?[+?]?=/.test(line)) continue // variable assignment

    // Pattern rules and eval-style lines have no concrete target name.
    const separator = line.indexOf(':')
    if (separator === -1) continue
    if (line.slice(0, separator).includes('%') || line.slice(0, separator).includes('$')) continue

    const targets = line.slice(0, separator).trim().split(/\s+/).filter(Boolean)
    if (targets.length === 0) continue

    // Everything after the (possibly doubled) separator: deps + comments.
    const rest = line.slice(separator + 1).replace(/^:+/, '')
    const { body, description } = splitComment(rest)
    // Order-only prerequisites (`target: a | b`) add nothing for the agent.
    const deps = body.split('|')[0].trim().split(/\s+/).filter(Boolean)
    let descriptionText = description

    // Following indented `##` comment lines extend the description (GNU make
    // documentation convention); indented non-comment lines are the recipe.
    const recipeLines = []
    while (index < lines.length) {
      const next = lines[index]
      const trimmed = next.trim()
      if (trimmed.length === 0) {
        recipeLines.push('')
        index += 1
        continue
      }
      if (/^[ \t]/.test(next)) {
        if (trimmed.startsWith('##') && recipeLines.length === 0) {
          descriptionText += (descriptionText ? ' ' : '') + trimmed.slice(2).trim()
          index += 1
          continue
        }
        recipeLines.push(next)
        index += 1
        continue
      }
      break
    }

    const variables = collectVariables(recipeLines)
    const usage = variables.length > 0
      ? `make ${targets[0]} [VAR=value ...]`
      : `make ${targets[0]}`
    for (const target of targets) {
      recipes.push(createRecipe({
        kind: 'makefile',
        name: target,
        command: `make ${target}`,
        description: descriptionText,
        source: sourceName,
        dependsOn: deps,
        variables,
        usage,
      }))
    }
  }
  return recipes
}
