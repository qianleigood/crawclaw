#!/usr/bin/env node
const path = require('path');
const {
  ROOT,
  DEFAULT_PROFILE,
  nowIso,
  arg,
  hasFlag,
  loadJobBundle,
  resolveProfileName,
  resolveProfileDir,
  updateManifest,
  saveRuntimeState,
  checkpoint,
  launchPersistent,
  openSafeEntryPage,
  openImaginePage,
  collectPageSignals,
  resolveLoginState,
  summarizeRequest,
  saveJson,
} = require('./grok_video_common');
const {
  updateWorkflowStatus,
  appendWorkflowCheckpoint,
  clearWorkflowBlockReason,
  setWorkflowBlockReason,
} = require('./grok_video_lib');
const { createJobLogger } = require('./grok_job_logger');

function usage() {
  console.log(`Usage: grok_video_run.js --job-id <id> [options]\n\nOpen Grok Imagine with the job-owned browser profile, classify login/blocking state, and persist runtime handoff state.\n\nOptions:\n  --job-id <id>                 Browser job id under runtime/browser-jobs/grok-video-web/\n  --job-dir <path>              Explicit job directory\n  --profile <name>              Browser profile override\n  --headless                    Launch headless browser\n  --headed                      Launch visible browser (default)\n  --timeout-ms <n>              Browser default timeout in milliseconds. Default: 45000\n  --manual-handoff-wait-sec <n> Keep the same page/profile open for manual login while re-checking state\n  --help                        Show this help\n`);
}

function buildRunHandoff({ bundle, profile, startedAt, currentUrl, loginState, status, phase, blockers, timeoutMs, headless, resolved }) {
  const watching = timeoutMs > 0;
  return {
    ok: true,
    action: 'login_manual_handoff',
    jobId: bundle.manifest.jobId,
    jobDir: bundle.jobDir,
    profile,
    checkedAt: nowIso(),
    startedAt,
    status: resolved
      ? 'resolved_logged_in'
      : watching
        ? (headless ? 'watching_headless' : 'watching_headful')
        : 'ready_for_manual_login',
    blockerStatus: status,
    phase,
    loginState,
    blockers,
    currentUrl,
    capture: {
      active: watching,
      timeoutMs,
      headfulRequiredForHuman: Boolean(watching && headless),
    },
    instructions: resolved
      ? [
          '同一 profile 的登录态已在本次 handoff watch 期间恢复，可以直接继续 submit。',
          `继续沿用同 job：node skills/grok-video-web/scripts/grok_video_submit.js --job-id ${bundle.manifest.jobId}`,
        ]
      : [
          '请使用同一个 grok-web profile 在当前打开的 Grok Imagine 页完成登录，不要切换到别的 profile。',
          watching
            ? (headless
              ? '当前 run 是 headless watching，人工无法直接接管窗口；若要人工登录，请改用 --headful --manual-handoff-wait-sec <seconds>。'
              : '当前 run 已在 headful watching；保持这个窗口打开，人工完成登录后脚本会自动重检登录态。')
            : '这次 run 只落盘了 handoff 状态，不会继续保持窗口；若要让人手接管并让脚本持续重检，请重跑：--headful --manual-handoff-wait-sec <seconds>。',
          '不要新建另一套 job；登录完成后优先继续用同 job / 同 profile 往下跑 submit。',
        ],
    resumeCommandHint: `node skills/grok-video-web/scripts/grok_video_run.js --job-id ${bundle.manifest.jobId} --headful --manual-handoff-wait-sec 900`,
    downstreamSubmitHint: `node skills/grok-video-web/scripts/grok_video_submit.js --job-id ${bundle.manifest.jobId}`,
    stateFile: path.join(bundle.stateDir, 'run-handoff.json'),
  };
}

function persistBlockedState({ bundle, logger, status, phase, login, pageSignals, blockers, profile, handoff }) {
  logger.warn('run.blocked', {
    status,
    phase,
    reasonCode: blockers[0] || 'blocked',
    currentUrl: pageSignals.url,
    matchedSignals: login.signals,
  });
  setWorkflowBlockReason(bundle, {
    status,
    reasonCode: blockers[0] || 'blocked',
    summary: blockers[0] || 'Workflow blocked before submit.',
    currentUrl: pageSignals.url,
    matchedSignals: login.signals.cloudflare || [],
  });
  updateWorkflowStatus(bundle, {
    status,
    blocked: true,
    phase,
    currentUrl: pageSignals.url,
    loginState: login.state,
    blockers,
    pageTitle: pageSignals.title,
    handoff: handoff ? {
      status: handoff.status,
      stateFile: handoff.stateFile,
    } : undefined,
  });
  appendWorkflowCheckpoint(bundle, {
    kind: 'run_blocked',
    step: 'prepare_and_login_check',
    status,
    url: pageSignals.url,
    note: blockers.join(', ') || 'Blocked before submit.',
  });
  updateManifest(bundle.manifestPath, {
    profile,
    runner: {
      status,
      phase,
      finishedAt: nowIso(),
      lastHeartbeatAt: nowIso(),
      loginState: login.state,
      blockers,
      page: {
        url: pageSignals.url,
        title: pageSignals.title,
      },
      signalSummary: login.signals,
      handoff: handoff || null,
    },
  });
  saveJson(path.join(bundle.stateDir, 'run-handoff.json'), handoff || {});
}

function persistReadyState({ bundle, logger, status, phase, login, pageSignals, blockers, profile, handoff }) {
  const finishedAt = nowIso();
  logger.info('run.ready_for_submit', {
    status,
    phase,
    currentUrl: pageSignals.url,
  });
  clearWorkflowBlockReason(bundle);
  updateWorkflowStatus(bundle, {
    status,
    blocked: false,
    phase,
    currentUrl: pageSignals.url,
    loginState: login.state,
    blockers,
    pageTitle: pageSignals.title,
  });
  appendWorkflowCheckpoint(bundle, {
    kind: 'run_ready',
    step: 'prepare_and_login_check',
    status,
    url: pageSignals.url,
    note: 'Ready for submit.',
  });
  updateManifest(bundle.manifestPath, {
    profile,
    runner: {
      status,
      phase,
      finishedAt,
      lastHeartbeatAt: finishedAt,
      loginState: login.state,
      blockers,
      page: {
        url: pageSignals.url,
        title: pageSignals.title,
      },
      signalSummary: login.signals,
      handoff: handoff || null,
    },
  });
  if (handoff) {
    saveJson(path.join(bundle.stateDir, 'run-handoff.json'), handoff);
  }
}

async function watchLoginHandoff({ page, bundle, profile, startedAt, timeoutMs, headless, logger }) {
  const handoffPath = path.join(bundle.stateDir, 'run-handoff.json');
  const watchingPayload = buildRunHandoff({
    bundle,
    profile,
    startedAt,
    currentUrl: page.url(),
    loginState: 'not_logged_in',
    status: 'blocked_login_required',
    phase: 'login_handoff_watch',
    blockers: ['login_required'],
    timeoutMs,
    headless,
    resolved: false,
  });
  saveJson(handoffPath, watchingPayload);
  logger.info('run.manual_handoff_wait_started', {
    phase: 'login_handoff_watch',
    currentUrl: page.url(),
    timeoutMs,
    headless,
    stateFile: handoffPath,
  });

  const deadline = Date.now() + timeoutMs;
  let lastSignals = null;
  while (Date.now() <= deadline) {
    await page.waitForTimeout(2000).catch(() => {});
    if (page.isClosed()) {break;}
    const loginProbe = await resolveLoginState(page, {
      skipSafeEntryOpen: true,
      allowImagineFallback: true,
    });
    const pageSignals = loginProbe.pageSignals;
    const login = loginProbe.login;
    lastSignals = { pageSignals, login, loginProbe };
    saveJson(bundle.loginStatePath, {
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
        localStorageKeys: pageSignals.localStorageKeys || [],
      },
    });
    if (login.state === 'logged_in') {
      const resolvedHandoff = buildRunHandoff({
        bundle,
        profile,
        startedAt,
        currentUrl: pageSignals.url,
        loginState: login.state,
        status: 'running',
        phase: 'ready_for_submit',
        blockers: [],
        timeoutMs,
        headless,
        resolved: true,
      });
      saveJson(handoffPath, resolvedHandoff);
      logger.info('run.manual_handoff_resolved', {
        phase: 'ready_for_submit',
        currentUrl: pageSignals.url,
        stateFile: handoffPath,
      });
      return {
        resolved: true,
        pageSignals,
        login,
        handoff: resolvedHandoff,
      };
    }
  }

  const fallbackProbe = lastSignals ? null : await resolveLoginState(page, {
    skipSafeEntryOpen: true,
    allowImagineFallback: true,
  });
  const pageSignals = lastSignals ? lastSignals.pageSignals : fallbackProbe.pageSignals;
  const login = lastSignals ? lastSignals.login : fallbackProbe.login;
  const timedOutPayload = {
    ...buildRunHandoff({
      bundle,
      profile,
      startedAt,
      currentUrl: pageSignals.url,
      loginState: login.state,
      status: login.state === 'not_logged_in' ? 'blocked_login_required' : 'blocked_human_verification',
      phase: 'login_handoff_watch_timed_out',
      blockers: [login.state === 'not_logged_in' ? 'login_required' : 'login_state_uncertain'],
      timeoutMs,
      headless,
      resolved: false,
    }),
    status: 'watch_timed_out',
    timedOutAt: nowIso(),
  };
  saveJson(handoffPath, timedOutPayload);
  logger.warn('run.manual_handoff_wait_timed_out', {
    phase: 'login_handoff_watch_timed_out',
    currentUrl: pageSignals.url,
    stateFile: handoffPath,
  });
  return {
    resolved: false,
    pageSignals,
    login,
    handoff: timedOutPayload,
  };
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    usage();
    return;
  }

  const startedAt = nowIso();
  const jobDir = arg('--job-dir', null);
  const jobId = arg('--job-id', null);
  const cliProfile = arg('--profile', null);
  const headless = hasFlag('--headless') ? true : hasFlag('--headed') ? false : false;
  const timeoutMs = Number(arg('--timeout-ms', '45000'));
  const manualHandoffWatchMs = Math.max(0, Number(arg('--manual-handoff-wait-sec', '0'))) * 1000;

  const bundle = loadJobBundle({ jobDir, jobId, workspaceRoot: ROOT });
  const requestSummary = summarizeRequest(bundle.request);
  const profile = resolveProfileName(bundle, cliProfile) || DEFAULT_PROFILE;
  const profileDir = resolveProfileDir(profile);
  const logger = createJobLogger({
    script: 'grok_video_run',
    stateDir: bundle.stateDir,
    jobDir: bundle.jobDir,
    jobId: bundle.manifest.jobId,
    profile,
    eventsPath: bundle.eventsPath,
  });

  logger.info('run.start', {
    message: 'Starting Grok runtime preparation and login check.',
    phase: 'boot',
    jobDir: bundle.jobDir,
    requestPath: bundle.requestPath,
    profile,
  });

  checkpoint(bundle, {
    phase: 'boot',
    jobId: bundle.manifest.jobId,
    jobDir: bundle.jobDir,
    requestFile: bundle.requestPath,
    profile,
  });

  updateWorkflowStatus(bundle, { status: 'running', blocked: false, phase: 'prepare_and_login_check', currentUrl: '', resultUrl: '' });
  clearWorkflowBlockReason(bundle);
  appendWorkflowCheckpoint(bundle, { kind: 'run_started', step: 'prepare_and_login_check', status: 'running', note: 'Starting Grok browser runtime preparation.' });

  updateManifest(bundle.manifestPath, {
    profile,
    runner: {
      entrypoint: path.relative(ROOT, __filename),
      status: 'running',
      startedAt,
      lastHeartbeatAt: startedAt,
      requestSummary,
      artifacts: {
        runtimeState: bundle.runtimeStatePath,
        loginState: bundle.loginStatePath,
        checkpoints: bundle.checkpointsPath,
        runHandoff: path.join(bundle.stateDir, 'run-handoff.json'),
      },
      profileDir,
    },
  });

  saveRuntimeState(bundle.runtimeStatePath, {
    schemaVersion: 1,
    jobId: bundle.manifest.jobId,
    skill: bundle.manifest.skill,
    status: 'running',
    startedAt,
    updatedAt: startedAt,
    profile,
    profileDir,
    request: requestSummary,
    outputs: {
      checkpoints: bundle.checkpointsPath,
      loginState: bundle.loginStatePath,
      runHandoff: path.join(bundle.stateDir, 'run-handoff.json'),
    },
    todo: [
      'real submit step lives in grok_video_submit.js and should continue from this checkpoint',
      'reference bridge/upload should run before submit when this job carries staged media',
      'wait/download should continue only after a concrete /imagine/post/<id> result URL is captured',
      'Cloudflare / Turnstile challenges still require same-profile human handoff',
    ],
  });

  let context = null;
  try {
    const launched = await launchPersistent(profileDir, { headless, timeout: timeoutMs });
    context = launched.context;
    const page = launched.page;
    const pages = typeof context.pages === 'function' ? await context.pages().catch(() => []) : [];

    logger.info('run.browser_launched', {
      phase: 'browser_launched',
      profile,
      path: profileDir,
      pageCount: pages.length,
      headless,
      engine: launched.engine || 'puppeteer',
    });

    checkpoint(bundle, {
      phase: 'browser_launched',
      profile,
      profileDir,
      headless,
      pageCount: pages.length,
      engine: launched.engine || 'puppeteer',
    });

    const beforeSafeEntryUrl = page.url();
    const safeEntryUrl = await openSafeEntryPage(page);
    logger.info('run.safe_entry_opened', {
      phase: 'safe_entry_opened',
      fromUrl: beforeSafeEntryUrl,
      currentUrl: safeEntryUrl,
    });
    checkpoint(bundle, {
      phase: 'safe_entry_opened',
      url: safeEntryUrl,
    });

    const loginProbe = await resolveLoginState(page, {
      skipSafeEntryOpen: true,
      allowImagineFallback: true,
    });
    let pageSignals = loginProbe.pageSignals;
    let login = loginProbe.login;

    saveJson(bundle.loginStatePath, {
      checkedAt: nowIso(),
      loginState: login.state,
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
    });

    logger.info('run.login_state_detected', {
      phase: 'login_state_detected',
      status: login.state,
      source: loginProbe.source,
      currentUrl: pageSignals.url,
      title: pageSignals.title,
      matchedSignals: login.signals,
      safeEntrySignals: loginProbe.safeEntry?.login?.signals || {},
      imagineProbeSignals: loginProbe.imagineProbe?.login?.signals || {},
    });
    checkpoint(bundle, {
      phase: 'login_state_detected',
      loginState: login.state,
      source: loginProbe.source,
      url: pageSignals.url,
      title: pageSignals.title,
      signals: login.signals,
    });

    let blockers = [];
    let status = 'running';
    let phase = 'ready_for_submit';
    if (login.state === 'not_logged_in') {
      status = 'blocked_login_required';
      phase = 'login_required';
      blockers.push('login_required');
    } else if (login.state === 'uncertain') {
      status = login.signals.cloudflare.length ? 'blocked_cloudflare' : 'blocked_human_verification';
      phase = 'login_state_uncertain';
      blockers.push(login.signals.cloudflare.length ? 'cloudflare_or_human_verification' : 'login_state_uncertain');
    }

    let handoff = null;
    if (status.startsWith('blocked_') && manualHandoffWatchMs > 0) {
      updateWorkflowStatus(bundle, {
        status,
        blocked: true,
        phase: 'login_handoff_watch',
        currentUrl: pageSignals.url,
        loginState: login.state,
        blockers,
        pageTitle: pageSignals.title,
      });
      appendWorkflowCheckpoint(bundle, {
        kind: 'run_handoff_started',
        step: 'prepare_and_login_check',
        status,
        url: pageSignals.url,
        note: 'Started manual login handoff watch.',
      });
      const watched = await watchLoginHandoff({
        page,
        bundle,
        profile,
        startedAt,
        timeoutMs: manualHandoffWatchMs,
        headless,
        logger,
      });
      handoff = watched.handoff;
      pageSignals = watched.pageSignals;
      login = watched.login;
      if (watched.resolved) {
        status = 'running';
        phase = 'ready_for_submit';
        blockers = [];
      }
    } else if (status.startsWith('blocked_')) {
      handoff = buildRunHandoff({
        bundle,
        profile,
        startedAt,
        currentUrl: pageSignals.url,
        loginState: login.state,
        status,
        phase,
        blockers,
        timeoutMs: manualHandoffWatchMs,
        headless,
        resolved: false,
      });
      saveJson(path.join(bundle.stateDir, 'run-handoff.json'), handoff);
    }

    if (status === 'running') {
      const alreadyOnImagine = /https:\/\/grok\.com\/imagine/i.test(page.url());
      const imagineUrl = alreadyOnImagine ? page.url() : await openImaginePage(page);
      logger.info('run.imagine_opened', {
        phase: 'imagine_opened_after_safe_entry',
        currentUrl: imagineUrl,
        source: alreadyOnImagine ? 'secondary_probe' : 'post_safe_entry_navigation',
      });
      checkpoint(bundle, {
        phase: 'imagine_opened_after_safe_entry',
        url: imagineUrl,
      });
      pageSignals = await collectPageSignals(page);
    }

    const finishedAt = nowIso();
    const runtimeState = saveRuntimeState(bundle.runtimeStatePath, {
      status,
      phase,
      updatedAt: finishedAt,
      finishedAt,
      loginState: login.state,
      blockers,
      page: {
        url: pageSignals.url,
        title: pageSignals.title,
      },
      signalSummary: login.signals,
      handoff,
      checkpoint: {
        stage: 'post_login_detection',
        imagineOpened: true,
        requestLoaded: true,
      },
      nextAction:
        status === 'running'
          ? 'submission flow can continue from this checkpoint'
          : 'human action required before submission flow can continue',
    });

    if (status.startsWith('blocked_')) {
      persistBlockedState({ bundle, logger, status, phase, login, pageSignals, blockers, profile, handoff });
    } else {
      persistReadyState({ bundle, logger, status, phase, login, pageSignals, blockers, profile, handoff });
    }

    logger.info('run.finished', {
      status,
      phase,
      currentUrl: pageSignals.url,
      blockers,
      path: bundle.runtimeStatePath,
    });
    checkpoint(bundle, {
      phase: 'finished',
      status,
      loginState: login.state,
      blockers,
    });

    console.log(
      JSON.stringify(
        {
          ok: !status.startsWith('failed'),
          jobId: bundle.manifest.jobId,
          profile,
          profileDir,
          status,
          loginState: login.state,
          blockers,
          pageUrl: pageSignals.url,
          runtimeStateFile: bundle.runtimeStatePath,
          loginStateFile: bundle.loginStatePath,
          runHandoffFile: path.join(bundle.stateDir, 'run-handoff.json'),
          checkpointsFile: bundle.checkpointsPath,
          request: requestSummary,
          phase,
          handoff,
          todo: runtimeState.todo,
        },
        null,
        2
      )
    );
  } catch (error) {
    const failedAt = nowIso();
    logger.error('run.failed', {
      status: 'failed',
      phase: 'run_failed',
      message: error.message,
      path: bundle.runtimeStatePath,
    });
    checkpoint(bundle, {
      phase: 'error',
      error: error.message,
    });
    updateWorkflowStatus(bundle, { status: 'failed', blocked: true, phase: 'run_failed' });
    appendWorkflowCheckpoint(bundle, { kind: 'run_failed', step: 'prepare_and_login_check', status: 'failed', note: error.message });
    setWorkflowBlockReason(bundle, { status: 'failed', reasonCode: 'run_failed', summary: error.message, currentUrl: '' });
    saveRuntimeState(bundle.runtimeStatePath, {
      status: 'failed',
      updatedAt: failedAt,
      finishedAt: failedAt,
      error: {
        message: error.message,
        stack: error.stack,
      },
    });
    updateManifest(bundle.manifestPath, {
      runner: {
        status: 'failed',
        finishedAt: failedAt,
        lastHeartbeatAt: failedAt,
        error: {
          message: error.message,
        },
      },
    });
    console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
    process.exitCode = 1;
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
  }
}

main();
