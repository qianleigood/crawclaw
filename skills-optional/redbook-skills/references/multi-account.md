# Multi-account / Ports / Browser Control

## 目录
- 总体原则
- 账号与端口
- 9222 注意事项
- 本机 Chrome 启动方式

## 总体原则

当前推荐架构是：
- **Python 控制面**：账号、profile、端口、Chrome 生命周期、run lock
- **Node 执行面**：页面交互、读取、评论、发布

不要在 Node 里重写账号/profile/端口分配逻辑。

## 账号与端口

当前 skill 适合：
- 多账号并存
- 明确 `account + port` 调用

关键文件：
- `config/accounts.json`
- `tmp/login_status_cache.json`

长期建议：
- 每个账号固定一个调试端口
- 例如：`brand-a -> 9222`、`brand-b -> 9223`

## 9222 注意事项

当前环境里，`9222` 可能被**非 CDP 服务**占用。

因此不能只因为端口能连就当成 Chrome DevTools 可用。当前 launcher 已补上：
- `/json/version` 级别的有效 CDP 端点校验

如果要实机验证，遇到 9222 不干净时：
- 显式传 `--port 9224` 或其他空闲端口

## 本机 Chrome 启动方式

在 macOS 上，直接拉 Chrome binary 可能复用已有主进程，导致 `--remote-debugging-port` 不真正生效。

当前稳定做法：
- `open -na "Google Chrome" --args ...`

skill 已按这个方式修过 launcher，后续保持沿用即可。
