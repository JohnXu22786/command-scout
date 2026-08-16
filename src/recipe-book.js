/**
 * RecipeBook — aggregation layer over collected recipes.
 *
 * Responsibilities: deduplicate identical recipes, resolve tool-name
 * collisions deterministically, keep a stable presentation order, and report
 * what was dropped so callers can surface diagnostics.
 */
import { scopeToken, toSlug } from './recipe.js'

/** Tool names the harness reserves for its own transports. */
const RESERVED_TOOL_NAMES = new Set(['run_code'])

export class RecipeBook {
  /** @type {object[]} */
  #recipes = []
  /** @type {Map<string, object>} id -> recipe (first one wins) */
  #byId = new Map()
  /** @type {string[]} */
  #notes = []
  /** @type {string[]} preferred kind grouping order */
  #kindOrder = []

  /**
   * @param {string[]} [kindOrder] - grouping order for {@link entries};
   *   kinds not listed appear after the listed ones, in first-seen order
   */
  constructor(kindOrder = []) {
    this.#kindOrder = kindOrder
  }

  get size() {
    return this.#recipes.length
  }

  get notes() {
    return [...this.#notes]
  }

  /**
   * Insert recipes in bulk. Duplicate ids are dropped with a note; the first
   * occurrence always wins, so discovery order defines precedence.
   */
  addAll(recipes) {
    for (const recipe of recipes) {
      if (this.#byId.has(recipe.id)) {
        this.#notes.push(`dropped duplicate recipe "${recipe.id}" (kept the first occurrence)`)
        continue
      }
      this.#byId.set(recipe.id, recipe)
      this.#recipes.push(recipe)
    }
  }

  /**
   * All recipes in stable presentation order: grouped by {@link kindOrder}
   * (first-seen order for unlisted kinds), alphabetical within a group.
   */
  entries() {
    const groups = new Map()
    for (const recipe of this.#recipes) {
      if (!groups.has(recipe.kind)) groups.set(recipe.kind, [])
      groups.get(recipe.kind).push(recipe)
    }
    const orderedKinds = [...this.#kindOrder, ...groups.keys()]
      .filter((kind, index, all) => groups.has(kind) && all.indexOf(kind) === index)
    const out = []
    for (const kind of orderedKinds) {
      const group = groups.get(kind)
      // Fixed locale keeps ordering identical on every machine.
      group.sort((a, b) => a.name.localeCompare(b.name, 'en'))
      out.push(...group)
    }
    return out
  }

  /**
   * Assign the final tool name for every recipe, resolving collisions with a
   * numeric suffix (`_2`, `_3`, ...). Deterministic across runs and locales.
   * Names reserved by the harness (`run_code`) are never produced; a
   * candidate colliding with one moves to the next free suffix.
   *
   * @param {'scoped'|'flat'} style - naming style from the config
   * @returns {Map<string, string>} recipe id -> tool name
   */
  assignToolNames(style) {
    const used = new Map()
    const result = new Map()
    for (const recipe of this.entries()) {
      const base = style === 'flat'
        ? toSlug(recipe.name)
        : `${scopeToken(recipe)}_${toSlug(recipe.name)}`
      let candidate = base
      let suffix = 2
      while (used.has(candidate) || RESERVED_TOOL_NAMES.has(candidate)) {
        candidate = `${base}_${suffix}`
        suffix += 1
      }
      used.set(candidate, recipe.id)
      result.set(recipe.id, candidate)
    }
    return result
  }
}
