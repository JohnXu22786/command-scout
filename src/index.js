/**
 * command-scout — public package surface.
 *
 * This module is the npm `main` entry and stays free of harness imports, so
 * embedding plugins and CLI tooling can use it without any dependency on the
 * dsh ecosystem. The Cordis plugin contract lives on the `./adapter` subpath
 * (`dsh-command-scout/adapter`) and is what the bundle patch row mounts.
 */
export * from './recipe.js'
export * from './recipe-book.js'
export * from './discover.js'
export * from './execute.js'
export * from './render.js'
export { DEFAULT_CONFIG, normalizeConfig, mergeConfig, COLLECTOR_ORDER } from './config.js'
