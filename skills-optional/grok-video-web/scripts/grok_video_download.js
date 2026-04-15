#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  appendJsonl,
  detectCompletion,
  gotoResultPage,
  nowIso,
  parseArgs,
  parseNumber,
  promoteToExport,
  resolveJob,
  resolveResultUrl,
  sleep,
  updateManifest,
  updateWorkflowStatus,
  appendWorkflowCheckpoint,
  writeWorkflowResultUrl,
  clearWorkflowBlockReason,
  confirmLoggedInAtSafeEntry,
  setWorkflowBlockReason,
  waitForCompletion,
  assessResultUrlConsistency,
  resolveResultUrlConsistencyMode,
  writeJson,
  createLogger,
} = require('./grok_video_lib');
const {
  launchPersistent,
  resolveProfileDir,
} = require('./grok_video_common');

function usage() {
  console.log(`Usage: grok_video_download.js --job-id <id> [options]\n\nDownload a completed Grok video into downloads/ and promote final artifact into exports/.\n\nOptions:\n  --job-id <id>            Browser job id under runtime/browser-jobs/grok-video-web/\n  --job-dir <path>         Explicit job directory (alternative to --job-id)\n  --result-url <url>       Explicit Grok result URL; otherwise infer from state/*.json\n  --profile <name>         Browser profile name. Default: from job manifest/request, else grok-web\n  --wait                   Wait for completion before downloading (default on)\n  --no-wait                Skip pre-download waiting and attempt immediately\n  --timeout-sec <n>        Wait timeout seconds if waiting. Default: 900\n  --interval-sec <n>       Poll interval seconds if waiting. Default: 8\n  --download-timeout-sec <n>  Download click timeout seconds. Default: 20\n  --headful                Launch visible browser instead of headless\n  --help                   Show this help\n`);
}

function snapshotDownloadFiles(dirPath) {
  const snapshot = new Map();
  if (!dirPath || !fs.existsSync(dirPath)) {return snapshot;}
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    if (!entry.isFile()) {continue;}
    const fullPath = path.join(dirPath, entry.name);
    const stat = fs.statSync(fullPath);
    snapshot.set(entry.name, { size: stat.size, mtimeMs: stat.mtimeMs, path: fullPath });
  }
  return snapshot;
}

function normalizeDownloadItemPath(item = {}) {
  const candidates = [
    item.filePath,
    item.file_path,
    item.targetPath,
    item.target_path,
    item.fileUrl,
    item.file_url,
  ].filter(Boolean);
  for (const raw of candidates) {
    if (typeof raw !== 'string') {continue;}
    if (raw.startsWith('file://')) {
      try {
        return decodeURIComponent(raw.replace(/^file:\/\//, ''));
      } catch {
        return raw.replace(/^file:\/\//, '');
      }
    }
    return raw;
  }
  return '';
}

async function collectVisibleControlLabels(page, limit = 12) {
  return page.evaluate((maxItems) => {
    const visible = (node) => {
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style && style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };
    const nodes = Array.from(document.querySelectorAll('button, a, [role="button"], [role="menuitem"], [role="menu"]'));
    const labels = [];
    for (const node of nodes) {
      if (!visible(node)) {continue;}
      const label = String(node.getAttribute('aria-label') || node.getAttribute('title') || node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
      if (!label) {continue;}
      labels.push(label.slice(0, 160));
      if (labels.length >= maxItems) {break;}
    }
    return Array.from(new Set(labels));
  }, limit).catch(() => []);
}

async function collectMenuItemLabels(page, limit = 12) {
  return page.evaluate((maxItems) => {
    const visible = (node) => {
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style && style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };
    const nodes = Array.from(document.querySelectorAll('[role="menuitem"], [role="menu"] button, [role="menu"] a, [role="menu"] [role="button"]'));
    const labels = [];
    for (const node of nodes) {
      if (!visible(node)) {continue;}
      const label = String(node.getAttribute('aria-label') || node.getAttribute('title') || node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
      if (!label) {continue;}
      labels.push(label.slice(0, 160));
      if (labels.length >= maxItems) {break;}
    }
    return Array.from(new Set(labels));
  }, limit).catch(() => []);
}

async function hoverVideoSurface(page) {
  const box = await page.evaluate(() => {
    const video = document.querySelector('video');
    if (!video) {return null;}
    const rect = video.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {return null;}
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
  }).catch(() => null);
  if (!box) {return false;}
  await page.mouse.move(box.x + (box.width / 2), box.y + Math.max(12, box.height - 24)).catch(() => {});
  await sleep(500);
  return true;
}

async function markVisibleClickableByText(page, texts, attrName) {
  const desired = Array.from(new Set((texts || []).map((text) => String(text || '').trim().toLowerCase()).filter(Boolean)));
  if (!desired.length) {return { found: false, selector: '', label: '' };}
  return page.evaluate(({ desired, attrName }) => {
    const visible = (node) => {
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style && style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };
    const norm = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
    document.querySelectorAll(`[${attrName}]`).forEach((node) => node.removeAttribute(attrName));
    const nodes = Array.from(document.querySelectorAll('button, a, [role="button"], [role="menuitem"], input[type="button"], input[type="submit"]'));
    const scored = [];
    for (const node of nodes) {
      if (!visible(node)) {continue;}
      const label = norm(node.getAttribute('aria-label') || node.getAttribute('title') || node.innerText || node.textContent || node.value || '');
      if (!label) {continue;}
      let score = 0;
      for (const token of desired) {
        if (label === token) {score = Math.max(score, 100 + token.length);}
        else if (label.includes(token)) {score = Math.max(score, 50 + token.length);}
      }
      if (!score) {continue;}
      if (node.getAttribute('role') === 'menuitem') {score += 4;}
      if (/download|下载/.test(label)) {score += 6;}
      if (node.hasAttribute('disabled') || node.getAttribute('aria-disabled') === 'true') {score -= 1000;}
      scored.push({ node, label, score });
    }
    scored.sort((a, b) => b.score - a.score);
    const top = scored[0];
    if (!top) {return { found: false, selector: '', label: '' };}
    top.node.setAttribute(attrName, '1');
    return { found: true, selector: `[${attrName}="1"]`, label: top.label };
  }, { desired, attrName }).catch(() => ({ found: false, selector: '', label: '' }));
}

async function waitForDownloadArtifact(downloadsDir, before, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastCandidate = null;
  while (Date.now() <= deadline) {
    const current = snapshotDownloadFiles(downloadsDir);
    for (const [name, meta] of current.entries()) {
      const prior = before.get(name);
      if (!prior || meta.mtimeMs > prior.mtimeMs || meta.size > prior.size) {
        lastCandidate = { name, path: meta.path, size: meta.size };
        if (!name.endsWith('.crdownload') && meta.size > 0) {
          return lastCandidate;
        }
      }
    }
    await sleep(500);
  }
  if (lastCandidate && fs.existsSync(lastCandidate.path) && !lastCandidate.name.endsWith('.crdownload')) {
    return lastCandidate;
  }
  return null;
}

async function clickAndWaitForDownload(page, selector, timeoutMs, downloadsDir, source) {
  const before = snapshotDownloadFiles(downloadsDir);
  try {
    await page.click(selector, { delay: 40 });
  } catch {
    return null;
  }
  const file = await waitForDownloadArtifact(downloadsDir, before, timeoutMs);
  return file ? { file, source } : null;
}

async function openMenuAndClickDownload(page, timeoutMs, downloadsDir) {
  const menuButtons = [
    { texts: ['settings'], source: 'settings-button' },
    { texts: ['more'], source: 'more-button' },
    { texts: ['更多'], source: 'more-button-zh' },
  ];
  const menuEvidence = [];

  for (const candidate of menuButtons) {
    const trigger = await markVisibleClickableByText(page, candidate.texts, 'data-crawclaw-menu-target');
    if (!trigger.found) {continue;}
    await page.click(trigger.selector, { delay: 30 }).catch(() => {});
    await sleep(400);
    const menuItems = await collectMenuItemLabels(page);
    if (menuItems.length) {menuEvidence.push(`${candidate.source}: ${menuItems.join(' | ')}`);}
    const downloadTarget = await markVisibleClickableByText(page, ['下载', 'download'], 'data-crawclaw-download-target');
    if (downloadTarget.found) {
      const hit = await clickAndWaitForDownload(page, downloadTarget.selector, timeoutMs, downloadsDir, `${candidate.source}:${downloadTarget.label || 'download-item'}`);
      if (hit) {return { ...hit, menuEvidence };}
    }
    await page.keyboard.press('Escape').catch(() => {});
    await sleep(150);
  }
  return { file: null, source: 'menu-ui-miss', menuEvidence };
}

async function clickDownloadButton(page, timeoutMs, downloadsDir) {
  await hoverVideoSurface(page);

  const directTarget = await markVisibleClickableByText(page, ['下载', 'download'], 'data-crawclaw-download-target');
  if (directTarget.found) {
    const directHit = await clickAndWaitForDownload(page, directTarget.selector, timeoutMs, downloadsDir, `direct:${directTarget.label || 'download'}`);
    if (directHit) {return directHit;}
  }

  const menuHit = await openMenuAndClickDownload(page, timeoutMs, downloadsDir);
  if (menuHit?.file) {return menuHit;}

  const visibleControls = await collectVisibleControlLabels(page);
  return {
    file: null,
    source: 'ui-miss',
    visibleControls,
    menuEvidence: menuHit?.menuEvidence || [],
  };
}

async function saveBrowserDownload(file, job, resultUrl, method = 'page-download') {
  const rawPath = file.path;
  const exportPath = promoteToExport({ job, rawPath, resultUrl });
  return {
    method,
    rawPath,
    exportPath,
    size: fs.statSync(rawPath).size,
    suggestedFilename: path.basename(rawPath),
    sourceUrl: '',
  };
}

async function readChromeDownloads(browser, timeoutMs, { sinceMs = 0, resultUrl = '' } = {}) {
  const deadline = Date.now() + timeoutMs;
  const expectedPostId = (String(resultUrl || '').match(/\/imagine\/post\/([^/?#]+)/i) || [])[1] || '';
  let downloadsPage = null;
  try {
    downloadsPage = await browser.newPage();
    await downloadsPage.goto('chrome://downloads/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    while (Date.now() <= deadline) {
      const items = await downloadsPage.evaluate(() => {
        const manager = document.querySelector('downloads-manager');
        const list = manager?.shadowRoot?.querySelector('#downloadsList');
        const data = Array.isArray(list?.items) ? list.items : (Array.isArray(manager?.items_) ? manager.items_ : []);
        return (data || []).map((item) => ({
          state: item.state || item.state_string || '',
          filePath: item.filePath || item.file_path || item.targetPath || item.target_path || '',
          fileUrl: item.fileUrl || item.file_url || '',
          url: item.url || item.source_url || '',
          fileName: item.fileName || item.file_name || '',
          startTime: item.startTime || item.start_time || '',
          endTime: item.endTime || item.end_time || '',
          dangerType: item.dangerType || item.danger_type || '',
        }));
      }).catch(() => []);
      const complete = items
        .map((item) => ({ ...item, resolvedPath: normalizeDownloadItemPath(item) }))
        .filter((item) => /complete|2/i.test(String(item.state || '')) || item.resolvedPath || item.fileUrl)
        .filter((item) => {
          if (!expectedPostId) {return true;}
          const hay = `${item.resolvedPath || ''} ${item.fileName || ''} ${item.url || ''} ${item.fileUrl || ''}`;
          return hay.includes(expectedPostId);
        })
        .map((item) => {
          let statTime = 0;
          try {
            if (item.resolvedPath && fs.existsSync(item.resolvedPath)) {statTime = fs.statSync(item.resolvedPath).mtimeMs;}
          } catch {}
          return { ...item, statTime };
        })
        .filter((item) => !sinceMs || item.statTime >= sinceMs - 1000 || !!expectedPostId)
        .toSorted((a, b) => (b.statTime || 0) - (a.statTime || 0));
      if (complete.length) {return complete[0];}
      await sleep(700);
      await downloadsPage.reload({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    }
    return null;
  } finally {
    if (downloadsPage) {await downloadsPage.close().catch(() => {});}
  }
}

async function saveChromeDownloadItem(item, job, resultUrl) {
  const resolvedPath = normalizeDownloadItemPath(item);
  if (!resolvedPath || !fs.existsSync(resolvedPath)) {
    throw new Error('chrome_download_item_path_unavailable');
  }
  const ext = path.extname(resolvedPath) || '.mp4';
  const postId = (resultUrl.match(/\/imagine\/post\/([^/?#]+)/i) || [])[1] || `video-${Date.now()}`;
  const safePostId = String(postId).replace(/[^a-zA-Z0-9._-]+/g, '-');
  const rawPath = path.join(job.downloadsDir, `grok-video-${safePostId}${ext}`);
  fs.copyFileSync(resolvedPath, rawPath);
  const exportPath = promoteToExport({ job, rawPath, resultUrl });
  return {
    method: 'chrome-downloads-manager',
    rawPath,
    exportPath,
    size: fs.statSync(rawPath).size,
    suggestedFilename: path.basename(rawPath),
    sourceUrl: item.url || item.fileUrl || '',
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    usage();
    return;
  }

  const job = resolveJob(args);
  const logger = createLogger(job, { script: 'grok_video_download' });
  const resultUrl = resolveResultUrl(job, args['result-url']);
  if (!resultUrl) {
    throw new Error('unable to resolve result URL from --result-url or job state');
  }

  const profile = args.profile || job.profile;
  const headless = !args.headful;
  const shouldWait = args['no-wait'] ? false : true;
  const timeoutMs = parseNumber(args['timeout-sec'], 900) * 1000;
  const intervalMs = parseNumber(args['interval-sec'], 8) * 1000;
  const downloadTimeoutMs = parseNumber(args['download-timeout-sec'], 20) * 1000;
  const resultUrlConsistencyMode = resolveResultUrlConsistencyMode(job, args['result-url-mismatch-mode'] || '');

  const startedAt = nowIso();
  logger.info('download.start', {
    phase: 'download_started',
    currentUrl: resultUrl,
    resultUrl,
    profile,
    shouldWait,
    timeoutMs,
    intervalMs,
    downloadTimeoutMs,
    resultUrlConsistencyMode,
  });
  writeJson(job.files.downloadStatusPath, {
    startedAt,
    action: 'download',
    jobId: job.jobId,
    jobDir: job.jobDir,
    profile,
    resultUrl,
    shouldWait,
  });
  updateWorkflowStatus(job, { status: shouldWait ? 'running' : 'queued', blocked: false, phase: 'download_started', currentUrl: resultUrl, resultUrl });
  clearWorkflowBlockReason(job);
  appendWorkflowCheckpoint(job, { kind: 'download_started', step: 'download', status: shouldWait ? 'running' : 'queued', url: resultUrl, resultUrl, note: 'Starting download flow.' });
  writeWorkflowResultUrl(job, resultUrl);
  updateManifest(job, {
    resultUrl,
    downloadProfile: profile,
    lastDownloadStartedAt: startedAt,
  });

  let context;
  try {
    const launched = await launchPersistent(resolveProfileDir(profile), {
      downloadsDir: job.downloadsDir,
      headless,
      timeout: 15000,
    });
    logger.info('download.browser_launched', {
      phase: 'download_started',
      profile,
      path: launched.profileDir,
      currentUrl: resultUrl,
      resultUrl,
      headless,
    });
    context = launched.context;
    let page = launched.page;

    const loginGate = await confirmLoggedInAtSafeEntry({
      page,
      job,
      logger,
      action: 'download',
    });
    if (!loginGate.ok) {
      const payload = {
        ok: false,
        action: 'download',
        jobId: job.jobId,
        jobDir: job.jobDir,
        profile,
        resultUrl,
        status: loginGate.status,
        blocker: {
          type: 'account_login_gate',
          reasonCode: loginGate.blockerReasonCode,
          safeEntryUrl: loginGate.safeEntryUrl,
          currentUrl: loginGate.currentUrl,
          loginState: loginGate.state,
          matchedSignals: loginGate.signals,
        },
        checkedAt: loginGate.checkedAt,
        downloadStateFile: job.files.downloadStatusPath,
      };
      writeJson(job.files.downloadStatusPath, payload);
      updateWorkflowStatus(job, {
        status: loginGate.status,
        blocked: true,
        phase: 'download_login_gate_blocked',
        currentUrl: loginGate.currentUrl,
        resultUrl,
        loginState: loginGate.state,
        blockerSignals: loginGate.signals.cloudflare || loginGate.signals.loggedOut || [],
      });
      appendWorkflowCheckpoint(job, {
        kind: 'download_login_gate_blocked',
        step: 'download',
        status: loginGate.status,
        url: loginGate.currentUrl,
        resultUrl,
        note: `Safe-entry login gate blocked result navigation: ${loginGate.blockerReasonCode}`,
      });
      setWorkflowBlockReason(job, {
        status: loginGate.status,
        reasonCode: loginGate.blockerReasonCode,
        summary: 'Safe-entry login gate blocked result-page navigation.',
        currentUrl: loginGate.currentUrl,
        matchedSignals: loginGate.signals.cloudflare || loginGate.signals.loggedOut || [],
      });
      logger.warn('download.login_gate_blocked', {
        status: loginGate.status,
        phase: 'download_login_gate_blocked',
        currentUrl: loginGate.currentUrl,
        resultUrl,
        safeEntryUrl: loginGate.safeEntryUrl,
        matchedSignals: loginGate.signals,
      });
      console.log(JSON.stringify(payload, null, 2));
      process.exitCode = 4;
      return;
    }

    let waitResult = null;
    if (shouldWait) {
      waitResult = await waitForCompletion({
        page,
        job,
        resultUrl,
        timeoutMs,
        intervalMs,
        refresh: true,
        logger,
        resultUrlConsistencyMode,
      });
      if (waitResult.status === 'blocked') {
        throw new Error(`result page blocked: ${(waitResult.blockerSignals || []).join(', ') || 'unknown blocker'}`);
      }
      if (waitResult.timeout) {
        throw new Error('timed out waiting for completed result before download');
      }
    } else {
      await gotoResultPage(page, resultUrl);
      waitResult = await detectCompletion(page);
    }

    const pageStateBeforeDownload = await detectCompletion(page);
    const resultUrlConsistency = waitResult.resultUrlConsistency || assessResultUrlConsistency({
      expectedResultUrl: resultUrl,
      observedUrl: pageStateBeforeDownload.url || page.url(),
      observedPostId: pageStateBeforeDownload.postId || '',
      job,
      mode: resultUrlConsistencyMode,
    });
    if (resultUrlConsistency.mismatch) {
      logger[resultUrlConsistency.action === 'block' ? 'warn' : 'info']('download.result_url_mismatch', {
        phase: 'download_consistency_check',
        currentUrl: pageStateBeforeDownload.url || page.url(),
        resultUrl,
        expectedPostId: resultUrlConsistency.expectedPostId,
        observedPostId: resultUrlConsistency.observedPostId,
        observedUrl: resultUrlConsistency.observedUrl,
        mismatchReason: resultUrlConsistency.mismatchReason,
        mismatchMode: resultUrlConsistency.mode,
        action: resultUrlConsistency.action,
      });
      appendJsonl(job.files.downloadTracePath, {
        at: nowIso(),
        event: 'result-url-mismatch',
        resultUrl,
        expectedPostId: resultUrlConsistency.expectedPostId,
        observedPostId: resultUrlConsistency.observedPostId,
        observedUrl: resultUrlConsistency.observedUrl,
        mismatchReason: resultUrlConsistency.mismatchReason,
        mismatchMode: resultUrlConsistency.mode,
        action: resultUrlConsistency.action,
      });
      if (resultUrlConsistency.action === 'block') {
        throw new Error(`result URL mismatch before download: expected ${resultUrlConsistency.expectedPostId || '<none>'}, observed ${resultUrlConsistency.observedPostId || '<none>'} (${resultUrlConsistency.observedUrl || 'no observed url'})`);
      }
    }

    await sleep(1000);
    let downloaded = null;
    let downloadTraceEvent = '';
    let triggerSource = '';
    const nativeDownloadsDir = path.join(os.homedir(), 'Downloads');
    const chromeDownloadsSinceMs = Date.now();

    const downloadAttempt = await clickDownloadButton(page, downloadTimeoutMs, job.downloadsDir);
    if (!downloadAttempt || !downloadAttempt.file) {
      const uiEvidence = Array.isArray(downloadAttempt?.visibleControls) && downloadAttempt.visibleControls.length
        ? downloadAttempt.visibleControls.join(' | ')
        : 'none';
      const menuEvidence = Array.isArray(downloadAttempt?.menuEvidence) && downloadAttempt.menuEvidence.length
        ? downloadAttempt.menuEvidence.join(' || ')
        : 'none';
      let chromeItem = await readChromeDownloads(context, Math.max(downloadTimeoutMs, 12000), {
        sinceMs: chromeDownloadsSinceMs,
        resultUrl,
      });
      if (!chromeItem && headless) {
        logger.info('download.retry_headful', {
          phase: 'download_retry_headful',
          currentUrl: page.url(),
          resultUrl,
          reason: 'browser_download_not_materialized_in_headless',
        });
        await context.close().catch(() => {});
        const relaunched = await launchPersistent(resolveProfileDir(profile), {
          downloadsDir: job.downloadsDir,
          headless: false,
          timeout: 15000,
        });
        context = relaunched.context;
        page = relaunched.page;
        await gotoResultPage(page, resultUrl);
        await sleep(1200);
        const retrySinceMs = Date.now();
        const retryAttempt = await clickDownloadButton(page, downloadTimeoutMs, job.downloadsDir);
        if (retryAttempt && retryAttempt.file) {
          downloaded = await saveBrowserDownload(retryAttempt.file, job, resultUrl, 'page-download');
          downloadTraceEvent = 'page-download-headful-retry';
          triggerSource = `headful-retry:${retryAttempt.source}`;
        } else {
          chromeItem = await readChromeDownloads(context, Math.max(downloadTimeoutMs, 12000), {
            sinceMs: retrySinceMs,
            resultUrl,
          });
          if (chromeItem) {
            downloaded = await saveChromeDownloadItem(chromeItem, job, resultUrl);
            downloadTraceEvent = 'chrome-downloads-manager-headful-retry';
            triggerSource = `headful-retry:chrome-downloads:${retryAttempt?.source || 'download-click'}`;
          } else {
            logger.warn('download.button_unavailable', {
              reasonCode: 'browser_download_not_materialized',
              currentUrl: page.url(),
              resultUrl,
              visibleControls: retryAttempt?.visibleControls || downloadAttempt?.visibleControls || [],
              menuEvidence: retryAttempt?.menuEvidence || downloadAttempt?.menuEvidence || [],
              nativeDownloadsDir,
            });
            throw new Error(`download click did not materialize into browser downloads; visible controls: ${uiEvidence}; menus: ${menuEvidence}`);
          }
        }
      } else if (chromeItem) {
        downloaded = await saveChromeDownloadItem(chromeItem, job, resultUrl);
        downloadTraceEvent = 'chrome-downloads-manager';
        triggerSource = `chrome-downloads:${downloadAttempt?.source || 'download-click'}`;
      } else {
        logger.warn('download.button_unavailable', {
          reasonCode: 'browser_download_not_materialized',
          currentUrl: page.url(),
          resultUrl,
          visibleControls: downloadAttempt?.visibleControls || [],
          menuEvidence: downloadAttempt?.menuEvidence || [],
          nativeDownloadsDir,
        });
        throw new Error(`download click did not materialize into browser downloads; visible controls: ${uiEvidence}; menus: ${menuEvidence}`);
      }
    } else {
      downloaded = await saveBrowserDownload(downloadAttempt.file, job, resultUrl, 'page-download');
      downloadTraceEvent = 'page-download';
      triggerSource = downloadAttempt.source;
    }

    logger.info('download.method_selected', {
      method: downloaded.method,
      currentUrl: page.url(),
      resultUrl,
      triggerSource,
      rawPath: downloaded.rawPath,
      exportPath: downloaded.exportPath,
      expectedPostId: resultUrlConsistency.expectedPostId,
      observedPostId: resultUrlConsistency.observedPostId,
      observedUrl: resultUrlConsistency.observedUrl,
      resultUrlConsistency,
      sourceUrl: downloaded.sourceUrl || '',
    });
    appendJsonl(job.files.downloadTracePath, {
      at: nowIso(),
      event: downloadTraceEvent || downloaded.method,
      triggerSource,
      rawPath: downloaded.rawPath,
      exportPath: downloaded.exportPath,
      sourceUrl: downloaded.sourceUrl || '',
      expectedPostId: resultUrlConsistency.expectedPostId,
      observedPostId: resultUrlConsistency.observedPostId,
      observedUrl: resultUrlConsistency.observedUrl,
      resultUrlConsistency,
    });

    const payload = {
      ok: true,
      action: 'download',
      jobId: job.jobId,
      jobDir: job.jobDir,
      profile,
      resultUrl,
      status: 'downloaded',
      completionSignals: waitResult.completionSignals || [],
      postId: waitResult.postId || '',
      expectedPostId: resultUrlConsistency.expectedPostId || waitResult.expectedPostId || '',
      observedPostId: resultUrlConsistency.observedPostId || waitResult.observedPostId || waitResult.postId || '',
      observedUrl: resultUrlConsistency.observedUrl || pageStateBeforeDownload.url || waitResult.url || resultUrl,
      rawPath: downloaded.rawPath,
      exportPath: downloaded.exportPath,
      resultUrlConsistency,
      fileSize: downloaded.size,
      method: downloaded.method,
      sourceUrl: downloaded.sourceUrl || '',
      suggestedFilename: downloaded.suggestedFilename || path.basename(downloaded.rawPath),
      checkedAt: nowIso(),
      waitStateFile: job.files.waitStatusPath,
      downloadStateFile: job.files.downloadStatusPath,
    };

    writeJson(job.files.downloadStatusPath, payload);
    updateWorkflowStatus(job, {
      status: 'completed',
      blocked: false,
      phase: 'download_completed',
      currentUrl: resultUrl,
      resultUrl,
      completionSignals: payload.completionSignals || [],
      postId: payload.postId || '',
      expectedPostId: payload.expectedPostId,
      observedPostId: payload.observedPostId,
      observedUrl: payload.observedUrl,
      resultUrlConsistency: payload.resultUrlConsistency,
      lastRawDownloadPath: payload.rawPath,
      lastExportPath: payload.exportPath,
    });
    appendWorkflowCheckpoint(job, {
      kind: 'download_completed',
      step: 'download',
      status: 'completed',
      url: resultUrl,
      resultUrl,
      note: payload.exportPath,
    });
    updateManifest(job, {
      lastDownloadedAt: payload.checkedAt,
      resultUrl,
      postId: payload.postId || job.manifest.postId || '',
      lastKnownStatus: 'downloaded',
      lastRawDownloadPath: payload.rawPath,
      lastExportPath: payload.exportPath,
    });
    logger.info('download.finished', {
      status: 'downloaded',
      phase: 'download_completed',
      currentUrl: resultUrl,
      resultUrl,
      method: payload.method,
      rawPath: payload.rawPath,
      exportPath: payload.exportPath,
    });
    console.log(JSON.stringify(payload, null, 2));
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
  }
}

main().catch((error) => {
  const args = parseArgs(process.argv.slice(2));
  try {
    const job = resolveJob(args);
    const logger = createLogger(job, { script: 'grok_video_download' });
    const resultUrl = resolveResultUrl(job, args['result-url']) || '';
    const payload = {
      ok: false,
      action: 'download',
      jobId: job.jobId,
      jobDir: job.jobDir,
      profile: args.profile || job.profile,
      resultUrl,
      status: 'failed',
      error: error.message,
      checkedAt: nowIso(),
      downloadStateFile: job.files.downloadStatusPath,
    };
    writeJson(job.files.downloadStatusPath, payload);
    updateWorkflowStatus(job, { status: 'failed', blocked: true, phase: 'download_failed', currentUrl: resultUrl, resultUrl });
    appendWorkflowCheckpoint(job, { kind: 'download_failed', step: 'download', status: 'failed', note: error.message, url: resultUrl, resultUrl });
    logger.error('download.failed', {
      status: 'failed',
      phase: 'download_failed',
      currentUrl: resultUrl,
      resultUrl,
      message: error.message,
      path: job.files.downloadStatusPath,
    });
  } catch {}
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
