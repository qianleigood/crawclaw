#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {
  appendGeneratedVideoUrl,
  appendWorkflowCheckpoint,
  clearWorkflowBlockReason,
  confirmLoggedInAtSafeEntry,
  createLogger,
  ensureDir,
  extractPostIdFromUrl,
  gotoResultPage,
  nowIso,
  parseArgs,
  parseNumber,
  recordLineage,
  resolveActionType,
  resolveJob,
  sanitizeFileName,
  setWorkflowBlockReason,
  sleep,
  updateManifest,
  updateWorkflowStatus,
  writeJson,
  writeWorkflowResultUrl,
  WORKSPACE_ROOT,
} = require('./grok_video_lib');
const {
  launchPersistent,
  resolveProfileDir,
} = require('./grok_video_common');

function usage() {
  console.log(`Usage: grok_video_redo.js [options]\n\nRun or continue a redo-video derivative flow from an existing Grok result page. This runner can now attempt the real Redo UI click, capture the derived result URL, and persist lineage/handoff state on the same conventions as submit/extend.\n\nOptions:\n  --job-id <id>                Existing browser job id under runtime/browser-jobs/grok-video-web/\n  --job-dir <path>             Explicit job directory\n  --result-url <url>           Source Grok result URL (/imagine/post/<id>)\n  --new-result-url <url>       Record the new derived result URL after redo submit happens\n  --profile <name>             Browser profile name. Default: from job manifest/request, else grok-web\n  --submit-timeout-sec <n>     Wait this long for derived result URL capture after click. Default: 45\n  --manual-handoff-wait-sec <n>Keep the same page/profile open while watching for a derived URL. Default: 0\n  --detect-only                Probe redo entry only; do not click redo or final submit\n  --no-submit-click            Do not auto-click any final Make video / submit candidate after redo entry opens\n  --headful                    Launch visible browser instead of headless\n  --help                       Show this help\n`);
}

function timestampTag() {
  return new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14).toLowerCase();
}

function buildRedoJobId(resultUrl) {
  const postId = sanitizeFileName(extractPostIdFromUrl(resultUrl) || 'result');
  return `redo-${postId}-${timestampTag()}`;
}

function bootstrapStandaloneJob(resultUrl, profileHint = '') {
  const jobId = buildRedoJobId(resultUrl);
  const jobDir = path.join(WORKSPACE_ROOT, 'runtime', 'browser-jobs', 'grok-video-web', jobId);
  const stateDir = path.join(jobDir, 'state');
  const downloadsDir = path.join(jobDir, 'downloads');
  const exportsDir = path.join(jobDir, 'exports');
  const uploadsDir = path.join(jobDir, 'uploads');
  ensureDir(stateDir);
  ensureDir(downloadsDir);
  ensureDir(exportsDir);
  ensureDir(uploadsDir);

  const profile = String(profileHint || 'grok-web').trim() || 'grok-web';
  const requestPath = path.join(stateDir, 'request.json');
  const manifestPath = path.join(stateDir, 'job.json');

  if (!fs.existsSync(requestPath)) {
    writeJson(requestPath, {
      skill: 'grok-video-web',
      action: 'redo_video',
      jobId,
      profile,
      sourceResultUrl: resultUrl,
      prompt: '',
      references: [],
    });
  }

  if (!fs.existsSync(manifestPath)) {
    writeJson(manifestPath, {
      skill: 'grok-video-web',
      action: 'redo_video',
      jobId,
      jobDir,
      stateDir,
      uploadsDir,
      downloadsDir,
      exportsDir,
      profile,
      requestFile: requestPath,
      defaultDownloadPolicy: {
        rawDownloadsDir: downloadsDir,
        finalExportsDir: exportsDir,
      },
    });
  }

  return resolveJob({ 'job-dir': jobDir });
}

function resolveSourceResultUrl(job, explicitUrl = '') {
  const candidates = [
    explicitUrl,
    job.request?.sourceResultUrl,
    job.manifest?.sourceResultUrl,
    job.manifest?.lineage?.sourceResultUrl,
    job.manifest?.redo?.sourceResultUrl,
  ];
  for (const value of candidates) {
    if (typeof value === 'string' && /\/imagine\/post\//i.test(value)) {
      return value.trim();
    }
  }
  return '';
}

function buildBasePayload(job, profile, sourceResultUrl, checkedAt) {
  return {
    ok: true,
    action: 'redo',
    actionType: 'redo_video',
    jobId: job.jobId,
    jobDir: job.jobDir,
    profile,
    checkedAt,
    sourcePostId: extractPostIdFromUrl(sourceResultUrl),
    sourceResultUrl,
    stateFile: job.files.redoStatePath,
    historyFile: job.files.redoHistoryPath,
  };
}

function textTokens(values) {
  return Array.from(new Set((values || []).map((value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase()).filter(Boolean)));
}

async function markVisibleClickableByText(page, texts, attrName, { exactOnly = false } = {}) {
  const desired = textTokens(texts);
  if (!desired.length) {return { found: false, selector: '', label: '', score: 0 };}
  return page.evaluate(({ desired, attrName, exactOnly }) => {
    const visible = (node) => {
      if (!(node instanceof Element)) {return false;}
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
        else if (!exactOnly && label.includes(token)) {score = Math.max(score, 50 + token.length);}
      }
      if (!score) {continue;}
      if ((node.getAttribute('role') || '').toLowerCase() === 'menuitem') {score += 4;}
      if (/redo|重新生成|重做/.test(label)) {score += 8;}
      if (/make video|生成视频/.test(label)) {score += 5;}
      if (node.hasAttribute('disabled') || node.getAttribute('aria-disabled') === 'true') {score -= 1000;}
      scored.push({ node, label, score });
    }
    scored.sort((a, b) => b.score - a.score);
    const top = scored[0];
    if (!top) {return { found: false, selector: '', label: '', score: 0 };}
    top.node.setAttribute(attrName, '1');
    return { found: true, selector: `[${attrName}="1"]`, label: top.label, score: top.score };
  }, { desired, attrName, exactOnly }).catch(() => ({ found: false, selector: '', label: '', score: 0 }));
}

async function detectRedoEntry(page) {
  const direct = await markVisibleClickableByText(page, [
    'redo video',
    'redo',
    '重做视频',
    '重新生成视频',
    '重新生成',
  ], 'data-crawclaw-redo-entry');
  if (direct.found) {
    return {
      found: true,
      selector: direct.selector,
      label: direct.label,
      score: direct.score,
      source: 'direct_clickable',
    };
  }

  const settings = await markVisibleClickableByText(page, ['settings', '设置', 'more options', '更多'], 'data-crawclaw-redo-menu-trigger');
  if (settings.found) {
    await page.click(settings.selector, { delay: 30 }).catch(() => {});
    await sleep(500);
    const fromMenu = await markVisibleClickableByText(page, [
      'redo video',
      'redo',
      '重做视频',
      '重新生成视频',
      '重新生成',
    ], 'data-crawclaw-redo-entry');
    if (fromMenu.found) {
      return {
        found: true,
        selector: fromMenu.selector,
        label: fromMenu.label,
        score: fromMenu.score,
        source: 'menu_clickable',
      };
    }
    await page.keyboard.press('Escape').catch(() => {});
    await sleep(150);
  }

  return { found: false, selector: '', label: '', score: 0, source: '' };
}

async function detectRedoFinalSubmit(page) {
  const candidate = await markVisibleClickableByText(page, [
    'make video',
    'generate video',
    'submit',
    '生成视频',
    '制作视频',
  ], 'data-crawclaw-redo-final-submit');
  return {
    found: Boolean(candidate.found),
    selector: candidate.selector || '',
    label: candidate.label || '',
    score: candidate.score || 0,
  };
}

async function scanResultUrls(page) {
  const urls = await page.evaluate(() => {
    const found = new Set();
    const push = (value) => {
      if (!value || typeof value !== 'string') {return;}
      const text = value.trim();
      if (!text) {return;}
      if (/https?:\/\/grok\.com\/imagine\/post\//i.test(text)) {found.add(text);}
    };
    push(window.location.href);
    document.querySelectorAll('a[href], [data-href], [data-url], video, source, meta').forEach((node) => {
      push(node.href);
      push(node.src);
      push(node.currentSrc);
      push(node.content);
      push(node.dataset?.href);
      push(node.dataset?.url);
    });
    document.querySelectorAll('script:not([src])').forEach((node) => {
      const text = node.textContent || '';
      const matches = text.match(/https?:\/\/grok\.com\/imagine\/post\/[^\s"'<>]+/gi) || [];
      matches.forEach(push);
    });
    return Array.from(found);
  }).catch(() => []);

  return Array.from(new Set((urls || [])
    .map((item) => String(item || '').trim().replace(/[\\]+$/g, ''))
    .filter((item) => /https?:\/\/grok\.com\/imagine\/post\//i.test(item))));
}

function pickDerivedResultUrl(sourceResultUrl, candidates = []) {
  const cleanSourceUrl = String(sourceResultUrl || '').trim().replace(/[\\]+$/g, '');
  const sourcePostId = extractPostIdFromUrl(cleanSourceUrl);
  for (const candidateRaw of candidates) {
    const candidate = String(candidateRaw || '').trim().replace(/[\\]+$/g, '');
    const postId = extractPostIdFromUrl(candidate);
    if (!postId) {continue;}
    if (sourcePostId && postId === sourcePostId) {continue;}
    if (candidate === cleanSourceUrl) {continue;}
    return candidate;
  }
  return '';
}

async function waitForDerivedResultUrlCapture(page, sourceResultUrl, timeoutMs, logger) {
  const deadline = Date.now() + timeoutMs;
  let lastUrl = String(page.url() || '');
  while (Date.now() <= deadline) {
    const currentUrl = String(page.url() || '');
    if (currentUrl !== lastUrl) {
      logger.info('redo.url_changed', {
        phase: 'redo_capture',
        fromUrl: lastUrl,
        currentUrl,
      });
      lastUrl = currentUrl;
    }
    const candidates = await scanResultUrls(page);
    const derivedUrl = pickDerivedResultUrl(sourceResultUrl, [currentUrl, ...candidates]);
    if (derivedUrl) {return derivedUrl;}
    await sleep(1000);
  }
  return '';
}

function persistDerivedResult(job, {
  actionType,
  checkedAt,
  profile,
  sourceResultUrl,
  newResultUrl,
  note,
}) {
  const lineage = recordLineage(job, {
    actionType,
    sourceResultUrl,
    newResultUrl,
    status: 'submitted',
    checkedAt,
    note,
    lastObservedUrl: newResultUrl,
  });
  const currentLineage = lineage.current || {};
  const payload = {
    ...buildBasePayload(job, profile, sourceResultUrl, checkedAt),
    mode: 'ui_submit',
    status: 'submitted',
    newPostId: currentLineage.newPostId || extractPostIdFromUrl(newResultUrl),
    newResultUrl,
    handoff: {
      required: false,
      note: 'Redo derived result URL recorded. Downstream wait/download can continue on the new post.',
      resumeCommandHint: `node skills/grok-video-web/scripts/grok_video_wait.js --job-id ${job.jobId} --result-url ${JSON.stringify(newResultUrl)}`,
      downstreamSubmitHint: `node skills/grok-video-web/scripts/grok_video_download.js --job-id ${job.jobId} --result-url ${JSON.stringify(newResultUrl)}`,
    },
    lineage: currentLineage,
  };

  writeJson(job.files.redoStatePath, payload);
  writeWorkflowResultUrl(job, newResultUrl);
  clearWorkflowBlockReason(job);
  updateWorkflowStatus(job, {
    status: 'queued',
    blocked: false,
    phase: 'redo_result_recorded',
    currentUrl: newResultUrl,
    resultUrl: newResultUrl,
    actionType,
    sourcePostId: currentLineage.sourcePostId || extractPostIdFromUrl(sourceResultUrl),
    sourceResultUrl,
    newPostId: currentLineage.newPostId || extractPostIdFromUrl(newResultUrl),
    newResultUrl,
    lineage: currentLineage,
  });
  appendWorkflowCheckpoint(job, {
    kind: 'redo_result_recorded',
    step: 'redo',
    status: 'queued',
    url: newResultUrl,
    resultUrl: newResultUrl,
    note,
    actionType,
    lineage: currentLineage,
  });
  updateManifest(job, {
    action: actionType,
    actionType,
    resultUrl: newResultUrl,
    postId: currentLineage.newPostId || extractPostIdFromUrl(newResultUrl),
    redo: {
      checkedAt,
      status: 'submitted',
      sourcePostId: currentLineage.sourcePostId || extractPostIdFromUrl(sourceResultUrl),
      sourceResultUrl,
      newPostId: currentLineage.newPostId || extractPostIdFromUrl(newResultUrl),
      newResultUrl,
    },
    lineage: currentLineage,
  });
  appendGeneratedVideoUrl(job, {
    ts: checkedAt,
    actionType,
    status: 'submitted',
    url: newResultUrl,
    postId: currentLineage.newPostId || extractPostIdFromUrl(newResultUrl),
    sourcePostId: currentLineage.sourcePostId || extractPostIdFromUrl(sourceResultUrl),
    sourceResultUrl,
    jobId: job.jobId,
    profile,
    note,
  });
  return payload;
}

function persistRedoHandoff(job, {
  actionType,
  checkedAt,
  profile,
  sourceResultUrl,
  redoEntry,
  finalSubmit,
  detectOnly,
  noSubmitClick,
  manualHandoffWaitMs,
  headless,
  currentUrl,
  note,
}) {
  const lineage = recordLineage(job, {
    actionType,
    sourceResultUrl,
    status: 'ready_for_manual_handoff',
    checkedAt,
    note,
    lastObservedUrl: currentUrl || sourceResultUrl,
  });
  const currentLineage = lineage.current || {};
  const payload = {
    ...buildBasePayload(job, profile, sourceResultUrl, checkedAt),
    mode: 'manual_handoff',
    status: 'ready_for_manual_handoff',
    newPostId: '',
    newResultUrl: '',
    redoEntry,
    finalSubmit,
    handoff: {
      required: true,
      watching: manualHandoffWaitMs > 0,
      headfulRequiredForHuman: Boolean(manualHandoffWaitMs > 0 && headless),
      note,
      instructions: [
        detectOnly
          ? '这次只做 redo 入口探测，没有执行点击。'
          : '请在同一 grok-web profile 的源 result 页继续完成 redo。',
        noSubmitClick
          ? '脚本未自动点击 final submit；如页面已打开 redo 面板，请人工点击 Make video / 生成视频。'
          : '如果 redo 已打开但没自动拿到 derived URL，请人工确认并点击最终 Make video / 生成视频。',
        manualHandoffWaitMs > 0
          ? (headless
            ? '当前是 headless watching；若要人工接管窗口，请改用 --headful --manual-handoff-wait-sec。'
            : '当前窗口可继续人工接管；保持同页，脚本会继续观察 derived URL。')
          : '如需同页持续观察 derived URL，可重跑并加 --headful --manual-handoff-wait-sec 900。',
      ],
      resumeCommandHint: `node skills/grok-video-web/scripts/grok_video_redo.js --job-id ${job.jobId} --result-url ${JSON.stringify(sourceResultUrl)} --headful --manual-handoff-wait-sec 900`,
      persistDerivedHint: `node skills/grok-video-web/scripts/grok_video_redo.js --job-id ${job.jobId} --result-url ${JSON.stringify(sourceResultUrl)} --new-result-url <derived-result-url>`,
      downstreamSubmitHint: `node skills/grok-video-web/scripts/grok_video_wait.js --job-id ${job.jobId} --result-url <derived-result-url>`,
    },
    lineage: currentLineage,
  };

  writeJson(job.files.redoStatePath, payload);
  updateWorkflowStatus(job, {
    status: 'running',
    blocked: false,
    phase: 'redo_handoff_ready',
    currentUrl: currentUrl || sourceResultUrl,
    resultUrl: sourceResultUrl,
    actionType,
    sourcePostId: currentLineage.sourcePostId || extractPostIdFromUrl(sourceResultUrl),
    sourceResultUrl,
    newPostId: '',
    newResultUrl: '',
    lineage: currentLineage,
  });
  appendWorkflowCheckpoint(job, {
    kind: 'redo_handoff_ready',
    step: 'redo',
    status: 'running',
    url: currentUrl || sourceResultUrl,
    resultUrl: sourceResultUrl,
    note,
    actionType,
    lineage: currentLineage,
  });
  updateManifest(job, {
    action: actionType,
    actionType,
    redo: {
      checkedAt,
      status: payload.status,
      sourcePostId: currentLineage.sourcePostId || extractPostIdFromUrl(sourceResultUrl),
      sourceResultUrl,
      newPostId: '',
      newResultUrl: '',
    },
    lineage: currentLineage,
  });
  return payload;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    usage();
    return;
  }

  if (!args['job-id'] && !args['job-dir'] && !args['result-url']) {
    throw new Error('missing --job-id/--job-dir/--result-url');
  }

  let job;
  if (args['job-id'] || args['job-dir']) {
    job = resolveJob(args);
  } else {
    job = bootstrapStandaloneJob(args['result-url'], args.profile);
  }

  const profile = args.profile || job.profile;
  const sourceResultUrl = resolveSourceResultUrl(job, args['result-url']);
  if (!sourceResultUrl) {
    throw new Error('missing source result URL for redo flow');
  }

  const logger = createLogger(job, { script: 'grok_video_redo' });
  const checkedAt = nowIso();
  const actionType = resolveActionType(job, 'redo_video');
  const newResultUrl = String(args['new-result-url'] || '').trim();
  const submitTimeoutMs = parseNumber(args['submit-timeout-sec'], 45) * 1000;
  const manualHandoffWaitMs = parseNumber(args['manual-handoff-wait-sec'], 0) * 1000;
  const headless = !args.headful;
  const detectOnly = Boolean(args['detect-only']);
  const noSubmitClick = Boolean(args['no-submit-click']);

  logger.info('redo.start', {
    phase: newResultUrl ? 'redo_result_record' : 'redo_prepare',
    sourceResultUrl,
    newResultUrl,
    profile,
    detectOnly,
    noSubmitClick,
    submitTimeoutMs,
    manualHandoffWaitMs,
    headless,
  });

  if (newResultUrl) {
    const payload = persistDerivedResult(job, {
      actionType,
      checkedAt,
      profile,
      sourceResultUrl,
      newResultUrl,
      note: 'Redo flow recorded a new derived result URL.',
    });
    logger.info('redo.finished', {
      status: payload.status,
      phase: 'redo_result_recorded',
      sourceResultUrl,
      resultUrl: newResultUrl,
      path: job.files.redoStatePath,
    });
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  updateWorkflowStatus(job, {
    status: 'running',
    blocked: false,
    phase: 'redo_prepare',
    currentUrl: sourceResultUrl,
    resultUrl: sourceResultUrl,
    actionType,
  });
  clearWorkflowBlockReason(job);
  appendWorkflowCheckpoint(job, {
    kind: 'redo_started',
    step: 'redo',
    status: 'running',
    url: sourceResultUrl,
    resultUrl: sourceResultUrl,
    note: 'Starting redo flow from source result page.',
    actionType,
  });
  updateManifest(job, {
    action: actionType,
    actionType,
    sourceResultUrl,
    redoProfile: profile,
    lastRedoStartedAt: checkedAt,
  });

  let context;
  try {
    const launched = await launchPersistent(resolveProfileDir(profile), {
      downloadsDir: job.downloadsDir,
      headless,
      timeout: 15000,
    });
    context = launched.context;
    const page = launched.page;

    logger.info('redo.browser_launched', {
      phase: 'redo_prepare',
      profile,
      path: launched.profileDir,
      currentUrl: sourceResultUrl,
      resultUrl: sourceResultUrl,
      headless,
    });

    const loginGate = await confirmLoggedInAtSafeEntry({
      page,
      job,
      logger,
      action: 'redo',
    });
    if (!loginGate.ok) {
      const payload = {
        ok: false,
        action: 'redo',
        actionType,
        jobId: job.jobId,
        jobDir: job.jobDir,
        profile,
        sourcePostId: extractPostIdFromUrl(sourceResultUrl),
        sourceResultUrl,
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
        stateFile: job.files.redoStatePath,
      };
      writeJson(job.files.redoStatePath, payload);
      updateWorkflowStatus(job, {
        status: loginGate.status,
        blocked: true,
        phase: 'redo_login_gate_blocked',
        currentUrl: loginGate.currentUrl,
        resultUrl: sourceResultUrl,
        actionType,
      });
      appendWorkflowCheckpoint(job, {
        kind: 'redo_login_gate_blocked',
        step: 'redo',
        status: loginGate.status,
        url: loginGate.currentUrl,
        resultUrl: sourceResultUrl,
        note: `Safe-entry login gate blocked redo flow: ${loginGate.blockerReasonCode}`,
        actionType,
      });
      setWorkflowBlockReason(job, {
        status: loginGate.status,
        reasonCode: loginGate.blockerReasonCode,
        summary: 'Safe-entry login gate blocked redo flow.',
        currentUrl: loginGate.currentUrl,
        matchedSignals: loginGate.signals.cloudflare || loginGate.signals.loggedOut || [],
      });
      console.log(JSON.stringify(payload, null, 2));
      process.exitCode = 4;
      return;
    }

    await gotoResultPage(page, sourceResultUrl);
    await sleep(1200);

    const redoEntry = await detectRedoEntry(page);
    const finalSubmitBefore = await detectRedoFinalSubmit(page);

    if (!redoEntry.found || detectOnly) {
      const payload = persistRedoHandoff(job, {
        actionType,
        checkedAt,
        profile,
        sourceResultUrl,
        redoEntry,
        finalSubmit: finalSubmitBefore,
        detectOnly,
        noSubmitClick,
        manualHandoffWaitMs,
        headless,
        currentUrl: page.url(),
        note: redoEntry.found
          ? 'Redo entry detected. Detect-only mode stopped before clicking.'
          : 'Redo entry not confidently detected; leaving an honest handoff.',
      });
      logger.info('redo.handoff_ready', {
        status: payload.status,
        phase: 'redo_handoff_ready',
        sourceResultUrl,
        currentUrl: page.url(),
        redoEntry,
        finalSubmit: finalSubmitBefore,
        path: job.files.redoStatePath,
      });
      console.log(JSON.stringify(payload, null, 2));
      return;
    }

    await page.click(redoEntry.selector, { delay: 30 }).catch((error) => {
      throw new Error(`redo entry click failed: ${error.message}`);
    });
    logger.info('redo.entry_clicked', {
      phase: 'redo_entry_clicked',
      currentUrl: page.url(),
      sourceResultUrl,
      redoEntry,
    });
    await sleep(1000);

    let finalSubmit = await detectRedoFinalSubmit(page);
    let finalSubmitClicked = false;
    if (finalSubmit.found && !noSubmitClick) {
      await page.click(finalSubmit.selector, { delay: 30 }).catch((error) => {
        throw new Error(`redo final submit click failed: ${error.message}`);
      });
      finalSubmitClicked = true;
      logger.info('redo.final_submit_clicked', {
        phase: 'redo_submit_clicked',
        currentUrl: page.url(),
        sourceResultUrl,
        finalSubmit,
      });
      await sleep(1000);
    } else if (!finalSubmit.found) {
      finalSubmit = finalSubmitBefore;
    }

    const derivedResultUrl = await waitForDerivedResultUrlCapture(page, sourceResultUrl, submitTimeoutMs, logger);
    if (derivedResultUrl) {
      const payload = persistDerivedResult(job, {
        actionType,
        checkedAt: nowIso(),
        profile,
        sourceResultUrl,
        newResultUrl: derivedResultUrl,
        note: finalSubmitClicked
          ? 'Redo UI submit clicked and derived result URL captured.'
          : 'Redo UI clicked and derived result URL captured.',
      });
      payload.redoEntry = redoEntry;
      payload.finalSubmit = { ...finalSubmit, clicked: finalSubmitClicked };
      writeJson(job.files.redoStatePath, payload);
      logger.info('redo.finished', {
        status: payload.status,
        phase: 'redo_result_recorded',
        sourceResultUrl,
        resultUrl: derivedResultUrl,
        redoEntry,
        finalSubmit: payload.finalSubmit,
        path: job.files.redoStatePath,
      });
      console.log(JSON.stringify(payload, null, 2));
      return;
    }

    if (manualHandoffWaitMs > 0) {
      const manualDerivedResultUrl = await waitForDerivedResultUrlCapture(page, sourceResultUrl, manualHandoffWaitMs, logger);
      if (manualDerivedResultUrl) {
        const payload = persistDerivedResult(job, {
          actionType,
          checkedAt: nowIso(),
          profile,
          sourceResultUrl,
          newResultUrl: manualDerivedResultUrl,
          note: 'Redo manual handoff captured derived result URL.',
        });
        payload.redoEntry = redoEntry;
        payload.finalSubmit = { ...finalSubmit, clicked: finalSubmitClicked };
        writeJson(job.files.redoStatePath, payload);
        logger.info('redo.finished', {
          status: payload.status,
          phase: 'redo_result_recorded',
          sourceResultUrl,
          resultUrl: manualDerivedResultUrl,
          redoEntry,
          finalSubmit: payload.finalSubmit,
          path: job.files.redoStatePath,
        });
        console.log(JSON.stringify(payload, null, 2));
        return;
      }
    }

    const handoffPayload = persistRedoHandoff(job, {
      actionType,
      checkedAt: nowIso(),
      profile,
      sourceResultUrl,
      redoEntry,
      finalSubmit: { ...finalSubmit, clicked: finalSubmitClicked },
      detectOnly,
      noSubmitClick,
      manualHandoffWaitMs,
      headless,
      currentUrl: page.url(),
      note: finalSubmitClicked
        ? 'Redo entry/final submit clicked, but no derived result URL was captured within the watch window.'
        : 'Redo entry clicked, but no derived result URL was captured; leaving an honest handoff.',
    });
    logger.info('redo.handoff_ready', {
      status: handoffPayload.status,
      phase: 'redo_handoff_ready',
      sourceResultUrl,
      currentUrl: page.url(),
      redoEntry,
      finalSubmit: handoffPayload.finalSubmit,
      path: job.files.redoStatePath,
    });
    console.log(JSON.stringify(handoffPayload, null, 2));
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
  }
}

main().catch((error) => {
  try {
    const args = parseArgs(process.argv.slice(2));
    let job;
    if (args['job-id'] || args['job-dir']) {
      job = resolveJob(args);
    } else if (args['result-url']) {
      job = bootstrapStandaloneJob(args['result-url'], args.profile);
    }
    if (job) {
      const logger = createLogger(job, { script: 'grok_video_redo' });
      updateWorkflowStatus(job, { status: 'failed', blocked: true, phase: 'redo_failed' });
      appendWorkflowCheckpoint(job, { kind: 'redo_failed', step: 'redo', status: 'failed', note: error.message, actionType: 'redo_video' });
      writeJson(job.files.redoStatePath, {
        ok: false,
        action: 'redo',
        actionType: 'redo_video',
        status: 'failed',
        message: error.message,
        checkedAt: nowIso(),
        stateFile: job.files.redoStatePath,
      });
      logger.error('redo.failed', {
        status: 'failed',
        phase: 'redo_failed',
        message: error.message,
        path: job.files.redoStatePath,
      });
    }
  } catch {}
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
