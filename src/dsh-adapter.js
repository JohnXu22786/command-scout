/**
 * dsh adapter — the pluggable surface the harness mounts.
 *
 * Loading this module through Cordis (via the bundle patch row) mounts the
 * plugin: on activation it scans the configured root, turns every discovered
 * command into a registered tool, and returns a disposer that unregisters
 * them all on unload or config hot-reload.
 *
 * Exports expected by Cordis: `name`, `Config` (Schemastery schema),
 * `apply(ctx, config)`, and `inject` for the services it depends on.
 */
import path from 'node:path'
import z from '@deepseek-ai/schemastery'
import { normalizeConfig } from './config.js'
import { discover } from './discover.js'
import { runCommand } from './execute.js'
import { kindLabel, shortDescription } from './render.js'
import { resolveRoot } from './collectors/common.js'

export const name = 'command-scout'

/** Services this plugin needs before it activates. */
export const inject = ['tools']

/** Validated configuration, defaulted by the harness loader. */
export const Config = z.object({
  /** Directory scanned for build files, relative to the process cwd. */
  root: z.string().default('.'),
  collectors: z.object({
    makefile: z.object({
      enabled: z.boolean().default(true),
    }).default({}),
    scripts: z.object({
      enabled: z.boolean().default(true),
      /** 'auto' probes packageManager, then lockfiles, then npm. */
      runner: z.union(['auto', 'npm', 'yarn', 'pnpm', 'bun']).default('auto'),
      lockfilePriority: z.array(z.string()).default([
        'pnpm-lock.yaml',
        'yarn.lock',
        'bun.lockb',
        'bun.lock',
        'package-lock.json',
      ]),
    }).default({}),
    justfile: z.object({
      enabled: z.boolean().default(true),
    }).default({}),
    deno: z.object({
      enabled: z.boolean().default(true),
    }).default({}),
  }).default({}),
  naming: z.object({
    /** 'scoped' prefixes tool names by source; 'flat' uses bare names. */
    style: z.union(['scoped', 'flat']).default('scoped'),
  }).default({}),
  execution: z.object({
    /** Hard time budget for agent-triggered commands, in milliseconds. */
    timeoutMs: z.natural().min(1).default(120_000),
  }).default({}),
})

/**
 * Cordis activation entry point.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {object} [config] - validated by {@link Config}
 * @returns {(() => void) | undefined} disposer unregistering every tool
 */
export function apply(ctx, config = {}) {
  let cfg
  try {
    cfg = normalizeConfig(config ?? {})
  } catch (error) {
    ctx.logger?.warn?.(`command-scout: invalid config: ${error.message}`)
    return undefined
  }

  let scanRoot
  try {
    scanRoot = resolveRoot(path.resolve(cfg.root))
  } catch (error) {
    ctx.logger?.warn?.(`command-scout: ${error.message}`)
    return undefined
  }

  const { book, diagnostics } = discover(scanRoot, cfg)
  const toolNames = book.assignToolNames(cfg.naming.style)

  const disposers = []
  for (const recipe of book.entries()) {
    try {
      disposers.push(ctx.tools.register(toToolDefinition(recipe, toolNames.get(recipe.id), scanRoot, cfg)))
    } catch (error) {
      diagnostics.push(`could not register "${recipe.id}": ${error?.message ?? String(error)}`)
    }
  }

  ctx.logger?.info?.(`command-scout: registered ${disposers.length} command tool(s) from ${scanRoot}`)
  for (const diagnostic of diagnostics) {
    ctx.logger?.warn?.(`command-scout: ${diagnostic}`)
  }

  if (disposers.length === 0) return undefined
  return () => {
    for (const dispose of disposers) dispose()
  }
}

/** Describe one recipe for the model, in the tool's description field. */
function describeRecipe(recipe) {
  const parts = [`Project ${kindLabel(recipe)} command "${recipe.name}" (from ${recipe.source}).`]
  const description = shortDescription(recipe, 240)
  if (description.length > 0) parts.push(description)
  parts.push(`Run: ${recipe.command}`)
  if (recipe.variables.length > 0) {
    parts.push(`Acceptable variables: ${recipe.variables.join(', ')} (pass as VAR=value via "args")`)
  }
  if (recipe.dependsOn.length > 0) {
    parts.push(`Prerequisites: ${recipe.dependsOn.join(', ')}`)
  }
  parts.push('Additional shell arguments can be appended through the "args" parameter.')
  return parts.join('\n')
}

/**
 * Validate and normalize the raw `args` a model call passes to a tool.
 * Accepts an object with an optional string `args` property.
 */
function readToolArgs(raw) {
  if (raw === undefined || raw === null) return ''
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError('arguments must be an object')
  }
  const extra = raw.args
  if (extra === undefined || extra === null) return ''
  if (typeof extra !== 'string') {
    throw new TypeError('"args" must be a string')
  }
  return extra
}

/** Render the captured command outcome as model-facing text. */
function renderOutcome(outcome) {
  const status = outcome.ok ? 'succeeded' : `failed (exit ${outcome.exitCode})`
  const lines = [`${outcome.command} ${status} in ${outcome.durationMs} ms`]
  if (outcome.killed) lines[0] = `command was killed after ${outcome.durationMs} ms`
  const show = (label, text) => {
    if (text.trim().length > 0) lines.push(`${label}\n${text}`)
  }
  show('stdout:', outcome.stdout)
  show('stderr:', outcome.stderr)
  return lines.join('\n')
}

/**
 * Build the tool definition dsh registers for one recipe.
 * @param {object} recipe
 * @param {string} toolName
 * @param {string} scanRoot
 * @param {object} cfg - normalized config
 * @returns {object} a ToolDefinition-shaped object
 */
function toToolDefinition(recipe, toolName, scanRoot, cfg) {
  return {
    name: toolName,
    description: describeRecipe(recipe),
    parameters: {
      type: 'object',
      properties: {
        args: {
          type: 'string',
          description: 'Extra arguments appended to the command line verbatim, e.g. "--port 8080" or "VAR=value".',
        },
      },
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          command: { type: 'string' },
          ok: { type: 'boolean' },
          exitCode: { type: 'integer' },
          stdout: { type: 'string' },
          stderr: { type: 'string' },
          killed: { type: 'boolean' },
          durationMs: { type: 'integer' },
        },
        required: ['command', 'ok', 'exitCode', 'stdout', 'stderr', 'killed', 'durationMs'],
        additionalProperties: false,
      },
      render: (_args, value) => [{ type: 'text', text: renderOutcome(value) }],
    },
    timeoutMs: cfg.execution.timeoutMs,
    execute: async (rawArgs, exec) => {
      const extra = readToolArgs(rawArgs)
      const command = extra ? `${recipe.command} ${extra}` : recipe.command
      const outcome = await runCommand(command, {
        cwd: scanRoot,
    // Harness-level cooperative timeout budget (a ToolDefinition field): the
    // registry may enforce it via the tool-call-timeout policy, and the same
    // budget is also applied inside execute as the hard shell timeout.
    timeoutMs: cfg.execution.timeoutMs,
        signal: exec.signal,
      })
      return {
        command: recipe.command,
        ok: outcome.ok,
        exitCode: outcome.exitCode,
        stdout: outcome.stdout,
        stderr: outcome.stderr,
        killed: outcome.killed,
        durationMs: outcome.durationMs,
      }
    },
  }
}
