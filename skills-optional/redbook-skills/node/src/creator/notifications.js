const { XHS_HOME_URL } = require('../core/constants');
const { gotoAndSettled, delay } = require('../core/browser');
const { XhsCliError } = require('../core/errors');

const XHS_NOTIFICATION_URL = 'https://www.xiaohongshu.com/notification';
const XHS_NOTIFICATION_MENTIONS_API_PATH = '/api/sns/web/v1/you/mentions';
const XHS_EDITH_MENTIONS_URL = 'https://edith.xiaohongshu.com/api/sns/web/v1/you/mentions?num=20&cursor=';

async function scheduleClickNotificationMentionsTab(page) {
  const clickedText = await page.evaluate(() => {
    const keywordSet = new Set([
      '评论和@',
      '评论和 @',
      '评论与@',
      '提到我的',
      '@我的',
      'mentions',
    ]);
    const selectors = [
      "[role='tab']",
      'button',
      'a',
      "div[class*='tab']",
      "div[class*='menu-item']",
      "li[class*='tab-item']",
      "li[class*='tab']",
    ];
    const seen = new Set();
    const candidates = [];
    for (const selector of selectors) {
      const nodes = document.querySelectorAll(selector);
      for (const node of nodes) {
        if (!(node instanceof HTMLElement)) {continue;}
        if (node.offsetParent === null) {continue;}
        if (seen.has(node)) {continue;}
        seen.add(node);
        candidates.push(node);
      }
    }

    for (const node of candidates) {
      const text = (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text || text.length > 24) {continue;}
      const normalized = text.replace(/\d+/g, '').replace(/\s+/g, '');
      const exactMatches = [normalized, text.replace(/\d+/g, '').trim()];
      if (!exactMatches.some((candidate) => keywordSet.has(candidate))) {continue;}
      window.setTimeout(() => {
        try { node.click(); } catch (error) {}
      }, 80);
      return text;
    }
    return '';
  });
  return typeof clickedText === 'string' ? clickedText.trim() : '';
}

async function fetchNotificationMentionsViaPage(page) {
  const result = await page.evaluate(async (targetUrl) => {
    try {
      const resp = await fetch(targetUrl, {
        method: 'GET',
        credentials: 'include',
        headers: {
          Accept: 'application/json, text/plain, */*',
        },
      });
      const text = await resp.text();
      return { ok: resp.ok, status: resp.status, url: resp.url, body: text };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  }, XHS_EDITH_MENTIONS_URL);

  if (!result || !result.ok || Number(result.status) !== 200 || typeof result.body !== 'string' || !result.body.trim()) {
    return null;
  }

  let payload;
  try {
    payload = JSON.parse(result.body);
  } catch (error) {
    return null;
  }
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const data = payload.data && typeof payload.data === 'object' ? payload.data : null;
  let items = [];
  if (data) {
    for (const key of ['message_list', 'items', 'mentions', 'list']) {
      if (Array.isArray(data[key])) {
        items = data[key];
        break;
      }
    }
  }

  return {
    request_url: result.url || XHS_EDITH_MENTIONS_URL,
    count: items.length,
    has_more: data ? data.has_more : null,
    cursor: data ? data.cursor : null,
    items,
    raw_payload: payload,
    capture_mode: 'page_fetch',
  };
}

async function extractNotificationMentionsFromDom(page) {
  const result = await page.evaluate(() => {
    const normalize = (text) => (text || '').replace(/\s+/g, ' ').trim();
    const isVisible = (node) => node instanceof HTMLElement && node.offsetParent !== null;
    const items = [];
    const containers = Array.from(document.querySelectorAll('section, main, div, li, article'));
    for (const node of containers) {
      if (!(node instanceof HTMLElement) || !isVisible(node)) {continue;}
      const text = normalize(node.innerText || node.textContent || '');
      if (!text || text.length < 12 || text.length > 400) {continue;}
      const hasInteractionWord = ['评论', '@', '回复', '提到'].some((k) => text.includes(k));
      if (!hasInteractionWord) {continue;}
      const noiseTexts = ['评论和@ 赞和收藏 新增关注', '取消评论将会清空已经输入的内容确认返回'];
      if (noiseTexts.includes(text)) {continue;}
      const links = Array.from(node.querySelectorAll('a[href]')).map((a) => ({
        text: normalize(a.innerText || a.textContent || ''),
        href: a.href || a.getAttribute('href') || '',
      })).filter((item) => item.href).slice(0, 6);
      const images = Array.from(node.querySelectorAll('img')).map((img) => img.getAttribute('src') || '').filter(Boolean).slice(0, 4);
      const hasProfileLink = links.some((item) => item.href.includes('/user/profile/'));
      const hasNoticeLink = links.some((item) => item.href.includes('xsec_source=pc_notice') || item.href.includes('/explore/'));
      if (!hasProfileLink && !hasNoticeLink && text.length < 18) {continue;}
      const actor = links.find((item) => item.text) || links[0] || null;
      let action = '';
      if (text.includes('回复了你的评论')) {action = 'reply_to_comment';}
      else if (text.includes('评论了你的笔记')) {action = 'comment_on_note';}
      else if (text.includes('提到')) {action = 'mention';}
      else if (text.includes('@')) {action = 'mention';}
      const timeMatch = text.match(/(\d{2}-\d{2}|\d{4}-\d{2}-\d{2}|\d+小时前|\d+分钟前|昨天)/);
      const targetLink = links.find((item) => item.href.includes('xsec_source=pc_notice') || item.href.includes('/explore/')) || null;
      items.push({
        text,
        actor_name: actor ? (actor.text || '') : '',
        actor_url: actor ? actor.href : '',
        action,
        time_text: timeMatch ? timeMatch[0] : '',
        target_url: targetLink ? targetLink.href : '',
        links,
        images,
      });
      if (items.length >= 30) {break;}
    }
    const dedup = [];
    const seen = new Set();
    for (const item of items) {
      const key = item.text.slice(0, 120);
      if (seen.has(key)) {continue;}
      seen.add(key);
      dedup.push(item);
    }
    return {
      title: document.title,
      url: location.href,
      count: dedup.length,
      items: dedup,
    };
  });
  if (!result || typeof result !== 'object' || !Array.isArray(result.items) || !result.items.length) {
    return null;
  }
  return {
    request_url: result.url || XHS_NOTIFICATION_URL,
    count: result.items.length,
    has_more: null,
    cursor: null,
    items: result.items,
    raw_payload: result,
    capture_mode: 'dom_fallback',
  };
}

async function captureNotificationMentionsViaNetwork(page, waitSeconds = 18) {
  return await new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      finishError(new XhsCliError(`Timed out waiting for ${XHS_NOTIFICATION_MENTIONS_API_PATH} response body. Please open the target page manually and retry.`, {
        code: 'MENTIONS_TIMEOUT',
      }));
    }, Math.max(1000, Math.floor(Number(waitSeconds || 18) * 1000)));

    const finish = (result) => {
      if (settled) {return;}
      settled = true;
      clearTimeout(timer);
      page.off('response', onResponse);
      resolve(result);
    };
    const finishError = (error) => {
      if (settled) {return;}
      settled = true;
      clearTimeout(timer);
      page.off('response', onResponse);
      reject(error);
    };

    const onResponse = async (response) => {
      const url = response.url();
      if (!url.includes(XHS_NOTIFICATION_MENTIONS_API_PATH)) {return;}
      const status = response.status();
      if (status !== 200) {
        finishError(new XhsCliError(`API responded with non-200 status: ${status}, url=${url}`, {
          code: 'MENTIONS_STATUS_ERROR',
        }));
        return;
      }
      try {
        const text = await response.text();
        const payload = JSON.parse(text);
        if (!payload || typeof payload !== 'object') {
          finishError(new XhsCliError('Unexpected notification mentions payload structure.', { code: 'MENTIONS_INVALID_PAYLOAD' }));
          return;
        }
        const data = payload.data && typeof payload.data === 'object' ? payload.data : null;
        let items = [];
        if (data) {
          for (const key of ['message_list', 'items', 'mentions', 'list']) {
            if (Array.isArray(data[key])) {
              items = data[key];
              break;
            }
          }
        }
        finish({
          request_url: url,
          count: items.length,
          has_more: data ? data.has_more : null,
          cursor: data ? data.cursor : null,
          items,
          raw_payload: payload,
          capture_mode: 'network_capture',
        });
      } catch (error) {
        finishError(new XhsCliError(`Failed to decode notification mentions API JSON: ${error.message}`, {
          code: 'MENTIONS_INVALID_JSON',
        }));
      }
    };

    page.on('response', onResponse);
  });
}

async function getNotificationMentions(page, { waitSeconds = 18 } = {}) {
  const effectiveWaitSeconds = Math.max(5, Number(waitSeconds) || 18);
  await gotoAndSettled(page, XHS_NOTIFICATION_URL, { settleMs: 1200, timeout: 30000 });

  const directPayload = await fetchNotificationMentionsViaPage(page);
  if (directPayload) {
    return directPayload;
  }

  let clickedTab = await scheduleClickNotificationMentionsTab(page);
  if (clickedTab) {
    await delay(1200);
  }

  const domPayload = await extractNotificationMentionsFromDom(page);
  if (domPayload) {
    return domPayload;
  }

  try {
    return await captureNotificationMentionsViaNetwork(page, effectiveWaitSeconds);
  } catch (firstError) {
    clickedTab = await scheduleClickNotificationMentionsTab(page);
    if (clickedTab) {
      await delay(1000);
      return await captureNotificationMentionsViaNetwork(page, Math.max(6, effectiveWaitSeconds / 2));
    }
    throw firstError;
  }
}

module.exports = {
  getNotificationMentions,
};
