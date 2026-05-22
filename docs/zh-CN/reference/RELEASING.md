---
read_when:
  - 查找公共发布渠道定义
  - 查找版本命名和发布节奏
summary: 公共发布渠道、版本命名和发布节奏
title: 发布策略
x-i18n:
  generated_at: "2026-05-22T04:21:59Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: d5cd078c691884bcf0e14d6908ee309d6be64750c7f958699022d14081429e44
  source_path: reference/RELEASING.md
  workflow: 15
---

# 发布策略

CrawClaw 有三条公共发布通道：

- stable：通过 Git tag 发布的版本，默认发布到 npm `beta`，或在被明确请求时发布到 npm `latest`
- beta：预发布 tag，发布到 npm `beta`
- dev：`main` 的移动头

## 版本命名

- 稳定发布版本：`YYYY.M.D`
  - Git tag：`vYYYY.M.D`
- 稳定修正版本：`YYYY.M.D-N`
  - Git tag：`vYYYY.M.D-N`
- Beta 预发布版本：`YYYY.M.D-beta.N`
  - Git tag：`vYYYY.M.D-beta.N`
- 月份和日期不补零
- `latest` 表示当前已晋升的稳定 npm 发布
- `beta` 表示当前 beta 安装目标
- 稳定和稳定修正版本默认发布到 npm `beta`；发布操作员可以明确指定 `latest`，或者稍后将经过审核的 beta 构建晋升
- 每个 CrawClaw 发布都附带 npm 包作为规范产物

## 发布节奏

- 发布以 beta 为先
- 稳定版仅在最新 beta 验证后才跟进
- 详细的发布流程、审批、凭证和恢复说明仅供维护者使用

## 发布预检

- 在发布检查之前运行 `cargo run --quiet --release -p crawclaw-repo-tools -- build --profile package`，以便 pack 验证步骤存在预期的 `dist/*` 发布产物
- 在每个 tag 发布之前运行 `cargo run --quiet -p crawclaw-repo-tools -- release-check`
- 兼容别名 `pnpm build` 和 `pnpm release:check` 仍然有效，但发布自动化应优先使用 repo-tools 命令
- 在批准前运行 `RELEASE_TAG=vYYYY.M.D pnpm release:crawclaw:npm:check`（或相应的 beta/correction tag）
- npm 发布后，运行 `pnpm release:crawclaw:npm:verify-published YYYY.M.D`（或相应的 beta/correction 版本）以在新的临时前缀中验证已发布 registry 安装路径
- 维护者发布自动化现在使用预检然后晋升：
  - 真正的 npm 发布必须通过成功的 npm `preflight_run_id`
  - 稳定 npm 发布默认为 `beta`
  - 稳定 npm 发布可以通过 workflow 输入明确指定 `latest`
  - 从 `beta` 到 `latest` 的稳定 npm 晋升仍然作为受信任的 `CrawClaw NPM Release` workflow 上的显式手动模式可用
  - 该晋升模式仍然需要在 `npm-release` 环境中提供有效的 `NPM_TOKEN`，因为 npm `dist-tag` 管理与受信任发布是分开的
  - 公共 `macOS Release` 仅用于验证
  - 真正的私有 mac 发布必须通过成功的私有 mac `preflight_run_id` 和 `validate_run_id`
  - 真正的发布路径晋升准备的产物，而不是重新构建它们
- 对于 `YYYY.M.D-N` 等稳定修正发布，发布后验证器还检查从 `YYYY.M.D` 到 `YYYY.M.D-N` 的相同临时前缀升级路径，以便发布修正不能静默地让较旧的全局安装停留在基础稳定有效载荷上
- 如果发布工作涉及 CI 规划，在批准前审查 `.github/workflows/ci.yml` 中的 `preflight` 清单逻辑，以便发布说明不会描述过时的 CI 布局
- 稳定 macOS 发布就绪状态还包括更新器界面：
  - GitHub 发布最终必须包含打包的 `.zip`、`.dmg` 和 `.dSYM.zip`
  - `main` 上的 `appcast.xml` 必须在发布后指向新的稳定 zip
  - 打包的应用必须保持非调试 bundle id、非空的 Sparkle feed URL，以及不低于该发布版本规范 Sparkle 构建底线的 `CFBundleVersion`

## NPM workflow 输入

`CrawClaw NPM Release` 接受这些操作员控制的输入：

- `tag`：必需的发布 tag，如 `v2026.4.2`、`v2026.4.2-1` 或 `v2026.4.2-beta.1`
- `preflight_only`：`true` 仅用于验证/构建/打包，`false` 用于真正的发布路径
- `preflight_run_id`：在真正的发布路径上必需，以便 workflow 重用成功预检运行准备的 tarball
- `npm_dist_tag`：发布路径的 npm 目标 tag；默认为 `beta`
- `promote_beta_to_latest`：`true` 跳过发布并将已发布的稳定 `beta` 构建移到 `latest`

规则：

- 稳定和修正 tag 可以发布到 `beta` 或 `latest`
- Beta 预发布 tag 只能发布到 `beta`
- 真正的发布路径必须使用预检期间使用的相同 `npm_dist_tag`；workflow 在发布继续之前验证该元数据
- 晋升模式必须使用稳定或修正 tag、`preflight_only=false`、空的 `preflight_run_id` 和 `npm_dist_tag=beta`
- 晋升模式还需要 `npm-release` 环境中有效的 `NPM_TOKEN`，因为 `npm dist-tag add` 仍然需要常规 npm 认证

## 稳定 npm 发布序列

在切出稳定 npm 发布时：

1. 使用 `preflight_only=true` 运行 `CrawClaw NPM Release`
2. 对于正常的 beta-first 流程选择 `npm_dist_tag=beta`，或者仅在有意直接稳定发布时才选择 `latest`
3. 保存成功的 `preflight_run_id`
4. 使用 `preflight_only=false`、相同的 `tag`、相同的 `npm_dist_tag` 和保存的 `preflight_run_id` 再次运行 `CrawClaw NPM Release`
5. 如果发布落在 `beta` 上，稍后使用相同的稳定 `tag`、`promote_beta_to_latest=true`、`preflight_only=false`、空的 `preflight_run_id` 和 `npm_dist_tag=beta` 运行 `CrawClaw NPM Release`，当你想将已发布的构建移到 `latest` 时

晋升模式仍然需要 `npm-release` 环境审批和该环境中有效的 `NPM_TOKEN`。

这使直接发布路径和 beta-first 晋升路径都记录在案且操作员可见。

## 公共参考

- [`.github/workflows/crawclaw-npm-release.yml`](https://github.com/qianleigood/crawclaw/blob/main/.github/workflows/crawclaw-npm-release.yml)
- [`crates/crawclaw-repo-tools/src/npm_release.rs`](https://github.com/qianleigood/crawclaw/blob/main/crates/crawclaw-repo-tools/src/npm_release.rs)
- [`scripts/package-mac-dist.sh`](https://github.com/qianleigood/crawclaw/blob/main/scripts/package-mac-dist.sh)
- [`scripts/make_appcast.sh`](https://github.com/qianleigood/crawclaw/blob/main/scripts/make_appcast.sh)

维护者使用
[`crawclaw/maintainers/release/README.md`](https://github.com/crawclaw/maintainers/blob/main/release/README.md)
中的私有发布文档作为实际运行手册。
