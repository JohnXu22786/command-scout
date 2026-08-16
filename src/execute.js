/**
 * Command execution — turns a recipe into an agent-runnable action.
 *
 * Runs through the platform shell so behavior matches what a developer would
 * see in a terminal (aliases, PATH, `.bat`/`.cmd` shims on Windows). Output
 * is captured per stream and truncated to guard against runaway processes.
 *
 * Timeouts and cancellation kill the whole process TREE, not just the shell
 * wrapper: with `shell: true` the real command is a grandchild of the spawn
 * and would otherwise leak as an orphan still holding the stdio pipes.
 */
import { spawn, spawnSync } from 'node:child_process'

/** Per-stream capture cap in characters; keeps tool results bounded. */
export const MAX_CAPTURE_CHARS = 1_000_000

/**
 * Run one command line and capture its outcome.
 *
 * @param {string} command - full command line, run via the shell
 * @param {object} [options]
 * @param {string} [options.cwd] - working directory (defaults to process cwd)
 * @param {number} [options.timeoutMs] - hard kill of the whole tree after this many ms
 * @param {AbortSignal} [options.signal] - caller cancellation
 * @returns {Promise<{ok: boolean, exitCode: number, stdout: string, stderr: string, killed: boolean, durationMs: number}>}
 *   `exitCode` is -1 when the process was killed before exiting; `ok` is true
 *   only for a clean exit code 0.
 */
export function runCommand(command, options = {}) {
  return new Promise((resolve) => {
    const started = Date.now()
    let settled = false
    let killed = false
    let timer = null
    let child = null

    // Timeouts and cancellation kill the whole process TREE, not just the
    // shell wrapper: with `shell: true` the real command is a grandchild of
    // the spawn and would otherwise leak as an orphan still holding the
    // stdio pipes.
    const killTree = () => {
      if (child === null) return
      if (process.platform === 'win32') {
        try {
          spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
            stdio: 'ignore',
            windowsHide: true,
          })
        } catch {
          // taskkill missing or failed; the direct kill below still fires
        }
      } else {
        try {
          process.kill(-child.pid, 'SIGTERM')
        } catch {
          // no process group or already gone; fall through to SIGKILL
        }
        try {
          process.kill(-child.pid, 'SIGKILL')
        } catch {
          // already dead — fine
        }
      }
      try {
        child.kill('SIGKILL')
      } catch {
        // already dead — fine
      }
    }

    const onAbort = () => {
      killed = true
      killTree()
    }

    const settle = (value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      resolve(value)
    }

    const buffers = { out: '', err: '' }
    const capture = (stream, key) => {
      stream.on('data', (chunk) => {
        const text = chunk.toString()
        if (buffers[key].length < MAX_CAPTURE_CHARS) {
          buffers[key] += text.slice(0, MAX_CAPTURE_CHARS - buffers[key].length)
        }
      })
    }

    try {
      child = spawn(command, {
        cwd: options.cwd,
        shell: true,
        windowsHide: true,
        // On POSIX, detached gives the shell its own process group so the
        // whole tree can be signalled. On Windows it must stay off: detached
        // child stdio pipes receive no data there, and process-tree killing
        // already works via taskkill /T instead.
        detached: process.platform !== 'win32',
        env: process.env,
      })
    } catch (error) {
      // Synchronous spawn failure (non-string command, invalid options).
      settle({
        ok: false,
        exitCode: -1,
        stdout: '',
        stderr: error.message,
        killed: false,
        durationMs: 0,
      })
      return
    }

    if (child.stdout) capture(child.stdout, 'out')
    if (child.stderr) capture(child.stderr, 'err')

    if (options.signal?.aborted) {
      onAbort()
    } else {
      options.signal?.addEventListener('abort', onAbort, { once: true })
    }
    // A timeout of undefined must not arm the timer: setTimeout(fn, undefined)
    // would fire after 0ms and kill healthy commands instantly.
    if (options.timeoutMs !== undefined) {
      timer = setTimeout(() => {
        killed = true
        killTree()
      }, options.timeoutMs)
    }

    child.on('exit', (code, signal) => {
      // A tree-kill is a deliberate terminal outcome: return immediately
      // instead of waiting for the stdio pipes (which grandchildren may
      // still hold open).
      if (killed) {
        settle({
          ok: false,
          exitCode: -1,
          stdout: buffers.out,
          stderr: buffers.err,
          killed: true,
          durationMs: Date.now() - started,
        })
      }
    })
    child.on('close', (code, signal) => {
      // Normal path: exit plus closed stdio means all output was captured.
      if (killed) return // already settled on 'exit'
      settle({
        ok: code === 0,
        exitCode: code === null ? -1 : code,
        stdout: buffers.out,
        stderr: buffers.err,
        killed: false,
        durationMs: Date.now() - started,
      })
    })
    child.on('error', (error) => {
      // Asynchronous spawn failure (missing shell, invalid cwd). A later
      // close event is absorbed by `settle`.
      settle({
        ok: false,
        exitCode: -1,
        stdout: buffers.out,
        stderr: error.message,
        killed: false,
        durationMs: Date.now() - started,
      })
    })
  })
}
