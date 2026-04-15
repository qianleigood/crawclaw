const fs = require('fs');
const path = require('path');
const { gotoAndSettled, delay } = require('../core/browser');
const { XhsCliError } = require('../core/errors');

const XHS_CONTENT_DATA_URL = 'https://creator.xiaohongshu.com/statistics/data-analysis';
const XHS_CONTENT_DATA_API_PATH = '/api/galaxy/creator/datacenter/note/analyze/list';

function formatPostTime(postTimeMs) {
  if (typeof postTimeMs !== 'number' || Number.isNaN(postTimeMs)) {return '-';}
  try {
    const dt = new Date(postTimeMs);
    const formatter = new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = Object.fromEntries(formatter.formatToParts(dt).map((p) => [p.type, p.value]));
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
  } catch (error) {
    return '-';
  }
}

function formatCoverClickRate(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) {return '-';}
  const normalized = value >= 0 && value <= 1 ? value * 100 : value;
  return `${normalized.toFixed(2)}%`;
}

function formatViewTimeAvg(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) {return '-';}
  return `${Math.trunc(value)}s`;
}

function metricOrDash(note, field) {
  return note && note[field] != null ? note[field] : '-';
}

function mapNoteInfosToContentRows(noteInfos) {
  return (Array.isArray(noteInfos) ? noteInfos : []).map((note) => ({
    标题: note.title || '-',
    发布时间: formatPostTime(note.post_time),
    曝光: metricOrDash(note, 'imp_count'),
    观看: metricOrDash(note, 'read_count'),
    封面点击率: formatCoverClickRate(note.coverClickRate),
    点赞: metricOrDash(note, 'like_count'),
    评论: metricOrDash(note, 'comment_count'),
    收藏: metricOrDash(note, 'fav_count'),
    涨粉: metricOrDash(note, 'increase_fans_count'),
    分享: metricOrDash(note, 'share_count'),
    人均观看时长: formatViewTimeAvg(note.view_time_avg),
    弹幕: metricOrDash(note, 'danmaku_count'),
    操作: '详情数据',
    _id: note.id || '',
  }));
}

function writeContentDataCsv(csvFile, rows) {
  const absPath = path.resolve(csvFile);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  const columns = ['标题', '发布时间', '曝光', '观看', '封面点击率', '点赞', '评论', '收藏', '涨粉', '分享', '人均观看时长', '弹幕', '操作', '_id'];
  const escapeCell = (value) => {
    const text = String(value == null ? '' : value);
    if (/[",\n]/.test(text)) {
      return '"' + text.replaceAll('"', '""') + '"';
    }
    return text;
  };
  const lines = [columns.join(',')];
  for (const row of rows || []) {
    lines.push(columns.map((column) => escapeCell(row[column])).join(','));
  }
  fs.writeFileSync(absPath, `\uFEFF${lines.join('\n')}\n`, 'utf8');
  return absPath;
}

async function fetchContentDataViaPage(page, { pageNum = 1, pageSize = 10, noteType = 0 } = {}) {
  const result = await page.evaluate(async ({ inputPageNum, inputPageSize, inputNoteType, apiPath }) => {
    const url = new URL(`https://creator.xiaohongshu.com${apiPath}`);
    url.searchParams.set('page_num', String(inputPageNum));
    url.searchParams.set('page_size', String(inputPageSize));
    url.searchParams.set('type', String(inputNoteType));
    try {
      const resp = await fetch(url.toString(), {
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
  }, { inputPageNum: pageNum, inputPageSize: pageSize, inputNoteType: noteType, apiPath: XHS_CONTENT_DATA_API_PATH });

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
  const data = payload.data && typeof payload.data === 'object' ? payload.data : {};
  const noteInfos = Array.isArray(data.note_infos) ? data.note_infos : [];
  const rows = mapNoteInfosToContentRows(noteInfos);
  return {
    request_url: result.url || `https://creator.xiaohongshu.com${XHS_CONTENT_DATA_API_PATH}`,
    requested_page_num: pageNum,
    requested_page_size: pageSize,
    requested_type: noteType,
    resolved_page_num: pageNum,
    resolved_page_size: pageSize,
    resolved_type: noteType,
    total: Number(data.total || 0) || rows.length,
    rows,
    raw_payload: payload,
    capture_mode: 'page_fetch',
  };
}

async function extractContentDataFromDom(page, { pageNum = 1, pageSize = 10, noteType = 0 } = {}) {
  const result = await page.evaluate((inputPageNum) => {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const parseTitleCell = (text) => {
      const cleaned = norm(text);
      const marker = '发布于';
      const idx = cleaned.lastIndexOf(marker);
      if (idx >= 0) {
        return {
          title: norm(cleaned.slice(0, idx)),
          publishTime: norm(cleaned.slice(idx + marker.length)),
        };
      }
      return { title: cleaned, publishTime: '' };
    };
    const table = Array.from(document.querySelectorAll('table')).find((tbl) => {
      const text = norm(tbl.innerText || '');
      return text.includes('笔记基础信息') && text.includes('封面点击率') && text.includes('人均观看时长');
    });
    if (!table) {return null;}
    const rows = [];
    for (const tr of Array.from(table.querySelectorAll('tr'))) {
      const cells = Array.from(tr.querySelectorAll('th,td')).map((td) => norm(td.innerText || td.textContent || ''));
      if (!cells.length) {continue;}
      if (cells[0] === '笔记基础信息') {continue;}
      if (cells.length < 12) {continue;}
      const first = parseTitleCell(cells[0]);
      if (!first.title) {continue;}
      rows.push({
        标题: first.title,
        发布时间: first.publishTime,
        曝光: cells[1] || '',
        观看: cells[2] || '',
        封面点击率: cells[3] || '',
        点赞: cells[4] || '',
        评论: cells[5] || '',
        收藏: cells[6] || '',
        涨粉: cells[7] || '',
        分享: cells[8] || '',
        人均观看时长: cells[9] || '',
        弹幕: cells[10] || '',
      });
    }
    const pageTexts = Array.from(document.querySelectorAll('.d-pagination-page-content'))
      .map((el) => norm(el.innerText || el.textContent || ''))
      .filter(Boolean);
    const pageNums = pageTexts.map((x) => Number(x)).filter((x) => Number.isFinite(x));
    const maxPage = pageNums.length ? Math.max(...pageNums) : inputPageNum;
    return {
      title: document.title,
      url: location.href,
      rows,
      currentPage: inputPageNum,
      maxPage,
    };
  }, pageNum);
  if (!result || typeof result !== 'object' || !Array.isArray(result.rows) || !result.rows.length) {
    return null;
  }
  const maxPageNum = Number(result.maxPage) || pageNum;
  const inferredTotal = Math.max(result.rows.length, maxPageNum * pageSize);
  return {
    request_url: result.url || XHS_CONTENT_DATA_URL,
    requested_page_num: pageNum,
    requested_page_size: pageSize,
    requested_type: noteType,
    resolved_page_num: pageNum,
    resolved_page_size: pageSize,
    resolved_type: noteType,
    total: inferredTotal,
    rows: result.rows,
    raw_payload: result,
    capture_mode: 'dom_fallback',
  };
}

async function clickPaginationPage(page, pageNum) {
  const clicked = await page.evaluate((targetPageNum) => {
    const target = String(targetPageNum);
    const normalize = (text) => (text || '').replace(/\s+/g, ' ').trim();
    const textNode = Array.from(document.querySelectorAll('.d-pagination-page-content')).find(
      (el) => normalize(el.innerText || el.textContent || '') === target
    );
    if (!textNode) {return false;}
    const clickable = textNode.closest('.d-pagination-page, .d-clickable, button, a, [role="button"]') || textNode.parentElement || textNode;
    if (!(clickable instanceof HTMLElement)) {return false;}
    clickable.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    clickable.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    clickable.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    clickable.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    if (typeof clickable.click === 'function') {clickable.click();}
    return true;
  }, pageNum);
  if (!clicked) {
    throw new XhsCliError(`Could not find pagination page ${pageNum}. Please click it manually in the browser.`, {
      code: 'PAGINATION_NOT_FOUND',
    });
  }
  await delay(1800);
}

async function getContentData(page, { pageNum = 1, pageSize = 10, noteType = 0 } = {}) {
  if (pageNum < 1) {
    throw new XhsCliError('--page-num must be >= 1.', { code: 'INVALID_PAGE_NUM' });
  }
  if (pageSize < 1) {
    throw new XhsCliError('--page-size must be >= 1.', { code: 'INVALID_PAGE_SIZE' });
  }

  await gotoAndSettled(page, XHS_CONTENT_DATA_URL, { settleMs: 1600, timeout: 30000 });
  if (pageNum > 1) {
    await clickPaginationPage(page, pageNum);
  }

  const readyDeadline = Date.now() + 12000;
  while (Date.now() < readyDeadline) {
    const directPayload = await fetchContentDataViaPage(page, { pageNum, pageSize, noteType });
    if (directPayload) {
      return directPayload;
    }
    const domPayload = await extractContentDataFromDom(page, { pageNum, pageSize, noteType });
    if (domPayload) {
      return domPayload;
    }
    await delay(1000);
  }

  throw new XhsCliError('Failed to fetch creator content data from page context or DOM fallback.', {
    code: 'CONTENT_DATA_UNAVAILABLE',
  });
}

module.exports = {
  getContentData,
  writeContentDataCsv,
};
