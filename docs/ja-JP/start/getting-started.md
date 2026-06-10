---
read_when:
  - ゼロからの初回セットアップ
  - 動作する desktop chat への最短ルートを知りたい
summary: CrawClaw Desktop をインストールし、ローカル Gateway を起動します。
title: はじめに
x-i18n:
  generated_at: "2026-06-10T10:02:25Z"
  model: codex
  provider: openai
  source_hash: 869cc3ce9e1ad3af40dfaa5ff90946e214831126d8311d13eeaadeabf1c33e9d
  source_path: start/getting-started.md
  workflow: 15
---

# はじめに

CrawClaw Desktop をインストールし、desktop UI でセットアップを完了します。完了すると、ローカル Rust Gateway、設定済みのモデル認証、動作する desktop chat session が利用できます。

## 必要なもの

- **macOS**。現在サポートされている Apple-platform desktop app 用です。
- **モデル provider のアカウントまたは API key**。Anthropic、OpenAI、Google、またはその他の対応 provider を使います。

## クイックセットアップ

<Steps>
  <Step title="CrawClaw Desktop をインストール">
    [GitHub Releases](https://github.com/qianleigood/crawclaw/releases) から最新の desktop asset をダウンロードします。
  </Step>
  <Step title="desktop app を開く">
    CrawClaw Desktop は `~/.crawclaw` を準備し、embedded Rust runtime を stage し、ローカル Gateway を起動して setup UI を開きます。
  </Step>
  <Step title="モデルと plugins を設定">
    desktop Settings で model providers、plugin enablement、local runtime status、logs、diagnostics を設定します。
  </Step>
  <Step title="最初のメッセージを送信">
    CrawClaw Desktop の Agent ページを使います。自動化クライアントはローカル Gateway API 経由で接続できます。
  </Step>
</Steps>

## 次に読むもの

<Columns>
  <Card title="Desktop install" href="/install/desktop" icon="monitor">
    app が bundle、起動、ローカル保存する内容。
  </Card>
  <Card title="チャンネル接続" href="/channels" icon="message-square">
    Weixin、Feishu、QQ Bot、DingTalk、ESP32。
  </Card>
  <Card title="Pairing と安全性" href="/channels/pairing" icon="shield">
    agent にメッセージを送れる相手を制御します。
  </Card>
  <Card title="Gateway API" href="/gateway/protocol" icon="waypoints">
    自動化と統合向けのローカル control-plane protocol。
  </Card>
</Columns>

<Accordion title="Advanced: environment variables">
  service account で CrawClaw を実行する場合、またはカスタム path を使う場合:

- `CRAWCLAW_HOME` — internal path resolution 用の home directory
- `CRAWCLAW_STATE_DIR` — state directory を上書き
- `CRAWCLAW_CONFIG_PATH` — config file path を上書き

完全なリファレンス: [Environment variables](/help/environment)。
</Accordion>
