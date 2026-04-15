#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {
  appendCheckpoint,
  resolveStateDir,
  setBlockReason,
  updateStatus,
} = require('../grok_job_state');
const { createJobLogger } = require('../grok_job_logger');

function usage() {
  process.stderr.write(`Usage: grok_detect_block.js [options]\n\n` +
    `Detect Cloudflare / Turnstile / human-verification blockers from page text and optionally persist job state.\n\n` +
    `Options:\n` +
    `  --state-dir <path>       Job state dir to write status/checkpoint artifacts.\n` +
    `  --job-dir <path>         Job dir; resolves state/ automatically.\n` +
    `  --manifest <path>        state/job.json path.\n` +
    `  --url <url>              Current page URL.\n` +
    `  --title <text>           Page title.\n` +
    `  --step <name>            Logical workflow step. Default: detect_block.\n` +
    `  --source <name>          Detector source label. Default: cli.\n` +
    `  --text <text>            Inline text to inspect.\n` +
    `  --text-file <path>       Text file to inspect.\n` +
    `  --html-file <path>       HTML file to inspect.\n` +
    `  --snapshot-file <path>   Snapshot/JSON/text file to inspect.\n` +
    `  --write-state            Persist status.json, checkpoints.json, block-reason.json.\n` +
    `  --help                   Show this help.\n`);
}

function readFileSafe(filePath) {
  return fs.readFileSync(path.resolve(filePath), 'utf8');
}

function parseArgs(argv) {
  const args = {
    step: 'detect_block',
    source: 'cli',
    writeState: false,
    inputs: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
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
      case '--url':
        args.url = argv[++i];
        break;
      case '--title':
        args.title = argv[++i];
        break;
      case '--step':
        args.step = argv[++i];
        break;
      case '--source':
        args.source = argv[++i];
        break;
      case '--text':
        args.inputs.push({ type: 'inline-text', value: argv[++i] || '' });
        break;
      case '--text-file':
        args.inputs.push({ type: 'text-file', value: readFileSafe(argv[++i]) });
        break;
      case '--html-file':
        args.inputs.push({ type: 'html-file', value: readFileSafe(argv[++i]) });
        break;
      case '--snapshot-file':
        args.inputs.push({ type: 'snapshot-file', value: readFileSafe(argv[++i]) });
        break;
      case '--write-state':
        args.writeState = true;
        break;
      case '--help':
      case '-h':
        usage();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function normalizeText(parts) {
  return parts
    .filter(Boolean)
    .join('\n\n')
    .replace(/\u0000/g, ' ')
    .trim();
}

function detectSignals({ url = '', title = '', combinedText = '' }) {
  const haystack = `${url}\n${title}\n${combinedText}`.toLowerCase();
  const signalGroups = [
    {
      code: 'cloudflare',
      status: 'blocked_cloudflare',
      description: 'Cloudflare anti-bot / challenge page detected',
      patterns: [
        /cloudflare/,
        /attention required/,
        /checking your browser before accessing/,
        /cf[-_ ]?challenge/,
        /challenge-platform/,
        /cf-ray/,
        /cdn-cgi\/challenge-platform/,
      ],
    },
    {
      code: 'turnstile',
      status: 'blocked_turnstile',
      description: 'Cloudflare Turnstile / widget verification detected',
      patterns: [
        /turnstile/,
        /cf[-_ ]?turnstile/,
        /widget containing a cloudflare security challenge/,
      ],
    },
    {
      code: 'human_verification',
      status: 'blocked_human_verification',
      description: 'Human verification / CAPTCHA gate detected',
      patterns: [
        /verify you are human/,
        /verify that you are human/,
        /human verification/,
        /please verify you are human/,
        /prove you are human/,
        /security check/,
        /captcha/,
        /i am human/,
        /are you a human/,
        /unusual traffic/,
      ],
    },
  ];

  const matchedSignals = [];
  for (const group of signalGroups) {
    for (const pattern of group.patterns) {
      const match = haystack.match(pattern);
      if (match) {
        matchedSignals.push({
          code: group.code,
          status: group.status,
          description: group.description,
          match: match[0],
          pattern: String(pattern),
        });
      }
    }
  }

  const priority = ['blocked_cloudflare', 'blocked_turnstile', 'blocked_human_verification'];
  const primary = priority
    .map((status) => matchedSignals.find((signal) => signal.status === status))
    .find(Boolean) || null;

  return {
    blocked: Boolean(primary),
    primary,
    matchedSignals,
  };
}

function recommendedAction(primary) {
  if (!primary) {
    return null;
  }
  return {
    kind: 'human_intervention_required',
    summary: 'Stop automation and wait for a human to clear the verification challenge in the same browser profile/tab, then resume from the latest checkpoint.',
    noBruteRetry: true,
    resumeCommandHint: 'node skills/grok-video-web/scripts/dev/grok_video_resume.js plan --state-dir <state-dir>',
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const combinedText = normalizeText([
    args.title || '',
    ...(args.inputs || []).map((item) => item.value || ''),
  ]);

  const detection = detectSignals({
    url: args.url || '',
    title: args.title || '',
    combinedText,
  });

  const result = {
    ok: true,
    blocked: detection.blocked,
    status: detection.primary ? detection.primary.status : 'clear',
    primaryReason: detection.primary,
    matchedSignals: detection.matchedSignals,
    currentUrl: args.url || '',
    step: args.step,
    source: args.source,
    recommendedAction: recommendedAction(detection.primary),
  };

  const logger = (args.writeState || args.stateDir || args.jobDir || args.manifestPath)
    ? createJobLogger({ script: 'grok_detect_block', stateDir: resolveStateDir(args) })
    : null;
  if (logger) {
    logger[detection.blocked ? 'warn' : 'info']('block.detected', {
      phase: args.step,
      status: result.status,
      currentUrl: args.url || '',
      reasonCode: detection.primary ? detection.primary.code : '',
      matchedSignals: detection.matchedSignals.map((signal) => signal.match),
      message: detection.blocked ? detection.primary.description : 'No blocker signals matched.',
    });
  }

  if (args.writeState) {
    const stateDir = resolveStateDir(args);
    const checkpointBase = {
      kind: detection.blocked ? 'block_detected' : 'block_check_clear',
      step: args.step,
      status: result.status,
      url: args.url || '',
      source: args.source,
      signals: detection.matchedSignals.map((signal) => signal.match),
    };

    if (detection.blocked) {
      updateStatus(stateDir, {
        status: result.status,
        blocked: true,
        blocker: detection.primary,
        recommendedAction: result.recommendedAction,
        currentUrl: args.url || '',
      });
      setBlockReason(stateDir, {
        status: result.status,
        reasonCode: detection.primary.code,
        summary: detection.primary.description,
        currentUrl: args.url || '',
        matchedSignals: detection.matchedSignals,
        recommendedAction: result.recommendedAction,
      });
    } else {
      updateStatus(stateDir, {
        blocked: false,
        lastBlockCheckAt: new Date().toISOString(),
        currentUrl: args.url || '',
      });
    }

    appendCheckpoint(stateDir, checkpointBase);
    result.stateDir = stateDir;
  }

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(2);
}
