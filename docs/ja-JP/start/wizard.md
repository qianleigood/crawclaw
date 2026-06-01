---
read_when:
  - desktop onboarding の実行または設定時
  - 新しいマシンのセットアップ時
sidebarTitle: Desktop Onboarding
summary: Gateway、workspace、channels、models、skills の Desktop onboarding
title: Desktop Onboarding
x-i18n:
  generated_at: "2026-02-08T17:15:18Z"
  model: claude-opus-4-5
  provider: pi
  source_hash: 9a650d46044a930aa4aaec30b35f1273ca3969bf676ab67bf4e1575b5c46db4c
  source_path: start/wizard.md
  workflow: 15
---

# Desktop Onboarding

CrawClaw Desktop は、現在サポートされている Apple-platform のセットアップ画面です。app で auth、local Gateway state、workspace defaults、channels、plugins、skills、logs、diagnostics を設定します。

公開 `crawclaw` command は retired です。自動化はローカル Gateway API を直接呼び出してください。

## QuickStart と Advanced

Onboarding は安全なローカル既定値の **QuickStart** から始まります。明示的に制御したい場合は **Advanced** を使います。

<Tabs>
  <Tab title="QuickStart">
    - Local Gateway on loopback
    - Desktop-managed random port
    - Desktop-managed token auth
    - Workspace under `~/.crawclaw`
    - Bundled Rust runtime and native plugins
  </Tab>
  <Tab title="Advanced">
    - Explicit workspace, model, channel, plugin, and memory settings
    - Gateway API automation for repeatable setup
    - Direct config review before applying sensitive changes
  </Tab>
</Tabs>

## onboarding が設定するもの

1. **Model/Auth** — 対応 provider/auth flow と default model を選択します。
2. **Workspace** — agent files と bootstrap state の場所を選択します。
3. **Gateway** — embedded Rust Gateway を起動し監視します。
4. **Channels** — 対応 messaging surfaces を接続します。
5. **Output and presentation** — reply visibility と streaming defaults を設定します。
6. **Memory / Experience** — local capture、recall、maintenance flows を有効にします。
7. **Skills and plugins** — bundled skills と desktop-supported plugins を有効にします。
8. **Health check** — local Gateway と runtime の準備完了を確認します。

## 後から再設定

通常の変更は CrawClaw Desktop settings を使います。automation、config patching、status、health、sessions、plugin operations は Gateway API を使います。

## 関連ドキュメント

- [Onboarding overview](/start/onboarding-overview)
- [Desktop install](/install/desktop)
- [Gateway protocol](/gateway/protocol)
- [Gateway troubleshooting](/gateway/troubleshooting)
