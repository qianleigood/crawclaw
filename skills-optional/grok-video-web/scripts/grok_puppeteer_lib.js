#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const WORKSPACE_ROOT = path.resolve(__dirname, '..', '..', '..');
const RUNTIME_ROOT = path.join(WORKSPACE_ROOT, 'runtime', 'puppeteer-grok-test');
const DEFAULT_CHROME_CANDIDATES = [
  process.env.CHROME_PATH || '',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].filter(Boolean);

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolvePuppeteerCore() {
  const candidates = [
    path.join(RUNTIME_ROOT, 'node_modules', 'puppeteer-core'),
    'puppeteer-core',
  ];
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch {
      // continue
    }
  }
  throw new Error(`Unable to resolve puppeteer-core. Expected install under ${RUNTIME_ROOT}`);
}

function resolveChromeExecutablePath(explicitPath = '') {
  for (const candidate of [explicitPath, ...DEFAULT_CHROME_CANDIDATES]) {
    if (candidate && fs.existsSync(candidate)) {return candidate;}
  }
  throw new Error(`Chrome executable not found. Checked: ${DEFAULT_CHROME_CANDIDATES.join(', ')}`);
}

function attachPageCompat(page) {
  if (typeof page.waitForTimeout !== 'function') {
    page.waitForTimeout = (ms) => sleep(ms);
  }
  return page;
}

async function selectOrCreateGrokPage(browser) {
  const pages = await browser.pages();
  const preferred = pages.find((page) => /https:\/\/grok\.com\//.test(page.url())) || pages[0];
  if (preferred) {return attachPageCompat(preferred);}
  return attachPageCompat(await browser.newPage());
}

async function allowDownloads(page, downloadsDir) {
  if (!downloadsDir || typeof page.target !== 'function') {return;}
  try {
    ensureDir(downloadsDir);
    const client = await page.target().createCDPSession();
    await client.send('Page.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: downloadsDir,
    });
  } catch {
    // Best-effort only. Wait/download phase still has a Playwright fallback today.
  }
}

async function launchPersistentBrowser(options = {}) {
  const puppeteer = resolvePuppeteerCore();
  const profileDir = ensureDir(path.resolve(options.profileDir));
  const executablePath = resolveChromeExecutablePath(options.executablePath || '');
  const headless = options.headless ?? false;

  const browser = await puppeteer.launch({
    executablePath,
    headless,
    userDataDir: profileDir,
    defaultViewport: null,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-default-browser-check',
      '--start-maximized',
    ],
  });

  const page = await selectOrCreateGrokPage(browser);
  if (typeof page.setDefaultTimeout === 'function') {
    page.setDefaultTimeout(options.timeout ?? 15000);
  }
  await allowDownloads(page, options.downloadsDir || '');
  return {
    browser,
    context: browser,
    page,
    profileDir,
    executablePath,
    engine: 'puppeteer',
  };
}

module.exports = {
  WORKSPACE_ROOT,
  RUNTIME_ROOT,
  ensureDir,
  sleep,
  resolvePuppeteerCore,
  resolveChromeExecutablePath,
  attachPageCompat,
  selectOrCreateGrokPage,
  launchPersistentBrowser,
};
