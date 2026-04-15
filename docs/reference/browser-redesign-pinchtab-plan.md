# Browser 重设计计划（PinchTab 单内核）

## 目标

- `browser` 工具保持单一入口（工具名不变）。
- 底层执行内核统一为 PinchTab。
- 保留多路由能力（`host | sandbox | node`），但路由只负责“选路”，不承担执行细节。
- 移除现有多执行栈（Playwright/CDP/Chrome MCP 双轨）的耦合逻辑。

## 已完成（本批）

- 抽离 `browser` 路由判定到独立模块：
  - `extensions/browser/src/browser-tool.router.ts`
- `createBrowserTool` 改为通过 Router 获取 `baseUrl/proxyRequest`，执行层仍保持现有行为：
  - `extensions/browser/src/browser-tool.ts`

## PR 切分建议

### PR-1（已落地）

- 路由与执行解耦（不改变行为）
- 引入 `BrowserToolRouteDeps`，隔离 `host/sandbox/node` 判定与代理调用

### PR-2（核心迁移，已完成）

- 新增 PinchTab 执行器（Host）
- 覆盖动作：
  - `status/open/navigate/focus/close/snapshot/screenshot/pdf/tabs/console/upload/dialog`
  - `act` 常用子集：`click/dblclick/type/press/hover/drag/select/wait/evaluate/resize/close`
- 工具结果结构对齐现有 `browser` 输出（text/image/file/details）
- 失败场景覆盖：
  - binary 缺失
  - 执行超时
  - 不支持的参数组合可显式失败并由工具层决定是否保留兼容路径

### PR-3（多路由接入 PinchTab）

- `sandbox` 路由接入 sandbox 暴露的 PinchTab 端点
- `node` 路由改为节点侧 PinchTab 执行
- 会话键统一：`<target>:<sessionId>[:<nodeId>]`

### PR-4（硬删除旧栈）

- 删除旧 browser control server 路径与 HTTP route 执行分支
- 删除旧 client-actions/client 路径中不再使用的实现
- 删除旧 gateway `browser.request` 兼容分支（如不再需要）

#### PR-4 当前进度

- 已完成：
  - `browser` 工具的 `host` / `sandbox` 主执行链已切到 PinchTab
  - `browser-tool` 测试已改到新的 session/ref 协议，不再断言旧 host runtime
  - `targetId` 依赖型 host act 请求现在直接拒绝，不再伪兼容
  - `browser-tool.ts` 内部已删除不可达的 host/sandbox 旧 runtime 分支，node 兼容路径与主工具执行链已明显解耦
  - `gateway/browser.request` 的本地 fallback 已改为复用 `runBrowserProxyCommand`，不再直接持有旧 control dispatcher
  - `browser` / `browser-runtime` facade 已移除 `browserHandlers` 对外导出，开始收缩纯兼容 public surface
  - 面向用户的 browser / CLI / plugin 文档已开始从“browser control server”改写为“compatibility service / automation path”
  - `browser/server.ts` 已从裸 `export *` 收成显式导出，后续可作为 `server` 兼容链测试 seam 的稳定落点
  - `browser control` 启动语义测试已开始下沉到 `browser-control-server-core`，当前已覆盖：
    - auth bootstrap fail-closed
    - 自动生成 auth token 后的启动日志
    - loopback bind 失败时不创建 runtime
- 未完成：
  - 旧 browser control server / routes / client-actions 模块的物理删除
  - `node` 路由已收成 PinchTab 单内核
  - CLI / docs / gateway method 对旧术语和旧行为的全面清理
  - 其余 `browser/server.*` HTTP 兼容测试仍依赖历史入口；要继续收 `server` 兼容链，需继续把入口层行为测试下沉到 core，或统一到显式 seam

### PR-5（收尾）

- 清理配置项、doctor 迁移、文档、测试矩阵
- 更新 CLI/工具帮助文本

## 删除清单（目标态）

> 以下为“目标态删除”，不在第一批直接删除。

- 路由/服务层：
  - `extensions/browser/src/server.ts`
  - `extensions/browser/src/control-service.ts`
  - `extensions/browser/src/browser/bridge-server.ts`（若 sandbox 改为纯 CDP）
  - `extensions/browser/src/gateway/browser-request.ts`（若不再走 gateway method）
- 执行层（旧）：
  - `extensions/browser/src/browser/client.ts`
  - `extensions/browser/src/browser/client-actions*.ts`
  - `extensions/browser/src/browser/routes/**`（若完全不再走本地 HTTP 分发）
  - `extensions/browser/src/browser/chrome-mcp*.ts`
  - `extensions/browser/src/browser/pw-tools-core*.ts`
- 文档与测试：
  - 旧执行栈相关用例改写或删除
  - browser 文档已收敛到 PinchTab 模型

## 风险点

- PinchTab 的 tab/ref 语义与当前 `targetId/ref` 语义差异，需映射层。
- `node` 路由需要节点环境一致性（binary 可用、权限、网络）。
- 输出协议必须稳定，否则会影响上层代理总结与 UI 渲染。

## 验收标准

- 相同输入下，`browser` 工具返回结构稳定（字段兼容）。
- 多路由可切换且行为一致。
- 全量 browser 相关测试通过，新增 PinchTab 执行失败场景覆盖。
