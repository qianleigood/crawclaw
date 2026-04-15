---
name: link-checker
description: "Check webpages for broken links, redirects, and link health. Use when auditing websites or validating URLs."
---

# link-checker

Broken link finder that crawls web pages and checks all hyperlinks for HTTP errors (404 Not Found), redirects (301/302), timeouts, and connection failures. Generates detailed reports with status codes, response times, and link locations. Supports recursive crawling with depth control, domain filtering, and multiple output formats. Uses Python3 urllib — no external dependencies. Essential for website maintenance, SEO hygiene, and quality assurance.

Powered by BytesAgain | bytesagain.com | hello@bytesagain.com

## Commands

| Command | Description |
|---------|-------------|
| `check <url>` | Check all links on a single page |
| `crawl <url>` | Recursively crawl and check links |
| `report <url>` | Generate a full HTML report |
| `broken <url>` | Show only broken links |
| `redirects <url>` | Show only redirected links |
| `external <url>` | Check only external links |
| `internal <url>` | Check only internal links |
| `batch <file>` | Check links on multiple pages |
| `summary <url>` | Quick summary with counts |

## Options

- `--depth <n>` — Crawl depth for recursive mode (default: 1)
- `--timeout <seconds>` — Request timeout per link (default: 10)
- `--format text|json|csv|html` — Output format (default: text)
- `--output <file>` — Save report to file
- `--concurrent <n>` — Max concurrent checks (default: 5)
- `--internal-only` — Only check internal links
- `--external-only` — Only check external links
- `--exclude <pattern>` — Exclude URLs matching pattern
- `--verbose` — Show all links including OK ones
- `--quiet` — Only show broken links
- `--user-agent <string>` — Custom User-Agent header

## Examples

```bash
# Check all links on a page
bash scripts/main.sh check https://example.com

# Find only broken links
bash scripts/main.sh broken https://example.com --format json

# Recursive crawl with depth limit
bash scripts/main.sh crawl https://example.com --depth 2 --internal-only

# Generate HTML report
bash scripts/main.sh report https://example.com --output link-report.html

# Check external links only with custom timeout
bash scripts/main.sh external https://example.com --timeout 15

# Quick summary
bash scripts/main.sh summary https://example.com
```

## Status Categories

| Category | Status Codes | Description |
|----------|-------------|-------------|
| ✅ OK | 200, 204 | Link is working |
| 🔄 Redirect | 301, 302, 307, 308 | Link redirects |
| ❌ Broken | 404, 410 | Link is dead |
| ⚠️ Error | 403, 500, 502, 503 | Server error |
| ⏱️ Timeout | — | Connection timed out |
| 🚫 Failed | — | Connection refused/DNS failure |

## 子代理执行策略

- **默认执行模式**：主会话编排，子代理只负责读、查、预检、草拟、汇总等前后处理；真正的关键执行动作仍留在主会话。
- **子代理可做的事**：读取现状、跑预检、整理参数、生成任务摘要、批量查询、拉取结果、汇总分析、给出推荐动作。
- **必须留在主会话的事**：外部发送、远端写入、权限/配置修改、登录授权、绑定当前聊天、创建定时或持续运行任务、真实计费提交。
- **若技能自身已有后台机制**（如 dispatcher / watcher / queue / monitor），子代理只做前后处理，不替代原生后台执行链路。
- **回报节点**：默认保留“计划确认 / 预检结果 / 关键动作已执行 / 已完成 / 已失败”这类高价值节点。
