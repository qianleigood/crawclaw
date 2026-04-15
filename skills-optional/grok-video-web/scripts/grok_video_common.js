#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { launchPersistentBrowser, sleep } = require('./grok_puppeteer_lib');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const DEFAULT_PROFILE = 'grok-web';
const DEFAULT_JOB_SKILL = 'grok-video-web';

function nowIso() {
  return new Date().toISOString();
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function loadJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function saveJson(file, data) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function appendJsonl(file, data) {
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, JSON.stringify(data, null, 0) + '\n', 'utf8');
}

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index < 0) {return fallback;}
  const value = process.argv[index + 1];
  if (value == null || value.startsWith('--')) {return fallback;}
  return value;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function resolveJobPaths({ workspaceRoot = ROOT, jobDir = null, jobId = null } = {}) {
  let resolvedJobDir = jobDir ? path.resolve(jobDir) : null;
  const normalizedJobId = slugify(jobId || '');

  if (!resolvedJobDir) {
    if (!normalizedJobId) {
      throw new Error('missing --job-dir or --job-id');
    }
    resolvedJobDir = path.join(workspaceRoot, 'runtime', 'browser-jobs', DEFAULT_JOB_SKILL, normalizedJobId);
  }

  const stateDir = path.join(resolvedJobDir, 'state');
  return {
    workspaceRoot,
    jobDir: resolvedJobDir,
    stateDir,
    manifestPath: path.join(stateDir, 'job.json'),
    requestPath: path.join(stateDir, 'request.json'),
    runtimeStatePath: path.join(stateDir, 'runtime-state.json'),
    loginStatePath: path.join(stateDir, 'login-state.json'),
    eventsPath: path.join(stateDir, 'events.jsonl'),
    checkpointsPath: path.join(stateDir, 'checkpoints.jsonl'),
    latestCheckpointPath: path.join(stateDir, 'latest-checkpoint.json'),
  };
}

function loadJobBundle(options = {}) {
  const paths = resolveJobPaths(options);
  const manifest = loadJson(paths.manifestPath, null);
  const request = loadJson(paths.requestPath, null);
  if (!manifest) {
    throw new Error(`job manifest not found: ${paths.manifestPath}`);
  }
  if (!request) {
    throw new Error(`job request not found: ${paths.requestPath}`);
  }
  return { ...paths, manifest, request };
}

function resolveProfileName(bundle, cliProfile = null) {
  return slugify(cliProfile || bundle.request.profile || bundle.manifest.profile || DEFAULT_PROFILE) || DEFAULT_PROFILE;
}

function resolveProfileDir(profileName) {
  return path.join(ROOT, 'runtime', 'browser-profiles', profileName || DEFAULT_PROFILE);
}

function updateManifest(manifestPath, patch) {
  const current = loadJson(manifestPath, {}) || {};
  const next = deepMerge(current, patch);
  saveJson(manifestPath, next);
  return next;
}

function saveRuntimeState(runtimeStatePath, patch) {
  const current = loadJson(runtimeStatePath, {}) || {};
  const next = deepMerge(current, patch);
  saveJson(runtimeStatePath, next);
  return next;
}

function checkpoint(paths, payload) {
  const entry = {
    at: nowIso(),
    ...payload,
  };
  appendJsonl(paths.checkpointsPath, entry);
  saveJson(paths.latestCheckpointPath, entry);
  return entry;
}

function deepMerge(base, patch) {
  if (!isPlainObject(base) || !isPlainObject(patch)) {
    return patch;
  }
  const out = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const prev = out[key];
    if (isPlainObject(prev) && isPlainObject(value)) {
      out[key] = deepMerge(prev, value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function loadPlaywright() {
  throw new Error('loadPlaywright() is no longer the primary path for grok-video-web run/submit. Use Puppeteer-first helpers instead.');
}

async function launchPersistent(profileDir, options = {}) {
  return launchPersistentBrowser({
    profileDir,
    headless: options.headless ?? false,
    timeout: options.timeout ?? 15000,
    downloadsDir: options.downloadsDir || '',
    executablePath: options.executablePath || '',
  });
}

async function openSafeEntryPage(page) {
  if (!/^https:\/\/grok\.com(?:[/?#]|$)/.test(page.url()) || /https:\/\/grok\.com\/imagine/.test(page.url())) {
    await page.goto('https://grok.com', {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });
  } else {
    await page.bringToFront().catch(() => {});
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  }
  await sleep(1500);
  return page.url();
}

async function openImaginePage(page) {
  if (!/https:\/\/grok\.com\/imagine/.test(page.url())) {
    await page.goto('https://grok.com/imagine', {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });
  } else {
    await page.bringToFront().catch(() => {});
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  }
  await sleep(1500);
  return page.url();
}

async function readBodyText(page) {
  return page.evaluate(() => document.body?.innerText || '').catch(() => '');
}

async function collectPageSignals(page) {
  let bodyText = await readBodyText(page);
  if (!String(bodyText || '').trim()) {
    await sleep(2000);
    bodyText = await readBodyText(page);
  }
  const title = await page.title().catch(() => '');
  const url = page.url();
  const content = await page.content().catch(() => '');
  const domSignals = await page
    .evaluate(() => {
      const takeTexts = (selector) =>
        Array.from(document.querySelectorAll(selector))
          .map((node) => (node.innerText || node.textContent || '').trim())
          .filter(Boolean)
          .slice(0, 40);
      const localStorageKeys = [];
      try {
        for (let i = 0; i < window.localStorage.length; i += 1) {
          localStorageKeys.push(window.localStorage.key(i));
        }
      } catch {
        // ignore storage access failures
      }
      return {
        buttonTexts: takeTexts('button, [role="button"], [role="tab"], [role="radio"]'),
        linkTexts: takeTexts('a'),
        inputPlaceholders: Array.from(document.querySelectorAll('input, textarea'))
          .map((node) => node.getAttribute('placeholder') || '')
          .filter(Boolean)
          .slice(0, 20),
        localStorageKeys: localStorageKeys.filter(Boolean).slice(0, 80),
      };
    })
    .catch(() => ({ buttonTexts: [], linkTexts: [], inputPlaceholders: [], localStorageKeys: [] }));
  return {
    url,
    title,
    bodyText: String(bodyText || '').slice(0, 12000),
    bodyTextShort: String(bodyText || '').slice(0, 3000),
    contentSnippet: String(content || '').slice(0, 12000),
    ...domSignals,
  };
}

function detectLoginStateFromSignals(signals) {
  const haystack = [
    signals.url,
    signals.title,
    signals.bodyText,
    signals.contentSnippet,
    ...(signals.buttonTexts || []),
    ...(signals.linkTexts || []),
    ...(signals.inputPlaceholders || []),
    ...(signals.localStorageKeys || []),
  ].join('\n');
  const haystackLower = haystack.toLowerCase();

  const loggedInSignals = [
    ['项目', /(^|\s)项目(\s|$)/],
    ['projects', /(^|\s)projects(\s|$)/i],
    ['历史记录', /历史记录/],
    ['history', /(^|\s)history(\s|$)/i],
    ['查看全部', /查看全部/],
    ['view all', /view all/i],
    ['创建共享链接', /创建共享链接/],
    ['create share link', /create share link/i],
    ['下载', /(^|\s)下载(\s|$)/],
    ['download', /(^|\s)download(\s|$)/i],
    ['saved', /(^|\s)saved(\s|$)/i],
    ['settings', /(^|\s)settings(\s|$)|设置/i],
    ['make video', /make video|生成视频/i],
    ['private', /(^|\s)private(\s|$)/i],
    ['AF_SESSION', /\bAF_SESSION\b/],
    ['user-settings', /\buser-settings\b/i],
    ['logout', /log out|logout/i],
    ['account settings', /account settings|账号设置/i],
  ].filter(([, pattern]) => pattern.test(haystack)).map(([label]) => label);

  const loggedOutSignals = [
    ['登录', /登录/],
    ['注册', /注册/],
    ['sign in', /sign in/i],
    ['log in', /log in/i],
    ['sign up', /sign up/i],
    ['create account', /create account/i],
    ['continue with google', /continue with google/i],
    ['continue with x', /continue with x|continue with twitter/i],
    ['forgot password', /forgot password/i],
  ].filter(([, pattern]) => pattern.test(haystack)).map(([label]) => label);

  const cloudflareSignals = [
    'cloudflare',
    'verify you are human',
    'checking your browser',
    'attention required',
    'turnstile',
  ].filter((item) => haystackLower.includes(item));

  let state = 'uncertain';
  const hasLoggedInSignals = loggedInSignals.length > 0;
  const hasLoggedOutSignals = loggedOutSignals.length > 0;
  const hasChallengeSignals = cloudflareSignals.length > 0;

  if (hasChallengeSignals) {
    state = 'uncertain';
  } else if (hasLoggedInSignals && hasLoggedOutSignals) {
    state = 'uncertain';
  } else if (hasLoggedInSignals) {
    state = 'logged_in';
  } else if (hasLoggedOutSignals) {
    state = 'not_logged_in';
  }

  return {
    state,
    signals: {
      loggedIn: loggedInSignals,
      loggedOut: loggedOutSignals,
      cloudflare: cloudflareSignals,
    },
  };
}

async function resolveLoginState(page, options = {}) {
  const skipSafeEntryOpen = Boolean(options.skipSafeEntryOpen);
  const allowImagineFallback = options.allowImagineFallback !== false;
  const safeEntryUrl = skipSafeEntryOpen ? page.url() : await openSafeEntryPage(page);
  const safeEntrySignals = await collectPageSignals(page);
  const safeEntryLogin = detectLoginStateFromSignals(safeEntrySignals);

  let finalPageSignals = safeEntrySignals;
  let finalLogin = safeEntryLogin;
  let source = 'safe_entry';
  let imagineProbe = null;

  const shouldProbeImagine = allowImagineFallback
    && safeEntryLogin.state === 'uncertain'
    && !(safeEntryLogin.signals.cloudflare || []).length;

  if (shouldProbeImagine) {
    const imagineUrl = await openImaginePage(page);
    const imagineSignals = await collectPageSignals(page);
    const imagineLogin = detectLoginStateFromSignals(imagineSignals);
    imagineProbe = {
      url: imagineUrl,
      pageSignals: imagineSignals,
      login: imagineLogin,
    };
    if (imagineLogin.state !== 'uncertain') {
      finalPageSignals = imagineSignals;
      finalLogin = imagineLogin;
      source = 'imagine_secondary_probe';
    }
  }

  return {
    safeEntryUrl,
    source,
    pageSignals: finalPageSignals,
    login: finalLogin,
    safeEntry: {
      url: safeEntryUrl,
      pageSignals: safeEntrySignals,
      login: safeEntryLogin,
    },
    imagineProbe,
  };
}

function summarizeRequest(request) {
  const references = Array.isArray(request.references) ? request.references : [];
  return {
    prompt: request.prompt || '',
    resolution: request.resolution || '',
    duration: request.duration || '',
    aspectRatio: request.aspectRatio || '',
    referencesCount: references.length,
    references,
  };
}

module.exports = {
  ROOT,
  DEFAULT_PROFILE,
  DEFAULT_JOB_SKILL,
  nowIso,
  ensureDir,
  loadJson,
  saveJson,
  appendJsonl,
  arg,
  hasFlag,
  slugify,
  resolveJobPaths,
  loadJobBundle,
  resolveProfileName,
  resolveProfileDir,
  updateManifest,
  saveRuntimeState,
  checkpoint,
  loadPlaywright,
  launchPersistent,
  openSafeEntryPage,
  openImaginePage,
  collectPageSignals,
  detectLoginStateFromSignals,
  resolveLoginState,
  summarizeRequest,
  sleep,
};
