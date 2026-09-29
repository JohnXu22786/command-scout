import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { main, parseArgs } from '../src/cli.js'

const FIXTURES = fileURLToPath(new URL('./fixtures/mixed', import.meta.url))

function captureIo() {
  const lines = { out: [], err: [] }
  return {
    io: {
      log: (...args) => lines.out.push(args.join(' ')),
      error: (...args) => lines.err.push(args.join(' ')),
    },
    lines,
  }
}

test('parseArgs handles flags with inline values and --flag=value', () => {
  assert.deepEqual(parseArgs(['--root', 'x', '--format=json']), {
    root: 'x', format: 'json', output: undefined,
  })
  assert.deepEqual(parseArgs(['--help']), { help: true })
  assert.deepEqual(parseArgs(['--version']), { version: true })
  assert.throws(() => parseArgs(['--nope']), /unknown flag/)
  assert.throws(() => parseArgs(['stray']), /unexpected argument/)
})

test('scan prints a table of discovered commands', async () => {
  const { io, lines } = captureIo()
  const code = await main(['scan', '--root', FIXTURES], io)
  assert.equal(code, 0)
  assert.ok(lines.out.join('\n').includes('pnpm run dev'))
  assert.ok(lines.out.join('\n').includes('make build'))
})

test('scan --format json emits machine-readable output', async () => {
  const { io, lines } = captureIo()
  const code = await main(['scan', '--root', FIXTURES, '--format', 'json'], io)
  assert.equal(code, 0)
  const payload = JSON.parse(lines.out.join('\n'))
  assert.ok(payload.commands.some(c => c.id === 'makefile:build'))
  assert.ok(payload.commands.some(c => c.id === 'scripts:dev'))
})

test('scan on an empty project reports no build files', async () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-empty-'))
  try {
    const { io, lines } = captureIo()
    const code = await main(['scan', '--root', empty], io)
    assert.equal(code, 0)
    assert.ok(lines.out.join('\n').includes('No build files found'))
  } finally {
    fs.rmSync(empty, { recursive: true, force: true })
  }
})

test('docs writes COMMANDS.md and reports the count', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-docs-'))
  try {
    fs.copyFileSync(path.join(FIXTURES, 'Makefile'), path.join(dir, 'Makefile'))
    const { io, lines } = captureIo()
    const output = path.join(dir, 'Commands.md')
    const code = await main(['docs', '--root', dir, '--output', output], io)
    assert.equal(code, 0)
    assert.ok(lines.out.join('\n').includes('Wrote'))
    const content = fs.readFileSync(output, 'utf8')
    assert.ok(content.includes('# Project Commands'))
    assert.ok(content.includes('make_build'))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('top-level --help and --version work as commands', async () => {
  const { io: helpIo, lines: helpLines } = captureIo()
  const helpCode = await main(['--help'], helpIo)
  assert.equal(helpCode, 0)
  assert.ok(helpLines.out.join('\n').includes('Usage:'))

  const { io: versionIo, lines: versionLines } = captureIo()
  const versionCode = await main(['--version'], versionIo)
  assert.equal(versionCode, 0)
  assert.ok(versionLines.out.join('\n').includes('0.1.0'))
})

test('unknown command exits with an error', async () => {
  const { io, lines } = captureIo()
  const code = await main(['frobnicate'], io)
  assert.equal(code, 1)
  assert.ok(lines.err.some(l => l.includes('unknown command')))
})
