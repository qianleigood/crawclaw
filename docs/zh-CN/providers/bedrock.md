---
read_when:
  - 你想使用 Amazon Bedrock 模型与 CrawClaw
  - 你需要为模型调用设置 AWS 凭证/区域
summary: 通过 Amazon Bedrock（Converse API）模型使用 CrawClaw
title: Amazon Bedrock
x-i18n:
  generated_at: "2026-06-05T14:42:58Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 2bcf9e91b83e83bfac58b43b7491180f14e8af5bb694243274357a3c70dbbce6
  source_path: providers/bedrock.md
  workflow: 15
---

# Amazon Bedrock

CrawClaw 可以通过 Rust NativeProvider Bedrock Converse 传输使用 **Amazon Bedrock** 模型。Bedrock 认证使用 **AWS SDK 默认凭证链**，而不是 API 密钥。

## CrawClaw 支持的内容

- 提供商：`amazon-bedrock`
- API：`bedrock-converse-stream`
- 认证：AWS 凭证（环境变量、共享配置或实例角色）
- 区域：`AWS_REGION` 或 `AWS_DEFAULT_REGION`（默认：`us-east-1`）

## 自动模型发现

如果检测到 AWS 凭证，CrawClaw 可以自动发现支持**流式传输**和**文本输出**的 Bedrock 模型。发现功能使用 `bedrock:ListFoundationModels`，并会被缓存（默认：1 小时）。

配置选项位于 `models.bedrockDiscovery` 下：

```json5
{
  models: {
    bedrockDiscovery: {
      enabled: true,
      region: "us-east-1",
      providerFilter: ["anthropic", "amazon"],
      refreshInterval: 3600,
      defaultContextWindow: 32000,
      defaultMaxTokens: 4096,
    },
  },
}
```

注意事项：

- 当存在 AWS 凭证时，`enabled` 默认为 `true`。
- `region` 默认为 `AWS_REGION` 或 `AWS_DEFAULT_REGION`，然后是 `us-east-1`。
- `providerFilter` 匹配 Bedrock 提供商名称（例如 `anthropic`）。
- `refreshInterval` 单位为秒；设置为 `0` 可禁用缓存。
- `defaultContextWindow`（默认：`32000`）和 `defaultMaxTokens`（默认：`4096`）用于发现的模型（如果你知道模型限制可以覆盖）。

## 新手引导

1. 确保 **gateway 主机**上可用的 AWS 凭证：

```bash
export AWS_ACCESS_KEY_ID="AKIA..."
export AWS_SECRET_ACCESS_KEY="..."
export AWS_REGION="us-east-1"
# 可选：
export AWS_SESSION_TOKEN="..."
export AWS_PROFILE="your-profile"
# 可选（Bedrock API key/bearer token）：
export AWS_BEARER_TOKEN_BEDROCK="..."
```

2. 在你的配置中添加 Bedrock 提供商和模型（不需要 `apiKey`）：

```json5
{
  models: {
    providers: {
      "amazon-bedrock": {
        baseUrl: "https://bedrock-runtime.us-east-1.amazonaws.com",
        api: "bedrock-converse-stream",
        auth: "aws-sdk",
        models: [
          {
            id: "us.anthropic.claude-opus-4-6-v1:0",
            name: "Claude Opus 4.6 (Bedrock)",
            reasoning: true,
            input: ["text", "image"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 200000,
            maxTokens: 8192,
          },
        ],
      },
    },
  },
  agents: {
    defaults: {
      model: { primary: "amazon-bedrock/us.anthropic.claude-opus-4-6-v1:0" },
    },
  },
}
```

## EC2 实例角色

当在附加了 IAM 角色的 EC2 实例上运行 CrawClaw 时，AWS SDK 会自动使用实例元数据服务（IMDS）进行认证。但是，CrawClaw 的凭证检测目前只检查环境变量，而不是 IMDS 凭证。

**变通方法：** 设置 `AWS_PROFILE=default` 以表明 AWS 凭证可用。实际认证仍通过 IMDS 使用实例角色。

```bash
# 添加到 ~/.bashrc 或你的 shell 配置文件中
export AWS_PROFILE=default
export AWS_REGION=us-east-1
```

**EC2 实例角色所需的 IAM 权限**：

- `bedrock:InvokeModel`
- `bedrock:InvokeModelWithResponseStream`
- `bedrock:ListFoundationModels`（用于自动发现）

或附加托管策略 `AmazonBedrockFullAccess`。

## 快速设置（AWS 路径）

```bash
# 1. 创建 IAM 角色和实例配置文件
aws iam create-role --role-name EC2-Bedrock-Access \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": {"Service": "ec2.amazonaws.com"},
      "Action": "sts:AssumeRole"
    }]
  }'

aws iam attach-role-policy --role-name EC2-Bedrock-Access \
  --policy-arn arn:aws:iam::aws:policy/AmazonBedrockFullAccess

aws iam create-instance-profile --instance-profile-name EC2-Bedrock-Access
aws iam add-role-to-instance-profile \
  --instance-profile-name EC2-Bedrock-Access \
  --role-name EC2-Bedrock-Access

# 2. 附加到你的 EC2 实例
aws ec2 associate-iam-instance-profile \
  --instance-id i-xxxxx \
  --iam-instance-profile Name=EC2-Bedrock-Access

# 3. 在 EC2 实例上设置 AWS profile 环境变量
echo 'export AWS_PROFILE=default' >> ~/.bashrc
echo 'export AWS_REGION=us-east-1' >> ~/.bashrc
source ~/.bashrc
```

然后使用 CrawClaw Desktop 或本地 Gateway API 启用 Bedrock 发现并验证模型列表。

## 注意事项

- Bedrock 需要在你的 AWS 账户/区域中启用**模型访问**。
- 自动发现需要 `bedrock:ListFoundationModels` 权限。
- 如果你使用 profiles，请在 gateway 主机上设置 `AWS_PROFILE`。
- CrawClaw 按以下顺序显示凭证来源：`AWS_BEARER_TOKEN_BEDROCK`，然后是 `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY`，然后是 `AWS_PROFILE`，最后是默认 AWS SDK 链。
- 推理支持取决于模型；请查看 Bedrock 模型卡以了解当前能力。
- 如果你更喜欢托管密钥流程，你还可以在 Bedrock 前放置一个 OpenAI 兼容代理，并将其配置为 OpenAI 提供商。

## Guardrails

你可以通过在 `amazon-bedrock` 插件配置中添加 `guardrail` 对象，对所有 Bedrock 模型调用应用 [Amazon Bedrock Guardrails](https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails.html)。Guardrails 允许你强制执行内容过滤、主题拒绝、词语过滤器、敏感信息过滤器和上下文基础检查。

```json5
{
  plugins: {
    entries: {
      "amazon-bedrock": {
        config: {
          guardrail: {
            guardrailIdentifier: "abc123", // guardrail ID 或完整 ARN
            guardrailVersion: "1", // 版本号或 "DRAFT"
            streamProcessingMode: "sync", // 可选："sync" 或 "async"
            trace: "enabled", // 可选："enabled"、"disabled" 或 "enabled_full"
          },
        },
      },
    },
  },
}
```

- `guardrailIdentifier`（必需）接受 guardrail ID（例如 `abc123`）或完整 ARN（例如 `arn:aws:bedrock:us-east-1:123456789012:guardrail/abc123`）。
- `guardrailVersion`（必需）指定使用哪个已发布的版本，或使用 `"DRAFT"` 表示工作草稿。
- `streamProcessingMode`（可选）控制 guardrail 评估在流式传输期间是同步（`"sync"`）还是异步（`"async"`）运行。如果省略，Bedrock 使用其默认行为。
- `trace`（可选）在 API 响应中启用 guardrail 追踪输出。设置为 `"enabled"` 或 `"enabled_full"` 用于调试；生产环境应省略或设置为 `"disabled"`。

gateway 使用的 IAM 主体除了标准调用权限外，还必须具有 `bedrock:ApplyGuardrail` 权限。
