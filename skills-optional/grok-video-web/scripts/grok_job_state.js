#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_STATUS = 'pending';

function timestamp() {
  return new Date().toISOString();
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJsonIfExists(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return fallback;
    }
    throw error;
  }
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeText(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${value ?? ''}\n`, 'utf8');
}

function resolveStateDir(options = {}) {
  const { stateDir, jobDir, manifestPath } = options;
  if (stateDir) {
    return path.resolve(stateDir);
  }
  if (jobDir) {
    return path.resolve(jobDir, 'state');
  }
  if (manifestPath) {
    const manifest = readJsonIfExists(path.resolve(manifestPath));
    if (manifest && manifest.stateDir) {
      return path.resolve(manifest.stateDir);
    }
    return path.dirname(path.resolve(manifestPath));
  }
  throw new Error('stateDir/jobDir/manifestPath is required');
}

function statePaths(stateDir) {
  const resolved = path.resolve(stateDir);
  return {
    stateDir: resolved,
    manifestPath: path.join(resolved, 'job.json'),
    requestPath: path.join(resolved, 'request.json'),
    statusPath: path.join(resolved, 'status.json'),
    checkpointsPath: path.join(resolved, 'checkpoints.json'),
    blockReasonPath: path.join(resolved, 'block-reason.json'),
    resultUrlPath: path.join(resolved, 'result-url.txt'),
    eventsPath: path.join(resolved, 'events.jsonl'),
  };
}

function ensureStateFiles(stateDir) {
  const paths = statePaths(stateDir);
  ensureDir(paths.stateDir);

  if (!fs.existsSync(paths.checkpointsPath)) {
    writeJson(paths.checkpointsPath, {
      version: 1,
      updatedAt: timestamp(),
      current: null,
      history: [],
    });
  }

  if (!fs.existsSync(paths.statusPath)) {
    writeJson(paths.statusPath, {
      version: 1,
      updatedAt: timestamp(),
      status: DEFAULT_STATUS,
      blocked: false,
      checkpointCount: 0,
    });
  }

  if (!fs.existsSync(paths.resultUrlPath)) {
    writeText(paths.resultUrlPath, '');
  }

  return paths;
}

function loadJobContext(stateDir) {
  const paths = ensureStateFiles(stateDir);
  return {
    paths,
    manifest: readJsonIfExists(paths.manifestPath, {}),
    request: readJsonIfExists(paths.requestPath, {}),
    status: readJsonIfExists(paths.statusPath, {}),
    checkpoints: readJsonIfExists(paths.checkpointsPath, { version: 1, current: null, history: [] }),
    blockReason: readJsonIfExists(paths.blockReasonPath, null),
    resultUrl: fs.existsSync(paths.resultUrlPath) ? fs.readFileSync(paths.resultUrlPath, 'utf8').trim() : '',
  };
}

function updateStatus(stateDir, patch) {
  const paths = ensureStateFiles(stateDir);
  const current = readJsonIfExists(paths.statusPath, {}) || {};
  const next = {
    version: 1,
    ...current,
    ...patch,
    updatedAt: timestamp(),
  };
  writeJson(paths.statusPath, next);
  return next;
}

function appendCheckpoint(stateDir, entry) {
  const paths = ensureStateFiles(stateDir);
  const checkpoints = readJsonIfExists(paths.checkpointsPath, {
    version: 1,
    updatedAt: timestamp(),
    current: null,
    history: [],
  }) || { version: 1, updatedAt: timestamp(), current: null, history: [] };

  const nextEntry = {
    at: timestamp(),
    ...entry,
  };

  const history = Array.isArray(checkpoints.history) ? checkpoints.history.slice() : [];
  history.push(nextEntry);

  const next = {
    version: 1,
    updatedAt: timestamp(),
    current: nextEntry,
    history,
  };

  writeJson(paths.checkpointsPath, next);
  updateStatus(stateDir, { checkpointCount: history.length, lastCheckpointAt: nextEntry.at });
  return nextEntry;
}

function setBlockReason(stateDir, blockReason) {
  const paths = ensureStateFiles(stateDir);
  if (!blockReason) {
    if (fs.existsSync(paths.blockReasonPath)) {
      fs.unlinkSync(paths.blockReasonPath);
    }
    return null;
  }
  const payload = {
    version: 1,
    updatedAt: timestamp(),
    ...blockReason,
  };
  writeJson(paths.blockReasonPath, payload);
  return payload;
}

function writeResultUrl(stateDir, url) {
  const paths = ensureStateFiles(stateDir);
  writeText(paths.resultUrlPath, url || '');
  return url || '';
}

function clearBlockReason(stateDir) {
  return setBlockReason(stateDir, null);
}

module.exports = {
  DEFAULT_STATUS,
  appendCheckpoint,
  clearBlockReason,
  ensureStateFiles,
  loadJobContext,
  readJsonIfExists,
  resolveStateDir,
  setBlockReason,
  statePaths,
  timestamp,
  updateStatus,
  writeJson,
  writeResultUrl,
};
