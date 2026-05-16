---
title: 插件
summary: 当前插件边界和 Rust native runtime 说明
---

# 插件

CrawClaw 的生产运行能力由 Rust runtime 拥有。TypeScript 插件不再注册
智能体工具、自动回复命令、Gateway RPC、HTTP route、后台服务、provider
runtime 或 typed lifecycle hooks。

插件仍可用于声明式 metadata、配置 schema、技能目录和 Rust native capability
descriptor。需要新增生产执行能力时，请在 Rust Gateway/runtime 或 Rust native
plugin registry 中实现，再通过 manifest 暴露配置。

## 入口

插件入口由 `crawclaw.plugin.json` 和 Rust native descriptor 描述。TypeScript
包文件只能用于 metadata、生成类型、文档和测试；生产执行能力不通过
TypeScript callback 运行。

## 相关页面

- [构建插件](/plugins/building-plugins)
- [插件架构](/plugins/architecture)
- [插件 manifest](/plugins/manifest)
