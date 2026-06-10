---
summary: "在 Azure Linux VM 上 24/7 运行 CrawClaw Gateway，并保留持久状态"
read_when:
  - 你想在 Azure 上 24/7 运行 CrawClaw，并使用 Network Security Group hardening
  - 你想在自己的 Azure Linux VM 上运行 production-grade、always-on CrawClaw Gateway
  - 你想通过 Azure Bastion SSH 做安全管理
title: "Azure"
x-i18n:
  generated_at: "2026-06-10T11:57:53Z"
  model: codex
  provider: openai
  source_hash: a054d2ac16b05c399b12b3d5662f4112c0b21516d96b03da56d0fde10fcf6489
  source_path: install/azure.md
  workflow: 15
---

# Azure Linux VM 上的 CrawClaw

本指南会使用 Azure CLI 设置 Azure Linux VM，应用 Network Security Group（NSG）hardening，配置 Azure Bastion 用于 SSH access，并安装 CrawClaw。

## 你将完成什么

- 使用 Azure CLI 创建 Azure networking（VNet、subnets、NSG）和 compute resources
- 应用 Network Security Group rules，让 VM SSH 只允许来自 Azure Bastion
- 使用 Azure Bastion 做 SSH access（VM 不暴露 public IP）
- 安装适合你 deployment 的受支持 CrawClaw Desktop 或 Gateway runtime
- 验证 Gateway

## 你需要什么

- Azure subscription，并具备创建 compute 和 network resources 的权限
- 已安装 Azure CLI（如有需要，参见 [Azure CLI install steps](https://learn.microsoft.com/cli/azure/install-azure-cli)）
- SSH key pair（本指南也覆盖如何生成）
- 大约 20-30 分钟

## 配置部署

<Steps>
  <Step title="登录 Azure CLI">
    ```bash
    az login
    az extension add -n ssh
    ```

    `ssh` extension 是 Azure Bastion native SSH tunneling 所必需的。

  </Step>

  <Step title="注册所需 resource providers，一次性操作">
    ```bash
    az provider register --namespace Microsoft.Compute
    az provider register --namespace Microsoft.Network
    ```

    验证注册状态。等待两者都显示 `Registered`。

    ```bash
    az provider show --namespace Microsoft.Compute --query registrationState -o tsv
    az provider show --namespace Microsoft.Network --query registrationState -o tsv
    ```

  </Step>

  <Step title="设置部署变量">
    ```bash
    RG="rg-crawclaw"
    LOCATION="westus2"
    VNET_NAME="vnet-crawclaw"
    VNET_PREFIX="10.40.0.0/16"
    VM_SUBNET_NAME="snet-crawclaw-vm"
    VM_SUBNET_PREFIX="10.40.2.0/24"
    BASTION_SUBNET_PREFIX="10.40.1.0/26"
    NSG_NAME="nsg-crawclaw-vm"
    VM_NAME="vm-crawclaw"
    ADMIN_USERNAME="crawclaw"
    BASTION_NAME="bas-crawclaw"
    BASTION_PIP_NAME="pip-crawclaw-bastion"
    ```

    根据你的环境调整 names 和 CIDR ranges。Bastion subnet 必须至少是 `/26`。

  </Step>

  <Step title="选择 SSH key">
    如果已经有 public key，直接使用：

    ```bash
    SSH_PUB_KEY="$(cat ~/.ssh/id_ed25519.pub)"
    ```

    如果还没有 SSH key，先生成：

    ```bash
    ssh-keygen -t ed25519 -a 100 -f ~/.ssh/id_ed25519 -C "you@example.com"
    SSH_PUB_KEY="$(cat ~/.ssh/id_ed25519.pub)"
    ```

  </Step>

  <Step title="选择 VM size 和 OS disk size">
    ```bash
    VM_SIZE="Standard_B2as_v2"
    OS_DISK_SIZE_GB=64
    ```

    选择你的 subscription 和 region 中可用的 VM size 与 OS disk size：

    - 轻量使用可以从较小规格开始，以后再 scale up
    - 更重的 automation、更多 channels 或更大的 model/tool workloads 需要更多 vCPU/RAM/disk
    - 如果某个 VM size 在你的 region 或 subscription quota 中不可用，选择最接近的可用 SKU

    列出目标 region 中可用的 VM sizes：

    ```bash
    az vm list-skus --location "${LOCATION}" --resource-type virtualMachines -o table
    ```

    检查当前 vCPU 和 disk usage/quota：

    ```bash
    az vm list-usage --location "${LOCATION}" -o table
    ```

  </Step>
</Steps>

## 部署 Azure resources

<Steps>
  <Step title="创建 resource group">
    ```bash
    az group create -n "${RG}" -l "${LOCATION}"
    ```
  </Step>

  <Step title="创建 network security group">
    创建 NSG，并添加 rules，让只有 Bastion subnet 可以 SSH 到 VM。

    ```bash
    az network nsg create \
      -g "${RG}" -n "${NSG_NAME}" -l "${LOCATION}"

    # Allow SSH from the Bastion subnet only
    az network nsg rule create \
      -g "${RG}" --nsg-name "${NSG_NAME}" \
      -n AllowSshFromBastionSubnet --priority 100 \
      --access Allow --direction Inbound --protocol Tcp \
      --source-address-prefixes "${BASTION_SUBNET_PREFIX}" \
      --destination-port-ranges 22

    # Deny SSH from the public internet
    az network nsg rule create \
      -g "${RG}" --nsg-name "${NSG_NAME}" \
      -n DenyInternetSsh --priority 110 \
      --access Deny --direction Inbound --protocol Tcp \
      --source-address-prefixes Internet \
      --destination-port-ranges 22

    # Deny SSH from other VNet sources
    az network nsg rule create \
      -g "${RG}" --nsg-name "${NSG_NAME}" \
      -n DenyVnetSsh --priority 120 \
      --access Deny --direction Inbound --protocol Tcp \
      --source-address-prefixes VirtualNetwork \
      --destination-port-ranges 22
    ```

    Rules 按 priority 评估（数字越低越先评估）：Bastion traffic 在 100 被允许，所有其他 SSH 在 110 和 120 被阻止。

  </Step>

  <Step title="创建 virtual network 和 subnets">
    创建带有 VM subnet（已附加 NSG）的 VNet，然后添加 Bastion subnet。

    ```bash
    az network vnet create \
      -g "${RG}" -n "${VNET_NAME}" -l "${LOCATION}" \
      --address-prefixes "${VNET_PREFIX}" \
      --subnet-name "${VM_SUBNET_NAME}" \
      --subnet-prefixes "${VM_SUBNET_PREFIX}"

    # Attach the NSG to the VM subnet
    az network vnet subnet update \
      -g "${RG}" --vnet-name "${VNET_NAME}" \
      -n "${VM_SUBNET_NAME}" --nsg "${NSG_NAME}"

    # AzureBastionSubnet — name is required by Azure
    az network vnet subnet create \
      -g "${RG}" --vnet-name "${VNET_NAME}" \
      -n AzureBastionSubnet \
      --address-prefixes "${BASTION_SUBNET_PREFIX}"
    ```

  </Step>

  <Step title="创建 VM">
    该 VM 没有 public IP。SSH access 完全通过 Azure Bastion。

    ```bash
    az vm create \
      -g "${RG}" -n "${VM_NAME}" -l "${LOCATION}" \
      --image "Canonical:ubuntu-24_04-lts:server:latest" \
      --size "${VM_SIZE}" \
      --os-disk-size-gb "${OS_DISK_SIZE_GB}" \
      --storage-sku StandardSSD_LRS \
      --admin-username "${ADMIN_USERNAME}" \
      --ssh-key-values "${SSH_PUB_KEY}" \
      --vnet-name "${VNET_NAME}" \
      --subnet "${VM_SUBNET_NAME}" \
      --public-ip-address "" \
      --nsg ""
    ```

    `--public-ip-address ""` 防止分配 public IP。`--nsg ""` 跳过创建 per-NIC NSG（由 subnet-level NSG 负责安全）。

    **可复现性：** 上面的命令对 Ubuntu image 使用 `latest`。如果要 pin 到具体版本，先列出可用版本并替换 `latest`：

    ```bash
    az vm image list \
      --publisher Canonical --offer ubuntu-24_04-lts \
      --sku server --all -o table
    ```

  </Step>

  <Step title="创建 Azure Bastion">
    Azure Bastion 提供 managed SSH access，让 VM 不需要暴露 public IP。CLI-based `az network bastion ssh` 需要启用 tunneling 的 Standard SKU。

    ```bash
    az network public-ip create \
      -g "${RG}" -n "${BASTION_PIP_NAME}" -l "${LOCATION}" \
      --sku Standard --allocation-method Static

    az network bastion create \
      -g "${RG}" -n "${BASTION_NAME}" -l "${LOCATION}" \
      --vnet-name "${VNET_NAME}" \
      --public-ip-address "${BASTION_PIP_NAME}" \
      --sku Standard --enable-tunneling true
    ```

    Bastion provisioning 通常需要 5-10 分钟，但在某些 regions 可能需要最多 15-30 分钟。

  </Step>
</Steps>

## 安装 CrawClaw

<Steps>
  <Step title="通过 Azure Bastion SSH 到 VM">
    ```bash
    VM_ID="$(az vm show -g "${RG}" -n "${VM_NAME}" --query id -o tsv)"

    az network bastion ssh \
      --name "${BASTION_NAME}" \
      --resource-group "${RG}" \
      --target-resource-id "${VM_ID}" \
      --auth-type ssh-key \
      --username "${ADMIN_USERNAME}" \
      --ssh-key ~/.ssh/id_ed25519
    ```

  </Step>

  <Step title="安装 CrawClaw，在 VM shell 中执行">
    使用你的 deployment 支持的 install flow，为当前 host 安装 CrawClaw runtime。详见 [Install](/install)。

  </Step>

  <Step title="验证 Gateway">
    onboarding 完成后：

    从 VM shell 中先确认 local Gateway 有响应，再通过任何 remote access path 暴露：

    ```bash
    curl -fsS http://127.0.0.1:18789/health
    ```

    自动化时，使用你的 Gateway bearer token 调用 Gateway `system.health` RPC。packaged
    desktop onboarding 使用 CrawClaw Desktop；只有在 Gateway 可达且已有当前 `config.get`
    hash 后，才使用 `config.patch`。

    大多数企业 Azure 团队已经有 GitHub Copilot licenses。如果你属于这种情况，建议在 CrawClaw onboarding wizard 中选择 GitHub Copilot provider。参见 [GitHub Copilot provider](/providers/github-copilot)。

  </Step>
</Steps>

## 成本考虑

Azure Bastion Standard SKU 约 **\$140/month**，VM（Standard_B2as_v2）约 **\$55/month**。

降低成本：

- **不用时 deallocate VM**（停止 compute billing；disk charges 仍会保留）。VM deallocated 时 CrawClaw Gateway 不可访问，需要时再启动：

  ```bash
  az vm deallocate -g "${RG}" -n "${VM_NAME}"
  az vm start -g "${RG}" -n "${VM_NAME}"   # restart later
  ```

- **不需要时删除 Bastion**，需要 SSH access 时再重建。Bastion 是最大成本项，而且只需几分钟即可 provision。
- 如果只需要 Portal-based SSH，不需要 CLI tunneling（`az network bastion ssh`），可以使用 **Basic Bastion SKU**（约 \$38/month）。

## 清理

删除本指南创建的所有 resources：

```bash
az group delete -n "${RG}" --yes --no-wait
```

这会删除 resource group 和其中所有内容（VM、VNet、NSG、Bastion、public IP）。

## 后续步骤

- 设置 messaging channels：[Channels](/channels)
- 配置 Gateway：[Gateway configuration](/gateway/configuration)
- 了解更多 CrawClaw Azure deployment with GitHub Copilot model provider：[CrawClaw on Azure with GitHub Copilot](https://github.com/johnsonshi/crawclaw-azure-github-copilot)
