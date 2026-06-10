---
summary: "Move (migrate) a CrawClaw install from one machine to another"
read_when:
  - You are moving CrawClaw to a new laptop/server
  - You want to preserve sessions, auth, and channel logins (Weixin, etc.)
title: "Migration Guide"
---

# Migrating CrawClaw to a New Machine

This guide moves a CrawClaw gateway to a new machine without redoing onboarding.

## What Gets Migrated

When you copy the **state directory** (`~/.crawclaw/` by default) and your **workspace**, you preserve:

- **Config** -- `crawclaw.json` and all gateway settings
- **Auth** -- API keys, OAuth tokens, credential profiles
- **Sessions** -- conversation history and agent state
- **Channel state** -- Weixin login, Feishu session, etc.
- **Workspace files** -- `MEMORY.md`, `USER.md`, skills, and prompts

<Tip>
In CrawClaw Desktop, open **Settings** → **Data and Privacy** and read **Current desktop data directory** before you archive anything.
The default desktop runtime uses `~/.crawclaw`; custom profiles use `~/.crawclaw-<profile>/` or a path set via `CRAWCLAW_STATE_DIR`.
</Tip>

## Migration Steps

<Steps>
  <Step title="Stop the gateway and back up">
    On the **old** machine, quit CrawClaw Desktop or stop the service that owns the Gateway so files are not changing mid-copy, then archive the state directory:

    ```bash
    cd ~
    tar -czf crawclaw-state.tgz .crawclaw
    ```

    If **Current desktop data directory** points somewhere else, archive that exact directory instead. If you use multiple profiles, archive each state directory separately.

  </Step>

  <Step title="Install CrawClaw on the new machine">
    [Install CrawClaw Desktop](/install) on the new machine, or follow your server runtime guide for a headless Gateway host.
    It is fine if onboarding creates a fresh `~/.crawclaw/` -- you will overwrite it next.
  </Step>

  <Step title="Copy state directory and workspace">
    Quit CrawClaw Desktop on the new machine, transfer the archive via `scp`, `rsync -a`, or an external drive, then extract:

    ```bash
    cd ~
    tar -xzf crawclaw-state.tgz
    ```

    Ensure hidden directories were included and file ownership matches the user that will run the gateway.

  </Step>

  <Step title="Refresh runtime and verify">
    Launch CrawClaw Desktop on the new machine. Open **Settings** → **Advanced**, click **Refresh Runtime**, then generate **Diagnostics** if the runtime is not ready. Confirm **Settings** → **Data and Privacy** shows the migrated data directory. For automation or external monitoring, use the [Gateway health API](/gateway/health).

  </Step>
</Steps>

## Common Pitfalls

<AccordionGroup>
  <Accordion title="Profile or state-dir mismatch">
    If the old gateway used `--profile` or `CRAWCLAW_STATE_DIR` and the new one does not,
    channels will appear logged out and sessions will be empty.
    Launch the gateway with the **same** profile or state directory you migrated, then confirm CrawClaw Desktop shows that directory under **Settings** → **Data and Privacy**.
  </Accordion>

  <Accordion title="Copying only crawclaw.json">
    The config file alone is not enough. Credentials live under `credentials/`, and agent
    state lives under `agents/`. Always migrate the **entire** state directory.
  </Accordion>

  <Accordion title="Permissions and ownership">
    If you copied as root or switched users, the gateway may fail to read credentials.
    Ensure the state directory and workspace are owned by the user running the gateway.
  </Accordion>

  <Accordion title="Remote mode">
    If your UI points at a **remote** gateway, the remote host owns sessions and workspace.
    Migrate the gateway host itself, not your local laptop. See [FAQ](/help/faq#where-things-live-on-disk).
  </Accordion>

  <Accordion title="Secrets in backups">
    The state directory contains API keys, OAuth tokens, and channel credentials.
    Store backups encrypted, avoid insecure transfer channels, and rotate keys if you suspect exposure.
  </Accordion>
</AccordionGroup>

## Verification Checklist

On the new machine, confirm:

- [ ] **Settings** → **Advanced** shows the runtime is ready, or the Gateway health API reports healthy
- [ ] **Settings** → **Data and Privacy** shows the migrated state directory
- [ ] Channels are still connected (no re-pairing needed)
- [ ] The dashboard opens and shows existing sessions
- [ ] Workspace files (memory, configs) are present
