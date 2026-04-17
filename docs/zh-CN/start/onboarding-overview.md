---
read_when:
  - 选择一种新手引导路径
  - 设置新环境
sidebarTitle: Onboarding Overview
summary: CrawClaw 新手引导选项与流程概览
title: 新手引导概览
x-i18n:
  generated_at: "2026-03-16T06:27:56Z"
  model: gpt-5.4
  provider: openai
  source_hash: 8a22945f0780515be7ec1b94b5ff486828cf9b8f060ab598a31eb17ee0a5c60b
  source_path: start/onboarding-overview.md
  workflow: 15
---

# 新手引导概览

CrawClaw 使用 CLI 新手引导来配置认证、Gateway 网关和可选渠道，
适用于当前支持的主机环境。

## 选择你的新手引导路径

- 适用于 macOS、Linux 和 Windows（通过 WSL2）的 **CLI 新手引导**。

## CLI 新手引导

在终端中运行新手引导：

```bash
crawclaw onboard
```

当你希望完全控制 Gateway 网关、工作区、
渠道和 Skills 时，请使用 CLI 新手引导。文档：

- [CLI 新手引导](/start/wizard)
- [`crawclaw onboard` 命令](/cli/onboard)

无论你走哪条 onboarding 路径，当前主流程都会覆盖：

1. **模型提供商与认证**
2. **工作区**
3. **Gateway 网关**
4. **渠道**（可选）
5. **输出与展示**（默认回复可见性与 streaming 预设）
6. **Memory / Knowledge**（可选的 NotebookLM knowledge recall）
7. **守护进程**（可选）

## 自定义提供商

如果你需要一个未列出的端点，包括那些
公开标准 OpenAI 或 Anthropic API 的托管提供商，请在
在 CLI 新手引导中选择 **Custom Provider**。系统会要求你：

- 选择兼容 OpenAI、兼容 Anthropic，或 **Unknown**（自动检测）。
- 输入基础 URL 和 API 密钥（如果提供商需要）。
- 提供模型 ID 和可选别名。
- 选择一个 Endpoint ID，以便多个自定义端点可以共存。

如需详细步骤，请按照上面的 CLI 新手引导文档操作。
