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
  <strong>Weixin、Feishu、QQBot、Weixinなどに対応した、あらゆるOS向けのAIエージェントgateway。</strong><br />
  メッセージを送信すれば、ポケットからエージェントの応答を受け取れます。プラグインでFeishuなどを追加できます。
</p>

<Columns>
  <Card title="はじめに" href="/start/getting-started" icon="rocket">
    CrawClaw Desktop をインストールし、ローカル Gateway を起動します。
  </Card>
  <Card title="Desktop 設定" href="/install/desktop" icon="sparkles">
    desktop UI で models、plugins、logs、diagnostics を設定します。
  </Card>
  <Card title="Gateway API" href="/gateway/protocol" icon="terminal">
    自動化クライアントはローカル Gateway API 経由で接続します。
  </Card>
</Columns>

CrawClawは、単一のGatewayプロセスを通じてチャットアプリ、プラグイン、自動化クライアントをRust agent runtimeに接続します。CrawClawアシスタントを駆動し、ローカルまたはリモートのセットアップをサポートします。

## 仕組み

```mermaid
flowchart LR
  A["CrawClaw Desktop"] --> B["Local Gateway API"]
  C["チャットアプリ + プラグイン"] --> B
  D["Automation clients"] --> B
  B --> E["Agent runtime"]
  E --> F["Tools, models, memory"]
```

Gatewayは、セッション、ルーティング、チャネル接続の信頼できる唯一の情報源です。

## 主な機能

<Columns>
  <Card title="マルチチャネルgateway" icon="network">
    単一のGatewayプロセスでWeixin、Feishu、QQBot、Weixinに対応。
  </Card>
  <Card title="プラグインチャネル" icon="plug">
    拡張パッケージでFeishuなどを追加。
  </Card>
  <Card title="マルチエージェントルーティング" icon="route">
    エージェント、ワークスペース、送信者ごとに分離されたセッション。
  </Card>
  <Card title="メディアサポート" icon="image">
    画像、音声、ドキュメントの送受信。
  </Card>
  <Card title="Terminal UI" icon="terminal">
    CrawClaw Desktop で chat、sessions、approvals を操作します。
  </Card>
  <Card title="ノード連携" icon="smartphone">
    ノードとヘッドレスホストをペアリングします。
  </Card>
</Columns>

## クイックスタート

<Steps>
  <Step title="CrawClawをインストール">
    [GitHub Releases](https://github.com/qianleigood/crawclaw/releases) から CrawClaw Desktop をインストールします。
  </Step>
  <Step title="CrawClaw Desktopを起動">
    Desktop は `~/.crawclaw` を準備し、embedded Rust runtime を stage し、ローカル Gateway を起動します。
  </Step>
  <Step title="モデルを設定してチャットを開始">
    Desktop Settings で model providers と plugins を設定し、Agent ページでメッセージを送信します。
  </Step>
</Steps>

完全なインストールと開発セットアップが必要ですか？[クイックスタート](/start/quickstart)をご覧ください。

## ローカルとリモートアクセス

Gateway起動後は、CrawClaw Desktop、ローカル Gateway API、またはリモートアクセス経路から利用します。

- ローカル: CrawClaw Desktop とローカル Gateway API
- リモートアクセス: [リモートアクセス](/gateway/remote) および [Tailscale](/gateway/tailscale)

## 設定（オプション）

設定は`~/.crawclaw/crawclaw.json`にあります。

- **何もしなければ**、CrawClawはRust agent runtimeとNativeProvider経路を使用し、送信者ごとのセッションを作成します。
- 制限を設けたい場合は、`channels.weixin.allowFrom`と（グループの場合）メンションルールから始めてください。

例：

```json5
{
  channels: {
    weixin: {
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
  <Card title="チャネル" href="/channels/index" icon="message-square">
    Weixin、Feishu、QQBotなどのチャネル固有のセットアップ。
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
