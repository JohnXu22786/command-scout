[English](README.md)

# command-scout

发现项目已声明的构建命令——Makefile 目标、package.json 脚本（npm / yarn / pnpm / bun）、just 配方、deno 任务——并把它们作为可调用的 agent 工具暴露给智能体。agent 无需猜测项目如何构建、测试或 lint，而是直接读取项目自身的定义。

- **启动时扫描**：插件激活时对工作区根目录扫描一次，发现的每个命令都会注册为一个工具。
- **多种构建系统**：Makefile、带自动 runner 检测的 package.json 脚本、justfile、deno.json / deno.jsonc 任务。
- **丰富的元数据**：描述（Makefile 中的 `##` 注释、justfile 中的尾部文本）、前置条件列表、引用的变量、参数提示。
- **安全的命名**：工具名是确定性的（`make_build`、`pnpm_dev`、`just_lint`），冲突用数字后缀解决。
- **零依赖**：纯 Node.js ESM，不需要任何运行时依赖，可独立运行也可接入 harness——内置 CLI（`scan` / `docs`）。

## 工作原理

```
project root
   │  Makefile  package.json  justfile  deno.json(c)
   ▼
collectors ──► RecipeBook (dedupe, order, resolve names)
   │
   ├─► dsh adapter: registers one tool per recipe (ctx.tools.register)
   └─► CLI:        table / JSON / generated COMMANDS.md
```

每个 collector 将一个文件格式解析为**配方（recipe）**。配方携带要运行的命令行、描述、来源文件、前置条件以及它接受的变量。adapter 把配方转换成 agent 工具，其 `execute` 通过平台 shell 运行命令并返回 stdout、stderr 和退出码。

## 环境要求

- Node.js >= 18.17
- dsh 集成需要：可用的 DeepSeek Harness 安装（含提供 `tools` 服务的 `@deepseek-ai/dsh-base`），以及用于 `dsh plugin` 管理的 pnpm。

## 安装

### 在 DSH 中安装

```sh
dsh plugin --profile demo add github:JohnXu22786/command-scout
```

### 作为 dsh bundle 安装（推荐）

bundle 是一个贡献配置层的 npm 包。在包含本检出目录的目录中执行：

```sh
dsh plugin --profile demo add ./path/to/command-scout
```

这会初始化 `demo` 配置（以 `@deepseek-ai/dsh-base` 作为第一个 bundle）、链接该检出目录，并因为 `package.json` 声明了 `dsh.bundle` 而把 `dsh-command-scout` 追加到该配置的 bundle 列表中。验证并启动：

```sh
dsh --profile demo --dump-config   # 显示 "# == dsh-command-scout" 层
dsh --profile demo
```

所贡献的补丁层（`cordis.patch.yml`）插入一行插件配置，挂载 adapter 入口（一个包子路径，通过包的 `exports` 映射解析）：

```yaml
- insert:
    - id: command-scout
      name: dsh-command-scout/adapter
```

### 作为补丁叠加层（不打包）

直接把插件行指向 adapter 源码。创建叠加文件 `command-scout-patch.yml`：

```yaml
- insert:
    - id: command-scout
      name: '<abs-path>/src/dsh-adapter.js'
```

并把它传给 harness：

```sh
dsh --patch ./command-scout-patch.yml
```

### 独立使用（无 harness）

```sh
node bin/command-scout.mjs scan --root /path/to/project
npm install -g .     # 提供 `command-scout` 命令
```

## 插件契约

adapter（`dsh-command-scout/adapter`）是一个 Cordis 插件。harness 加载器通过导出的 Schemastery schema 校验并默认化配置，等待声明要用的服务，调用 `apply(ctx, config)`，并在卸载或配置热重载时调用返回的 disposer。包的 main（`dsh-command-scout`）刻意不引入任何 harness，只暴露嵌入 API。

| 导出 | 类型 | 用途 |
| ------- | --------- | ---------------------------------------------- |
| `name`  | string    | `command-scout`                                |
| `inject`| string[]  | `['tools']` — 激活时等待该服务                 |
| `Config`| schema    | 已校验的配置（见下文）                         |
| `apply` | function  | 扫描根目录、注册工具、返回 disposer            |

### 事件

- `tools/change` 由 harness 注册表对每次注册和注销发出，因此观察该注册表的 UI 会自动刷新。
- 插件本身不发出任何事件；它只在激活时注册工具。

### 重新扫描

发现流程每次激活只执行一次。编辑 Makefile 或 package.json 不会重新触发扫描；重载插件（配置热重载或新会话）以刷新工具集。

## 配置

配置通过插件行的 `config` 提供（在 `cordis.patch.yml` 或 profile 补丁中）。所有字段都有默认值；下面的示例展示全部选项：

```yaml
- insert:
    - id: command-scout
      name: dsh-command-scout/adapter
      config:
        root: '.'                    # 扫描目录，相对于进程 cwd
        collectors:
          makefile:
            enabled: true
          scripts:
            enabled: true
            runner: auto             # auto | npm | yarn | pnpm | bun
            lockfilePriority:        # runner: auto 时按此顺序探测
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
          timeoutMs: 120000          # 每条命令的硬性时间预算
```

### Runner 检测（`scripts`）

`runner: auto` 按此顺序解析：

1. package.json 的 `packageManager` 字段（`"pnpm@9.1.0"` → pnpm），
2. 按 `lockfilePriority` 顺序存在的第一个锁文件，
3. 回退到 npm。

解析出的 runner 也决定工具名（`pnpm_dev` 与 `npm_dev`），因此使用不同 runner 的两个项目永远不会冲突。

### 命名

- `scoped`（默认）：`make_build`、`pnpm_dev`、`just_lint`、`deno_serve`。
- `flat`：裸名（`build`、`dev`）；冲突时第一个配方保留裸名，之后的用数字后缀（`dev_2`）。

工具名只含小写字母、数字和下划线（完全没有这类字符的名字，如纯 CJK 脚本名，会得到确定性的 `task_<hash>` 形式），且永远不会产出保留名 `run_code`。

## agent 获得的工具

每条命令一个工具，命名如上。Makefile 目标示例：

```
make_build — Project makefile command "build" (from Makefile).
Compile the release bundle
Run: make build
Acceptable variables: VERSION, CC (pass as VAR=value via "args")
Prerequisites: clean
Additional shell arguments can be appended through the "args" parameter.
```

每个工具接受一个可选参数 `args`：按原文追加到命令行末尾的字符串。它是标志和覆盖的唯一扩展点（`--port 8080`、`VERSION=2.0.0`）。

执行语义：

- 在扫描根目录作为工作目录的前提下通过平台 shell 运行，
- 按 `execution.timeoutMs` 设置硬性超时；超时和 harness 取消会杀掉整个进程树（不只是 shell 包装进程），因此构建工具不会泄漏为孤儿进程，
- stdout/stderr 被捕获并在每流 1 MiB 处截断，
- 返回 `{ command, ok, exitCode, stdout, stderr, killed, durationMs }`。

> **安全说明**：命令以 harness 用户的身份、使用项目自身的定义运行，且 `args` 被原文追加——两者本身就是 shell 代码。harness 的审批策略（`tools/pre-execute`）依然作用于每次调用；照常在工作区写入沙箱下运行。

## CLI

独立 CLI 不需要 harness：

```sh
# 以表格查看项目的命令
command-scout scan --root path/to/project

# 机器可读输出
command-scout scan --root path/to/project --format json

# 生成 COMMANDS.md 参考文档
command-scout docs --root path/to/project [--output COMMANDS.md]
```

示例表格输出：

```
source    name              command           description
makefile  build             make build        Compile the release bundle
makefile  clean             make clean        Remove build artifacts
scripts   dev               pnpm run dev      vite
scripts   test              pnpm run test     vitest run
```

## 编程接口

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

导出：`discover`、`RecipeBook`、`createRecipe`、`runCommand`、`renderTable` / `renderJson` / `renderMarkdown`、`normalizeConfig`、`DEFAULT_CONFIG`。（插件契约 `name` / `Config` / `apply` / `inject` 从 `dsh-command-scout/adapter` 子路径导出。）

## 开发

```sh
node --test          # 运行测试套件（内置 node:test，无依赖）
node bin/command-scout.mjs scan --root test/fixtures/mixed   # 冒烟测试
```

测试夹具位于 `test/fixtures/`（混合项目、每种 runner 的锁文件项目、空项目）。

## 项目结构

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

## 许可证

[MIT](LICENSE)