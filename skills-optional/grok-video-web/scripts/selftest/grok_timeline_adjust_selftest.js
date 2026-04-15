#!/usr/bin/env node
'use strict';

const {
  buildTimelineAdjustmentPlan,
  evaluateTimelineAdjustment,
} = require('../grok_video_extend');

function assert(condition, message) {
  if (!condition) {throw new Error(message);}
}

function makeProbe({ startPct, endPct, handleSelectors = true } = {}) {
  return {
    detected: true,
    currentSelection: {
      detected: true,
      source: 'handles',
      startPct,
      endPct,
    },
    automationModel: {
      container: {
        selector: '[data-crawclaw-timeline-container="0"]',
        rect: { left: 100, width: 500 },
      },
      selection: {
        detected: true,
        source: 'handles',
        startPct,
        endPct,
      },
      handles: handleSelectors ? {
        start: { selector: '[data-crawclaw-timeline-handle="0"]', positionPct: startPct },
        end: { selector: '[data-crawclaw-timeline-handle="1"]', positionPct: endPct },
      } : {
        start: null,
        end: null,
      },
      rangeInputs: {
        start: null,
        end: null,
      },
    },
  };
}

const planFixtures = [
  {
    name: 'builds handle drag plan with real target deltas',
    probe: makeProbe({ startPct: 18, endPct: 74 }),
    request: { requested: true, valid: true, targetStartPct: 12, targetEndPct: 88, tolerancePct: 3 },
    check(plan) {
      assert(plan.ok === true, 'plan should be available');
      assert(plan.mode === 'handle_drag', 'plan should choose handle drag');
      assert(plan.actions.length === 2, 'plan should drag both boundaries');
      assert(plan.actions[0].edge === 'start' && plan.actions[0].direction === 'decrease', 'start edge should move left');
      assert(plan.actions[1].edge === 'end' && plan.actions[1].direction === 'increase', 'end edge should move right');
    },
  },
  {
    name: 'fails planning when controls are unresolved',
    probe: makeProbe({ startPct: 18, endPct: 74, handleSelectors: false }),
    request: { requested: true, valid: true, targetStartPct: 10, targetEndPct: 80, tolerancePct: 3 },
    check(plan) {
      assert(plan.ok === false, 'plan should fail without controls');
      assert(plan.reasons.includes('boundary_controls_unresolved'), 'unresolved controls should be explicit');
    },
  },
];

const evaluationFixtures = [
  {
    name: 'validation accepts target hit within tolerance',
    request: { requested: true, targetStartPct: 12, targetEndPct: 88, tolerancePct: 3 },
    beforeProbe: makeProbe({ startPct: 18, endPct: 74 }),
    afterProbe: makeProbe({ startPct: 12.8, endPct: 87.2 }),
    check(result) {
      assert(result.outcome === 'success', 'within tolerance should succeed');
      assert(result.achieved === true, 'achieved should be true');
    },
  },
  {
    name: 'validation rejects no change',
    request: { requested: true, targetStartPct: 12, targetEndPct: 88, tolerancePct: 3 },
    beforeProbe: makeProbe({ startPct: 18, endPct: 74 }),
    afterProbe: makeProbe({ startPct: 18, endPct: 74 }),
    check(result) {
      assert(result.outcome === 'failed', 'no change should fail');
      assert(result.failureReason === 'selection_did_not_change', 'failure reason should be explicit');
    },
  },
  {
    name: 'validation rejects wrong direction',
    request: { requested: true, targetStartPct: 12, targetEndPct: 88, tolerancePct: 3 },
    beforeProbe: makeProbe({ startPct: 18, endPct: 74 }),
    afterProbe: makeProbe({ startPct: 24, endPct: 68 }),
    check(result) {
      assert(result.outcome === 'failed', 'wrong direction should fail');
      assert(result.failureReason === 'selection_changed_in_wrong_direction', 'wrong direction reason should be explicit');
    },
  },
  {
    name: 'validation distinguishes credible change without target hit',
    request: { requested: true, targetStartPct: 12, targetEndPct: 88, tolerancePct: 3 },
    beforeProbe: makeProbe({ startPct: 18, endPct: 74 }),
    afterProbe: makeProbe({ startPct: 15, endPct: 81 }),
    check(result) {
      assert(result.outcome === 'changed_but_not_achieved', 'partial but credible move should stay unresolved for submit');
      assert(result.credibleChange === true, 'credible change should be surfaced');
    },
  },
];

const results = {
  plans: planFixtures.map((fixture) => {
    const plan = buildTimelineAdjustmentPlan(fixture.probe, fixture.request);
    fixture.check(plan);
    return {
      name: fixture.name,
      ok: plan.ok,
      mode: plan.mode,
      reasons: plan.reasons,
      actions: plan.actions,
    };
  }),
  evaluations: evaluationFixtures.map((fixture) => {
    const evaluation = evaluateTimelineAdjustment({
      timelineRequest: fixture.request,
      beforeProbe: fixture.beforeProbe,
      afterProbe: fixture.afterProbe,
    });
    fixture.check(evaluation);
    return {
      name: fixture.name,
      outcome: evaluation.outcome,
      failureReason: evaluation.failureReason,
      credibleChange: evaluation.credibleChange,
      achieved: evaluation.achieved,
      beforeRange: evaluation.beforeRange,
      afterRange: evaluation.afterRange,
    };
  }),
};

console.log(JSON.stringify({ ok: true, results }, null, 2));
