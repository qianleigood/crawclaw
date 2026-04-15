#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function parseArgs(argv) {
  const args = {
    platform: 'xiaohongshu',
    mode: 're-login',
    host: '127.0.0.1',
    launchBrowser: true,
    xhsSkillRoot: path.join(__dirname, '..', '..', 'redbook-skills'),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--help' || token === '-h') {
      args.help = true;
      continue;
    }
    if (token === '--no-launch-browser') {
      args.launchBrowser = false;
      continue;
    }
    if (token === '--force') {
      args.force = true;
      continue;
    }
    if (!token.startsWith('--')) {continue;}
    const key = token.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = value;
    i += 1;
  }
  return args;
}

function printHelp() {
  process.stdout.write(`Usage: node scripts/start_login.js [options]\n\n` +
    `Options:\n` +
    `  --platform xiaohongshu        Platform to open login for (default: xiaohongshu)\n` +
    `  --mode login|re-login|home-login\n` +
    `  --account <name>              XHS account name\n` +
    `  --port <port>                 CDP port\n` +
    `  --host <host>                 CDP host (default: 127.0.0.1)\n` +
    `  --xhs-skill-root <path>       Path to redbook-skills root (xiaohongshuskills compatibility path also works)\n` +
    `  --no-launch-browser           Do not call chrome_launcher.py first\n` +
    `  --force                       Skip precheck and force open login flow\n`);
}

function fail(message, extra = {}) {
  const payload = {
    status: 'error',
    message,
    ...extra,
  };
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exit(1);
}

function requireFrom(root, relativePath) {
  return require(path.join(root, relativePath));
}

function runCommand(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    encoding: 'utf8',
    ...options,
  });
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  if ((args.platform || 'xiaohongshu') !== 'xiaohongshu') {
    fail('Only xiaohongshu is supported right now.', { platform: args.platform });
  }

  const xhsRoot = path.resolve(String(args.xhsSkillRoot));
  if (!fs.existsSync(xhsRoot)) {
    fail(`redbook-skills root not found: ${xhsRoot}`);
  }

  const { DEFAULT_HOST } = requireFrom(xhsRoot, 'node/src/core/constants.js');
  const { withBrowserSession, delay } = requireFrom(xhsRoot, 'node/src/core/browser.js');
  const { resolveAccountName, resolveDebugPort } = requireFrom(xhsRoot, 'node/src/core/accounts.js');
  const {
    checkCreatorLogin,
    checkHomeLogin,
    clearCookies,
    openLoginPage,
    openHomeLoginPage,
    captureLoginQrScreenshot,
    captureHomeLoginScreenshot,
    buildLoginQrPath,
  } = requireFrom(xhsRoot, 'node/src/auth/login.js');

  const accountName = resolveAccountName(args.account);
  const port = resolveDebugPort(accountName, args.port ? Number(args.port) : undefined);
  const host = String(args.host || DEFAULT_HOST || '127.0.0.1');
  const mode = String(args.mode || 're-login');

  if (!['login', 're-login', 'home-login'].includes(mode)) {
    fail(`Unsupported mode: ${mode}`);
  }

  if (args.launchBrowser) {
    const runPython = path.join(xhsRoot, 'run-python.sh');
    const launcherScript = path.join(xhsRoot, 'scripts', 'chrome_launcher.py');
    const launchResult = runCommand(runPython, [launcherScript, '--account', accountName, '--port', String(port)], {
      cwd: xhsRoot,
    });
    if (launchResult.status !== 0) {
      fail('Failed to prepare Chrome for login.', {
        stdout: launchResult.stdout || '',
        stderr: launchResult.stderr || '',
        exit_code: launchResult.status,
      });
    }
  }

  const payload = await withBrowserSession(
    {
      host,
      port,
      accountName,
      reuseExistingTab: false,
      autoClosePage: false,
    },
    async ({ page, browser, reusedExistingTab }) => {
      const ctx = { page, browser, reusedExistingTab, accountName, host, port };
      const scope = mode === 'home-login' ? 'home' : 'creator';

      if (!args.force && mode !== 're-login') {
        const existing = scope === 'home' ? await checkHomeLogin(ctx) : await checkCreatorLogin(ctx);
        if (existing && existing.loggedIn) {
          return {
            status: 'already_logged_in',
            platform: 'xiaohongshu',
            mode,
            account: accountName,
            host,
            port,
            scope,
            screenshot_path: null,
            current_url: page.url(),
          };
        }
      }

      if (mode === 're-login') {
        await clearCookies(ctx);
        await delay(1000);
      }

      if (mode === 'home-login') {
        await openHomeLoginPage(ctx);
      } else {
        await openLoginPage(ctx);
      }

      await page.bringToFront().catch(() => {});
      await delay(1200);

      if (!args.force && mode !== 're-login') {
        const afterOpen = scope === 'home' ? await checkHomeLogin(ctx) : await checkCreatorLogin(ctx);
        if (afterOpen && afterOpen.loggedIn) {
          return {
            status: 'already_logged_in',
            platform: 'xiaohongshu',
            mode,
            account: accountName,
            host,
            port,
            scope,
            screenshot_path: null,
            current_url: page.url(),
          };
        }
      }

      const screenshotPath = buildLoginQrPath({ accountName, commandName: mode, scope });
      if (scope === 'home') {
        await captureHomeLoginScreenshot(page, screenshotPath);
      } else {
        await captureLoginQrScreenshot(page, screenshotPath);
      }

      return {
        status: 'qr_ready',
        platform: 'xiaohongshu',
        mode,
        account: accountName,
        host,
        port,
        scope,
        screenshot_path: screenshotPath,
        current_url: page.url(),
      };
    }
  );

  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

main().catch((error) => {
  fail(error && error.message ? error.message : 'Unknown error', {
    stack: error && error.stack ? error.stack : '',
  });
});
