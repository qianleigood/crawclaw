#!/usr/bin/env node
'use strict';

const {
  appendCheckpoint,
  clearBlockReason,
  ensureStateFiles,
  loadJobContext,
  resolveStateDir,
  setBlockReason,
  updateStatus,
  writeResultUrl,
} = require('../grok_job_state');
const { createJobLogger } = require('../grok_job_logger');

function usage() {
  process.stderr.write(`Usage: grok_video_resume.js <command> [options]\n\n` +
    `Commands:\n` +
    `  init         Initialize resume/checkpoint artifacts.\n` +
    `  checkpoint   Append a checkpoint and optionally update status/result URL.\n` +
    `  block        Persist a blocker, checkpoint it, and mark the job blocked.\n` +
    `  result-url   Persist a latest result page URL for later resume.\n` +
    `  plan         Print a resume plan from current state.\n\n` +
    `Common options:\n` +
    `  --state-dir <path>   Job state dir.\n` +
    `  --job-dir <path>     Job dir; resolves state/ automatically.\n` +
    `  --manifest <path>    state/job.json path.\n\n` +
    `Checkpoint/block options:\n` +
    `  --status <value>     Status to persist.\n` +
    `  --step <value>       Workflow step.\n` +
    `  --url <url>          Current URL.\n` +
    `  --note <text>        Human note.\n` +
    `  --result-url <url>   Result or post URL to persist.\n` +
    `  --reason-code <id>   Block reason code.\n` +
    `  --summary <text>     Block summary.\n` +
    `  --clear-block        Clear prior block-reason.json during checkpoint.\n`);
}

function parseArgs(argv) {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    usage();
    process.exit(0);
  }

  const command = argv[0];
  const args = { command, step: 'unknown_step' };

  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--state-dir':
        args.stateDir = argv[++i];
        break;
      case '--job-dir':
        args.jobDir = argv[++i];
        break;
      case '--manifest':
        args.manifestPath = argv[++i];
        break;
      case '--status':
        args.status = argv[++i];
        break;
      case '--step':
        args.step = argv[++i];
        break;
      case '--url':
        args.url = argv[++i];
        break;
      case '--note':
        args.note = argv[++i];
        break;
      case '--result-url':
        args.resultUrl = argv[++i];
        break;
      case '--reason-code':
        args.reasonCode = argv[++i];
        break;
      case '--summary':
        args.summary = argv[++i];
        break;
      case '--clear-block':
        args.clearBlock = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function checkpointEntry(args, status) {
  return {
    kind: 'checkpoint',
    step: args.step,
    status: status || null,
    url: args.url || '',
    note: args.note || '',
    resultUrl: args.resultUrl || '',
  };
}

function buildResumePlan(context) {
  const status = context.status || {};
  const current = context.checkpoints && context.checkpoints.current ? context.checkpoints.current : null;
  const blockReason = context.blockReason;
  const resultUrl = context.resultUrl || (current && current.resultUrl) || status.resultUrl || '';
  const currentUrl = (current && current.url) || status.currentUrl || '';
  const jobId = context.request.jobId || context.manifest.jobId || null;
  const profile = context.request.profile || context.manifest.profile || null;

  const blocked = Boolean(status.blocked || (status.status || '').startsWith('blocked_') || blockReason);
  const nextUrl = resultUrl || currentUrl || 'https://grok.com';

  const steps = blocked
    ? [
        'Use the same browser profile and the same job workspace. Do not start a fresh parallel run.',
        `Open ${nextUrl} and inspect whether the blocker is gone.`,
        'If a human verification / Cloudflare / Turnstile challenge is still present, stop and wait for a human to solve it. Do not brute-force retries.',
        'Once the blocker is cleared, re-run block detection and only then continue from the last recorded workflow step.',
        'Resume the main executor from the saved checkpoint rather than resubmitting blindly.',
      ]
    : [
        'Reuse the same browser profile and job workspace.',
        `Open ${nextUrl}.`,
        'Inspect current UI state, then continue from the latest checkpointed step.',
      ];

  return {
    ok: true,
    jobId,
    profile,
    stateDir: context.paths.stateDir,
    status: status.status || 'pending',
    blocked,
    blockReason,
    currentCheckpoint: current,
    resultUrl,
    nextUrl,
    canResume: true,
    noBruteRetry: true,
    steps,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const stateDir = resolveStateDir(args);
  const logger = createJobLogger({ script: 'grok_video_resume', stateDir });

  if (args.command === 'init') {
    const paths = ensureStateFiles(stateDir);
    const status = updateStatus(stateDir, {
      status: 'pending',
      blocked: false,
      currentUrl: '',
      resultUrl: '',
    });
    const checkpoint = appendCheckpoint(stateDir, {
      kind: 'init',
      step: 'job_initialized',
      status: status.status,
      note: 'Resume artifacts initialized.',
    });
    logger.info('resume.init', { phase: 'resume_init', status: status.status, path: stateDir });
    process.stdout.write(`${JSON.stringify({ ok: true, stateDir, paths, status, checkpoint }, null, 2)}\n`);
    return;
  }

  if (args.command === 'checkpoint') {
    if (args.clearBlock) {
      clearBlockReason(stateDir);
    }
    if (typeof args.resultUrl === 'string') {
      writeResultUrl(stateDir, args.resultUrl);
    }
    const status = args.status
      ? updateStatus(stateDir, {
          status: args.status,
          blocked: args.status.startsWith('blocked_'),
          currentUrl: args.url || '',
          resultUrl: args.resultUrl || undefined,
        })
      : loadJobContext(stateDir).status;
    const checkpoint = appendCheckpoint(stateDir, checkpointEntry(args, status.status));
    logger.info('resume.checkpoint', {
      phase: args.step,
      status: status.status,
      currentUrl: args.url || '',
      resultUrl: args.resultUrl || '',
      message: args.note || 'Checkpoint recorded.',
    });
    process.stdout.write(`${JSON.stringify({ ok: true, stateDir, status, checkpoint }, null, 2)}\n`);
    return;
  }

  if (args.command === 'block') {
    const statusValue = args.status || 'blocked_human_verification';
    const blockReason = setBlockReason(stateDir, {
      status: statusValue,
      reasonCode: args.reasonCode || statusValue.replace(/^blocked_/, ''),
      summary: args.summary || 'Human intervention required before resume.',
      currentUrl: args.url || '',
      matchedSignals: [],
      recommendedAction: {
        kind: 'human_intervention_required',
        noBruteRetry: true,
        summary: 'Wait for the human to clear the blocker in the same browser profile/tab, then resume from the last checkpoint.',
      },
    });
    const status = updateStatus(stateDir, {
      status: statusValue,
      blocked: true,
      blocker: blockReason,
      currentUrl: args.url || '',
      resultUrl: args.resultUrl || undefined,
    });
    if (typeof args.resultUrl === 'string') {
      writeResultUrl(stateDir, args.resultUrl);
    }
    const checkpoint = appendCheckpoint(stateDir, {
      kind: 'block',
      step: args.step,
      status: statusValue,
      url: args.url || '',
      note: args.note || args.summary || '',
      resultUrl: args.resultUrl || '',
      reasonCode: blockReason.reasonCode,
    });
    logger.warn('resume.blocked', {
      phase: args.step,
      status: statusValue,
      currentUrl: args.url || '',
      resultUrl: args.resultUrl || '',
      reasonCode: blockReason.reasonCode,
      message: blockReason.summary,
    });
    process.stdout.write(`${JSON.stringify({ ok: true, stateDir, status, blockReason, checkpoint }, null, 2)}\n`);
    return;
  }

  if (args.command === 'result-url') {
    if (!args.resultUrl) {
      throw new Error('--result-url is required for result-url command');
    }
    writeResultUrl(stateDir, args.resultUrl);
    const status = updateStatus(stateDir, {
      resultUrl: args.resultUrl,
      currentUrl: args.url || args.resultUrl,
    });
    const checkpoint = appendCheckpoint(stateDir, {
      kind: 'result_url',
      step: args.step === 'unknown_step' ? 'result_url_observed' : args.step,
      status: status.status || null,
      url: args.url || args.resultUrl,
      resultUrl: args.resultUrl,
      note: args.note || 'Persisted result URL for resume.',
    });
    logger.info('resume.result_url_recorded', {
      phase: args.step === 'unknown_step' ? 'result_url_observed' : args.step,
      status: status.status || '',
      currentUrl: args.url || args.resultUrl,
      resultUrl: args.resultUrl,
    });
    process.stdout.write(`${JSON.stringify({ ok: true, stateDir, resultUrl: args.resultUrl, status, checkpoint }, null, 2)}\n`);
    return;
  }

  if (args.command === 'plan') {
    const context = loadJobContext(stateDir);
    const plan = buildResumePlan(context);
    logger.info('resume.plan_generated', {
      phase: 'resume_plan',
      status: plan.status,
      currentUrl: plan.nextUrl,
      resultUrl: plan.resultUrl || '',
      message: plan.blocked ? 'Generated blocked-job resume plan.' : 'Generated normal resume plan.',
    });
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    return;
  }

  throw new Error(`Unsupported command: ${args.command}`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(2);
}
