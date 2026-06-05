---
read_when:
  - 你正在更改时间戳向模型或用户显示的方式
  - 你正在调试消息或系统提示输出中的时间格式
summary: 跨信封、提示、工具和连接器的时间和日期处理
title: 日期和时间
x-i18n:
  generated_at: "2026-06-05T14:15:32Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: f4c95abc891b06763d9fc3a77d9c70820fb7b08687c355fcded75cfad55c7c51
  source_path: date-time.md
  workflow: 15
---

# 日期和时间

CrawClaw 默认对**传输时间戳使用主机本地时间**，对**系统提示仅使用用户时区**。
提供商时间戳保持不变，以便工具保持其原生语义（当前时间可通过 `session_status` 获取）。

## 消息信封（默认本地）

入站消息包装有时间戳（分钟精度）：

```
[Provider ... 2026-01-05 16:26 PST] message text
```

此信封时间戳**默认使用主机本地时间**，无论提供商时区如何。

你可以覆盖此行为：

```json5
{
  agents: {
    defaults: {
      envelopeTimezone: "local", // "utc" | "local" | "user" | IANA timezone
      envelopeTimestamp: "on", // "on" | "off"
      envelopeElapsed: "on", // "on" | "off"
    },
  },
}
```

- `envelopeTimezone: "utc"` 使用 UTC。
- `envelopeTimezone: "local"` 使用主机时区。
- `envelopeTimezone: "user"` 使用 `agents.defaults.userTimezone`（回退到主机时区）。
- 使用显式 IANA 时区（例如 `"America/Chicago"`）以获得固定区域。
- `envelopeTimestamp: "off"` 从信封头中移除绝对时间戳。
- `envelopeElapsed: "off"` 移除已用时间后缀（`+2m` 样式）。

### 示例

**本地（默认）：**

```
[Weixin +1555 2026-01-18 00:19 PST] hello
```

**用户时区：**

```
[Weixin +1555 2026-01-18 00:19 CST] hello
```

**启用已用时间：**

```
[Weixin +1555 +30s 2026-01-18T05:19Z] follow-up
```

## 系统提示：当前日期和时间

如果已知用户时区，系统提示会包含专门的**当前日期和时间**部分，仅显示**时区**（无时钟/时间格式），以保持提示缓存稳定：

```
Time zone: America/Chicago
```

当智能体需要当前时间时，使用 `session_status` 工具；状态卡片包含时间戳行。

## 系统事件行（默认本地）

插入智能体上下文的排队系统事件使用与消息信封相同的时区选择（默认：主机本地）作为前缀：

```
System: [2026-01-12 12:19:17 PST] Model switched.
```

### 配置用户时区 + 格式

```json5
{
  agents: {
    defaults: {
      userTimezone: "America/Chicago",
      timeFormat: "auto", // auto | 12 | 24
    },
  },
}
```

- `userTimezone` 设置提示上下文的**用户本地时区**。
- `timeFormat` 控制提示中的**12 小时/24 小时显示**。`auto` 遵循操作系统偏好。

## 时间格式检测（自动）

当 `timeFormat: "auto"` 时，CrawClaw 检查操作系统偏好（macOS/Windows）并回退到语言环境格式。检测到的值**按进程缓存**以避免重复系统调用。

## 工具负载 + 连接器（原始提供商时间 + 规范化字段）

渠道工具返回**提供商原生时间戳**并添加规范化字段以保持一致性：

- `timestampMs`：自纪元以来的毫秒数（UTC）
- `timestampUtc`：ISO 8601 UTC 字符串

原始提供商字段保持不变，以便不丢失任何内容。

- 飞书：来自 API 的类纪元字符串
- 社区聊天：UTC ISO 时间戳
- 飞书/Weixin：提供商特定的数字/ISO 时间戳

如果需要本地时间，使用已知时区在下游转换。

## 相关文档

- [系统提示](/concepts/system-prompt)
- [时区](/concepts/timezone)
- [消息](/concepts/messages)
