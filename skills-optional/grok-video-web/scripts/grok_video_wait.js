#!/usr/bin/env node
'use strict';

const {
  nowIso,
  parseArgs,
  parseNumber,
  resolveJob,
  resolveResultUrl,
  updateManifest,
  updateWorkflowStatus,
  appendWorkflowCheckpoint,
  writeWorkflowResultUrl,
  clearWorkflowBlockReason,
  confirmLoggedInAtSafeEntry,
  setWorkflowBlockReason,
  waitForCompletion,
  resolveResultUrlConsistencyMode,
  writeJson,
  createLogger,
} = require('./grok_video_lib');
const {
  launchPersistent,
  resolveProfileDir,
} = require('./grok_video_common');

function usage() {
  console.log(`Usage: grok_video_wait.js --job-id <id> [options]\n\nWait for a submitted Grok video result page to reach completed/blocked state.\n\nOptions:\n  --job-id <id>            Browser job id under runtime/browser-jobs/grok-video-web/\n  --job-dir <path>         Explicit job directory (alternative to --job-id)\n  --result-url <url>       Explicit Grok result URL; otherwise infer from state/*.json\n  --profile <name>         Browser profile name. Default: from job manifest/request, else grok-web\n  --timeout-sec <n>        Max wait seconds. Default: 900\n  --interval-sec <n>       Poll interval seconds. Default: 8\n  --headful                Launch visible browser instead of headless\n  --no-refresh             Do not reload between polls\n  --help                   Show this help\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    usage();
    return;
  }

  const job = resolveJob(args);
  const logger = createLogger(job, { script: 'grok_video_wait' });
  const timeoutMs = parseNumber(args['timeout-sec'], 900) * 1000;
  const intervalMs = parseNumber(args['interval-sec'], 8) * 1000;
  const resultUrl = resolveResultUrl(job, args['result-url']);
  if (!resultUrl) {
    throw new Error('unable to resolve result URL from --result-url or job state');
  }

  const profile = args.profile || job.profile;
  const headless = !args.headful;
  const refresh = !args['no-refresh'];
  const resultUrlConsistencyMode = resolveResultUrlConsistencyMode(job, args['result-url-mismatch-mode'] || '');

  const startRecord = {
    startedAt: nowIso(),
    action: 'wait',
    jobId: job.jobId,
    jobDir: job.jobDir,
    profile,
    resultUrl,
    timeoutMs,
    intervalMs,
    refresh,
  };
  logger.info('wait.start', {
    phase: 'waiting_for_completion',
    currentUrl: resultUrl,
    resultUrl,
    profile,
    timeoutMs,
    intervalMs,
    refresh,
    resultUrlConsistencyMode,
  });
  writeJson(job.files.waitStatusPath, startRecord);
  updateWorkflowStatus(job, { status: 'running', blocked: false, phase: 'waiting_for_completion', currentUrl: resultUrl, resultUrl });
  clearWorkflowBlockReason(job);
  appendWorkflowCheckpoint(job, { kind: 'wait_started', step: 'wait_for_completion', status: 'running', url: resultUrl, resultUrl, note: 'Started waiting for result completion.' });
  writeWorkflowResultUrl(job, resultUrl);
  updateManifest(job, {
    resultUrl,
    waitProfile: profile,
    lastWaitStartedAt: startRecord.startedAt,
  });

  let context;
  try {
    const launched = await launchPersistent(resolveProfileDir(profile), {
      downloadsDir: job.downloadsDir,
      headless,
      timeout: 15000,
    });
    logger.info('wait.browser_launched', {
      phase: 'waiting_for_completion',
      profile,
      path: launched.profileDir,
      currentUrl: resultUrl,
      resultUrl,
      headless,
    });
    context = launched.context;

    const loginGate = await confirmLoggedInAtSafeEntry({
      page: launched.page,
      job,
      logger,
      action: 'wait',
    });
    if (!loginGate.ok) {
      const payload = {
        ok: false,
        action: 'wait',
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
        waitStateFile: job.files.waitStatusPath,
      };
      writeJson(job.files.waitStatusPath, payload);
      updateWorkflowStatus(job, {
        status: loginGate.status,
        blocked: true,
        phase: 'wait_login_gate_blocked',
        currentUrl: loginGate.currentUrl,
        resultUrl,
        loginState: loginGate.state,
        blockerSignals: loginGate.signals.cloudflare || loginGate.signals.loggedOut || [],
      });
      appendWorkflowCheckpoint(job, {
        kind: 'wait_login_gate_blocked',
        step: 'wait_for_completion',
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
      logger.warn('wait.login_gate_blocked', {
        status: loginGate.status,
        phase: 'wait_login_gate_blocked',
        currentUrl: loginGate.currentUrl,
        resultUrl,
        safeEntryUrl: loginGate.safeEntryUrl,
        matchedSignals: loginGate.signals,
      });
      console.log(JSON.stringify(payload, null, 2));
      process.exitCode = 4;
      return;
    }

    const result = await waitForCompletion({
      page: launched.page,
      job,
      resultUrl,
      timeoutMs,
      intervalMs,
      refresh,
      logger,
      resultUrlConsistencyMode,
    });

    const payload = {
      ok: result.status === 'completed',
      action: 'wait',
      jobId: job.jobId,
      jobDir: job.jobDir,
      profile,
      resultUrl,
      status: result.status,
      completionSignals: result.completionSignals || [],
      blockerSignals: result.blockerSignals || [],
      progressSignals: result.progressSignals || [],
      postId: result.postId || '',
      expectedPostId: result.expectedPostId || '',
      observedPostId: result.observedPostId || result.postId || '',
      observedUrl: result.observedUrl || result.url || resultUrl,
      resultUrlConsistency: result.resultUrlConsistency || null,
      checkedAt: result.checkedAt,
      waitStateFile: job.files.waitStatusPath,
    };
    updateWorkflowStatus(job, {
      status: result.status === 'completed' ? 'completed' : result.status === 'blocked' ? 'blocked_human_verification' : 'generating',
      blocked: result.status === 'blocked',
      phase: result.status === 'completed' ? 'wait_completed' : result.status === 'blocked' ? 'wait_blocked' : 'wait_timeout',
      currentUrl: result.url || resultUrl,
      resultUrl,
      completionSignals: result.completionSignals || [],
      blockerSignals: result.blockerSignals || [],
      progressSignals: result.progressSignals || [],
      postId: result.postId || '',
    });
    appendWorkflowCheckpoint(job, {
      kind: result.status === 'completed' ? 'wait_completed' : result.status === 'blocked' ? 'wait_blocked' : 'wait_timeout',
      step: 'wait_for_completion',
      status: result.status === 'completed' ? 'completed' : result.status === 'blocked' ? 'blocked_human_verification' : 'generating',
      url: result.url || resultUrl,
      resultUrl,
      note: (result.completionSignals || result.blockerSignals || []).join(', '),
    });
    logger[result.status === 'blocked' ? 'warn' : result.status === 'completed' ? 'info' : 'warn']('wait.finished', {
      status: payload.status,
      phase: result.status === 'completed' ? 'wait_completed' : result.status === 'blocked' ? 'wait_blocked' : 'wait_timeout',
      currentUrl: result.url || resultUrl,
      resultUrl,
      completionSignals: payload.completionSignals,
      blockerSignals: payload.blockerSignals,
      postId: payload.postId,
      expectedPostId: payload.expectedPostId,
      observedPostId: payload.observedPostId,
      observedUrl: payload.observedUrl,
      resultUrlConsistency: payload.resultUrlConsistency,
      path: job.files.waitStatusPath,
    });
    console.log(JSON.stringify(payload, null, 2));
    if (result.timeout) {process.exitCode = 3;}
    if (result.status === 'blocked') {process.exitCode = 4;}
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
    const logger = createLogger(job, { script: 'grok_video_wait' });
    updateWorkflowStatus(job, { status: 'failed', blocked: true, phase: 'wait_failed' });
    appendWorkflowCheckpoint(job, { kind: 'wait_failed', step: 'wait_for_completion', status: 'failed', note: error.message });
    logger.error('wait.failed', {
      status: 'failed',
      phase: 'wait_failed',
      currentUrl: resolveResultUrl(job, args['result-url']) || '',
      resultUrl: resolveResultUrl(job, args['result-url']) || '',
      message: error.message,
      path: job.files.waitStatusPath,
    });
  } catch {}
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
