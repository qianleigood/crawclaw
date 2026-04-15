#!/usr/bin/env node
'use strict';

const path = require('path');
const {
  appendGeneratedVideoUrl,
  appendWorkflowCheckpoint,
  clearWorkflowBlockReason,
  confirmLoggedInAtSafeEntry,
  createLogger,
  extractPostIdFromUrl,
  nowIso,
  parseArgs,
  readJson,
  resolveJob,
  resolveActionType,
  resolveResultUrl,
  setWorkflowBlockReason,
  updateManifest,
  recordLineage,
  updateWorkflowStatus,
  writeJson,
  writeWorkflowResultUrl,
  RESULT_URL_RE,
} = require('./grok_video_lib');
const { uploadReferenceImage } = require('./grok_reference_upload');
const {
  collectPageSignals,
  detectLoginStateFromSignals,
  launchPersistent,
  openImaginePage,
  resolveProfileDir,
  sleep,
} = require('./grok_video_common');

function usage() {
  console.log(`Usage: grok_video_submit.js --job-id <id> [options]\n\nSubmit the Grok video workflow on the real Imagine page when login is available, otherwise stop with an honest handoff.\n\nOptions:\n  --job-id <id>            Browser job id under runtime/browser-jobs/grok-video-web/\n  --job-dir <path>         Explicit job directory\n  --result-url <url>       Known Grok result URL (/imagine/post/<id>); records submit state directly\n  --profile <name>         Browser profile name. Default: from job manifest/request, else grok-web\n  --submit-timeout-sec <n> Wait this long for result URL capture after clicking submit. Default: 45\n  --manual-handoff-wait-sec <n> Keep the same page/profile open for manual login/submit while watching for a result URL. Default: 0\n  --headful                Launch visible browser instead of headless\n  --help                   Show this help\n`);
}

function normText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function requestSummary(job) {
  const request = job.request || {};
  const references = Array.isArray(request.references) ? request.references.slice() : [];
  return {
    prompt: String(request.prompt || '').trim(),
    resolution: String(request.resolution || '').trim(),
    duration: String(request.duration || '').trim(),
    aspectRatio: String(request.aspectRatio || '').trim(),
    references,
  };
}

function textTokens(values) {
  return Array.from(new Set((values || []).map((value) => normText(value).toLowerCase()).filter(Boolean)));
}

async function markVisiblePromptTarget(page) {
  return page.evaluate(() => {
    const selectors = [
      'textarea',
      '[contenteditable="true"]',
      '[role="textbox"]',
      'div[contenteditable="plaintext-only"]',
    ];
    const visible = (node) => {
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style && style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };
    document.querySelectorAll('[data-crawclaw-prompt-target]').forEach((node) => node.removeAttribute('data-crawclaw-prompt-target'));
    for (const selector of selectors) {
      const node = Array.from(document.querySelectorAll(selector)).find(visible);
      if (!node) {continue;}
      node.setAttribute('data-crawclaw-prompt-target', '1');
      return {
        found: true,
        selector: '[data-crawclaw-prompt-target="1"]',
        tag: String(node.tagName || '').toLowerCase(),
        role: String(node.getAttribute('role') || ''),
        contenteditable: String(node.getAttribute('contenteditable') || ''),
      };
    }
    return { found: false, selector: '' };
  }).catch(() => ({ found: false, selector: '' }));
}

async function clickVisibleByTexts(page, texts, options = {}) {
  const desired = textTokens(texts);
  if (!desired.length) {return { ok: false, selector: '', label: '', score: 0 };}
  const attr = options.attr || 'data-crawclaw-click-target';
  const exactOnly = Boolean(options.exactOnly);
  const roles = Array.isArray(options.roles) ? options.roles.map((item) => String(item || '').toLowerCase()) : [];

  const candidate = await page.evaluate(({ desired, attr, exactOnly, roles }) => {
    const visible = (node) => {
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style && style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };
    const norm = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
    document.querySelectorAll(`[${attr}]`).forEach((node) => node.removeAttribute(attr));
    const nodes = Array.from(document.querySelectorAll('button, a, [role="button"], [role="tab"], [role="radio"], [role="option"], input[type="button"], input[type="submit"]'));
    const scored = [];
    for (const node of nodes) {
      if (!visible(node)) {continue;}
      const role = norm(node.getAttribute('role'));
      if (roles.length && !roles.includes(role)) {continue;}
      const text = norm(node.getAttribute('aria-label') || node.getAttribute('title') || node.innerText || node.textContent || node.value || '');
      if (!text) {continue;}
      let score = 0;
      for (const token of desired) {
        if (text === token) {score = Math.max(score, 100 + token.length);}
        else if (!exactOnly && text.includes(token)) {score = Math.max(score, 50 + token.length);}
      }
      if (!score) {continue;}
      if (/(primary|accent|selected|active|checked)/i.test(String(node.className || ''))) {score += 3;}
      if (node.getAttribute('aria-selected') === 'true' || node.getAttribute('aria-checked') === 'true' || node.getAttribute('aria-pressed') === 'true') {score += 2;}
      if (node.hasAttribute('disabled') || node.getAttribute('aria-disabled') === 'true') {score -= 1000;}
      scored.push({ node, text, score });
    }
    scored.sort((a, b) => b.score - a.score);
    const top = scored[0];
    if (!top) {return { found: false, selector: '', label: '', score: 0 };}
    top.node.setAttribute(attr, '1');
    return {
      found: true,
      selector: `[${attr}="1"]`,
      label: top.text,
      score: top.score,
    };
  }, { desired, attr, exactOnly, roles }).catch(() => ({ found: false, selector: '', label: '', score: 0 }));

  if (!candidate.found) {return { ok: false, selector: '', label: '', score: 0 };}
  try {
    await page.click(candidate.selector, { delay: options.delayMs || 30 });
    return { ok: true, selector: candidate.selector, label: candidate.label, score: candidate.score };
  } catch (error) {
    return { ok: false, selector: candidate.selector, label: candidate.label, score: candidate.score, note: error.message };
  }
}

async function ensureVideoMode(page, logger) {
  const clicked = await clickVisibleByTexts(page, ['视频', 'Video'], {
    attr: 'data-crawclaw-video-mode',
  });
  await sleep(800);
  const probe = await page.evaluate(() => {
    const texts = Array.from(document.querySelectorAll('button, [role="button"], [role="tab"], [role="radio"]'))
      .map((node) => ({
        text: String(node.innerText || node.textContent || '').trim(),
        selected: [
          String(node.getAttribute('aria-pressed') || '').toLowerCase(),
          String(node.getAttribute('aria-selected') || '').toLowerCase(),
          String(node.getAttribute('aria-checked') || '').toLowerCase(),
          String(node.getAttribute('data-state') || '').toLowerCase(),
          String(node.className || '').toLowerCase(),
        ].join(' '),
      }));
    const hit = texts.find((item) => ['视频', 'video'].includes(item.text.toLowerCase()));
    const sideSignals = /480p|720p|6s|10s|宽高比|aspect ratio/i.test(document.body?.innerText || '');
    return {
      found: Boolean(hit),
      selected: Boolean(hit && /true|selected|active|checked|on/.test(hit.selected)) || sideSignals,
      text: hit ? hit.text : '',
    };
  }).catch(() => ({ found: false, selected: false, text: '' }));

  if (!clicked.ok && logger) {
    logger.debug('submit.video_mode_click_missed', { phase: 'video_mode', probe });
  }
  return {
    ok: Boolean(clicked.ok || probe.selected),
    clicked: Boolean(clicked.ok),
    selector: clicked.selector || '',
    signal: probe,
  };
}

async function revealSettingsPanel(page) {
  const clicked = await clickVisibleByTexts(page, ['设置', 'Settings'], {
    attr: 'data-crawclaw-settings-toggle',
  });
  if (clicked.ok) {
    await sleep(500);
  }
  return clicked;
}

async function selectSetting(page, value) {
  const normalized = normText(value);
  if (!normalized) {
    return { requested: '', ok: true, applied: false, note: 'not_requested' };
  }

  let clicked = await clickVisibleByTexts(page, [normalized], {
    attr: 'data-crawclaw-setting-target',
  });
  if (clicked.ok) {
    return {
      requested: normalized,
      ok: true,
      applied: true,
      selector: clicked.selector || '',
      note: 'clicked',
    };
  }

  const settingsToggle = await revealSettingsPanel(page);
  if (settingsToggle.ok) {
    clicked = await clickVisibleByTexts(page, [normalized], {
      attr: 'data-crawclaw-setting-target',
    });
    if (clicked.ok) {
      return {
        requested: normalized,
        ok: true,
        applied: true,
        selector: clicked.selector || '',
        note: 'clicked_after_settings_open',
      };
    }
  }

  return {
    requested: normalized,
    ok: false,
    applied: false,
    selector: clicked.selector || settingsToggle.selector || '',
    note: settingsToggle.ok ? 'not_visible_after_settings_open' : 'not_visible',
  };
}

async function fillPrompt(page, prompt, logger) {
  const target = await markVisiblePromptTarget(page);
  if (!target.found) {
    return { ok: false, selector: '', note: 'prompt_input_not_found' };
  }
  const value = normText(prompt);
  if (!value) {
    return { ok: false, selector: target.selector, note: 'prompt_empty' };
  }

  try {
    await page.focus(target.selector).catch(() => {});
    const writeResult = await page.evaluate(({ selector, value }) => {
      const node = document.querySelector(selector);
      if (!node) {return { ok: false, probe: '', note: 'node_missing' };}
      node.focus?.();
      if ('value' in node) {
        node.value = value;
        node.dispatchEvent(new Event('input', { bubbles: true }));
        node.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        node.textContent = value;
        node.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }));
      }
      const probe = String(node.value || node.textContent || node.innerText || '').trim();
      return { ok: Boolean(probe), probe, note: probe ? 'prompt_written' : 'prompt_probe_empty' };
    }, { selector: target.selector, value });
    return {
      ok: Boolean(writeResult.ok),
      selector: target.selector,
      note: writeResult.note,
      valueExcerpt: String(writeResult.probe || '').slice(0, 120),
    };
  } catch (error) {
    logger.warn('submit.prompt_fill_failed', {
      phase: 'submit_prepare',
      selector: target.selector,
      message: error.message,
    });
    return { ok: false, selector: target.selector, note: error.message };
  }
}

async function uploadViaPuppeteerInput(page, filePath, inputSelector) {
  const input = await page.$(inputSelector);
  if (!input) {throw new Error(`file_input_not_found:${inputSelector}`);}
  await input.uploadFile(filePath);
}

async function mountReferences(page, references, logger) {
  const results = [];
  for (const filePath of references) {
    const absolute = path.resolve(filePath);
    const payload = await uploadReferenceImage(page, {
      filePath: absolute,
      logger,
      timeoutMs: 15000,
      intervalMs: 400,
      requireUsable: false,
      settleMs: 400,
      performUpload: async ({ inputSelector, filePath: localFilePath }) => {
        await uploadViaPuppeteerInput(page, localFilePath, inputSelector);
      },
    }).catch((error) => ({
      ok: false,
      phase: 'mounted',
      error: error.message,
      summary: null,
      strength: 'none',
      upload: { method: 'failed', inputSelector: 'input[type="file"]' },
    }));
    results.push({
      filePath: absolute,
      fileName: path.basename(absolute),
      ok: Boolean(payload.ok),
      phase: payload.phase || '',
      strength: payload.strength || '',
      upload: payload.upload || null,
      note: payload.note || payload.error || '',
      summary: payload.summary || null,
    });
    if (!payload.ok) {break;}
  }
  return results;
}

async function detectSubmitCandidate(page) {
  return page.evaluate(() => {
    const visible = (node) => {
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style && style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };
    const norm = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    document.querySelectorAll('[data-crawclaw-grok-submit]').forEach((node) => node.removeAttribute('data-crawclaw-grok-submit'));
    const nodes = Array.from(document.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"], a[role="button"]'));
    const skipPatterns = [/sign in/i, /log in/i, /登录/, /注册/, /download/i, /下载/, /share/i, /共享/, /extend/i, /延长/, /redo/i];
    const positivePatterns = [/generate/i, /create/i, /submit/i, /生成视频/, /生成/, /创建/, /制作/];
    const ranked = [];
    for (const node of nodes) {
      if (!visible(node)) {continue;}
      const label = norm(node.getAttribute('aria-label') || node.getAttribute('title') || node.innerText || node.textContent || node.value || '');
      if (!label) {continue;}
      if (skipPatterns.some((pattern) => pattern.test(label))) {continue;}
      let score = 0;
      if (positivePatterns.some((pattern) => pattern.test(label))) {score += 10;}
      if (node.getAttribute('type') === 'submit') {score += 8;}
      if (String(node.className || '').match(/primary|accent|submit|confirm|generate|create/i)) {score += 3;}
      const disabled = node.hasAttribute('disabled') || node.getAttribute('aria-disabled') === 'true';
      if (disabled) {score -= 20;}
      if (score <= 0) {continue;}
      ranked.push({ node, label, disabled, score });
    }
    ranked.sort((a, b) => b.score - a.score);
    const top = ranked[0];
    if (!top) {
      return { found: false, disabled: false, label: '', selector: '', score: 0 };
    }
    top.node.setAttribute('data-crawclaw-grok-submit', '1');
    return {
      found: true,
      disabled: Boolean(top.disabled),
      label: top.label,
      selector: '[data-crawclaw-grok-submit="1"]',
      score: top.score,
    };
  }).catch(() => ({ found: false, disabled: false, label: '', selector: '', score: 0 }));
}

async function captureResultUrl(page) {
  const direct = String(page.url() || '').match(RESULT_URL_RE);
  if (direct) {return direct[0];}
  return page.evaluate(() => {
    const text = document.body?.innerText || '';
    const html = document.documentElement?.outerHTML || '';
    const hrefs = Array.from(document.querySelectorAll('a[href], [data-href], [data-url]'))
      .map((node) => node.href || node.getAttribute('data-href') || node.getAttribute('data-url') || '')
      .filter(Boolean)
      .join('\n');
    const combined = `${text}\n${html}\n${hrefs}`;
    const match = combined.match(/https?:\/\/grok\.com\/imagine\/post\/[^\s"'<>]+/i);
    return match ? match[0] : '';
  }).catch(() => '');
}

async function waitForResultUrlCapture(page, timeoutMs, logger) {
  const deadline = Date.now() + timeoutMs;
  let lastUrl = page.url();
  while (Date.now() <= deadline) {
    const currentUrl = page.url();
    if (currentUrl !== lastUrl) {
      logger.info('submit.url_changed', {
        phase: 'submit_capture',
        fromUrl: lastUrl,
        currentUrl,
      });
      lastUrl = currentUrl;
    }
    const resultUrl = await captureResultUrl(page);
    if (resultUrl) {return resultUrl;}
    await sleep(1000);
  }
  return '';
}

function buildSubmitHandoff({ job, profile, checkedAt, blocker, readiness, manualHandoffWatchMs, headless, currentUrl, submitClicked, resultUrl = '' }) {
  const watching = manualHandoffWatchMs > 0;
  return {
    ok: true,
    action: 'submit_manual_handoff',
    jobId: job.jobId,
    jobDir: job.jobDir,
    profile,
    checkedAt,
    status: resultUrl
      ? 'captured'
      : watching
        ? (headless ? 'watching_headless' : 'watching_headful')
        : 'ready_for_manual_handoff',
    blockerStatus: blocker.status,
    blockerReasonCode: blocker.reasonCode,
    loginState: blocker.loginState || '',
    currentUrl: currentUrl || blocker.currentUrl || '',
    resultUrl,
    submitClicked: Boolean(submitClicked),
    readiness,
    capture: {
      active: watching,
      timeoutMs: manualHandoffWatchMs,
      headfulRequiredForHuman: Boolean(watching && headless),
    },
    instructions: resultUrl
      ? [
          '新的 Grok result URL 已在同一 handoff 链路中捕获，可以直接继续 wait/download。',
          `继续沿用同 job：node skills/grok-video-web/scripts/grok_video_wait.js --job-id ${job.jobId} --result-url ${JSON.stringify(resultUrl)}`,
        ]
      : [
          blocker.reasonCode === 'login_required'
            ? '请在当前打开的同一 grok-web profile 页面完成登录，然后继续在同页完成 prompt / 参数 / submit。'
            : '请继续在当前打开的同一页面补足必要人工动作（如确认登录、检查参数、点击 submit），不要切换 profile。',
          watching
            ? (headless
              ? '当前 run 是 headless watching，人工无法直接接管窗口；若要人工操作，请改用 --headful --manual-handoff-wait-sec <seconds>。'
              : '当前 run 已在 headful watching；保持这个窗口打开，脚本会持续尝试捕获新的 /imagine/post/<id>。')
            : '这次 run 只落盘了 handoff 状态，不会继续保持窗口；若要让人工在同页接管并让脚本持续捕获 result URL，请重跑：--headful --manual-handoff-wait-sec <seconds>。',
          submitClicked
            ? '脚本已经尝试点过 submit；优先观察页面跳转或新结果页 URL。'
            : '如果当前页面已就绪，可由人工在同页点最终 submit。',
        ],
    resumeCommandHint: `node skills/grok-video-web/scripts/grok_video_submit.js --job-id ${job.jobId} --headful --manual-handoff-wait-sec 900`,
    downstreamWaitHint: `node skills/grok-video-web/scripts/grok_video_wait.js --job-id ${job.jobId} --result-url <result-url>`,
    stateFile: job.files.submitHandoffPath || path.join(job.stateDir, 'submit-handoff.json'),
  };
}

async function watchManualSubmitHandoff({ page, job, profile, checkedAt, blocker, readiness, manualHandoffWatchMs, headless, logger, submitClicked }) {
  const handoffPath = job.files.submitHandoffPath || path.join(job.stateDir, 'submit-handoff.json');
  let handoff = buildSubmitHandoff({
    job,
    profile,
    checkedAt,
    blocker,
    readiness,
    manualHandoffWatchMs,
    headless,
    currentUrl: page.url(),
    submitClicked,
  });
  writeJson(handoffPath, handoff);
  logger.info('submit.manual_handoff_wait_started', {
    phase: 'submit_handoff_watch',
    currentUrl: page.url(),
    timeoutMs: manualHandoffWatchMs,
    stateFile: handoffPath,
  });

  const deadline = Date.now() + manualHandoffWatchMs;
  let lastObserved = {
    currentUrl: page.url(),
    loginState: blocker.loginState || '',
    matchedSignals: blocker.matchedSignals || [],
  };

  while (Date.now() <= deadline) {
    const resultUrl = await captureResultUrl(page);
    if (resultUrl) {
      handoff = buildSubmitHandoff({
        job,
        profile,
        checkedAt,
        blocker,
        readiness,
        manualHandoffWatchMs,
        headless,
        currentUrl: page.url(),
        submitClicked,
        resultUrl,
      });
      writeJson(handoffPath, handoff);
      logger.info('submit.manual_handoff_captured', {
        phase: 'submit_handoff_captured',
        currentUrl: page.url(),
        resultUrl,
        stateFile: handoffPath,
      });
      return {
        captured: true,
        resultUrl,
        currentUrl: page.url(),
        handoff,
      };
    }

    await sleep(1500);
    if (page.isClosed()) {break;}

    const pageSignals = await collectPageSignals(page);
    const login = detectLoginStateFromSignals(pageSignals);
    writeJson(job.files.loginStatePath, {
      checkedAt: nowIso(),
      loginState: login.state,
      signals: login.signals,
      page: {
        url: pageSignals.url,
        title: pageSignals.title,
        bodyText: pageSignals.bodyTextShort,
        buttonTexts: pageSignals.buttonTexts || [],
        linkTexts: pageSignals.linkTexts || [],
        inputPlaceholders: pageSignals.inputPlaceholders || [],
      },
    });
    lastObserved = {
      currentUrl: pageSignals.url,
      loginState: login.state,
      matchedSignals: login.signals.cloudflare || login.signals.loggedOut || [],
    };
  }

  const timedOut = {
    ...buildSubmitHandoff({
      job,
      profile,
      checkedAt,
      blocker: {
        ...blocker,
        loginState: lastObserved.loginState || blocker.loginState,
        currentUrl: lastObserved.currentUrl || blocker.currentUrl,
        matchedSignals: lastObserved.matchedSignals || blocker.matchedSignals,
      },
      readiness,
      manualHandoffWatchMs,
      headless,
      currentUrl: lastObserved.currentUrl || blocker.currentUrl,
      submitClicked,
    }),
    status: 'watch_timed_out',
    timedOutAt: nowIso(),
  };
  writeJson(handoffPath, timedOut);
  logger.warn('submit.manual_handoff_wait_timed_out', {
    phase: 'submit_handoff_watch_timed_out',
    currentUrl: timedOut.currentUrl,
    stateFile: handoffPath,
  });
  return {
    captured: false,
    resultUrl: '',
    currentUrl: timedOut.currentUrl,
    handoff: timedOut,
  };
}

function buildBlockedPayload(job, checkedAt, currentStatus, block) {
  return {
    ok: false,
    action: 'submit',
    mode: 'blocked_handoff',
    checkedAt,
    jobId: job.jobId,
    jobDir: job.jobDir,
    profile: job.profile,
    submitted: false,
    status: block.status,
    resultUrl: '',
    note: block.note,
    blocker: block,
    currentStatus,
    stateFile: job.files.submitStatePath,
    actionType: resolveActionType(job),
  };
}

async function recordSuccessfulSubmit(job, checkedAt, payload) {
  const actionType = resolveActionType(job, payload.actionType);
  const lineage = recordLineage(job, {
    actionType,
    newResultUrl: payload.resultUrl,
    extendDuration: payload.extendDuration || '',
    timelineMode: payload.timelineMode || '',
    status: 'submitted',
    checkedAt,
    note: payload.note,
    lastObservedUrl: payload.currentUrl || payload.resultUrl,
  });
  const currentLineage = lineage.current || {};

  writeWorkflowResultUrl(job, payload.resultUrl);
  updateWorkflowStatus(job, {
    status: 'queued',
    blocked: false,
    phase: 'submitted',
    currentUrl: payload.resultUrl,
    resultUrl: payload.resultUrl,
    submitted: true,
    submittedAt: checkedAt,
    postId: payload.postId,
    referencesCount: payload.referencesCount,
    actionType,
    sourcePostId: currentLineage.sourcePostId || '',
    sourceResultUrl: currentLineage.sourceResultUrl || '',
    newPostId: currentLineage.newPostId || payload.postId || '',
    newResultUrl: currentLineage.newResultUrl || payload.resultUrl,
    lineage: currentLineage,
  });
  appendWorkflowCheckpoint(job, {
    kind: 'submitted',
    step: 'submit',
    status: 'queued',
    url: payload.resultUrl,
    resultUrl: payload.resultUrl,
    note: payload.note,
    actionType,
    lineage: currentLineage,
  });
  clearWorkflowBlockReason(job);
  updateManifest(job, {
    action: actionType,
    actionType,
    resultUrl: payload.resultUrl,
    postId: payload.postId,
    submittedAt: checkedAt,
    lastKnownStatus: 'queued',
    lastSubmitReady: payload.readiness,
    submitEngine: 'puppeteer',
    lineage: currentLineage,
  });
  appendGeneratedVideoUrl(job, {
    ts: checkedAt,
    actionType,
    status: 'submitted',
    url: payload.resultUrl,
    postId: currentLineage.newPostId || payload.postId,
    sourcePostId: currentLineage.sourcePostId || '',
    sourceResultUrl: currentLineage.sourceResultUrl || '',
    jobId: job.jobId,
    profile: job.profile,
    note: 'submit flow captured result URL on first write',
  });
}

function recordBlockedSubmit(job, checkedAt, payload) {
  const actionType = resolveActionType(job, payload.actionType);
  const lineage = recordLineage(job, {
    actionType,
    status: payload.status,
    checkedAt,
    note: payload.note,
    lastObservedUrl: payload.blocker.currentUrl || '',
  });
  const currentLineage = lineage.current || {};

  writeJson(job.files.submitStatePath, {
    ...payload,
    actionType,
    lineage: currentLineage,
  });
  if (payload.handoff) {
    writeJson(job.files.submitHandoffPath || path.join(job.stateDir, 'submit-handoff.json'), payload.handoff);
  }
  updateWorkflowStatus(job, {
    status: payload.status,
    blocked: true,
    phase: 'submit_blocked',
    submitted: false,
    currentUrl: payload.blocker.currentUrl || '',
    loginState: payload.blocker.loginState || '',
    actionType,
    sourcePostId: currentLineage.sourcePostId || '',
    sourceResultUrl: currentLineage.sourceResultUrl || '',
    newPostId: currentLineage.newPostId || '',
    newResultUrl: currentLineage.newResultUrl || '',
    lineage: currentLineage,
    handoff: payload.handoff ? {
      status: payload.handoff.status,
      stateFile: payload.handoff.stateFile,
    } : undefined,
  });
  appendWorkflowCheckpoint(job, {
    kind: 'submit_blocked',
    step: 'submit',
    status: payload.status,
    url: payload.blocker.currentUrl || '',
    note: payload.note,
    actionType,
    lineage: currentLineage,
  });
  setWorkflowBlockReason(job, {
    status: payload.status,
    reasonCode: payload.blocker.reasonCode,
    summary: payload.note,
    currentUrl: payload.blocker.currentUrl || '',
    matchedSignals: payload.blocker.matchedSignals || [],
  });
  updateManifest(job, {
    action: actionType,
    actionType,
    lastSubmitBlockedAt: checkedAt,
    lastSubmitReady: payload.currentStatus || {},
    submitEngine: 'puppeteer',
    lineage: currentLineage,
  });
}

async function runAutomatedSubmit(job, args) {
  const logger = createLogger(job, { script: 'grok_video_submit' });
  const checkedAt = nowIso();
  const profile = args.profile || job.profile;
  const profileDir = resolveProfileDir(profile);
  const headless = !args.headful;
  const submitTimeoutMs = Math.max(5, Number(args['submit-timeout-sec'] || 45)) * 1000;
  const manualHandoffWatchMs = Math.max(0, Number(args['manual-handoff-wait-sec'] || 0)) * 1000;
  const request = requestSummary(job);
  const currentStatus = readJson(job.files.statusStatePath, {}) || {};
  const referenceState = readJson(job.files.referenceStatePath, {}) || {};

  logger.info('submit.start', {
    phase: 'submit_prepare',
    currentUrl: currentStatus.currentUrl || '',
    resultUrl: '',
    blocked: Boolean(currentStatus.blocked),
    promptLength: request.prompt.length,
    referencesCount: request.references.length,
    engine: 'puppeteer',
  });

  updateWorkflowStatus(job, {
    status: 'running',
    blocked: false,
    phase: 'submit_prepare',
    currentUrl: currentStatus.currentUrl || '',
  });
  appendWorkflowCheckpoint(job, {
    kind: 'submit_started',
    step: 'submit',
    status: 'running',
    note: 'Starting real Grok submit attempt via Puppeteer-first path.',
  });

  let context;
  try {
    const launched = await launchPersistent(profileDir, {
      headless,
      timeout: 15000,
    });
    context = launched.context;
    const page = launched.page;
    logger.info('submit.browser_launched', {
      phase: 'submit_prepare',
      profile,
      path: launched.profileDir,
      headless,
      engine: launched.engine,
    });

    const loginGate = await confirmLoggedInAtSafeEntry({
      page,
      job,
      logger,
      action: 'submit',
    });

    if (!loginGate.ok) {
      const blocker = {
        status: loginGate.status,
        reasonCode: loginGate.blockerReasonCode,
        loginState: loginGate.state,
        currentUrl: loginGate.currentUrl,
        matchedSignals: loginGate.state === 'not_logged_in' ? loginGate.signals.loggedOut : loginGate.signals.cloudflare,
        note: loginGate.state === 'not_logged_in'
          ? 'Grok profile is not logged in at the safe entry. Human must sign in on the same profile before submit can continue.'
          : 'Login state could not be confirmed cleanly at the safe entry. Human verification is required before submit.',
      };
      const watched = manualHandoffWatchMs > 0
        ? await watchManualSubmitHandoff({
            page,
            job,
            profile,
            checkedAt,
            blocker,
            readiness: currentStatus,
            manualHandoffWatchMs,
            headless,
            logger,
            submitClicked: false,
          })
        : null;
      if (watched && watched.captured) {
        const payload = {
          ok: true,
          action: 'submit',
          mode: 'manual_handoff_capture',
          checkedAt,
          jobId: job.jobId,
          jobDir: job.jobDir,
          profile,
          submitted: true,
          status: 'submitted',
          resultUrl: watched.resultUrl,
          postId: extractPostIdFromUrl(watched.resultUrl),
          currentUrl: watched.currentUrl || watched.resultUrl,
          referencesCount: request.references.length,
          effective: {
            prompt: request.prompt,
            resolution: request.resolution || '',
            duration: request.duration || '',
            aspectRatio: request.aspectRatio || '',
            references: request.references,
          },
          readiness: currentStatus,
          note: 'Manual handoff kept the same page/profile open and captured the result URL.',
          stateFile: job.files.submitStatePath,
          actionType: resolveActionType(job),
          handoff: watched.handoff,
          engine: 'puppeteer',
        };
        writeJson(job.files.submitStatePath, payload);
        await recordSuccessfulSubmit(job, checkedAt, payload);
        return payload;
      }
      const payload = buildBlockedPayload(job, checkedAt, currentStatus, blocker);
      if (watched && watched.handoff) {
        payload.handoff = watched.handoff;
        payload.note = `${payload.note} Handoff state: ${watched.handoff.status}.`;
      }
      recordBlockedSubmit(job, checkedAt, payload);
      logger.warn('submit.blocked', {
        status: blocker.status,
        phase: watched ? 'submit_handoff_blocked' : 'submit_blocked',
        currentUrl: (watched && watched.currentUrl) || blocker.currentUrl,
        reasonCode: blocker.reasonCode,
        matchedSignals: blocker.matchedSignals,
      });
      return payload;
    }

    await openImaginePage(page);
    const login = {
      state: 'logged_in',
      signals: loginGate.signals,
    };

    const videoMode = await ensureVideoMode(page, logger);
    const promptFill = await fillPrompt(page, request.prompt, logger);
    const resolution = await selectSetting(page, request.resolution);
    const duration = await selectSetting(page, request.duration);
    const aspectRatio = await selectSetting(page, request.aspectRatio);
    const references = request.references.length
      ? await mountReferences(page, request.references, logger)
      : [];
    const submitCandidate = await detectSubmitCandidate(page);

    const readiness = {
      loginState: login.state,
      videoMode,
      prompt: promptFill,
      resolution,
      duration,
      aspectRatio,
      referencesRequested: request.references.length,
      referenceBridgeStatus: referenceState.status || '',
      references,
      submitCandidate,
      engine: 'puppeteer',
    };

    const allReferencesMounted = references.every((item) => item.ok);
    const ready = Boolean(videoMode.ok)
      && Boolean(promptFill.ok)
      && (!request.references.length || allReferencesMounted)
      && Boolean(submitCandidate.found)
      && !submitCandidate.disabled;

    if (!ready) {
      const blocker = {
        status: 'blocked_human_verification',
        reasonCode: 'pre_submit_gate_failed',
        loginState: login.state,
        currentUrl: page.url(),
        matchedSignals: [],
        note: 'Pre-submit gate failed. At least one of video mode / prompt / references / submit button is not ready.',
      };
      const watched = manualHandoffWatchMs > 0
        ? await watchManualSubmitHandoff({
            page,
            job,
            profile,
            checkedAt,
            blocker,
            readiness,
            manualHandoffWatchMs,
            headless,
            logger,
            submitClicked: false,
          })
        : null;
      if (watched && watched.captured) {
        const payload = {
          ok: true,
          action: 'submit',
          mode: 'manual_handoff_capture',
          checkedAt,
          jobId: job.jobId,
          jobDir: job.jobDir,
          profile,
          submitted: true,
          status: 'submitted',
          resultUrl: watched.resultUrl,
          postId: extractPostIdFromUrl(watched.resultUrl),
          currentUrl: watched.currentUrl || watched.resultUrl,
          referencesCount: request.references.length,
          effective: {
            prompt: request.prompt,
            resolution: request.resolution || '',
            duration: request.duration || '',
            aspectRatio: request.aspectRatio || '',
            references: request.references,
          },
          readiness,
          note: 'Manual handoff completed the submit path and captured the result URL.',
          stateFile: job.files.submitStatePath,
          actionType: resolveActionType(job),
          handoff: watched.handoff,
          engine: 'puppeteer',
        };
        writeJson(job.files.submitStatePath, payload);
        await recordSuccessfulSubmit(job, checkedAt, payload);
        return payload;
      }
      const payload = buildBlockedPayload(job, checkedAt, readiness, blocker);
      if (watched && watched.handoff) {
        payload.handoff = watched.handoff;
        payload.note = `${payload.note} Handoff state: ${watched.handoff.status}.`;
      }
      recordBlockedSubmit(job, checkedAt, payload);
      logger.warn('submit.pre_submit_gate_failed', {
        status: blocker.status,
        phase: watched ? 'submit_handoff_blocked' : 'submit_blocked',
        currentUrl: (watched && watched.currentUrl) || blocker.currentUrl,
        readiness,
      });
      return payload;
    }

    await page.click(submitCandidate.selector, { delay: 30 });
    logger.info('submit.clicked', {
      phase: 'submit_clicked',
      currentUrl: page.url(),
      label: submitCandidate.label,
      selector: submitCandidate.selector,
      score: submitCandidate.score,
      engine: 'puppeteer',
    });

    const resultUrl = await waitForResultUrlCapture(page, submitTimeoutMs, logger);
    if (!resultUrl) {
      const blocker = {
        status: 'blocked_human_verification',
        reasonCode: 'result_url_not_captured',
        loginState: login.state,
        currentUrl: page.url(),
        matchedSignals: [],
        note: 'Submit click was attempted, but no Grok result URL was captured within the timeout. Keep the same page/profile for human follow-up.',
      };
      const watched = manualHandoffWatchMs > 0
        ? await watchManualSubmitHandoff({
            page,
            job,
            profile,
            checkedAt,
            blocker,
            readiness,
            manualHandoffWatchMs,
            headless,
            logger,
            submitClicked: true,
          })
        : null;
      if (watched && watched.captured) {
        const payload = {
          ok: true,
          action: 'submit',
          mode: 'manual_handoff_capture',
          checkedAt,
          jobId: job.jobId,
          jobDir: job.jobDir,
          profile,
          submitted: true,
          status: 'submitted',
          resultUrl: watched.resultUrl,
          postId: extractPostIdFromUrl(watched.resultUrl),
          currentUrl: watched.currentUrl || watched.resultUrl,
          referencesCount: request.references.length,
          effective: {
            prompt: request.prompt,
            resolution: request.resolution || '',
            duration: request.duration || '',
            aspectRatio: request.aspectRatio || '',
            references: request.references,
          },
          readiness,
          note: 'Submit click did not capture immediately, but manual handoff later captured the result URL on the same page/profile.',
          stateFile: job.files.submitStatePath,
          actionType: resolveActionType(job),
          handoff: watched.handoff,
          engine: 'puppeteer',
        };
        writeJson(job.files.submitStatePath, payload);
        await recordSuccessfulSubmit(job, checkedAt, payload);
        return payload;
      }
      const payload = buildBlockedPayload(job, checkedAt, readiness, blocker);
      payload.submitClicked = true;
      if (watched && watched.handoff) {
        payload.handoff = watched.handoff;
        payload.note = `${payload.note} Handoff state: ${watched.handoff.status}.`;
      }
      recordBlockedSubmit(job, checkedAt, payload);
      logger.warn('submit.capture_timeout', {
        status: blocker.status,
        phase: watched ? 'submit_handoff_blocked' : 'submit_capture_timeout',
        currentUrl: (watched && watched.currentUrl) || blocker.currentUrl,
        readiness,
      });
      return payload;
    }

    const payload = {
      ok: true,
      action: 'submit',
      mode: 'ui_submit',
      checkedAt,
      jobId: job.jobId,
      jobDir: job.jobDir,
      profile,
      submitted: true,
      status: 'submitted',
      resultUrl,
      postId: extractPostIdFromUrl(resultUrl),
      currentUrl: page.url(),
      referencesCount: request.references.length,
      effective: {
        prompt: request.prompt,
        resolution: request.resolution || '',
        duration: request.duration || '',
        aspectRatio: request.aspectRatio || '',
        references: request.references,
      },
      readiness,
      note: 'Real UI submit succeeded and result URL was captured immediately.',
      stateFile: job.files.submitStatePath,
      actionType: resolveActionType(job),
      engine: 'puppeteer',
    };

    writeJson(job.files.submitStatePath, payload);
    await recordSuccessfulSubmit(job, checkedAt, payload);
    logger.info('submit.finished', {
      status: payload.status,
      phase: 'submitted',
      currentUrl: payload.currentUrl,
      resultUrl: payload.resultUrl,
      path: job.files.submitStatePath,
      engine: 'puppeteer',
    });
    return payload;
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    usage();
    return;
  }

  const job = resolveJob(args);
  const logger = createLogger(job, { script: 'grok_video_submit' });
  const currentStatus = readJson(job.files.statusStatePath, {}) || {};
  const explicitResultUrl = resolveResultUrl(job, args['result-url']);
  const checkedAt = nowIso();

  if (explicitResultUrl) {
    logger.info('submit.start', {
      phase: 'submit',
      currentUrl: currentStatus.currentUrl || '',
      resultUrl: explicitResultUrl,
      blocked: Boolean(currentStatus.blocked),
    });
    logger.info('submit.result_url_recorded', {
      status: 'queued',
      phase: 'submitted',
      resultUrl: explicitResultUrl,
      currentUrl: explicitResultUrl,
    });
    const payload = {
      ok: true,
      action: 'submit',
      mode: 'explicit_result_url',
      checkedAt,
      jobId: job.jobId,
      jobDir: job.jobDir,
      profile: job.profile,
      submitted: true,
      status: 'submitted',
      resultUrl: explicitResultUrl,
      postId: extractPostIdFromUrl(explicitResultUrl),
      note: 'Submit step recorded from an explicit result URL. Wait/download can continue.',
      stateFile: job.files.submitStatePath,
      actionType: resolveActionType(job),
      engine: 'puppeteer',
    };
    writeJson(job.files.submitStatePath, payload);
    await recordSuccessfulSubmit(job, checkedAt, payload);
    logger.info('submit.finished', {
      status: payload.status,
      phase: payload.mode,
      currentUrl: payload.resultUrl,
      resultUrl: payload.resultUrl,
      path: job.files.submitStatePath,
    });
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  const payload = await runAutomatedSubmit(job, args);
  console.log(JSON.stringify(payload, null, 2));
  if (!payload.ok) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  try {
    const args = parseArgs(process.argv.slice(2));
    const job = resolveJob(args);
    const logger = createLogger(job, { script: 'grok_video_submit' });
    updateWorkflowStatus(job, { status: 'failed', blocked: true, phase: 'submit_failed' });
    appendWorkflowCheckpoint(job, { kind: 'submit_failed', step: 'submit', status: 'failed', note: error.message });
    setWorkflowBlockReason(job, {
      status: 'failed',
      reasonCode: 'submit_failed',
      summary: error.message,
      currentUrl: '',
      matchedSignals: [],
    });
    logger.error('submit.failed', {
      status: 'failed',
      phase: 'submit_failed',
      message: error.message,
      path: job.files.submitStatePath,
    });
  } catch {}
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
