#!/usr/bin/env node
'use strict';

const path = require('path');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function basenameWithoutExt(input) {
  if (!input) {return '';}
  const base = path.basename(String(input));
  const ext = path.extname(base);
  return ext ? base.slice(0, -ext.length) : base;
}

function uniqueNonEmpty(values) {
  return Array.from(new Set((values || []).map((value) => String(value || '').trim()).filter(Boolean)));
}

function buildExpectedNames(options = {}) {
  const explicit = Array.isArray(options.expectedNames) ? options.expectedNames : [];
  const filePath = options.filePath || '';
  const fileName = options.fileName || (filePath ? path.basename(filePath) : '');
  const stem = options.fileStem || basenameWithoutExt(fileName || filePath);
  const mentionName = options.mentionName || stem;
  return uniqueNonEmpty([fileName, stem, mentionName, ...explicit]);
}

function toExpectedDimensions(options = {}) {
  const width = Number(options.expectedWidth || options.width || 0);
  const height = Number(options.expectedHeight || options.height || 0);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  return { width, height };
}

function scoreStrength(summary) {
  if (summary.usable) {return 'usable';}
  if (summary.mounted) {return 'mounted';}
  return 'none';
}

async function performUpload(page, options) {
  const inputSelector = options.inputSelector || 'input[type="file"]';
  const filePath = options.filePath;
  if (!filePath) {
    throw new Error('uploadReferenceImage: filePath is required');
  }

  if (typeof options.performUpload === 'function') {
    await options.performUpload({ page, inputSelector, filePath, options });
    return { method: 'custom', inputSelector };
  }

  if (page && typeof page.locator === 'function') {
    const locator = page.locator(inputSelector);
    if (locator && typeof locator.setInputFiles === 'function') {
      await locator.setInputFiles(filePath);
      return { method: 'locator.setInputFiles', inputSelector };
    }
  }

  if (page && typeof page.setInputFiles === 'function') {
    await page.setInputFiles(inputSelector, filePath);
    return { method: 'page.setInputFiles', inputSelector };
  }

  throw new Error('uploadReferenceImage: page must expose locator(selector).setInputFiles(filePath), page.setInputFiles(selector, filePath), or options.performUpload');
}

async function probeReferenceState(page, options = {}) {
  const logger = options.logger || null;
  if (!page || typeof page.evaluate !== 'function') {
    throw new Error('probeReferenceState: page.evaluate is required');
  }

  const expectedNames = buildExpectedNames(options);
  const expectedDimensions = toExpectedDimensions(options);
  const promptSelector = options.promptSelector || null;
  const maxTextLength = Number(options.maxTextLength || 12000);

  const summary = await page.evaluate(
    ({ expectedNames, expectedDimensions, promptSelector, maxTextLength }) => {
      const norm = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const bodyText = (document.body?.innerText || '').slice(0, maxTextLength);
      const bodyTextNorm = norm(bodyText);
      const expected = Array.from(new Set((expectedNames || []).map(norm).filter(Boolean)));
      const mentionTargets = Array.from(new Set(expected.flatMap((name) => [name, `@${name}`])));

      const toRect = (el) => {
        if (!el || typeof el.getBoundingClientRect !== 'function') {return null;}
        const rect = el.getBoundingClientRect();
        return {
          width: Math.round(rect.width || 0),
          height: Math.round(rect.height || 0),
          x: Math.round(rect.x || 0),
          y: Math.round(rect.y || 0),
        };
      };

      const textOf = (el) => {
        if (!el) {return '';}
        return [
          el.getAttribute?.('aria-label'),
          el.getAttribute?.('title'),
          el.getAttribute?.('alt'),
          el.getAttribute?.('placeholder'),
          el.textContent,
          el.innerText,
        ]
          .filter(Boolean)
          .join(' ');
      };

      const nearbyRemoveButton = (img) => {
        let cursor = img;
        for (let depth = 0; depth < 6 && cursor; depth += 1) {
          const scoped = cursor.parentElement || cursor;
          const button = scoped.querySelector?.('button[aria-label="Remove image"]');
          if (button) {return button;}
          cursor = cursor.parentElement;
        }
        return null;
      };

      const isBlobPreview = (img) => {
        const src = String(img.getAttribute('src') || img.currentSrc || '');
        return src.startsWith('blob:https://grok.com/') || src.startsWith('blob:');
      };

      const dimsMatch = (img) => {
        if (!expectedDimensions || !expectedDimensions.width || !expectedDimensions.height) {
          return false;
        }
        const widthCandidates = [img.naturalWidth, img.width, img.clientWidth].map((v) => Number(v || 0)).filter((v) => v > 0);
        const heightCandidates = [img.naturalHeight, img.height, img.clientHeight].map((v) => Number(v || 0)).filter((v) => v > 0);
        return widthCandidates.includes(expectedDimensions.width) && heightCandidates.includes(expectedDimensions.height);
      };

      const previewImages = Array.from(document.querySelectorAll('img')).filter(isBlobPreview);
      const previewSignals = previewImages.slice(0, 8).map((img) => ({
        src: String(img.getAttribute('src') || img.currentSrc || ''),
        rect: toRect(img),
        naturalWidth: Number(img.naturalWidth || 0),
        naturalHeight: Number(img.naturalHeight || 0),
        removeImage: Boolean(nearbyRemoveButton(img)),
        dimensionsMatch: dimsMatch(img),
      }));

      const removeButtons = Array.from(document.querySelectorAll('button[aria-label="Remove image"]'));
      const composer = promptSelector ? document.querySelector(promptSelector) : document.querySelector('textarea, [contenteditable="true"], [role="textbox"]');
      const composerText = composer ? norm(composer.textContent || composer.value || composer.innerText || '') : '';

      const visibleMentionCandidates = Array.from(document.querySelectorAll('[role="option"], [role="menuitem"], [role="button"], [data-testid], button, span, div, li'))
        .map((el) => norm(textOf(el)))
        .filter(Boolean)
        .filter((text, index, arr) => arr.indexOf(text) === index)
        .filter((text) => expected.some((name) => text.includes(name) || text.includes(`@${name}`)))
        .slice(0, 20);

      const mentionMatchesInBody = mentionTargets.filter((token) => bodyTextNorm.includes(token));
      const composerMentionMatches = mentionTargets.filter((token) => composerText.includes(token));
      const mounted = previewImages.length > 0 || removeButtons.length > 0;
      const usable = composerMentionMatches.length > 0 || mentionMatchesInBody.length > 0 || visibleMentionCandidates.length > 0;

      return {
        mounted,
        usable,
        expectedNames,
        bodyTextExcerpt: bodyText.slice(0, 1500),
        blobPreviewCount: previewImages.length,
        removeImageCount: removeButtons.length,
        previewSignals,
        visibleMentionCandidates,
        mentionMatchesInBody,
        composerMentionMatches,
        composerText,
        notes: [
          'Do not use input.files > 0 as the final success criterion. Grok may consume the file input immediately after upload.',
          mounted
            ? 'Mounted-state confirmed via blob preview and/or Remove image controls.'
            : 'Mounted-state not confirmed yet. Re-snapshot after upload or rerender.',
          usable
            ? 'Usable-reference confirmed via @图片名-style mention/suggestion signals.'
            : 'No strong @图片名 usable signal observed yet.',
        ],
      };
    },
    { expectedNames, expectedDimensions, promptSelector, maxTextLength },
  );

  const result = {
    ...summary,
    expectedNames,
    expectedDimensions,
    strength: scoreStrength(summary),
  };
  if (logger) {
    logger.debug('reference.probe', {
      phase: options.requireUsable ? 'reference_usable_probe' : 'reference_mount_probe',
      status: result.strength,
      blobPreviewCount: result.blobPreviewCount,
      removeImageCount: result.removeImageCount,
      mentionMatchesInBody: result.mentionMatchesInBody,
      composerMentionMatches: result.composerMentionMatches,
    });
  }
  return result;
}

async function waitForReferenceState(page, options = {}) {
  const logger = options.logger || null;
  const timeoutMs = Number(options.timeoutMs || 15000);
  const intervalMs = Number(options.intervalMs || 350);
  const requireUsable = Boolean(options.requireUsable);
  const deadline = Date.now() + timeoutMs;
  let last = null;

  while (Date.now() <= deadline) {
    last = await probeReferenceState(page, options);
    if (requireUsable ? last.usable : last.mounted) {
      const success = {
        ok: true,
        phase: requireUsable ? 'usable' : 'mounted',
        elapsedMs: timeoutMs - Math.max(0, deadline - Date.now()),
        summary: last,
      };
      if (logger) {
        logger.info('reference.state_reached', {
          phase: success.phase,
          status: last.strength,
          elapsedMs: success.elapsedMs,
          message: renderHumanSummary(last),
        });
      }
      return success;
    }
    await sleep(intervalMs);
  }

  const timeoutResult = {
    ok: false,
    phase: requireUsable ? 'usable' : 'mounted',
    elapsedMs: timeoutMs,
    summary: last,
  };
  if (logger) {
    logger.warn('reference.state_timeout', {
      phase: timeoutResult.phase,
      status: last ? last.strength : 'none',
      elapsedMs: timeoutResult.elapsedMs,
      message: last ? renderHumanSummary(last) : 'No reference state observed before timeout.',
    });
  }
  return timeoutResult;
}

async function uploadReferenceImage(page, options = {}) {
  const logger = options.logger || null;
  if (logger) {
    logger.info('reference.upload_started', {
      phase: 'reference_upload',
      path: options.filePath || '',
      message: `expected=${buildExpectedNames(options).join(', ') || '-'}`,
    });
  }
  const uploadMeta = await performUpload(page, options);
  if (options.settleMs) {
    await sleep(Number(options.settleMs));
  }
  const result = await waitForReferenceState(page, options);
  const payload = {
    ok: result.ok,
    phase: result.phase,
    upload: uploadMeta,
    strength: result.summary ? result.summary.strength : 'none',
    inputFilesSuccessCriterion: false,
    note: 'Never use input.files > 0 as the success criterion; rely on mounted/usable DOM signals instead.',
    summary: result.summary,
    elapsedMs: result.elapsedMs,
  };
  if (logger) {
    logger[payload.ok ? 'info' : 'warn']('reference.upload_finished', {
      phase: payload.phase,
      status: payload.ok ? payload.strength : 'failed',
      method: uploadMeta.method,
      path: options.filePath || '',
      elapsedMs: payload.elapsedMs,
      message: result.summary ? renderHumanSummary(result.summary) : payload.note,
    });
  }
  return payload;
}

function renderHumanSummary(result) {
  const summary = result && result.summary ? result.summary : result;
  if (!summary) {return 'No summary available.';}
  return [
    `strength=${summary.strength || scoreStrength(summary)}`,
    `mounted=${Boolean(summary.mounted)}`,
    `usable=${Boolean(summary.usable)}`,
    `blobPreviewCount=${Number(summary.blobPreviewCount || 0)}`,
    `removeImageCount=${Number(summary.removeImageCount || 0)}`,
    `mentionMatchesInBody=${(summary.mentionMatchesInBody || []).join(', ') || '-'}`,
    `composerMentionMatches=${(summary.composerMentionMatches || []).join(', ') || '-'}`,
    `visibleMentionCandidates=${(summary.visibleMentionCandidates || []).slice(0, 5).join(' | ') || '-'}`,
  ].join('\n');
}

class MockPage {
  constructor(states) {
    this.states = Array.isArray(states) ? states.slice() : [];
    this.uploadCalls = [];
  }

  locator(selector) {
    return {
      setInputFiles: async (filePath) => {
        this.uploadCalls.push({ selector, filePath });
      },
    };
  }

  async evaluate(fn, args) {
    const state = this.states.length > 1 ? this.states.shift() : this.states[0];
    return state || fn(args);
  }
}

async function runSelfTest() {
  const page = new MockPage([
    {
      mounted: false,
      usable: false,
      blobPreviewCount: 0,
      removeImageCount: 0,
      previewSignals: [],
      visibleMentionCandidates: [],
      mentionMatchesInBody: [],
      composerMentionMatches: [],
      composerText: '',
      notes: ['initial'],
    },
    {
      mounted: true,
      usable: false,
      blobPreviewCount: 1,
      removeImageCount: 1,
      previewSignals: [{ src: 'blob:https://grok.com/mock', removeImage: true }],
      visibleMentionCandidates: [],
      mentionMatchesInBody: [],
      composerMentionMatches: [],
      composerText: '',
      notes: ['mounted'],
    },
    {
      mounted: true,
      usable: true,
      blobPreviewCount: 1,
      removeImageCount: 1,
      previewSignals: [{ src: 'blob:https://grok.com/mock', removeImage: true }],
      visibleMentionCandidates: ['@ruoyin_test_upload'],
      mentionMatchesInBody: ['@ruoyin_test_upload'],
      composerMentionMatches: ['@ruoyin_test_upload'],
      composerText: '@ruoyin_test_upload 做一个轻微镜头推进的视频',
      notes: ['usable'],
    },
  ]);

  const mounted = await uploadReferenceImage(page, {
    filePath: '/tmp/ruoyin_test_upload.png',
    expectedNames: ['ruoyin_test_upload', 'ruoyin_test_upload.png'],
    timeoutMs: 1200,
    intervalMs: 10,
  });

  const usable = await waitForReferenceState(page, {
    expectedNames: ['ruoyin_test_upload', 'ruoyin_test_upload.png'],
    requireUsable: true,
    timeoutMs: 1200,
    intervalMs: 10,
  });

  return {
    ok: mounted.ok && usable.ok,
    mounted,
    usable,
    uploadCalls: page.uploadCalls,
  };
}

async function main(argv = process.argv.slice(2)) {
  if (argv.includes('--self-test')) {
    const result = await runSelfTest();
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
  }

  if (argv.includes('--help') || argv.includes('-h')) {
    console.log([
      'Usage:',
      '  node grok_reference_upload.js --self-test',
      '',
      'Exports:',
      '  probeReferenceState(page, options)',
      '  waitForReferenceState(page, options)',
      '  uploadReferenceImage(page, options)',
      '',
      'Important:',
      '  Never use input.files > 0 as the final success criterion.',
    ].join('\n'));
    return;
  }

  console.error('No CLI action provided. Use --self-test or require() this module.');
  process.exit(2);
}

module.exports = {
  MockPage,
  basenameWithoutExt,
  buildExpectedNames,
  probeReferenceState,
  renderHumanSummary,
  runSelfTest,
  uploadReferenceImage,
  waitForReferenceState,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
    process.exit(1);
  });
}
