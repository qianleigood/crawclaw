---
read_when:
  - 你想了解 Task Flow 与后台任务的关系
  - 你在发布说明或文档中遇到 Task Flow
  - 你需要将旧的 ClawFlow 或 task-flow 术语映射到当前工作流
summary: Task Flow 兼容性边界，适用于 CrawClaw 工作流和后台任务
title: Task Flow
x-i18n:
  generated_at: "2026-06-05T14:01:22Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 070b600ab9c0313f5ca4918bd5a872ed54caa4d8d28d9aad2c7bf525e58eb921
  source_path: automation/taskflow.md
  workflow: 15
---

# Task Flow

Task Flow 作为兼容性术语保留，用于旧版 ClawFlow 和 task-flow 文档。在当前 Gateway 网关中，它不是一个独立的通用工作流引擎。新的多步骤自动化应使用 CrawClaw 工作流：Rust workflow 工具管理工作流草稿、注册表条目、版本、运行和 n8n 绑定，而[后台任务](/automation/tasks)仍然是分离工作账本。

## 何时使用工作流

当工作跨越多个顺序或分支步骤且需要可见资产以供审查、版本控制、运行和绑定到 n8n 时，使用工作流。对于单个后台操作，普通的[任务](/automation/tasks)就足够了。

| 场景                          | 使用         |
| ----------------------------- | ------------ |
| 单个后台作业                  | 普通任务     |
| 一次性提醒                    | Cron 任务    |
| 持久多步骤工作流资产          | 工作流 + n8n |
| 检查分离执行历史记录          | 后台任务     |
| 旧文档提及 ClawFlow/Task Flow | 本页面       |

## 当前边界

当前工作流所有权分配如下：

- **Rust workflow 工具**拥有工作流草稿、本地注册表状态、版本、匹配、运行以及启用、禁用、归档和删除等生命周期操作。
- **n8n**拥有当工作流绑定到 n8n workflow id 时部署的工作流图执行。
- **后台任务**拥有分离运行记录、状态检查、完成通知和清理。
- **CrawClaw Desktop 和 Gateway API**向操作员暴露工作流和任务状态。

Task Flow 不应被视为 n8n 之外的第二个工作流引擎。

## 迁移说明

- 较旧的 **ClawFlow** 链接重定向到此处。
- 较旧的对托管或镜像 Task Flow 状态的引用应作为工作流/任务集成说明来理解，而非独立 API 约定。
- 对于面向操作员的多步骤自动化，从 workflow 工具和 n8n workflow 架构开始。

## 工作流与任务的关系

工作流不会替换任务。工作流运行可以创建或引用任务记录，任务记录仍然是检查分离执行历史的地方。使用 Desktop 或 Gateway API 检查单个任务记录。

## 相关

- [后台任务](/automation/tasks) — 分离工作账本
- [自动化概览](/automation) — 所有自动化机制一览
- [Cron Jobs](/automation/cron-jobs) — 定时任务和主会话唤醒
- [n8n workflow 架构](/reference/n8n-workflow-architecture) — 当前工作流代理和 n8n 执行边界
