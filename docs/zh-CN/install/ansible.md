---
read_when:
  - 你想要自动化服务器部署并加固安全
  - 你需要防火墙隔离设置与 VPN 访问
  - 你要部署到远程 Debian/Ubuntu 服务器
summary: 使用 Ansible、Tailscale VPN 和防火墙隔离实现自动化安全加固的 CrawClaw 安装
title: Ansible
x-i18n:
  generated_at: "2026-06-05T14:39:00Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 785ec689f4886210310bc984315c7ce0049062610cfcc57e83d54a6a2ec2defe
  source_path: install/ansible.md
  workflow: 15
---

# Ansible 安装

使用 **[crawclaw-ansible](https://github.com/qianleigood/crawclaw-ansible)** 将 CrawClaw 部署到生产服务器 —— 一个安全优先架构的自动化安装程序。

<Info>
[crawclaw-ansible](https://github.com/qianleigood/crawclaw-ansible) 仓库是 Ansible 部署的权威来源。本页面是一个快速概述。
</Info>

## 前置要求

| 要求         | 详情                            |
| ------------ | ------------------------------- |
| **操作系统** | Debian 11+ 或 Ubuntu 20.04+     |
| **访问权限** | Root 或 sudo 权限               |
| **网络**     | 用于安装软件包的互联网连接      |
| **Ansible**  | 2.14+（由快速启动脚本自动安装） |

## 功能特性

- **防火墙优先安全** -- UFW 隔离（仅 SSH + Tailscale 可访问）
- **Tailscale VPN** -- 安全远程访问，不公开暴露服务
- **深度防御** -- 4 层安全架构
- **Systemd 集成** -- 启动时自动启动并加固
- **一键设置** -- 几分钟内完成完整部署

## 快速开始

一键安装：

```bash
curl -fsSL https://raw.githubusercontent.com/qianleigood/crawclaw-ansible/main/install.sh | bash
```

## 安装内容

Ansible playbook 安装和配置：

1. **Tailscale** -- 用于安全远程访问的 mesh VPN
2. **UFW 防火墙** -- 仅限 SSH + Tailscale 端口
3. **Node.js 24 + pnpm** -- 运行时依赖
4. **CrawClaw** -- 主机服务
5. **Systemd 服务** -- 自动化启动和安全加固

<Note>
</Note>

## 安装后设置

<Steps>
  <Step title="切换到 crawclaw 用户">
    ```bash
    sudo -i -u crawclaw
    ```
  </Step>
  <Step title="运行新手引导向导">
    安装后脚本引导你完成 CrawClaw 配置。
  </Step>
  <Step title="连接消息提供商">
    登录 Weixin、Feishu、community chat 或 native channel：

    - host 上有 desktop app 时使用 CrawClaw Desktop。
    - 在 headless Ansible host 上，以 `crawclaw` service user 身份运行设置，并通过
      Gateway `config.patch` RPC 或经 review 的 config edit 更新 `~/.crawclaw/crawclaw.json`。
    - 将 channel credentials 保存在 service user 的 state directory 中，不要放进 Ansible checkout。

    参见 [Channels](/channels) 和 [Gateway configuration](/gateway/configuration#config-rpc-programmatic-updates)。

  </Step>
  <Step title="验证安装">
    ```bash
    sudo systemctl status crawclaw
    sudo journalctl -u crawclaw -f
    ```
  </Step>
  <Step title="连接到 Tailscale">
    加入你的 VPN mesh 以实现安全远程访问。
  </Step>
</Steps>

### 快速命令

```bash
# 检查服务状态
sudo systemctl status crawclaw

# 查看实时日志
sudo journalctl -u crawclaw -f

# 重启 Gateway
sudo systemctl restart crawclaw
```

以 `crawclaw` 用户身份运行提供商设置，通过 CrawClaw Desktop 或本地 Gateway API，以便为服务账户存储密钥。

## 安全架构

部署采用 4 层防御模型：

1. **防火墙 (UFW)** -- 仅 SSH (22) + Tailscale (41641/udp) 公开暴露
2. **VPN (Tailscale)** -- Gateway 仅可通过 VPN mesh 访问
3. **Systemd 加固** -- NoNewPrivileges、PrivateTmp、非特权用户

验证外部攻击面：

```bash
nmap -p- YOUR_SERVER_IP
```

仅端口 22 (SSH) 应开放。所有其他服务都被锁定。

## 手动安装

如果更倾向于手动控制自动化：

<Steps>
  <Step title="安装前置条件">
    ```bash
    sudo apt update && sudo apt install -y ansible git
    ```
  </Step>
  <Step title="克隆仓库">
    ```bash
    git clone https://github.com/qianleigood/crawclaw-ansible.git
    cd crawclaw-ansible
    ```
  </Step>
  <Step title="安装 Ansible collections">
    ```bash
    ansible-galaxy collection install -r requirements.yml
    ```
  </Step>
  <Step title="运行 playbook">
    ```bash
    ./run-playbook.sh
    ```

    或者直接运行，然后手动执行设置脚本：
    ```bash
    ansible-playbook playbook.yml --ask-become-pass
    # 然后运行: /tmp/crawclaw-setup.sh
    ```

  </Step>
</Steps>

## 更新

Ansible 安装程序将 CrawClaw 设置为手动更新。参见[更新](/install/updating)了解标准更新流程。

要重新运行 Ansible playbook（例如用于配置更改）：

```bash
cd crawclaw-ansible
./run-playbook.sh
```

这是幂等的，可以安全地多次运行。

## 故障排除

<AccordionGroup>
  <Accordion title="防火墙阻止了我的连接">
    - 首先确保可通过 Tailscale VPN 访问
    - SSH 访问（端口 22）始终允许
    - Gateway 仅通过 Tailscale 访问是设计如此
  </Accordion>
  <Accordion title="服务无法启动">
    ```bash
    # 检查日志
    sudo journalctl -u crawclaw -n 100

    # 验证权限
    sudo ls -la /opt/crawclaw

    # 测试手动启动
    sudo -i -u crawclaw
    cd ~/crawclaw
    cargo run -q -p crawclaw-gateway -- --bind loopback --port 18789
    ```

  </Accordion>
  <Accordion title="提供商登录失败">
    请确保以 `crawclaw` 用户身份运行：
    ```bash
    sudo -i -u crawclaw
    ```
    然后通过 CrawClaw Desktop 或本地 Gateway API 重试提供商设置。
  </Accordion>
</AccordionGroup>

## 高级配置

有关详细的安全架构和故障排除，请参阅 crawclaw-ansible 仓库：

- [安全架构](https://github.com/qianleigood/crawclaw-ansible/blob/main/docs/security.md)
- [技术细节](https://github.com/qianleigood/crawclaw-ansible/blob/main/docs/architecture.md)
- [故障排除指南](https://github.com/qianleigood/crawclaw-ansible/blob/main/docs/troubleshooting.md)

## 相关

- [crawclaw-ansible](https://github.com/qianleigood/crawclaw-ansible) -- 完整部署指南
- [Subagents](/tools/subagents) -- 智能体隔离
