---
read_when:
  - 新規ユーザーにCrawClawを紹介するとき
summary: CrawClawは、あらゆるOSで動作するAIエージェント向けのマルチチャネルgatewayです。
title: CrawClaw
x-i18n:
  generated_at: "2026-02-08T17:15:47Z"
  model: claude-opus-4-5
  provider: pi
  source_hash: fc8babf7885ef91d526795051376d928599c4cf8aff75400138a0d7d9fa3b75f
  source_path: index.md
  workflow: 15
---

# CrawClaw 🦀

<p align="center">
    <img
        src="/assets/crawclaw-logo-text-dark.png"
        alt="CrawClaw"
        width="500"
        class="dark:hidden"
    />
    <img
        src="/assets/crawclaw-logo-text.png"
        alt="CrawClaw"
        width="500"
        class="hidden dark:block"
    />
</p>

> _「EXFOLIATE! EXFOLIATE!」_ — たぶん宇宙ロブスター

<p align="center">
  <strong>WhatsApp、Telegram、Discord、iMessageなどに対応した、あらゆるOS向けのAIエージェントgateway。</strong><br />
  メッセージを送信すれば、ポケットからエージェントの応答を受け取れます。プラグインでMattermostなどを追加できます。
</p>

<Columns>
  <Card title="はじめに" href="/start/getting-started" icon="rocket">
    CrawClawをインストールし、数分でGatewayを起動できます。
  </Card>
  <Card title="ウィザードを実行" href="/start/wizard" icon="sparkles">
    `crawclaw onboard`とペアリングフローによるガイド付きセットアップ。
  </Card>
  <Card title="Terminal UI" href="/cli/tui" icon="terminal">
    ローカルTUIでGatewayに接続してチャットを開始します。
  </Card>
</Columns>

CrawClawは、単一のGatewayプロセスを通じてチャットアプリをPiのようなコーディングエージェントに接続します。CrawClawアシスタントを駆動し、ローカルまたはリモートのセットアップをサポートします。

## 仕組み

```mermaid
flowchart LR
  A["チャットアプリ + プラグイン"] --> B["Gateway"]
  B --> C["Piエージェント"]
  B --> D["CLI"]
  B --> E["TUI"]
  B --> F["Browser-origin clients"]
  B --> G["Node integrations"]
```

Gatewayは、セッション、ルーティング、チャネル接続の信頼できる唯一の情報源です。

## 主な機能

<Columns>
  <Card title="マルチチャネルgateway" icon="network">
    単一のGatewayプロセスでWhatsApp、Telegram、Discord、iMessageに対応。
  </Card>
  <Card title="プラグインチャネル" icon="plug">
    拡張パッケージでMattermostなどを追加。
  </Card>
  <Card title="マルチエージェントルーティング" icon="route">
    エージェント、ワークスペース、送信者ごとに分離されたセッション。
  </Card>
  <Card title="メディアサポート" icon="image">
    画像、音声、ドキュメントの送受信。
  </Card>
  <Card title="Terminal UI" icon="terminal">
    ローカルTUIでチャット、セッション、承認を操作します。
  </Card>
  <Card title="ノード連携" icon="smartphone">
    ノードとヘッドレスホストをペアリングします。
  </Card>
</Columns>

## クイックスタート

<Steps>
  <Step title="CrawClawをインストール">
    ```bash
    npm install -g crawclaw@latest
    ```
  </Step>
  <Step title="オンボーディングとサービスのインストール">
    ```bash
    crawclaw onboard --install-daemon
    ```
  </Step>
  <Step title="WhatsAppをペアリングしてGatewayを起動">
    ```bash
    crawclaw channels login
    crawclaw gateway --port 18789
    ```
  </Step>
</Steps>

完全なインストールと開発セットアップが必要ですか？[クイックスタート](/start/quickstart)をご覧ください。

## ローカルとリモートアクセス

Gateway起動後は、ローカル端末またはリモートアクセス経路から利用します。

- ローカル端末: `crawclaw tui`
- リモートアクセス: [リモートアクセス](/gateway/remote) および [Tailscale](/gateway/tailscale)

<p align="center">
  <img src="/whatsapp-crawclaw.jpg" alt="CrawClaw" width="420" />
</p>

## 設定（オプション）

設定は`~/.crawclaw/crawclaw.json`にあります。

- **何もしなければ**、CrawClawはバンドルされたPiバイナリをRPCモードで使用し、送信者ごとのセッションを作成します。
- 制限を設けたい場合は、`channels.whatsapp.allowFrom`と（グループの場合）メンションルールから始めてください。

例：

```json5
{
  channels: {
    whatsapp: {
      allowFrom: ["+15555550123"],
      groups: { "*": { requireMention: true } },
    },
  },
  messages: { groupChat: { mentionPatterns: ["@crawclaw"] } },
}
```

## ここから始める

<Columns>
  <Card title="ドキュメントハブ" href="/start/hubs" icon="book-open">
    ユースケース別に整理されたすべてのドキュメントとガイド。
  </Card>
  <Card title="設定" href="/gateway/configuration" icon="settings">
    Gatewayのコア設定、トークン、プロバイダー設定。
  </Card>
  <Card title="リモートアクセス" href="/gateway/remote" icon="globe">
    SSHおよびtailnetアクセスパターン。
  </Card>
  <Card title="チャネル" href="/channels/telegram" icon="message-square">
    WhatsApp、Telegram、Discordなどのチャネル固有のセットアップ。
  </Card>
  <Card title="ノード" href="/nodes" icon="smartphone">
    ペアリングとヘッドレスノード連携。
  </Card>
  <Card title="ヘルプ" href="/help" icon="life-buoy">
    一般的な修正とトラブルシューティングのエントリーポイント。
  </Card>
</Columns>

## 詳細

<Columns>
  <Card title="全機能リスト" href="/concepts/features" icon="list">
    チャネル、ルーティング、メディア機能の完全な一覧。
  </Card>
  <Card title="マルチエージェントルーティング" href="/concepts/multi-agent" icon="route">
    ワークスペースの分離とエージェントごとのセッション。
  </Card>
  <Card title="セキュリティ" href="/gateway/security" icon="shield">
    トークン、許可リスト、安全制御。
  </Card>
  <Card title="トラブルシューティング" href="/gateway/troubleshooting" icon="wrench">
    Gatewayの診断と一般的なエラー。
  </Card>
  <Card title="概要とクレジット" href="/reference/credits" icon="info">
    プロジェクトの起源、貢献者、ライセンス。
  </Card>
</Columns>
