/**
 * Recipe — one executable command discovered from a build system.
 *
 * Recipes are the domain object every collector produces and every consumer
 * (tool registration, CLI table, generated docs) renders. Fields are kept
 * plain and JSON-safe so a RecipeBook can round-trip through `JSON.stringify`.
 */

/**
 * Build a recipe from collector output.
 *
 * @param {object} parts - recipe parts
 * @param {string} parts.kind - collector key, e.g. 'makefile' | 'scripts'
 * @param {string} parts.name - original name inside the build system
 * @param {string} parts.command - full command line the agent should run
 * @param {string} parts.description - human summary; may be empty
 * @param {string} parts.source - file the recipe came from (basename)
 * @param {string[]} [parts.dependsOn] - sibling targets this one needs first
 * @param {string[]} [parts.variables] - variable names accepted by the command
 * @param {string} [parts.usage] - canonical invocation hint
 * @param {string} [parts.runner] - resolved runner for 'scripts' recipes
 * @returns {object} the recipe
 */
export function createRecipe(parts) {
  const name = String(parts.name).trim()
  if (name.length === 0) {
    throw new TypeError('recipe name must be non-empty')
  }
  if (typeof parts.command !== 'string' || parts.command.trim().length === 0) {
    throw new TypeError('recipe command must be a non-empty string')
  }
  return {
    id: `${parts.kind}:${name}`,
    kind: parts.kind,
    name,
    command: parts.command,
    description: parts.description ?? '',
    source: parts.source ?? '',
    dependsOn: [...(parts.dependsOn ?? [])],
    variables: [...(parts.variables ?? [])],
    usage: parts.usage ?? parts.command,
    runner: parts.runner ?? null,
  }
}

/**
 * Normalize an arbitrary recipe name into a tool-safe token: lowercase,
 * non-alphanumeric runs collapse to a single underscore, leading/trailing
 * underscores trimmed. `build:css` -> `build_css`. A name with no ASCII
 * letters or digits at all (e.g. CJK-only) cannot become a valid token, so
 * it degrades to a deterministic `task_<crc32>` form instead of the generic
 * 'unnamed'.
 */
export function toSlug(name) {
  const raw = String(name).toLowerCase()
  const slug = raw.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  if (slug.length > 0) return slug
  return `task_${crc32(raw).toString(16)}`
}

/** CRC-32 of a string, used to keep degraded slugs deterministic. */
function crc32(text) {
  let crc = 0xffffffff
  for (let i = 0; i < text.length; i += 1) {
    crc ^= text.charCodeAt(i)
    for (let j = 0; j < 8; j += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** Prefix used to scope tool names per recipe kind. */
const SCOPE_BY_KIND = {
  makefile: 'make',
  justfile: 'just',
  deno: 'deno',
}

/** The scope token for a recipe (e.g. 'make', 'pnpm', 'just'). */
export function scopeToken(recipe) {
  if (recipe.kind === 'scripts') {
    return toSlug(recipe.runner ?? 'npm')
  }
  return toSlug(SCOPE_BY_KIND[recipe.kind] ?? recipe.kind)
}
