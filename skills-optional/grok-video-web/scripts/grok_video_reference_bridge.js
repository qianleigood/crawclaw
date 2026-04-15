#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {
  buildExpectedNames,
  runSelfTest,
} = require('./grok_reference_upload');
const {
  nowIso,
  parseArgs,
  readJson,
  resolveJob,
  updateManifest,
  updateWorkflowStatus,
  appendWorkflowCheckpoint,
  writeJson,
  createLogger,
} = require('./grok_video_lib');

function usage() {
  console.log(`Usage: grok_video_reference_bridge.js --job-id <id> [options]\n\nPrepare the reference-upload contract for the Grok workflow without reimplementing upload logic.\n\nOptions:\n  --job-id <id>            Browser job id under runtime/browser-jobs/grok-video-web/\n  --job-dir <path>         Explicit job directory\n  --self-test              Run grok_reference_upload.js self-test\n  --help                   Show this help\n`);
}

function listUploadFiles(dirPath) {
  try {
    return fs.readdirSync(dirPath)
      .map((name) => path.join(dirPath, name))
      .filter((filePath) => {
        try {
          return fs.statSync(filePath).isFile();
        } catch {
          return false;
        }
      })
      .toSorted();
  } catch {
    return [];
  }
}

function summarizeReference(filePath) {
  const stats = fs.statSync(filePath);
  return {
    path: filePath,
    fileName: path.basename(filePath),
    expectedNames: buildExpectedNames({ filePath }),
    size: stats.size,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    usage();
    return;
  }

  if (args['self-test']) {
    const result = await runSelfTest();
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) {process.exitCode = 1;}
    return;
  }

  const job = resolveJob(args);
  const logger = createLogger(job, { script: 'grok_video_reference_bridge' });
  const requestReferences = Array.isArray(job.request.references) ? job.request.references : [];
  const uploadFiles = listUploadFiles(path.join(job.jobDir, 'uploads'));
  const staged = Array.from(new Set([...requestReferences, ...uploadFiles]))
    .filter(Boolean)
    .filter((filePath) => fs.existsSync(filePath));

  const references = staged.map(summarizeReference);
  logger.info('reference.scan_completed', {
    phase: 'reference_probe',
    path: path.join(job.jobDir, 'uploads'),
    referencesCount: references.length,
    message: references.length ? references.map((item) => item.fileName).join(', ') : 'No staged references found.',
  });
  const previousStatus = readJson(job.files.statusStatePath, {}) || {};
  const blocked = Boolean(previousStatus.blocked || String(previousStatus.status || '').startsWith('blocked_'));
  const status = blocked ? previousStatus.status : 'running';
  const phase = references.length ? 'reference_contract_ready' : 'reference_contract_empty';

  const payload = {
    ok: true,
    action: 'reference-bridge',
    checkedAt: nowIso(),
    jobId: job.jobId,
    jobDir: job.jobDir,
    profile: job.profile,
    status: references.length ? 'ready' : 'not_requested',
    referencesCount: references.length,
    references,
    stateFile: job.files.referenceStatePath,
    note: references.length
      ? 'References are staged. Actual browser mounting should reuse grok_reference_upload helpers inside the future submit automation.'
      : 'No references staged for this job.',
  };

  writeJson(job.files.referenceStatePath, payload);
  updateWorkflowStatus(job, {
    status,
    blocked,
    phase,
    referencesCount: references.length,
  });
  appendWorkflowCheckpoint(job, {
    kind: references.length ? 'reference_contract_ready' : 'reference_contract_empty',
    step: 'reference_bridge',
    status,
    note: references.length ? references.map((item) => item.fileName).join(', ') : 'No reference files.',
  });
  updateManifest(job, {
    lastReferenceCheckAt: payload.checkedAt,
    referencesCount: references.length,
    referenceStateFile: job.files.referenceStatePath,
  });
  logger.info('reference.finished', {
    status: payload.status,
    phase,
    path: job.files.referenceStatePath,
    referencesCount: references.length,
  });

  console.log(JSON.stringify(payload, null, 2));
}

main().catch((error) => {
  try {
    const job = resolveJob(parseArgs(process.argv.slice(2)));
    const logger = createLogger(job, { script: 'grok_video_reference_bridge' });
    logger.error('reference.failed', {
      status: 'failed',
      phase: 'reference_probe_failed',
      message: error.message,
      path: job.files.referenceStatePath,
    });
  } catch {}
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
