import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runCommand, MAX_CAPTURE_CHARS } from '../src/execute.js'

test('captures stdout and reports a clean exit', async () => {
  const result = await runCommand('node -e "console.log(\'hello scout\')"')
  assert.equal(result.ok, true)
  assert.equal(result.exitCode, 0)
  assert.equal(result.stdout.trim(), 'hello scout')
  assert.equal(result.stderr, '')
  assert.ok(result.durationMs >= 0)
})

test('non-zero exit is reported as failure with stderr', async () => {
  const result = await runCommand('node -e "console.error(\'boom\'); process.exit(3)"')
  assert.equal(result.ok, false)
  assert.equal(result.exitCode, 3)
  assert.equal(result.stderr.trim(), 'boom')
})

test('timeout kills the whole process tree and returns promptly', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-timeout-'))
  const marker = path.join(dir, 'marker.txt')
  // The grandchild would write the marker after 3s; the tree-kill must
  // prevent that and the call must not wait for the grandchild. The path is
  // embedded as a single-quoted JS literal so cmd.exe never re-splits it.
  const markerLiteral = marker.replace(/\\/g, '\\\\')
  const command = `node -e "setTimeout(()=>{require('fs').writeFileSync('${markerLiteral}','done')},3000)"`
  try {
    const result = await runCommand(command, { timeoutMs: 500, cwd: dir })
    assert.equal(result.ok, false)
    assert.equal(result.exitCode, -1)
    assert.equal(result.killed, true)
    assert.ok(result.durationMs < 3000, `expected prompt return, took ${result.durationMs}ms`)
    await new Promise(r => setTimeout(r, 2700))
    assert.equal(fs.existsSync(marker), false, 'grandchild survived the tree-kill')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('output is truncated at the capture cap', async () => {
  const result = await runCommand(
    `node -e "process.stdout.write('x'.repeat(${MAX_CAPTURE_CHARS + 1000}))"`,
  )
  assert.equal(result.stdout.length, MAX_CAPTURE_CHARS)
})

test('an aborted signal cancels the command', async () => {
  const controller = new AbortController()
  const pending = runCommand('node -e "setTimeout(() => {}, 10000)"', {
    signal: controller.signal,
  })
  controller.abort()
  const result = await pending
  assert.equal(result.ok, false)
  assert.equal(result.exitCode, -1)
  assert.equal(result.killed, true)
})

test('spawn failures become structured failed results', async () => {
  const result = await runCommand('node -e "process.exit(0)"', { cwd: 'Z:\\no-such-dir-xyz' })
  assert.equal(result.ok, false)
  assert.equal(result.exitCode, -1)
  assert.ok(result.stderr.length > 0)
})
