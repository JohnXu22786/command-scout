/**
 * Script collector — reads the `scripts` table of package.json.
 *
 * The runner used to invoke scripts is resolved by `detectRunner`:
 *   1. an explicit `runner` option,
 *   2. the `packageManager` field (`"pnpm@9.1.0"` -> pnpm),
 *   3. lockfiles probed in configured priority order,
 *   4. npm as the universal fallback.
 * The resolved runner also scopes tool names (`pnpm_dev` vs `npm_dev`).
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRecipe } from '../recipe.js'
import { readTextIfPresent } from './common.js'

const RUNNERS = ['npm', 'yarn', 'pnpm', 'bun']

const RUNNER_BY_LOCKFILE = {
  'pnpm-lock.yaml': 'pnpm',
  'yarn.lock': 'yarn',
  'bun.lockb': 'bun',
  'bun.lock': 'bun',
  'package-lock.json': 'npm',
}

/** Parse the `packageManager` field, which looks like `pnpm@9.1.0` or `yarn@1.22.22+sha...`. */
function runnerFromPackageManager(declared) {
  if (typeof declared !== 'string') return null
  const match = /^(npm|yarn|pnpm|bun)[@/]/.exec(declared)
  return match ? match[1] : null
}

/**
 * @param {string} root - absolute project directory
 * @param {object} [options] - { runner?, lockfilePriority? }
 * @param {string[]} [notes] - diagnostics sink
 * @returns {{ recipes: object[], notes: string[] }}
 */
export function collect(root, options = {}, notes = []) {
  const text = readTextIfPresent(root, 'package.json', notes)
  if (text === null) return { recipes: [], notes }

  let manifest
  try {
    manifest = JSON.parse(text)
  } catch (error) {
    notes.push(`package.json is not valid JSON: ${error.message}`)
    return { recipes: [], notes }
  }
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    notes.push('package.json must contain a JSON object')
    return { recipes: [], notes }
  }
  const scripts = manifest.scripts
  if (scripts === undefined || scripts === null) return { recipes: [], notes }
  if (typeof scripts !== 'object' || Array.isArray(scripts)) {
    notes.push('package.json "scripts" must be a JSON object')
    return { recipes: [], notes }
  }

  const runner = detectRunner(root, manifest, options, notes)
  const recipes = []
  for (const [name, command] of Object.entries(scripts)) {
    if (typeof command !== 'string') {
      notes.push(`script "${name}" does not hold a string command; skipped`)
      continue
    }
    recipes.push(createRecipe({
      kind: 'scripts',
      name,
      command: `${runner} run ${name}`,
      description: command,
      source: 'package.json',
      usage: `${runner} run ${name}`,
      runner,
    }))
  }
  return { recipes, notes }
}

/**
 * Resolve which runner to use for `run <name>` invocations.
 * Exported for unit tests.
 */
export function detectRunner(root, manifest, options, notes) {
  if (options.runner !== undefined && options.runner !== 'auto') {
    return options.runner
  }

  const declared = manifest?.packageManager
  if (declared !== undefined) {
    const fromField = runnerFromPackageManager(declared)
    if (fromField) return fromField
    notes.push(`unrecognized packageManager field ${JSON.stringify(declared)}; probing lockfiles`)
  }

  const priority = Array.isArray(options.lockfilePriority)
    ? options.lockfilePriority
    : ['pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'bun.lock', 'package-lock.json']
  for (const lockfile of priority) {
    const runner = RUNNER_BY_LOCKFILE[lockfile]
    if (runner === undefined) {
      notes.push(`ignoring unknown lockfile name in priority list: ${lockfile}`)
      continue
    }
    if (fs.existsSync(path.join(root, lockfile))) return runner
  }
  return RUNNERS[0]
}
