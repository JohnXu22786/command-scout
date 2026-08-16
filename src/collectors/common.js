/**
 * Shared helpers for collectors: build-file probing and text reading.
 */
import fs from 'node:fs'
import path from 'node:path'

/**
 * Resolve `root` against the process cwd and verify it is a directory.
 * @returns {string} absolute root path
 * @throws {Error} when the root does not exist or is not a directory
 */
export function resolveRoot(root) {
  const abs = path.resolve(root)
  let stat
  try {
    stat = fs.statSync(abs)
  } catch {
    throw new Error(`scan root does not exist: ${abs}`)
  }
  if (!stat.isDirectory()) {
    throw new Error(`scan root is not a directory: ${abs}`)
  }
  return abs
}

/**
 * Read a file's text, returning null when it is absent. Any other read error
 * (permissions, path type) is reported through `notes`. A UTF-8 BOM is
 * stripped so parsers never choke on editor-written files.
 */
export function readTextIfPresent(root, name, notes) {
  const full = path.join(root, name)
  let content
  try {
    content = fs.readFileSync(full, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    notes.push(`could not read ${full}: ${error?.message ?? String(error)}`)
    return null
  }
  return content.replace(/^\uFEFF/, '')
}

/** Strip CR characters so line parsing is identical on Windows and POSIX. */
export function splitLines(text) {
  return text.replace(/\r\n?/g, '\n').split('\n')
}
