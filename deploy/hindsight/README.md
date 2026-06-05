# Hindsight 运维手册

CrawClaw 记忆系统的生产环境部署、监控和运维指南。

## 目录结构

```
deploy/hindsight/
├── docker-compose.yml          # 开发环境（单容器）
├── docker-compose.prod.yml     # 生产环境（完整栈）
├── .env                        # 当前环境配置
├── .env.prod                   # 生产配置模板
├── crawclaw-config.json5       # CrawClaw 记忆配置
├── nginx/
│   ├── nginx.conf              # Nginx 反向代理配置
│   └── certs/                  # TLS 证书目录
│       ├── fullchain.pem
│       └── privkey.pem
├── prometheus/
│   ├── prometheus.yml          # Prometheus 抓取配置
│   └── alert.rules.yml         # 告警规则
├── grafana/
│   ├── provisioning/           # 自动配置
│   └── dashboards/             # 仪表盘 JSON
└── scripts/
    ├── deploy.sh               # 首次部署
    ├── update.sh               # 滚动更新
    ├── backup.sh               # 数据库备份
    ├── restore.sh              # 数据库恢复
    └── healthcheck.sh          # 健康检查
```

## 快速开始

### 桌面本地服务

桌面应用需要本机可访问的 Hindsight API。可以直接从 GitHub 安装单容器本地服务：

```bash
curl -fsSL https://raw.githubusercontent.com/qianleigood/crawclaw/main/scripts/install-hindsight-service.sh | bash
```

脚本会下载 `deploy/hindsight/docker-compose.yml`，在 `~/.crawclaw/hindsight-service` 写入本地 `.env`，启动 Hindsight，并检查 `http://127.0.0.1:8888/health`。如果需要覆盖端口或服务目录，可以设置 `CRAWCLAW_HINDSIGHT_PORT`、`CRAWCLAW_HINDSIGHT_WEB_PORT`、`CRAWCLAW_HINDSIGHT_HOME`。

### 1. 首次部署

```bash
cd deploy/hindsight

# 编辑配置
cp .env.prod .env
vim .env  # 填入 POSTGRES_PASSWORD、LLM_API_KEY 等

# 一键部署
./scripts/deploy.sh
```

部署完成后：
| 服务 | 地址 | 说明 |
|------|------|------|
| Hindsight API | `https://localhost:443` | 记忆 API（通过 Nginx） |
| Grafana | `http://localhost:3000` | 监控面板（默认 admin/admin） |
| Prometheus | `http://localhost:9091` | 指标查询 |

### 2. 接入 CrawClaw

将 `crawclaw-config.json5` 中的 `memory` 字段合并到 `~/.crawclaw/crawclaw.json`。

## 运维操作

### 日常操作

| 操作         | 命令                                                          |
| ------------ | ------------------------------------------------------------- |
| 查看服务状态 | `docker compose -f docker-compose.prod.yml ps`                |
| 查看日志     | `docker compose -f docker-compose.prod.yml logs -f hindsight` |
| 健康检查     | `./scripts/healthcheck.sh`                                    |
| 手动备份     | `./scripts/backup.sh`                                         |
| 重启服务     | `docker compose -f docker-compose.prod.yml restart hindsight` |

### 更新

```bash
# 更新 Hindsight（自动备份 + 滚动更新）
./scripts/update.sh hindsight

# 更新全部组件
./scripts/update.sh all
```

### 备份与恢复

```bash
# 备份
./scripts/backup.sh

# 查看可用备份
ls -lh backups/

# 恢复
./scripts/restore.sh backups/hindsight_20260529_030000.sql.gz
```

建议 cron 定时备份：

```bash
# 每天凌晨 3 点备份
0 3 * * * /path/to/deploy/hindsight/scripts/backup.sh >> /var/log/hindsight-backup.log 2>&1

# 每 5 分钟健康检查
*/5 * * * * /path/to/deploy/hindsight/scripts/healthcheck.sh >> /var/log/hindsight-health.log 2>&1
```

## 监控

### Grafana 仪表盘

预置仪表盘 `Hindsight 概览` 包含：

- 服务状态（在线/离线）
- 请求速率（总 QPS / 5xx QPS）
- 操作延迟（Recall / Retain P50/P95/P99）
- LLM Token 使用量
- 错误率
- 容器资源（CPU / 内存）

### 告警规则

| 告警              | 条件                 | 级别     |
| ----------------- | -------------------- | -------- |
| HindsightDown     | 服务离线 > 2min      | critical |
| HighLatency       | P95 延迟 > 5s        | warning  |
| RecallLatencyHigh | Recall P95 > 3s      | warning  |
| HighMemoryUsage   | 内存 > 85%           | warning  |
| HighCPUUsage      | CPU > 80%            | warning  |
| PostgresDown      | PG 离线 > 1min       | critical |
| DiskSpaceLow      | 磁盘剩余 < 15%       | warning  |
| HighErrorRate     | 5xx > 5%             | warning  |
| LLMTokenHigh      | 1h 输入 token > 10万 | info     |

### 告警通知

在 `.env` 中配置通知渠道：

```bash
# Slack Webhook
ALERT_WEBHOOK_URL=https://hooks.slack.com/services/xxx

# 或邮件（需在 Prometheus 中配置 SMTP）
ALERT_EMAIL=admin@your-domain.com
```

## 中文优化配置

生产环境必须配置以下组件，否则中文召回质量极差：

| 组件       | 配置                                | 说明                        |
| ---------- | ----------------------------------- | --------------------------- |
| 嵌入模型   | `BAAI/bge-m3`                       | 100+ 语言，替代默认英文模型 |
| 重排序     | `BAAI/bge-reranker-v2-m3`           | 多语言重排序                |
| BM25       | `pgroonga`                          | CJK 开箱分词                |
| PostgreSQL | `pgroonga/pgroonga:3.2.1-alpine-16` | 预装 pgroonga 扩展          |

## 架构

```
                    ┌─────────────┐
                    │   CrawClaw  │
                    │   Runtime   │
                    └──────┬──────┘
                           │ HTTPS
                    ┌──────┴──────┐
                    │    Nginx    │  TLS 终止 + 限流
                    │  :443/:80   │
                    └──────┬──────┘
                           │
                    ┌──────┴──────┐
                    │  Hindsight  │  记忆 API
                    │    :8888    │
                    └──────┬──────┘
                           │
                    ┌──────┴──────┐
                    │ PostgreSQL  │  pgroonga 分词
                    │   + pgroonga│  bge-m3 嵌入
                    └─────────────┘

    ┌────────────┐   ┌────────────┐
    │ Prometheus │───│  Grafana   │
    │   :9090    │   │   :3000    │
    └────────────┘   └────────────┘
```

## 安全

- Nginx 限流：API 20 r/s，Recall 5 r/s，Retain 10 r/s
- TLS 1.2+ 强制
- Prometheus/Grafana 仅绑定 `127.0.0.1`
- `/metrics` 端点仅内网可访问
- 数据库密码通过环境变量注入，不硬编码

## 故障排查

| 症状           | 排查步骤                                                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Recall 返回空  | 检查 pgroonga 扩展：`docker exec crawclaw-postgres psql -U hindsight -d hindsight -c "SELECT * FROM pg_extension WHERE extname='pgroonga'"` |
| 中文召回质量差 | 确认嵌入模型为 bge-m3：`docker exec crawclaw-hindsight env \| grep EMBEDDINGS`                                                              |
| 延迟过高       | 检查 LLM 调用：Grafana → LLM Token 使用量面板                                                                                               |
| 磁盘满         | 清理旧备份：`find backups/ -mtime +30 -delete`                                                                                              |
| 容器 OOM       | 增加 `docker-compose.prod.yml` 中的 memory limits                                                                                           |
