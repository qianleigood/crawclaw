---
read_when:
  - 使用或修改 exec 工具
  - 调试 stdin 或 TTY 行为
summary: Exec 工具使用、stdin 模式和 TTY 支持
title: Exec 工具
x-i18n:
  generated_at: "2026-06-05T14:51:33Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 1d8eae4dc9cf787c878b4c3f83eaa35909d5610a5e8c6e0023c610efcfbb6993
  source_path: tools/exec.md
  workflow: 15
---

# Exec 工具

在工作区中运行 shell 命令。通过 `process` 支持前台和后台执行。
如果 `process` 被禁用，`exec` 同步运行并忽略 `yieldMs`/`background`。
后台会话按智能体作用域；`process` 仅能看到来自同一智能体的会话。

## 参数

- `command`（必需）
- `workdir`（默认为 cwd）
- `env`（键/值覆盖）
- `yieldMs`（默认 10000）：延迟后自动后台
- `background`（布尔值）：立即后台
- `timeout`（秒，默认 1800）：过期终止
- `pty`（布尔值）：在可用时在伪终端中运行（仅 TTY CLI、编码智能体、终端 UI）
- `security`（`deny | allowlist | full`）：主机执行强制模式
- `ask`（`off | on-miss | always`）：主机执行审批提示
- `elevated`（布尔值）：请求提升模式（gateway 主机）；仅当 elevated 解析为 `full` 时强制 `security=full`

注意事项：

- `elevated` 强制 `host=gateway`；仅在当前会话/提供商启用提升访问时可用。
- Gateway 主机审批由 `~/.crawclaw/exec-approvals.json` 控制。
- `host=node` 不再支持。
- 在非 Windows 主机上，exec 在设置时使用 `SHELL`；如果 `SHELL` 是 `fish`，它优先使用 `PATH` 中的 `bash`（或 `sh`）以避免 fish 不兼容脚本，然后在两者都不存在时回退到 `SHELL`。
- 在 Windows 主机上，exec 优先 PowerShell 7（`pwsh`）发现（Program Files、ProgramW6432，然后 PATH），然后回退到 Windows PowerShell 5.1。
- 主机执行拒绝 `env.PATH` 和加载器覆盖（`LD_*`/`DYLD_*`）以防止二进制劫持或注入代码。
- 脚本预检检查（针对常见 Python/Node shell 语法错误）仅检查有效 `workdir` 边界内的文件。如果脚本路径解析到 `workdir` 外部，则跳过该文件的预检。

## 配置

- `tools.exec.notifyOnExit`（默认：true）：为 true 时，后台的 exec 会话在退出时排队系统事件并请求主会话唤醒。
- `tools.exec.approvalRunningNoticeMs`（默认：10000）：当需要审批的 exec 运行超过此时长时，发出单个"运行中"通知（0 禁用）。
- `tools.exec.ask`（默认：`off`）
- Gateway 主机的无审批主机 exec 是默认值。如果你想启用审批/允许列表行为，请同时收紧 `tools.exec.*` 和主机 `~/.crawclaw/exec-approvals.json`；参见 [Exec 审批](/tools/exec-approvals#no-approval-yolo-mode)。
- YOLO 来自主机策略默认值（`security=full`、`ask=off`），而非来自 `host=auto`。如果你想强制 gateway 路由，设置 `tools.exec.host` 或使用 `/exec host=gateway`。
- `tools.exec.strictInlineEval`（默认：false）：为 true 时，内联解释器 eval 形式如 `python -c`、`node -e`、`ruby -e`、`perl -e`、`php -r`、`lua -e` 和 `osascript -e` 始终需要显式审批。`allow-always` 仍可持久化良性解释器/脚本调用，但内联 eval 形式每次仍会提示。
- `tools.exec.safeBins`：stdin 唯一的安全二进制文件，无需显式允许列表条目即可运行。行为详情请参见[安全二进制文件](/tools/exec-approvals#safe-bins-stdin-only)。
- `tools.exec.safeBinTrustedDirs`：用于 `safeBins` 路径检查的额外显式信任目录。`PATH` 条目永远不会被自动信任。内置默认值是 `/bin` 和 `/usr/bin`。
- `tools.exec.safeBinProfiles`：每个安全二进制文件的可选自定义 argv 策略（`minPositional`、`maxPositional`、`allowedValueFlags`、`deniedFlags`）。

示例：

```json5
{
  tools: {
    exec: {
      pathPrepend: ["~/bin", "/opt/oss/bin"],
    },
  },
}
```

### PATH 处理

- `host=gateway`：将你的登录 shell `PATH` 合并到 exec 环境。`env.PATH` 覆盖被拒绝用于主机执行。守护进程本身仍以最小 `PATH` 运行：
  - macOS：`/opt/homebrew/bin`、`/usr/local/bin`、`/usr/bin`、`/bin`
  - Linux：`/usr/local/bin`、`/usr/bin`、`/bin`
    CrawClaw 通过内部环境变量在配置文件加载后前置 `env.PATH`（无 shell 插值）；`tools.exec.pathPrepend` 也适用此处。

## 会话覆盖（`/exec`）

使用 `/exec` 为 `host`、`security` 和 `ask` 设置**按会话**默认值。
发送不带参数的 `/exec` 以显示当前有效值。如果当前策略允许无审批提示的主机 exec，回复包括带有更安全配置形状的警告。

示例：

```
/exec host=auto security=allowlist ask=on-miss
```

## 授权模型

`/exec` 仅对**授权发送者**生效（渠道允许列表/配对加上 `commands.useAccessGroups`）。
它仅更新**会话状态**而不写入配置。要硬禁用 exec，通过工具策略拒绝它（`tools.deny: ["exec"]` 或按智能体）。除非你显式设置 `security=full` 和 `ask=off`，否则主机审批仍然适用。

## Exec 审批

参见 [Exec 审批](/tools/exec-approvals) 了解策略、允许列表和 UI 流程。

当需要审批时，exec 工具立即返回 `status: "approval-pending"` 和审批 ID。一旦批准（或拒绝/超时），Gateway 发出系统事件（`Exec finished` / `Exec denied`）。如果命令在 `tools.exec.approvalRunningNoticeMs` 后仍在运行，则发出单个 `Exec running` 通知。

## 允许列表 + 安全二进制文件

手动允许列表强制执行仅匹配**解析后的二进制路径**（无 basename 匹配）。当 `security=allowlist` 时，shell 命令仅在每个管道段都在允许列表中或是安全二进制文件时才自动允许。链接（`;`、`&&`、`||`）和重定向在允许列表模式下被拒绝，除非每个顶层段满足允许列表（包括安全二进制文件）。
重定向仍不支持。
持久化 `allow-always` 信任不绕过该规则：链接命令仍需要每个顶层段匹配。

`autoAllowSkills` 是 exec 审批中的独立便利路径。它不同于手动路径允许列表条目。对于严格的显式信任，保持 `autoAllowSkills` 禁用。

将两个控件用于不同任务：

- `tools.exec.safeBins`：小型、stdin 唯一流过滤器。
- `tools.exec.safeBinTrustedDirs`：安全二进制可执行文件路径的显式额外信任目录。
- `tools.exec.safeBinProfiles`：自定义安全二进制文件的显式 argv 策略。
- 允许列表：可执行文件路径的显式信任。

不要将 `safeBins` 视为通用允许列表，不要添加解释器/运行时二进制文件（例如 `python3`、`node`、`ruby`、`bash`）。如果你需要那些，使用显式允许列表条目并保持审批提示启用。
CrawClaw Desktop 和本地 Gateway API 在解释器/运行时 `safeBins` 条目缺少显式配置文件时发出警告，它们可以脚手架缺失的自定义 `safeBinProfiles` 条目。
它们还会在你将行为广泛的二进制文件如 `jq` 明确添加回 `safeBins` 时发出警告。
如果你明确允许列表解释器，启用 `tools.exec.strictInlineEval` 以使内联代码 eval 形式仍需要新的审批。

有关完整策略详情和示例，请参见 [Exec 审批](/tools/exec-approvals#safe-bins-stdin-only) 和[安全二进制文件 vs 允许列表](/tools/exec-approvals#safe-bins-versus-allowlist)。

## 示例

前台：

```json
{ "tool": "exec", "command": "ls -la" }
```

后台 + 轮询：

```json
{"tool":"exec","command":"npm run build","yieldMs":1000}
{"tool":"process","action":"poll","sessionId":"<id>"}
```

发送按键（tmux 风格）：

```json
{"tool":"process","action":"send-keys","sessionId":"<id>","keys":["Enter"]}
{"tool":"process","action":"send-keys","sessionId":"<id>","keys":["C-c"]}
{"tool":"process","action":"send-keys","sessionId":"<id>","keys":["Up","Up","Enter"]}
```

提交（仅发送 CR）：

```json
{ "tool": "process", "action": "submit", "sessionId": "<id>" }
```

粘贴（默认带括号）：

```json
{ "tool": "process", "action": "paste", "sessionId": "<id>", "text": "line1\nline2\n" }
```

## apply_patch

`apply_patch` 是 `exec` 的子工具，用于结构化多文件编辑。
它默认对 OpenAI 和 OpenAI Codex 模型启用。仅在你想禁用它或将其限制为特定模型时才使用配置：

```json5
{
  tools: {
    exec: {
      applyPatch: { workspaceOnly: true, allowModels: ["gpt-5.2"] },
    },
  },
}
```

注意事项：

- 仅适用于 OpenAI/OpenAI Codex 模型。
- 工具策略仍然适用；`allow: ["write"]` 隐式允许 `apply_patch`。
- 配置位于 `tools.exec.applyPatch` 下。
- `tools.exec.applyPatch.enabled` 默认为 `true`；设为 `false` 可对 OpenAI 模型禁用该工具。
- `tools.exec.applyPatch.workspaceOnly` 默认为 `true`（工作区包含）。仅在你故意想让 `apply_patch` 在工作区目录外写入/删除时才设为 `false`。

## 相关

- [Exec 审批](/tools/exec-approvals) — shell 命令审批门控
- [后台进程](/gateway/background-process) — 长时运行 exec 和 process 工具
- [安全](/gateway/security) — 工具策略和提升访问
