/**
 * Rendering — turns a RecipeBook into human or machine-readable forms:
 * aligned text tables, JSON, and a generated COMMANDS.md document.
 */

/** Human-readable label for a recipe kind, used in tables and docs. */
export function kindLabel(recipe) {
  switch (recipe.kind) {
    case 'makefile': return 'makefile'
    case 'scripts': return `${recipe.runner ?? 'npm'} scripts`
    case 'justfile': return 'just'
    case 'deno': return 'deno'
    default: return recipe.kind
  }
}

/** One-line description, truncated for narrow table columns. */
export function shortDescription(recipe, width = 48) {
  const text = recipe.description.replace(/\s+/g, ' ').trim()
  if (text.length <= width) return text
  return `${text.slice(0, width - 1)}…`
}

/**
 * Render an aligned plain-text table of recipes. Column widths adapt to the
 * content but never exceed the per-column limits; longer cells are elided.
 * @param {object[]} recipes - in presentation order
 * @returns {string}
 */
export function renderTable(recipes) {
  const rows = recipes.map(r => [r.kind, r.name, r.command, shortDescription(r)])
  const limits = [10, 18, 36, 50]
  const widths = limits.map((limit, i) => Math.min(limit, Math.max(...rows.map(row => row[i].length), 0)))
  const pad = (text, width) => {
    if (text.length > width) return `${text.slice(0, width - 1)}…`
    return text.padEnd(width)
  }
  const line = (row) => row.map((cell, i) => pad(cell, widths[i])).join('  ').trimEnd()

  if (rows.length === 0) return '(no commands found)'
  const header = ['source', 'name', 'command', 'description']
  const out = [line(header), ...rows.map(line)]
  return out.join('\n')
}

/**
 * Serialize a full scan result as JSON.
 * @param {{ scanRoot: string, detectedFiles: string[], recipes: object[], diagnostics: string[] }} result
 * @returns {string}
 */
export function renderJson(result) {
  return JSON.stringify({
    root: result.scanRoot,
    detectedFiles: result.detectedFiles,
    commands: result.recipes,
    diagnostics: result.diagnostics,
  }, null, 2)
}

/**
 * Generate a Markdown command reference document (COMMANDS.md).
 * @param {object[]} recipes - in presentation order
 * @param {object} [options] - { root, generatedAt, toolNames? }
 * @returns {string}
 */
export function renderMarkdown(recipes, options = {}) {
  const lines = []
  lines.push('# Project Commands')
  lines.push('')
  lines.push(
    `Auto-generated command reference for the build commands discovered in `
    + `\`${options.root ?? '.'}\`.`,
  )
  if (options.generatedAt) {
    lines.push(`\n_Generated ${options.generatedAt}._`)
  }
  lines.push('')

  if (recipes.length === 0) {
    lines.push('No build commands were discovered.')
    return `${lines.join('\n')}\n`
  }

  // Group by kind while preserving the book's presentation order.
  const groups = new Map()
  for (const recipe of recipes) {
    if (!groups.has(recipe.kind)) groups.set(recipe.kind, [])
    groups.get(recipe.kind).push(recipe)
  }

  for (const [kind, group] of groups) {
    lines.push(`## ${kindLabel(group[0])}`)
    lines.push('')
    for (const recipe of group) {
      const toolName = options.toolNames?.get(recipe.id)
      const name = toolName ? `\`${toolName}\`` : recipe.name
      const bullet = [`- ${name} — \`${recipe.command}\``]
      if (recipe.description) bullet.push(`  ${recipe.description.replace(/\n/g, ' ')}`)
      if (recipe.variables.length > 0) {
        bullet.push(`  Variables: ${recipe.variables.map(v => `\`${v}\``).join(', ')}`)
      }
      lines.push(bullet.join('\n'))
    }
    lines.push('')
  }
  return `${lines.join('\n')}`
}
