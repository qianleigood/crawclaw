---
read_when:
  - 查找公共发布渠道定义
  - 查找版本命名和发布节奏
summary: 公共发布渠道、版本命名和发布节奏
title: 发布策略
x-i18n:
  generated_at: "2026-06-05T14:46:21Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 8de4affc989fb9cca33ec94f42e64ae1eb1f48eda952fc8e1d7398e01d839ffd
  source_path: reference/RELEASING.md
  workflow: 15
---

# 发布策略

CrawClaw 有三条公共发布通道：

- stable：标记发布，默认发布到 npm `beta`，或在被明确请求时发布到 npm `latest`
- beta：预发布标签，发布到 npm `beta`
- dev：`main` 的移动头指针

## 版本命名

- 稳定发布版本：`YYYY.M.D`
  - Git 标签：`vYYYY.M.D`
- 稳定修正发布版本：`YYYY.M.D-N`
  - Git 标签：`vYYYY.M.D-N`
- Beta 预发布版本：`YYYY.M.D-beta.N`
  - Git 标签：`vYYYY.M.D-beta.N`
- 月份和日期不补零
- `latest` 表示当前晋升的稳定 npm 发布
- `beta` 表示当前 beta 安装目标
- 稳定版和稳定修正版默认发布到 npm `beta`；发布操作员可以明确指定 `latest`，或稍后晋升一个经过验证的 beta 构建
- 每个 CrawClaw 版本都附带 npm 包作为规范产物

## 发布节奏

- 发布优先进入 beta
- 稳定版仅在最新 beta 验证后才跟进
- 详细的发布流程、审批、凭证和恢复说明仅供维护者使用

## 发布预检

- 在发布检查之前运行 `cargo run --quiet --release -p crawclaw-repo-tools -- build --profile package`，以便 pack 验证步骤存在预期的 `dist/*` 发布产物
- 在每个带标签的发布之前运行 `cargo run --quiet -p crawclaw-repo-tools -- release-check`
- 兼容性别名 `pnpm build` 和 `pnpm release:check` 仍然有效，但发布自动化应优先使用 repo-tools 命令。
- 对于包含托管自动化运行时的发布，在包构建后运行 `pnpm release:automation:assets -- --tag vYYYY.M.D`。该命令验证 `dist/automation/*` 校验和并打印精确的 `gh release upload` 命令，用于 n8n 和 ComfyUI 安装程序清单及脚本。
- 自动化资产命令要求请求的标签默认指向当前 `HEAD`。仅当操作员决定将当前自动化资产附加到较旧的 GitHub 发布时，才使用 `--allow-tag-mismatch`。
- 在审批前运行 `RELEASE_TAG=vYYYY.M.D pnpm release:crawclaw:npm:check`（或匹配的 beta/修正标签）
- npm 发布后，运行 `pnpm release:crawclaw:npm:verify-published YYYY.M.D`（或匹配的 beta/修正版本）在新的临时前缀中验证发布的 registry 安装路径
- 维护者发布自动化现在使用预检后晋升模式：
  - 真正的 npm 发布必须通过成功的 npm `preflight_run_id`
  - 稳定 npm 发布默认发布到 `beta`
  - 稳定 npm 发布可通过工作流输入明确指定 `latest`
  - 从 `beta` 到 `latest` 的稳定 npm 晋升仍可作为受信任的 `CrawClaw NPM Release` 工作流上的显式手动模式使用
  - 该晋升模式仍需要在 `npm-release` 环境中使用有效的 `NPM_TOKEN`，因为 npm `dist-tag` 管理与受信任发布是分开的
  - 公共 `macOS Release` 仅用于验证
  - 真正的私有 mac 发布必须通过成功的私有 mac `preflight_run_id` 和 `validate_run_id`
  - 真正的发布路径晋升准备好的产物，而不是重新构建
- 对于 `YYYY.M.D-N` 这样的稳定修正发布，发布后验证器还检查从 `YYYY.M.D` 到 `YYYY.M.D-N` 的相同临时前缀升级路径，以便发布修正不能静默地将较旧的全局安装留在基础稳定有效载荷上
- 如果发布工作涉及 CI 规划，请在审批前审查相关的拆分工作流（`CI PR`、`CI Main`、`CI Platform`、`Security` 或 `Workflow Sanity`），以便发布说明不会描述过时的 CI 布局
- 稳定 macOS 发布就绪状态还包括更新器界面：
  - GitHub 发布最终必须包含打包的 `.zip`、`.dmg` 和 `.dSYM.zip`
  - 广告托管自动化运行时的发布还必须包含四个自动化运行时资产：
    `crawclaw-automation-comfyui-install.sh`、
    `crawclaw-automation-comfyui-manifest.json`、
    `crawclaw-automation-n8n-install.sh` 和
    `crawclaw-automation-n8n-manifest.json`
  - `main` 上的 `appcast.xml` 必须在发布后指向新的稳定 zip
  - 打包的应用必须保持非调试 bundle id、非空的 Sparkle feed URL，以及 `CFBundleVersion` 等于或高于该发布版本的规范 Sparkle 构建下限

## NPM 工作流输入

`CrawClaw NPM Release` 接受这些操作员控制的输入：

- `tag`：必需的发布标签，如 `v2026.4.2`、`v2026.4.2-1` 或 `v2026.4.2-beta.1`
- `preflight_only`：`true` 仅用于验证/构建/打包，`false` 用于真正的发布路径
- `preflight_run_id`：在真正的发布路径上必需，以便工作流重用成功预检运行的准备好的 tarball
- `npm_dist_tag`：发布路径的 npm 目标标签；默认为 `beta`
- `promote_beta_to_latest`：`true` 跳过发布并将已发布的稳定 `beta` 构建移到 `latest`

规则：

- 稳定版和修正版标签可以发布到 `beta` 或 `latest`
- Beta 预发布标签只能发布到 `beta`
- 真正的发布路径必须使用预检期间使用的相同 `npm_dist_tag`；工作流在发布继续之前验证该元数据
- 晋升模式必须使用稳定版或修正版标签、`preflight_only=false`、空的 `preflight_run_id` 和 `npm_dist_tag=beta`
- 晋升模式还需要 `npm-release` 环境中有效的 `NPM_TOKEN`，因为 `npm dist-tag add` 仍需要常规 npm 认证

## 稳定 npm 发布序列

在制作稳定 npm 发布时：

1. 使用 `preflight_only=true` 运行 `CrawClaw NPM Release`
2. 选择 `npm_dist_tag=beta` 用于正常的 beta 优先流程，或仅在你有意直接稳定发布时选择 `latest`
3. 保存成功的 `preflight_run_id`
4. 再次使用 `preflight_only=false`、相同的 `tag`、相同的 `npm_dist_tag` 和保存的 `preflight_run_id` 运行 `CrawClaw NPM Release`
5. 如果发布落在 `beta` 上，稍后使用相同的稳定 `tag`、`promote_beta_to_latest=true`、`preflight_only=false`、空的 `preflight_run_id` 和 `npm_dist_tag=beta` 运行 `CrawClaw NPM Release`，当你想要将该发布的构建移到 `latest`

晋升模式仍需要 `npm-release` 环境的审批和该环境中有效的 `NPM_TOKEN`。

这使直接发布路径和 beta 优先晋升路径都保持文档化和操作员可见。

## 公共参考

- [`.github/workflows/crawclaw-npm-release.yml`](https://github.com/qianleigood/crawclaw/blob/main/.github/workflows/crawclaw-npm-release.yml)
- [`crates/crawclaw-repo-tools/src/npm_release.rs`](https://github.com/qianleigood/crawclaw/blob/main/crates/crawclaw-repo-tools/src/npm_release.rs)
- [`scripts/package-mac-dist.sh`](https://github.com/qianleigood/crawclaw/blob/main/scripts/package-mac-dist.sh)
- [`scripts/make_appcast.sh`](https://github.com/qianleigood/crawclaw/blob/main/scripts/make_appcast.sh)

维护者使用 [`crawclaw/maintainers/release/README.md`](https://github.com/crawclaw/maintainers/blob/main/release/README.md) 中的私有发布文档作为实际操作手册。
