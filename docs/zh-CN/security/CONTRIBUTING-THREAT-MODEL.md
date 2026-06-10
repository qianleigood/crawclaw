---
title: "Contributing to the Threat Model"
summary: "如何为 CrawClaw threat model 做贡献"
read_when:
  - 你想贡献 security findings 或 threat scenarios
  - 你正在 review 或更新 threat model
x-i18n:
  generated_at: "2026-06-10T12:21:02Z"
  model: codex
  provider: openai
  source_hash: 62e81920d14f76887e839b372cb286ad8771d9a5a7f4712dca8d54cc16d0f021
  source_path: security/CONTRIBUTING-THREAT-MODEL.md
  workflow: 15
---

# Contributing to the CrawClaw Threat Model

感谢你帮助 CrawClaw 变得更安全。这个 threat model 是一份持续演进的文档，我们欢迎任何人贡献，不需要你是 security expert。

## Ways to Contribute

### Add a Threat

发现我们尚未覆盖的 attack vector 或 risk？请在 [crawclaw/trust](https://github.com/crawclaw/trust/issues) 开 issue，并用你自己的话描述它。你不需要了解任何 frameworks，也不需要填完每个字段，只要描述 scenario 即可。

**有帮助但非必需的信息：**

- Attack scenario，以及它可能如何被 exploited
- CrawClaw 哪些部分受影响（CLI、gateway、channels、ClawHub、MCP servers 等）
- 你认为严重程度如何（low / medium / high / critical）
- 任何相关 research、CVEs 或 real-world examples 的链接

我们会在 review 时处理 ATLAS mapping、threat IDs 和 risk assessment。如果你想包含这些细节，也很好，但不是预期要求。

> **这里用于添加 threat model 条目，不用于报告 live vulnerabilities。** 如果你发现了可利用漏洞，请查看我们的 [Trust page](https://trust.crawclaw.ai) 获取 responsible disclosure instructions。

### Suggest a Mitigation

如果你有解决现有 threat 的想法，请开 issue 或 PR 并引用该 threat。有用的 mitigations 应该具体且可执行。例如，"per-sender rate limiting of 10 messages/minute at the gateway" 比 "implement rate limiting" 更好。

### Propose an Attack Chain

Attack chains 展示多个 threats 如何组合成真实 attack scenario。如果你看到危险组合，请描述步骤，以及 attacker 会如何把它们串联起来。简短说明攻击在实践中如何展开，通常比 formal template 更有价值。

### Fix or Improve Existing Content

错别字、澄清、过时信息、更好的示例，都欢迎 PR，不需要先开 issue。

## What We Use

### MITRE ATLAS

这个 threat model 基于 [MITRE ATLAS](https://atlas.mitre.org/)（Adversarial Threat Landscape for AI Systems），这是一个专门为 prompt injection、tool misuse 和 agent exploitation 等 AI/ML threats 设计的 framework。你不需要了解 ATLAS 也能贡献，我们会在 review 时把 submissions 映射到该 framework。

### Threat IDs

每个 threat 都会获得类似 `T-EXEC-003` 的 ID。Categories 如下：

| Code    | Category                                   |
| ------- | ------------------------------------------ |
| RECON   | Reconnaissance - information gathering     |
| ACCESS  | Initial access - gaining entry             |
| EXEC    | Execution - running malicious actions      |
| PERSIST | Persistence - maintaining access           |
| EVADE   | Defense evasion - avoiding detection       |
| DISC    | Discovery - learning about the environment |
| EXFIL   | Exfiltration - stealing data               |
| IMPACT  | Impact - damage or disruption              |

IDs 由 maintainers 在 review 时分配。你不需要自己选择。

### Risk Levels

| Level        | Meaning                                                           |
| ------------ | ----------------------------------------------------------------- |
| **Critical** | Full system compromise, or high likelihood + critical impact      |
| **High**     | Significant damage likely, or medium likelihood + critical impact |
| **Medium**   | Moderate risk, or low likelihood + high impact                    |
| **Low**      | Unlikely and limited impact                                       |

如果你不确定 risk level，只描述 impact，我们会评估。

## Review Process

1. **Triage** - 我们会在 48 小时内 review 新 submissions
2. **Assessment** - 我们验证 feasibility，分配 ATLAS mapping 和 threat ID，并验证 risk level
3. **Documentation** - 我们确保所有内容格式正确且完整
4. **Merge** - 添加到 threat model 和 visualization

## Resources

- [ATLAS Website](https://atlas.mitre.org/)
- [ATLAS Techniques](https://atlas.mitre.org/techniques/)
- [ATLAS Case Studies](https://atlas.mitre.org/studies/)
- [CrawClaw Threat Model](/security/THREAT-MODEL-ATLAS)

## Contact

- **Security vulnerabilities:** 查看我们的 [Trust page](https://trust.crawclaw.ai) 获取 reporting instructions
- **Threat model questions:** 在 [crawclaw/trust](https://github.com/crawclaw/trust/issues) 开 issue
- **General chat:** community chat #security channel

## Recognition

Threat model contributors 会在 threat model acknowledgments、release notes 和 CrawClaw security hall of fame 中获得 recognition；significant contributions 会特别标注。
