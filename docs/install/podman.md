---
summary: "Run CrawClaw in a rootless Podman container"
read_when:
  - You want a containerized gateway with Podman instead of Docker
title: "Podman"
---

# Podman

Run the CrawClaw Gateway in a rootless Podman container, managed by your current non-root user.

The intended model is:

- Podman runs the gateway container.
- Your host `crawclaw` CLI is the control plane.
- Persistent state lives on the host under `~/.crawclaw` by default.
- Day-to-day management uses `crawclaw --container <name> ...` instead of `sudo -u crawclaw`, `podman exec`, or a separate service user.

## Prerequisites

- **Podman** in rootless mode
- **CrawClaw CLI** installed on the host
- **Optional:** `systemd --user` if you want Quadlet-managed auto-start
- **Optional:** `sudo` only if you want `loginctl enable-linger "$(whoami)"` for boot persistence on a headless host

## Quick start

<Steps>
  <Step title="One-time setup">
    From the repo root, run `./scripts/podman/setup.sh`.
  </Step>

  <Step title="Start the Gateway container">
    Start the container with `./scripts/run-crawclaw-podman.sh launch`.
  </Step>

  <Step title="Run onboarding inside the container">
    Run `./scripts/run-crawclaw-podman.sh launch setup`, then open `http://127.0.0.1:18789/`.
  </Step>

  <Step title="Manage the running container from the host CLI">
    Set `CRAWCLAW_CONTAINER=crawclaw`, then use normal `crawclaw` commands from the host.
  </Step>
</Steps>

Setup details:

- `./scripts/podman/setup.sh` builds `crawclaw:local` in your rootless Podman store by default, or uses `CRAWCLAW_IMAGE` / `CRAWCLAW_PODMAN_IMAGE` if you set one.
- It creates `~/.crawclaw/crawclaw.json` with `gateway.mode: "local"` if missing.
- It creates `~/.crawclaw/.env` with `CRAWCLAW_GATEWAY_TOKEN` if missing.
- For manual launches, the helper reads only a small allowlist of Podman-related keys from `~/.crawclaw/.env` and passes explicit runtime env vars to the container; it does not hand the full env file to Podman.

Quadlet-managed setup:

```bash
./scripts/podman/setup.sh --quadlet
```

Quadlet is a Linux-only option because it depends on systemd user services.

You can also set `CRAWCLAW_PODMAN_QUADLET=1`.

Optional build/setup env vars:

- `CRAWCLAW_IMAGE` or `CRAWCLAW_PODMAN_IMAGE` -- use an existing/pulled image instead of building `crawclaw:local`
- `CRAWCLAW_DOCKER_APT_PACKAGES` -- install extra apt packages during image build
- `CRAWCLAW_EXTENSIONS` -- pre-install extension dependencies at build time

Container start:

```bash
./scripts/run-crawclaw-podman.sh launch
```

The script starts the container as your current uid/gid with `--userns=keep-id` and bind-mounts your CrawClaw state into the container.

Onboarding:

```bash
./scripts/run-crawclaw-podman.sh launch setup
```

Then open `http://127.0.0.1:18789/` and use the token from `~/.crawclaw/.env`.

Host CLI default:

```bash
export CRAWCLAW_CONTAINER=crawclaw
```

Then commands such as these will run inside that container automatically:

```bash
crawclaw tui
crawclaw gateway status --deep
crawclaw doctor
crawclaw channels login
```

On macOS, Podman machine may make the browser appear non-local to the gateway.
If a browser client reports device-auth errors after launch, use the Tailscale guidance in
[Podman + Tailscale](#podman--tailscale).

<a id="podman--tailscale"></a>

## Podman + Tailscale

For HTTPS or remote browser access, follow the main Tailscale docs.

Podman-specific note:

- Keep the Podman publish host at `127.0.0.1`.
- Prefer host-managed `tailscale serve` over `crawclaw gateway --tailscale serve`.
- On macOS, if local browser device-auth context is unreliable, use Tailscale access instead of ad hoc local tunnel workarounds.

See:

- [Tailscale](/gateway/tailscale)
- [Remote access](/gateway/remote)

## Systemd (Quadlet, optional)

If you ran `./scripts/podman/setup.sh --quadlet`, setup installs a Quadlet file at:

```bash
~/.config/containers/systemd/crawclaw.container
```

Useful commands:

- **Start:** `systemctl --user start crawclaw.service`
- **Stop:** `systemctl --user stop crawclaw.service`
- **Status:** `systemctl --user status crawclaw.service`
- **Logs:** `journalctl --user -u crawclaw.service -f`

After editing the Quadlet file:

```bash
systemctl --user daemon-reload
systemctl --user restart crawclaw.service
```

For boot persistence on SSH/headless hosts, enable lingering for your current user:

```bash
sudo loginctl enable-linger "$(whoami)"
```

## Config, env, and storage

- **Config dir:** `~/.crawclaw`
- **Workspace dir:** `~/.crawclaw/workspace`
- **Token file:** `~/.crawclaw/.env`
- **Launch helper:** `./scripts/run-crawclaw-podman.sh`

The launch script and Quadlet bind-mount host state into the container:

- `CRAWCLAW_CONFIG_DIR` -> `/home/node/.crawclaw`
- `CRAWCLAW_WORKSPACE_DIR` -> `/home/node/.crawclaw/workspace`

By default those are host directories, not anonymous container state, so config and workspace survive container replacement.
The Podman setup also seeds `gateway.browserClients.allowedOrigins` for `127.0.0.1` and `localhost` on the published gateway port so local browser clients work with the container's non-loopback bind.

Useful env vars for the manual launcher:

- `CRAWCLAW_PODMAN_CONTAINER` -- container name (`crawclaw` by default)
- `CRAWCLAW_PODMAN_IMAGE` / `CRAWCLAW_IMAGE` -- image to run
- `CRAWCLAW_PODMAN_GATEWAY_HOST_PORT` -- host port mapped to container `18789`
- `CRAWCLAW_PODMAN_BRIDGE_HOST_PORT` -- host port mapped to container `18790`
- `CRAWCLAW_PODMAN_PUBLISH_HOST` -- host interface for published ports; default is `127.0.0.1`
- `CRAWCLAW_GATEWAY_BIND` -- gateway bind mode inside the container; default is `lan`
- `CRAWCLAW_PODMAN_USERNS` -- `keep-id` (default), `auto`, or `host`

The manual launcher reads `~/.crawclaw/.env` before finalizing container/image defaults, so you can persist these there.

If you use a non-default `CRAWCLAW_CONFIG_DIR` or `CRAWCLAW_WORKSPACE_DIR`, set the same variables for both `./scripts/podman/setup.sh` and later `./scripts/run-crawclaw-podman.sh launch` commands. The repo-local launcher does not persist custom path overrides across shells.

Quadlet note:

- The generated Quadlet service intentionally keeps a fixed, hardened default shape: `127.0.0.1` published ports, `--bind lan` inside the container, and `keep-id` user namespace.
- It still reads `~/.crawclaw/.env` for gateway runtime env such as `CRAWCLAW_GATEWAY_TOKEN`, but it does not consume the manual launcher's Podman-specific override allowlist.
- If you need custom publish ports, publish host, or other container-run flags, use the manual launcher or edit `~/.config/containers/systemd/crawclaw.container` directly, then reload and restart the service.

## Useful commands

- **Container logs:** `podman logs -f crawclaw`
- **Stop container:** `podman stop crawclaw`
- **Remove container:** `podman rm -f crawclaw`
- **Open the local terminal UI from host CLI:** `crawclaw tui`
- **Health/status via host CLI:** `crawclaw gateway status --deep`

## Troubleshooting

- **Permission denied (EACCES) on config or workspace:** The container runs with `--userns=keep-id` and `--user <your uid>:<your gid>` by default. Ensure the host config/workspace paths are owned by your current user.
- **Gateway start blocked (missing `gateway.mode=local`):** Ensure `~/.crawclaw/crawclaw.json` exists and sets `gateway.mode="local"`. `scripts/podman/setup.sh` creates this if missing.
- **Container CLI commands hit the wrong target:** Use `crawclaw --container <name> ...` explicitly, or export `CRAWCLAW_CONTAINER=<name>` in your shell.
- **`crawclaw update` fails with `--container`:** Expected. Rebuild/pull the image, then restart the container or the Quadlet service.
- **Quadlet service does not start:** Run `systemctl --user daemon-reload`, then `systemctl --user start crawclaw.service`. On headless systems you may also need `sudo loginctl enable-linger "$(whoami)"`.
- **SELinux blocks bind mounts:** Leave the default mount behavior alone; the launcher auto-adds `:Z` on Linux when SELinux is enforcing or permissive.

## Related

- [Docker](/install/docker)
- [Gateway background process](/gateway/background-process)
- [Gateway troubleshooting](/gateway/troubleshooting)
