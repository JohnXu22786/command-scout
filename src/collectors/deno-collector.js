/**
 * deno collector — reads the `tasks` table of deno.json / deno.jsonc.
 *
 * The JSONC flavor tolerates line comments, block comments and trailing
 * commas, which deno allows but plain JSON.parse rejects. `deno task name`
 * runs a task.
 */
import { createRecipe } from '../recipe.js'
import { readTextIfPresent } from './common.js'

const DENO_FILES = ['deno.json', 'deno.jsonc']

/**
 * @param {string} root - absolute project directory
 * @param {object} [options] - unused today, kept for API symmetry
 * @param {string[]} [notes] - diagnostics sink
 * @returns {{ recipes: object[], notes: string[] }}
 */
export function collect(root, options = {}, notes = []) {
  for (const name of DENO_FILES) {
    const text = readTextIfPresent(root, name, notes)
    if (text === null) continue
    const parsed = parseTasks(text, name, notes)
    if (parsed === null) continue // unreadable flavor; keep probing
    return { recipes: parsed, notes }
  }
  return { recipes: [], notes }
}

/**
 * Parse the tasks table out of a deno manifest. Returns null when the file
 * is not parseable so the caller can probe the next file name.
 */
function parseTasks(text, sourceName, notes) {
  let manifest
  try {
    manifest = JSON.parse(text)
  } catch {
    if (!sourceName.endsWith('.jsonc')) {
      notes.push(`${sourceName} is not valid JSON: ${firstLine(text)}`)
      return null
    }
    try {
      manifest = JSON.parse(stripJsonComments(text))
    } catch (error) {
      notes.push(`${sourceName} is not valid JSONC: ${error.message}`)
      return null
    }
  }

  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    notes.push(`${sourceName} must contain a JSON object`)
    return null
  }
  const tasks = manifest.tasks
  if (tasks === undefined || tasks === null) return []
  if (typeof tasks !== 'object' || Array.isArray(tasks)) {
    notes.push(`${sourceName} "tasks" must be a JSON object`)
    return []
  }

  const recipes = []
  for (const [name, command] of Object.entries(tasks)) {
    if (typeof command !== 'string') {
      notes.push(`task "${name}" does not hold a string command; skipped`)
      continue
    }
    recipes.push(createRecipe({
      kind: 'deno',
      name,
      command: `deno task ${name}`,
      description: command,
      source: sourceName,
      usage: `deno task ${name}`,
    }))
  }
  return recipes
}

/** Truncate a JSON error line to something readable. */
function firstLine(text) {
  const line = text.split('\n')[0]
  return line.length > 80 ? `${line.slice(0, 77)}...` : line
}

/**
 * Remove line comments, block comments and trailing commas from JSONC text.
 * String-aware: comment markers inside string literals are preserved.
 * Exported for unit tests.
 */
export function stripJsonComments(text) {
  let out = ''
  let i = 0
  let inString = false
  let stringQuote = ''
  while (i < text.length) {
    const char = text[i]
    const next = text[i + 1]
    if (inString) {
      out += char
      if (char === '\\') {
        out += next ?? ''
        i += 2
        continue
      }
      if (char === stringQuote) inString = false
      i += 1
      continue
    }
    if (char === '"' || char === "'") {
      inString = true
      stringQuote = char
      out += char
      i += 1
      continue
    }
    if (char === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i += 1
      continue
    }
    if (char === '/' && next === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1
      i += 2
      continue
    }
    if (char === ',') {
      // trailing comma before a closing bracket
      let j = i + 1
      while (j < text.length && /\s/.test(text[j])) j += 1
      if (text[j] === '}' || text[j] === ']') {
        i += 1
        continue
      }
    }
    out += char
    i += 1
  }
  return out
}
