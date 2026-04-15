const {
  FEED_DETAIL_URL_TEMPLATE,
  SEARCH_BASE_URL,
  SEARCH_RECOMMEND_API_PATH,
} = require('../core/constants');
const { gotoAndSettled, delay } = require('../core/browser');
const { XhsCliError } = require('../core/errors');

function makeSearchUrl(keyword) {
  const normalized = String(keyword || '').trim();
  if (!normalized) {
    throw new XhsCliError('Keyword cannot be empty.', { code: 'EMPTY_KEYWORD' });
  }
  const params = new URLSearchParams({ keyword: normalized, source: 'web_explore_feed' });
  return `${SEARCH_BASE_URL}?${params.toString()}`;
}

function makeFeedDetailUrl(feedId, xsecToken) {
  const normalizedFeedId = String(feedId || '').trim();
  const normalizedToken = String(xsecToken || '').trim();
  if (!normalizedFeedId) {
    throw new XhsCliError('feed_id cannot be empty.', { code: 'EMPTY_FEED_ID' });
  }
  if (!normalizedToken) {
    throw new XhsCliError('xsec_token cannot be empty.', { code: 'EMPTY_XSEC_TOKEN' });
  }
  return FEED_DETAIL_URL_TEMPLATE
    .replace('{feed_id}', encodeURIComponent(normalizedFeedId))
    .replace('{xsec_token}', encodeURIComponent(normalizedToken));
}

function extractRecommendKeywordsFromPayload(payload, keyword, maxSuggestions = 12) {
  const ignoredTexts = new Set(['历史记录', '猜你想搜', '相关搜索', '热门搜索', '大家都在搜', '清空历史', '删除历史']);
  const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const ordered = [];
  const seen = new Set();

  const pushText = (value) => {
    const normalized = normalizeText(value);
    if (!normalized || normalized === keyword) {return;}
    if (ignoredTexts.has(normalized)) {return;}
    if (normalized.length < 2 || normalized.length > 36) {return;}
    if (seen.has(normalized)) {return;}
    seen.add(normalized);
    ordered.push(normalized);
  };

  const stack = [payload];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) {continue;}
    if (Array.isArray(node)) {
      for (const item of node) {
        if (typeof item === 'string') {
          pushText(item);
        } else if (item && typeof item === 'object') {
          stack.push(item);
        }
      }
      continue;
    }
    if (typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        if (typeof value === 'string') {
          const keyLc = key.toLowerCase();
          if (['word', 'query', 'keyword', 'text', 'title', 'name', 'suggest'].some((hint) => keyLc.includes(hint))) {
            pushText(value);
          }
          continue;
        }
        if (value && typeof value === 'object') {
          stack.push(value);
        }
      }
    }
  }

  const prefix = String(keyword || '').slice(0, 2);
  return ordered
    .map((text, index) => {
      let score = 0;
      if (keyword && (text.includes(keyword) || keyword.includes(text))) {
        score += 3;
      } else if (prefix && text.includes(prefix)) {
        score += 1;
      }
      return { text, index, score };
    })
    .toSorted((a, b) => (b.score - a.score) || (a.index - b.index))
    .slice(0, Math.max(1, maxSuggestions))
    .map((item) => item.text);
}

async function prepareSearchInputKeyword(page, keyword) {
  return await page.evaluate(async (inputKeyword) => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const isVisible = (node) => {
      if (!(node instanceof HTMLElement)) {return false;}
      if (node.offsetParent === null) {return false;}
      const rect = node.getBoundingClientRect();
      return rect.width >= 8 && rect.height >= 8;
    };
    const selectors = [
      '#search-input',
      'input.search-input',
      'input[type="search"]',
      'input[placeholder*="搜索"]',
      '[class*="search"] input',
    ];

    let inputEl = null;
    for (const selector of selectors) {
      const nodes = document.querySelectorAll(selector);
      for (const node of nodes) {
        if (!(node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement)) {continue;}
        if (node.disabled || !isVisible(node)) {continue;}
        inputEl = node;
        break;
      }
      if (inputEl) {break;}
    }

    if (!inputEl) {
      return { ok: false, reason: 'search_input_not_found' };
    }

    const setValue = (value) => {
      const proto = inputEl instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
      if (descriptor && typeof descriptor.set === 'function') {
        descriptor.set.call(inputEl, value);
      } else {
        inputEl.value = value;
      }
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    };

    inputEl.focus();
    await sleep(120);
    setValue('');
    await sleep(80);

    let typed = '';
    for (const ch of Array.from(inputKeyword)) {
      typed += ch;
      setValue(typed);
      await sleep(55 + Math.floor(Math.random() * 70));
    }
    await sleep(220);
    return { ok: true, reason: '' };
  }, keyword);
}

async function captureSearchRecommendationsViaNetwork(page, keyword, timeoutMs = 8000) {
  return await new Promise(async (resolve) => {
    let settled = false;
    const timer = setTimeout(() => finish({ ok: false, reason: 'recommend_request_timeout', suggestions: [] }), timeoutMs);

    const finish = (result) => {
      if (settled) {return;}
      settled = true;
      clearTimeout(timer);
      page.off('response', onResponse);
      resolve(result);
    };

    const onResponse = async (response) => {
      const url = response.url();
      if (!url.includes(SEARCH_RECOMMEND_API_PATH)) {
        return;
      }
      try {
        const text = await response.text();
        const payload = JSON.parse(text);
        if (!payload || typeof payload !== 'object') {
          finish({ ok: false, reason: 'recommend_invalid_payload', suggestions: [] });
          return;
        }
        finish({
          ok: true,
          reason: '',
          request_url: url,
          suggestions: extractRecommendKeywordsFromPayload(payload, keyword, 12),
        });
      } catch (error) {
        finish({ ok: false, reason: `recommend_parse_error:${error.message}`, suggestions: [] });
      }
    };

    page.on('response', onResponse);
    try {
      const typed = await prepareSearchInputKeyword(page, keyword);
      if (!typed || !typed.ok) {
        finish({ ok: false, reason: typed && typed.reason ? typed.reason : 'type_keyword_failed', suggestions: [] });
      }
    } catch (error) {
      finish({ ok: false, reason: `type_keyword_failed:${error.message}`, suggestions: [] });
    }
  });
}

async function waitForSearchState(page) {
  await page.waitForFunction(() => {
    const state = window.__INITIAL_STATE__;
    return Boolean(state && state.search && state.search.feeds);
  }, { timeout: 25000 });
}

async function extractSearchFeeds(page) {
  const raw = await page.evaluate(() => {
    if (
      window.__INITIAL_STATE__ &&
      window.__INITIAL_STATE__.search &&
      window.__INITIAL_STATE__.search.feeds
    ) {
      const feeds = window.__INITIAL_STATE__.search.feeds;
      const data = feeds.value !== undefined ? feeds.value : feeds._value;
      try {
        return JSON.stringify(data || []);
      } catch (error) {
        return '';
      }
    }
    return '';
  });
  if (!raw) {
    return [];
  }
  if (typeof raw !== 'string') {
    throw new XhsCliError('Search feed payload is not a JSON string.', { code: 'INVALID_SEARCH_PAYLOAD' });
  }
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (error) {
    throw new XhsCliError(`Failed to parse search feed JSON: ${error.message}`, { code: 'INVALID_SEARCH_PAYLOAD' });
  }
  if (!Array.isArray(payload)) {
    throw new XhsCliError('Search feed payload is not a list.', { code: 'INVALID_SEARCH_PAYLOAD' });
  }
  return payload;
}

async function searchFeeds(page, { keyword, filters = null }) {
  if (filters && Object.values(filters).some(Boolean)) {
    throw new XhsCliError('Node skeleton does not apply interactive search filters yet. Please use the Python driver for filtered search.', {
      code: 'FILTERS_NOT_IMPLEMENTED',
      exitCode: 2,
    });
  }

  const normalizedKeyword = String(keyword || '').trim();
  if (!normalizedKeyword) {
    throw new XhsCliError('Keyword cannot be empty.', { code: 'EMPTY_KEYWORD' });
  }

  await gotoAndSettled(page, SEARCH_BASE_URL, { settleMs: 1800 });
  const recommend = await captureSearchRecommendationsViaNetwork(page, normalizedKeyword, 8000);
  if (!recommend.ok) {
    await delay(500);
  }

  await gotoAndSettled(page, makeSearchUrl(normalizedKeyword), { settleMs: 1800 });
  await waitForSearchState(page);
  const feeds = await extractSearchFeeds(page);
  return {
    keyword: normalizedKeyword,
    recommended_keywords: Array.isArray(recommend.suggestions) ? recommend.suggestions : [],
    feeds,
  };
}

async function waitForDetailState(page) {
  await page.waitForFunction(() => {
    const state = window.__INITIAL_STATE__;
    return Boolean(state && state.note && state.note.noteDetailMap);
  }, { timeout: 25000 });
}

async function getFeedDetail(page, { feedId, xsecToken }) {
  const normalizedFeedId = String(feedId || '').trim();
  const normalizedToken = String(xsecToken || '').trim();
  if (!normalizedFeedId) {
    throw new XhsCliError('feed_id cannot be empty.', { code: 'EMPTY_FEED_ID' });
  }
  if (!normalizedToken) {
    throw new XhsCliError('xsec_token cannot be empty.', { code: 'EMPTY_XSEC_TOKEN' });
  }

  await gotoAndSettled(page, makeFeedDetailUrl(normalizedFeedId, normalizedToken), { settleMs: 1800 });
  await waitForDetailState(page);
  const detail = await page.evaluate((currentFeedId) => {
    const state = window.__INITIAL_STATE__;
    if (!state || !state.note || !state.note.noteDetailMap) {
      return null;
    }
    const detailMap = state.note.noteDetailMap;
    if (detailMap[currentFeedId]) {
      return detailMap[currentFeedId];
    }
    const keys = Object.keys(detailMap || {});
    if (keys.length === 1 && detailMap[keys[0]]) {
      return detailMap[keys[0]];
    }
    return null;
  }, normalizedFeedId);

  if (!detail || typeof detail !== 'object') {
    throw new XhsCliError(`Could not find feed detail for id '${normalizedFeedId}' in noteDetailMap.`, {
      code: 'DETAIL_NOT_FOUND',
    });
  }
  return detail;
}

module.exports = {
  makeSearchUrl,
  makeFeedDetailUrl,
  searchFeeds,
  getFeedDetail,
};
