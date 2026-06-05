---
read_when:
  - 你想将 Claude Max 订阅与 OpenAI 兼容工具一起使用
  - 你需要包装 Claude Code CLI 的本地 API 服务器
  - 你想评估基于订阅与基于 API 密钥的 Anthropic 访问
summary: 社区代理，将 Claude Max 订阅凭证公开为 OpenAI 兼容端点
title: Claude Max API Proxy
x-i18n:
  generated_at: "2026-06-05T14:43:26Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 6e74b02faca8eecca121e345771dfe3ef73aa4a82921324a0c19fee29233fdf4
  source_path: providers/claude-max-api-proxy.md
  workflow: 15
---

# Claude Max API Proxy

**claude-max-api-proxy** 是一个社区工具，将你的 Claude Max/Pro 订阅公开为 OpenAI 兼容的 API 端点。这允许你将订阅与任何支持 OpenAI API 格式的工具一起使用。

<Warning>
此方式仅为技术兼容性。Anthropic 过去曾在 Claude Code 之外阻止了某些订阅使用。你必须自行决定是否使用它，并在依赖之前验证 Anthropic 的当前条款。
</Warning>

## 为何使用此方式？

| 方式            | 成本                                           | 适用场景                   |
| --------------- | ---------------------------------------------- | -------------------------- |
| Anthropic API   | 按 token 计费（Opus 输入约 $15/M，输出 $75/M） | 生产应用，高用量           |
| Claude Max 订阅 | $200/月 固定                                   | 个人使用、开发、无限制用量 |

如果你有 Claude Max 订阅并希望与 OpenAI 兼容工具一起使用，此代理可能会降低某些工作流的成本。对于生产使用，API 密钥仍然是更清晰的政策路径。

## 工作原理

```
你的应用 → claude-max-api-proxy → Claude Code CLI → Anthropic（通过订阅）
   (OpenAI 格式)         (转换格式)        (使用你的登录)
```

代理：

1. 在 `http://localhost:3456/v1/chat/completions` 接受 OpenAI 格式请求
2. 将它们转换为 Claude Code Desktop 和 Gateway API 操作
3. 以 OpenAI 格式返回响应（支持流式传输）

## 安装

```bash
# 需要 Node.js 20+ 和 Claude Code CLI
npm install -g claude-max-api-proxy

# 验证 Claude CLI 已认证
claude --version
```

## 使用

### 启动服务器

```bash
claude-max-api
# 服务器运行在 http://localhost:3456
```

### 测试

```bash
# 健康检查
curl http://localhost:3456/health

# 列出模型
curl http://localhost:3456/v1/models

# 聊天补全
curl http://localhost:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-opus-4",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

### 与 CrawClaw 一起使用

你可以将 CrawClaw 指向代理作为自定义 OpenAI 兼容端点：

```json5
{
  env: {
    OPENAI_API_KEY: "not-needed",
    OPENAI_BASE_URL: "http://localhost:3456/v1",
  },
  agents: {
    defaults: {
      model: { primary: "openai/claude-opus-4" },
    },
  },
}
```

## 可用模型

| 模型 ID           | 映射到          |
| ----------------- | --------------- |
| `claude-opus-4`   | Claude Opus 4   |
| `claude-sonnet-4` | Claude Sonnet 4 |
| `claude-haiku-4`  | Claude Haiku 4  |

## 在 macOS 上自动启动

创建 LaunchAgent 以自动运行代理：

```bash
cat > ~/Library/LaunchAgents/com.claude-max-api.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.claude-max-api</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/usr/local/lib/node_modules/claude-max-api-proxy/dist/server/standalone.js</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/opt/homebrew/bin:~/.local/bin:/usr/bin:/bin</string>
  </dict>
</dict>
</plist>
EOF

launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.claude-max-api.plist
```

## 链接

- **npm:** [https://www.npmjs.com/package/claude-max-api-proxy](https://www.npmjs.com/package/claude-max-api-proxy)
- **GitHub:** [https://github.com/atalovesyou/claude-max-api-proxy](https://github.com/atalovesyou/claude-max-api-proxy)
- **Issues:** [https://github.com/atalovesyou/claude-max-api-proxy/issues](https://github.com/atalovesyou/claude-max-api-proxy/issues)

## 注意事项

- 这是一个**社区工具**，不是 Anthropic 或 CrawClaw 官方支持的
- 需要已认证 Claude Code CLI 的活跃 Claude Max/Pro 订阅
- 代理在本地运行，不会将数据发送到任何第三方服务器
- 完全支持流式响应

## 另请参阅

- [Anthropic 提供商](/providers/anthropic) - 使用 Claude setup-token 或 API 密钥的 CrawClaw 原生集成
- [OpenAI 提供商](/providers/openai) - 适用于 OpenAI/Codex 订阅
