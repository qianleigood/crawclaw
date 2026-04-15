const { gotoAndSettled, delay } = require('../core/browser');
const { humanClickHandle, humanPause, humanReplaceInput } = require('../core/human');
const { assertNoRiskSignals } = require('../core/risk');
const { XhsCliError } = require('../core/errors');
const { makeFeedDetailUrl } = require('../feeds/search');
const { getNotificationMentions } = require('../creator/notifications');

async function checkFeedPageAccessible(page) {
  const issue = await page.evaluate((keywords) => {
    const wrappers = document.querySelectorAll('.access-wrapper, .error-wrapper, .not-found-wrapper, .blocked-wrapper');
    if (!wrappers.length) {return '';}
    let text = '';
    for (const el of wrappers) {
      const chunk = (el.innerText || el.textContent || '').trim();
      if (chunk) {text += (text ? ' ' : '') + chunk;}
    }
    const fullText = text.trim();
    if (!fullText) {return '';}
    for (const kw of keywords) {
      if (fullText.includes(kw)) {return kw;}
    }
    return fullText.slice(0, 180);
  }, ['内容无法查看', '内容不存在', '内容违规', '仅自己可见', '已删除']);
  if (typeof issue === 'string' && issue.trim()) {
    throw new XhsCliError(`Feed page is not accessible: ${issue.trim()}`, { code: 'FEED_INACCESSIBLE' });
  }
}

async function focusCommentInput(page, interactionMode = 'normal') {
  const selectors = [
    'div.input-box div.content-edit span',
    'div.input-box div.content-edit p.content-input',
    'div.input-box div.content-edit',
    'div.input-box',
  ];
  for (const selector of selectors) {
    const handle = await page.$(selector);
    if (!handle) {continue;}
    const visible = await handle.evaluate((el) => el instanceof HTMLElement && el.offsetParent !== null).catch(() => false);
    if (!visible) {continue;}
    await humanClickHandle(page, handle, interactionMode);
    await delay(400);
    return true;
  }
  return false;
}

async function waitCommentInputReady(page, timeoutMs = 8000) {
  const selectors = [
    'textarea.comment-input',
    '.input-wrapper textarea',
    'textarea',
    'div.input-box div.content-edit p.content-input',
    'div.input-box div.content-edit [contenteditable="true"]',
    'div.input-box .content-input',
    'p.content-input',
    '[class*="content-edit"] [contenteditable="true"]',
  ];
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const selector of selectors) {
      const handle = await page.$(selector);
      if (!handle) {continue;}
      const visible = await handle.evaluate((el) => el instanceof HTMLElement && el.offsetParent !== null).catch(() => false);
      if (visible) {return true;}
    }
    await delay(250);
  }
  return false;
}

async function fillCommentContent(page, content, interactionMode = 'normal') {
  const candidates = [
    'textarea.comment-input',
    '.input-wrapper textarea',
    'textarea',
    'div.input-box div.content-edit p.content-input',
    'div.input-box div.content-edit [contenteditable="true"]',
    'div.input-box .content-input',
    'p.content-input',
    '[class*="content-edit"] [contenteditable="true"]',
  ];
  for (const selector of candidates) {
    const handle = await page.$(selector);
    if (!handle) {continue;}
    const visible = await handle.evaluate((el) => el instanceof HTMLElement && el.offsetParent !== null).catch(() => false);
    if (!visible) {continue;}
    await humanReplaceInput(page, handle, content, interactionMode, { multiline: true });
    return String(content || '').trim().length;
  }
  throw new XhsCliError('Failed to fill comment content: comment_input_not_found', { code: 'COMMENT_FILL_FAILED' });
}

async function clickCommentSubmitButton(page, interactionMode = 'normal') {
  const selectors = [
    'div.bottom button.submit',
    'div.bottom button[class*="submit"]',
    'button.submit',
    'button[class*="submit"]',
    'button[type="submit"]',
  ];
  let element = null;
  for (const selector of selectors) {
    const handle = await page.$(selector);
    if (!handle) {continue;}
    const ok = await handle.evaluate((el) => el instanceof HTMLButtonElement && el.offsetParent !== null && !el.disabled && el.getBoundingClientRect().width >= 8 && el.getBoundingClientRect().height >= 8).catch(() => false);
    if (ok) {
      element = handle;
      break;
    }
  }
  if (!element) {
    const handles = await page.$$('button');
    for (const handle of handles) {
      const ok = await handle.evaluate((button) => {
        if (!(button instanceof HTMLButtonElement) || button.offsetParent === null || button.disabled) {return false;}
        const text = (button.textContent || '').replace(/\s+/g, ' ').trim();
        return ['发送', '提交', '评论', '回复'].includes(text);
      }).catch(() => false);
      if (ok) {
        element = handle;
        break;
      }
    }
  }
  if (!element) {
    throw new XhsCliError('Could not find visible comment submit button.', { code: 'COMMENT_SUBMIT_NOT_FOUND' });
  }
  await humanPause(interactionMode, 400, 900);
  await humanClickHandle(page, element, interactionMode);
}

async function postCommentToFeed(page, { feedId, xsecToken, content, interactionMode = 'normal' }) {
  const normalizedFeedId = String(feedId || '').trim();
  const normalizedToken = String(xsecToken || '').trim();
  const normalizedContent = String(content || '').trim();
  if (!normalizedFeedId) {throw new XhsCliError('feed_id cannot be empty.', { code: 'EMPTY_FEED_ID' });}
  if (!normalizedToken) {throw new XhsCliError('xsec_token cannot be empty.', { code: 'EMPTY_XSEC_TOKEN' });}
  if (!normalizedContent) {throw new XhsCliError('content cannot be empty.', { code: 'EMPTY_CONTENT' });}

  await gotoAndSettled(page, makeFeedDetailUrl(normalizedFeedId, normalizedToken), { settleMs: 1800, timeout: 30000 });
  await assertNoRiskSignals(page, { actionType: 'comment', stage: 'open-feed-detail' });
  await checkFeedPageAccessible(page);
  await focusCommentInput(page, interactionMode);
  const filledLen = await fillCommentContent(page, normalizedContent, interactionMode);
  await delay(600);
  await clickCommentSubmitButton(page, interactionMode);
  await delay(1000);
  return {
    feed_id: normalizedFeedId,
    xsec_token: normalizedToken,
    content_length: filledLen,
    success: true,
  };
}

async function replyToCommentViaFeedDetail(page, { feedId, xsecToken, content, targetAuthor = '', targetText = '', dryRun = false, interactionMode = 'normal' }) {
  const normalizedFeedId = String(feedId || '').trim();
  const normalizedToken = String(xsecToken || '').trim();
  if (!normalizedFeedId) {throw new XhsCliError('feed_id cannot be empty for detail-page fallback.', { code: 'EMPTY_FEED_ID' });}
  if (!normalizedToken) {throw new XhsCliError('xsec_token cannot be empty for detail-page fallback.', { code: 'EMPTY_XSEC_TOKEN' });}

  await gotoAndSettled(page, makeFeedDetailUrl(normalizedFeedId, normalizedToken), { settleMs: 2200, timeout: 30000 });
  await assertNoRiskSignals(page, { actionType: 'comment', stage: 'open-feed-detail' });
  await checkFeedPageAccessible(page);

  const matchResult = await page.evaluate(({ author, text }) => {
    const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
    const isVisible = (node) => node instanceof HTMLElement && node.offsetParent !== null;
    const replyTexts = new Set(['回复']);
    const buttons = Array.from(document.querySelectorAll('button, span, div, a')).filter((node) => isVisible(node));
    for (const node of buttons) {
      const label = normalize(node.innerText || node.textContent || '');
      if (!replyTexts.has(label)) {continue;}
      let container = node.parentElement;
      let depth = 0;
      while (container && depth < 8) {
        const containerText = normalize(container.innerText || container.textContent || '');
        const authorOk = !author || containerText.includes(author);
        const textOk = !text || containerText.includes(text);
        if (authorOk && textOk) {
          const rect = node.getBoundingClientRect();
          if (rect.width >= 4 && rect.height >= 4) {
            return { ok: true, containerText: containerText.slice(0, 400), x: rect.x, y: rect.y, width: rect.width, height: rect.height };
          }
        }
        container = container.parentElement;
        depth += 1;
      }
    }
    return { ok: false, reason: 'reply_button_for_target_comment_not_found' };
  }, { author: String(targetAuthor || '').trim(), text: String(targetText || '').trim() });

  if (!matchResult || !matchResult.ok) {
    throw new XhsCliError(`Failed to locate target comment reply button: ${matchResult && matchResult.reason ? matchResult.reason : 'unknown'}`, {
      code: 'REPLY_TARGET_NOT_FOUND',
    });
  }

  await page.mouse.move(Number(matchResult.x) + Number(matchResult.width) / 2, Number(matchResult.y) + Number(matchResult.height) / 2);
  await humanPause(interactionMode, 220, 540);
  await page.mouse.click(Number(matchResult.x) + Number(matchResult.width) / 2, Number(matchResult.y) + Number(matchResult.height) / 2);
  await delay(800);
  await waitCommentInputReady(page, 8000);
  const filledLen = await fillCommentContent(page, content, interactionMode);
  await delay(500);
  if (!dryRun) {
    await clickCommentSubmitButton(page, interactionMode);
    await delay(1000);
  }
  return {
    feed_id: normalizedFeedId,
    xsec_token: normalizedToken,
    target_author: String(targetAuthor || '').trim(),
    target_text: String(targetText || '').trim(),
    matched_comment_preview: String(matchResult.containerText || '').slice(0, 200),
    content_length: filledLen,
    success: true,
    dry_run: Boolean(dryRun),
    route: 'feed_detail_fallback',
  };
}

async function replyToCommentInFeed(page, { feedId = '', xsecToken = '', content = '', targetAuthor = '', targetText = '', dryRun = false, interactionMode = 'normal' }) {
  const normalizedContent = String(content || '').trim();
  const normalizedAuthor = String(targetAuthor || '').trim();
  const normalizedTargetText = String(targetText || '').trim();
  if (!normalizedContent) {throw new XhsCliError('content cannot be empty.', { code: 'EMPTY_CONTENT' });}
  if (!normalizedAuthor && !normalizedTargetText) {
    throw new XhsCliError('At least one of target_author or target_text must be provided.', { code: 'EMPTY_REPLY_TARGET' });
  }

  await gotoAndSettled(page, 'https://www.xiaohongshu.com/notification', { settleMs: 2000, timeout: 30000 });
  await assertNoRiskSignals(page, { actionType: 'comment', stage: 'open-notification-page' });
  try {
    await getNotificationMentions(page, { waitSeconds: 6 });
  } catch (error) {
    // ignore and continue with direct DOM matching below
  }
  await delay(1200);

  const matchResult = await page.evaluate(({ author, text }) => {
    const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
    const isVisible = (node) => node instanceof HTMLElement && node.offsetParent !== null;
    const replyTexts = new Set(['回复']);
    const candidates = Array.from(document.querySelectorAll('button, span, div, a')).filter((node) => isVisible(node));
    const matches = [];
    for (const node of candidates) {
      const label = normalize(node.innerText || node.textContent || '');
      if (!replyTexts.has(label)) {continue;}
      let container = node.parentElement;
      let depth = 0;
      while (container && depth < 8) {
        const containerText = normalize(container.innerText || container.textContent || '');
        if (!containerText || containerText.length < 10 || containerText.length > 500) {
          container = container.parentElement;
          depth += 1;
          continue;
        }
        const authorOk = !author || containerText.includes(author);
        const textOk = !text || containerText.includes(text);
        if (authorOk && textOk) {
          const rect = node.getBoundingClientRect();
          if (rect.width >= 4 && rect.height >= 4) {
            matches.push({ ok: true, containerText: containerText.slice(0, 400), x: rect.x, y: rect.y, width: rect.width, height: rect.height, area: rect.width * rect.height });
          }
          break;
        }
        container = container.parentElement;
        depth += 1;
      }
    }
    if (!matches.length) {return { ok: false, reason: 'notification_reply_button_not_found' };}
    matches.sort((a, b) => a.area - b.area);
    return matches[0];
  }, { author: normalizedAuthor, text: normalizedTargetText });

  if (matchResult && matchResult.ok) {
    await page.mouse.move(Number(matchResult.x) + Number(matchResult.width) / 2, Number(matchResult.y) + Number(matchResult.height) / 2);
  await humanPause(interactionMode, 220, 540);
  await page.mouse.click(Number(matchResult.x) + Number(matchResult.width) / 2, Number(matchResult.y) + Number(matchResult.height) / 2);
    await delay(800);
    await waitCommentInputReady(page, 8000);
    const filledLen = await fillCommentContent(page, normalizedContent, interactionMode);
    await delay(500);
    if (!dryRun) {
      await clickCommentSubmitButton(page, interactionMode);
      await delay(1000);
    }
    return {
      feed_id: String(feedId || '').trim(),
      xsec_token: String(xsecToken || '').trim(),
      target_author: normalizedAuthor,
      target_text: normalizedTargetText,
      matched_comment_preview: String(matchResult.containerText || '').slice(0, 200),
      content_length: filledLen,
      success: true,
      dry_run: Boolean(dryRun),
      route: 'notification_page',
    };
  }

  if (String(feedId || '').trim() && String(xsecToken || '').trim()) {
    return await replyToCommentViaFeedDetail(page, {
      feedId,
      xsecToken,
      content: normalizedContent,
      targetAuthor: normalizedAuthor,
      targetText: normalizedTargetText,
      dryRun,
      interactionMode,
    });
  }

  throw new XhsCliError(`Failed to locate reply target on notification page: ${matchResult && matchResult.reason ? matchResult.reason : 'unknown'}`, {
    code: 'REPLY_TARGET_NOT_FOUND',
  });
}

module.exports = {
  postCommentToFeed,
  replyToCommentInFeed,
};
