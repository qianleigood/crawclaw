#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const { parseArgs, readJson, resolveJob, WORKSPACE_ROOT, createLogger } = require('./grok_video_lib');

const SCRIPT_DIR = __dirname;
const PREPARE_SCRIPT = path.join(SCRIPT_DIR, 'prepare_grok_video_job.sh');
const RUN_SCRIPT = path.join(SCRIPT_DIR, 'grok_video_run.js');
const REFERENCE_SCRIPT = path.join(SCRIPT_DIR, 'grok_video_reference_bridge.js');
const SUBMIT_SCRIPT = path.join(SCRIPT_DIR, 'grok_video_submit.js');
const WAIT_SCRIPT = path.join(SCRIPT_DIR, 'grok_video_wait.js');
const DOWNLOAD_SCRIPT = path.join(SCRIPT_DIR, 'grok_video_download.js');

function usage() {
  console.log(`Usage: grok_video_orchestrate.js [options] [-- reference-file ...]\n\nUnified minimum-flow orchestrator:\n  prepare -> run -> reference-bridge -> submit -> wait -> download\n\nOptions:\n  --job-id <id>            Existing or new job id\n  --job-dir <path>         Existing job directory (skips prepare)\n  --prepare                Force prepare step before running\n  --prompt <text>          For prepare step\n  --profile <name>         Browser profile\n  --resolution <value>     For prepare step\n  --duration <value>       For prepare step\n  --aspect-ratio <value>   For prepare step\n  --result-url <url>       Skip real submit; record a known result URL for wait/download\n  --submit-timeout-sec <n> Result-URL capture timeout for submit step\n  --manual-handoff-wait-sec <n> Keep run/submit open for manual takeover while watching same page/profile\n  --no-wait                Stop after submit step\n  --no-download            Stop after wait step\n  --headful                Use visible browser for submit/wait/download\n  --help                   Show this help\n`);
}

function runNode(scriptPath, args, options = {}) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: WORKSPACE_ROOT,
    encoding: 'utf8',
    env: process.env,
    ...options,
  });
  return finalizeResult(path.basename(scriptPath), result);
}

function runShell(scriptPath, args, options = {}) {
  const result = spawnSync(scriptPath, args, {
    cwd: WORKSPACE_ROOT,
    encoding: 'utf8',
    env: process.env,
    ...options,
  });
  return finalizeResult(path.basename(scriptPath), result);
}

function finalizeResult(label, result) {
  const stdout = (result.stdout || '').trim();
  const stderr = (result.stderr || '').trim();
  let parsed = null;
  if (stdout) {
    try {
      parsed = JSON.parse(stdout);
    } catch {
      parsed = null;
    }
  }
  return {
    label,
    ok: (result.status || 0) === 0,
    exitCode: result.status || 0,
    stdout,
    stderr,
    json: parsed,
  };
}

function boolFlag(args, name) {
  return Boolean(args[name]);
}

function buildPrepareArgs(args) {
  const out = [];
  const pairs = [
    ['job-id', args['job-id']],
    ['profile', args.profile],
    ['prompt', args.prompt],
    ['resolution', args.resolution],
    ['duration', args.duration],
    ['aspect-ratio', args['aspect-ratio']],
  ];
  for (const [key, value] of pairs) {
    if (value) {out.push(`--${key}`, value);}
  }
  if (Array.isArray(args._) && args._.length) {
    out.push('--', ...args._);
  }
  return out;
}

function buildJobSelector(args, prepared) {
  if (prepared && prepared.jobId) {
    return ['--job-id', prepared.jobId];
  }
  if (args['job-dir']) {
    return ['--job-dir', args['job-dir']];
  }
  if (args['job-id']) {
    return ['--job-id', args['job-id']];
  }
  throw new Error('missing job selector');
}

function shouldPrepare(args) {
  return boolFlag(args, 'prepare') || Boolean(args.prompt || args.resolution || args.duration || args['aspect-ratio'] || (args._ && args._.length));
}

function logStep(logger, step, result, extra = {}) {
  if (!logger) {return;}
  const level = result.ok ? 'info' : 'error';
  logger[level]('orchestrate.step_finished', {
    status: result.ok ? 'ok' : 'failed',
    phase: step,
    step,
    exitCode: result.exitCode,
    message: result.stderr || result.stdout || '',
    ...extra,
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    usage();
    return;
  }

  const steps = [];
  let prepared = null;
  let logger = null;

  if (!args['job-dir'] && (!args['job-id'] || shouldPrepare(args))) {
    const prepare = runShell(PREPARE_SCRIPT, buildPrepareArgs(args));
    steps.push({ step: 'prepare', ...prepare });
    if (prepare.json && prepare.json.jobId) {
      const preparedJob = resolveJob({ 'job-id': prepare.json.jobId });
      logger = createLogger(preparedJob, { script: 'grok_video_orchestrate' });
      logger.info('orchestrate.step_started', {
        phase: 'prepare',
        step: 'prepare',
        currentUrl: '',
        message: 'Prepared Grok job workspace.',
      });
    }
    logStep(logger, 'prepare', prepare);
    if (!prepare.ok || !prepare.json) {
      console.log(JSON.stringify({ ok: false, failedStep: 'prepare', steps }, null, 2));
      process.exit(prepare.exitCode || 1);
      return;
    }
    prepared = prepare.json;
  }

  const selector = buildJobSelector(args, prepared);
  if (!logger) {
    logger = createLogger(resolveJob(Object.fromEntries([[selector[0].slice(2), selector[1]]])), { script: 'grok_video_orchestrate' });
  }
  logger.info('orchestrate.start', {
    phase: 'orchestrate',
    step: 'orchestrate',
    message: 'Starting end-to-end Grok orchestration.',
  });
  logger.info('orchestrate.step_started', { phase: 'run', step: 'run', message: 'Running prepare/login check.' });
  const runArgs = selector.slice();
  if (args.headful) {runArgs.push('--headed');}
  if (args['manual-handoff-wait-sec']) {runArgs.push('--manual-handoff-wait-sec', args['manual-handoff-wait-sec']);}
  const runStep = runNode(RUN_SCRIPT, runArgs);
  steps.push({ step: 'run', ...runStep });
  logStep(logger, 'run', runStep);
  if (!runStep.ok) {
    console.log(JSON.stringify({ ok: false, failedStep: 'run', steps }, null, 2));
    process.exit(runStep.exitCode || 1);
    return;
  }

  logger.info('orchestrate.step_started', { phase: 'reference', step: 'reference', message: 'Inspecting staged references.' });
  const referenceStep = runNode(REFERENCE_SCRIPT, selector);
  steps.push({ step: 'reference', ...referenceStep });
  logStep(logger, 'reference', referenceStep);
  if (!referenceStep.ok) {
    console.log(JSON.stringify({ ok: false, failedStep: 'reference', steps }, null, 2));
    process.exit(referenceStep.exitCode || 1);
    return;
  }

  const runStatus = runStep.json && runStep.json.status ? String(runStep.json.status) : '';
  const blockedBeforeSubmit = runStatus.startsWith('blocked_');
  const hasSafeBypassForSubmit = Boolean(args['result-url']);

  if (blockedBeforeSubmit && !hasSafeBypassForSubmit) {
    console.log(JSON.stringify({
      ok: true,
      stoppedAfter: 'reference',
      reason: 'run step is blocked; refusing to call submit without an explicit safe bypass such as a known result URL',
      steps,
    }, null, 2));
    return;
  }

  const submitArgs = selector.slice();
  if (args['result-url']) {submitArgs.push('--result-url', args['result-url']);}
  if (args['submit-timeout-sec']) {submitArgs.push('--submit-timeout-sec', args['submit-timeout-sec']);}
  if (args['manual-handoff-wait-sec']) {submitArgs.push('--manual-handoff-wait-sec', args['manual-handoff-wait-sec']);}
  if (args.headful) {submitArgs.push('--headful');}
  logger.info('orchestrate.step_started', { phase: 'submit', step: 'submit', message: 'Recording submit stage.' });
  const submitStep = runNode(SUBMIT_SCRIPT, submitArgs);
  steps.push({ step: 'submit', ...submitStep });
  logStep(logger, 'submit', submitStep);
  if (!submitStep.ok) {
    console.log(JSON.stringify({ ok: false, failedStep: 'submit', steps }, null, 2));
    process.exit(submitStep.exitCode || 1);
    return;
  }

  const submitJson = submitStep.json || {};
  if (blockedBeforeSubmit && !args['result-url']) {
    console.log(JSON.stringify({
      ok: true,
      stoppedAfter: 'submit',
      reason: 'run step is blocked before real submit; placeholder submit recorded only',
      steps,
    }, null, 2));
    return;
  }

  if (submitJson.status === 'awaiting_result_url' || boolFlag(args, 'no-wait')) {
    console.log(JSON.stringify({
      ok: true,
      stoppedAfter: 'submit',
      reason: submitJson.status === 'awaiting_result_url' ? 'submit placeholder needs a result URL before wait/download' : '--no-wait requested',
      steps,
    }, null, 2));
    return;
  }

  const waitArgs = selector.slice();
  if (args['result-url']) {waitArgs.push('--result-url', args['result-url']);}
  if (args['timeout-sec']) {waitArgs.push('--timeout-sec', args['timeout-sec']);}
  if (args['interval-sec']) {waitArgs.push('--interval-sec', args['interval-sec']);}
  if (args.headful) {waitArgs.push('--headful');}
  logger.info('orchestrate.step_started', { phase: 'wait', step: 'wait', message: 'Waiting for result completion.' });
  const waitStep = runNode(WAIT_SCRIPT, waitArgs);
  steps.push({ step: 'wait', ...waitStep });
  logStep(logger, 'wait', waitStep);
  if (!waitStep.ok) {
    console.log(JSON.stringify({ ok: false, failedStep: 'wait', steps }, null, 2));
    process.exit(waitStep.exitCode || 1);
    return;
  }

  if (boolFlag(args, 'no-download')) {
    console.log(JSON.stringify({ ok: true, stoppedAfter: 'wait', reason: '--no-download requested', steps }, null, 2));
    return;
  }

  const downloadArgs = selector.slice();
  if (args['result-url']) {downloadArgs.push('--result-url', args['result-url']);}
  if (args['timeout-sec']) {downloadArgs.push('--timeout-sec', args['timeout-sec']);}
  if (args['interval-sec']) {downloadArgs.push('--interval-sec', args['interval-sec']);}
  if (args['download-timeout-sec']) {downloadArgs.push('--download-timeout-sec', args['download-timeout-sec']);}
  if (args.headful) {downloadArgs.push('--headful');}
  logger.info('orchestrate.step_started', { phase: 'download', step: 'download', message: 'Downloading final artifact.' });
  const downloadStep = runNode(DOWNLOAD_SCRIPT, downloadArgs);
  steps.push({ step: 'download', ...downloadStep });
  logStep(logger, 'download', downloadStep);
  if (!downloadStep.ok) {
    console.log(JSON.stringify({ ok: false, failedStep: 'download', steps }, null, 2));
    process.exit(downloadStep.exitCode || 1);
    return;
  }

  const job = resolveJob(Object.fromEntries([[selector[0].slice(2), selector[1]]]));
  logger.info('orchestrate.finished', {
    status: 'ok',
    phase: 'orchestrate_completed',
    currentUrl: readJson(job.files.statusStatePath, {}).currentUrl || '',
    resultUrl: readJson(job.files.statusStatePath, {}).resultUrl || '',
  });
  console.log(JSON.stringify({
    ok: true,
    jobId: job.jobId,
    jobDir: job.jobDir,
    finalStatus: readJson(job.files.statusStatePath, {}),
    steps,
  }, null, 2));
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
