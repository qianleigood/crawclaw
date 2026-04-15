---
name: video-analysis-workflow
description: 本地视频与短视频链接分析工作流。支持抖音、小红书和本地 MP4；自动下载、预处理、分镜、逐镜头视频理解、生成 Word 报告，并支持后台任务调度、失败重试、状态查询、任务控制、镜头截图入报告，以及报告完成后自动通过飞书发送给指定接收人。用于需要长任务异步执行、避免主线程堵塞、并产出结构化视频分析报告的场景。
---

# 视频分析工作流

当前主路径已经稳定可用，推荐按 **job + dispatcher** 模式使用，而不是旧的一体化长进程模式。

## 核心工作流

### 1. 提交任务
使用 `run.sh submit` 提交本地视频或短视频链接。

### 2. 由 dispatcher 调度
后台 dispatcher 统一调度任务与镜头分析子流程。

### 3. 逐镜头分析并汇总
工作流会做：
- 下载 / 解析输入
- 预处理视频
- 分镜检测
- 逐镜头分析
- 生成报告和结构化结果

### 4. 查询、控制与发送结果
支持：
- list / status
- pause / resume / retry-failed / cancel
- 完成后自动飞书发送摘要与 `.docx`

## 适用场景

优先用于：
- 需要异步长任务
- 不希望主会话被长分析堵住
- 需要结构化报告、镜头截图、可查询任务状态
- 输入是本地 MP4、抖音链接、小红书链接

## Reference routing

### Job 生命周期与调度
读 `references/job-lifecycle.md`，当你需要：
- 理解 submit / dispatcher / scene worker 的主路径
- 排查卡住、重试、暂停恢复等任务控制问题

### 输入、输出与飞书发送
读 `references/inputs-outputs-and-feishu.md`，当你需要：
- 确认支持的输入类型
- 理解 job 输出结构
- 解释默认报告交付与飞书自动发送

## 默认入口

优先使用：

```bash
./run.sh submit
./run.sh list
./run.sh status
./run.sh dispatcher
```

## 注意事项

- 外部视频理解 API 可能慢或偶发失败，因此默认优先后台任务模式。
- 小红书下载依赖 `xhs-auto-import` 的下载链路。
- 报告截图来自 scene clip 中间帧，抽图失败通常不阻断整体报告生成。
- 如果只是要一次性快速理解视频内容，而不是完整异步工作流，优先 `video-understand`。

## 子代理执行策略

- 子代理适合做预检、参数整理、结果汇总、状态查询。
- 真正的后台任务提交、控制、外部发送与关键执行仍由主流程统一收口。
