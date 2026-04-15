#!/usr/bin/env node
'use strict';

const { parseArgs } = require('../grok_video_lib');
const { resolveTimelineRequest } = require('../grok_video_extend');

function assert(condition, message) {
  if (!condition) {throw new Error(message);}
}

const cliArgs = parseArgs([
  '--timeline_start_pct', '12',
  '--timeline_end_pct', '88',
  '--timeline_tolerance_pct', '4',
]);
const cliRequest = resolveTimelineRequest(null, cliArgs, null);
assert(cliRequest.requested, 'CLI timeline request should be marked as requested');
assert(cliRequest.valid, 'CLI timeline request should be valid');
assert(cliRequest.targetStartPct === 12, 'CLI start pct should map from snake_case alias');
assert(cliRequest.targetEndPct === 88, 'CLI end pct should map from snake_case alias');
assert(cliRequest.tolerancePct === 4, 'CLI tolerance pct should map from snake_case alias');

const jobRequest = resolveTimelineRequest({
  request: {
    extend: {
      timeline_start_pct: 15,
      timeline_end_pct: 82,
      timeline_tolerance_pct: 2.5,
    },
  },
  manifest: {},
}, {}, null);
assert(jobRequest.targetStartPct === 15, 'job.request.extend.timeline_start_pct should map');
assert(jobRequest.targetEndPct === 82, 'job.request.extend.timeline_end_pct should map');
assert(jobRequest.tolerancePct === 2.5, 'job.request.extend.timeline_tolerance_pct should map');

const manifestRequest = resolveTimelineRequest({
  request: {},
  manifest: {
    extend: {
      timelineStartPct: 20,
      timelineEndPct: 70,
      timelineTolerancePct: 5,
    },
  },
}, {}, null);
assert(manifestRequest.targetStartPct === 20, 'manifest.extend.timelineStartPct should map');
assert(manifestRequest.targetEndPct === 70, 'manifest.extend.timelineEndPct should map');
assert(manifestRequest.tolerancePct === 5, 'manifest.extend.timelineTolerancePct should map');

const fixedWindowRequest = resolveTimelineRequest({ request: {}, manifest: {} }, {
  'timeline-start-pct': '30',
  'timeline-tolerance-pct': '3',
}, {
  currentSelection: { detected: true, startPct: 10, endPct: 40 },
  automationModel: { fixedWindowDurationPct: 30 },
});
assert(fixedWindowRequest.fixedWindowMode, 'fixed-window mode should activate when fallback duration is known');
assert(fixedWindowRequest.targetStartPct === 30, 'fixed-window target start should honor requested start');
assert(fixedWindowRequest.targetEndPct === 60, 'fixed-window target end should be derived from current window duration');
assert(fixedWindowRequest.valid, 'fixed-window single-boundary request should be valid');

console.log(JSON.stringify({
  ok: true,
  cliArgs,
  cliRequest,
  jobRequest,
  manifestRequest,
  fixedWindowRequest,
}, null, 2));
