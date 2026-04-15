---
name: platform-login-helper
description: Check Xiaohongshu login state, start or refresh QR-code login, capture the QR screenshot for the current chat, and verify login after the user scans. Use when the user asks to check whether Xiaohongshu is logged in, re-login after session expiry, open a QR code for scanning, or block downstream collection/publishing until login is confirmed. Suitable as a shared login gate for content-collection and publishing workflows. Douyin is not fully wired yet and should be treated as blocked unless a custom command is explicitly provided.
metadata: { "crawclaw": { "workflow": { "portability": "human", "stepKind": "human_wait", "waitKind": "input", "requiresApproval": true, "notes": "This login gate requires a human QR scan before the workflow can continue." } } }
---

# Platform Login Helper

Use this skill as the reusable login gate before any Xiaohongshu collection or publishing flow.

## Core workflow

1. **Check login first**
   - Run `scripts/check_login.py`.
   - Prefer `--xhs-mode auto` for normal use.
   - Prefer `--xhs-mode live` when you need a real-time confirmation.

2. **If not logged in, start login**
   - Run `scripts/start_login.js`.
   - It opens the login page in the existing Xiaohongshu Chrome profile and captures a QR screenshot.
   - It returns a `screenshot_path`; send that image to the current chat with the `message` tool.

3. **Wait for the user to scan**
   - Do not assume login succeeded just because a QR was shown.
   - After the user says they scanned, re-run `scripts/check_login.py --xhs-mode live` against the same port.

4. **Only proceed when confirmed**
   - `logged_in=true` → continue the downstream task.
   - `not_logged_in` → ask the user to retry scan or refresh login.
   - `blocked/unsupported/error/timeout` → surface the blocker instead of pretending login is valid.

## Xiaohongshu commands

### Check login

```bash
python3 scripts/check_login.py --platforms xiaohongshu --xhs-account zenbliss --xhs-mode auto
python3 scripts/check_login.py --platforms xiaohongshu --xhs-account zenbliss --xhs-mode live --xhs-port 9224
```

Exit codes:
- `0` = logged in
- `1` = not logged in
- `2` = blocked / unsupported / timeout / error

### Start QR login

```bash
node scripts/start_login.js --platform xiaohongshu --account zenbliss --port 9224 --mode re-login
node scripts/start_login.js --platform xiaohongshu --account zenbliss --port 9224 --mode login
node scripts/start_login.js --platform xiaohongshu --account zenbliss --port 9224 --mode home-login
```

The script prints JSON with:
- `status` (`qr_ready` or `already_logged_in`)
- `account`
- `port`
- `scope`
- `screenshot_path`
- `current_url`

## Operational rules

- Default to **shared/global reuse**. This skill is meant to be called by other workflows, not buried inside one project skill.
- Use `re-login` when the user explicitly wants a fresh scan or the session is stale.
- Use `login` when you only need to open the creator login page without clearing cookies.
- Use `home-login` when a downstream workflow depends on Xiaohongshu home-domain login.
- After QR capture, **send the screenshot with the `message` tool** rather than relying on embedded helper scripts.
- If live check is flaky right after launch, retry the live check once after a short pause before declaring failure.
- Treat Douyin as **not production-ready in this skill** until a real login-check path is wired.

## Bundled scripts

- `scripts/check_login.py` — structured login gate for Xiaohongshu now, Douyin placeholder/blocked path.
- `scripts/start_login.js` — opens Xiaohongshu login and captures QR screenshot without depending on Feishu helper glue.
- `scripts/smoke_test.sh` — basic regression checks for this skill.
