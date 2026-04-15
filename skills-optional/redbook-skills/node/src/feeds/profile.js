const { XHS_HOME_URL } = require('../core/constants');
const { gotoAndSettled, delay } = require('../core/browser');
const { XhsCliError } = require('../core/errors');
const { discoverMyProfilePayload } = require('../auth/login');
const { makeFeedDetailUrl } = require('./search');

async function humanScrollPage(page, remaining, pauseSeconds = 1.2) {
  const target = Math.max(320, Number(remaining) || 0);
  await page.evaluate(async ({ totalDistance, pauseMs }) => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    let scrolled = 0;
    while (scrolled < totalDistance) {
      const step = Math.min(totalDistance - scrolled, 280 + Math.floor(Math.random() * 340));
      window.scrollBy({ top: step, left: 0, behavior: 'smooth' });
      scrolled += step;
      await sleep(120 + Math.floor(Math.random() * 180));
    }
    await sleep(pauseMs);
  }, { totalDistance: target, pauseMs: Math.max(200, Math.floor(Number(pauseSeconds || 1.2) * 1000)) });
}

async function getMyProfileFeeds(page, {
  profileUrl = '',
  entryUrl = XHS_HOME_URL,
  maxScrollRounds = 12,
  scrollPauseSeconds = 1.2,
  stableRoundsToStop = 2,
} = {}) {
  let discovery = null;
  let targetProfileUrl = String(profileUrl || '').trim();
  if (!targetProfileUrl) {
    await gotoAndSettled(page, entryUrl, { settleMs: 1500 });
    discovery = await discoverMyProfilePayload(page);
    targetProfileUrl = String(discovery && discovery.href ? discovery.href : '').trim();
  }
  if (!targetProfileUrl) {
    throw new XhsCliError('profile_url cannot be empty.', { code: 'EMPTY_PROFILE_URL' });
  }

  await gotoAndSettled(page, targetProfileUrl, { timeout: 30000, settleMs: 1800 });

  const profilePageIssue = await page.evaluate(() => {
    const text = String((document.body && (document.body.innerText || document.body.textContent)) || '')
      .replace(/\s+/g, ' ')
      .trim();
    const keywords = ['请求太频繁，请稍后再试', '请求太频繁', '问题反馈', '验证', 'captcha'];
    for (const kw of keywords) {
      if (text.includes(kw)) {
        return kw;
      }
    }
    return '';
  });
  if (['请求太频繁，请稍后再试', '请求太频繁', '验证', 'captcha'].includes(String(profilePageIssue || '').trim())) {
    throw new XhsCliError(`Current account profile page is rate-limited or blocked: ${String(profilePageIssue).trim()}`, {
      code: 'PROFILE_RATE_LIMITED',
    });
  }

  const collected = new Map();
  let stableRounds = 0;
  const rounds = Math.max(1, Number(maxScrollRounds) || 1);
  const stableLimit = Math.max(1, Number(stableRoundsToStop) || 1);
  const pauseSeconds = Math.max(0.2, Number(scrollPauseSeconds) || 1.2);

  for (let roundIndex = 0; roundIndex < rounds; roundIndex += 1) {
    const rawCards = await page.evaluate(() => {
      const norm = (value) => (value || '').replace(/\s+/g, ' ').trim();
      const cards = Array.from(document.querySelectorAll('section.note-item'));
      return cards.map((section, index) => {
        const profileLink = Array.from(section.querySelectorAll('a[href*="/user/profile/"]'))
          .find((a) => (a.href || '').includes('xsec_token=')) || null;
        const exploreLink = Array.from(section.querySelectorAll('a[href*="/explore/"]'))[0] || null;
        const titleEl = section.querySelector('a.title, .title');
        const authorEl = section.querySelector('.author .name, .author-wrapper .name, .name');
        const imgEl = section.querySelector('img');
        const topTagEl = section.querySelector('.top-wrapper, .top-tag-area, .top-tag');
        return {
          index,
          title: norm(titleEl ? (titleEl.innerText || titleEl.textContent || '') : ''),
          author_name: norm(authorEl ? (authorEl.innerText || authorEl.textContent || '') : ''),
          profile_note_url: profileLink ? profileLink.href : '',
          explore_url: exploreLink ? exploreLink.href : '',
          cover_url: imgEl ? (imgEl.currentSrc || imgEl.src || '') : '',
          top_tag: norm(topTagEl ? (topTagEl.innerText || topTagEl.textContent || '') : ''),
        };
      }).filter((item) => item.profile_note_url || item.explore_url || item.title);
    });

    const beforeCount = collected.size;
    if (Array.isArray(rawCards)) {
      for (const card of rawCards) {
        if (!card || typeof card !== 'object') {continue;}
        const profileNoteUrl = String(card.profile_note_url || '').trim();
        const exploreUrl = String(card.explore_url || '').trim();
        const sourceUrl = profileNoteUrl || exploreUrl;
        if (!sourceUrl) {continue;}
        let parsed;
        try {
          parsed = new URL(sourceUrl);
        } catch (error) {
          continue;
        }
        const parts = parsed.pathname.split('/').filter(Boolean);
        let feedId = '';
        if (parsed.pathname.includes('/explore/') && parts.length) {
          feedId = parts[parts.length - 1];
        } else if (parts.length >= 4 && parts[parts.length - 2] === 'profile') {
          feedId = parts[parts.length - 1];
        } else if (parts.length >= 1) {
          feedId = parts[parts.length - 1];
        }
        if (!feedId) {continue;}
        const xsecToken = profileNoteUrl ? (parsed.searchParams.get('xsec_token') || '').trim() : '';
        const detailUrl = xsecToken ? makeFeedDetailUrl(feedId, xsecToken) : '';
        collected.set(feedId, {
          feed_id: feedId,
          title: String(card.title || '').trim(),
          author_name: String(card.author_name || '').trim(),
          cover_url: String(card.cover_url || '').trim(),
          top_tag: String(card.top_tag || '').trim(),
          profile_note_url: profileNoteUrl,
          explore_url: exploreUrl,
          xsec_token: xsecToken,
          detail_url: detailUrl,
        });
      }
    }

    if (collected.size === beforeCount) {
      stableRounds += 1;
    } else {
      stableRounds = 0;
    }

    if (stableRounds >= stableLimit || roundIndex >= rounds - 1) {
      break;
    }

    const scrollMetrics = await page.evaluate(() => ({
      scrollY: window.scrollY,
      innerHeight: window.innerHeight,
      bodyHeight: document.body.scrollHeight,
    }));
    const currentBottom = Number(scrollMetrics.scrollY || 0) + Number(scrollMetrics.innerHeight || 0);
    const bodyHeight = Number(scrollMetrics.bodyHeight || 0);
    const remaining = Math.max(320, bodyHeight - currentBottom);
    await humanScrollPage(page, remaining, pauseSeconds);
  }

  const feeds = Array.from(collected.values()).toSorted((a, b) => {
    const aTop = a.top_tag ? 0 : 1;
    const bTop = b.top_tag ? 0 : 1;
    if (aTop !== bTop) {return aTop - bTop;}
    return String(a.title || '').localeCompare(String(b.title || ''), 'zh-CN');
  });
  let profileUserId = '';
  try {
    const parsedProfile = new URL(targetProfileUrl);
    const profileParts = parsedProfile.pathname.split('/').filter(Boolean);
    profileUserId = profileParts.length ? profileParts[profileParts.length - 1] : '';
  } catch (error) {
    // ignore
  }

  return {
    profile_url: targetProfileUrl,
    profile_user_id: profileUserId,
    discovery: discovery || {},
    count: feeds.length,
    feeds,
  };
}

module.exports = {
  getMyProfileFeeds,
};
