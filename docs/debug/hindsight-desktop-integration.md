---
title: "Hindsight 桌面应用集成方案"
summary: "将 Hindsight 记忆系统集成到 CrawClaw Desktop (Tauri) 的完整技术方案"
---

# Hindsight 桌面应用集成方案

## 1. 当前问题

桌面应用目前 **无法使用 Hindsight 记忆系统**，原因有两个：

### 问题 1：配置未传递

`agent_runtime_backend.rs:950-967` 中的 `record_memory_after_turn` 硬编码了只含 `dbPath` 的配置：

```rust
// 当前代码 — 完全忽略了用户的 Hindsight 配置
let memory_config = MemoryRuntimeConfig::from_value(
    &json!({ "runtimeStore": { "dbPath": db_path } }),
    &self.runtime_root,
);
```

而 `MemoryRuntimeConfig::load()` 会读取 `~/.crawclaw/crawclaw.json` 中的完整配置（含 Hindsight），但桌面应用从未调用它。

### 问题 2：没有 Hindsight 进程管理

Docker 方案只适合服务端。桌面应用需要：

- 启动/停止一个本地 Hindsight 守护进程
- 健康检查
- 随应用退出自动清理

## 2. 架构设计

```
┌─────────────────────────────────────────────────┐
│                 CrawClaw Desktop (Tauri)         │
│                                                  │
│  ┌──────────────┐    ┌────────────────────────┐  │
│  │  Tauri Shell  │    │   Gateway (Axum)       │  │
│  │  (lib.rs)     │    │   127.0.0.1:random     │  │
│  └──────────────┘    └───────────┬────────────┘  │
│                                  │                │
│  ┌───────────────────────────────┴──────────────┐ │
│  │           HindsightDaemon (sidecar)          │ │
│  │  ┌─────────────────────────────────────────┐ │ │
│  │  │  hindsight-embed binary                 │ │ │
│  │  │  127.0.0.1:8888 (API)                   │ │ │
│  │  │  内嵌 PostgreSQL + pgroonga              │ │ │
│  │  │  bge-m3 嵌入 + bge-reranker-v2-m3       │ │ │
│  │  └─────────────────────────────────────────┘ │ │
│  └──────────────────────────────────────────────┘ │
│                                                  │
│  ┌──────────────────────────────────────────────┐ │
│  │         MemoryRuntime (Rust)                 │ │
│  │  recall → HindsightClient → localhost:8888   │ │
│  │  retain → HindsightClient → localhost:8888   │ │
│  │  reflect → HindsightClient → localhost:8888  │ │
│  └──────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

### 关键原则

1. **hindsight-embed 是单二进制文件**，内嵌 PostgreSQL，不需要用户安装 Docker
2. **生命周期由 Tauri 管理**：应用启动时拉起，退出时关闭
3. **端口自动选择**：避免端口冲突
4. **数据存在用户目录**：`~/.crawclaw/hindsight/`
5. **零配置**：首次启动自动初始化，中文模型开箱即用

## 3. 实现步骤

### 步骤 1：创建 HindsightDaemon 管理器

新建 `apps/crawclaw-desktop/src-tauri/src/gateway/hindsight_daemon.rs`：

```rust
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::watch;

/// Hindsight 守护进程管理器
/// 管理 hindsight-embed 二进制的生命周期
#[derive(Clone)]
pub struct HindsightDaemon {
    /// API 地址（启动后填充）
    base_url: watch::Receiver<Option<String>>,
    /// 关闭信号发送端
    shutdown_tx: watch::Sender<bool>,
}

pub struct HindsightDaemonConfig {
    /// hindsight-embed 二进制路径
    pub binary_path: PathBuf,
    /// 数据目录（默认 ~/.crawclaw/hindsight/）
    pub data_dir: PathBuf,
    /// API 端口（默认 0 = 自动选择）
    pub port: u16,
    /// LLM API Key（用于记忆提取）
    pub llm_api_key: Option<String>,
    /// LLM 提供商
    pub llm_provider: String,
    /// LLM 模型
    pub llm_model: String,
}

impl Default for HindsightDaemonConfig {
    fn default() -> Self {
        let data_dir = dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".crawclaw")
            .join("hindsight");

        Self {
            binary_path: find_hindsight_binary(),
            data_dir,
            port: 0, // 自动选择
            llm_api_key: None,
            llm_provider: "openai".to_string(),
            llm_model: "gpt-4o-mini".to_string(),
        }
    }
}

impl HindsightDaemon {
    /// 启动 Hindsight 守护进程
    pub async fn start(config: HindsightDaemonConfig) -> anyhow::Result<Self> {
        // 确保数据目录存在
        std::fs::create_dir_all(&config.data_dir)?;

        let (shutdown_tx, shutdown_rx) = watch::channel(false);
        let (url_tx, url_rx) = watch::channel(None);

        // 解析端口
        let port = if config.port == 0 {
            pick_free_port()?
        } else {
            config.port
        };

        let base_url = format!("http://127.0.0.1:{port}");

        // 构建启动命令
        let mut cmd = Command::new(&config.binary_path);
        cmd.args([
            "--port", &port.to_string(),
            "--host", "127.0.0.1",
            "--data-dir", &config.data_dir.to_string_lossy(),
            // 中文优化：多语言嵌入 + 重排序 + pgroonga
            "--embeddings-model", "BAAI/bge-m3",
            "--reranker-model", "BAAI/bge-reranker-v2-m3",
            "--text-search-extension", "pgroonga",
            // LLM 配置
            "--llm-provider", &config.llm_provider,
            "--llm-model", &config.llm_model,
        ]);

        if let Some(ref key) = config.llm_api_key {
            cmd.args(["--llm-api-key", key]);
        }

        cmd.stdout(Stdio::piped())
           .stderr(Stdio::piped())
           .kill_on_drop(true);

        let mut child = cmd.spawn()
            .map_err(|e| anyhow::anyhow!("启动 Hindsight 失败: {e}"))?;

        // 捕获日志
        if let Some(stdout) = child.stdout.take() {
            let url_tx = url_tx.clone();
            let base_url = base_url.clone();
            tokio::spawn(async move {
                let mut reader = BufReader::new(stdout).lines();
                while let Ok(Some(line)) = reader.next_line().await {
                    tracing::debug!("[hindsight] {line}");
                    if line.contains("listening") || line.contains("started") {
                        let _ = url_tx.send(Some(base_url.clone()));
                    }
                }
            });
        }

        if let Some(stderr) = child.stderr.take() {
            tokio::spawn(async move {
                let mut reader = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = reader.next_line().await {
                    tracing::warn!("[hindsight:err] {line}");
                }
            });
        }

        // 等待就绪
        let daemon = Self {
            base_url: url_rx,
            shutdown_tx,
        };

        // 健康检查循环
        let health_url = format!("{base_url}/health");
        let mut attempts = 0;
        let max_attempts = 60; // 最多等 60 秒
        loop {
            attempts += 1;
            if attempts > max_attempts {
                daemon.shutdown().await;
                return Err(anyhow::anyhow!(
                    "Hindsight 未在 {max_attempts}s 内就绪"
                ));
            }

            match reqwest::get(&health_url).await {
                Ok(resp) if resp.status().is_success() => {
                    tracing::info!(
                        url = %base_url,
                        "hindsight_daemon_ready"
                    );
                    let _ = url_tx.send(Some(base_url.clone()));
                    break;
                }
                _ => {
                    tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                }
            }
        }

        // 后台监控子进程
        let mut shutdown_rx = shutdown_rx.clone();
        tokio::spawn(async move {
            tokio::select! {
                _ = child.wait() => {
                    tracing::warn!("hindsight_daemon_exited_unexpectedly");
                }
                _ = shutdown_rx.changed() => {
                    tracing::info!("hindsight_daemon_shutdown_requested");
                    let _ = child.kill().await;
                }
            }
        });

        Ok(daemon)
    }

    /// 获取 API 基础 URL（启动后可用）
    pub fn base_url(&self) -> Option<String> {
        self.base_url.borrow().clone()
    }

    /// 关闭守护进程
    pub async fn shutdown(&self) {
        let _ = self.shutdown_tx.send(true);
        // 给进程一点时间清理
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }
}

/// 查找 hindsight-embed 二进制文件
fn find_hindsight_binary() -> PathBuf {
    // 1. Tauri sidecar 目录
    if let Ok(exe) = std::env::current_exe() {
        let sidecar = exe.parent().unwrap().join("hindsight-embed");
        if sidecar.exists() {
            return sidecar;
        }
    }
    // 2. PATH 中查找
    if let Ok(output) = std::process::Command::new("which")
        .arg("hindsight-embed")
        .output()
    {
        let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !path.is_empty() {
            return PathBuf::from(path);
        }
    }
    // 3. 默认路径
    PathBuf::from("/usr/local/bin/hindsight-embed")
}

/// 选择一个空闲端口
fn pick_free_port() -> anyhow::Result<u16> {
    let listener = std::net::TcpListener::bind("127.0.0.1:0")?;
    Ok(listener.local_addr()?.port())
}
```

### 步骤 2：修改 Desktop 应用生命周期

修改 `apps/crawclaw-desktop/src-tauri/src/lib.rs`，在 setup 中启动 Hindsight：

```rust
// lib.rs setup 闭包中，在 start_gateway_server 之前添加：

// 启动 Hindsight 守护进程
let hindsight_config = HindsightDaemonConfig {
    llm_api_key: std::env::var("OPENAI_API_KEY")
        .or_else(|_| std::env::var("ANTHROPIC_API_KEY"))
        .ok(),
    ..Default::default()
};

let hindsight = match HindsightDaemon::start(hindsight_config).await {
    Ok(daemon) => {
        tracing::info!("hindsight_daemon_started");
        Some(daemon)
    }
    Err(e) => {
        tracing::warn!(error = %e, "hindsight_daemon_start_failed_degraded_mode");
        None // 降级：不使用 Hindsight
    }
};

// 将 Hindsight URL 传给 GatewayConfig
let config = GatewayConfig {
    hindsight_base_url: hindsight.as_ref().and_then(|h| h.base_url()),
    // ... 其他字段
};

// 在 app 退出时关闭
app.manage(hindsight); // 作为 Tauri managed state
```

在 `RunEvent::Exit` 中清理：

```rust
tauri::RunEvent::Exit => {
    if let Some(hindsight) = app.try_state::<Option<HindsightDaemon>>() {
        if let Some(ref h) = *hindsight {
            tauri::async_runtime::block_on(h.shutdown());
        }
    }
}
```

### 步骤 3：修复配置传递

修改 `crates/crawclaw-runtime/src/agent_runtime_backend.rs` 中的 `record_memory_after_turn`：

```rust
fn record_memory_after_turn(
    &self,
    session_id: &str,
    session_key: &str,
    run_id: &str,
    user_text: &str,
    assistant_text: &str,
) -> Result<Value, String> {
    // 使用 MemoryRuntimeConfig::load() 读取完整配置（含 Hindsight）
    // 而不是只传 dbPath
    let memory_config = crate::memory::MemoryRuntimeConfig::load(&self.runtime_root);
    let runtime =
        crate::memory::MemoryRuntime::with_config(self.runtime_root.clone(), memory_config);
    // ... 其余不变
}
```

### 步骤 4：打包 hindsight-embed 二进制

当前实现不使用 Tauri `externalBin`。Tauri 只打包
`apps/crawclaw-desktop/.runtime/crawclaw`，`crawclaw-repo-tools
desktop-stage` 会在构建前把 `hindsight-embed` stage 到
`.runtime/crawclaw/bin/hindsight-embed`，同时写入
`runtimes/hindsight/manifest.json` 和 `source.lock.json`。

默认下载并校验 Hindsight v0.7.0 的 GitHub release 资产：

```bash
cargo run -q -p crawclaw-repo-tools -- desktop-stage --root .
```

构建机需要自定义二进制来源时，设置
`CRAWCLAW_HINDSIGHT_EMBED_BIN=/path/to/hindsight-embed`。没有锁定 release
资产的平台会明确失败，而不是生成缺少 sidecar 的桌面包。

### 步骤 5：CrawClaw 配置文件

用户只需在 `~/.crawclaw/crawclaw.json` 中添加：

```json
{
  "memory": {
    "hindsight": {
      "enabled": true,
      "baseUrl": "http://127.0.0.1:{auto}",
      "memoryMode": "hybrid",
      "languageHints": {
        "primaryLanguage": "auto",
        "bilingualTechnicalTerms": true
      }
    }
  }
}
```

桌面应用启动时，`HindsightDaemon` 会自动：

1. 选择空闲端口
2. 启动 `hindsight-embed`
3. 将实际 URL 注入到 memory config 中

## 4. 三种集成模式

| 模式              | 说明                            | 适用场景         |
| ----------------- | ------------------------------- | ---------------- |
| **embed（推荐）** | 内嵌 `hindsight-embed` 守护进程 | 桌面应用，零配置 |
| **external**      | 连接外部 Hindsight 实例         | 自托管/团队共享  |
| **cloud**         | 连接 Hindsight Cloud API        | 不想本地运行     |

配置方式：

```json
{
  "memory": {
    "hindsight": {
      "mode": "embed",
      // embed 模式：自动管理本地进程
      "embedDataDir": "~/.crawclaw/hindsight"

      // external 模式：连接已有实例
      // "mode": "external",
      // "baseUrl": "https://hindsight.my-team.com",
      // "apiKey": "...",

      // cloud 模式
      // "mode": "cloud",
      // "apiKey": "hs-..."
    }
  }
}
```

## 5. 中文优化（桌面应用默认值）

桌面应用的 `HindsightDaemonConfig` 默认值已内置中文优化：

```rust
// 默认配置（无需用户手动设置）
HindsightDaemonConfig {
    embeddings_model: "BAAI/bge-m3",           // 100+ 语言嵌入
    reranker_model: "BAAI/bge-reranker-v2-m3", // 多语言重排序
    text_search_extension: "pgroonga",          // CJK 分词
    llm_output_language: None,                  // 跟随输入语言
}
```

## 6. 降级策略

当 Hindsight 不可用时（启动失败、进程崩溃、网络不通）：

| 操作     | 降级行为                                     |
| -------- | -------------------------------------------- |
| retain   | 写入本地 `~/.crawclaw/memory/outbox/` 发件箱 |
| recall   | 仅返回本地 memory snippets                   |
| reflect  | 跳过，下次重试                               |
| 知识工具 | 隐藏，不暴露给 agent                         |

桌面应用的 runtime checks 面板会显示：

```
Desktop Shell     已加载     ok
Desktop API       ready     ok
Runtime           ready     ok
Hindsight         embed:8888 ok     ← 新增
```

或降级时：

```
Hindsight         启动失败   error   ← 显示错误信息
```

## 7. 端到端验证清单

- [x] `hindsight-embed` 二进制打包进 Tauri app
- [ ] 应用启动 → Hindsight 自动启动 → 健康检查通过
- [ ] 首次对话 → 自动 retain 到 Hindsight bank
- [ ] 第二次对话 → 自动 recall 注入相关记忆
- [ ] 中文对话 → 中文记忆正确提取和召回
- [ ] 梦境整合 → reflect 生成心智模型
- [ ] 应用退出 → Hindsight 进程自动清理
- [ ] Hindsight 崩溃 → 降级到本地模式，不阻塞对话
- [ ] 重启应用 → 从上次中断处恢复（数据持久化）
