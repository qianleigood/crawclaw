#!/usr/bin/env node
'use strict';

const path = require('path');
const {
  collectPageSignals,
  detectLoginStateFromSignals,
  openSafeEntryPage,
  resolveProfileDir,
} = require('./grok_video_common');
const { launchPersistentBrowser } = require('./grok_puppeteer_lib');

const DEFAULT_PROFILE = 'grok-web';

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      args._.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next == null || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const profile = String(args.profile || DEFAULT_PROFILE);
  const holdSec = Number(args['hold-sec'] || 900);
  const targetUrl = String(args['target-url'] || args.url || '').trim();
  const openTargetAfterLogin = Boolean(targetUrl);
  const profileDir = resolveProfileDir(profile);

  const launched = await launchPersistentBrowser({
    profileDir,
    headless: false,
    timeout: 45000,
    executablePath: String(args['chrome-path'] || ''),
  });
  const browser = launched.browser;
  const page = launched.page;

  await openSafeEntryPage(page);
  const pageSignals = await collectPageSignals(page);
  const login = detectLoginStateFromSignals(pageSignals);

  let targetOpened = false;
  let targetOpenBlocked = false;
  let targetOpenReason = '';
  if (openTargetAfterLogin) {
    if (login.state === 'logged_in') {
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(1500).catch(() => {});
      targetOpened = true;
    } else {
      targetOpenBlocked = true;
      targetOpenReason = login.state === 'not_logged_in'
        ? 'target_requires_logged_in_profile'
        : 'login_state_uncertain';
    }
  }

  console.log(JSON.stringify({
    ok: !targetOpenBlocked,
    profile,
    userDataDir: profileDir,
    executablePath: launched.executablePath,
    safeEntryUrl: 'https://grok.com/',
    url: page.url(),
    targetUrl: targetUrl || '',
    targetOpened,
    targetOpenBlocked,
    targetOpenReason,
    holdSec,
    loginState: login.state,
    matchedSignals: login.signals,
    note: openTargetAfterLogin
      ? (targetOpened
        ? 'Puppeteer confirmed login on the Grok safe-entry root page, then opened the requested target URL and is keeping the window alive.'
        : 'Puppeteer stayed on the Grok safe-entry root page because login could not be confirmed cleanly before opening the requested target URL.')
      : (holdSec > 0
        ? 'Puppeteer opened Grok safe-entry root page and is keeping the window alive.'
        : 'Puppeteer probed Grok safe-entry root page without an extended hold.'),
  }, null, 2));

  if (holdSec <= 0) {
    await browser.close().catch(() => {});
    return;
  }

  const close = async () => {
    try {
      await browser.close();
    } catch {}
    process.exit(0);
  };
  process.on('SIGINT', close);
  process.on('SIGTERM', close);

  await new Promise((resolve) => setTimeout(resolve, holdSec * 1000));
  await close();
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
