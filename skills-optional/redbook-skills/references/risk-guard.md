# Risk Guard / Human Action

## 目录
- Human-action 档位
- 默认策略
- 风控护栏
- 常见信号与错误

## Human-action 档位

Node 侧支持：
- `--interaction-mode safe`
- `--interaction-mode normal`
- `--interaction-mode fast`

这些档位会统一影响：
- 鼠标移动轨迹
- 点击前后停顿
- 输入节奏
- 行间停顿
- 轻量滚动节奏

## 默认策略

- 读取类：推荐 `normal`
- 发布类：推荐 `safe`
- 评论类：推荐 `safe`
- `fast` 只用于联调/测试，不建议生产高频使用。

页面保留策略：
- 读命令默认自动关闭临时页
- 登录/发布页默认保留
- 如需强制保留：`--keep-page-open`
- 如需优先复用：`--reuse-existing-tab`

## 风控护栏

当前 Node 侧已加入：

### 1. 最小间隔控制
按 `account + actionType + interactionMode` 生效，动作类型包括：
- `fill`
- `publish`
- `comment`

命中后会输出：
- `RISK_GUARD_WAIT:`

### 2. 风控信号检测
发布/评论链路会检测这些文本或选择器：
- 请求太频繁
- 操作太频繁
- 请稍后再试
- 安全验证
- 验证码
- captcha / verify
- 账号异常 / 风险提示

命中后会抛：
- `RISK_SIGNAL_DETECTED`

### 3. 冷却时间
若最近一次同类动作命中过风险信号，会进入冷却期，期间直接抛：
- `RISK_COOLDOWN_ACTIVE`

### 4. 配额
当前默认：
- `publish`：24h 窗口限额
- `comment`：1h 窗口限额

超额会抛：
- `RISK_QUOTA_EXCEEDED`

### 5. 连续异常自动降档
若同一账号同类高风险动作连续报错达到阈值，会自动把当前动作降到 `safe`，并输出：
- `RISK_GUARD_MODE_OVERRIDE`

状态文件：
- `tmp/risk_guard_state.json`

## 常见信号与错误

- `RISK_GUARD_WAIT`：当前账号该动作触发最小间隔，正在主动等待
- `RISK_SIGNAL_DETECTED`：页面上发现风险/验证/频控信号，动作被中止
- `RISK_COOLDOWN_ACTIVE`：最近刚触发过风险信号，还在冷却期
- `RISK_QUOTA_EXCEEDED`：超过当前账号该动作的时间窗口配额
- `RISK_GUARD_MODE_OVERRIDE`：连续错误后，系统自动把本次动作降到 `safe`
