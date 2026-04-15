#!/usr/bin/env node
'use strict';

const { classifyTimelineSnapshot } = require('../grok_video_lib');

function assert(condition, message) {
  if (!condition) {throw new Error(message);}
}

const fixtures = [
  {
    name: 'container-only detection',
    snapshot: {
      containers: [{ tag: 'div', ariaLabel: 'timeline editor', className: 'timeline-track', rect: { left: 100, width: 400, top: 0, height: 40 } }],
      tracks: [],
      handles: [],
      sliderSignals: [],
      rangeInputs: [],
      trimSignals: [],
      selectionRegions: [],
      draggableCount: 0,
    },
    check(result) {
      assert(result.detected === true, 'container-only should be detected');
      assert(result.timelineMode === 'timeline_detected', 'container-only should stay at timeline_detected');
      assert(result.currentSelection.detected === false, 'container-only should not fabricate selection');
      assert(result.boundary.class === 'probe_only_manual_handoff', 'container-only should remain probe-only/manual handoff');
      assert(result.boundary.manualHandoffRequired === true, 'container-only should force manual handoff when timeline is present but unresolved');
    },
  },
  {
    name: 'handles imply manual handoff with inferred selection',
    snapshot: {
      containers: [{ tag: 'div', ariaLabel: 'timeline', className: 'timeline-track', rect: { left: 50, width: 500, top: 0, height: 40 } }],
      tracks: [],
      handles: [
        { source: 'handle', positionPct: 18, positionPx: 90, ariaLabel: 'trim start' },
        { source: 'handle', positionPct: 74, positionPx: 370, ariaLabel: 'trim end' },
      ],
      sliderSignals: [],
      rangeInputs: [],
      trimSignals: [{ kind: 'trim_start' }, { kind: 'trim_end' }],
      selectionRegions: [],
      draggableCount: 2,
    },
    check(result) {
      assert(result.timelineMode === 'manual_handoff', 'handles should promote to manual_handoff');
      assert(result.currentSelection.detected === true, 'handles should infer selection');
      assert(result.currentSelection.startPct === 18, 'startPct should come from left handle');
      assert(result.currentSelection.endPct === 74, 'endPct should come from right handle');
      assert(result.boundary.class === 'interactive_auto_adjust_ready', 'handles should classify as auto-adjust ready once container + boundaries are resolved');
      assert(result.boundary.canAutoAdjust === true, 'resolved handles should allow conservative auto-adjust');
      assert(result.boundary.reasons.includes('interactive_handles_detected'), 'handle reason should be recorded');
    },
  },
  {
    name: 'selection region beats handle inference',
    snapshot: {
      containers: [{ tag: 'div', ariaLabel: 'timeline', className: 'timeline-track', rect: { left: 0, width: 600, top: 0, height: 44 } }],
      tracks: [],
      handles: [{ source: 'slider', positionPct: 32, positionPx: 192, ariaLabel: 'playhead' }],
      sliderSignals: [{ source: 'slider', positionPct: 32, positionPx: 192, ariaLabel: 'playhead' }],
      rangeInputs: [],
      trimSignals: [],
      selectionRegions: [{ source: 'selection_region', startPct: 20, endPct: 80, startPx: 120, endPx: 480 }],
      draggableCount: 1,
    },
    check(result) {
      assert(result.timelineMode === 'manual_handoff', 'selection region should still be manual_handoff');
      assert(result.currentSelection.source === 'selection_region', 'selection region should be preferred over handles');
      assert(result.currentSelection.startPct === 20, 'selection region start should be preserved');
      assert(result.currentSelection.endPct === 80, 'selection region end should be preserved');
      assert(result.boundary.reasons.includes('selection_window_detected'), 'selection region reason should be recorded');
    },
  },
  {
    name: 'ambiguous sliders keep manual handoff honest',
    snapshot: {
      containers: [
        { tag: 'div', ariaLabel: 'timeline A', className: 'timeline-track', rect: { left: 0, width: 320, top: 0, height: 44 } },
        { tag: 'div', ariaLabel: 'timeline B', className: 'timeline-track', rect: { left: 340, width: 320, top: 0, height: 44 } },
      ],
      tracks: [],
      handles: [],
      sliderSignals: [{ source: 'slider', positionPct: null, positionPx: null, ariaLabel: 'trim thumb' }],
      rangeInputs: [],
      trimSignals: [{ kind: 'trim_window' }],
      selectionRegions: [],
      draggableCount: 1,
    },
    check(result) {
      assert(result.timelineMode === 'manual_handoff', 'slider signal should still force manual handoff');
      assert(result.currentSelection.detected === false, 'ambiguous slider should not fabricate selection');
      assert(result.unknowns.includes('multiple_timeline_candidates'), 'multiple containers should be flagged');
      assert(result.boundary.reasons.includes('selection_start_end_unresolved'), 'unresolved boundary should be recorded');
    },
  },
];

const results = fixtures.map((fixture) => {
  const result = classifyTimelineSnapshot(fixture.snapshot);
  fixture.check(result);
  return {
    name: fixture.name,
    timelineMode: result.timelineMode,
    currentSelection: result.currentSelection,
    unknowns: result.unknowns,
    signals: result.signals,
    boundary: result.boundary,
  };
});

console.log(JSON.stringify({ ok: true, results }, null, 2));
