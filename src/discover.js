/**
 * Discovery orchestration — the Scout.
 *
 * Walks a project root once, runs every enabled collector against the build
 * files present there, and folds the results into a RecipeBook. Each
 * collector is fault-isolated: a broken file or parser never aborts the scan
 * of the others; problems land in `diagnostics`.
 */
import { COLLECTOR_ORDER, normalizeConfig } from './config.js'
import { RecipeBook } from './recipe-book.js'
import { resolveRoot } from './collectors/common.js'
import fs from 'node:fs'
import path from 'node:path'
import { collect as collectMakefile } from './collectors/makefile-collector.js'
import { collect as collectScripts } from './collectors/script-collector.js'
import { collect as collectJustfile } from './collectors/justfile-collector.js'
import { collect as collectDeno } from './collectors/deno-collector.js'

const COLLECTORS = {
  makefile: collectMakefile,
  scripts: collectScripts,
  justfile: collectJustfile,
  deno: collectDeno,
}

/** Files each collector probes, used for the scan summary. */
const PROBED_FILES = {
  makefile: ['GNUmakefile', 'makefile', 'Makefile'],
  scripts: ['package.json'],
  justfile: ['justfile', 'Justfile'],
  deno: ['deno.json', 'deno.jsonc'],
}

/**
 * Scan a project and collect its commands.
 *
 * @param {string} [root] - project directory (defaults to config.root)
 * @param {object} [config] - partial config, folded over the defaults
 * @returns {{ book: RecipeBook, diagnostics: string[], detectedFiles: string[] }}
 */
export function discover(root, config = {}) {
  const cfg = normalizeConfig(config)
  const scanRoot = resolveRoot(root ?? cfg.root)
  const book = new RecipeBook(COLLECTOR_ORDER)
  const diagnostics = []
  const detectedFiles = []

  for (const key of COLLECTOR_ORDER) {
    const options = cfg.collectors[key]
    if (!options.enabled) continue
    // Case-insensitive dedup: on case-insensitive filesystems several
    // candidate names (Makefile vs makefile) denote the same file.
    const seen = new Set()
    for (const file of PROBED_FILES[key]) {
      const marker = file.toLowerCase()
      if (fs.existsSync(path.join(scanRoot, file)) && !seen.has(marker)) {
        seen.add(marker)
        detectedFiles.push(file)
      }
    }
    try {
      const result = COLLECTORS[key](scanRoot, options, diagnostics)
      book.addAll(result.recipes)
    } catch (error) {
      diagnostics.push(`collector "${key}" failed: ${error?.message ?? String(error)}`)
    }
  }

  return { book, diagnostics, detectedFiles, scanRoot }
}
