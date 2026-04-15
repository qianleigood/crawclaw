#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const REDACT_PATTERNS = [/(^|[_.-])(cookie|password|passwd|secret|token|authorization|auth|session)([_.-]|$)/i];

function nowIso() {
  return new Date().toISOString();
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function sanitizeForLog(value, trail = []) {
  if (value == null) {return value;}
  if (typeof value === 'string') {
    const keyPath = trail.join('.');
    if (REDACT_PATTERNS.some((pattern) => pattern.test(keyPath))) {
      return '[REDACTED]';
    }
    if (value.length > 2000) {
      return `${value.slice(0, 1997)}...`;
    }
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item, index) => sanitizeForLog(item, trail.concat(String(index))));
  }
  if (typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = REDACT_PATTERNS.some((pattern) => pattern.test(key))
        ? '[REDACTED]'
        : sanitizeForLog(item, trail.concat(key));
    }
    return out;
  }
  return String(value);
}

function summarizeFields(fields = {}) {
  const ordered = [
    ['message', fields.message],
    ['status', fields.status],
    ['phase', fields.phase],
    ['jobId', fields.jobId],
    ['profile', fields.profile],
    ['currentUrl', fields.currentUrl],
    ['url', fields.url],
    ['resultUrl', fields.resultUrl],
    ['reasonCode', fields.reasonCode],
    ['method', fields.method],
    ['path', fields.path],
    ['rawPath', fields.rawPath],
    ['exportPath', fields.exportPath],
  ];
  return ordered
    .filter(([, value]) => value != null && value !== '')
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(' ');
}

function defaultEventsPath(stateDir) {
  return path.join(stateDir, 'events.jsonl');
}

function writeEvent(eventsPath, entry) {
  ensureDir(path.dirname(eventsPath));
  fs.appendFileSync(eventsPath, `${JSON.stringify(entry)}\n`, 'utf8');
}

function createJobLogger(options = {}) {
  const context = {
    script: options.script || '',
    stateDir: options.stateDir ? path.resolve(options.stateDir) : '',
    jobDir: options.jobDir ? path.resolve(options.jobDir) : '',
    jobId: options.jobId || '',
    profile: options.profile || '',
  };
  let eventsPath = options.eventsPath || (context.stateDir ? defaultEventsPath(context.stateDir) : '');
  const consoleEnabled = options.console !== false;
  const minLevel = String(options.minLevel || 'info').toLowerCase();
  const levelOrder = { debug: 10, info: 20, warn: 30, error: 40 };

  function shouldPrint(level) {
    return (levelOrder[level] || 20) >= (levelOrder[minLevel] || 20);
  }

  function enrich(fields = {}) {
    const next = sanitizeForLog({
      ...fields,
      jobId: fields.jobId || context.jobId,
      jobDir: fields.jobDir || context.jobDir,
      profile: fields.profile || context.profile,
    });
    return next;
  }

  function emit(level, event, fields = {}) {
    const data = enrich(fields);
    const entry = {
      ts: nowIso(),
      level,
      event,
      script: context.script || '',
      ...data,
    };
    if (eventsPath) {
      writeEvent(eventsPath, entry);
    }
    if (consoleEnabled && shouldPrint(level)) {
      const prefix = `[${entry.ts}] [${level.toUpperCase()}]${context.script ? ` [${context.script}]` : ''}`;
      const suffix = summarizeFields(data);
      process.stderr.write(`${prefix} ${event}${suffix ? ` ${suffix}` : ''}\n`);
    }
    return entry;
  }

  return {
    context,
    eventsPath,
    setContext(patch = {}) {
      Object.assign(context, sanitizeForLog(patch));
      if (patch.stateDir) {
        context.stateDir = path.resolve(patch.stateDir);
      }
      if (patch.jobDir) {
        context.jobDir = path.resolve(patch.jobDir);
      }
      if (patch.eventsPath) {
        eventsPath = patch.eventsPath;
      } else if (patch.stateDir && !eventsPath) {
        eventsPath = defaultEventsPath(context.stateDir);
      }
      return { ...context, eventsPath };
    },
    child(patch = {}) {
      return createJobLogger({
        ...options,
        ...context,
        ...patch,
        eventsPath: patch.eventsPath || eventsPath,
      });
    },
    log: emit,
    debug(event, fields) {
      return emit('debug', event, fields);
    },
    info(event, fields) {
      return emit('info', event, fields);
    },
    warn(event, fields) {
      return emit('warn', event, fields);
    },
    error(event, fields) {
      return emit('error', event, fields);
    },
  };
}

module.exports = {
  createJobLogger,
  defaultEventsPath,
  nowIso,
  sanitizeForLog,
};

if (require.main === module) {
  const argv = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {continue;}
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next == null || next.startsWith('--')) {
      opts[key] = true;
    } else {
      opts[key] = next;
      i += 1;
    }
  }
  const logger = createJobLogger({
    script: opts.script || 'grok_job_logger',
    stateDir: opts['state-dir'],
    jobDir: opts['job-dir'],
    jobId: opts['job-id'],
    profile: opts.profile,
  });
  logger.log(opts.level || 'info', opts.event || 'log', opts.message ? { message: opts.message } : {});
}
