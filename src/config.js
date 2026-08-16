/**
 * Configuration model shared by every entry point of command-scout.
 *
 * The dsh adapter exposes the same shape as a validated Schemastery schema
 * (see dsh-adapter.js), the CLI accepts it as JSON flags, and this module
 * keeps one canonical set of defaults plus a defensive deep-merge used when
 * callers construct config objects by hand (tests, embedding plugins).
 */

/** Canonical default configuration. */
export const DEFAULT_CONFIG = {
  /** Directory to scan for build files, relative to the process cwd. */
  root: '.',
  /** Per-collector switches and options. */
  collectors: {
    makefile: {
      enabled: true,
    },
    scripts: {
      enabled: true,
      /**
       * 'auto' probes, in order: the `packageManager` field of package.json,
       * then lockfiles listed in `lockfilePriority`, then npm.
       */
      runner: 'auto',
      /** Lockfile names probed by `runner: 'auto'`, first hit wins. */
      lockfilePriority: [
        'pnpm-lock.yaml',
        'yarn.lock',
        'bun.lockb',
        'bun.lock',
        'package-lock.json',
      ],
    },
    justfile: {
      enabled: true,
    },
    deno: {
      enabled: true,
    },
  },
  /**
   * Tool-name generation. 'scoped' prefixes every tool with its source
   * (`make_build`, `pnpm_dev`); 'flat' uses the bare name (`build`, `dev`)
   * and falls back to the scoped form on collision.
   */
  naming: {
    style: 'scoped',
  },
  execution: {
    /** Per-run time budget in milliseconds for agent-triggered commands. */
    timeoutMs: 120_000,
  },
}

/** Collectors in discovery order; also the tool-name scoping order. */
export const COLLECTOR_ORDER = ['makefile', 'scripts', 'justfile', 'deno']

/**
 * Deep-merge `patch` over `base` for plain objects; arrays and scalars from
 * `patch` win. Used to fold partial user config over the defaults.
 */
export function mergeConfig(base, patch) {
  if (patch === undefined || patch === null) return base
  if (typeof base !== 'object' || base === null || Array.isArray(base)) {
    return patch
  }
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
    return patch
  }
  const out = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    out[key] = mergeConfig(base[key], value)
  }
  return out
}

/**
 * Fold any partial config over {@link DEFAULT_CONFIG}, validating only the
 * fields command-scout itself reads. Heavy validation lives in the dsh
 * schema; this function is a last line of defence for programmatic use.
 */
export function normalizeConfig(input = {}) {
  const cfg = mergeConfig(structuredClone(DEFAULT_CONFIG), input)

  if (typeof cfg.root !== 'string' || cfg.root.length === 0) {
    throw new TypeError('config.root must be a non-empty string')
  }
  if (!['scoped', 'flat'].includes(cfg.naming.style)) {
    throw new TypeError('config.naming.style must be "scoped" or "flat"')
  }
  const timeout = cfg.execution.timeoutMs
  if (!Number.isInteger(timeout) || timeout < 1) {
    throw new TypeError('config.execution.timeoutMs must be a positive integer')
  }
  if (cfg.collectors.scripts.runner !== 'auto'
    && !['npm', 'yarn', 'pnpm', 'bun'].includes(cfg.collectors.scripts.runner)) {
    throw new TypeError('config.collectors.scripts.runner must be "auto", "npm", "yarn", "pnpm" or "bun"')
  }
  return cfg
}
