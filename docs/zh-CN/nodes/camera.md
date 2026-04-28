---
read_when:
  - 在 macOS 节点模式上添加或修改相机捕获
  - 扩展智能体可访问的 MEDIA 临时文件工作流
summary: 用于智能体的相机捕获（macOS 节点模式）：照片（jpg）和短视频片段（mp4）
title: 相机捕获
x-i18n:
  generated_at: "2026-02-03T07:50:55Z"
  model: claude-opus-4-5
  provider: pi
  source_hash: b4d5f5ecbab6f70597cf1e1f9cc5f7f54681253bd747442db16cc681203b5813
  source_path: nodes/camera.md
  workflow: 15
---

# 相机捕获（智能体）

CrawClaw 当前通过以节点模式运行的 **节点主机** 为智能体工作流提供**相机捕获**。

所有相机访问都受**用户控制的设置**限制。

## 历史移动端节点说明

旧版移动端节点也曾通过 `node.invoke` 暴露相同的 `camera.*` 协议，但这些源码已从本仓库移除。

## 节点主机

### 用户设置（默认关闭）

节点主机配置控制相机访问：

- **设置 → 通用 → 允许相机**（`crawclaw.cameraEnabled`）
  - 默认：**关闭**
  - 关闭时：相机请求返回"用户已禁用相机"。

### CLI 辅助工具（节点调用）

使用主 `crawclaw` CLI 在 macOS 节点上调用相机命令。

示例：

```bash
crawclaw nodes camera list --node <id>            # list camera ids
crawclaw nodes camera snap --node <id>            # prints MEDIA:<path>
crawclaw nodes camera snap --node <id> --max-width 1280
crawclaw nodes camera snap --node <id> --delay-ms 2000
crawclaw nodes camera snap --node <id> --device-id <id>
crawclaw nodes camera clip --node <id> --duration 10s          # prints MEDIA:<path>
crawclaw nodes camera clip --node <id> --duration-ms 3000      # prints MEDIA:<path> (legacy flag)
crawclaw nodes camera clip --node <id> --device-id <id>
crawclaw nodes camera clip --node <id> --no-audio
```

注意事项：

- `crawclaw nodes camera snap` 默认 `maxWidth=1600`，除非被覆盖。
- 在 macOS 上，`camera.snap` 在预热/曝光稳定后等待 `delayMs`（默认 2000ms）再捕获。
- 照片载荷会重新压缩以保持 base64 小于 5 MB。

## 安全性 + 实际限制

- 相机和麦克风访问会触发通常的操作系统权限提示（并需要 Info.plist 中的使用说明字符串）。
- 视频片段有上限（当前 `<= 60s`）以避免过大的节点载荷（base64 开销 + 消息限制）。

## macOS 屏幕视频（操作系统级别）

对于*屏幕*视频（非相机），使用节点主机：

```bash
crawclaw nodes screen record --node <id> --duration 10s --fps 15   # prints MEDIA:<path>
```

注意事项：

- 需要 macOS **屏幕录制**权限（TCC）。
