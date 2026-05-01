# CI/CD 流水线配置文档

## 概述

本文档描述 OpenClaw-Admin 项目的完整 CI/CD 流水线配置，包括 GitHub Actions、Docker 容器化、Kubernetes 部署和监控告警。

## 架构组成

### CI/CD 组件

| 组件 | 用途 | 位置 |
|------|------|------|
| GitHub Actions | CI/CD 流水线 | `.github/workflows/` |
| Docker | 容器化部署 | `Dockerfile`, `docker-compose.yml` |
| Kubernetes | 容器编排 | `kubernetes/` |
| Prometheus | 监控数据采集 | `monitoring/prometheus/` |
| Grafana | 可视化监控面板 | `monitoring/grafana/` |
| Alertmanager | 告警管理 | `monitoring/` |

## 流水线流程

### 1. 代码提交触发

```
git push → GitHub Webhook → GitHub Actions
```

### 2. CI 阶段（持续集成）

```yaml
阶段 1: 代码检查 (lint)
  ├── ESLint 代码规范检查
  ├── TypeScript 类型检查
  └── 运行条件：所有 push 和 PR

阶段 2: 单元测试 (test)
  ├── 运行 Vitest 测试套件
  ├── 生成测试覆盖率报告
  └── 运行条件：lint 通过后

阶段 3: 构建 (build)
  ├── 生产环境构建
  ├── 生成 dist 目录产物
  └── 运行条件：test 通过后

阶段 4: Docker 镜像构建
  ├── 多阶段构建优化
  ├── 推送镜像到 GHCR
  └── 运行条件：build 通过后
```

### 3. CD 阶段（持续部署）

```yaml
阶段 5: 部署到服务器
  ├── SSH 连接到生产服务器
  ├── 拉取最新 Docker 镜像
  ├── 停止旧容器并启动新容器
  └── 运行条件：main 分支 + 镜像构建成功

阶段 6: 健康检查
  ├── 检查服务健康状态
  ├── 最多等待 100 秒
  └── 失败时标记部署失败
```

## 配置文件说明

### GitHub Actions 工作流

#### `.github/workflows/ci-cd.yml`
- **触发条件**: push/PR 到 main/develop 分支
- **主要任务**: lint → test → build → deploy → health-check
- **环境要求**: 配置 GitHub Secrets

#### `.github/workflows/deploy.yml`
- **触发条件**: push 到 main 分支 + 手动触发
- **主要任务**: build-docker → deploy → health-check
- **特点**: 支持 Docker 镜像部署

### Docker 配置

#### `Dockerfile`
```dockerfile
# 多阶段构建
# 阶段 1: 构建阶段 (node:20-alpine)
#   - 安装依赖
#   - 构建前端资源
# 阶段 2: 生产阶段 (node:20-alpine)
#   - 安装 PM2
#   - 复制构建产物
#   - 创建非 root 用户
#   - 健康检查配置
```

#### `docker-compose.yml`
```yaml
服务列表:
  - app: 主应用服务 (端口 10001)
  - openclaw: 网关服务 (可选)
  - redis: 缓存服务 (可选)
```

### Kubernetes 配置

#### `kubernetes/deployment.yaml`
- **Deployment**: 3 副本，自动扩缩容
- **Service**: ClusterIP 类型
- **Ingress**: Nginx Ingress + TLS
- **HPA**: CPU 70% / 内存 80% 触发扩容
- **资源限制**: 512Mi 内存 / 500m CPU

#### `kubernetes/monitoring.yaml`
- **Prometheus**: 监控数据采集
- **Grafana**: 可视化面板
- **Alertmanager**: 告警管理
- **Node Exporter**: 主机指标
- **cAdvisor**: 容器指标

## 环境配置

### GitHub Secrets 配置

在 GitHub 仓库 Settings → Secrets 中配置：

| 名称 | 说明 | 示例 |
|------|------|------|
| `DEPLOY_SSH_KEY` | SSH 私钥 | `-----BEGIN OPENSSH PRIVATE KEY-----...` |
| `DEPLOY_USER` | 部署用户 | `deploy` |
| `DEPLOY_HOST` | 服务器地址 | `192.168.1.100` |
| `DEPLOY_PATH` | 部署路径 | `/www/wwwroot/ai-work` |
| `FEISHU_WEBHOOK_URL` | 飞书 Webhook | `https://open.feishu.cn/...` |
| `PRODUCTION_URL` | 生产环境 URL | `https://ai-work.example.com` |

### SSH 密钥生成

```bash
# 生成部署专用密钥
ssh-keygen -t ed25519 -C "github-actions-deploy" -f deploy_key

# 添加公钥到服务器
cat deploy_key.pub | ssh deploy@192.168.1.100 "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys"

# 复制私钥到 GitHub Secrets
cat deploy_key | pbcopy
```

## 部署脚本

### 1. 本地部署脚本

```bash
# 传统部署
./scripts/deploy.sh

# Docker 部署
./scripts/deploy-docker.sh
```

### 2. 服务器环境配置

```bash
# 配置服务器环境（Docker/K8s/监控）
./scripts/setup-server.sh
```

### 3. 监控脚本

```bash
# 健康检查
./scripts/health-check.sh

# 日志收集
./scripts/log-collector.sh

# 性能监控
./scripts/performance-monitor.sh

# 回滚
./scripts/rollback.sh
```

## 监控告警

### Prometheus 配置

**采集目标**:
- Prometheus 自身
- Node Exporter (主机指标)
- cAdvisor (容器指标)
- OpenClaw-Admin 应用

**告警规则** (`monitoring/prometheus/alerts-rules.yml`):
- HighCPUUsage: CPU > 80% 持续 5 分钟
- HighMemoryUsage: 内存 > 80% 持续 5 分钟
- DiskSpaceLow: 磁盘可用 < 20%
- ServiceDown: 服务不可用 1 分钟

### Grafana 仪表板

**预配置仪表板**:
- 系统总览 (CPU/内存/磁盘/网络)
- 容器监控 (容器资源使用)
- 应用监控 (请求量/响应时间/错误率)

**访问地址**:
- Grafana: http://your-server:3002 (admin/admin123)
- Prometheus: http://your-server:9090
- Alertmanager: http://your-server:9093

### 告警通知

**通知渠道**:
- 飞书机器人 Webhook
- Slack
- Email

**告警级别**:
- Critical: 服务不可用、磁盘空间不足
- Warning: 资源使用率高
- Info: 一般信息

## 日志管理

### 日志收集

```bash
# Docker 日志
docker-compose logs -f app

# Kubernetes 日志
kubectl logs -n openclaw-admin -l app=openclaw-admin -f

# 收集日志到文件
./scripts/log-collector.sh
```

### 日志配置

**日志级别**: INFO (可调整为 DEBUG/WARN/ERROR)
**日志保留**: 100MB 单文件，最多 3 个文件
**日志位置**: `/www/wwwroot/ai-work/logs/`

## 回滚策略

### 自动回滚

- 健康检查失败时自动标记部署失败
- 不自动回滚，需手动操作

### 手动回滚

```bash
# 使用回滚脚本
./scripts/rollback.sh

# 或手动回滚
git revert HEAD
git push origin main
```

## 最佳实践

### 1. 分支策略

```
main     → 生产环境 (受保护)
develop  → 开发环境
feature/* → 功能分支
```

### 2. 代码规范

- 所有 PR 必须通过 lint 和 test 检查
- 测试覆盖率不低于 80%
- 遵循 RESTful API 设计规范

### 3. 安全建议

- Secrets 不硬编码在代码中
- 使用最小权限原则配置部署用户
- 定期轮换 SSH 密钥
- 启用 TLS/SSL 加密

### 4. 性能优化

- 使用 Docker 多阶段构建减小镜像体积
- 配置 HPA 自动扩缩容
- 使用 CDN 加速静态资源
- 启用 Gzip 压缩

## 故障排查

### 部署失败

1. 检查 SSH 密钥配置
2. 验证服务器连通性
3. 检查磁盘空间
4. 查看部署日志

### 健康检查失败

1. 检查应用日志
2. 验证端口监听
3. 检查依赖服务 (数据库/缓存)
4. 增加等待时间

### 监控异常

1. 检查 Prometheus 配置
2. 验证数据采集
3. 查看 Grafana 数据源
4. 检查告警规则语法

## 附录

### 端口清单

| 服务 | 端口 | 说明 |
|------|------|------|
| 应用服务 | 10001 | 主应用 |
| Prometheus | 9090 | 监控采集 |
| Grafana | 3002 | 可视化 |
| Alertmanager | 9093 | 告警管理 |
| Node Exporter | 9100 | 主机监控 |
| cAdvisor | 8080 | 容器监控 |
| Redis | 6379 | 缓存 (可选) |

### 常用命令

```bash
# 部署
./scripts/deploy-docker.sh

# 查看状态
docker-compose ps

# 查看日志
docker-compose logs -f

# 重启服务
docker-compose restart

# 健康检查
curl http://localhost:10001/health

# 监控数据
curl http://localhost:9090/api/v1/query?query=up
```

---
*最后更新：2026-04-11*
*版本：1.0*
