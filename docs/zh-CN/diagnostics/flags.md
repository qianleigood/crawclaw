---
read_when:
  - 你需要定向调试日志而不提高全局日志级别
  - 你需要捕获特定子系统的日志以获取支持
summary: 用于定向调试日志的诊断标志
title: 诊断标志
x-i18n:
  generated_at: "2026-06-05T14:15:29Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 0f02253cf70ddc91a3abe8f2d19334611f09c6d0575ad86a6193bb88323c0ea3
  source_path: diagnostics/flags.md
  workflow: 15
---

# 诊断标志

诊断标志让你能够启用定向调试日志，而无需在各处开启详细日志记录。标志是可选加入的，除非子系统检查它们，否则不会产生影响。

## 工作原理

- 标志是字符串（不区分大小写）。
- 你可以在配置中启用标志，也可以通过环境变量覆盖。
- 支持通配符：
  - `feishu.*` 匹配 `feishu.http`
  - `*` 启用所有标志

## 通过配置启用

```json
{
  "diagnostics": {
    "flags": ["feishu.http"]
  }
}
```

多个标志：

```json
{
  "diagnostics": {
    "flags": ["feishu.http", "gateway.*"]
  }
}
```

更改标志后重启网关。

## 环境变量覆盖（一次性）

```bash
CRAWCLAW_DIAGNOSTICS=feishu.http,feishu.payload
```

禁用所有标志：

```bash
CRAWCLAW_DIAGNOSTICS=0
```

## 日志去向

标志将日志输出到标准诊断日志文件。默认情况下：

```
/tmp/crawclaw/crawclaw-YYYY-MM-DD.log
```

如果你设置了 `logging.file`，请改用该路径。日志为 JSONL（每行一个 JSON 对象）。基于 `logging.redactSensitive` 的脱敏仍然适用。

## 提取日志

选择最新的日志文件：

```bash
ls -t /tmp/crawclaw/crawclaw-*.log | head -n 1
```

过滤 Feishu HTTP 诊断：

```bash
rg "feishu http error" /tmp/crawclaw/crawclaw-*.log
```

或在复现问题时跟踪：

```bash
tail -f /tmp/crawclaw/crawclaw-$(date +%F).log | rg "feishu http error"
```

对于远程网关，你也可以使用 CrawClaw Desktop 或本地 Gateway API（参见 [Gateway 日志](/gateway/logging)）。

## 注意事项

- 如果 `logging.level` 设置高于 `warn`，这些日志可能会被抑制。默认的 `info` 没问题。
- 保留启用的标志是安全的；它们只会影响特定子系统的日志量。
- 使用 [/logging](/logging) 更改日志目标、级别和脱敏。
