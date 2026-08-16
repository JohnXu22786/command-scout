[简体中文](README.zh.md)

# command-scout

Discover the build commands a project already declares — Makefile targets,
package.json scripts (npm / yarn / pnpm / bun), just recipes, deno tasks —
and expose them to the agent as ready-to-run tools. Instead of guessing how
to build, test or lint a project, the agent reads exactly what the project
itself defines.

- **Scans at startup**: on plugin activation the workspace root is inspected
  once and every command found becomes a registered tool.
- **Multiple build systems**: Makefile, package.json scripts with automatic
  runner detection, justfile, deno.json / deno.jsonc tasks.
- **Rich metadata**: descriptions (`##` comments in Makefiles, trailing
  text in justfiles), prerequisite lists, referenced variables, argument
  hints.
- **Safe naming**: tool names are deterministic (`make_build`, `pnpm_dev`,
  `just_lint`) and collisions are resolved with numeric suffixes.
- **Self-contained**: zero runtime dependencies, plain Node.js ESM, works
  with or without a harness — a CLI (`scan` / `docs`) ships in the box.

## How it works

```
project root
   │  Makefile  package.json  justfile  deno.json(c)
   ▼
collectors ──► RecipeBook (dedupe, order, resolve names)
   │
   ├─► dsh adapter: registers one tool per recipe (ctx.tools.register)
   └─► CLI:        table / JSON / generated COMMANDS.md
```

Each collector parses one file format into **recipes**. A recipe carries the
command line to run, a description, its source file, prerequisites, and the
variables it accepts. The adapter turns recipes into agent tools whose
`execute` runs the command through the platform shell and returns stdout,
stderr and the exit code.

## Requirements

- Node.js >= 18.17
- For the dsh integration: a working DeepSeek Harness install with
  `@deepseek-ai/dsh-base` (provides the `tools` service), and pnpm for
  `dsh plugin` management.

## Installation

### Installing in DSH

```sh
dsh plugin --profile demo add github:JohnXu22786/command-scout
```

### As a dsh bundle (recommended)

A bundle is an npm package that contributes a configuration layer. From the
directory containing this checkout:

```sh
dsh plugin --profile demo add ./path/to/command-scout
```

This initializes the `demo` profile (with `@deepseek-ai/dsh-base` as its
first bundle), links the checkout, and appends `dsh-command-scout` to the
profile's bundle list because `package.json` declares `dsh.bundle`. Verify
and boot:

```sh
dsh --profile demo --dump-config   # shows the "# == dsh-command-scout" layer
dsh --profile demo
```

The contributed patch layer (`cordis.patch.yml`) inserts one plugin row
mounting the adapter entry (a package subpath, resolved through the
package's `exports` map):

```yaml
- insert:
    - id: command-scout
      name: dsh-command-scout/adapter
```

### As a patch overlay (no packaging)

Point the plugin row directly at the adapter source. Create an overlay file
`command-scout-patch.yml`:

```yaml
- insert:
    - id: command-scout
      name: '<abs-path>/src/dsh-adapter.js'
```

and pass it to the harness:

```sh
dsh --patch ./command-scout-patch.yml
```

### Standalone (no harness)

```sh
node bin/command-scout.mjs scan --root /path/to/project
npm install -g .     # provides the `command-scout` command
```

## Plugin contract

The adapter (`dsh-command-scout/adapter`) is a Cordis plugin. The harness
loader validates and defaults the config through the exported Schemastery
schema, waits for the declared services, calls `apply(ctx, config)`, and
calls the returned disposer on unload or config hot-reload. The package
main (`dsh-command-scout`) deliberately stays free of harness imports and
exposes only the embedding API.

| Export  | Kind      | Purpose                                        |
| ------- | --------- | ---------------------------------------------- |
| `name`  | string    | `command-scout`                                |
| `inject`| string[]  | `['tools']` — activation waits for the service |
| `Config`| schema    | validated configuration (below)                |
| `apply` | function  | scans the root, registers tools, returns a disposer |

### Events

- `tools/change` is emitted by the harness registry for every register and
  unregister, so UIs observing the registry refresh automatically.
- The plugin itself emits no events; it only registers tools on activation.

### Re-scanning

Discovery happens once per activation. Editing a Makefile or package.json
does not re-trigger a scan; reload the plugin (config hot-reload or a new
session) to refresh the tool set.

## Configuration

Configuration is supplied through the plugin row's `config` (in
`cordis.patch.yml` or the profile patch). All fields have defaults; the
example below shows every option:

```yaml
- insert:
    - id: command-scout
      name: dsh-command-scout/adapter
      config:
        root: '.'                    # directory scanned, relative to process cwd
        collectors:
          makefile:
            enabled: true
          scripts:
            enabled: true
            runner: auto             # auto | npm | yarn | pnpm | bun
            lockfilePriority:        # probed in order by runner: auto
              - pnpm-lock.yaml
              - yarn.lock
              - bun.lockb
              - bun.lock
              - package-lock.json
          justfile:
            enabled: true
          deno:
            enabled: true
        naming:
          style: scoped              # scoped | flat
        execution:
          timeoutMs: 120000          # per-command hard budget
```

### Runner detection (`scripts`)

`runner: auto` resolves in this order:

1. the `packageManager` field of package.json (`"pnpm@9.1.0"` → pnpm),
2. the first lockfile present, in `lockfilePriority` order,
3. npm as fallback.

The resolved runner also names the tools (`pnpm_dev` vs `npm_dev`), so two
projects using different runners never collide.

### Naming

- `scoped` (default): `make_build`, `pnpm_dev`, `just_lint`, `deno_serve`.
- `flat`: bare names (`build`, `dev`); on collision the first recipe keeps
  the bare name and later ones get numeric suffixes (`dev_2`).

Tool names only ever contain lowercase letters, digits and underscores
(names with no such characters at all, e.g. CJK-only script names, get a
deterministic `task_<hash>` form), and the reserved harness name `run_code`
is never produced.

## Tools the agent gets

One tool per command, named as above. Example for a Makefile target:

```
make_build — Project makefile command "build" (from Makefile).
Compile the release bundle
Run: make build
Acceptable variables: VERSION, CC (pass as VAR=value via "args")
Prerequisites: clean
Additional shell arguments can be appended through the "args" parameter.
```

Every tool accepts one optional parameter, `args`: a string appended to the
command line verbatim. It is the single extension point for flags and
overrides (`--port 8080`, `VERSION=2.0.0`).

Execution semantics:

- runs through the platform shell with the scan root as working directory,
- hard timeout per `execution.timeoutMs`; timeouts and harness cancellation
  kill the whole process tree (not just the shell wrapper), so build tools
  cannot leak as orphan processes,
- stdout/stderr captured and truncated at 1 MiB per stream,
- returns `{ command, ok, exitCode, stdout, stderr, killed, durationMs }`.

> **Security note**: commands run as the harness user with the project's own
> definitions, and `args` is appended verbatim — both are shell code by
> design. The harness approval policy (`tools/pre-execute`) still applies to
> every call; run under a workspace-write sandbox as usual.

## CLI

The standalone CLI needs no harness:

```sh
# Inspect a project's commands as a table
command-scout scan --root path/to/project

# Machine-readable output
command-scout scan --root path/to/project --format json

# Generate a COMMANDS.md reference document
command-scout docs --root path/to/project [--output COMMANDS.md]
```

Example table output:

```
source    name              command           description
makefile  build             make build        Compile the release bundle
makefile  clean             make clean        Remove build artifacts
scripts   dev               pnpm run dev      vite
scripts   test              pnpm run test     vitest run
```

## Programming interface

```js
import { discover, runCommand } from 'dsh-command-scout'

const { book, diagnostics, detectedFiles } = discover('.')
const toolNames = book.assignToolNames('scoped')
for (const recipe of book.entries()) {
  console.log(toolNames.get(recipe.id), recipe.command)
}

const result = await runCommand('make build', { cwd: '.', timeoutMs: 30_000 })
console.log(result.stdout)
```

Exports: `discover`, `RecipeBook`, `createRecipe`, `runCommand`,
`renderTable` / `renderJson` / `renderMarkdown`, `normalizeConfig`,
`DEFAULT_CONFIG`. (The plugin contract `name` / `Config` / `apply` /
`inject` is exported from the `dsh-command-scout/adapter` subpath.)

## Development

```sh
node --test          # run the test suite (built-in node:test, no deps)
node bin/command-scout.mjs scan --root test/fixtures/mixed   # smoke test
```

Test fixtures live in `test/fixtures/` (mixed project, per-runner lockfile
projects, empty project).

## Project layout

```
bin/command-scout.mjs      CLI launcher
src/config.js              defaults and config normalization
src/recipe.js              the Recipe domain object
src/recipe-book.js         aggregation, dedupe, naming, ordering
src/discover.js            scan orchestration (the Scout)
src/execute.js             shell execution with capture and timeouts
src/render.js              table / JSON / Markdown rendering
src/cli.js                 CLI implementation
src/dsh-adapter.js         the Cordis plugin surface
src/collectors/            one module per build system
test/                      node:test suite + fixtures
```

## License

[MIT](LICENSE)
