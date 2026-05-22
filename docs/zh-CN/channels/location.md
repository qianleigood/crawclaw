---
read_when:
  - 处理来自渠道的位置数据
  - 更新渠道元数据行为
summary: 面向位置信息的渠道元数据和路由注意事项
title: 位置解析
x-i18n:
  generated_at: "2026-05-22T02:11:35Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: bae8a260b03859a77d553f1c3e68be565da5e30d4c6f21b649793401c0bec698
  source_path: channels/location.md
  workflow: 15
---

# 位置解析

某些渠道可以发送类似位置信息的元数据。渠道适配器应在 Gateway 网关边界处规范化该元数据，避免将渠道特定的负载结构泄露到提供商或工具代码中。

## 相关

- [渠道](/channels)
- [消息](/concepts/messages)
