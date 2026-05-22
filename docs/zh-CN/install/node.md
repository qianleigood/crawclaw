---
read_when:
  - 你正在从 CrawClaw 源码检出中工作
  - 你需要运行仓库测试或构建脚本
summary: CrawClaw 仓库开发所需的 Node.js 要求
title: Node.js
x-i18n:
  generated_at: "2026-05-22T04:21:09Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: eeac55bb36589ab635d07bf2609f68fc84c5c684b65436cd18f632634ecbfe91
  source_path: install/node.md
  workflow: 15
---

# Node.js

Desktop 用户不需要全局 `crawclaw` 命令或手动配置的 Node 安装。CrawClaw Desktop 捆绑了它所需的 Rust 运行时和托管原生运行时资源。

仓库开发仍然使用 **Node 24.x 或 25.x** 来处理 desktop 渲染器、托管文档工具和 npm pack/publish 边界。这些调用集中在 `crawclaw-repo-tools` Node/npm 适配器后面，因此 Rust 运行时和 repo-tools profile 保持为架构控制平面。

## 检查你的版本

```bash
node -v
```

在运行安装依赖、构建 desktop 渲染器、运行托管文档检查或验证 npm 包内容的仓库命令之前，请使用 Node 24.x 或 25.x。

## 安装开发用 Node

<Tabs>
  <Tab title="macOS">
    ```bash
    brew install node
    ```
  </Tab>
  <Tab title="Linux">
    ```bash
    curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
    sudo apt-get install -y nodejs
    ```
  </Tab>
  <Tab title="Windows">
    ```powershell
    winget install OpenJS.NodeJS.LTS
    ```
  </Tab>
</Tabs>

## 包管理器

从仓库根目录使用 pnpm：

```bash
corepack enable
pnpm install
```

常用 pnpm 命令是兼容别名：

```bash
pnpm check         # repo-tools check --profile local
pnpm build         # repo-tools build --profile package
pnpm release:check # repo-tools release-check
```
