/**
 * Command-line interface — lets developers inspect and document a project's
 * commands without running an agent harness.
 *
 *   command-scout scan [--root DIR] [--format table|json|markdown]
 *   command-scout docs  [--root DIR] [--output FILE]
 */
import fs from 'node:fs'
import path from 'node:path'
import { discover } from './discover.js'
import { renderJson, renderMarkdown, renderTable } from './render.js'

const USAGE = `command-scout — discover the build commands of a project

Usage:
  command-scout scan [--root DIR] [--format table|json|markdown]
  command-scout docs  [--root DIR] [--output FILE]
  command-scout --help | --version

Commands:
  scan    Scan the project and print its commands.
  docs    Generate a COMMANDS.md reference document.

Options:
  --root DIR      Directory to scan (default: current directory).
  --format FMT    Output format for scan: table (default), json, markdown.
  --output FILE   Destination for docs (default: COMMANDS.md next to --root).
  --help          Show this help.
  --version       Show the version.`

/** Minimal flag parser; unknown flags abort with the usage text. */
export function parseArgs(argv) {
  const args = [...argv]
  const flags = { root: undefined, format: undefined, output: undefined }
  while (args.length > 0) {
    const token = args.shift()
    if (token.startsWith('--')) {
      const [key, inline] = token.slice(2).split('=', 2)
      if (key === 'help') return { help: true }
      if (key === 'version') return { version: true }
      if (!['root', 'format', 'output'].includes(key)) {
        throw new Error(`unknown flag --${key}`)
      }
      const value = inline ?? args.shift()
      if (value === undefined) throw new Error(`flag --${key} needs a value`)
      flags[key] = value
      continue
    }
    throw new Error(`unexpected argument "${token}"`)
  }
  return flags
}

/** Normalize a user-provided --format value. */
function resolveFormat(value) {
  if (value === undefined || value === 'table') return 'table'
  if (value === 'json') return 'json'
  if (value === 'markdown') return 'markdown'
  throw new Error(`unknown format "${value}" (expected table, json or markdown)`)
}

/**
 * `scan` command body.
 * @returns {Promise<number>} process exit code
 */
export async function runScan(flags, io = console) {
  const format = resolveFormat(flags.format)
  const result = discover(flags.root ?? '.')
  const book = result.book

  if (format === 'json') {
    io.log(renderJson({
      scanRoot: result.scanRoot,
      detectedFiles: result.detectedFiles,
      recipes: book.entries(),
      diagnostics: result.diagnostics,
    }))
    return 0
  }

  if (result.detectedFiles.length === 0) {
    io.log(`No build files found in ${result.scanRoot}.`)
  } else {
    io.log(`Scanning ${result.scanRoot}: found ${result.detectedFiles.join(', ')}`)
  }
  for (const diagnostic of result.diagnostics) io.log(`! ${diagnostic}`)

  if (format === 'markdown') {
    io.log(renderMarkdown(book.entries(), {
      root: result.scanRoot,
      generatedAt: new Date().toISOString(),
      toolNames: book.assignToolNames('scoped'),
    }))
  } else {
    io.log('')
    io.log(renderTable(book.entries()))
  }
  return 0
}

/**
 * `docs` command body — writes a COMMANDS.md next to the scan root.
 * @returns {Promise<number>} process exit code
 */
export async function runDocs(flags, io = console) {
  const result = discover(flags.root ?? '.')
  const book = result.book
  const root = result.scanRoot
  const output = flags.output ?? path.join(root, 'COMMANDS.md')

  const markdown = renderMarkdown(book.entries(), {
    root,
    generatedAt: new Date().toISOString(),
    toolNames: book.assignToolNames('scoped'),
  })
  fs.writeFileSync(output, markdown, 'utf8')
  io.log(`Wrote ${output} (${book.size} commands).`)
  return 0
}

/** CLI entry point. */
export async function main(argv, io = console) {
  try {
    if (argv.length === 0) {
      io.log(USAGE)
      return 0
    }
    const [command, ...rest] = argv
    // Top-level --help / --version are commands of their own, matching the
    // usage text; the same flags after a subcommand are handled by parseArgs.
    if (command === '--help' || command === '-h') {
      io.log(USAGE)
      return 0
    }
    if (command === '--version' || command === '-v') {
      io.log(readVersion())
      return 0
    }
    const flags = parseArgs(rest)
    if (flags.help) {
      io.log(USAGE)
      return 0
    }
    if (flags.version) {
      io.log(readVersion())
      return 0
    }
    if (command === 'scan') return await runScan(flags, io)
    if (command === 'docs') return await runDocs(flags, io)
    throw new Error(`unknown command "${command}"`)
  } catch (error) {
    io.error(`error: ${error.message}`)
    io.error('')
    io.error(USAGE)
    return 1
  }
}

/** Read the package version for --version output. */
function readVersion() {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  return pkg.version
}
