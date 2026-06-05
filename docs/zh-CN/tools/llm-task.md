---
read_when:
  - 你想在工作流中有一个 JSON 唯一的 LLM 步骤
  - 你需要用于自动化的模式验证 LLM 输出
summary: 工作流中 JSON 唯一的 LLM 任务（可选插件工具）
title: LLM 任务
x-i18n:
  generated_at: "2026-06-05T14:51:53Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 3a0e552e916ce84847e1409a36d9a4df635e61c2974a2821d9bec0fb8ace7cd7
  source_path: tools/llm-task.md
  workflow: 15
---

# LLM 任务

`llm-task` 是一个**可选插件工具**，运行 JSON 唯一的 LLM 任务并返回结构化输出（可选地根据 JSON Schema 验证）。

这非常适合 Lobster 等工作流引擎：你可以添加单个 LLM 步骤，而无需为每个工作流编写自定义 CrawClaw 代码。

## 启用插件

1. 启用插件：

```json
{
  "plugins": {
    "entries": {
      "llm-task": { "enabled": true }
    }
  }
}
```

2. 将工具加入白名单（它以 `optional: true` 注册）：

```json
{
  "agents": {
    "list": [
      {
        "id": "main",
        "tools": { "allow": ["llm-task"] }
      }
    ]
  }
}
```

## 配置（可选）

```json
{
  "plugins": {
    "entries": {
      "llm-task": {
        "enabled": true,
        "config": {
          "defaultProvider": "openai-codex",
          "defaultModel": "gpt-5.4",
          "defaultAuthProfileId": "main",
          "allowedModels": ["openai-codex/gpt-5.4"],
          "maxTokens": 800,
          "timeoutMs": 30000
        }
      }
    }
  }
}
```

`allowedModels` 是 `provider/model` 字符串的白名单。如果设置，任何列表外的请求都会被拒绝。

## 工具参数

- `prompt`（字符串，必需）
- `input`（任意，可选）
- `schema`（对象，可选 JSON Schema）
- `provider`（字符串，可选）
- `model`（字符串，可选）
- `thinking`（字符串，可选）
- `authProfileId`（字符串，可选）
- `temperature`（数字，可选）
- `maxTokens`（数字，可选）
- `timeoutMs`（数字，可选）

`thinking` 接受标准 CrawClaw 推理预设，如 `low` 或 `medium`。

## 输出

返回包含解析后 JSON 的 `details.json`（并在提供时根据 `schema` 验证）。

## 示例：Lobster 工作流步骤

```lobster
crawclaw.invoke --tool llm-task --action json --args-json '{
  "prompt": "Given the input email, return intent and draft.",
  "thinking": "low",
  "input": {
    "subject": "Hello",
    "body": "Can you help?"
  },
  "schema": {
    "type": "object",
    "properties": {
      "intent": { "type": "string" },
      "draft": { "type": "string" }
    },
    "required": ["intent", "draft"],
    "additionalProperties": false
  }
}'
```

## 安全注意事项

- 该工具**仅支持 JSON**，并指示模型仅输出 JSON（无代码块，无评论）。
- 此运行不向模型暴露任何工具。
- 除非你用 `schema` 验证，否则将输出视为不可信。
- 在任何副作用步骤（发送、发布、执行）之前放置审批。
