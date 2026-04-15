#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function assert(condition, message) {
  if (!condition) {throw new Error(message);}
}

const extendPath = path.join(__dirname, '..', 'grok_video_extend.js');
const source = fs.readFileSync(extendPath, 'utf8');
const match = source.match(/function classifyDerivedCaptureCandidate\([\s\S]*?\n}\n\nasync function detectExtendMode/);
if (!match) {
  throw new Error('Unable to extract classifyDerivedCaptureCandidate from grok_video_extend.js');
}

const fnSource = match[0].replace(/\n\nasync function detectExtendMode$/, '');
const sandbox = { module: { exports: {} } };
vm.runInNewContext(`${fnSource}\nmodule.exports = classifyDerivedCaptureCandidate;`, sandbox, { filename: 'grok_extend_capture_selftest.vm' });
const classifyDerivedCaptureCandidate = sandbox.module.exports;

const sourceUrl = 'https://grok.com/imagine/post/source123';
const baseline = new Set([
  sourceUrl,
  'https://grok.com/imagine/post/old-other-post',
]);

const fixtures = [
  {
    name: 'auto submit primary-page navigation is trusted',
    input: {
      sourceResultUrl: sourceUrl,
      stage: 'auto_submit',
      candidateUrl: 'https://grok.com/imagine/post/new-derived-auto',
      currentUrl: 'https://grok.com/imagine/post/new-derived-auto',
      observationSource: 'primary_page',
      baselineUrls: baseline,
    },
    check(result) {
      assert(result.verdict === 'confirmed_derived', 'auto submit primary navigation should be confirmed');
    },
  },
  {
    name: 'manual handoff same-tab navigation stays suspicious',
    input: {
      sourceResultUrl: sourceUrl,
      stage: 'manual_handoff',
      candidateUrl: 'https://grok.com/imagine/post/same-tab-drift',
      currentUrl: 'https://grok.com/imagine/post/same-tab-drift',
      observationSource: 'primary_page',
      baselineUrls: baseline,
    },
    check(result) {
      assert(result.verdict === 'suspicious_redirect', 'manual handoff same-tab navigation must not become derived lineage');
      assert(result.reasons.includes('same_tab_navigation_not_trusted_for_lineage'), 'same-tab suspicion reason should be recorded');
    },
  },
  {
    name: 'preexisting other post is treated as drift',
    input: {
      sourceResultUrl: sourceUrl,
      stage: 'manual_handoff',
      candidateUrl: 'https://grok.com/imagine/post/old-other-post',
      currentUrl: 'https://grok.com/imagine/post/old-other-post',
      observationSource: 'context_page',
      baselineUrls: baseline,
    },
    check(result) {
      assert(result.verdict === 'observed_drift', 'preexisting result page should stay drift');
      assert(result.reasons.includes('candidate_seen_before_watch_window'), 'preexisting drift reason should be recorded');
    },
  },
  {
    name: 'manual handoff new popup is trusted',
    input: {
      sourceResultUrl: sourceUrl,
      stage: 'manual_handoff',
      candidateUrl: 'https://grok.com/imagine/post/new-popup-derived',
      currentUrl: 'https://grok.com/imagine/post/new-popup-derived',
      observationSource: 'context_page',
      baselineUrls: baseline,
    },
    check(result) {
      assert(result.verdict === 'confirmed_derived', 'manual handoff popup should be trusted');
    },
  },
];

const results = fixtures.map((fixture) => {
  const result = classifyDerivedCaptureCandidate(fixture.input);
  fixture.check(result);
  return {
    name: fixture.name,
    verdict: result.verdict,
    reasons: result.reasons,
  };
});

console.log(JSON.stringify({ ok: true, results }, null, 2));
