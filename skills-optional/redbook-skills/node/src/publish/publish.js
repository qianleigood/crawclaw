const fs = require('fs');
const path = require('path');
const { XHS_CREATOR_PUBLISH_URL } = require('../core/constants');
const { gotoAndSettled, delay } = require('../core/browser');
const { humanClickHandle, humanPause, humanReplaceInput, humanScrollPage } = require('../core/human');
const { assertNoRiskSignals } = require('../core/risk');
const { XhsCliError } = require('../core/errors');

const VIDEO_PROCESS_TIMEOUT_MS = 120000;
const VIDEO_PROCESS_POLL_MS = 3000;

const SELECTORS = {
  imageTextTab: 'div.creator-tab',
  imageTextTabText: '上传图文',
  videoTab: 'div.creator-tab',
  videoTabText: '上传视频',
  uploadInput: 'input.upload-input',
  uploadInputAlt: 'input[type="file"]',
  titleInput: 'input[placeholder*="填写标题"]',
  titleInputAlt: 'input.d-text',
  contentEditor: 'div.tiptap.ProseMirror',
  contentEditorAlt: 'div.ProseMirror[contenteditable="true"]',
  publishButtonText: '发布',
};

function extractTopicTagsFromLastLine(content) {
  const normalizedContent = String(content || '');
  const lines = normalizedContent.split(/\r?\n/);
  while (lines.length && !lines[lines.length - 1].trim()) {
    lines.pop();
  }
  if (!lines.length) {
    return { content: normalizedContent.trim(), topicTags: [] };
  }
  const lastLine = lines[lines.length - 1].trim();
  const parts = lastLine.split(/\s+/).filter(Boolean);
  if (!parts.length || !parts.every((part) => /^#[^\s#]+$/.test(part))) {
    return { content: normalizedContent.trim(), topicTags: [] };
  }
  return {
    content: lines.slice(0, -1).join('\n').trim(),
    topicTags: parts,
  };
}

async function clickTab(page, tabSelector, tabText) {
  const clicked = await page.evaluate(({ inputSelector, inputSelectorAlt, selector, text }) => {
    const matches = (candidate) => String(candidate || '').replace(/\s+/g, ' ').trim() === text;
    const tabs = document.querySelectorAll(selector);
    for (const tab of tabs) {
      if (matches(tab.textContent)) {
        tab.click();
        return true;
      }
    }
    const allTabs = document.querySelectorAll('button, div, span, a, li');
    for (const tab of allTabs) {
      if (matches(tab.textContent)) {
        tab.click();
        return true;
      }
    }
    if (text.includes('图文')) {
      return !!document.querySelector(inputSelector) || !!document.querySelector(inputSelectorAlt);
    }
    return false;
  }, { inputSelector: SELECTORS.uploadInput, inputSelectorAlt: SELECTORS.uploadInputAlt, selector: tabSelector, text: tabText });
  if (!clicked) {
    throw new XhsCliError(`Could not find '${tabText}' tab. The page structure may have changed.`, {
      code: 'PUBLISH_TAB_NOT_FOUND',
    });
  }
  await delay(2000);
}

async function clickImageTextTab(page) {
  return await clickTab(page, SELECTORS.imageTextTab, SELECTORS.imageTextTabText);
}

async function clickVideoTab(page) {
  return await clickTab(page, SELECTORS.videoTab, SELECTORS.videoTabText);
}

async function findFirstHandle(page, selectors) {
  for (const selector of selectors) {
    const handle = await page.$(selector);
    if (handle) {return handle;}
  }
  return null;
}

async function waitForAnySelector(page, selectors, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const selector of selectors) {
      const handle = await page.$(selector);
      if (!handle) {continue;}
      const visible = await handle.evaluate((el) => {
        if (!(el instanceof HTMLElement)) {return false;}
        if (el.offsetParent === null) {return false;}
        const rect = el.getBoundingClientRect();
        return rect.width >= 8 && rect.height >= 8;
      }).catch(() => false);
      if (visible) {return selector;}
    }
    await delay(400);
  }
  return null;
}

async function uploadVideo(page, videoPath) {
  const normalized = path.resolve(String(videoPath || '').trim());
  if (!normalized) {
    throw new XhsCliError('A video file is required to publish video on Xiaohongshu.', { code: 'EMPTY_VIDEO_PATH' });
  }
  if (!fs.existsSync(normalized)) {
    throw new XhsCliError(`Video file not found: ${normalized}`, { code: 'VIDEO_FILE_NOT_FOUND' });
  }
  const input = await findFirstHandle(page, [SELECTORS.uploadInput, SELECTORS.uploadInputAlt]);
  if (!input) {
    throw new XhsCliError('Could not find file input element for video upload. The page structure may have changed.', {
      code: 'UPLOAD_INPUT_NOT_FOUND',
    });
  }
  await input.uploadFile(normalized);
  await delay(1500);
  return normalized;
}

async function waitVideoProcessing(page) {
  const deadline = Date.now() + VIDEO_PROCESS_TIMEOUT_MS;
  let lastProgressText = '';
  while (Date.now() < deadline) {
    const readySelector = await waitForAnySelector(page, [SELECTORS.titleInput, SELECTORS.titleInputAlt], 1200);
    if (readySelector) {
      await delay(1000);
      return { ready: true, progress: lastProgressText };
    }

    const progressText = await page.evaluate(() => {
      const els = document.querySelectorAll('[class*="progress"], [class*="percent"], [class*="upload"]');
      for (const el of els) {
        const text = (el.textContent || '').trim();
        if (text && /\d+%/.test(text)) {return text;}
      }
      return '';
    }).catch(() => '');
    if (progressText) {
      lastProgressText = progressText;
    }
    await delay(VIDEO_PROCESS_POLL_MS);
  }
  throw new XhsCliError('Video processing did not complete within the expected time window.', {
    code: 'VIDEO_PROCESS_TIMEOUT',
  });
}

async function uploadImages(page, imagePaths) {
  if (!Array.isArray(imagePaths) || !imagePaths.length) {
    throw new XhsCliError('At least one image is required to publish on Xiaohongshu.', { code: 'EMPTY_IMAGE_LIST' });
  }
  const normalized = imagePaths.map((item) => path.resolve(String(item || '').trim())).filter(Boolean);
  for (const filePath of normalized) {
    if (!fs.existsSync(filePath)) {
      throw new XhsCliError(`Image file not found: ${filePath}`, { code: 'IMAGE_FILE_NOT_FOUND' });
    }
  }
  const input = await findFirstHandle(page, [SELECTORS.uploadInput, SELECTORS.uploadInputAlt]);
  if (!input) {
    throw new XhsCliError('Could not find file input element. The page structure may have changed.', {
      code: 'UPLOAD_INPUT_NOT_FOUND',
    });
  }
  await input.uploadFile(...normalized);
  const readySelector = await waitForAnySelector(page, [SELECTORS.titleInput, SELECTORS.titleInputAlt], 20000);
  if (!readySelector) {
    throw new XhsCliError('Image upload did not reveal the editor within the expected time.', { code: 'UPLOAD_EDITOR_TIMEOUT' });
  }
  await delay(5000);
  return normalized;
}

async function findVisibleElement(page, selectors) {
  for (const selector of selectors) {
    const handles = await page.$$(selector);
    for (const handle of handles) {
      const visible = await handle.evaluate((el) => {
        if (!(el instanceof HTMLElement)) {return false;}
        if (el.offsetParent === null) {return false;}
        const rect = el.getBoundingClientRect();
        return rect.width >= 8 && rect.height >= 8;
      }).catch(() => false);
      if (visible) {return { selector, handle };}
    }
  }
  return null;
}

async function fillTitle(page, title, interactionMode = 'normal') {
  const target = await findVisibleElement(page, [SELECTORS.titleInput, SELECTORS.titleInputAlt]);
  if (!target) {
    throw new XhsCliError('Could not find title input element.', { code: 'TITLE_INPUT_NOT_FOUND' });
  }
  await humanReplaceInput(page, target.handle, title, interactionMode, { multiline: false });
}


async function fillContent(page, content, interactionMode = 'normal') {
  const target = await findVisibleElement(page, [SELECTORS.contentEditor, SELECTORS.contentEditorAlt]);
  if (!target) {
    throw new XhsCliError('Could not find content editor element.', { code: 'CONTENT_EDITOR_NOT_FOUND' });
  }
  await humanReplaceInput(page, target.handle, content, interactionMode, { multiline: true });
  await delay(300);
}

async function selectTopics(page, topicTags) {
  if (!Array.isArray(topicTags) || !topicTags.length) {
    return { selected: [], failed: [] };
  }

  const failedTags = [];
  const selectedTags = [];

  for (let index = 0; index < topicTags.length; index += 1) {
    const tag = String(topicTags[index] || '').trim();
    const normalizedTag = tag.replace(/^#/, '').trim();
    if (!normalizedTag) {continue;}

    const result = await page.evaluate(async ({ tagText, isFirst }) => {
      const editor = document.querySelector('div.tiptap.ProseMirror, div.ProseMirror[contenteditable="true"]');
      if (!editor) {
        return { ok: false, reason: 'editor_not_found' };
      }

      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const moveCaretToEditorEnd = (el) => {
        el.focus();
        const selection = window.getSelection();
        if (!selection) {return;}
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
      };
      const insertTextAtCaret = (text) => {
        let inserted = false;
        try {
          inserted = document.execCommand('insertText', false, text);
        } catch (error) {}
        if (!inserted) {
          const selection = window.getSelection();
          if (selection && selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            const node = document.createTextNode(text);
            range.insertNode(node);
            range.setStartAfter(node);
            range.collapse(true);
            selection.removeAllRanges();
            selection.addRange(range);
          } else {
            editor.appendChild(document.createTextNode(text));
          }
        }
        editor.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const pressEnter = (el) => {
        const evt = {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          which: 13,
          bubbles: true,
          cancelable: true,
        };
        el.dispatchEvent(new KeyboardEvent('keydown', evt));
        el.dispatchEvent(new KeyboardEvent('keypress', evt));
        el.dispatchEvent(new KeyboardEvent('keyup', evt));
      };

      moveCaretToEditorEnd(editor);
      if (isFirst) {
        insertTextAtCaret('\n');
      }
      insertTextAtCaret('#');
      await sleep(180);
      for (const ch of Array.from(tagText)) {
        insertTextAtCaret(ch);
        await sleep(45 + Math.floor(Math.random() * 50));
      }
      await sleep(3000);
      pressEnter(editor);
      await sleep(260);
      insertTextAtCaret(' ');
      return { ok: true };
    }, { tagText: normalizedTag, isFirst: index === 0 });

    if (!result || !result.ok) {
      failedTags.push(tag);
    } else {
      selectedTags.push(tag);
    }

    if (index < topicTags.length - 1) {
      await delay(450);
    }
  }

  return { selected: selectedTags, failed: failedTags };
}

async function findPublishButtonHandle(page) {
  const button = await page.evaluateHandle((buttonText) => {
    const buttons = document.querySelectorAll('button');
    for (const item of buttons) {
      const text = (item.textContent || '').trim();
      if (text === buttonText && item instanceof HTMLButtonElement && !item.disabled) {
        return item;
      }
    }
    const spans = document.querySelectorAll('.d-button-content .d-text, .d-button-content span');
    for (const span of spans) {
      if ((span.textContent || '').trim() === buttonText) {
        const el = span.closest('button, [role="button"], .d-button, [class*="btn"], [class*="button"]') || span;
        if (el instanceof HTMLElement) {return el;}
      }
    }
    return null;
  }, SELECTORS.publishButtonText);
  const element = button.asElement();
  if (!element) {
    throw new XhsCliError('Could not find publish button.', { code: 'PUBLISH_BUTTON_NOT_FOUND' });
  }
  return element;
}

async function waitForPublishOutcome(page, timeoutMs = 18000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const outcome = await page.evaluate(() => {
      const bodyText = ((document.body && (document.body.innerText || document.body.textContent)) || '').replace(/\s+/g, ' ').trim();
      const links = Array.from(document.querySelectorAll('a[href*="xiaohongshu.com/explore"]'));
      const noteLink = links.length ? links[0].href : '';
      const noteIdMatch = bodyText.match(/\b[0-9a-fA-F]{24}\b/);
      if (noteLink) {
        return { published: true, noteLink, detector: 'success-link' };
      }
      if (noteIdMatch) {
        return { published: true, noteLink: `https://www.xiaohongshu.com/explore/${noteIdMatch[0]}`, detector: 'body-note-id' };
      }
      const successKeywords = ['发布成功', '已发布', '笔记已发布'];
      if (successKeywords.some((keyword) => bodyText.includes(keyword))) {
        return { published: true, noteLink: '', detector: 'success-text' };
      }
      const failureKeywords = ['发布失败', '请稍后重试', '上传失败'];
      const failure = failureKeywords.find((keyword) => bodyText.includes(keyword));
      if (failure) {
        return { published: false, failureReason: failure, detector: 'failure-text' };
      }
      return { published: null, noteLink: '', detector: '' };
    });

    if (outcome && outcome.published === true) {
      return outcome;
    }
    if (outcome && outcome.published === false) {
      throw new XhsCliError(`Publish failed: ${outcome.failureReason || 'unknown error'}`, { code: 'PUBLISH_FAILED' });
    }
    await delay(800);
  }
  return { published: true, noteLink: '', detector: 'timeout-fallback' };
}

async function clickPublish(page, interactionMode = 'normal') {
  const handle = await findPublishButtonHandle(page);
  await humanPause(interactionMode, 600, 1400);
  await humanClickHandle(page, handle, interactionMode);
  await delay(1200);
  const outcome = await waitForPublishOutcome(page, 18000);
  await assertNoRiskSignals(page, { actionType: 'publish', stage: 'post-click-publish' });
  return outcome;
}

async function fillVideoPost(page, { title, content, videoPath, interactionMode = 'normal' }) {
  const extracted = extractTopicTagsFromLastLine(content);
  await gotoAndSettled(page, XHS_CREATOR_PUBLISH_URL, { settleMs: 2000, timeout: 30000 });
  await assertNoRiskSignals(page, { actionType: 'fill', stage: 'open-publish-page' });
  await assertNoRiskSignals(page, { actionType: 'fill', stage: 'open-publish-page' });
  await clickVideoTab(page);
  const uploadedVideoPath = await uploadVideo(page, videoPath);
  const videoProcessing = await waitVideoProcessing(page);
  await humanScrollPage(page, interactionMode, 1);
  await fillTitle(page, title, interactionMode);
  await fillContent(page, extracted.content, interactionMode);
  const topicResult = await selectTopics(page, extracted.topicTags);
  return {
    title,
    content_length: String(extracted.content || '').length,
    original_content_length: String(content || '').length,
    video_path: uploadedVideoPath,
    video_processing: videoProcessing,
    topic_tags: extracted.topicTags,
    topic_selection: topicResult,
    ready_to_publish: true,
    mode: 'video',
  };
}

async function fillImageTextPost(page, { title, content, imagePaths, interactionMode = 'normal' }) {
  const extracted = extractTopicTagsFromLastLine(content);
  await gotoAndSettled(page, XHS_CREATOR_PUBLISH_URL, { settleMs: 2000, timeout: 30000 });
  await clickImageTextTab(page);
  const uploaded = await uploadImages(page, imagePaths);
  await humanScrollPage(page, interactionMode, 1);
  await fillTitle(page, title, interactionMode);
  await fillContent(page, extracted.content, interactionMode);
  const topicResult = await selectTopics(page, extracted.topicTags);
  return {
    title,
    content_length: String(extracted.content || '').length,
    original_content_length: String(content || '').length,
    image_count: uploaded.length,
    image_paths: uploaded,
    topic_tags: extracted.topicTags,
    topic_selection: topicResult,
    ready_to_publish: true,
    mode: 'image_text',
  };
}

async function publishImageTextPost(page, { title, content, imagePaths, interactionMode = 'normal' }) {
  const fillPayload = await fillImageTextPost(page, { title, content, imagePaths, interactionMode });
  const outcome = await clickPublish(page, interactionMode);
  return {
    ...fillPayload,
    note_link: outcome.noteLink || '',
    publish_detector: outcome.detector || '',
    published: true,
  };
}

async function publishVideoPost(page, { title, content, videoPath, interactionMode = 'normal' }) {
  const fillPayload = await fillVideoPost(page, { title, content, videoPath, interactionMode });
  const outcome = await clickPublish(page, interactionMode);
  return {
    ...fillPayload,
    note_link: outcome.noteLink || '',
    publish_detector: outcome.detector || '',
    published: true,
  };
}

module.exports = {
  clickImageTextTab,
  clickVideoTab,
  uploadImages,
  uploadVideo,
  waitVideoProcessing,
  fillTitle,
  fillContent,
  extractTopicTagsFromLastLine,
  selectTopics,
  clickPublish,
  fillImageTextPost,
  publishImageTextPost,
  fillVideoPost,
  publishVideoPost,
};
