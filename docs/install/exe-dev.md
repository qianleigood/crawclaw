---
summary: "Run CrawClaw Gateway on exe.dev (VM + HTTPS proxy) for remote access"
read_when:
  - You want a cheap always-on Linux host for the Gateway
  - You want remote gateway client access without running your own VPS
title: "exe.dev"
---

# exe.dev

Goal: CrawClaw Gateway running on an exe.dev VM, reachable from your laptop via: `https://<vm-name>.exe.xyz`

This page assumes exe.dev's default **exeuntu** image. If you picked a different distro, map packages accordingly.

## Beginner quick path

1. [https://exe.new/crawclaw](https://exe.new/crawclaw)
2. Fill in your auth key/token as needed
3. Click on "Agent" next to your VM and wait for Shelley to finish provisioning
4. Open a supported gateway client against `https://<vm-name>.exe.xyz/` and authenticate with your gateway token
5. Approve any pending device pairing requests with `crawclaw devices approve <requestId>`

## What you need

- exe.dev account
- `ssh exe.dev` access to [exe.dev](https://exe.dev) virtual machines (optional)

## Automated Install with Shelley

Shelley, [exe.dev](https://exe.dev)'s agent, can install CrawClaw instantly with our
prompt. The prompt used is as below:

```
Set up CrawClaw (https://docs.crawclaw.ai/install) on this VM. Use the non-interactive and accept-risk flags for crawclaw onboarding. Add the supplied auth or token as needed. Configure nginx to forward from the default port 18789 to the root location on the default enabled site config, making sure to enable Websocket support. Pairing is done by "crawclaw devices list" and "crawclaw devices approve <request id>". Make sure CrawClaw health is OK via `crawclaw health`. exe.dev handles forwarding from port 8000 to port 80/443 and HTTPS for us, so the final "reachable" should be <vm-name>.exe.xyz, without port specification.
```

## Manual installation

## 1) Create the VM

From your device:

```bash
ssh exe.dev new
```

Then connect:

```bash
ssh <vm-name>.exe.xyz
```

Tip: keep this VM **stateful**. CrawClaw stores state under `~/.crawclaw/` and `~/.crawclaw/workspace/`.

## 2) Install prerequisites (on the VM)

```bash
sudo apt-get update
sudo apt-get install -y git curl jq ca-certificates openssl
```

## 3) Install CrawClaw

Run the CrawClaw install script:

```bash
curl -fsSL https://crawclaw.ai/install.sh | bash
```

## 4) Setup nginx to proxy CrawClaw to port 8000

Edit `/etc/nginx/sites-enabled/default` with

```
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    listen 8000;
    listen [::]:8000;

    server_name _;

    location / {
        proxy_pass http://127.0.0.1:18789;
        proxy_http_version 1.1;

        # WebSocket support
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # Standard proxy headers
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Timeout settings for long-lived connections
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
```

## 5) Access CrawClaw and grant privileges

Access `https://<vm-name>.exe.xyz/` from a supported gateway client. If it prompts for auth, use the
token from `gateway.auth.token` on the VM (retrieve with `crawclaw config get gateway.auth.token`, or generate one
with `crawclaw doctor --generate-gateway-token`). Approve devices with `crawclaw devices list` and
`crawclaw devices approve <requestId>`. When in doubt, use Shelley from your browser.

## Remote Access

Remote access is handled by [exe.dev](https://exe.dev)'s authentication. By
default, HTTP traffic from port 8000 is forwarded to `https://<vm-name>.exe.xyz`
with email auth.

## Updating

```bash
npm i -g crawclaw@latest
crawclaw doctor
crawclaw gateway restart
crawclaw health
```

Guide: [Updating](/install/updating)
