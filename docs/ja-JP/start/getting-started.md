---
read_when:
  - ゼロからの初回セットアップ
  - 動作するチャットへの最短ルートを知りたい
summary: CrawClawをインストールし、数分で最初のチャットを実行しましょう。
title: はじめに
x-i18n:
  generated_at: "2026-02-08T17:15:16Z"
  model: claude-opus-4-5
  provider: pi
  source_hash: 27aeeb3d18c495380e94e6b011b0df3def518535c9f1eee504f04871d8a32269
  source_path: start/getting-started.md
  workflow: 15
---

# はじめに

目標：ゼロから最小限のセットアップで最初の動作するチャットを実現する。

<Info>
最速のチャット方法：`crawclaw tui`を実行します（チャンネル設定は不要）。ドキュメント：[TUI](/cli/tui)。
</Info>

## 前提条件

- Node 22以降

<Tip>
不明な場合は`node --version`でNodeのバージョンを確認してください。
</Tip>

## クイックセットアップ（CLI）

<Steps>
  <Step title="CrawClawをインストール（推奨）">
    <Tabs>
      <Tab title="macOS/Linux">
        ```bash
        curl -fsSL https://crawclaw.ai/install.sh | bash
        ```
      </Tab>
      <Tab title="Windows (PowerShell)">
        ```powershell
        iwr -useb https://crawclaw.ai/install.ps1 | iex
        ```
      </Tab>
    </Tabs>

    <Note>
    その他のインストール方法と要件：[インストール](/install)。
    </Note>

  </Step>
  <Step title="オンボーディングウィザードを実行">
    ```bash
    crawclaw onboard --install-daemon
    ```

    ウィザードは認証、Gateway設定、およびオプションのチャンネルを構成します。
    詳細は[オンボーディングウィザード](/start/wizard)を参照してください。

  </Step>
  <Step title="Gatewayを確認">
    サービスをインストールした場合、すでに実行されているはずです：

    ```bash
    crawclaw gateway status
    ```

  </Step>
  <Step title="ローカルUIを開く">
    ```bash
    crawclaw tui
    ```
  </Step>
</Steps>

<Check>
`crawclaw tui` が開くか、Webクライアントが接続できれば、Gatewayは使用可能です。
</Check>

## オプションの確認と追加機能

<AccordionGroup>
  <Accordion title="Gatewayをフォアグラウンドで実行">
    クイックテストやトラブルシューティングに便利です。

    ```bash
    crawclaw gateway --port 18789
    ```

  </Accordion>
  <Accordion title="テストメッセージを送信">
    構成済みのチャンネルが必要です。

    ```bash
    crawclaw message send --target +15555550123 --message "Hello from CrawClaw"
    ```

  </Accordion>
</AccordionGroup>

## さらに詳しく

<Columns>
  <Card title="オンボーディングウィザード（詳細）" href="/start/wizard">
    完全なCLIウィザードリファレンスと高度なオプション。
  </Card>
  <Card title="CLIセットアップリファレンス" href="/start/wizard-cli-reference">
    非対話モード、出力、各ステップの詳細を確認します。
  </Card>
</Columns>

## 完了後の状態

- 実行中のGateway
- 構成済みの認証
- `crawclaw tui` へのアクセスまたは接続済みのチャンネル

## 次のステップ

- DMの安全性と承認：[ペアリング](/channels/pairing)
- さらにチャンネルを接続：[チャンネル](/channels)
- 高度なワークフローとソースからのビルド：[セットアップ](/start/setup)
