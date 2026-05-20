---
title: "Release Policy"
summary: "公开 release channels、version naming 和 cadence"
read_when:
  - 查找公开 release channel definitions
  - 查找 version naming 和 cadence
---

# Release Policy

CrawClaw 有三个公开 release lanes：

- stable：tagged releases，默认发布到 npm `beta`，只有明确请求时才发布到 npm
  `latest`
- beta：prerelease tags，发布到 npm `beta`
- dev：`main` 的移动 head

## Version naming

- Stable release version：`YYYY.M.D`
  - Git tag：`vYYYY.M.D`
- Stable correction release version：`YYYY.M.D-N`
  - Git tag：`vYYYY.M.D-N`
- Beta prerelease version：`YYYY.M.D-beta.N`
  - Git tag：`vYYYY.M.D-beta.N`
- 月份和日期不补零
- `latest` 表示当前 promoted stable npm release
- `beta` 表示当前 beta install target
- Stable 和 stable correction releases 默认发布到 npm `beta`；release operators
  可以显式选择 `latest`，或稍后把验证过的 beta build promote
- 每个 CrawClaw release 都以 npm package 作为 canonical artifact

## Release cadence

- Releases beta-first
- Stable 只在最新 beta 验证通过后跟进
- 详细 release procedure、approvals、credentials 和 recovery notes 仅限
  maintainers

## Release preflight

- 在 `pnpm release:check` 前运行 `pnpm build`，确保 pack validation 需要的
  `dist/*` release artifacts 存在
- 每次 tagged release 前运行 `pnpm release:check`
- 审批前运行 `RELEASE_TAG=vYYYY.M.D pnpm release:crawclaw:npm:check`，或使用匹配
  的 beta/correction tag
- npm publish 后运行
  `pnpm release:crawclaw:npm:verify-published YYYY.M.D`，或匹配的
  beta/correction version，在 fresh temp prefix 中验证 published registry install
  path
- Maintainer release automation 使用 preflight-then-promote：
  - real npm publish 必须引用成功的 npm `preflight_run_id`
  - stable npm releases 默认发布到 `beta`
  - stable npm publish 可以通过 workflow input 显式选择 `latest`
  - stable npm promotion from `beta` to `latest` 仍是 trusted
    `CrawClaw NPM Release` workflow 上的显式 manual mode
  - 该 promotion mode 仍需要 `npm-release` environment 中有效的 `NPM_TOKEN`
  - public `macOS Release` 只做 validation
  - real private mac publish 必须引用成功的 private mac `preflight_run_id` 和
    `validate_run_id`
  - real publish paths 复用 prepared artifacts，而不是重新 build
- 对 `YYYY.M.D-N` 这样的 stable correction releases，post-publish verifier 还会
  检查从 `YYYY.M.D` 升级到 `YYYY.M.D-N` 的 temp-prefix upgrade path
- 如果 release work 触碰 CI planning，审批前检查 `.github/workflows/ci.yml` 中的
  `preflight` manifest logic，避免 release notes 描述过期 CI layout
- Stable macOS release readiness 还包括 updater surfaces：
  - GitHub release 必须带有 packaged `.zip`、`.dmg` 和 `.dSYM.zip`
  - publish 后 `appcast.xml` on `main` 必须指向新的 stable zip
  - packaged app 必须保持 non-debug bundle id、非空 Sparkle feed URL，以及不低于
    该 release version canonical Sparkle build floor 的 `CFBundleVersion`

## NPM workflow inputs

`CrawClaw NPM Release` 接受这些 operator-controlled inputs：

- `tag`：必填 release tag，例如 `v2026.4.2`、`v2026.4.2-1` 或
  `v2026.4.2-beta.1`
- `preflight_only`：`true` 表示只 validation/build/package，`false` 表示真实
  publish path
- `preflight_run_id`：real publish path 必填，用于复用成功 preflight run 产出的
  prepared tarball
- `npm_dist_tag`：publish path 的 npm target tag，默认 `beta`
- `promote_beta_to_latest`：`true` 表示跳过 publish，把已发布的 stable `beta`
  build 移到 `latest`

Rules：

- Stable 和 correction tags 可以发布到 `beta` 或 `latest`
- Beta tags 必须发布到 `beta`
- `promote_beta_to_latest` 只适用于 stable versions
