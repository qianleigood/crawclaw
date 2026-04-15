#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { createJobLogger } = require('./grok_job_logger');
const {
  collectPageSignals,
  detectLoginStateFromSignals,
  resolveLoginState,
  openSafeEntryPage,
  openImaginePage,
} = require('./grok_video_common');

const SCRIPT_DIR = __dirname;
const SKILL_ROOT = path.resolve(SCRIPT_DIR, '..');
const WORKSPACE_ROOT = path.resolve(SKILL_ROOT, '..', '..');
const DEFAULT_PROFILE = 'grok-web';
const PROFILE_ROOT = path.join(WORKSPACE_ROOT, 'runtime', 'browser-profiles');
const GENERATED_VIDEO_URLS_PATH = path.join(WORKSPACE_ROOT, 'runtime', 'browser-jobs', 'grok-video-web', 'generated-video-urls.jsonl');
const RESULT_URL_RE = /https?:\/\/grok\.com\/imagine\/post\/[^\s"'<>\\]+/i;

function nowIso() {
  return new Date().toISOString();
}

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function appendJsonl(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, JSON.stringify(value) + '\n', 'utf8');
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeFileName(input) {
  const name = String(input || 'artifact')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return name || 'artifact';
}

function fileExists(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function dirExists(dirPath) {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

function uniquePath(dirPath, fileName) {
  const parsed = path.parse(fileName);
  let candidate = path.join(dirPath, fileName);
  let index = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dirPath, `${parsed.name}-${index}${parsed.ext}`);
    index += 1;
  }
  return candidate;
}

function normalizeArgKey(key) {
  return String(key || '').trim().replace(/_/g, '-');
}

function parseArgs(argv) {
  const args = {
    _: [],
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--') {
      args._.push(...argv.slice(i + 1));
      break;
    }
    if (!token.startsWith('--')) {
      args._.push(token);
      continue;
    }
    const key = normalizeArgKey(token.slice(2));
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

function pickString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {return value.trim();}
  }
  return '';
}

function maybeResultUrl(value) {
  if (typeof value !== 'string') {return '';}
  const text = value.trim();
  if (!text) {return '';}
  const match = text.match(RESULT_URL_RE);
  if (!match) {return '';}
  return String(match[0] || '').replace(/[\\]+$/g, '').trim();
}

function searchResultUrl(value) {
  if (!value) {return '';}
  if (typeof value === 'string') {return maybeResultUrl(value);}
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = searchResultUrl(item);
      if (found) {return found;}
    }
    return '';
  }
  if (typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (/^sourceResultUrl$/i.test(key)) {
        continue;
      }
      if (/^(newResultUrl|resultUrl)$/i.test(key)) {
        const direct = maybeResultUrl(item);
        if (direct) {return direct;}
      }
    }
    for (const [key, item] of Object.entries(value)) {
      if (/^sourceResultUrl$/i.test(key)) {
        continue;
      }
      if (/url/i.test(key)) {
        const direct = maybeResultUrl(item);
        if (direct) {return direct;}
      }
      const found = searchResultUrl(item);
      if (found) {return found;}
    }
  }
  return '';
}

function parseNumber(value, fallback) {
  if (value == null || value === '') {return fallback;}
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function resolveJob(args = {}) {
  const jobDirArg = args['job-dir'] || args.jobDir || '';
  const jobIdArg = args['job-id'] || args.jobId || '';
  const jobDir = jobDirArg
    ? path.resolve(jobDirArg)
    : path.join(WORKSPACE_ROOT, 'runtime', 'browser-jobs', 'grok-video-web', jobIdArg);

  if (!jobDirArg && !jobIdArg) {
    throw new Error('missing --job-id or --job-dir');
  }

  const stateDir = path.join(jobDir, 'state');
  const manifestPath = path.join(stateDir, 'job.json');
  const requestPath = path.join(stateDir, 'request.json');
  const manifest = readJson(manifestPath, {});
  const request = readJson(requestPath, {});
  const jobId = pickString(jobIdArg, manifest.jobId, request.jobId, path.basename(jobDir));
  const downloadsDir = pickString(args['downloads-dir'], manifest.downloadsDir) || path.join(jobDir, 'downloads');
  const exportsDir = pickString(args['exports-dir'], manifest.exportsDir) || path.join(jobDir, 'exports');
  const profile = pickString(args.profile, manifest.profile, request.profile, DEFAULT_PROFILE);

  ensureDir(jobDir);
  ensureDir(stateDir);
  ensureDir(downloadsDir);
  ensureDir(exportsDir);

  const files = {
    manifestPath,
    requestPath,
    waitStatusPath: path.join(stateDir, 'wait-status.json'),
    waitHistoryPath: path.join(stateDir, 'wait-history.jsonl'),
    downloadStatusPath: path.join(stateDir, 'download-status.json'),
    resultStatePath: path.join(stateDir, 'result.json'),
    statusStatePath: path.join(stateDir, 'status.json'),
    submitStatePath: path.join(stateDir, 'submit.json'),
    extendStatePath: path.join(stateDir, 'extend.json'),
    redoStatePath: path.join(stateDir, 'redo.json'),
    lineagePath: path.join(stateDir, 'lineage.json'),
    referenceStatePath: path.join(stateDir, 'reference-upload.json'),
    runtimeStatePath: path.join(stateDir, 'runtime-state.json'),
    loginStatePath: path.join(stateDir, 'login-state.json'),
    runHandoffPath: path.join(stateDir, 'run-handoff.json'),
    submitHandoffPath: path.join(stateDir, 'submit-handoff.json'),
    checkpointsPath: path.join(stateDir, 'checkpoints.json'),
    blockReasonPath: path.join(stateDir, 'block-reason.json'),
    resultUrlPath: path.join(stateDir, 'result-url.txt'),
    eventsPath: path.join(stateDir, 'events.jsonl'),
    downloadTracePath: path.join(stateDir, 'download-events.jsonl'),
    extendHistoryPath: path.join(stateDir, 'extend-history.jsonl'),
    extendHandoffPath: path.join(stateDir, 'extend-handoff.json'),
    redoHistoryPath: path.join(stateDir, 'redo-history.jsonl'),
    generatedVideoUrlsPath: GENERATED_VIDEO_URLS_PATH,
  };

  return {
    workspaceRoot: WORKSPACE_ROOT,
    skillRoot: SKILL_ROOT,
    jobDir,
    jobId,
    profile,
    stateDir,
    downloadsDir,
    exportsDir,
    manifest,
    request,
    files,
  };
}

function collectStateCandidates(job) {
  const jsonFiles = [
    job.files.waitStatusPath,
    job.files.downloadStatusPath,
    job.files.resultStatePath,
    job.files.statusStatePath,
    job.files.submitStatePath,
    job.files.extendStatePath,
    job.files.redoStatePath,
    job.files.lineagePath,
    job.files.referenceStatePath,
    job.files.runtimeStatePath,
    job.files.loginStatePath,
    job.files.checkpointsPath,
    job.files.blockReasonPath,
    job.files.requestPath,
    job.files.manifestPath,
  ];
  const textFiles = [job.files.resultUrlPath];
  return [
    ...jsonFiles
      .filter((filePath) => fileExists(filePath))
      .map((filePath) => ({ filePath, data: readJson(filePath, {}) })),
    ...textFiles
      .filter((filePath) => fileExists(filePath))
      .map((filePath) => ({ filePath, data: fs.readFileSync(filePath, 'utf8').trim() })),
  ];
}

function resolveResultUrl(job, explicitUrl = '') {
  const direct = maybeResultUrl(explicitUrl);
  if (direct) {return direct;}

  const candidates = collectStateCandidates(job);
  for (const { data } of candidates) {
    const resultUrl = searchResultUrl(data);
    if (resultUrl) {return resultUrl;}
  }
  return '';
}

function normalizeActionType(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw || raw === 'generate_video' || raw === 'submit') {return 'generate';}
  if (raw === 'redo' || raw === 'redo-video') {return 'redo_video';}
  if (raw === 'extend' || raw === 'extend-video') {return 'extend_video';}
  return raw;
}

function resolveActionType(job, explicitAction = '') {
  return normalizeActionType(
    explicitAction
    || job?.manifest?.actionType
    || job?.manifest?.action
    || job?.request?.actionType
    || job?.request?.action
    || 'generate'
  );
}

function pickLineageValue(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {return value.trim();}
  }
  return '';
}

function resolveLineagePatch(job, patch = {}) {
  const existing = readJson(job.files.lineagePath, {}) || {};
  const current = existing.current || {};
  const actionType = resolveActionType(job, patch.actionType || current.actionType || existing.actionType);
  const lineageCompatible = !current.actionType || resolveActionType(job, current.actionType) === actionType;
  const inheritedCurrent = lineageCompatible ? current : {};
  const inheritedExisting = lineageCompatible ? existing : {};
  const sourceResultUrl = maybeResultUrl(pickLineageValue(
    patch.sourceResultUrl,
    inheritedCurrent.sourceResultUrl,
    inheritedExisting.sourceResultUrl,
    job?.manifest?.sourceResultUrl,
    job?.request?.sourceResultUrl,
    job?.manifest?.extend?.sourceResultUrl,
    job?.request?.extend?.sourceResultUrl,
    actionType === 'extend_video' ? job?.manifest?.resultUrl : '',
    actionType === 'redo_video' ? job?.manifest?.resultUrl : ''
  ));
  const newResultUrl = maybeResultUrl(pickLineageValue(
    patch.newResultUrl,
    patch.resultUrl,
    inheritedCurrent.newResultUrl,
    inheritedExisting.newResultUrl,
    actionType === 'generate' ? job?.manifest?.resultUrl : '',
    actionType === 'generate' ? job?.request?.resultUrl : ''
  ));
  const sourcePostId = pickLineageValue(
    patch.sourcePostId,
    inheritedCurrent.sourcePostId,
    inheritedExisting.sourcePostId,
    extractPostIdFromUrl(sourceResultUrl)
  );
  const newPostId = pickLineageValue(
    patch.newPostId,
    inheritedCurrent.newPostId,
    inheritedExisting.newPostId,
    extractPostIdFromUrl(newResultUrl)
  );
  const extendDuration = pickLineageValue(
    patch.extendDuration,
    inheritedCurrent.extendDuration,
    inheritedExisting.extendDuration,
    actionType === 'extend_video' ? job?.manifest?.extend?.extendDuration : '',
    actionType === 'extend_video' ? job?.request?.extendDuration : ''
  );
  const timelineMode = pickLineageValue(
    patch.timelineMode,
    inheritedCurrent.timelineMode,
    inheritedExisting.timelineMode,
    actionType === 'extend_video' ? job?.manifest?.extend?.timelineMode : '',
    actionType === 'extend_video' ? job?.request?.timelineMode : ''
  );
  const checkedAt = pickLineageValue(patch.checkedAt) || nowIso();
  return {
    actionType,
    jobId: job.jobId,
    jobDir: job.jobDir,
    profile: patch.profile || job.profile,
    sourcePostId,
    sourceResultUrl,
    newPostId,
    newResultUrl,
    extendDuration,
    timelineMode,
    status: patch.status || current.status || existing.status || '',
    note: patch.note || current.note || existing.note || '',
    checkedAt,
    lastObservedUrl: patch.lastObservedUrl || current.lastObservedUrl || existing.lastObservedUrl || newResultUrl || sourceResultUrl || '',
  };
}

function recordLineage(job, patch = {}) {
  const existing = readJson(job.files.lineagePath, { version: 1, actionType: '', current: null, history: [] }) || { version: 1, actionType: '', current: null, history: [] };
  const entry = resolveLineagePatch(job, patch);
  const history = Array.isArray(existing.history) ? existing.history.slice() : [];
  const historyKey = JSON.stringify({
    actionType: entry.actionType,
    sourceResultUrl: entry.sourceResultUrl,
    newResultUrl: entry.newResultUrl,
    extendDuration: entry.extendDuration,
    timelineMode: entry.timelineMode,
    status: entry.status,
    note: entry.note,
  });
  const last = history.length ? history[history.length - 1] : null;
  const lastKey = last ? JSON.stringify({
    actionType: last.actionType,
    sourceResultUrl: last.sourceResultUrl,
    newResultUrl: last.newResultUrl,
    extendDuration: last.extendDuration,
    timelineMode: last.timelineMode,
    status: last.status,
    note: last.note,
  }) : '';
  if (historyKey !== lastKey) {
    history.push(entry);
  }
  const payload = {
    version: 1,
    updatedAt: nowIso(),
    actionType: entry.actionType,
    jobId: job.jobId,
    jobDir: job.jobDir,
    profile: entry.profile || job.profile,
    sourcePostId: entry.sourcePostId,
    sourceResultUrl: entry.sourceResultUrl,
    newPostId: entry.newPostId,
    newResultUrl: entry.newResultUrl,
    extendDuration: entry.extendDuration,
    timelineMode: entry.timelineMode,
    status: entry.status,
    note: entry.note,
    current: entry,
    history,
  };
  writeJson(job.files.lineagePath, payload);
  return payload;
}

function appendGeneratedVideoUrl(job, entry = {}) {
  const payload = {
    ts: entry.ts || nowIso(),
    actionType: resolveActionType(job, entry.actionType),
    status: entry.status || 'submitted',
    url: maybeResultUrl(entry.url || entry.resultUrl || entry.newResultUrl || ''),
    postId: pickLineageValue(entry.postId, extractPostIdFromUrl(entry.url || entry.resultUrl || entry.newResultUrl || '')),
    sourcePostId: pickLineageValue(entry.sourcePostId, extractPostIdFromUrl(entry.sourceResultUrl || '')),
    sourceResultUrl: maybeResultUrl(entry.sourceResultUrl || ''),
    jobId: entry.jobId || job.jobId,
    profile: entry.profile || job.profile,
    note: entry.note || '',
  };
  if (!payload.url) {return { written: false, entry: payload, reason: 'missing_url' };}

  let existing = [];
  if (fileExists(job.files.generatedVideoUrlsPath)) {
    existing = fs.readFileSync(job.files.generatedVideoUrlsPath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  const duplicate = existing.some((item) => String(item.url || '').trim() === payload.url
    && resolveActionType(job, item.actionType) === payload.actionType
    && String(item.jobId || '').trim() === payload.jobId);
  if (duplicate) {return { written: false, entry: payload, reason: 'duplicate' };}

  appendJsonl(job.files.generatedVideoUrlsPath, payload);
  return { written: true, entry: payload };
}


function loadJobStateTools() {
  return require('./grok_job_state');
}

function updateWorkflowStatus(job, patch) {
  const { updateStatus } = loadJobStateTools();
  return updateStatus(job.stateDir, patch);
}

function appendWorkflowCheckpoint(job, entry) {
  const { appendCheckpoint } = loadJobStateTools();
  return appendCheckpoint(job.stateDir, entry);
}

function writeWorkflowResultUrl(job, url) {
  const { writeResultUrl } = loadJobStateTools();
  return writeResultUrl(job.stateDir, url);
}

function setWorkflowBlockReason(job, reason) {
  const { setBlockReason } = loadJobStateTools();
  return setBlockReason(job.stateDir, reason);
}

function clearWorkflowBlockReason(job) {
  const { clearBlockReason } = loadJobStateTools();
  return clearBlockReason(job.stateDir);
}

function updateManifest(job, patch) {
  const next = {
    ...job.manifest,
    ...patch,
  };
  writeJson(job.files.manifestPath, next);
  job.manifest = next;
  return next;
}

function createLogger(job, options = {}) {
  return createJobLogger({
    script: options.script || '',
    stateDir: job.stateDir,
    jobDir: job.jobDir,
    jobId: job.jobId,
    profile: job.profile,
    eventsPath: job.files.eventsPath,
    minLevel: options.minLevel || 'info',
    console: options.console,
  });
}

async function loadPlaywright() {
  const candidates = [
    path.join(WORKSPACE_ROOT, 'skills', 'jimeng-seedance-web', 'runtime', 'upstream', 'seedance2.0', 'server', 'node_modules', 'playwright-core', 'index.mjs'),
    path.join(WORKSPACE_ROOT, 'tmp', 'WeChat-Channels-Video-File-Decryption', 'api-service', 'node_modules', 'playwright-core', 'index.mjs'),
    path.join(WORKSPACE_ROOT, 'tmp', 'graph-memory-v2-review', 'extracted', 'graph-memory-2.0.0', 'node_modules', 'playwright-core', 'index.mjs'),
  ];

  for (const candidate of candidates) {
    if (!fileExists(candidate)) {continue;}
    const mod = await import(pathToFileURL(candidate).href);
    if (mod && mod.chromium) {
      return { chromium: mod.chromium, modulePath: candidate };
    }
  }
  throw new Error('playwright-core not found in known local paths');
}

async function launchPersistentContext({ profile = DEFAULT_PROFILE, downloadsDir, headless = true, timeoutMs = 15000 }) {
  const { chromium, modulePath } = await loadPlaywright();
  const profileDir = path.join(PROFILE_ROOT, sanitizeFileName(profile));
  ensureDir(profileDir);
  ensureDir(downloadsDir);

  const context = await chromium.launchPersistentContext(profileDir, {
    headless,
    acceptDownloads: true,
    viewport: { width: 1440, height: 960 },
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    downloadsPath: downloadsDir,
  });
  const page = context.pages()[0] || await context.newPage();
  page.setDefaultTimeout(timeoutMs);
  return { context, page, profileDir, playwrightModulePath: modulePath };
}

async function confirmLoggedInAtSafeEntry({ page, job = null, logger = null, action = 'account_gate' }) {
  const loginProbe = await resolveLoginState(page, {
    skipSafeEntryOpen: false,
    allowImagineFallback: true,
  });
  const safeEntryUrl = loginProbe.safeEntryUrl;
  const pageSignals = loginProbe.pageSignals;
  const login = loginProbe.login;
  const gate = {
    ok: login.state === 'logged_in',
    action,
    checkedAt: nowIso(),
    safeEntryUrl,
    currentUrl: pageSignals.url,
    state: login.state,
    source: loginProbe.source,
    signals: login.signals,
    safeEntry: {
      url: loginProbe.safeEntry?.url || safeEntryUrl,
      loginState: loginProbe.safeEntry?.login?.state || '',
      signals: loginProbe.safeEntry?.login?.signals || {},
    },
    imagineProbe: loginProbe.imagineProbe
      ? {
          url: loginProbe.imagineProbe.url,
          loginState: loginProbe.imagineProbe.login?.state || '',
          signals: loginProbe.imagineProbe.login?.signals || {},
        }
      : null,
    page: {
      url: pageSignals.url,
      title: pageSignals.title,
      bodyText: pageSignals.bodyTextShort,
      buttonTexts: pageSignals.buttonTexts || [],
      linkTexts: pageSignals.linkTexts || [],
      inputPlaceholders: pageSignals.inputPlaceholders || [],
      localStorageKeys: pageSignals.localStorageKeys || [],
    },
    status: login.state === 'not_logged_in' ? 'blocked_login_required' : login.state === 'logged_in' ? 'ready' : 'blocked_human_verification',
    blockerReasonCode: login.state === 'not_logged_in' ? 'login_required' : login.state === 'logged_in' ? '' : 'login_state_uncertain',
  };

  if (job?.files?.loginStatePath) {
    writeJson(job.files.loginStatePath, {
      checkedAt: gate.checkedAt,
      loginState: gate.state,
      source: gate.source,
      signals: gate.signals,
      safeEntryUrl: gate.safeEntryUrl,
      safeEntry: gate.safeEntry,
      imagineProbe: gate.imagineProbe,
      page: gate.page,
      action,
    });
  }

  if (logger) {
    logger[gate.ok ? 'info' : 'warn'](`${action}.login_gate_checked`, {
      phase: `${action}_login_gate`,
      currentUrl: gate.currentUrl,
      safeEntryUrl: gate.safeEntryUrl,
      loginState: gate.state,
      matchedSignals: gate.signals,
    });
  }

  return gate;
}

function extractPostIdFromUrl(url) {
  if (!url) {return '';}
  const cleanUrl = maybeResultUrl(String(url)) || String(url).trim().replace(/[\\]+$/g, '');
  const match = cleanUrl.match(/\/imagine\/post\/([^/?#]+)/i);
  return match ? match[1] : '';
}

function normalizeComparableResultUrl(url) {
  const clean = maybeResultUrl(String(url || '')) || String(url || '').trim().replace(/[\\]+$/g, '');
  if (!clean) {return '';}
  try {
    const parsed = new URL(clean);
    parsed.hash = '';
    return parsed.toString().replace(/[\\]+$/g, '');
  } catch {
    return clean;
  }
}

function resolveResultUrlConsistencyMode(job = null, explicitMode = '') {
  const raw = pickString(
    explicitMode,
    process.env.GROK_RESULT_URL_MISMATCH_MODE,
    job?.request?.resultUrlConsistencyMode,
    job?.manifest?.resultUrlConsistencyMode,
    'warn',
  );
  const normalized = String(raw || '').trim().toLowerCase();
  if (['ignore', 'off', 'disabled'].includes(normalized)) {return 'ignore';}
  if (['block', 'strict', 'fail'].includes(normalized)) {return 'block';}
  return 'warn';
}

function assessResultUrlConsistency({ expectedResultUrl = '', observedUrl = '', observedPostId = '', job = null, mode = '' } = {}) {
  const expectedUrl = normalizeComparableResultUrl(expectedResultUrl);
  const observedComparableUrl = normalizeComparableResultUrl(observedUrl);
  const expectedPostId = extractPostIdFromUrl(expectedUrl);
  const finalObservedPostId = pickString(observedPostId, extractPostIdFromUrl(observedComparableUrl));
  const policy = resolveResultUrlConsistencyMode(job, mode);
  const urlMatched = Boolean(expectedUrl) && Boolean(observedComparableUrl) && expectedUrl === observedComparableUrl;
  const postIdMatched = Boolean(expectedPostId) && Boolean(finalObservedPostId) && expectedPostId === finalObservedPostId;

  let mismatchReason = '';
  if (expectedPostId && finalObservedPostId && expectedPostId !== finalObservedPostId) {
    mismatchReason = 'post_id_mismatch';
  } else if (expectedPostId && !finalObservedPostId && observedComparableUrl) {
    mismatchReason = 'expected_post_missing_on_observed_url';
  } else if (expectedUrl && observedComparableUrl && !urlMatched && !postIdMatched) {
    mismatchReason = 'result_url_mismatch';
  }

  const matched = !mismatchReason;
  return {
    mode: policy,
    matched,
    mismatch: !matched,
    mismatchReason,
    severity: matched ? 'info' : policy === 'block' ? 'error' : policy === 'ignore' ? 'info' : 'warning',
    action: matched ? 'none' : policy === 'block' ? 'block' : policy === 'ignore' ? 'record_only' : 'warn_continue',
    status: matched ? 'matched' : policy === 'block' ? 'blocked' : policy === 'ignore' ? 'ignored_mismatch' : 'warning_mismatch',
    expectedResultUrl: expectedUrl || expectedResultUrl || '',
    expectedPostId,
    observedUrl: observedComparableUrl || observedUrl || '',
    observedPostId: finalObservedPostId || '',
    urlMatched,
    postIdMatched,
  };
}

async function readBodyText(page) {
  if (page && typeof page.waitForLoadState === 'function' && typeof page.locator === 'function') {
    return page.locator('body').innerText().catch(() => '');
  }
  return page.evaluate(() => document.body?.innerText || '').catch(() => '');
}

async function collectVisibleActionSignals(page) {
  return page.evaluate(() => {
    const visible = (node) => {
      if (!(node instanceof Element)) {return false;}
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style && style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };
    const norm = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const nodes = Array.from(document.querySelectorAll('button, a, [role="button"], [role="menuitem"], [role="tab"], [role="radio"]'));
    const labels = nodes
      .filter(visible)
      .map((node) => norm(node.getAttribute('aria-label') || node.getAttribute('title') || node.innerText || node.textContent || node.value || ''))
      .filter(Boolean)
      .slice(0, 200);
    const hasAny = (patterns) => labels.some((label) => patterns.some((pattern) => pattern.test(label)));
    return {
      labels,
      hasDownload: hasAny([/(^|\s)下载(\s|$)/, /(^|\s)download(\s|$)/i]),
      hasShare: hasAny([/创建共享链接/, /create share link/i]),
      hasFollowupGenerate: hasAny([/生成视频/, /generate video/i]),
    };
  }).catch(() => ({ labels: [], hasDownload: false, hasShare: false, hasFollowupGenerate: false }));
}

async function detectCompletion(page) {
  const url = page.url();
  const bodyText = await readBodyText(page);
  const completionSignals = [];
  const blockerSignals = [];
  const progressSignals = [];

  const videoState = await page.evaluate(() => {
    const videos = Array.from(document.querySelectorAll('video')).map((video) => ({
      currentSrc: String(video.currentSrc || video.src || '').trim(),
      readyState: Number(video.readyState || 0),
      networkState: Number(video.networkState || 0),
      paused: Boolean(video.paused),
      ended: Boolean(video.ended),
      errorCode: video.error ? Number(video.error.code || 0) : 0,
      videoWidth: Number(video.videoWidth || 0),
      videoHeight: Number(video.videoHeight || 0),
      duration: Number.isFinite(video.duration) ? Number(video.duration || 0) : 0,
      seekableRanges: Number(video.seekable?.length || 0),
      bufferedRanges: Number(video.buffered?.length || 0),
    }));
    const playable = videos.some((video) => (
      video.readyState >= 2
      && video.errorCode === 0
      && video.networkState !== 3
      && Boolean(video.currentSrc)
      && (video.videoWidth > 0 || video.videoHeight > 0)
      && (video.duration > 0 || video.seekableRanges > 0 || video.bufferedRanges > 0)
    ));
    const hasErrored = videos.some((video) => video.errorCode > 0 || video.networkState === 3);
    return {
      count: videos.length,
      playable,
      hasErrored,
      videos: videos.slice(0, 4),
    };
  }).catch(() => ({ count: 0, playable: false, hasErrored: false, videos: [] }));

  const actionSignals = await collectVisibleActionSignals(page);
  const hasDownload = Boolean(actionSignals.hasDownload);
  const hasShare = Boolean(actionSignals.hasShare);
  const hasFollowupGenerate = Boolean(actionSignals.hasFollowupGenerate);

  const hasVideo = videoState.count > 0;
  const playableVideo = Boolean(videoState.playable);

  const onResultPage = /\/imagine\/post\/[^/?#]+/i.test(url);
  if (onResultPage) {completionSignals.push('/imagine/post/<id>');}
  if (hasDownload) {completionSignals.push('下载');}
  if (hasShare) {completionSignals.push('创建共享链接');}
  if (hasFollowupGenerate) {completionSignals.push('生成视频');}
  if (playableVideo && onResultPage) {completionSignals.push('video-ready');}
  else if (hasVideo && onResultPage) {progressSignals.push('video-element-present');}

  if (/登录|注册|sign in|log in/i.test(bodyText) && !completionSignals.length) {
    blockerSignals.push('possible-login-wall');
  }
  if (!onResultPage && /\/imagine(?:$|[?#])/i.test(url) && /登录|注册|sign in|log in/i.test(bodyText)) {
    blockerSignals.push('redirected-away-from-result');
  }
  if (/套餐|订阅|升级|limit|quota|subscribe|subscription/i.test(bodyText) && !completionSignals.length) {
    blockerSignals.push('possible-quota-or-paywall');
  }
  if (hasVideo && onResultPage && videoState.hasErrored) {
    blockerSignals.push('video-element-error');
  }

  if (/排队|队列|生成中|处理中|rendering|creating|queued|processing/i.test(bodyText)) {
    progressSignals.push('progress-text');
  }

  let status = 'generating';
  if (completionSignals.includes('下载') || completionSignals.includes('创建共享链接')) {
    status = 'completed';
  } else if (playableVideo && onResultPage) {
    status = 'completed';
  } else if (blockerSignals.length) {
    status = 'blocked';
  } else if (progressSignals.length) {
    status = 'generating';
  }

  return {
    checkedAt: nowIso(),
    url,
    postId: extractPostIdFromUrl(url),
    status,
    completionSignals,
    blockerSignals,
    progressSignals,
    videoState,
    bodyExcerpt: bodyText.slice(0, 2000),
  };
}

async function settleAfterNavigation(page, timeoutMs = 60000) {
  if (page && typeof page.waitForLoadState === 'function') {
    await page.waitForLoadState('networkidle').catch(() => {});
    return;
  }
  if (page && typeof page.waitForNetworkIdle === 'function') {
    await page.waitForNetworkIdle({ idleTime: 800, timeout: Math.min(timeoutMs, 10000) }).catch(() => {});
    return;
  }
  await sleep(1200);
}

async function gotoResultPage(page, resultUrl) {
  if (!resultUrl) {throw new Error('missing result URL');}
  await page.goto(resultUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await settleAfterNavigation(page, 60000);
}

async function waitForCompletion({ page, job, resultUrl, timeoutMs = 15 * 60 * 1000, intervalMs = 8000, refresh = true, logger = null, resultUrlConsistencyMode = '' }) {
  const startedAt = Date.now();
  const expectedPostId = extractPostIdFromUrl(resultUrl);
  const consistencyMode = resolveResultUrlConsistencyMode(job, resultUrlConsistencyMode);
  let previousUrl = page.url ? page.url() : '';
  let previousConsistencyKey = '';
  await gotoResultPage(page, resultUrl);
  const openedUrl = page.url ? page.url() : resultUrl;
  if (logger) {
    logger.info('wait.page_opened', { resultUrl, currentUrl: openedUrl, refresh, timeoutMs, intervalMs, resultUrlConsistencyMode: consistencyMode });
  }
  previousUrl = openedUrl;

  let last = null;
  let lastStatus = '';
  while (Date.now() - startedAt <= timeoutMs) {
    last = await detectCompletion(page);
    const currentPostId = extractPostIdFromUrl(last.url || '');
    const bodyLower = String(last.bodyExcerpt || '').toLowerCase();
    const redirectedToImagineRoot = expectedPostId
      && !currentPostId
      && /\/imagine(?:$|[?#])/i.test(last.url || '')
      && !/\/imagine\/post\//i.test(last.url || '');
    const looksLikeAuthOrLoggedOut = /(sign in|log in|sign up|登录|注册)/i.test(last.bodyExcerpt || '');
    const looksLikeTemplateLanding = /(featured templates|discover)/i.test(bodyLower);
    const retryableRedirectToImagineRoot = redirectedToImagineRoot && !looksLikeAuthOrLoggedOut;
    if (redirectedToImagineRoot && (looksLikeAuthOrLoggedOut || looksLikeTemplateLanding)) {
      last = {
        ...last,
        status: looksLikeAuthOrLoggedOut ? 'blocked' : 'generating',
        blockerSignals: looksLikeAuthOrLoggedOut
          ? Array.from(new Set([
              ...(last.blockerSignals || []),
              'redirected-away-from-result',
              'possible-login-wall',
            ]))
          : (last.blockerSignals || []).filter((signal) => signal !== 'redirected-away-from-result' && signal !== 'result-page-not-opened'),
        progressSignals: looksLikeAuthOrLoggedOut
          ? (last.progressSignals || [])
          : Array.from(new Set([
              ...(last.progressSignals || []),
              'result-page-not-opened',
              'redirected-away-from-result',
            ])),
        completionSignals: (last.completionSignals || []).filter((signal) => signal !== 'video-element' && signal !== 'video-ready'),
      };
    } else if (retryableRedirectToImagineRoot) {
      last = {
        ...last,
        status: 'generating',
        blockerSignals: (last.blockerSignals || []).filter((signal) => signal !== 'redirected-away-from-result' && signal !== 'result-page-not-opened'),
        progressSignals: Array.from(new Set([
          ...(last.progressSignals || []),
          'result-page-not-opened',
          'redirected-away-from-result',
        ])),
        completionSignals: (last.completionSignals || []).filter((signal) => signal !== 'video-element' && signal !== 'video-ready'),
      };
    }
    const resultUrlConsistency = assessResultUrlConsistency({
      expectedResultUrl: resultUrl,
      observedUrl: last.url || '',
      observedPostId: currentPostId,
      job,
      mode: consistencyMode,
    });
    if (retryableRedirectToImagineRoot && resultUrlConsistency.mismatch && resultUrlConsistency.action === 'block') {
      resultUrlConsistency.action = 'warn_continue';
      resultUrlConsistency.severity = 'warning';
      resultUrlConsistency.status = 'warning_mismatch';
    }
    if (resultUrlConsistency.mismatch && resultUrlConsistency.action === 'block') {
      last = {
        ...last,
        status: 'blocked',
        blockerSignals: Array.from(new Set([
          ...(last.blockerSignals || []),
          'result-url-mismatch',
          resultUrlConsistency.mismatchReason || 'result-url-mismatch',
        ])),
      };
    }
    const record = {
      ...last,
      resultUrl,
      expectedPostId,
      observedPostId: resultUrlConsistency.observedPostId || currentPostId || '',
      observedUrl: resultUrlConsistency.observedUrl || last.url || '',
      resultUrlConsistency,
      elapsedMs: Date.now() - startedAt,
    };
    writeJson(job.files.waitStatusPath, record);
    appendJsonl(job.files.waitHistoryPath, record);
    updateManifest(job, {
      lastWaitCheckedAt: record.checkedAt,
      resultUrl,
      lastKnownStatus: record.status,
      completionSignals: record.completionSignals,
      postId: record.postId || job.manifest.postId || '',
    });

    if (logger) {
      if (record.url && record.url !== previousUrl) {
        logger.info('wait.url_changed', { fromUrl: previousUrl, currentUrl: record.url, resultUrl });
        previousUrl = record.url;
      }
      if (record.resultUrlConsistency && record.resultUrlConsistency.mismatch) {
        const consistencyKey = `${record.resultUrlConsistency.mismatchReason}:${record.resultUrlConsistency.expectedPostId}:${record.resultUrlConsistency.observedPostId}:${record.resultUrlConsistency.observedUrl}`;
        if (consistencyKey !== previousConsistencyKey) {
          logger[record.resultUrlConsistency.action === 'block' ? 'warn' : 'info']('wait.result_url_mismatch', {
            status: record.status,
            currentUrl: record.url,
            resultUrl,
            expectedPostId: record.resultUrlConsistency.expectedPostId,
            observedPostId: record.resultUrlConsistency.observedPostId,
            observedUrl: record.resultUrlConsistency.observedUrl,
            mismatchReason: record.resultUrlConsistency.mismatchReason,
            mismatchMode: record.resultUrlConsistency.mode,
            action: record.resultUrlConsistency.action,
            elapsedMs: record.elapsedMs,
          });
          previousConsistencyKey = consistencyKey;
        }
      }
      if (record.status !== lastStatus) {
        logger.info('wait.status_transition', {
          status: record.status,
          previousStatus: lastStatus || 'init',
          currentUrl: record.url,
          resultUrl,
          completionSignals: record.completionSignals,
          blockerSignals: record.blockerSignals,
          progressSignals: record.progressSignals,
          elapsedMs: record.elapsedMs,
        });
        lastStatus = record.status;
      } else if (record.progressSignals && record.progressSignals.length) {
        logger.debug('wait.progress_probe', {
          status: record.status,
          currentUrl: record.url,
          resultUrl,
          progressSignals: record.progressSignals,
          elapsedMs: record.elapsedMs,
        });
      }
    }

    if (record.status === 'completed' || record.status === 'blocked') {
      return record;
    }

    await sleep(intervalMs);
    if (refresh) {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(async () => {
        await gotoResultPage(page, resultUrl);
      });
      await settleAfterNavigation(page, 60000);
    }
  }

  const timeoutRecord = {
    ...last,
    checkedAt: nowIso(),
    resultUrl,
    expectedPostId,
    observedPostId: last?.resultUrlConsistency?.observedPostId || last?.postId || '',
    observedUrl: last?.resultUrlConsistency?.observedUrl || last?.url || previousUrl,
    resultUrlConsistency: last?.resultUrlConsistency || assessResultUrlConsistency({
      expectedResultUrl: resultUrl,
      observedUrl: last?.url || previousUrl,
      observedPostId: last?.postId || '',
      job,
      mode: consistencyMode,
    }),
    elapsedMs: Date.now() - startedAt,
    status: last?.status || 'timeout',
    timeout: true,
  };
  writeJson(job.files.waitStatusPath, timeoutRecord);
  appendJsonl(job.files.waitHistoryPath, timeoutRecord);
  updateManifest(job, {
    lastWaitCheckedAt: timeoutRecord.checkedAt,
    resultUrl,
    lastKnownStatus: timeoutRecord.status,
    completionSignals: timeoutRecord.completionSignals || [],
    postId: timeoutRecord.postId || job.manifest.postId || '',
  });
  if (logger) {
    logger.warn('wait.timeout', {
      status: timeoutRecord.status,
      currentUrl: timeoutRecord.url || previousUrl,
      resultUrl,
      completionSignals: timeoutRecord.completionSignals || [],
      blockerSignals: timeoutRecord.blockerSignals || [],
      progressSignals: timeoutRecord.progressSignals || [],
      elapsedMs: timeoutRecord.elapsedMs,
    });
  }
  return timeoutRecord;
}


function roundNumber(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) {return null;}
  const factor = 10 ** digits;
  return Math.round(n * factor) / factor;
}

function clipNumber(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) {return null;}
  return Math.min(max, Math.max(min, n));
}

const KNOWN_TIMELINE_SCOPE_XPATHS = [
  '/html/body/div[2]/div/div[2]/div/div/div/div[1]/div/main/article/div[2]/div[2]',
  '/html/body/div[2]/div/div[2]/div/div/div/div[1]/div/main/article/div[2]',
  '/html/body/div[2]/div/div[2]/div/div/div/div[1]/div/main/article/div[1]/div[2]',
];

const KNOWN_TIMELINE_DRAG_HANDLE_XPATHS = [
  '/html/body/div[2]/div/div[2]/div/div/div/div[1]/div/main/article/div[2]/div[2]/div/svg',
  '/html/body/div[2]/div/div[2]/div/div/div/div[1]/div/main/article/div[2]/div[2]/div',
];

const KNOWN_TIMELINE_RANGE_LABEL_XPATHS = [
  '/html/body/div[2]/div/div[2]/div/div/div/div[1]/div/main/article/div[1]/div[2]/div[1]/div[5]/div[1]/button[2]',
];

function pickTimelineLabels(snapshot = {}, limit = 12) {
  const labels = [];
  const push = (value) => {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) {return;}
    labels.push(text.slice(0, 120));
  };
  for (const item of (snapshot.containers || [])) {
    push(item.ariaLabel);
    push(item.text);
    push(item.testId);
    push(item.className);
  }
  for (const item of (snapshot.trimSignals || [])) {
    push(item.ariaLabel);
    push(item.text);
    push(item.testId);
    push(item.className);
  }
  for (const item of (snapshot.handles || [])) {
    push(item.ariaLabel);
    push(item.text);
  }
  return Array.from(new Set(labels)).slice(0, limit);
}

function selectionFromSnapshot(snapshot = {}) {
  const selection = {
    detected: false,
    source: '',
    startPct: null,
    endPct: null,
    startPx: null,
    endPx: null,
    startSec: null,
    endSec: null,
    durationSec: null,
    values: [],
  };

  const regions = Array.isArray(snapshot.selectionRegions) ? snapshot.selectionRegions : [];
  const visibleRegion = regions.find((item) => Number.isFinite(item?.startPct) && Number.isFinite(item?.endPct));
  if (visibleRegion) {
    selection.detected = true;
    selection.source = visibleRegion.source || 'selection_region';
    selection.startPct = roundNumber(visibleRegion.startPct);
    selection.endPct = roundNumber(visibleRegion.endPct);
    selection.startPx = roundNumber(visibleRegion.startPx);
    selection.endPx = roundNumber(visibleRegion.endPx);
    selection.startSec = roundNumber(visibleRegion.startSec);
    selection.endSec = roundNumber(visibleRegion.endSec);
    selection.durationSec = roundNumber(visibleRegion.durationSec);
    return selection;
  }

  const handles = (snapshot.handles || [])
    .map((item) => ({
      pct: roundNumber(item?.positionPct),
      px: roundNumber(item?.positionPx),
      source: item?.source || 'handle',
    }))
    .filter((item) => Number.isFinite(item.pct));
  if (handles.length >= 2) {
    handles.sort((a, b) => a.pct - b.pct || a.px - b.px);
    selection.detected = true;
    selection.source = 'handles';
    selection.startPct = handles[0].pct;
    selection.endPct = handles[handles.length - 1].pct;
    selection.startPx = handles[0].px;
    selection.endPx = handles[handles.length - 1].px;
    selection.values = handles.map((item) => item.pct);
    return selection;
  }

  const rangeValues = (snapshot.rangeInputs || [])
    .map((item) => ({
      value: Number(item?.value),
      min: Number(item?.min),
      max: Number(item?.max),
    }))
    .filter((item) => Number.isFinite(item.value) && Number.isFinite(item.min) && Number.isFinite(item.max) && item.max > item.min)
    .map((item) => roundNumber(((item.value - item.min) / (item.max - item.min)) * 100));
  if (rangeValues.length >= 2) {
    rangeValues.sort((a, b) => a - b);
    selection.detected = true;
    selection.source = 'range_inputs';
    selection.startPct = rangeValues[0];
    selection.endPct = rangeValues[rangeValues.length - 1];
    selection.values = rangeValues;
  }
  return selection;
}

function inferTimelineBoundaryRole(item = {}, index = 0, total = 0) {
  const tokens = [item.ariaLabel, item.testId, item.className, item.text, item.kind, item.source]
    .map((value) => String(value || '').toLowerCase())
    .join(' ');
  if (/trim_start|start|left|in\b|起点|开始/.test(tokens)) {return 'start';}
  if (/trim_end|end|right|out\b|终点|结束/.test(tokens)) {return 'end';}
  if (total >= 2) {
    if (index === 0) {return 'start';}
    if (index === total - 1) {return 'end';}
  }
  return '';
}

function buildTimelineAutomationModel(snapshot = {}, dominantContainer = null, currentSelection = {}) {
  const container = dominantContainer && dominantContainer.rect && Number.isFinite(dominantContainer.rect.width) && dominantContainer.rect.width > 0
    ? {
        selector: dominantContainer.selector || dominantContainer.ocSelector || '',
        ariaLabel: dominantContainer.ariaLabel || '',
        testId: dominantContainer.testId || '',
        className: dominantContainer.className || '',
        rect: dominantContainer.rect,
      }
    : null;

  const handles = (snapshot.handles || [])
    .map((item) => ({
      selector: item.selector || item.ocSelector || '',
      ariaLabel: item.ariaLabel || '',
      testId: item.testId || '',
      className: item.className || '',
      source: item.source || '',
      kind: item.kind || '',
      positionPct: roundNumber(item.positionPct),
      positionPx: roundNumber(item.positionPx),
      rect: item.rect || null,
    }))
    .filter((item) => Number.isFinite(item.positionPct))
    .toSorted((a, b) => a.positionPct - b.positionPct || a.positionPx - b.positionPx)
    .map((item, index, arr) => ({
      ...item,
      role: inferTimelineBoundaryRole(item, index, arr.length),
    }));

  const trimControls = (snapshot.trimSignals || [])
    .map((item, index, arr) => ({
      selector: item.selector || item.ocSelector || '',
      ariaLabel: item.ariaLabel || '',
      testId: item.testId || '',
      className: item.className || '',
      source: item.source || item.kind || '',
      kind: item.kind || '',
      positionPct: roundNumber(item.positionPct),
      positionPx: roundNumber(item.positionPx),
      rect: item.rect || null,
      role: inferTimelineBoundaryRole(item, index, arr.length),
    }))
    .filter((item) => item.selector && (Number.isFinite(item.positionPct) || item.role));

  const rangeInputs = (snapshot.rangeInputs || [])
    .map((item) => {
      const value = Number(item.value);
      const min = Number(item.min);
      const max = Number(item.max);
      const normalizedValue = Number.isFinite(value) && Number.isFinite(min) && Number.isFinite(max) && max > min
        ? roundNumber(((value - min) / (max - min)) * 100)
        : null;
      return {
        selector: item.selector || item.ocSelector || '',
        ariaLabel: item.ariaLabel || '',
        testId: item.testId || '',
        className: item.className || '',
        value: Number.isFinite(value) ? value : null,
        min: Number.isFinite(min) ? min : null,
        max: Number.isFinite(max) ? max : null,
        step: Number(item.step),
        normalizedValue,
        rect: item.rect || null,
      };
    })
    .filter((item) => Number.isFinite(item.normalizedValue))
    .toSorted((a, b) => a.normalizedValue - b.normalizedValue)
    .map((item, index, arr) => ({
      ...item,
      role: inferTimelineBoundaryRole(item, index, arr.length),
    }));

  const startHandle = handles.find((item) => item.role === 'start') || handles[0] || null;
  const endHandle = handles.find((item) => item.role === 'end') || (handles.length >= 2 ? handles[handles.length - 1] : null);
  const startRange = rangeInputs.find((item) => item.role === 'start') || rangeInputs[0] || null;
  const endRange = rangeInputs.find((item) => item.role === 'end') || (rangeInputs.length >= 2 ? rangeInputs[rangeInputs.length - 1] : null);
  const trimStart = trimControls.find((item) => item.role === 'start') || null;
  const trimEnd = trimControls.find((item) => item.role === 'end') || null;
  const fixedWindowDurationPct = currentSelection && currentSelection.detected && Number.isFinite(currentSelection.startPct) && Number.isFinite(currentSelection.endPct)
    ? roundNumber(currentSelection.endPct - currentSelection.startPct)
    : null;

  const readyReasons = [];
  if (container) {readyReasons.push('timeline_container_locked');}
  if (currentSelection && currentSelection.detected) {readyReasons.push(`selection:${currentSelection.source || 'unknown'}`);}
  if (startHandle && endHandle) {readyReasons.push('handles:start_end');}
  if (startRange && endRange) {readyReasons.push('range_inputs:start_end');}
  if (trimEnd && Number.isFinite(fixedWindowDurationPct)) {readyReasons.push('single_end_trim_handle_fixed_window');}
  if (endHandle && Number.isFinite(fixedWindowDurationPct)) {readyReasons.push('single_end_handle_fixed_window');}

  return {
    container,
    selection: {
      detected: Boolean(currentSelection && currentSelection.detected),
      source: currentSelection && currentSelection.source ? currentSelection.source : '',
      startPct: currentSelection && Number.isFinite(currentSelection.startPct) ? currentSelection.startPct : null,
      endPct: currentSelection && Number.isFinite(currentSelection.endPct) ? currentSelection.endPct : null,
      startPx: currentSelection && Number.isFinite(currentSelection.startPx) ? currentSelection.startPx : null,
      endPx: currentSelection && Number.isFinite(currentSelection.endPx) ? currentSelection.endPx : null,
    },
    handles: {
      all: handles,
      start: startHandle,
      end: endHandle,
    },
    trimControls: {
      all: trimControls,
      start: trimStart,
      end: trimEnd,
    },
    rangeInputs: {
      all: rangeInputs,
      start: startRange,
      end: endRange,
    },
    fixedWindowDurationPct,
    adjustmentMode: (trimEnd && Number.isFinite(fixedWindowDurationPct)) || (endHandle && Number.isFinite(fixedWindowDurationPct))
      ? 'single_handle_fixed_window'
      : ((startHandle && endHandle) || (startRange && endRange) ? 'dual_boundary' : ''),
    canResolveTarget: Boolean(
      container
      && currentSelection
      && currentSelection.detected
      && (((startHandle && endHandle) || (startRange && endRange)) || ((trimEnd || endHandle) && Number.isFinite(fixedWindowDurationPct)))
    ),
    readyReasons,
  };
}

function classifyTimelineSnapshot(snapshot = {}) {
  const counts = {
    container: Array.isArray(snapshot.containers) ? snapshot.containers.length : 0,
    track: Array.isArray(snapshot.tracks) ? snapshot.tracks.length : 0,
    selection: Array.isArray(snapshot.selectionRegions) ? snapshot.selectionRegions.length : 0,
    handle: Array.isArray(snapshot.handles) ? snapshot.handles.length : 0,
    trim: Array.isArray(snapshot.trimSignals) ? snapshot.trimSignals.length : 0,
    slider: Array.isArray(snapshot.sliderSignals) ? snapshot.sliderSignals.length : 0,
    rangeInput: Array.isArray(snapshot.rangeInputs) ? snapshot.rangeInputs.length : 0,
    draggable: Number(snapshot.draggableCount) || 0,
  };

  const currentSelection = selectionFromSnapshot(snapshot);
  const dominantContainer = counts.container ? snapshot.containers[0] : null;
  const scopedRoot = snapshot.scopeRoot || null;
  const trimKinds = Array.from(new Set((snapshot.trimSignals || []).map((item) => item.kind).filter(Boolean)));
  const rangeKinds = Array.from(new Set([
    counts.rangeInput ? 'range_input' : '',
    counts.slider ? 'slider' : '',
  ].filter(Boolean)));
  const automationModel = buildTimelineAutomationModel(snapshot, dominantContainer, currentSelection);
  const signals = [];
  const unknowns = [];

  if (dominantContainer) {
    const name = dominantContainer.ariaLabel || dominantContainer.testId || dominantContainer.className || dominantContainer.tag || 'timeline';
    signals.push(`container:${String(name).slice(0, 80)}`);
  }
  if (counts.handle) {signals.push(`handles:${counts.handle}`);}
  if (counts.rangeInput) {signals.push(`range-inputs:${counts.rangeInput}`);}
  if (counts.slider) {signals.push(`sliders:${counts.slider}`);}
  if (counts.trim) {signals.push(`trim:${trimKinds.join(',') || counts.trim}`);}
  if (currentSelection.detected) {
    signals.push(`selection:${currentSelection.source}:${currentSelection.startPct}-${currentSelection.endPct}`);
  }

  let timelineMode = 'not_detected';
  if (currentSelection.detected || counts.handle > 0 || counts.slider > 0 || counts.rangeInput > 0) {
    timelineMode = 'manual_handoff';
  } else if (counts.container > 0 || counts.track > 0 || counts.trim > 0 || counts.selection > 0 || counts.draggable > 0) {
    timelineMode = 'timeline_detected';
  }

  if (timelineMode !== 'not_detected' && !dominantContainer) {unknowns.push('timeline_container_not_isolated');}
  if (counts.container > 1) {unknowns.push('multiple_timeline_candidates');}
  if ((counts.handle > 0 || counts.slider > 0 || counts.rangeInput > 0 || counts.selection > 0) && !currentSelection.detected) {
    unknowns.push('selection_start_end_unresolved');
  }
  if (!counts.trim) {unknowns.push('trim_signal_not_observed');}
  if (!counts.handle && !counts.slider && !counts.rangeInput) {unknowns.push('no_explicit_handles_or_range_inputs');}

  const boundaryReasons = [];
  let boundaryClass = 'no_timeline_ui';
  let boundarySummary = 'No timeline UI detected; no trim drag target is available for automation.';
  let manualHandoffRequired = false;
  let canAutoAdjust = Boolean(automationModel.canResolveTarget);

  if (timelineMode === 'manual_handoff') {
    boundaryClass = automationModel.canResolveTarget ? 'interactive_auto_adjust_ready' : 'interactive_manual_handoff';
    manualHandoffRequired = !automationModel.canResolveTarget;
    boundarySummary = automationModel.canResolveTarget
      ? 'Interactive trim/timeline controls were detected and the runner resolved container + boundary controls; real mouse drag can be attempted with post-drag validation.'
      : 'Interactive trim/timeline controls were detected, but drag targets remain manual-only in this runner.';
    if (counts.handle) {boundaryReasons.push('interactive_handles_detected');}
    if (counts.slider) {boundaryReasons.push('slider_controls_detected');}
    if (counts.rangeInput) {boundaryReasons.push('range_inputs_detected');}
    if (currentSelection.detected) {boundaryReasons.push('selection_window_detected');}
    boundaryReasons.push(automationModel.canResolveTarget ? 'safe_drag_target_committed' : 'safe_drag_target_not_committed');
  } else if (timelineMode === 'timeline_detected') {
    boundaryClass = 'probe_only_manual_handoff';
    manualHandoffRequired = true;
    boundarySummary = 'Timeline-like UI signals were detected, but the runner cannot safely resolve drag targets; stop at probe + handoff.';
    if (counts.container || counts.track) {boundaryReasons.push('timeline_container_detected');}
    if (counts.trim) {boundaryReasons.push('trim_signal_detected');}
    if (counts.selection) {boundaryReasons.push('selection_signal_detected');}
    boundaryReasons.push('safe_drag_target_unresolved');
  } else {
    boundaryReasons.push('timeline_not_detected');
  }
  if (counts.container > 1) {boundaryReasons.push('multiple_timeline_candidates');}
  if (unknowns.includes('selection_start_end_unresolved')) {boundaryReasons.push('selection_start_end_unresolved');}

  return {
    detected: timelineMode !== 'not_detected',
    timelineMode,
    counts,
    labels: pickTimelineLabels(snapshot),
    signals,
    unknowns,
    currentSelection,
    rangeKinds,
    trimKinds,
    dominantContainer,
    automationModel,
    boundary: {
      class: boundaryClass,
      summary: boundarySummary,
      canAutoAdjust,
      manualHandoffRequired,
      reasons: Array.from(new Set(boundaryReasons)),
      automationReadyReasons: automationModel.readyReasons,
    },
    scopeRoot: scopedRoot,
    containers: snapshot.containers || [],
    tracks: snapshot.tracks || [],
    handles: snapshot.handles || [],
    rangeInputs: snapshot.rangeInputs || [],
    trimSignals: snapshot.trimSignals || [],
    selectionRegions: snapshot.selectionRegions || [],
    raw: snapshot,
  };
}

async function probeTimeline(page) {
  const snapshot = await page.evaluate(({ knownTimelineScopeXpaths, knownTimelineDragHandleXpaths, knownTimelineRangeLabelXpaths }) => {
    const norm = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const isVisible = (node) => {
      if (!(node instanceof Element)) {return false;}
      const style = window.getComputedStyle(node);
      if (!style || style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || '1') === 0) {return false;}
      const rect = node.getBoundingClientRect();
      return rect.width > 2 && rect.height > 2;
    };
    const firstXPath = (xp) => document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
    const uniq = (items, keyFn) => {
      const seen = new Set();
      const out = [];
      for (const item of items) {
        const key = keyFn(item);
        if (seen.has(key)) {continue;}
        seen.add(key);
        out.push(item);
      }
      return out;
    };
    const timelineScopeCandidates = [
      ...knownTimelineScopeXpaths,
      '/html/body/div[2]/div/div[2]/div/div/div/div[1]/div/main/article/div[2]',
      '/html/body/div[2]/div/div[2]/div/div/div/div[1]/div/main/article/div[1]/div[2]',
      '/html/body/div[2]/div/div[2]/div/div/div/div[1]/div/main/article',
    ].map(firstXPath).filter((node) => node instanceof Element && isVisible(node));
    const scopeRoot = timelineScopeCandidates[0] || document.body;
    const queryAll = (selector) => Array.from(scopeRoot.querySelectorAll(selector));
    const rectData = (rect) => ({
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    });
    const containerScore = (node) => {
      const tokens = [node.getAttribute('aria-label'), node.getAttribute('data-testid'), node.className, node.textContent]
        .map(norm)
        .join(' ')
        .toLowerCase();
      let score = 0;
      if (/timeline|time line|时间轴/.test(tokens)) {score += 10;}
      if (/track|轨道|scrubber|seek/.test(tokens)) {score += 6;}
      if (/trim|裁剪|clip|range|selection|segment|window/.test(tokens)) {score += 4;}
      const rect = node.getBoundingClientRect();
      if (rect.width > 140) {score += 4;}
      if (rect.height >= 20 && rect.height <= 200) {score += 2;}
      return score;
    };
    const CRAWCLAW_TIMELINE_ATTRS = [
      'data-crawclaw-timeline-container',
      'data-crawclaw-timeline-track',
      'data-crawclaw-timeline-handle',
      'data-crawclaw-timeline-range',
      'data-crawclaw-timeline-selection',
      'data-crawclaw-timeline-trim',
    ];
    CRAWCLAW_TIMELINE_ATTRS.forEach((attr) => {
      scopeRoot.querySelectorAll(`[${attr}]`).forEach((node) => node.removeAttribute(attr));
    });
    const attachSelector = (node, attrName, index) => {
      if (!(node instanceof Element)) {return '';}
      node.setAttribute(attrName, String(index));
      return `[${attrName}="${index}"]`;
    };
    const serialize = (node, extra = {}) => {
      const rect = node.getBoundingClientRect();
      return {
        tag: String(node.tagName || '').toLowerCase(),
        role: norm(node.getAttribute('role')),
        text: norm(node.innerText || node.textContent || '').slice(0, 120),
        ariaLabel: norm(node.getAttribute('aria-label')),
        testId: norm(node.getAttribute('data-testid')),
        className: norm(node.className).slice(0, 160),
        rect: rectData(rect),
        ...extra,
      };
    };
    const parseTimelineRangeText = (text, totalSeconds, endPctHint = null) => {
      const normalized = norm(text);
      if (!normalized) {return null;}
      const mmssValues = Array.from(normalized.matchAll(/(\d+):(\d+(?:\.\d+)?)/g))
        .map((match) => (Number(match[1]) * 60) + Number(match[2]))
        .filter((value) => Number.isFinite(value));
      const secValues = Array.from(normalized.matchAll(/(\d+(?:\.\d+)?)\s*(?:秒|s)/gi))
        .map((match) => Number(match[1]))
        .filter((value) => Number.isFinite(value));
      const numbers = mmssValues.length >= 2
        ? mmssValues
        : (secValues.length >= 2
          ? secValues
          : Array.from(normalized.matchAll(/\d+(?:\.\d+)?/g)).map((match) => Number(match[0])).filter((value) => Number.isFinite(value)));
      if (numbers.length < 2) {return null;}
      const startSec = Number(numbers[0]);
      const endSec = Number(numbers[1]);
      let durationSec = Number(totalSeconds);
      if (!Number.isFinite(durationSec) || durationSec <= 0 || durationSec < endSec) {
        const endPct = Number(endPctHint);
        durationSec = Number.isFinite(endPct) && endPct > 0 && endPct <= 100
          ? (endSec / (endPct / 100))
          : endSec;
      }
      if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || !Number.isFinite(durationSec) || durationSec <= 0) {return null;}
      return {
        startSec,
        endSec,
        durationSec,
        startPct: Math.min(100, Math.max(0, (startSec / durationSec) * 100)),
        endPct: Math.min(100, Math.max(0, (endSec / durationSec) * 100)),
      };
    };

    const containerNodes = uniq(Array.from(queryAll([
      '[data-testid*="timeline" i]',
      '[class*="timeline" i]',
      '[aria-label*="timeline" i]',
      '[data-testid*="track" i]',
      '[class*="track" i]',
      '[aria-label*="track" i]',
      '[data-testid*="scrubber" i]',
      '[class*="scrubber" i]',
      '[aria-label*="scrubber" i]',
      '[data-testid*="seek" i]',
      '[class*="seek" i]',
      '[aria-label*="seek" i]',
    ].join(','))).filter(isVisible), (node) => node);

    const fallbackContainerNodes = scopeRoot instanceof Element && isVisible(scopeRoot) ? [scopeRoot] : [];
    const containers = uniq([...containerNodes, ...fallbackContainerNodes], (node) => node)
      .map((node) => ({ node, score: containerScore(node) || (node === scopeRoot ? 12 : 0) }))
      .filter((item) => item.score > 0)
      .toSorted((a, b) => b.score - a.score || b.node.getBoundingClientRect().width - a.node.getBoundingClientRect().width)
      .slice(0, 4)
      .map(({ node, score }, index) => serialize(node, {
        score,
        source: node === scopeRoot ? 'known_scope_root' : 'heuristic_container',
        selector: attachSelector(node, 'data-crawclaw-timeline-container', index),
      }));

    const baseContainerRect = containers[0]?.rect || null;
    const positionWithinContainer = (rect) => {
      if (!baseContainerRect || !baseContainerRect.width) {return { pct: null, px: null };}
      const centerX = rect.left + rect.width / 2;
      const raw = ((centerX - baseContainerRect.left) / baseContainerRect.width) * 100;
      return {
        pct: Math.min(100, Math.max(0, raw)),
        px: centerX - baseContainerRect.left,
      };
    };

    const knownHandleNodes = knownTimelineDragHandleXpaths
      .map(firstXPath)
      .filter((node) => node instanceof Element && isVisible(node));
    const handleSelectors = [
      '[role="slider"]',
      '[data-testid*="handle" i]',
      '[class*="handle" i]',
      '[aria-label*="handle" i]',
      '[class*="thumb" i]',
      '[data-testid*="thumb" i]',
      '[class*="knob" i]',
      '[class*="grip" i]',
    ].join(',');
    const handles = uniq([...Array.from(queryAll(handleSelectors)).filter(isVisible), ...knownHandleNodes], (node) => node)
      .slice(0, 8)
      .map((node, index) => {
        const isKnownHandle = knownHandleNodes.includes(node);
        const info = serialize(node, {
          selector: attachSelector(node, 'data-crawclaw-timeline-handle', index),
          source: isKnownHandle ? 'known_timeline_drag_handle_xpath' : (node.matches('[role="slider"]') ? 'slider' : 'handle'),
          valueNow: norm(node.getAttribute('aria-valuenow')),
          valueMin: norm(node.getAttribute('aria-valuemin')),
          valueMax: norm(node.getAttribute('aria-valuemax')),
          orientation: norm(node.getAttribute('aria-orientation')),
          kind: isKnownHandle ? 'trim_end' : '',
        });
        const pos = positionWithinContainer(info.rect);
        return { ...info, positionPct: pos.pct, positionPx: pos.px };
      });

    const sliderSignals = handles.filter((item) => item.source === 'slider');

    const rangeInputs = Array.from(queryAll('input[type="range"]')).filter(isVisible).slice(0, 8).map((node, index) => {
      const info = serialize(node, {
        selector: attachSelector(node, 'data-crawclaw-timeline-range', index),
        source: 'range_input',
        value: norm(node.value),
        min: norm(node.min),
        max: norm(node.max),
        step: norm(node.step),
      });
      const pos = positionWithinContainer(info.rect);
      return { ...info, positionPct: pos.pct, positionPx: pos.px };
    });

    const trimSignals = uniq(Array.from(queryAll([
      '[data-testid*="trim" i]',
      '[class*="trim" i]',
      '[aria-label*="trim" i]',
      '[data-testid*="start" i]',
      '[class*="start" i]',
      '[aria-label*="start" i]',
      '[data-testid*="end" i]',
      '[class*="end" i]',
      '[aria-label*="end" i]',
      '[data-testid*="in" i]',
      '[aria-label*="in" i]',
      '[data-testid*="out" i]',
      '[aria-label*="out" i]',
      '[class*="cursor-ew-resize"]',
      '[class*="rounded-r-md"]',
    ].join(','))).filter(isVisible), (node) => node).slice(0, 12).map((node, index) => {
      const text = [norm(node.getAttribute('aria-label')), norm(node.getAttribute('data-testid')), norm(node.className), norm(node.innerText || node.textContent || '')].join(' ').toLowerCase();
      let kind = 'trim_signal';
      if (/start|left|in|起点|开始/.test(text)) {kind = 'trim_start';}
      else if (/end|right|out|终点|结束/.test(text)) {kind = 'trim_end';}
      return serialize(node, {
        selector: attachSelector(node, 'data-crawclaw-timeline-trim', index),
        kind,
      });
    });

    const selectionSelectors = [
      '[data-testid*="selection" i]',
      '[class*="selection" i]',
      '[aria-label*="selection" i]',
      '[data-testid*="range" i]',
      '[class*="range" i]',
      '[aria-label*="range" i]',
      '[data-testid*="segment" i]',
      '[class*="segment" i]',
      '[data-testid*="window" i]',
      '[class*="window" i]',
      '[class*="border-"][class*="rounded-md"]',
      '[class*="inset-y-0"][class*="rounded-md"]',
    ].join(',');
    const selectionRegions = uniq(Array.from(queryAll(selectionSelectors)).filter(isVisible), (node) => node)
      .slice(0, 8)
      .map((node, index) => {
        const info = serialize(node, {
          selector: attachSelector(node, 'data-crawclaw-timeline-selection', index),
          source: 'selection_region',
        });
        if (baseContainerRect && baseContainerRect.width) {
          const startPx = info.rect.left - baseContainerRect.left;
          const endPx = startPx + info.rect.width;
          return {
            ...info,
            startPx,
            endPx,
            startPct: Math.min(100, Math.max(0, (startPx / baseContainerRect.width) * 100)),
            endPct: Math.min(100, Math.max(0, (endPx / baseContainerRect.width) * 100)),
          };
        }
        return info;
      });

    const videoDuration = Array.from(document.querySelectorAll('video'))
      .map((node) => Number(node.duration))
      .find((value) => Number.isFinite(value) && value > 0) || null;
    const knownRangeLabelNodes = knownTimelineRangeLabelXpaths
      .map(firstXPath)
      .filter((node) => node instanceof Element && isVisible(node));
    const primaryHandlePctHint = handles.find((item) => Number.isFinite(item.positionPct))?.positionPct || null;
    knownRangeLabelNodes.forEach((node, index) => {
      const info = serialize(node, {
        selector: attachSelector(node, 'data-crawclaw-timeline-selection', selectionRegions.length + index),
        source: 'known_timeline_range_label_xpath',
      });
      const parsed = parseTimelineRangeText(info.text || info.ariaLabel || '', videoDuration, primaryHandlePctHint);
      if (parsed) {
        selectionRegions.push({
          ...info,
          startSec: parsed.startSec,
          endSec: parsed.endSec,
          startPct: parsed.startPct,
          endPct: parsed.endPct,
          startPx: baseContainerRect && baseContainerRect.width ? (parsed.startPct / 100) * baseContainerRect.width : null,
          endPx: baseContainerRect && baseContainerRect.width ? (parsed.endPct / 100) * baseContainerRect.width : null,
          durationSec: parsed.durationSec,
        });
      }
    });

    const tracks = uniq(Array.from(queryAll([
      '[data-testid*="track" i]',
      '[class*="track" i]',
      '[aria-label*="track" i]',
      '[data-testid*="scrubber" i]',
      '[class*="scrubber" i]',
    ].join(','))).filter(isVisible), (node) => node).slice(0, 8).map((node, index) => serialize(node, {
      selector: attachSelector(node, 'data-crawclaw-timeline-track', index),
    }));

    const draggableCount = Array.from(document.querySelectorAll('[draggable="true"]')).filter(isVisible).length;

    return {
      scopeRoot: scopeRoot ? serialize(scopeRoot, { scope: 'timeline_local_root' }) : null,
      containers,
      tracks,
      handles,
      sliderSignals,
      rangeInputs,
      trimSignals,
      selectionRegions,
      draggableCount,
    };
  }, {
    knownTimelineScopeXpaths: KNOWN_TIMELINE_SCOPE_XPATHS,
    knownTimelineDragHandleXpaths: KNOWN_TIMELINE_DRAG_HANDLE_XPATHS,
    knownTimelineRangeLabelXpaths: KNOWN_TIMELINE_RANGE_LABEL_XPATHS,
  }).catch(() => ({
    containers: [],
    tracks: [],
    handles: [],
    sliderSignals: [],
    rangeInputs: [],
    trimSignals: [],
    selectionRegions: [],
    draggableCount: 0,
  }));

  return classifyTimelineSnapshot(snapshot);
}

function chooseExportName({ job, rawPath, resultUrl }) {
  const rawBase = sanitizeFileName(path.basename(rawPath));
  const ext = path.extname(rawBase) || '.mp4';
  const postId = extractPostIdFromUrl(resultUrl);
  const fallback = sanitizeFileName(path.parse(rawBase).name || `${job.jobId}-video`);
  const base = sanitizeFileName(postId ? `grok-video-${postId}` : fallback);
  return `${base}${ext}`;
}

function appendGeneratedVideoRegistry(entry = {}) {
  const jobLike = {
    jobId: entry.jobId || '',
    profile: entry.profile || '',
    manifest: { action: entry.actionType || 'generate' },
    request: {},
    files: { generatedVideoUrlsPath: GENERATED_VIDEO_URLS_PATH },
  };
  const result = appendGeneratedVideoUrl(jobLike, entry);
  return result.entry;
}

function promoteToExport({ job, rawPath, resultUrl }) {
  const exportName = chooseExportName({ job, rawPath, resultUrl });
  const exportPath = uniquePath(job.exportsDir, exportName);
  fs.copyFileSync(rawPath, exportPath);
  return exportPath;
}

module.exports = {
  DEFAULT_PROFILE,
  GENERATED_VIDEO_URLS_PATH,
  RESULT_URL_RE,
  appendGeneratedVideoRegistry,
  appendGeneratedVideoUrl,
  appendJsonl,
  appendWorkflowCheckpoint,
  classifyTimelineSnapshot,
  clearWorkflowBlockReason,
  collectStateCandidates,
  confirmLoggedInAtSafeEntry,
  createLogger,
  detectCompletion,
  dirExists,
  ensureDir,
  extractPostIdFromUrl,
  assessResultUrlConsistency,
  fileExists,
  gotoResultPage,
  launchPersistentContext,
  loadPlaywright,
  normalizeActionType,
  nowIso,
  parseArgs,
  parseNumber,
  pickString,
  probeTimeline,
  promoteToExport,
  readJson,
  recordLineage,
  resolveActionType,
  resolveJob,
  resolveResultUrl,
  resolveResultUrlConsistencyMode,
  sanitizeFileName,
  setWorkflowBlockReason,
  sleep,
  updateManifest,
  updateWorkflowStatus,
  uniquePath,
  waitForCompletion,
  writeJson,
  writeWorkflowResultUrl,
  WORKSPACE_ROOT,
  SKILL_ROOT,
};
