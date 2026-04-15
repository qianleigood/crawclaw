#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {
  appendGeneratedVideoUrl,
  appendJsonl,
  detectCompletion,
  ensureDir,
  extractPostIdFromUrl,
  gotoResultPage,
  nowIso,
  parseArgs,
  probeTimeline,
  recordLineage,
  resolveActionType,
  resolveJob,
  resolveResultUrl,
  sanitizeFileName,
  sleep,
  updateManifest,
  updateWorkflowStatus,
  appendWorkflowCheckpoint,
  writeWorkflowResultUrl,
  clearWorkflowBlockReason,
  confirmLoggedInAtSafeEntry,
  setWorkflowBlockReason,
  writeJson,
  createLogger,
  WORKSPACE_ROOT,
} = require('./grok_video_lib');
const {
  launchPersistent,
  resolveProfileDir,
} = require('./grok_video_common');

function usage() {
  console.log(`Usage: grok_video_extend.js [options]\n\nPrepare or continue a derivative "extend video" action from an existing Grok result page. This runner treats extend as a standalone path from the finished source result page, probes the dedicated extend UI, optionally arms a +6s/+10s duration choice, can safely attempt the final submit, and records source/derived relationship state plus new-result handoff data.\n\nOptions:\n  --job-id <id>                 Existing browser job id under runtime/browser-jobs/grok-video-web/\n  --job-dir <path>              Explicit job directory\n  --result-url <url>            Source Grok result URL (/imagine/post/<id>)\n  --new-result-url <url>        Record the derived result URL once a human/future runner submits the extend flow\n  --profile <name>              Browser profile name. Default: from job manifest/request, else grok-web\n  --extend-duration <6|10>      Prefer +6s or +10s when that control is visible\n  --extend-prompt <text>        Optional prompt override/addition for the extend flow\n  --prompt <text>               Alias of --extend-prompt\n  --timeline-mode <value>       Persist caller intent for timeline mode (default: auto-detect/manual_handoff)\n  --timeline-start-pct <0-100>  Target trimmed start percentage for real mouse drag validation\n  --timeline-end-pct <0-100>    Target trimmed end percentage for real mouse drag validation\n  --timeline-tolerance-pct <n>  Allowed target deviation after drag. Default: 3\n                               Snake-case aliases are also accepted: --timeline_start_pct / --timeline_end_pct / --timeline_tolerance_pct\n  --detect-only                 Probe only; do not click extend entry, duration controls, timeline controls, or submit\n  --no-open-entry               Detect extend entry without clicking it open\n  --no-submit-click             Do not auto-click the final extend submit even if a candidate is found\n  --submit-timeout-sec <n>      Wait after auto-submit for a derived result URL. Default: 25\n  --manual-handoff-wait-sec <n> Keep the same page open for manual timeline/submit, while capturing the new result URL. Default: 0\n  --headful                     Launch visible browser instead of headless\n  --help                        Show this help\n`);
}

function timestampTag() {
  return new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14).toLowerCase();
}

function buildDerivedJobId(resultUrl) {
  const postId = sanitizeFileName(extractPostIdFromUrl(resultUrl) || 'result');
  return `extend-${postId}-${timestampTag()}`;
}

function bootstrapStandaloneJob(resultUrl, profileHint = '') {
  const jobId = buildDerivedJobId(resultUrl);
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
      action: 'extend_video',
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
      action: 'extend_video',
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

function parseHasTextSelector(selector) {
  const match = String(selector || '').trim().match(/^(.*?):has-text\((['"])(.*?)\2\)$/);
  if (!match) {return null;}
  return {
    baseSelector: (match[1] || '*').trim() || '*',
    text: String(match[3] || '').trim(),
  };
}

async function firstVisibleLocator(page, selectors = []) {
  for (const selector of selectors) {
    try {
      const attrName = 'data-crawclaw-visible-probe';
      const candidate = await page.evaluate(({ selector, attrName }) => {
        const isVisible = (node) => {
          if (!(node instanceof Element)) {return false;}
          const style = window.getComputedStyle(node);
          if (!style || style.visibility === 'hidden' || style.display === 'none') {return false;}
          const rect = node.getBoundingClientRect();
          return rect.width > 1 && rect.height > 1;
        };
        const norm = (value) => String(value || '').replace(/\s+/g, ' ').trim();
        const parseHasTextSelector = (input) => {
          const match = String(input || '').trim().match(/^(.*?):has-text\((['"])(.*?)\2\)$/);
          if (!match) {return null;}
          return {
            baseSelector: (match[1] || '*').trim() || '*',
            text: norm(match[3] || ''),
          };
        };

        document.querySelectorAll(`[${attrName}]`).forEach((node) => node.removeAttribute(attrName));

        const parsed = parseHasTextSelector(selector);
        let nodes = [];
        if (parsed) {
          nodes = Array.from(document.querySelectorAll(parsed.baseSelector)).filter((node) => {
            if (!isVisible(node)) {return false;}
            const text = norm(node.innerText || node.textContent || node.getAttribute('aria-label') || node.getAttribute('title') || '');
            return text.toLowerCase().includes(parsed.text.toLowerCase());
          });
        } else {
          nodes = Array.from(document.querySelectorAll(selector)).filter(isVisible);
        }

        const target = nodes[0];
        if (!target) {return null;}
        target.setAttribute(attrName, '1');
        const text = norm(target.innerText || target.textContent || target.getAttribute('aria-label') || target.getAttribute('title') || '').slice(0, 120);
        return {
          selector: `[${attrName}="1"]`,
          text,
          source: parsed ? 'text_selector' : 'css_selector',
        };
      }, { selector, attrName }).catch(() => null);
      if (candidate && candidate.selector) {
        return {
          selector: candidate.selector,
          text: candidate.text || '',
          source: candidate.source || 'css_selector',
        };
      }
    } catch {
      // keep probing
    }
  }
  return null;
}

async function firstVisibleXPathLocator(page, probes = []) {
  for (const probe of probes) {
    try {
      const attrName = 'data-crawclaw-xpath-probe';
      const candidate = await page.evaluate(({ probe, attrName }) => {
        const isVisible = (node) => {
          if (!(node instanceof Element)) {return false;}
          const style = window.getComputedStyle(node);
          if (!style || style.visibility === 'hidden' || style.display === 'none') {return false;}
          const rect = node.getBoundingClientRect();
          return rect.width > 1 && rect.height > 1;
        };
        const norm = (value) => String(value || '').replace(/\s+/g, ' ').trim();
        document.querySelectorAll(`[${attrName}]`).forEach((node) => node.removeAttribute(attrName));
        const evaluatePath = (xpath) => document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
        let node = evaluatePath(probe.xpath);
        if (node && !(node instanceof Element)) {
          node = node.parentElement || null;
        }
        if (node && probe.closestSelector && typeof node.closest === 'function') {
          node = node.closest(probe.closestSelector) || node;
        }
        if (!isVisible(node)) {return null;}
        node.setAttribute(attrName, '1');
        return {
          selector: `[${attrName}="1"]`,
          text: norm(node.innerText || node.textContent || node.getAttribute('aria-label') || node.getAttribute('title') || '').slice(0, 120),
          source: probe.source || 'xpath',
          xpath: probe.xpath,
        };
      }, { probe, attrName }).catch(() => null);
      if (candidate && candidate.selector) {
        return candidate;
      }
    } catch {
      // keep probing
    }
  }
  return null;
}

async function waitForLocator(page, detector, { timeoutMs = 3000, intervalMs = 250 } = {}) {
  const started = Date.now();
  while (Date.now() - started <= timeoutMs) {
    const candidate = await detector(page);
    if (candidate) {return candidate;}
    await sleep(intervalMs);
  }
  return null;
}

async function collectVisibleLabels(page, selectors = [], limit = 12) {
  const labels = [];
  for (const selector of selectors) {
    try {
      const items = await page.evaluate(({ selector, limit }) => {
        const isVisible = (node) => {
          if (!(node instanceof Element)) {return false;}
          const style = window.getComputedStyle(node);
          if (!style || style.visibility === 'hidden' || style.display === 'none') {return false;}
          const rect = node.getBoundingClientRect();
          return rect.width > 1 && rect.height > 1;
        };
        return Array.from(document.querySelectorAll(selector))
          .filter(isVisible)
          .map((node) => String(node.innerText || node.textContent || node.getAttribute('aria-label') || node.getAttribute('title') || '').trim().replace(/\s+/g, ' '))
          .filter(Boolean)
          .slice(0, limit);
      }, { selector, limit }).catch(() => []);
      labels.push(...items);
    } catch {
      // ignore
    }
  }
  return Array.from(new Set(labels)).slice(0, limit);
}

async function getContextPages(context) {
  if (!context || typeof context.pages !== 'function') {return [];}
  try {
    const pages = context.pages();
    return Array.isArray(pages) ? pages : await pages;
  } catch {
    return [];
  }
}

function normalizeExtendDuration(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) {return '';}
  if (text === '6' || text === '+6' || text === '6s' || text === '+6s') {return '6s';}
  if (text === '10' || text === '+10' || text === '10s' || text === '+10s') {return '10s';}
  return '';
}

function roundPct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) {return null;}
  return Math.round(n * 100) / 100;
}

function clampPct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) {return null;}
  return Math.max(0, Math.min(100, roundPct(n)));
}

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') {return value;}
  }
  return undefined;
}

function normText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function summarizeTimelineRequest(timelineRequest) {
  return {
    requested: Boolean(timelineRequest && timelineRequest.requested),
    valid: Boolean(timelineRequest && timelineRequest.valid),
    requestedStartPct: timelineRequest && timelineRequest.requestedStartPct != null ? timelineRequest.requestedStartPct : null,
    requestedEndPct: timelineRequest && timelineRequest.requestedEndPct != null ? timelineRequest.requestedEndPct : null,
    targetStartPct: timelineRequest && timelineRequest.targetStartPct != null ? timelineRequest.targetStartPct : null,
    targetEndPct: timelineRequest && timelineRequest.targetEndPct != null ? timelineRequest.targetEndPct : null,
    tolerancePct: timelineRequest && Number.isFinite(timelineRequest.tolerancePct) ? timelineRequest.tolerancePct : null,
    validationErrors: Array.isArray(timelineRequest && timelineRequest.validationErrors) ? timelineRequest.validationErrors : [],
  };
}

function resolveTimelineRequest(job, args = {}, fallbackProbe = null) {
  const manifestExtend = job && job.manifest && job.manifest.extend ? job.manifest.extend : {};
  const requestExtend = job && job.request && job.request.extend ? job.request.extend : {};
  const rawStart = firstDefined(
    args['timeline-start-pct'],
    requestExtend.timeline_start_pct,
    requestExtend.start_pct,
    requestExtend.startPct,
    requestExtend.timelineStartPct,
    job?.request?.timeline_start_pct,
    job?.request?.timelineStartPct,
    manifestExtend.timeline_start_pct,
    manifestExtend.timelineStartPct,
    manifestExtend.targetStartPct
  );
  const rawEnd = firstDefined(
    args['timeline-end-pct'],
    requestExtend.timeline_end_pct,
    requestExtend.end_pct,
    requestExtend.endPct,
    requestExtend.timelineEndPct,
    job?.request?.timeline_end_pct,
    job?.request?.timelineEndPct,
    manifestExtend.timeline_end_pct,
    manifestExtend.timelineEndPct,
    manifestExtend.targetEndPct
  );
  const rawTolerance = firstDefined(
    args['timeline-tolerance-pct'],
    requestExtend.timeline_tolerance_pct,
    requestExtend.tolerance_pct,
    requestExtend.tolerancePct,
    requestExtend.timelineTolerancePct,
    job?.request?.timeline_tolerance_pct,
    job?.request?.timelineTolerancePct,
    manifestExtend.timeline_tolerance_pct,
    manifestExtend.timelineTolerancePct,
    manifestExtend.targetTolerancePct,
    3
  );
  const tolerancePct = Math.max(0.5, Number(rawTolerance));
  const requestedStartPct = clampPct(rawStart);
  const requestedEndPct = clampPct(rawEnd);
  const fallbackSelection = fallbackProbe && fallbackProbe.currentSelection ? fallbackProbe.currentSelection : {};
  const fallbackDurationPct = fallbackProbe && fallbackProbe.automationModel && Number.isFinite(fallbackProbe.automationModel.fixedWindowDurationPct)
    ? roundPct(fallbackProbe.automationModel.fixedWindowDurationPct)
    : (Number.isFinite(fallbackSelection.startPct) && Number.isFinite(fallbackSelection.endPct)
      ? roundPct(fallbackSelection.endPct - fallbackSelection.startPct)
      : null);

  let targetStartPct = requestedStartPct != null ? requestedStartPct : (Number.isFinite(fallbackSelection.startPct) ? roundPct(fallbackSelection.startPct) : null);
  let targetEndPct = requestedEndPct != null ? requestedEndPct : (Number.isFinite(fallbackSelection.endPct) ? roundPct(fallbackSelection.endPct) : null);
  const requested = requestedStartPct != null || requestedEndPct != null;

  if (Number.isFinite(fallbackDurationPct)) {
    if (requestedStartPct != null && requestedEndPct == null) {
      targetEndPct = roundPct(requestedStartPct + fallbackDurationPct);
    } else if (requestedEndPct != null && requestedStartPct == null) {
      targetStartPct = roundPct(requestedEndPct - fallbackDurationPct);
    }
    if (Number.isFinite(targetStartPct) && Number.isFinite(targetEndPct)) {
      if (targetEndPct > 100) {
        targetEndPct = 100;
        targetStartPct = roundPct(targetEndPct - fallbackDurationPct);
      }
      if (targetStartPct < 0) {
        targetStartPct = 0;
        targetEndPct = roundPct(targetStartPct + fallbackDurationPct);
      }
    }
  }

  const validationErrors = [];
  if (requested) {
    if (!Number.isFinite(targetStartPct) || !Number.isFinite(targetEndPct)) {
      validationErrors.push('target_range_incomplete');
    } else if (targetStartPct >= targetEndPct) {
      validationErrors.push('target_start_must_be_less_than_target_end');
    }
    if (requestedStartPct != null && requestedEndPct != null && Number.isFinite(fallbackDurationPct)) {
      const requestedDurationPct = roundPct(requestedEndPct - requestedStartPct);
      if (Math.abs(requestedDurationPct - fallbackDurationPct) > tolerancePct) {
        validationErrors.push('fixed_window_duration_locked');
      }
    }
  }

  return {
    requested,
    requestedStartPct,
    requestedEndPct,
    targetStartPct,
    targetEndPct,
    tolerancePct,
    fixedWindowDurationPct: fallbackDurationPct,
    fixedWindowMode: Boolean(Number.isFinite(fallbackDurationPct)),
    valid: requested ? validationErrors.length === 0 : true,
    validationErrors,
  };
}

function buildTimelineAdjustmentPlan(timelineProbe, timelineRequest) {
  const plan = {
    requested: Boolean(timelineRequest && timelineRequest.requested),
    ok: false,
    mode: '',
    reasons: [],
    targetRange: timelineRequest && timelineRequest.requested ? {
      startPct: timelineRequest.targetStartPct,
      endPct: timelineRequest.targetEndPct,
      tolerancePct: timelineRequest.tolerancePct,
    } : null,
    actions: [],
  };

  if (!plan.requested) {
    plan.reasons.push('no_timeline_target_requested');
    return plan;
  }
  if (!timelineRequest.valid) {
    plan.reasons.push(...timelineRequest.validationErrors);
    return plan;
  }
  if (!timelineProbe || !timelineProbe.detected) {
    plan.reasons.push('timeline_not_detected');
    return plan;
  }

  const model = timelineProbe.automationModel || {};
  const container = model.container || null;
  if (!container || !container.selector || !container.rect || !Number.isFinite(container.rect.width) || container.rect.width <= 0) {
    plan.reasons.push('timeline_container_unresolved');
    return plan;
  }
  const current = model.selection || timelineProbe.currentSelection || {};
  if (!current || !current.detected || !Number.isFinite(current.startPct) || !Number.isFinite(current.endPct)) {
    plan.reasons.push('current_selection_unresolved');
    return plan;
  }

  const targetStartPct = timelineRequest.targetStartPct;
  const targetEndPct = timelineRequest.targetEndPct;
  const startHandle = model.handles && model.handles.start && model.handles.end ? model.handles.start : null;
  const endHandle = model.handles && model.handles.start && model.handles.end ? model.handles.end : null;
  const singleWindowHandle = model.handles && model.handles.end ? model.handles.end : null;
  const singleEndTrim = model.trimControls && model.trimControls.end ? model.trimControls.end : null;
  const fixedWindowDurationPct = Number.isFinite(model.fixedWindowDurationPct) ? model.fixedWindowDurationPct : null;
  const startRange = model.rangeInputs && model.rangeInputs.start && model.rangeInputs.end ? model.rangeInputs.start : null;
  const endRange = model.rangeInputs && model.rangeInputs.start && model.rangeInputs.end ? model.rangeInputs.end : null;

  if ((singleEndTrim && singleEndTrim.selector && Number.isFinite(fixedWindowDurationPct)) || (singleWindowHandle && singleWindowHandle.selector && Number.isFinite(fixedWindowDurationPct))) {
    const fixedWindowControl = (singleEndTrim && singleEndTrim.selector) ? singleEndTrim : singleWindowHandle;
    plan.mode = 'single_handle_fixed_window';
    plan.ok = true;
    plan.actions.push({
      edge: 'window_start',
      control: 'trim_handle',
      selector: fixedWindowControl.selector,
      fromPct: current.startPct,
      toPct: targetStartPct,
      expectedWindowDurationPct: fixedWindowDurationPct,
      currentEndPct: current.endPct,
      targetEndPct,
    });
  } else if (startHandle && endHandle && startHandle.selector && endHandle.selector) {
    plan.mode = 'handle_drag';
    plan.ok = true;
    plan.actions.push({ edge: 'start', control: 'handle', selector: startHandle.selector, fromPct: current.startPct, toPct: targetStartPct });
    plan.actions.push({ edge: 'end', control: 'handle', selector: endHandle.selector, fromPct: current.endPct, toPct: targetEndPct });
  } else if (startRange && endRange && startRange.selector && endRange.selector) {
    plan.mode = 'range_input_drag';
    plan.ok = true;
    plan.actions.push({ edge: 'start', control: 'range_input', selector: startRange.selector, fromPct: current.startPct, toPct: targetStartPct });
    plan.actions.push({ edge: 'end', control: 'range_input', selector: endRange.selector, fromPct: current.endPct, toPct: targetEndPct });
  } else {
    plan.reasons.push('boundary_controls_unresolved');
    return plan;
  }

  plan.actions = plan.actions
    .map((action) => ({
      ...action,
      deltaPct: roundPct(action.toPct - action.fromPct),
      direction: action.toPct > action.fromPct ? 'increase' : (action.toPct < action.fromPct ? 'decrease' : 'stay'),
    }))
    .filter((action) => action.direction !== 'stay');

  if (!plan.actions.length) {
    plan.ok = true;
    plan.reasons.push('target_already_matches_current_selection');
  }
  return plan;
}

function evaluateTimelineAdjustment({ timelineRequest, beforeProbe, afterProbe }) {
  const before = beforeProbe && beforeProbe.currentSelection ? beforeProbe.currentSelection : {};
  const after = afterProbe && afterProbe.currentSelection ? afterProbe.currentSelection : {};
  const result = {
    requested: Boolean(timelineRequest && timelineRequest.requested),
    targetRange: timelineRequest && timelineRequest.requested ? {
      startPct: timelineRequest.targetStartPct,
      endPct: timelineRequest.targetEndPct,
      tolerancePct: timelineRequest.tolerancePct,
    } : null,
    beforeRange: {
      detected: Boolean(before.detected),
      startPct: Number.isFinite(before.startPct) ? roundPct(before.startPct) : null,
      endPct: Number.isFinite(before.endPct) ? roundPct(before.endPct) : null,
      startSec: Number.isFinite(before.startSec) ? roundPct(before.startSec) : null,
      endSec: Number.isFinite(before.endSec) ? roundPct(before.endSec) : null,
      durationSec: Number.isFinite(before.durationSec) ? roundPct(before.durationSec) : null,
      source: before.source || '',
    },
    afterRange: {
      detected: Boolean(after.detected),
      startPct: Number.isFinite(after.startPct) ? roundPct(after.startPct) : null,
      endPct: Number.isFinite(after.endPct) ? roundPct(after.endPct) : null,
      startSec: Number.isFinite(after.startSec) ? roundPct(after.startSec) : null,
      endSec: Number.isFinite(after.endSec) ? roundPct(after.endSec) : null,
      durationSec: Number.isFinite(after.durationSec) ? roundPct(after.durationSec) : null,
      source: after.source || '',
    },
    moved: {
      startPct: Number.isFinite(before.startPct) && Number.isFinite(after.startPct) ? roundPct(after.startPct - before.startPct) : null,
      endPct: Number.isFinite(before.endPct) && Number.isFinite(after.endPct) ? roundPct(after.endPct - before.endPct) : null,
      startSec: Number.isFinite(before.startSec) && Number.isFinite(after.startSec) ? roundPct(after.startSec - before.startSec) : null,
      endSec: Number.isFinite(before.endSec) && Number.isFinite(after.endSec) ? roundPct(after.endSec - before.endSec) : null,
    },
    credibleChange: false,
    achieved: false,
    outcome: 'not_requested',
    failureReason: '',
    reasons: [],
  };

  if (!result.requested) {return result;}
  if (!result.afterRange.detected) {
    result.outcome = 'unresolved';
    result.failureReason = 'post_drag_selection_unresolved';
    result.reasons.push(result.failureReason);
    return result;
  }
  const tolerancePct = timelineRequest.tolerancePct;
  const startDiff = Number.isFinite(result.afterRange.startPct) ? Math.abs(result.afterRange.startPct - timelineRequest.targetStartPct) : null;
  const endDiff = Number.isFinite(result.afterRange.endPct) ? Math.abs(result.afterRange.endPct - timelineRequest.targetEndPct) : null;
  const startDirectionExpected = Number.isFinite(result.beforeRange.startPct) && Number.isFinite(timelineRequest.targetStartPct)
    ? Math.sign(timelineRequest.targetStartPct - result.beforeRange.startPct)
    : 0;
  const endDirectionExpected = Number.isFinite(result.beforeRange.endPct) && Number.isFinite(timelineRequest.targetEndPct)
    ? Math.sign(timelineRequest.targetEndPct - result.beforeRange.endPct)
    : 0;
  const startDirectionActual = Number.isFinite(result.moved.startPct) ? Math.sign(result.moved.startPct) : 0;
  const endDirectionActual = Number.isFinite(result.moved.endPct) ? Math.sign(result.moved.endPct) : 0;

  const fixedWindowMode = Boolean(timelineRequest && timelineRequest.fixedWindowMode && Number.isFinite(timelineRequest.fixedWindowDurationPct));
  const hasSecondRangeSignals = Number.isFinite(result.beforeRange.startSec) && Number.isFinite(result.beforeRange.endSec)
    && Number.isFinite(result.afterRange.startSec) && Number.isFinite(result.afterRange.endSec);
  const startDirectionOk = startDirectionExpected === 0 || startDirectionExpected === startDirectionActual;
  const endDirectionOk = fixedWindowMode
    ? (startDirectionExpected === 0 || endDirectionActual === startDirectionExpected)
    : (endDirectionExpected === 0 || endDirectionExpected === endDirectionActual);
  const startChanged = Number.isFinite(result.moved.startPct) && Math.abs(result.moved.startPct) >= 0.5;
  const endChanged = Number.isFinite(result.moved.endPct) && Math.abs(result.moved.endPct) >= 0.5;
  const fixedWindowMaintainedByPct = fixedWindowMode
    ? (Number.isFinite(result.afterRange.startPct)
      && Number.isFinite(result.afterRange.endPct)
      && Math.abs((result.afterRange.endPct - result.afterRange.startPct) - timelineRequest.fixedWindowDurationPct) <= tolerancePct)
    : true;
  const fixedWindowMaintainedBySeconds = fixedWindowMode && hasSecondRangeSignals
    ? Math.abs(((result.afterRange.endSec - result.afterRange.startSec) - (result.beforeRange.endSec - result.beforeRange.startSec))) <= 0.75
    : false;
  const fixedWindowMaintained = fixedWindowMode
    ? (fixedWindowMaintainedByPct || fixedWindowMaintainedBySeconds)
    : true;
  const secondDirectionOk = hasSecondRangeSignals
    ? (() => {
        const expected = Number.isFinite(result.beforeRange.startSec) && Number.isFinite(result.afterRange.startSec)
          ? Math.sign(result.afterRange.startSec - result.beforeRange.startSec)
          : 0;
        return startDirectionExpected === 0 || expected === startDirectionExpected;
      })()
    : true;
  const secondChangeConfirmed = hasSecondRangeSignals
    ? ((Math.abs(result.moved.startSec || 0) >= 0.5) || (Math.abs(result.moved.endSec || 0) >= 0.5))
    : false;
  result.credibleChange = Boolean(((startChanged || endChanged) || secondChangeConfirmed) && startDirectionOk && endDirectionOk && secondDirectionOk && fixedWindowMaintained);
  result.achieved = Boolean(Number.isFinite(startDiff) && Number.isFinite(endDiff) && startDiff <= tolerancePct && endDiff <= tolerancePct && fixedWindowMaintained);

  if (result.achieved) {
    result.outcome = 'success';
    result.reasons.push('target_within_tolerance');
    return result;
  }
  if (fixedWindowMode && hasSecondRangeSignals && secondChangeConfirmed && secondDirectionOk && fixedWindowMaintainedBySeconds) {
    result.outcome = 'success';
    result.achieved = true;
    result.reasons.push('second_range_text_changed_in_expected_direction');
    return result;
  }
  if (!startChanged && !endChanged) {
    result.outcome = 'failed';
    result.failureReason = 'selection_did_not_change';
    result.reasons.push(result.failureReason);
    return result;
  }
  if (!startDirectionOk || !endDirectionOk) {
    result.outcome = 'failed';
    result.failureReason = 'selection_changed_in_wrong_direction';
    result.reasons.push(result.failureReason);
    return result;
  }
  if (!fixedWindowMaintained) {
    result.outcome = 'failed';
    result.failureReason = 'fixed_window_duration_drifted';
    result.reasons.push(result.failureReason);
    return result;
  }

  result.outcome = result.credibleChange ? 'changed_but_not_achieved' : 'unresolved';
  result.failureReason = result.credibleChange ? 'selection_changed_but_target_not_reached' : 'selection_change_not_confirmed';
  result.reasons.push(result.failureReason);
  return result;
}

async function performTimelineMouseDrag(page, action, timelineProbe) {
  const container = timelineProbe && timelineProbe.automationModel ? timelineProbe.automationModel.container : null;
  if (!container || !container.rect || !Number.isFinite(container.rect.left) || !Number.isFinite(container.rect.width) || container.rect.width <= 0) {
    throw new Error('timeline_container_unresolved');
  }
  if (!action || !action.selector) {
    throw new Error('timeline_control_selector_missing');
  }

  const handle = await page.$(action.selector);
  if (!handle) {
    throw new Error(`timeline_control_not_found:${action.selector}`);
  }
  const box = await handle.boundingBox();
  if (!box || !Number.isFinite(box.x) || !Number.isFinite(box.width) || !Number.isFinite(box.height)) {
    throw new Error(`timeline_control_not_visible:${action.selector}`);
  }

  const startX = action.control === 'range_input'
    ? box.x + ((action.fromPct / 100) * box.width)
    : box.x + (box.width / 2);
  const startY = box.y + (box.height / 2);
  const targetX = container.rect.left + ((action.toPct / 100) * container.rect.width);
  const clampedTargetX = Math.max(container.rect.left + 1, Math.min(container.rect.left + container.rect.width - 1, targetX));
  const endY = startY;

  await page.mouse.move(startX, startY);
  await sleep(60);
  await page.mouse.down();
  const steps = 12;
  for (let i = 1; i <= steps; i += 1) {
    const progress = i / steps;
    const x = startX + ((clampedTargetX - startX) * progress);
    await page.mouse.move(x, endY);
    await sleep(16);
  }
  await sleep(80);
  await page.mouse.up();
  await sleep(350);

  return {
    edge: action.edge,
    control: action.control,
    selector: action.selector,
    startX: roundPct(startX),
    endX: roundPct(clampedTargetX),
    y: roundPct(startY),
    fromPct: action.fromPct,
    toPct: action.toPct,
    deltaPct: action.deltaPct,
  };
}

const KNOWN_SECONDARY_MENU_TRIGGER_PROBES = [
  {
    xpath: '/html/body/div[2]/div/div[2]/div/div/div/div[1]/div/main/article/div/div[3]/div[2]/button[6]',
    closestSelector: 'button',
    source: 'known_secondary_menu_trigger_xpath',
  },
  {
    xpath: '/html/body/div[2]/div/div[2]/div/div/div/div[1]/div/main/article/div/div[3]/div[2]/button[6]/svg',
    closestSelector: 'button',
    source: 'known_secondary_menu_trigger_svg_xpath_parent_button',
  },
];

const KNOWN_EXTEND_SUBMIT_PROBES = [
  {
    xpath: '/html/body/div[2]/div/div[2]/div/div/div/div[2]/div/form/div/div/div/div[2]/div[2]/button',
    closestSelector: 'button',
    source: 'known_extend_submit_button_xpath',
  },
  {
    xpath: '/html/body/div[2]/div/div[2]/div/div/div/div[2]/div/form/div/div/div/div[2]/div[2]/button/div/svg',
    closestSelector: 'button',
    source: 'known_extend_submit_svg_xpath_parent_button',
  },
];

async function detectSecondaryMenuTrigger(page) {
  const xpathCandidate = await firstVisibleXPathLocator(page, KNOWN_SECONDARY_MENU_TRIGGER_PROBES);
  if (xpathCandidate) {
    return {
      ...xpathCandidate,
      kind: 'secondary_menu_trigger',
      level: 'secondary_menu',
      clickTarget: 'button',
    };
  }

  const labeledCandidate = await firstVisibleLocator(page, [
    'button[aria-label="More options"]',
    '[role="button"][aria-label="More options"]',
    'button:has-text("More options")',
    '[role="button"]:has-text("More options")',
    'button:has-text("更多")',
    '[role="button"]:has-text("更多")',
  ]);
  if (labeledCandidate) {
    return {
      ...labeledCandidate,
      kind: 'secondary_menu_trigger',
      level: 'secondary_menu',
      clickTarget: 'button',
    };
  }
  return null;
}

async function detectPrimaryExtendEntry(page) {
  return detectSecondaryMenuTrigger(page);
}

async function detectSecondaryExtendEntry(page) {
  const direct = await firstVisibleLocator(page, [
    '[role="menuitem"]:has-text("扩展视频")',
    '[role="menuitem"]:has-text("延长视频")',
    '[role="menuitem"]:has-text("Extend video")',
    'button:has-text("扩展视频")',
    '[role="button"]:has-text("扩展视频")',
    'button:has-text("延长视频")',
    '[role="button"]:has-text("延长视频")',
    'button:has-text("Extend video")',
    '[role="button"]:has-text("Extend video")',
    'a:has-text("Extend video")',
  ]);
  if (direct) {
    return {
      ...direct,
      kind: 'secondary',
      level: 'secondary',
      clickTarget: 'button',
    };
  }

  const attrName = 'data-crawclaw-secondary-extend-entry';
  const heuristic = await page.evaluate((attrName) => {
    const isVisible = (node) => {
      if (!(node instanceof Element)) {return false;}
      const style = window.getComputedStyle(node);
      if (!style || style.visibility === 'hidden' || style.display === 'none') {return false;}
      const rect = node.getBoundingClientRect();
      return rect.width > 1 && rect.height > 1;
    };
    const norm = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const positive = [
      /^extend video$/i,
      /^扩展视频$/,
      /^延长视频$/,
    ];
    const clickSelector = 'button, [role="button"], [role="menuitem"], a, li';
    document.querySelectorAll(`[${attrName}]`).forEach((node) => node.removeAttribute(attrName));
    const nodes = Array.from(document.querySelectorAll(clickSelector));
    const scored = nodes.map((node, index) => {
      if (!isVisible(node)) {return null;}
      const label = norm(node.innerText || node.textContent || node.getAttribute('aria-label') || node.getAttribute('title') || '');
      if (!label || !positive.some((re) => re.test(label))) {return null;}
      if (node.disabled || node.getAttribute('aria-disabled') === 'true') {return null;}
      let score = 100 - index;
      if (node.tagName === 'BUTTON') {score += 8;}
      if ((node.getAttribute('role') || '').toLowerCase() === 'menuitem') {score += 6;}
      if (/^extend video$/i.test(label)) {score += 5;}
      return { node, label, score };
    }).filter(Boolean).toSorted((a, b) => b.score - a.score);
    const best = scored[0];
    if (!best) {return null;}
    best.node.setAttribute(attrName, '1');
    return {
      selector: `[${attrName}="1"]`,
      text: best.label,
      source: 'secondary_text_clickable_heuristic',
    };
  }, attrName).catch(() => null);

  if (heuristic && heuristic.selector) {
    return {
      ...heuristic,
      kind: 'secondary',
      level: 'secondary',
      clickTarget: 'button',
    };
  }

  return null;
}

function resolveExtendPrompt(job, args = {}) {
  const requestExtend = job && job.request && job.request.extend ? job.request.extend : {};
  const manifestExtend = job && job.manifest && job.manifest.extend ? job.manifest.extend : {};
  const raw = firstDefined(
    args['extend-prompt'],
    args.prompt,
    requestExtend.prompt,
    requestExtend.extend_prompt,
    requestExtend.extendPrompt,
    job?.request?.prompt,
    job?.request?.extend_prompt,
    job?.request?.extendPrompt,
    manifestExtend.prompt,
    manifestExtend.extend_prompt,
    manifestExtend.extendPrompt
  );
  return normText(raw);
}

async function markVisiblePromptTarget(page) {
  const attrName = 'data-crawclaw-extend-prompt';
  return page.evaluate((attrName) => {
    const selectors = [
      'textarea',
      '[contenteditable="true"]',
      'div[contenteditable="plaintext-only"]',
      'input[type="text"]',
    ];
    const isVisible = (node) => {
      if (!(node instanceof Element)) {return false;}
      const style = window.getComputedStyle(node);
      if (!style || style.visibility === 'hidden' || style.display === 'none') {return false;}
      const rect = node.getBoundingClientRect();
      return rect.width > 1 && rect.height > 1;
    };
    const norm = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    document.querySelectorAll(`[${attrName}]`).forEach((node) => node.removeAttribute(attrName));
    const nodes = Array.from(document.querySelectorAll(selectors.join(','))).filter(isVisible);
    const scored = nodes.map((node, index) => {
      const probe = [
        norm(node.getAttribute('placeholder')),
        norm(node.getAttribute('aria-label')),
        norm(node.innerText || node.textContent || ''),
        norm(node.className),
      ].join(' ').toLowerCase();
      let score = 100 - index;
      if (/prompt|描述|描述视频|写点什么|what should|describe/i.test(probe)) {score += 25;}
      if (node.tagName === 'TEXTAREA') {score += 10;}
      if (String(node.getAttribute('contenteditable') || '').toLowerCase() === 'true') {score += 8;}
      return { node, score };
    }).toSorted((a, b) => b.score - a.score);
    const best = scored[0];
    if (!best) {return { found: false, selector: '' };}
    best.node.setAttribute(attrName, '1');
    return { found: true, selector: `[${attrName}="1"]` };
  }, attrName).catch(() => ({ found: false, selector: '' }));
}

async function fillExtendPrompt(page, prompt, logger) {
  const value = normText(prompt);
  if (!value) {return { ok: false, selector: '', note: 'extend_prompt_empty' };}
  const target = await markVisiblePromptTarget(page);
  if (!target.found) {return { ok: false, selector: '', note: 'extend_prompt_input_not_found' };}
  try {
    await page.focus(target.selector).catch(() => {});
    const writeResult = await page.evaluate(({ selector, value }) => {
      const node = document.querySelector(selector);
      if (!node) {return { ok: false, note: 'node_missing', probe: '' };}
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
      return { ok: Boolean(probe), note: probe ? 'extend_prompt_written' : 'extend_prompt_probe_empty', probe };
    }, { selector: target.selector, value });
    return { ok: Boolean(writeResult.ok), selector: target.selector, note: writeResult.note, valueExcerpt: String(writeResult.probe || '').slice(0, 120) };
  } catch (error) {
    if (logger) {
      logger.warn('extend.prompt_fill_failed', { phase: 'extend_prompt_fill', selector: target.selector, message: error.message });
    }
    return { ok: false, selector: target.selector, note: error.message };
  }
}

async function detectDurationControl(page, duration) {
  const norm = normalizeExtendDuration(duration);
  if (!norm) {return null;}
  const short = norm.replace('s', '');
  return firstVisibleLocator(page, [
    `button:has-text("+${norm}")`,
    `[role="button"]:has-text("+${norm}")`,
    `button:has-text("+${short}s")`,
    `[role="button"]:has-text("+${short}s")`,
    `button:has-text("${norm}")`,
    `[role="button"]:has-text("${norm}")`,
    `button:has-text("+${short}")`,
    `[role="button"]:has-text("+${short}")`,
  ]);
}

async function collectAvailableExtendDurations(page) {
  const found = [];
  if (await detectDurationControl(page, '6s')) {found.push('6s');}
  if (await detectDurationControl(page, '10s')) {found.push('10s');}
  return found;
}

async function scanResultUrls(page) {
  const urls = await page.evaluate(() => {
    const found = new Set();
    const push = (value) => {
      if (!value || typeof value !== 'string') {return;}
      const text = value.trim();
      if (!text) {return;}
      if (/https?:\/\/grok\.com\/imagine\/post\//i.test(text)) {
        found.add(text);
      }
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


function classifyDerivedCaptureCandidate({ sourceResultUrl, stage, candidateUrl, currentUrl, observationSource, baselineUrls }) {
  const cleanSourceUrl = String(sourceResultUrl || '').trim().replace(/[\\]+$/g, '');
  const candidate = String(candidateUrl || '').trim().replace(/[\\]+$/g, '');
  const current = String(currentUrl || '').trim().replace(/[\\]+$/g, '');
  const baseline = baselineUrls && typeof baselineUrls.has === 'function'
    ? baselineUrls
    : new Set(Array.isArray(baselineUrls) ? baselineUrls : []);
  const reasons = [];

  if (!candidate) {
    return { verdict: 'no_candidate', reasons: ['candidate_missing'] };
  }
  if (candidate === cleanSourceUrl) {
    return { verdict: 'source_page', reasons: ['candidate_matches_source'] };
  }

  const candidateAlreadyPresent = baseline.has(candidate);
  const pageAtCandidate = current === candidate;
  const primaryPageNavigated = observationSource === 'primary_page' && pageAtCandidate;
  const contextPageOpened = observationSource === 'context_page' && pageAtCandidate;

  if (candidateAlreadyPresent) {
    reasons.push('candidate_seen_before_watch_window');
    return { verdict: 'observed_drift', reasons };
  }

  if (stage === 'auto_submit' && (primaryPageNavigated || contextPageOpened)) {
    reasons.push(primaryPageNavigated ? 'primary_page_navigated_to_new_post' : 'new_context_page_opened_to_new_post');
    reasons.push('candidate_first_seen_after_auto_submit');
    return { verdict: 'confirmed_derived', reasons };
  }

  if (stage === 'manual_handoff' && contextPageOpened) {
    reasons.push('new_context_page_opened_during_manual_handoff');
    reasons.push('candidate_first_seen_inside_extend_watch_window');
    return { verdict: 'confirmed_derived', reasons };
  }

  if (stage === 'manual_handoff' && primaryPageNavigated) {
    reasons.push('primary_page_navigated_during_manual_handoff');
    reasons.push('same_tab_navigation_not_trusted_for_lineage');
    return { verdict: 'suspicious_redirect', reasons };
  }

  reasons.push('candidate_not_backed_by_trusted_navigation_shape');
  reasons.push(`stage:${stage || 'unknown'}`);
  return { verdict: 'suspicious_redirect', reasons };
}

async function detectExtendMode(page, extendEntry) {
  const availableDurations = await collectAvailableExtendDurations(page);
  const timelineProbe = await probeTimeline(page);
  const submitCandidate = await detectFinalSubmitControl(page, {
    entryLabel: extendEntry ? extendEntry.text : '',
    includeExtendLabel: true,
  });
  const labels = await collectVisibleLabels(page, [
    'button',
    '[role="button"]',
    '[aria-label*="extend" i]',
    '[aria-label*="扩展" i]',
    '[aria-label*="延长" i]',
  ], 16);

  const signals = [];
  if (availableDurations.length) {signals.push(`duration:${availableDurations.join(',')}`);}
  if (timelineProbe.detected) {signals.push(`timeline:${timelineProbe.timelineMode}`);}
  if (submitCandidate) {signals.push(`submit:${submitCandidate.label || submitCandidate.selector}`);}
  if (extendEntry && extendEntry.text) {signals.push(`entry:${extendEntry.text}`);}

  return {
    opened: Boolean(availableDurations.length || timelineProbe.detected || submitCandidate),
    signals,
    labels,
    availableDurations,
    timelineProbe,
    submitCandidate,
  };
}

async function detectFinalSubmitControl(page, options = {}) {
  const entryLabel = String(options.entryLabel || '').trim();
  const includeExtendLabel = Boolean(options.includeExtendLabel);

  const xpathCandidate = await firstVisibleXPathLocator(page, KNOWN_EXTEND_SUBMIT_PROBES);
  if (xpathCandidate) {
    const candidateMeta = await page.evaluate(({ selector }) => {
      const norm = (value) => String(value || '').replace(/\s+/g, ' ').trim();
      const node = document.querySelector(selector);
      if (!node) {return null;}
      return {
        label: norm(node.innerText || node.textContent || node.getAttribute('aria-label') || node.getAttribute('title') || node.value || ''),
        tagName: String(node.tagName || ''),
        type: String(node.getAttribute('type') || ''),
        disabled: Boolean(node.disabled || node.getAttribute('aria-disabled') === 'true'),
      };
    }, { selector: xpathCandidate.selector }).catch(() => null);
    if (candidateMeta && !candidateMeta.disabled) {
      return {
        selector: xpathCandidate.selector,
        label: candidateMeta.label || 'Extend Video',
        score: 1000,
        tagName: candidateMeta.tagName || 'BUTTON',
        type: candidateMeta.type || '',
        source: xpathCandidate.source || 'known_extend_submit_xpath',
      };
    }
  }

  const candidate = await page.evaluate(({ entryLabel: rawEntryLabel, includeExtendLabel: allowExtendLabel }) => {
    const isVisible = (node) => {
      if (!(node instanceof Element)) {return false;}
      const style = window.getComputedStyle(node);
      if (!style || style.visibility === 'hidden' || style.display === 'none') {return false;}
      const rect = node.getBoundingClientRect();
      return rect.width > 1 && rect.height > 1;
    };
    const norm = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const entryLabel = norm(rawEntryLabel);
    const positive = [
      /生成视频/i,
      /继续生成/i,
      /提交/i,
      /创建/i,
      /开始生成/i,
      /延长/i,
      /扩展/i,
      /generate/i,
      /submit/i,
      /create/i,
      /continue/i,
      /extend/i,
    ];
    const negative = [
      /^\+?6s?$/i,
      /^\+?10s?$/i,
      /下载/i,
      /download/i,
      /共享/i,
      /share/i,
      /登录|注册|sign in|log in/i,
      /上传|upload/i,
      /取消|close|关闭|back/i,
      /项目|历史|history|project/i,
      /删除|remove/i,
    ];

    const nodes = Array.from(document.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"], a[role="button"]'));
    let best = null;

    const scored = nodes.map((node, index) => {
      if (!isVisible(node)) {return null;}
      const label = norm(node.innerText || node.textContent || node.getAttribute('aria-label') || node.value || '');
      const disabled = node.disabled || node.getAttribute('aria-disabled') === 'true';
      if (!label || disabled) {return null;}
      if (negative.some((re) => re.test(label))) {return null;}
      const positiveMatches = positive.filter((re) => re.test(label)).length;
      if (!positiveMatches) {return null;}
      if (!allowExtendLabel && entryLabel && label === entryLabel) {return null;}

      let score = positiveMatches * 10;
      if (node.tagName === 'BUTTON') {score += 3;}
      if (node.getAttribute('type') === 'submit') {score += 8;}
      if (/primary|accent|submit|confirm|generate|create|extend/i.test(node.className || '')) {score += 4;}
      if (node.closest('form')) {score += 3;}
      if (node.closest('[role="dialog"], dialog, [aria-modal="true"]')) {score += 4;}
      if (entryLabel && label === entryLabel) {score += 1;}

      node.setAttribute('data-crawclaw-submit-candidate', '0');
      return {
        index,
        label,
        tagName: node.tagName,
        type: node.getAttribute('type') || '',
        score,
      };
    }).filter(Boolean);

    scored.sort((a, b) => b.score - a.score || a.index - b.index);
    if (scored[0]) {
      const node = nodes[scored[0].index];
      if (node) {
        node.setAttribute('data-crawclaw-submit-candidate', '1');
        best = {
          selector: '[data-crawclaw-submit-candidate="1"]',
          label: scored[0].label,
          score: scored[0].score,
          tagName: scored[0].tagName,
          type: scored[0].type,
        };
      }
    }

    return best;
  }, {
    entryLabel,
    includeExtendLabel,
  }).catch(() => null);

  return candidate;
}

async function safePageUrl(page) {
  if (!page) {return '';}
  try {
    return page.url();
  } catch {
    return '';
  }
}

async function summarizeObservedPages(context, primaryPage) {
  const rawPages = [];
  if (primaryPage) {rawPages.push(primaryPage);}
  rawPages.push(...(await getContextPages(context)));

  const pages = [];
  const seen = new Set();
  for (const candidate of rawPages) {
    if (!candidate || seen.has(candidate)) {continue;}
    seen.add(candidate);
    pages.push(candidate);
  }

  const summaries = [];
  for (let index = 0; index < pages.length; index += 1) {
    const current = pages[index];
    const closed = typeof current.isClosed === 'function' ? current.isClosed() : false;
    const url = closed ? '' : await safePageUrl(current);
    summaries.push({
      index,
      closed,
      url,
      postId: extractPostIdFromUrl(url),
      isPrimary: current === primaryPage,
    });
  }
  return summaries;
}

async function observeDerivedResult({ page, context, sourceResultUrl, stage = 'initial', watchState = null }) {
  const pageSummaries = await summarizeObservedPages(context, page);
  const rawPages = [];
  if (page) {rawPages.push(page);}
  rawPages.push(...(await getContextPages(context)));

  const pages = [];
  const seen = new Set();
  for (const candidate of rawPages) {
    if (!candidate || seen.has(candidate)) {continue;}
    seen.add(candidate);
    pages.push(candidate);
  }

  const baselineUrls = watchState && watchState.baselineUrls instanceof Set
    ? watchState.baselineUrls
    : new Set(Array.isArray(watchState && watchState.baselineUrls) ? watchState.baselineUrls : []);

  let best = null;
  const suspiciousCandidates = [];
  let aggregateCandidates = [];
  let firstCompletion = null;

  for (let index = 0; index < pages.length; index += 1) {
    const current = pages[index];
    const closed = typeof current.isClosed === 'function' ? current.isClosed() : false;
    if (closed) {continue;}

    const currentUrl = await safePageUrl(current);
    const candidates = Array.from(new Set([currentUrl, ...(await scanResultUrls(current))].filter(Boolean)));
    aggregateCandidates = Array.from(new Set([...aggregateCandidates, ...candidates]));
    const candidateUrl = pickDerivedResultUrl(sourceResultUrl, candidates);

    let completion = null;
    if (current === page || candidateUrl || currentUrl === sourceResultUrl) {
      completion = await detectCompletion(current).catch(() => null);
      if (!firstCompletion && completion) {firstCompletion = completion;}
    }

    const startedSignals = [];
    if (completion && completion.progressSignals && completion.progressSignals.length) {
      startedSignals.push(...completion.progressSignals.map((item) => `progress:${item}`));
    }
    if (completion && completion.completionSignals && completion.completionSignals.length) {
      startedSignals.push(...completion.completionSignals.map((item) => `completion:${item}`));
    }

    const verdict = classifyDerivedCaptureCandidate({
      sourceResultUrl,
      stage,
      candidateUrl,
      currentUrl,
      observationSource: current === page ? 'primary_page' : 'context_page',
      baselineUrls,
    });

    if (candidateUrl && verdict.verdict !== 'confirmed_derived') {
      suspiciousCandidates.push({
        pageIndex: index,
        observationSource: current === page ? 'primary_page' : 'context_page',
        currentUrl,
        candidateUrl,
        verdict: verdict.verdict,
        reasons: verdict.reasons,
      });
    }

    const observation = {
      pageIndex: index,
      currentUrl,
      candidates,
      derivedUrl: verdict.verdict === 'confirmed_derived' ? candidateUrl : '',
      candidateUrl,
      candidateVerdict: verdict.verdict,
      candidateVerdictReasons: verdict.reasons,
      completion,
      startedSignals,
      observationSource: current === page ? 'primary_page' : 'context_page',
    };

    if (!best) {
      best = observation;
    }
    if (observation.derivedUrl) {
      best = observation;
      break;
    }
    if (!best.derivedUrl && observation.candidateVerdict !== 'no_candidate' && observation.candidateVerdict !== 'source_page') {
      best = observation;
    }
    if (!best.derivedUrl && startedSignals.length > (best.startedSignals || []).length) {
      best = observation;
    }
  }

  const fallbackUrl = await safePageUrl(page);
  const fallbackVerdict = suspiciousCandidates[0] || null;
  return {
    derivedUrl: best && best.derivedUrl ? best.derivedUrl : '',
    derivedVerdict: best && best.derivedUrl ? 'confirmed_derived' : (fallbackVerdict ? fallbackVerdict.verdict : 'no_candidate'),
    derivedVerdictReasons: best && best.derivedUrl
      ? (best.candidateVerdictReasons || [])
      : (fallbackVerdict ? fallbackVerdict.reasons || [] : ['no_trusted_candidate']),
    observedUrl: (best && best.currentUrl) || fallbackUrl,
    observedResultUrls: aggregateCandidates,
    completion: (best && best.completion) || firstCompletion,
    startedSignals: best ? best.startedSignals || [] : [],
    observationSource: best ? best.observationSource : 'primary_page',
    observedPageIndex: best ? best.pageIndex : 0,
    pageSummaries,
    suspiciousCandidates,
    candidateUrl: best ? best.candidateUrl || '' : '',
  };
}

async function waitForDerivedResult({ page, context, sourceResultUrl, timeoutMs = 25000, intervalMs = 1000, logger = null, stage = 'submit', onTick = null, baselineStartedSignals = [] }) {
  const started = Date.now();
  let lastUrl = await safePageUrl(page);
  let lastDerived = '';
  let lastSignals = [];
  const baselineSignalsSet = new Set((Array.isArray(baselineStartedSignals) ? baselineStartedSignals : []).map((item) => String(item || '').trim()).filter(Boolean));
  let lastPagesKey = '';
  let lastVerdictKey = '';
  let lastHeartbeatAt = 0;
  const baselinePageSummaries = await summarizeObservedPages(context, page);
  const watchState = {
    startedAt: nowIso(),
    baselinePageSummaries,
    baselineUrls: new Set(baselinePageSummaries.map((item) => String(item.url || '').trim()).filter(Boolean)),
  };

  while (Date.now() - started <= timeoutMs) {
    const observation = await observeDerivedResult({ page, context, sourceResultUrl, stage, watchState });
    const currentUrl = observation.observedUrl || await safePageUrl(page);
    const candidates = observation.observedResultUrls || [];
    const derivedUrl = observation.derivedUrl || '';
    const completion = observation.completion || await detectCompletion(page).catch(() => ({ status: 'unknown', progressSignals: [], completionSignals: [] }));
    const rawStartedSignals = Array.from(new Set(observation.startedSignals || []));
    const startedSignals = rawStartedSignals.filter((item) => !baselineSignalsSet.has(String(item || '').trim()));
    const pageSummaries = observation.pageSummaries || [];
    const pagesKey = JSON.stringify(pageSummaries.map((item) => [item.index, item.closed, item.url]));
    const verdictPayload = {
      derivedVerdict: observation.derivedVerdict || (derivedUrl ? 'confirmed_derived' : 'no_candidate'),
      derivedVerdictReasons: observation.derivedVerdictReasons || [],
      suspiciousCandidates: observation.suspiciousCandidates || [],
      candidateUrl: observation.candidateUrl || '',
    };
    const verdictKey = JSON.stringify(verdictPayload);

    if (logger) {
      if (currentUrl !== lastUrl) {
        logger.info('extend.result_url_watch.url_changed', {
          stage,
          fromUrl: lastUrl,
          currentUrl,
          sourceResultUrl,
          observationSource: observation.observationSource,
          observedPageIndex: observation.observedPageIndex,
        });
        lastUrl = currentUrl;
      }
      if (pagesKey !== lastPagesKey) {
        logger.info('extend.result_url_watch.pages_changed', {
          stage,
          sourceResultUrl,
          pageSummaries,
        });
        lastPagesKey = pagesKey;
      }
      if (derivedUrl && derivedUrl !== lastDerived) {
        logger.info('extend.result_url_watch.derived_visible', {
          stage,
          currentUrl,
          sourceResultUrl,
          derivedUrl,
          candidates,
          observationSource: observation.observationSource,
          observedPageIndex: observation.observedPageIndex,
          derivedVerdict: verdictPayload.derivedVerdict,
          derivedVerdictReasons: verdictPayload.derivedVerdictReasons,
        });
        lastDerived = derivedUrl;
      }
      if (verdictKey !== lastVerdictKey) {
        logger.info('extend.result_url_watch.capture_verdict', {
          stage,
          currentUrl,
          sourceResultUrl,
          ...verdictPayload,
        });
        lastVerdictKey = verdictKey;
      }
      const signalKey = JSON.stringify(startedSignals);
      if (signalKey !== JSON.stringify(lastSignals)) {
        logger.info('extend.result_url_watch.signals', {
          stage,
          currentUrl,
          sourceResultUrl,
          startedSignals,
          completionStatus: completion.status,
          observationSource: observation.observationSource,
          observedPageIndex: observation.observedPageIndex,
        });
        lastSignals = startedSignals;
      }
      if (Date.now() - lastHeartbeatAt >= Math.max(10000, intervalMs * 5)) {
        logger.info('extend.result_url_watch.heartbeat', {
          stage,
          currentUrl,
          sourceResultUrl,
          waitedMs: Date.now() - started,
          activePages: pageSummaries.filter((item) => !item.closed).length,
          observationSource: observation.observationSource,
          derivedVerdict: verdictPayload.derivedVerdict,
        });
        lastHeartbeatAt = Date.now();
      }
    }

    const payload = {
      ok: Boolean(derivedUrl),
      derivedUrl,
      derivedVerdict: verdictPayload.derivedVerdict,
      derivedVerdictReasons: verdictPayload.derivedVerdictReasons,
      suspiciousCandidates: verdictPayload.suspiciousCandidates,
      candidateUrl: verdictPayload.candidateUrl,
      observedUrl: currentUrl,
      observedResultUrls: candidates,
      completion,
      started: Boolean(derivedUrl || startedSignals.length),
      startedSignals,
      captureStage: stage,
      waitedMs: Date.now() - started,
      timeout: false,
      observationSource: observation.observationSource,
      observedPageIndex: observation.observedPageIndex,
      pageSummaries,
      baselinePageSummaries,
    };

    if (typeof onTick === 'function') {
      await onTick(payload);
    }

    if (derivedUrl) {
      return payload;
    }

    await sleep(intervalMs);
  }

  const finalObservation = await observeDerivedResult({ page, context, sourceResultUrl, stage, watchState });
  const completion = finalObservation.completion || await detectCompletion(page).catch(() => ({ status: 'unknown', progressSignals: [], completionSignals: [] }));
  return {
    ok: false,
    derivedUrl: finalObservation.derivedUrl || '',
    derivedVerdict: finalObservation.derivedVerdict || 'no_candidate',
    derivedVerdictReasons: finalObservation.derivedVerdictReasons || ['watch_timeout_without_trusted_candidate'],
    suspiciousCandidates: finalObservation.suspiciousCandidates || [],
    candidateUrl: finalObservation.candidateUrl || '',
    observedUrl: finalObservation.observedUrl || await safePageUrl(page),
    observedResultUrls: finalObservation.observedResultUrls || [],
    completion,
    started: Boolean((finalObservation.startedSignals || []).length),
    startedSignals: finalObservation.startedSignals || [],
    captureStage: stage,
    waitedMs: Date.now() - started,
    timeout: true,
    observationSource: finalObservation.observationSource || 'primary_page',
    observedPageIndex: finalObservation.observedPageIndex || 0,
    pageSummaries: finalObservation.pageSummaries || [],
    baselinePageSummaries,
  };
}

function mergeDerivedRelation({ sourceResultUrl, newResultUrl, requestedDuration, timelineMode, pageUrl }) {
  return {
    sourcePostId: extractPostIdFromUrl(sourceResultUrl),
    sourceResultUrl,
    newPostId: extractPostIdFromUrl(newResultUrl),
    newResultUrl: newResultUrl || '',
    extendDuration: requestedDuration || '',
    timelineMode: timelineMode || 'manual_handoff',
    lastObservedUrl: pageUrl || sourceResultUrl || '',
  };
}

function buildExtendHandoff({ job, profile, sourceResultUrl, relation, payload, manualHandoffWatchMs, headless, observedUrl, startedAt }) {
  const watching = manualHandoffWatchMs > 0;
  const samePageHint = payload.extendEntry && payload.extendEntry.found
    ? '继续在当前打开的 extend 页面上操作，不要切 profile，也不要重新从 source result 另开一套流程。'
    : '如果当前 run 没能打开 extend entry，请先确认 source result 页面上该动作确实可见。';

  return {
    ok: true,
    action: 'extend_manual_handoff',
    jobId: job.jobId,
    jobDir: job.jobDir,
    profile,
    checkedAt: payload.checkedAt || nowIso(),
    startedAt,
    status: relation.newResultUrl
      ? 'captured'
      : payload.handoff && payload.handoff.required
        ? (watching ? (payload.capture && payload.capture.timeout ? 'watch_timed_out' : 'watching_or_ready') : 'ready_for_manual_handoff')
        : 'ready',
    sourcePostId: relation.sourcePostId,
    sourceResultUrl,
    newPostId: relation.newPostId,
    newResultUrl: relation.newResultUrl,
    extendDuration: relation.extendDuration,
    timelineMode: relation.timelineMode,
    currentUrl: observedUrl || relation.lastObservedUrl || sourceResultUrl,
    extendEntry: payload.extendEntry,
    timelineProbe: payload.timelineProbe || null,
    timelineBoundary: payload.timelineProbe && payload.timelineProbe.boundary ? payload.timelineProbe.boundary : null,
    timelineAdjustment: payload.timelineAdjustment || null,
    finalSubmit: payload.finalSubmit,
    capture: {
      active: watching,
      captureStage: payload.capture ? payload.capture.captureStage || payload.capture.stage || '' : '',
      started: Boolean(payload.capture && payload.capture.started),
      waitedMs: payload.capture ? payload.capture.waitedMs : 0,
      timeout: Boolean(payload.capture && payload.capture.timeout),
      observationSource: payload.capture ? payload.capture.observationSource : '',
      observedPageIndex: payload.capture ? payload.capture.observedPageIndex : 0,
      pageSummaries: payload.capture ? payload.capture.pageSummaries || [] : [],
      baselinePageSummaries: payload.capture ? payload.capture.baselinePageSummaries || [] : [],
      derivedVerdict: payload.capture ? payload.capture.derivedVerdict || '' : '',
      derivedVerdictReasons: payload.capture ? payload.capture.derivedVerdictReasons || [] : [],
      suspiciousCandidates: payload.capture ? payload.capture.suspiciousCandidates || [] : [],
      timeoutMs: manualHandoffWatchMs,
      headfulRequiredForHuman: Boolean(watching && headless),
    },
    instructions: relation.newResultUrl
      ? [
          '新的 derived result URL 已落盘，可以直接转到 wait/download。',
          `优先使用同 job 继续：node skills/grok-video-web/scripts/grok_video_wait.js --job-id ${job.jobId} --result-url ${JSON.stringify(relation.newResultUrl)}`,
        ]
      : [
          samePageHint,
          relation.extendDuration
            ? `如果 ${relation.extendDuration} 已经点上，就只做人手 timeline 调整；不要再重复点别的 duration，除非明确要改。`
            : '如果脚本还没成功选上 +6s / +10s，可由人手在当前 extend UI 中补点。',
          payload.timelineAdjustment && payload.timelineAdjustment.requested
            ? `timeline 目标：${JSON.stringify(payload.timelineAdjustment.targetRange || {})}；校验结果：${payload.timelineAdjustment.evaluation ? payload.timelineAdjustment.evaluation.outcome : 'unknown'}${payload.timelineAdjustment.evaluation && payload.timelineAdjustment.evaluation.failureReason ? ` (${payload.timelineAdjustment.evaluation.failureReason})` : ''}`
            : (payload.timelineProbe && payload.timelineProbe.boundary && payload.timelineProbe.boundary.summary
              ? `timeline 边界：${payload.timelineProbe.boundary.summary}`
              : 'timeline 拖拽/选区仍由人工完成；这一步暂不自动化。'),
          payload.finalSubmit && payload.finalSubmit.clicked
            ? '脚本已经尝试点过 final submit；现在主要是继续观察是否出现新的 /imagine/post/<id>。'
            : '调完 timeline 后，可由人工点最终 submit；如果页面上已经出现稳定主按钮，脚本后续 run 也可再尝试保守点击。',
          watching
            ? (headless
              ? '当前 run 虽然在 watching，但不是 headful；人工无法直接接管这个浏览器窗口。若需要人手接管，请改用 --headful --manual-handoff-wait-sec <seconds>。'
              : '当前 run 正在 watching：保持这个窗口/标签页打开，脚本会继续从当前页、跳转页或新 tab/popup 里捕获 derived result URL。')
            : '如果要让脚本边观察边接住 derived result URL，请重跑：--headful --manual-handoff-wait-sec <seconds>。',
        ],
    resumeCommandHint: payload.handoff ? payload.handoff.resumeCommandHint : '',
    recordDerivedUrlHint: `node skills/grok-video-web/scripts/grok_video_extend.js --job-id ${job.jobId} --new-result-url <derived-result-url>`,
    stateFile: job.files.extendHandoffPath,
  };
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
  job.files.extendHandoffPath = job.files.extendHandoffPath || path.join(job.stateDir, 'extend-handoff.json');

  const logger = createLogger(job, { script: 'grok_video_extend' });
  const sourceResultUrl = resolveResultUrl(job, args['result-url']);
  if (!sourceResultUrl) {
    throw new Error('unable to resolve source result URL from --result-url or job state');
  }

  const profile = args.profile || job.profile;
  const headless = !args.headful;
  const requestedDuration = normalizeExtendDuration(args['extend-duration']);
  const initialTimelineRequest = resolveTimelineRequest(job, args, null);
  const initialTimelineRequestSummary = summarizeTimelineRequest(initialTimelineRequest);
  const detectOnly = Boolean(args['detect-only']);
  const openEntry = !args['no-open-entry'] && !detectOnly;
  const allowSubmitClick = !args['no-submit-click'] && !detectOnly;
  const submitWatchMs = Math.max(0, Number(args['submit-timeout-sec'] || 25)) * 1000;
  const manualHandoffWatchMs = Math.max(0, Number(args['manual-handoff-wait-sec'] || 0)) * 1000;
  const startedAt = nowIso();

  const initialRelation = mergeDerivedRelation({
    sourceResultUrl,
    newResultUrl: args['new-result-url'] || '',
    requestedDuration,
    timelineMode: args['timeline-mode'] || 'manual_handoff',
    pageUrl: sourceResultUrl,
  });
  const initialLineage = recordLineage(job, {
    actionType: resolveActionType(job, 'extend_video'),
    sourceResultUrl,
    newResultUrl: args['new-result-url'] || '',
    extendDuration: requestedDuration || '',
    timelineMode: args['timeline-mode'] || 'manual_handoff',
    status: 'probing',
    checkedAt: startedAt,
    note: 'Starting derivative extend-video probe from existing result page.',
    lastObservedUrl: sourceResultUrl,
  });

  logger.info('extend.start', {
    phase: 'extend_prepare',
    currentUrl: sourceResultUrl,
    resultUrl: sourceResultUrl,
    requestedDuration,
    timelineRequest: initialTimelineRequestSummary,
    detectOnly,
    openEntry,
    allowSubmitClick,
    submitWatchMs,
    manualHandoffWatchMs,
    message: 'Preparing extend-video derivative flow from existing Grok result.',
  });

  writeJson(job.files.extendStatePath, {
    ok: true,
    action: 'extend',
    startedAt,
    jobId: job.jobId,
    jobDir: job.jobDir,
    profile,
    status: 'probing',
    source: initialRelation,
    derived: {
      ...initialRelation,
    },
    timelineRequest: initialTimelineRequestSummary,
    lineage: initialLineage.current || {},
  });
  writeJson(job.files.extendHandoffPath, {
    ok: true,
    action: 'extend_manual_handoff',
    startedAt,
    checkedAt: startedAt,
    jobId: job.jobId,
    jobDir: job.jobDir,
    profile,
    status: 'probing',
    sourcePostId: initialRelation.sourcePostId,
    sourceResultUrl,
    newPostId: initialRelation.newPostId,
    newResultUrl: initialRelation.newResultUrl,
    extendDuration: initialRelation.extendDuration,
    timelineMode: initialRelation.timelineMode,
    timelineRequest: initialTimelineRequestSummary,
    currentUrl: sourceResultUrl,
    instructions: [
      '脚本正在准备 extend handoff；完成 probe 后会把当前人工接管说明写回这个文件。',
    ],
    stateFile: job.files.extendHandoffPath,
  });

  updateWorkflowStatus(job, {
    status: 'running',
    blocked: false,
    phase: 'extend_prepare',
    currentUrl: sourceResultUrl,
    resultUrl: sourceResultUrl,
    sourcePostId: initialRelation.sourcePostId,
    sourceResultUrl,
    actionType: 'extend_video',
    newPostId: initialLineage.current?.newPostId || '',
    newResultUrl: initialLineage.current?.newResultUrl || '',
    lineage: initialLineage.current || {},
  });
  clearWorkflowBlockReason(job);
  writeWorkflowResultUrl(job, sourceResultUrl);
  appendWorkflowCheckpoint(job, {
    kind: 'extend_started',
    step: 'extend',
    status: 'running',
    url: sourceResultUrl,
    resultUrl: sourceResultUrl,
    note: 'Starting derivative extend-video probe from existing result page.',
    actionType: 'extend_video',
    lineage: initialLineage.current || {},
  });
  updateManifest(job, {
    action: 'extend_video',
    profile,
    extend: {
      mode: 'derivative_from_result',
      startedAt,
      sourcePostId: initialRelation.sourcePostId,
      sourceResultUrl,
      newPostId: initialRelation.newPostId,
      newResultUrl: initialRelation.newResultUrl,
      extendDuration: requestedDuration || '',
      prompt: resolveExtendPrompt(job, args) || '',
      timelineMode: args['timeline-mode'] || 'manual_handoff',
      timelineStartPct: initialTimelineRequestSummary.targetStartPct,
      timelineEndPct: initialTimelineRequestSummary.targetEndPct,
      timelineTolerancePct: initialTimelineRequestSummary.tolerancePct,
      targetStartPct: initialTimelineRequestSummary.targetStartPct,
      targetEndPct: initialTimelineRequestSummary.targetEndPct,
      targetTolerancePct: initialTimelineRequestSummary.tolerancePct,
      timelineRequestValid: initialTimelineRequestSummary.valid,
      timelineRequestErrors: initialTimelineRequestSummary.validationErrors,
    },
    lineage: initialLineage.current || {},
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

    logger.info('extend.browser_launched', {
      phase: 'extend_prepare',
      currentUrl: sourceResultUrl,
      resultUrl: sourceResultUrl,
      profile,
      path: launched.profileDir || resolveProfileDir(profile),
      headless,
    });

    const loginGate = await confirmLoggedInAtSafeEntry({
      page,
      job,
      logger,
      action: 'extend',
    });
    if (!loginGate.ok) {
      const blockedAt = loginGate.checkedAt;
      const gateRelation = mergeDerivedRelation({
        sourceResultUrl,
        newResultUrl: '',
        requestedDuration,
        timelineMode: args['timeline-mode'] || 'manual_handoff',
        pageUrl: loginGate.currentUrl || loginGate.safeEntryUrl || sourceResultUrl,
      });
      const gateBlock = {
        ok: false,
        action: 'extend',
        jobId: job.jobId,
        jobDir: job.jobDir,
        profile,
        status: loginGate.status,
        source: gateRelation,
        derived: gateRelation,
        blocker: {
          type: 'account_login_gate',
          reasonCode: loginGate.blockerReasonCode,
          safeEntryUrl: loginGate.safeEntryUrl,
          currentUrl: loginGate.currentUrl,
          loginState: loginGate.state,
          matchedSignals: loginGate.signals,
        },
        handoff: {
          required: true,
          reason: loginGate.blockerReasonCode,
          note: 'Extend cannot open the source result URL until the same profile is confirmed logged in via the safe Grok Imagine entry.',
          resumeCommandHint: `node skills/grok-video-web/scripts/grok_video_extend.js --job-id ${job.jobId} --result-url ${JSON.stringify(sourceResultUrl)}`,
        },
        checkedAt: blockedAt,
        stateFile: job.files.extendStatePath,
      };
      const gateLineage = recordLineage(job, {
        actionType: resolveActionType(job, 'extend_video'),
        sourceResultUrl,
        extendDuration: requestedDuration || '',
        timelineMode: args['timeline-mode'] || 'manual_handoff',
        status: gateBlock.status,
        checkedAt: blockedAt,
        note: gateBlock.handoff.note,
        lastObservedUrl: loginGate.currentUrl || loginGate.safeEntryUrl || sourceResultUrl,
      });
      gateBlock.lineage = gateLineage.current || {};
      writeJson(job.files.extendStatePath, gateBlock);
      writeJson(job.files.extendHandoffPath, {
        ok: false,
        action: 'extend_manual_handoff',
        checkedAt: blockedAt,
        jobId: job.jobId,
        jobDir: job.jobDir,
        profile,
        status: gateBlock.status,
        sourcePostId: gateRelation.sourcePostId,
        sourceResultUrl,
        newPostId: '',
        newResultUrl: '',
        extendDuration: requestedDuration || '',
        timelineMode: args['timeline-mode'] || 'manual_handoff',
        currentUrl: loginGate.currentUrl || loginGate.safeEntryUrl || sourceResultUrl,
        instructions: [
          '先在同 profile 的安全入口 https://grok.com 确认并恢复登录态。',
          '在登录态未确认前，不要直接打开 source result URL 或其他 account-gated 目标地址。',
          '登录恢复后，再回到同一个 job 继续 extend。',
        ],
        resumeCommandHint: gateBlock.handoff.resumeCommandHint,
        stateFile: job.files.extendHandoffPath,
      });
      appendJsonl(job.files.extendHistoryPath, {
        at: blockedAt,
        event: 'extend-login-gate-blocked',
        status: gateBlock.status,
        sourcePostId: gateRelation.sourcePostId,
        sourceResultUrl,
        extendDuration: requestedDuration || '',
        timelineMode: args['timeline-mode'] || 'manual_handoff',
        reasonCode: loginGate.blockerReasonCode,
      });
      updateManifest(job, {
        action: 'extend_video',
        extend: {
          ...job.manifest.extend,
          checkedAt: blockedAt,
          status: gateBlock.status,
          sourcePostId: gateRelation.sourcePostId,
          sourceResultUrl,
          newPostId: '',
          newResultUrl: '',
          extendDuration: requestedDuration || '',
          timelineMode: args['timeline-mode'] || 'manual_handoff',
          loginGate: {
            state: loginGate.state,
            safeEntryUrl: loginGate.safeEntryUrl,
            currentUrl: loginGate.currentUrl,
            signals: loginGate.signals,
          },
        },
        lineage: gateLineage.current || {},
      });
      updateWorkflowStatus(job, {
        status: gateBlock.status,
        blocked: true,
        phase: 'extend_login_gate_blocked',
        currentUrl: loginGate.currentUrl || loginGate.safeEntryUrl || sourceResultUrl,
        resultUrl: sourceResultUrl,
        sourcePostId: gateRelation.sourcePostId,
        sourceResultUrl,
        extendDuration: requestedDuration || '',
        timelineMode: args['timeline-mode'] || 'manual_handoff',
        blockerSignals: loginGate.signals.cloudflare || loginGate.signals.loggedOut || [],
        actionType: 'extend_video',
        lineage: gateLineage.current || {},
      });
      setWorkflowBlockReason(job, {
        status: gateBlock.status,
        reasonCode: loginGate.blockerReasonCode,
        summary: 'Safe-entry login gate blocked source-result navigation for extend.',
        currentUrl: loginGate.currentUrl || loginGate.safeEntryUrl || sourceResultUrl,
        matchedSignals: loginGate.signals.cloudflare || loginGate.signals.loggedOut || [],
      });
      appendWorkflowCheckpoint(job, {
        kind: 'extend_login_gate_blocked',
        step: 'extend',
        status: gateBlock.status,
        url: loginGate.currentUrl || loginGate.safeEntryUrl || sourceResultUrl,
        resultUrl: sourceResultUrl,
        note: `Safe-entry login gate blocked source result navigation: ${loginGate.blockerReasonCode}`,
        actionType: 'extend_video',
        lineage: gateLineage.current || {},
      });
      logger.warn('extend.login_gate_blocked', {
        status: gateBlock.status,
        phase: 'extend_login_gate_blocked',
        currentUrl: loginGate.currentUrl,
        resultUrl: sourceResultUrl,
        safeEntryUrl: loginGate.safeEntryUrl,
        matchedSignals: loginGate.signals,
      });
      console.log(JSON.stringify(gateBlock, null, 2));
      process.exitCode = 4;
      return;
    }

    await gotoResultPage(page, sourceResultUrl);
    const sourceCompletion = await detectCompletion(page);
    const sourceReady = sourceCompletion.status === 'completed';
    if (!sourceReady) {
      const sourceBlock = {
        ok: false,
        action: 'extend',
        jobId: job.jobId,
        jobDir: job.jobDir,
        profile,
        status: sourceCompletion.status === 'blocked' ? 'source_blocked' : 'source_not_ready',
        source: mergeDerivedRelation({
          sourceResultUrl,
          newResultUrl: '',
          requestedDuration,
          timelineMode: args['timeline-mode'] || 'manual_handoff',
          pageUrl: sourceCompletion.url || sourceResultUrl,
        }),
        derived: mergeDerivedRelation({
          sourceResultUrl,
          newResultUrl: '',
          requestedDuration,
          timelineMode: args['timeline-mode'] || 'manual_handoff',
          pageUrl: sourceCompletion.url || sourceResultUrl,
        }),
        completionSignals: sourceCompletion.completionSignals || [],
        blockerSignals: sourceCompletion.blockerSignals || [],
        progressSignals: sourceCompletion.progressSignals || [],
        handoff: {
          required: true,
          reason: sourceCompletion.status === 'blocked' ? 'source_result_page_blocked' : 'source_result_not_completed',
          note: 'Extend video must start from an already completed source result page.',
          resumeCommandHint: `node skills/grok-video-web/scripts/grok_video_extend.js --job-id ${job.jobId} --result-url ${JSON.stringify(sourceResultUrl)}`,
        },
        checkedAt: nowIso(),
        stateFile: job.files.extendStatePath,
      };
      const sourceLineage = recordLineage(job, {
        actionType: resolveActionType(job, 'extend_video'),
        sourceResultUrl,
        extendDuration: requestedDuration || '',
        timelineMode: args['timeline-mode'] || 'manual_handoff',
        status: sourceBlock.status,
        checkedAt: sourceBlock.checkedAt,
        note: sourceBlock.handoff.note,
        lastObservedUrl: sourceCompletion.url || sourceResultUrl,
      });
      sourceBlock.lineage = sourceLineage.current || {};
      writeJson(job.files.extendStatePath, sourceBlock);
      appendJsonl(job.files.extendHistoryPath, { at: nowIso(), event: 'source-not-ready', ...sourceBlock.source, status: sourceBlock.status });
      updateManifest(job, {
        extend: {
          ...job.manifest.extend,
          checkedAt: sourceBlock.checkedAt,
          status: sourceBlock.status,
          sourcePostId: sourceBlock.source.sourcePostId,
          sourceResultUrl,
          newPostId: '',
          newResultUrl: '',
          extendDuration: requestedDuration || '',
          timelineMode: args['timeline-mode'] || 'manual_handoff',
        },
        lineage: sourceLineage.current || {},
      });
      updateWorkflowStatus(job, {
        status: sourceCompletion.status === 'blocked' ? 'blocked_human_verification' : 'generating',
        blocked: sourceCompletion.status === 'blocked',
        phase: sourceCompletion.status === 'blocked' ? 'extend_source_blocked' : 'extend_source_not_ready',
        currentUrl: sourceCompletion.url || sourceResultUrl,
        resultUrl: sourceResultUrl,
        sourcePostId: sourceBlock.source.sourcePostId,
        sourceResultUrl,
        completionSignals: sourceCompletion.completionSignals || [],
        blockerSignals: sourceCompletion.blockerSignals || [],
        progressSignals: sourceCompletion.progressSignals || [],
        actionType: 'extend_video',
        newPostId: sourceLineage.current?.newPostId || '',
        newResultUrl: sourceLineage.current?.newResultUrl || '',
        lineage: sourceLineage.current || {},
      });
      if (sourceCompletion.status === 'blocked') {
        setWorkflowBlockReason(job, {
          status: 'blocked_human_verification',
          reasonCode: 'extend_source_blocked',
          summary: 'Source result page is blocked before extend can begin.',
          currentUrl: sourceCompletion.url || sourceResultUrl,
          matchedSignals: sourceCompletion.blockerSignals || [],
        });
      }
      appendWorkflowCheckpoint(job, {
        kind: sourceCompletion.status === 'blocked' ? 'extend_source_blocked' : 'extend_source_not_ready',
        step: 'extend',
        status: sourceCompletion.status === 'blocked' ? 'blocked_human_verification' : 'generating',
        url: sourceCompletion.url || sourceResultUrl,
        resultUrl: sourceResultUrl,
        note: (sourceCompletion.blockerSignals || sourceCompletion.progressSignals || []).join(', ') || sourceBlock.status,
        actionType: 'extend_video',
        lineage: sourceLineage.current || {},
      });
      writeJson(job.files.extendHandoffPath, {
        ok: false,
        action: 'extend_manual_handoff',
        checkedAt: sourceBlock.checkedAt,
        jobId: job.jobId,
        jobDir: job.jobDir,
        profile,
        status: sourceBlock.status,
        sourcePostId: sourceBlock.source.sourcePostId,
        sourceResultUrl,
        newPostId: '',
        newResultUrl: '',
        extendDuration: requestedDuration || '',
        timelineMode: args['timeline-mode'] || 'manual_handoff',
        currentUrl: sourceCompletion.url || sourceResultUrl,
        instructions: [
          'extend 只能从已完成的 source result page 开始。',
          sourceCompletion.status === 'blocked'
            ? '先在同 profile 里处理人机验证/阻断，再回到同一个 job 继续 extend。'
            : '先等 source result 生成完成，再重跑 extend。',
        ],
        resumeCommandHint: sourceBlock.handoff.resumeCommandHint,
        stateFile: job.files.extendHandoffPath,
      });
      console.log(JSON.stringify(sourceBlock, null, 2));
      process.exitCode = sourceCompletion.status === 'blocked' ? 4 : 3;
      return;
    }

    let primaryExtendEntry = await detectSecondaryMenuTrigger(page);
    let secondaryExtendEntry = null;
    let primaryEntryClicked = false;
    let secondaryEntryClicked = false;
    let primaryEntryFailReason = '';
    let secondaryEntryFailReason = '';

    if (!primaryExtendEntry) {
      primaryEntryFailReason = 'secondary_menu_trigger_not_found';
    } else if (openEntry) {
      try {
        await page.click(primaryExtendEntry.selector, { delay: 30 });
        primaryEntryClicked = true;
        await page.waitForTimeout(900);
        secondaryExtendEntry = await waitForLocator(page, detectSecondaryExtendEntry, { timeoutMs: 3500, intervalMs: 250 });
        if (!secondaryExtendEntry) {
          secondaryEntryFailReason = 'secondary_extend_menu_item_not_found_after_menu_open';
          logger.warn('extend.secondary_entry_missing', {
            phase: 'extend_probe',
            currentUrl: await safePageUrl(page),
            resultUrl: sourceResultUrl,
            primarySelector: primaryExtendEntry.selector,
            primarySource: primaryExtendEntry.source || '',
            reason: secondaryEntryFailReason,
          });
        }
      } catch (error) {
        primaryEntryFailReason = 'secondary_menu_trigger_click_failed';
        logger.warn('extend.primary_entry_click_failed', {
          phase: 'extend_probe',
          currentUrl: await safePageUrl(page),
          resultUrl: sourceResultUrl,
          message: error.message,
          selector: primaryExtendEntry.selector,
          source: primaryExtendEntry.source || '',
        });
      }
    } else {
      secondaryEntryFailReason = 'secondary_extend_menu_item_not_probed_without_menu_open';
    }

    if (secondaryExtendEntry && openEntry) {
      try {
        await page.click(secondaryExtendEntry.selector, { delay: 30 });
        secondaryEntryClicked = true;
        await page.waitForTimeout(1200);
      } catch (error) {
        secondaryEntryFailReason = 'secondary_extend_menu_item_click_failed';
        logger.warn('extend.secondary_entry_click_failed', {
          phase: 'extend_probe',
          currentUrl: await safePageUrl(page),
          resultUrl: sourceResultUrl,
          message: error.message,
          selector: secondaryExtendEntry.selector,
          source: secondaryExtendEntry.source || '',
        });
      }
    } else if (!secondaryExtendEntry && !secondaryEntryFailReason) {
      secondaryEntryFailReason = primaryEntryClicked
        ? 'secondary_extend_menu_item_not_found_after_menu_open'
        : 'secondary_extend_menu_item_not_found';
    }

    const extendEntry = secondaryExtendEntry;
    const extendEntryOpened = secondaryEntryClicked;
    const extendPrompt = resolveExtendPrompt(job, args);
    let extendPromptFill = {
      requested: Boolean(extendPrompt),
      prompt: extendPrompt || '',
      ok: false,
      selector: '',
      note: extendPrompt ? 'pending' : 'not_requested',
      valueExcerpt: '',
    };
    if (extendEntryOpened && extendPrompt && !detectOnly) {
      extendPromptFill = {
        ...extendPromptFill,
        ...(await fillExtendPrompt(page, extendPrompt, logger)),
      };
      await page.waitForTimeout(500).catch(() => {});
    }

    let availableDurations = await collectAvailableExtendDurations(page);
    let selectedDuration = '';
    const preferredDuration = requestedDuration || (availableDurations.includes('6s') ? '6s' : (availableDurations.includes('10s') ? '10s' : ''));
    if (preferredDuration && availableDurations.includes(preferredDuration) && !detectOnly) {
      const durationControl = await detectDurationControl(page, preferredDuration);
      if (durationControl) {
        try {
          await page.click(durationControl.selector, { delay: 30 });
          selectedDuration = preferredDuration;
          await page.waitForTimeout(800);
        } catch (error) {
          logger.warn('extend.duration_click_failed', {
            phase: 'extend_probe',
            currentUrl: page.url(),
            resultUrl: sourceResultUrl,
            message: error.message,
            requestedDuration: preferredDuration,
            selector: durationControl.selector,
          });
        }
      }
    }

    const extendMode = await detectExtendMode(page, extendEntry);
    availableDurations = extendMode.availableDurations;
    let timelineProbe = extendMode.timelineProbe;
    const timelineMode = args['timeline-mode'] || timelineProbe.timelineMode || 'manual_handoff';
    const timelineRequest = resolveTimelineRequest(job, args, timelineProbe);
    const timelinePlan = buildTimelineAdjustmentPlan(timelineProbe, timelineRequest);
    let timelineAdjustment = {
      requested: timelineRequest.requested,
      validRequest: timelineRequest.valid,
      requestErrors: timelineRequest.validationErrors,
      targetRange: timelineRequest.requested ? {
        startPct: timelineRequest.targetStartPct,
        endPct: timelineRequest.targetEndPct,
        tolerancePct: timelineRequest.tolerancePct,
      } : null,
      beforeProbe: timelineProbe,
      plan: timelinePlan,
      drag: {
        attempted: false,
        completed: false,
        actions: [],
        error: '',
      },
      evaluation: {
        outcome: timelineRequest.requested ? 'pending' : 'not_requested',
        failureReason: '',
        credibleChange: false,
        achieved: false,
      },
      afterProbe: null,
      manualHandoffRequired: false,
    };

    logger.info('extend.timeline_probe', {
      phase: 'extend_probe',
      currentUrl: page.url(),
      resultUrl: sourceResultUrl,
      timelineMode,
      counts: timelineProbe.counts,
      labels: timelineProbe.labels,
      boundaryClass: timelineProbe.boundary ? timelineProbe.boundary.class : '',
      boundaryReasons: timelineProbe.boundary ? timelineProbe.boundary.reasons : [],
      boundaryAutomationReady: Boolean(timelineProbe.boundary && timelineProbe.boundary.canAutoAdjust),
      unknowns: timelineProbe.unknowns || [],
      targetRange: timelineAdjustment.targetRange,
      planMode: timelinePlan.mode,
      planReasons: timelinePlan.reasons,
      plannedActions: timelinePlan.actions,
    });

    if (timelineRequest.requested) {
      if (!timelinePlan.ok) {
        timelineAdjustment.evaluation = {
          outcome: 'failed',
          failureReason: timelinePlan.reasons[0] || 'timeline_adjustment_plan_unavailable',
          credibleChange: false,
          achieved: false,
        };
        timelineAdjustment.manualHandoffRequired = true;
      } else if (timelinePlan.actions.length) {
        timelineAdjustment.drag.attempted = true;
        try {
          for (const action of timelinePlan.actions) {
            const dragResult = await performTimelineMouseDrag(page, action, timelineProbe);
            timelineAdjustment.drag.actions.push(dragResult);
            timelineProbe = await probeTimeline(page);
          }
          timelineAdjustment.drag.completed = true;
        } catch (error) {
          timelineAdjustment.drag.error = error.message;
        }
        if (!timelineAdjustment.afterProbe) {
          timelineAdjustment.afterProbe = timelineProbe;
        }
        timelineAdjustment.evaluation = evaluateTimelineAdjustment({
          timelineRequest,
          beforeProbe: timelineAdjustment.beforeProbe,
          afterProbe: timelineAdjustment.afterProbe || timelineProbe,
        });
        timelineAdjustment.manualHandoffRequired = timelineAdjustment.evaluation.outcome !== 'success';
      } else {
        timelineAdjustment.afterProbe = timelineProbe;
        timelineAdjustment.evaluation = {
          ...evaluateTimelineAdjustment({
            timelineRequest,
            beforeProbe: timelineAdjustment.beforeProbe,
            afterProbe: timelineAdjustment.afterProbe,
          }),
          outcome: 'success',
          failureReason: '',
          achieved: true,
          credibleChange: true,
          reasons: ['target_already_matches_current_selection'],
        };
        timelineAdjustment.manualHandoffRequired = false;
      }
      timelineAdjustment.afterProbe = timelineAdjustment.afterProbe || timelineProbe;
      logger[timelineAdjustment.evaluation.outcome === 'success' ? 'info' : 'warn']('extend.timeline_adjustment', {
        phase: 'extend_timeline_adjustment',
        currentUrl: await safePageUrl(page),
        resultUrl: sourceResultUrl,
        outcome: timelineAdjustment.evaluation.outcome,
        failureReason: timelineAdjustment.evaluation.failureReason,
        targetRange: timelineAdjustment.targetRange,
        beforeRange: timelineAdjustment.evaluation.beforeRange,
        afterRange: timelineAdjustment.evaluation.afterRange,
        credibleChange: timelineAdjustment.evaluation.credibleChange,
        achieved: timelineAdjustment.evaluation.achieved,
        dragActions: timelineAdjustment.drag.actions,
        dragError: timelineAdjustment.drag.error,
      });
    }

    let finalSubmit = {
      attempted: false,
      clicked: false,
      auto: false,
      selector: extendMode.submitCandidate ? extendMode.submitCandidate.selector : '',
      label: extendMode.submitCandidate ? extendMode.submitCandidate.label : '',
      score: extendMode.submitCandidate ? extendMode.submitCandidate.score : 0,
      reason: '',
      attemptedAt: '',
      error: '',
    };

    let capture = {
      mode: 'observation',
      stage: 'initial',
      captureStage: 'initial',
      waitedMs: 0,
      started: false,
      startedSignals: [],
      observedResultUrls: await scanResultUrls(page),
      observedUrl: await safePageUrl(page),
      timeout: false,
      observationSource: 'primary_page',
      observedPageIndex: 0,
      derivedVerdict: 'no_candidate',
      derivedVerdictReasons: ['initial_observation_only'],
      suspiciousCandidates: [],
      candidateUrl: '',
      pageSummaries: await summarizeObservedPages(context, page),
      baselinePageSummaries: [],
    };

    let manualRecordedUrl = String(args['new-result-url'] || '').trim();
    let newResultUrl = manualRecordedUrl || pickDerivedResultUrl(sourceResultUrl, capture.observedResultUrls) || '';

    const timelineReadyForSubmit = !timelineRequest.requested || timelineAdjustment.evaluation.outcome === 'success';

    if (!newResultUrl && extendEntry && allowSubmitClick && extendMode.submitCandidate && timelineReadyForSubmit) {
      finalSubmit = {
        ...finalSubmit,
        attempted: true,
        attemptedAt: nowIso(),
        auto: true,
      };
      try {
        const baselineCompletionBeforeSubmit = await detectCompletion(page).catch(() => null);
        const baselineStartedSignals = Array.from(new Set([
          ...((baselineCompletionBeforeSubmit && baselineCompletionBeforeSubmit.progressSignals) || []).map((item) => `progress:${item}`),
          ...((baselineCompletionBeforeSubmit && baselineCompletionBeforeSubmit.completionSignals) || []).map((item) => `completion:${item}`),
        ]));
        await page.click(extendMode.submitCandidate.selector, { delay: 30 });
        finalSubmit.clicked = true;
        finalSubmit.reason = 'auto_submit_clicked';
        await page.waitForTimeout(1200);
        logger.info('extend.submit_clicked', {
          phase: 'extend_submit',
          currentUrl: page.url(),
          resultUrl: sourceResultUrl,
          selector: finalSubmit.selector,
          label: finalSubmit.label,
          score: finalSubmit.score,
          baselineStartedSignals,
        });
        if (submitWatchMs > 0) {
          capture = await waitForDerivedResult({
            page,
            context,
            sourceResultUrl,
            timeoutMs: submitWatchMs,
            intervalMs: 1000,
            logger,
            stage: 'auto_submit',
            baselineStartedSignals,
          });
          newResultUrl = manualRecordedUrl || capture.derivedUrl || '';
        }
      } catch (error) {
        finalSubmit.clicked = false;
        finalSubmit.reason = 'auto_submit_click_failed';
        finalSubmit.error = error.message;
        logger.warn('extend.submit_click_failed', {
          phase: 'extend_submit',
          currentUrl: page.url(),
          resultUrl: sourceResultUrl,
          selector: finalSubmit.selector,
          label: finalSubmit.label,
          message: error.message,
        });
      }
    } else if (!newResultUrl) {
      finalSubmit.reason = !extendEntry
        ? (secondaryEntryFailReason || primaryEntryFailReason || 'extend_entry_missing')
        : !allowSubmitClick
          ? 'submit_click_disabled'
          : !timelineReadyForSubmit
            ? 'timeline_adjustment_not_confirmed'
            : extendMode.submitCandidate
              ? 'auto_submit_not_attempted'
              : 'submit_candidate_not_found';
    }

    if (!newResultUrl && manualHandoffWatchMs > 0) {
      if (!headless) {
        await page.bringToFront().catch(() => {});
      }
      logger.info('extend.manual_handoff_wait_started', {
        phase: 'extend_manual_handoff_wait',
        currentUrl: await safePageUrl(page),
        resultUrl: sourceResultUrl,
        timeoutMs: manualHandoffWatchMs,
        headless,
        note: 'Waiting on the current extend page so a human can adjust the timeline / click submit while the script captures the new result URL from the current tab or any newly opened result tab.',
      });
      writeJson(job.files.extendHandoffPath, {
        ok: true,
        action: 'extend_manual_handoff',
        checkedAt: nowIso(),
        startedAt,
        jobId: job.jobId,
        jobDir: job.jobDir,
        profile,
        status: headless ? 'watching_headless' : 'watching_headful',
        sourcePostId: initialRelation.sourcePostId,
        sourceResultUrl,
        newPostId: '',
        newResultUrl: '',
        extendDuration: selectedDuration || requestedDuration,
        timelineMode,
        currentUrl: await safePageUrl(page),
        timelineProbe,
        timelineBoundary: timelineProbe.boundary || null,
        timelineAdjustment,
        capture: {
          active: true,
          timeoutMs: manualHandoffWatchMs,
          headfulRequiredForHuman: headless,
          derivedVerdict: capture.derivedVerdict || 'no_candidate',
          derivedVerdictReasons: capture.derivedVerdictReasons || [],
          suspiciousCandidates: capture.suspiciousCandidates || [],
          pageSummaries: await summarizeObservedPages(context, page),
        },
        instructions: [
          '请继续在当前 extend 页面上完成人工 timeline 调整。',
          '调完后，可由人工点最终 submit；脚本会继续观察当前页、跳转页和新打开的结果页。',
          headless
            ? '当前是 headless watching，人工无法直接接管窗口；如需人手接管，请重跑并加 --headful。'
            : '保持这个窗口/标签页打开，不要切 profile，也不要另起一个无关页面去提交。',
        ],
        resumeCommandHint: `node skills/grok-video-web/scripts/grok_video_extend.js --job-id ${job.jobId} --result-url ${JSON.stringify(sourceResultUrl)} --manual-handoff-wait-sec 300 --headful`,
        recordDerivedUrlHint: `node skills/grok-video-web/scripts/grok_video_extend.js --job-id ${job.jobId} --new-result-url <derived-result-url>`,
        stateFile: job.files.extendHandoffPath,
      });
      capture = await waitForDerivedResult({
        page,
        context,
        sourceResultUrl,
        timeoutMs: manualHandoffWatchMs,
        intervalMs: 1000,
        logger,
        stage: 'manual_handoff',
        onTick: async (tick) => {
          writeJson(job.files.extendHandoffPath, {
            ok: true,
            action: 'extend_manual_handoff',
            checkedAt: nowIso(),
            startedAt,
            jobId: job.jobId,
            jobDir: job.jobDir,
            profile,
            status: tick.derivedUrl ? 'captured' : (tick.timeout ? 'watch_timed_out' : 'watching'),
            sourcePostId: initialRelation.sourcePostId,
            sourceResultUrl,
            newPostId: extractPostIdFromUrl(tick.derivedUrl || ''),
            newResultUrl: tick.derivedUrl || '',
            extendDuration: selectedDuration || requestedDuration,
            timelineMode,
            currentUrl: tick.observedUrl || sourceResultUrl,
            timelineProbe,
            timelineBoundary: timelineProbe.boundary || null,
            timelineAdjustment,
            capture: {
              active: !tick.derivedUrl,
              captureStage: tick.captureStage,
              started: tick.started,
              waitedMs: tick.waitedMs,
              timeout: tick.timeout,
              observationSource: tick.observationSource,
              observedPageIndex: tick.observedPageIndex,
              pageSummaries: tick.pageSummaries || [],
              baselinePageSummaries: tick.baselinePageSummaries || [],
              derivedVerdict: tick.derivedVerdict || 'no_candidate',
              derivedVerdictReasons: tick.derivedVerdictReasons || [],
              suspiciousCandidates: tick.suspiciousCandidates || [],
              timeoutMs: manualHandoffWatchMs,
              headfulRequiredForHuman: headless,
            },
            instructions: tick.derivedUrl
              ? [
                  '脚本已在当前 handoff 链路里捕获到新的 derived result URL。',
                  `下一步可直接 wait：node skills/grok-video-web/scripts/grok_video_wait.js --job-id ${job.jobId} --result-url ${JSON.stringify(tick.derivedUrl)}`,
                ]
              : [
                  '继续在当前 extend 页面完成人工 timeline 调整。',
                  '人工或脚本点 submit 后，脚本会继续从当前页或新 tab/popup 捕获 derived result URL。',
                ],
            stateFile: job.files.extendHandoffPath,
          });
        },
      });
      newResultUrl = manualRecordedUrl || capture.derivedUrl || '';
    }

    const observedUrl = capture.observedUrl || page.url();
    const relation = mergeDerivedRelation({
      sourceResultUrl,
      newResultUrl,
      requestedDuration: selectedDuration || requestedDuration,
      timelineMode,
      pageUrl: observedUrl,
    });

    const payload = {
      ok: Boolean(extendEntry),
      action: 'extend',
      mode: 'derivative_from_result',
      jobId: job.jobId,
      jobDir: job.jobDir,
      profile,
      status: newResultUrl
        ? 'submitted'
        : extendEntry
          ? (timelineRequest.requested && timelineAdjustment.evaluation.outcome !== 'success'
            ? (timelineAdjustment.evaluation.outcome === 'failed' ? 'timeline_adjust_failed' : 'timeline_adjust_unresolved')
            : finalSubmit.clicked
              ? 'submit_clicked_waiting_capture'
              : selectedDuration
                ? 'configured_handoff'
                : 'detected_handoff')
          : 'extend_entry_not_found',
      source: {
        sourcePostId: relation.sourcePostId,
        sourceResultUrl: relation.sourceResultUrl,
        newPostId: '',
        newResultUrl: '',
        extendDuration: '',
        timelineMode: 'source_result',
      },
      derived: relation,
      sourceCompletionSignals: sourceCompletion.completionSignals || [],
      primaryExtendEntry: {
        found: Boolean(primaryExtendEntry),
        clicked: primaryEntryClicked,
        selector: primaryExtendEntry ? primaryExtendEntry.selector : '',
        label: primaryExtendEntry ? primaryExtendEntry.text : '',
        source: primaryExtendEntry ? primaryExtendEntry.source || '' : '',
        xpath: primaryExtendEntry ? primaryExtendEntry.xpath || '' : '',
        clickTarget: primaryExtendEntry ? primaryExtendEntry.clickTarget || '' : '',
        failReason: primaryEntryFailReason,
      },
      secondaryExtendEntry: {
        found: Boolean(secondaryExtendEntry),
        clicked: secondaryEntryClicked,
        selector: secondaryExtendEntry ? secondaryExtendEntry.selector : '',
        label: secondaryExtendEntry ? secondaryExtendEntry.text : '',
        source: secondaryExtendEntry ? secondaryExtendEntry.source || '' : '',
        failReason: secondaryEntryFailReason,
      },
      extendEntry: {
        found: Boolean(extendEntry),
        opened: extendEntryOpened,
        selector: extendEntry ? extendEntry.selector : '',
        label: extendEntry ? extendEntry.text : '',
        source: extendEntry ? extendEntry.source || '' : '',
        failReason: secondaryEntryFailReason || primaryEntryFailReason,
      },
      extendMode,
      availableExtendDurations: availableDurations,
      selectedExtendDuration: selectedDuration || '',
      extendPrompt: extendPromptFill,
      timelineRequest: summarizeTimelineRequest(timelineRequest),
      timelineProbe,
      timelineBoundary: timelineProbe.boundary || null,
      timelineAdjustment,
      finalSubmit,
      capture,
      handoff: {
        required: !newResultUrl,
        reason: newResultUrl
          ? ''
          : extendEntry
            ? (timelineRequest.requested && timelineAdjustment.evaluation.outcome !== 'success'
              ? (timelineAdjustment.evaluation.outcome === 'failed'
                ? 'timeline_adjustment_failed'
                : 'timeline_adjustment_unresolved')
              : capture.derivedVerdict === 'suspicious_redirect'
                ? 'observed_drift_or_suspicious_redirect'
                : manualHandoffWatchMs > 0 && capture.timeout
                  ? 'manual_handoff_capture_timed_out'
                  : finalSubmit.clicked
                    ? 'submitted_but_new_result_url_not_captured_yet'
                    : 'timeline_or_submit_needs_manual_or_future_automation')
            : secondaryEntryFailReason || primaryEntryFailReason || 'extend_entry_not_found_or_ui_drift',
        note: newResultUrl
          ? 'Derived result URL recorded. Downstream wait/download can resume on the new post.'
          : !extendEntry && (secondaryEntryFailReason || primaryEntryFailReason)
            ? `Extend entry chain failed: ${secondaryEntryFailReason || primaryEntryFailReason}. Check primaryExtendEntry / secondaryExtendEntry in extend.json for the exact probe/click status before retrying.`
            : timelineRequest.requested && timelineAdjustment.evaluation.outcome !== 'success'
              ? `Timeline drag was attempted conservatively but not confirmed as successful (${timelineAdjustment.evaluation.failureReason || timelineAdjustment.evaluation.outcome}); do not treat trim as complete. Keep the same extend page open for manual correction or a future rerun.`
              : capture.derivedVerdict === 'suspicious_redirect'
                ? 'A new result-like URL was observed, but it did not satisfy the trusted derived-capture rules. It was recorded as drift/suspicious instead of lineage.'
                : manualHandoffWatchMs > 0
                  ? 'Keep using the same page/profile: finish any timeline adjustment and final submit there. If capture timed out, rerun with --manual-handoff-wait-sec to keep watching the current flow and record the derived URL.'
                  : 'This runner can now attempt final submit safely when a candidate is detected. If timeline drag still needs a human, rerun headful with --manual-handoff-wait-sec <seconds> so the script stays on the same page and captures the new result URL after manual submit.',
        resumeCommandHint: newResultUrl
          ? `node skills/grok-video-web/scripts/grok_video_wait.js --job-id ${job.jobId} --result-url ${JSON.stringify(newResultUrl)}`
          : `node skills/grok-video-web/scripts/grok_video_extend.js --job-id ${job.jobId} --result-url ${JSON.stringify(sourceResultUrl)} --manual-handoff-wait-sec 300 --headful`,
        downstreamSubmitHint: newResultUrl
          ? `node skills/grok-video-web/scripts/grok_video_download.js --job-id ${job.jobId} --result-url ${JSON.stringify(newResultUrl)}`
          : `If a human/future run already knows the derived URL, record it with: node skills/grok-video-web/scripts/grok_video_extend.js --job-id ${job.jobId} --new-result-url <derived-result-url>`,
      },
      checkedAt: nowIso(),
      stateFile: job.files.extendStatePath,
      historyFile: job.files.extendHistoryPath,
    };

    const lineageState = recordLineage(job, {
      actionType: resolveActionType(job, 'extend_video'),
      sourceResultUrl,
      newResultUrl,
      extendDuration: relation.extendDuration,
      timelineMode: relation.timelineMode,
      status: payload.status,
      checkedAt: payload.checkedAt,
      note: payload.handoff.note,
      lastObservedUrl: observedUrl,
    });
    payload.lineage = lineageState.current || {};

    writeJson(job.files.extendStatePath, payload);
    writeJson(job.files.extendHandoffPath, buildExtendHandoff({
      job,
      profile,
      sourceResultUrl,
      relation,
      payload,
      manualHandoffWatchMs,
      headless,
      observedUrl,
      startedAt,
    }));
    appendJsonl(job.files.extendHistoryPath, {
      at: payload.checkedAt,
      event: 'extend-probe',
      status: payload.status,
      sourcePostId: relation.sourcePostId,
      sourceResultUrl,
      newPostId: relation.newPostId,
      newResultUrl: relation.newResultUrl,
      extendDuration: relation.extendDuration,
      timelineMode: relation.timelineMode,
      entryFound: payload.extendEntry.found,
      entryOpened: payload.extendEntry.opened,
      primaryExtendEntry: payload.primaryExtendEntry,
      primaryEntryClicked: payload.primaryExtendEntry.clicked,
      secondaryExtendEntry: payload.secondaryExtendEntry,
      secondaryEntryClicked: payload.secondaryExtendEntry.clicked,
      extendEntryFailReason: payload.extendEntry.failReason || '',
      extendModeOpened: payload.extendMode.opened,
      availableExtendDurations: availableDurations,
      selectedExtendDuration: selectedDuration || '',
      timelineBoundaryClass: payload.timelineBoundary ? payload.timelineBoundary.class : '',
      timelineBoundaryReasons: payload.timelineBoundary ? payload.timelineBoundary.reasons : [],
      timelineManualHandoffRequired: Boolean(payload.timelineBoundary && payload.timelineBoundary.manualHandoffRequired),
      timelineAdjustmentRequested: Boolean(payload.timelineAdjustment && payload.timelineAdjustment.requested),
      timelineAdjustmentOutcome: payload.timelineAdjustment && payload.timelineAdjustment.evaluation ? payload.timelineAdjustment.evaluation.outcome : '',
      timelineAdjustmentFailureReason: payload.timelineAdjustment && payload.timelineAdjustment.evaluation ? payload.timelineAdjustment.evaluation.failureReason : '',
      timelineAdjustmentCredibleChange: Boolean(payload.timelineAdjustment && payload.timelineAdjustment.evaluation && payload.timelineAdjustment.evaluation.credibleChange),
      timelineAdjustmentAchieved: Boolean(payload.timelineAdjustment && payload.timelineAdjustment.evaluation && payload.timelineAdjustment.evaluation.achieved),
      timelineAdjustmentTargetRange: payload.timelineAdjustment ? payload.timelineAdjustment.targetRange || null : null,
      timelineAdjustmentBeforeRange: payload.timelineAdjustment && payload.timelineAdjustment.evaluation ? payload.timelineAdjustment.evaluation.beforeRange : null,
      timelineAdjustmentAfterRange: payload.timelineAdjustment && payload.timelineAdjustment.evaluation ? payload.timelineAdjustment.evaluation.afterRange : null,
      timelineAdjustmentDragActions: payload.timelineAdjustment && payload.timelineAdjustment.drag ? payload.timelineAdjustment.drag.actions || [] : [],
      finalSubmitAttempted: payload.finalSubmit.attempted,
      finalSubmitClicked: payload.finalSubmit.clicked,
      finalSubmitReason: payload.finalSubmit.reason,
      captureStage: payload.capture.captureStage || payload.capture.stage,
      captureStarted: payload.capture.started,
      captureWaitedMs: payload.capture.waitedMs,
      captureTimeout: payload.capture.timeout,
      captureObservationSource: payload.capture.observationSource || '',
      captureObservedPageIndex: payload.capture.observedPageIndex || 0,
      captureVerdict: payload.capture.derivedVerdict || '',
      captureVerdictReasons: payload.capture.derivedVerdictReasons || [],
      captureSuspiciousCandidates: payload.capture.suspiciousCandidates || [],
      captureActivePages: (payload.capture.pageSummaries || []).filter((item) => !item.closed).length,
    });

    updateManifest(job, {
      action: 'extend_video',
      resultUrl: newResultUrl || sourceResultUrl,
      extend: {
        ...job.manifest.extend,
        checkedAt: payload.checkedAt,
        status: payload.status,
        sourcePostId: relation.sourcePostId,
        sourceResultUrl,
        newPostId: relation.newPostId,
        newResultUrl: relation.newResultUrl,
        extendDuration: relation.extendDuration,
        timelineMode: relation.timelineMode,
        timelineStartPct: payload.timelineRequest ? payload.timelineRequest.targetStartPct : null,
        timelineEndPct: payload.timelineRequest ? payload.timelineRequest.targetEndPct : null,
        timelineTolerancePct: payload.timelineRequest ? payload.timelineRequest.tolerancePct : null,
        timelineRequestValid: payload.timelineRequest ? payload.timelineRequest.valid : true,
        timelineRequestErrors: payload.timelineRequest ? payload.timelineRequest.validationErrors || [] : [],
        availableExtendDurations: availableDurations,
        selectedExtendDuration: selectedDuration || '',
        extendEntryFound: payload.extendEntry.found,
        extendEntryOpened,
        extendEntryFailReason: payload.extendEntry.failReason || '',
        primaryExtendEntry: payload.primaryExtendEntry,
        primaryEntryClicked: payload.primaryExtendEntry.clicked,
        secondaryExtendEntry: payload.secondaryExtendEntry,
        secondaryEntryClicked: payload.secondaryExtendEntry.clicked,
        extendModeOpened: payload.extendMode.opened,
        extendModeSignals: payload.extendMode.signals,
        timelineBoundaryClass: payload.timelineBoundary ? payload.timelineBoundary.class : '',
        timelineBoundaryReasons: payload.timelineBoundary ? payload.timelineBoundary.reasons : [],
        timelineManualHandoffRequired: Boolean(payload.timelineBoundary && payload.timelineBoundary.manualHandoffRequired),
        timelineAdjustmentRequested: Boolean(payload.timelineAdjustment && payload.timelineAdjustment.requested),
        timelineAdjustmentOutcome: payload.timelineAdjustment && payload.timelineAdjustment.evaluation ? payload.timelineAdjustment.evaluation.outcome : '',
        timelineAdjustmentFailureReason: payload.timelineAdjustment && payload.timelineAdjustment.evaluation ? payload.timelineAdjustment.evaluation.failureReason : '',
        timelineAdjustmentCredibleChange: Boolean(payload.timelineAdjustment && payload.timelineAdjustment.evaluation && payload.timelineAdjustment.evaluation.credibleChange),
        timelineAdjustmentAchieved: Boolean(payload.timelineAdjustment && payload.timelineAdjustment.evaluation && payload.timelineAdjustment.evaluation.achieved),
        timelineAdjustmentTargetRange: payload.timelineAdjustment ? payload.timelineAdjustment.targetRange || null : null,
        timelineAdjustmentBeforeRange: payload.timelineAdjustment && payload.timelineAdjustment.evaluation ? payload.timelineAdjustment.evaluation.beforeRange : null,
        timelineAdjustmentAfterRange: payload.timelineAdjustment && payload.timelineAdjustment.evaluation ? payload.timelineAdjustment.evaluation.afterRange : null,
        timelineAdjustmentDragActions: payload.timelineAdjustment && payload.timelineAdjustment.drag ? payload.timelineAdjustment.drag.actions || [] : [],
        finalSubmitAttempted: payload.finalSubmit.attempted,
        finalSubmitClicked: payload.finalSubmit.clicked,
        finalSubmitReason: payload.finalSubmit.reason,
        captureStage: payload.capture.captureStage || payload.capture.stage,
        captureStarted: payload.capture.started,
        captureWaitedMs: payload.capture.waitedMs,
        captureTimeout: payload.capture.timeout,
        captureObservationSource: payload.capture.observationSource || '',
        captureObservedPageIndex: payload.capture.observedPageIndex || 0,
        captureVerdict: payload.capture.derivedVerdict || '',
        captureVerdictReasons: payload.capture.derivedVerdictReasons || [],
        captureSuspiciousCandidates: payload.capture.suspiciousCandidates || [],
        captureActivePages: (payload.capture.pageSummaries || []).filter((item) => !item.closed).length,
        handoffRequired: payload.handoff.required,
      },
      lineage: payload.lineage || {},
    });

    if (newResultUrl) {
      writeWorkflowResultUrl(job, newResultUrl);
      clearWorkflowBlockReason(job);
      updateWorkflowStatus(job, {
        status: 'queued',
        blocked: false,
        phase: 'extend_result_recorded',
        currentUrl: newResultUrl,
        resultUrl: newResultUrl,
        sourcePostId: relation.sourcePostId,
        sourceResultUrl,
        newPostId: relation.newPostId,
        newResultUrl: relation.newResultUrl,
        extendDuration: relation.extendDuration,
        timelineMode: relation.timelineMode,
        actionType: 'extend_video',
        lineage: payload.lineage || {},
      });
      appendWorkflowCheckpoint(job, {
        kind: 'extend_result_recorded',
        step: 'extend',
        status: 'queued',
        url: newResultUrl,
        resultUrl: newResultUrl,
        note: 'Derived result URL recorded for downstream wait/download.',
        actionType: 'extend_video',
        lineage: payload.lineage || {},
      });
      appendGeneratedVideoUrl(job, {
        ts: payload.checkedAt,
        actionType: 'extend_video',
        status: 'submitted',
        url: newResultUrl,
        postId: payload.lineage?.newPostId || relation.newPostId,
        sourcePostId: payload.lineage?.sourcePostId || relation.sourcePostId,
        sourceResultUrl: payload.lineage?.sourceResultUrl || sourceResultUrl,
        jobId: job.jobId,
        profile,
        note: 'extend flow captured derived result URL',
      });
    } else if (payload.extendEntry.found) {
      clearWorkflowBlockReason(job);
      updateWorkflowStatus(job, {
        status: timelineRequest.requested && payload.timelineAdjustment && payload.timelineAdjustment.evaluation && payload.timelineAdjustment.evaluation.outcome !== 'success'
          ? (payload.timelineAdjustment.evaluation.outcome === 'failed' ? 'failed' : 'running')
          : payload.finalSubmit.clicked || payload.capture.started ? 'queued' : 'running',
        blocked: false,
        phase: timelineRequest.requested && payload.timelineAdjustment && payload.timelineAdjustment.evaluation && payload.timelineAdjustment.evaluation.outcome !== 'success'
          ? (payload.timelineAdjustment.evaluation.outcome === 'failed' ? 'extend_timeline_adjust_failed' : 'extend_timeline_adjust_unresolved')
          : payload.finalSubmit.clicked || payload.capture.started ? 'extend_submit_capture_pending' : 'extend_handoff_ready',
        currentUrl: observedUrl,
        resultUrl: sourceResultUrl,
        sourcePostId: relation.sourcePostId,
        sourceResultUrl,
        newPostId: '',
        newResultUrl: '',
        extendDuration: relation.extendDuration,
        timelineMode: relation.timelineMode,
        captureStage: payload.capture.captureStage || payload.capture.stage,
        captureStarted: payload.capture.started,
        captureSignals: payload.capture.startedSignals,
        captureVerdict: payload.capture.derivedVerdict || '',
        captureVerdictReasons: payload.capture.derivedVerdictReasons || [],
        timelineAdjustmentOutcome: payload.timelineAdjustment && payload.timelineAdjustment.evaluation ? payload.timelineAdjustment.evaluation.outcome : '',
        timelineAdjustmentFailureReason: payload.timelineAdjustment && payload.timelineAdjustment.evaluation ? payload.timelineAdjustment.evaluation.failureReason : '',
        actionType: 'extend_video',
        lineage: payload.lineage || {},
      });
      appendWorkflowCheckpoint(job, {
        kind: timelineRequest.requested && payload.timelineAdjustment && payload.timelineAdjustment.evaluation && payload.timelineAdjustment.evaluation.outcome !== 'success'
          ? (payload.timelineAdjustment.evaluation.outcome === 'failed' ? 'extend_timeline_adjust_failed' : 'extend_timeline_adjust_unresolved')
          : payload.finalSubmit.clicked || payload.capture.started ? 'extend_submit_capture_pending' : 'extend_handoff_ready',
        step: 'extend',
        status: timelineRequest.requested && payload.timelineAdjustment && payload.timelineAdjustment.evaluation && payload.timelineAdjustment.evaluation.outcome !== 'success'
          ? (payload.timelineAdjustment.evaluation.outcome === 'failed' ? 'failed' : 'running')
          : payload.finalSubmit.clicked || payload.capture.started ? 'queued' : 'running',
        url: observedUrl,
        resultUrl: sourceResultUrl,
        note: timelineRequest.requested && payload.timelineAdjustment && payload.timelineAdjustment.evaluation && payload.timelineAdjustment.evaluation.outcome !== 'success'
          ? `Timeline drag was not confirmed (${payload.timelineAdjustment.evaluation.failureReason || payload.timelineAdjustment.evaluation.outcome}); submit was intentionally not treated as complete.`
          : payload.finalSubmit.clicked
            ? 'Final extend submit was clicked, but the new result URL was not captured yet.'
            : payload.capture.started
              ? 'Derived extend flow appears to have started, but no new result URL was captured yet.'
              : 'Extend entry/duration probed. Timeline drag and submit still need handoff.',
        actionType: 'extend_video',
        lineage: payload.lineage || {},
      });
    } else {
      setWorkflowBlockReason(job, {
        status: 'failed',
        reasonCode: secondaryEntryFailReason || primaryEntryFailReason || 'extend_entry_not_found',
        summary: secondaryEntryFailReason === 'secondary_extend_entry_not_found_after_primary_click'
          ? 'Primary extend entry was clicked, but the secondary `Extend video` item did not appear.'
          : secondaryEntryFailReason === 'secondary_extend_entry_click_failed'
            ? 'Secondary `Extend video` item was found but click failed.'
            : primaryEntryFailReason === 'primary_extend_entry_click_failed'
              ? 'Primary extend entry was found but click failed.'
              : 'Extend video entry was not found on the result page.',
        currentUrl: observedUrl,
        matchedSignals: [],
      });
      updateWorkflowStatus(job, {
        status: 'failed',
        blocked: true,
        phase: 'extend_entry_not_found',
        currentUrl: observedUrl,
        resultUrl: sourceResultUrl,
        sourcePostId: relation.sourcePostId,
        sourceResultUrl,
        extendDuration: relation.extendDuration,
        timelineMode: relation.timelineMode,
        actionType: 'extend_video',
        lineage: payload.lineage || {},
      });
      appendWorkflowCheckpoint(job, {
        kind: secondaryEntryFailReason || primaryEntryFailReason || 'extend_entry_not_found',
        step: 'extend',
        status: 'failed',
        url: observedUrl,
        resultUrl: sourceResultUrl,
        note: secondaryEntryFailReason === 'secondary_extend_entry_not_found_after_primary_click'
          ? 'Primary extend entry click succeeded, but `Extend video` never appeared afterwards.'
          : secondaryEntryFailReason === 'secondary_extend_entry_click_failed'
            ? 'Secondary `Extend video` item was detected, but click failed.'
            : primaryEntryFailReason === 'primary_extend_entry_click_failed'
              ? 'Primary extend entry was detected, but click failed.'
              : 'Extend entry was not found; likely UI drift or unavailable action.',
      });
    }

    logger[payload.ok ? 'info' : 'warn']('extend.finished', {
      status: payload.status,
      phase: newResultUrl
        ? 'extend_result_recorded'
        : payload.extendEntry.found
          ? (payload.finalSubmit.clicked || payload.capture.started ? 'extend_submit_capture_pending' : 'extend_handoff_ready')
          : 'extend_entry_not_found',
      currentUrl: observedUrl,
      resultUrl: newResultUrl || sourceResultUrl,
      sourceResultUrl,
      extendDuration: relation.extendDuration,
      timelineMode: relation.timelineMode,
      finalSubmitClicked: payload.finalSubmit.clicked,
      captureStage: payload.capture.captureStage || payload.capture.stage,
      captureStarted: payload.capture.started,
      captureVerdict: payload.capture.derivedVerdict || '',
      captureVerdictReasons: payload.capture.derivedVerdictReasons || [],
      path: job.files.extendStatePath,
    });
    console.log(JSON.stringify(payload, null, 2));
    if (!payload.ok) {process.exitCode = 2;}
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
  }
}

if (require.main === module) {
  main().catch((error) => {
    const args = parseArgs(process.argv.slice(2));
    try {
      let job;
      if (args['job-id'] || args['job-dir']) {
        job = resolveJob(args);
      } else if (args['result-url']) {
        job = bootstrapStandaloneJob(args['result-url'], args.profile);
      }
      if (job) {
        job.files.extendHandoffPath = job.files.extendHandoffPath || path.join(job.stateDir, 'extend-handoff.json');
        const logger = createLogger(job, { script: 'grok_video_extend' });
        updateWorkflowStatus(job, { status: 'failed', blocked: true, phase: 'extend_failed' });
        appendWorkflowCheckpoint(job, { kind: 'extend_failed', step: 'extend', status: 'failed', note: error.message });
        setWorkflowBlockReason(job, {
          status: 'failed',
          reasonCode: 'extend_failed',
          summary: error.message,
          currentUrl: resolveResultUrl(job, args['result-url']) || '',
          matchedSignals: [],
        });
        writeJson(job.files.extendStatePath, {
          ok: false,
          action: 'extend',
          status: 'failed',
          message: error.message,
          checkedAt: nowIso(),
          stateFile: job.files.extendStatePath,
        });
        writeJson(job.files.extendHandoffPath, {
          ok: false,
          action: 'extend_manual_handoff',
          status: 'failed',
          message: error.message,
          checkedAt: nowIso(),
          jobId: job.jobId,
          jobDir: job.jobDir,
          profile: job.profile,
          sourceResultUrl: resolveResultUrl(job, args['result-url']) || '',
          instructions: [
            '这次 extend run 失败了，先看 extend.json / events.jsonl / extend-handoff.json。',
            '排障后请在同 job 上重跑 extend，避免丢掉 source/derived 关系。',
          ],
          stateFile: job.files.extendHandoffPath,
        });
        logger.error('extend.failed', {
          status: 'failed',
          phase: 'extend_failed',
          currentUrl: resolveResultUrl(job, args['result-url']) || '',
          resultUrl: resolveResultUrl(job, args['result-url']) || '',
          message: error.message,
          path: job.files.extendStatePath,
        });
      }
    } catch {}
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
}

module.exports = {
  buildTimelineAdjustmentPlan,
  evaluateTimelineAdjustment,
  resolveTimelineRequest,
};
