const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  FEISHU_FILE_SENDER_SCRIPT,
  QR_SCREENSHOT_DIR,
  XHS_CREATOR_LOGIN_CHECK_URL,
  XHS_HOME_LOGIN_MODAL_KEYWORD,
  XHS_HOME_URL,
} = require('../core/constants');
const {
  getCachedLoginStatus,
  setCachedLoginStatus,
  clearCachedLoginStatus,
} = require('../core/login-cache');
const { gotoAndSettled, delay } = require('../core/browser');
const { XhsCliError } = require('../core/errors');

async function creatorLoginPromptVisible(page) {
  return Boolean(await page.evaluate(() => {
    const normalize = (text) => (text || '').replace(/\s+/g, ' ').trim();
    const loginKeywords = ['扫码登录', '手机号登录', '验证码登录', '请登录后继续', '立即登录', '登录后继续', '登录'];
    const selectors = [
      "[class*='login']",
      "[class*='modal']",
      "[class*='popup']",
      "[class*='dialog']",
      "[class*='mask']",
      "[class*='overlay']",
      'a', 'button', 'div', 'span'
    ];
    for (const selector of selectors) {
      for (const node of document.querySelectorAll(selector)) {
        if (!(node instanceof HTMLElement)) {continue;}
        if (node.offsetParent === null) {continue;}
        const rect = node.getBoundingClientRect();
        if (rect.width < 24 || rect.height < 24) {continue;}
        const text = normalize(node.innerText || node.textContent || '');
        if (loginKeywords.some((item) => text.includes(item))) {
          return true;
        }
      }
    }
    return false;
  }));
}

async function creatorLoggedInUiPresent(page) {
  return Boolean(await page.evaluate(() => {
    const href = String(window.location.href || '');
    if (!href.includes('creator.xiaohongshu.com')) {return false;}
    if (href.toLowerCase().includes('/login')) {return false;}

    const normalize = (text) => (text || '').replace(/\s+/g, ' ').trim();
    const loginKeywords = ['扫码登录', '手机号登录', '验证码登录', '立即登录', '请登录'];
    const creatorKeywords = ['发布', '创作中心', '数据分析', '数据中心', '笔记灵感', '服务', '创作者服务'];

    const visibleNodes = Array.from(document.querySelectorAll('a, button, div, span, li, h1, h2, h3')).filter((node) => {
      if (!(node instanceof HTMLElement)) {return false;}
      if (node.offsetParent === null) {return false;}
      const rect = node.getBoundingClientRect();
      return rect.width >= 12 && rect.height >= 12;
    });

    const visibleText = visibleNodes
      .map((node) => normalize(node.innerText || node.textContent || ''))
      .filter(Boolean)
      .slice(0, 400);

    if (visibleText.some((text) => loginKeywords.some((item) => text.includes(item)))) {
      return false;
    }

    const hasCreatorKeyword = visibleText.some((text) => creatorKeywords.some((item) => text.includes(item)));
    const hasCreatorSpecificNode = !!document.querySelector(
      '.creator-tab, [class*="creator-tab"], [class*="creator-header"], [class*="sidebar"], [class*="menu"], [class*="publish"]'
    );
    return hasCreatorKeyword || hasCreatorSpecificNode;
  }));
}

async function homeLoginPromptVisible(page, keyword = XHS_HOME_LOGIN_MODAL_KEYWORD) {
  return Boolean(await page.evaluate((inputKeyword) => {
    const normalize = (text) => (text || '').replace(/\s+/g, ' ').trim();
    const containsKeyword = (text) => normalize(text).includes(inputKeyword);
    const modalSelectors = [
      "[class*='login']",
      "[class*='modal']",
      "[class*='popup']",
      "[class*='dialog']",
      "[class*='mask']",
      "[class*='overlay']",
    ];

    for (const selector of modalSelectors) {
      const nodes = document.querySelectorAll(selector);
      for (const node of nodes) {
        if (!(node instanceof HTMLElement)) {continue;}
        if (node.offsetParent === null) {continue;}
        const rect = node.getBoundingClientRect();
        if (rect.width < 24 || rect.height < 24) {continue;}
        if (containsKeyword(node.textContent) || containsKeyword(node.innerText)) {
          return true;
        }
      }
    }
    return false;
  }, keyword));
}

async function homeLoggedInUiPresent(page) {
  return Boolean(await page.evaluate(() => {
    const normalize = (text) => (text || '').replace(/\s+/g, ' ').trim();
    const loginKeywords = ['立即登录', '去登录', '扫码登录', '手机号登录', '验证码登录'];
    const hasVisibleLoginAction = Array.from(document.querySelectorAll('a, button, div, span')).some((node) => {
      if (!(node instanceof HTMLElement)) {return false;}
      if (node.offsetParent === null) {return false;}
      const rect = node.getBoundingClientRect();
      if (rect.width < 24 || rect.height < 24) {return false;}
      const label = normalize(node.innerText || node.textContent || '');
      return loginKeywords.some((item) => label.includes(item));
    });
    if (hasVisibleLoginAction) {
      return false;
    }

    const profileLinkSelectors = [
      'a[href*="/user/profile/"]',
      'a[href*="/user/profile"]',
      'a[href*="/user/"]',
    ];
    let hasVisibleProfileLink = false;
    for (const selector of profileLinkSelectors) {
      for (const node of document.querySelectorAll(selector)) {
        if (!(node instanceof HTMLElement)) {continue;}
        if (node.offsetParent === null) {continue;}
        const href = node.getAttribute('href') || '';
        if (!href || href === '/' || href.startsWith('/explore')) {continue;}
        const rect = node.getBoundingClientRect();
        if (rect.width < 12 || rect.height < 12) {continue;}
        hasVisibleProfileLink = true;
        break;
      }
      if (hasVisibleProfileLink) {break;}
    }

    const avatarSelectors = [
      '[class*="avatar"] img',
      'img[class*="avatar"]',
      '[class*="user"] img',
      'img[alt*="头像"]',
    ];
    let hasVisibleAvatar = false;
    for (const selector of avatarSelectors) {
      for (const node of document.querySelectorAll(selector)) {
        if (!(node instanceof HTMLImageElement)) {continue;}
        const rect = node.getBoundingClientRect();
        if (rect.width < 20 || rect.height < 20) {continue;}
        const style = window.getComputedStyle(node);
        if (!style || style.display === 'none' || style.visibility === 'hidden') {continue;}
        hasVisibleAvatar = true;
        break;
      }
      if (hasVisibleAvatar) {break;}
    }

    const meCandidates = Array.from(document.querySelectorAll('a, button, div, span')).filter((node) => {
      if (!(node instanceof HTMLElement)) {return false;}
      if (node.offsetParent === null) {return false;}
      const label = normalize(node.innerText || node.textContent || '');
      if (label !== '我') {return false;}
      const rect = node.getBoundingClientRect();
      return rect.width >= 12 && rect.height >= 12;
    });

    return (hasVisibleProfileLink || hasVisibleAvatar) && meCandidates.length > 0;
  }));
}

async function discoverMyProfilePayload(page) {
  return await page.evaluate(() => {
    const norm = (value) => (value || '').replace(/\s+/g, ' ').trim();
    const toAbs = (value) => {
      try {
        return new URL(value, location.href).href;
      } catch (error) {
        return value || '';
      }
    };
    const isVisible = (node) => {
      if (!(node instanceof HTMLElement)) {return false;}
      if (node.offsetParent === null) {return false;}
      const rect = node.getBoundingClientRect();
      return rect.width >= 12 && rect.height >= 12;
    };

    const meNodes = Array.from(document.querySelectorAll('a, button, div, span')).filter((node) => {
      if (!(node instanceof HTMLElement)) {return false;}
      if (!isVisible(node)) {return false;}
      return norm(node.innerText || node.textContent || '') === '我';
    });

    for (const node of meNodes) {
      const anchor = node.closest('a[href]') || node.querySelector('a[href]');
      if (anchor instanceof HTMLAnchorElement) {
        return {
          found: true,
          href: toAbs(anchor.href),
          strategy: 'exact-me-tab',
        };
      }
    }

    const profileLink = Array.from(document.querySelectorAll('a[href]')).find((node) => {
      if (!(node instanceof HTMLAnchorElement)) {return false;}
      if (!isVisible(node)) {return false;}
      const href = node.getAttribute('href') || '';
      return href.includes('/user/profile/');
    });

    if (profileLink instanceof HTMLAnchorElement) {
      return {
        found: true,
        href: toAbs(profileLink.href),
        strategy: 'profile-link',
      };
    }

    return {
      found: false,
      href: '',
      strategy: '',
    };
  });
}

async function checkCreatorLogin(context) {
  const { page, host, port, accountName, ttlHours = 12 } = context;
  const scope = 'creator';
  const cached = getCachedLoginStatus({ host, port, accountName, scope, ttlHours });
  if (cached) {
    return { loggedIn: true, scope, source: 'cache' };
  }

  await gotoAndSettled(page, XHS_CREATOR_LOGIN_CHECK_URL, { settleMs: 2000 });
  const currentUrl = page.url();
  if (String(currentUrl).toLowerCase().includes('login')) {
    clearCachedLoginStatus({ host, port, accountName, scope });
    return { loggedIn: false, scope, source: 'url', currentUrl };
  }

  const loggedIn = (await creatorLoggedInUiPresent(page)) && !(await creatorLoginPromptVisible(page));
  if (loggedIn) {
    setCachedLoginStatus({ host, port, accountName, scope, loggedIn: true });
    return { loggedIn: true, scope, source: 'ui', currentUrl };
  }

  clearCachedLoginStatus({ host, port, accountName, scope });
  return { loggedIn: false, scope, source: 'ui', currentUrl };
}

async function checkHomeLogin(context) {
  const { page, host, port, accountName, ttlHours = 12 } = context;
  const scope = 'home';
  const cached = getCachedLoginStatus({ host, port, accountName, scope, ttlHours });
  if (cached) {
    return { loggedIn: true, scope, source: 'cache' };
  }

  await gotoAndSettled(page, XHS_HOME_URL, { settleMs: 2000 });
  const currentUrl = page.url();
  if (String(currentUrl).toLowerCase().includes('login')) {
    clearCachedLoginStatus({ host, port, accountName, scope });
    return { loggedIn: false, scope, source: 'url', currentUrl };
  }

  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const payload = await discoverMyProfilePayload(page);
    const href = String(payload && payload.href ? payload.href : '').trim();
    const strategy = String(payload && payload.strategy ? payload.strategy : '').trim();
    if ((payload && payload.found && href) || strategy === 'exact-me-tab') {
      setCachedLoginStatus({ host, port, accountName, scope, loggedIn: true });
      return { loggedIn: true, scope, source: strategy || 'profile-discovery', currentUrl: page.url(), profile: payload };
    }
    if (await homeLoggedInUiPresent(page)) {
      setCachedLoginStatus({ host, port, accountName, scope, loggedIn: true });
      return { loggedIn: true, scope, source: 'ui', currentUrl: page.url() };
    }
    if (await homeLoginPromptVisible(page, XHS_HOME_LOGIN_MODAL_KEYWORD)) {
      clearCachedLoginStatus({ host, port, accountName, scope });
      return { loggedIn: false, scope, source: 'prompt', currentUrl: page.url() };
    }
    await delay(700);
  }

  if (await homeLoggedInUiPresent(page)) {
    setCachedLoginStatus({ host, port, accountName, scope, loggedIn: true });
    return { loggedIn: true, scope, source: 'fallback-ui', currentUrl: page.url() };
  }

  clearCachedLoginStatus({ host, port, accountName, scope });
  return { loggedIn: false, scope, source: 'timeout', currentUrl: page.url() };
}

async function waitForPageReady(page, timeoutSeconds = 15) {
  const timeoutMs = Math.max(1000, Math.floor(Number(timeoutSeconds || 15) * 1000));
  try {
    await page.waitForFunction(() => document.readyState === 'complete', { timeout: timeoutMs });
    return true;
  } catch (error) {
    return false;
  }
}

async function clearCookies(context) {
  const { page, host, port, accountName } = context;
  const client = await page.target().createCDPSession();
  try {
    await client.send('Network.enable');
    await client.send('Network.clearBrowserCookies');
    await client.send('Storage.clearDataForOrigin', {
      origin: 'https://www.xiaohongshu.com',
      storageTypes: 'cookies,local_storage,session_storage',
    });
    await client.send('Storage.clearDataForOrigin', {
      origin: 'https://creator.xiaohongshu.com',
      storageTypes: 'cookies,local_storage,session_storage',
    });
  } finally {
    await client.detach().catch(() => {});
  }
  clearCachedLoginStatus({ host, port, accountName, scope: 'creator' });
  clearCachedLoginStatus({ host, port, accountName, scope: 'home' });
}

async function expandHomeLoginPanel(page) {
  const result = await page.evaluate(() => {
    const isVisible = (el) => {
      if (!(el instanceof Element)) {return false;}
      const style = window.getComputedStyle(el);
      if (!style || style.display === 'none' || style.visibility === 'hidden') {return false;}
      const rect = el.getBoundingClientRect();
      return rect.width >= 24 && rect.height >= 24;
    };
    const labels = ['登录', '立即登录', '马上登录', '扫码登录', '手机号登录'];
    const candidates = Array.from(document.querySelectorAll('a, button, div, span'));
    for (const el of candidates) {
      if (!isVisible(el)) {continue;}
      const text = `${el.innerText || el.textContent || ''}`.replace(/\s+/g, ' ').trim();
      if (!text) {continue;}
      if (!labels.some((label) => text.includes(label))) {continue;}
      const rect = el.getBoundingClientRect();
      return {
        clicked: true,
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };
    }
    return { clicked: false };
  });
  if (result && result.clicked) {
    await page.mouse.click(Number(result.x), Number(result.y));
    return true;
  }
  return false;
}

async function expandLoginQrPanel(page) {
  const result = await page.evaluate(() => {
    const isVisible = (el) => {
      if (!(el instanceof Element)) {return false;}
      const style = window.getComputedStyle(el);
      if (!style || style.display === 'none' || style.visibility === 'hidden') {return false;}
      const rect = el.getBoundingClientRect();
      return rect.width >= 24 && rect.height >= 24;
    };
    const getNodeRect = (el) => {
      if (!isVisible(el)) {return null;}
      if (el.scrollIntoView) {
        el.scrollIntoView({ block: 'center', inline: 'center' });
      }
      const rect = el.getBoundingClientRect();
      return {
        clicked: true,
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };
    };

    const exactSelectors = ['#page > div > div.content > div.con > div.login-box-container > div > div > div > div > img'];
    for (const exactSelector of exactSelectors) {
      try {
        const cssNode = document.querySelector(exactSelector);
        const target = cssNode ? getNodeRect(cssNode) : null;
        if (target) {return target;}
      } catch (error) {}
    }

    const exactXPaths = [
      '/html/body/div[1]/div/div/div/div[2]/div[1]/div[2]/div/div/div/div/img',
      '//*[@id="page"]/div/div[2]/div[1]/div[2]/div/div/div/div/img',
    ];
    for (const exactXPath of exactXPaths) {
      try {
        const xpathResult = document.evaluate(exactXPath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        const xpathNode = xpathResult.singleNodeValue;
        const target = xpathNode ? getNodeRect(xpathNode) : null;
        if (target) {return target;}
      } catch (error) {}
    }

    const exactPrefix = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHL';
    const imgs = Array.from(document.querySelectorAll('img'));
    for (const img of imgs) {
      const src = img.getAttribute('src') || '';
      if (src.startsWith(exactPrefix)) {
        const target = getNodeRect(img);
        if (target) {return target;}
      }
    }

    const keywords = ['扫码', '二维码', 'QR', '登录'];
    const candidates = Array.from(document.querySelectorAll('img, button, [role="button"], div, span'));
    for (const el of candidates) {
      if (!isVisible(el)) {continue;}
      const text = `${el.textContent || ''}`.trim();
      const cls = `${el.className || ''}`.toLowerCase();
      const src = `${el.getAttribute && el.getAttribute('src') || ''}`.toLowerCase();
      const hit = keywords.some((k) => text.includes(k) || cls.includes(k.toLowerCase()) || src.includes(k.toLowerCase()));
      if (hit) {
        const target = getNodeRect(el);
        if (target) {return target;}
      }
    }
    return { clicked: false };
  });
  if (result && result.clicked) {
    await page.mouse.click(Number(result.x), Number(result.y));
    await waitForPageReady(page, 12);
    await delay(2500);
    return true;
  }
  return false;
}

async function captureScreenshot(page, outputPath, { fullPage = true } = {}) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  await waitForPageReady(page, 12);
  await page.screenshot({ path: outputPath, fullPage });
  return outputPath;
}

async function captureLoginQrScreenshot(page, outputPath) {
  await waitForPageReady(page, 15);
  const expanded = await expandLoginQrPanel(page);
  if (!expanded) {
    await delay(2000);
  } else {
    await delay(1500);
  }
  return await captureScreenshot(page, outputPath, { fullPage: true });
}

async function captureHomeLoginScreenshot(page, outputPath) {
  await waitForPageReady(page, 15);
  await delay(1500);
  return await captureScreenshot(page, outputPath, { fullPage: false });
}

function sendLoginQrToFeishu(outputPath, receiveId, receiveIdType) {
  if (!fs.existsSync(FEISHU_FILE_SENDER_SCRIPT)) {
    throw new XhsCliError(`Feishu helper script not found: ${FEISHU_FILE_SENDER_SCRIPT}`, { code: 'FEISHU_HELPER_NOT_FOUND' });
  }
  const cmd = [
    'python3',
    FEISHU_FILE_SENDER_SCRIPT,
    '--file',
    path.resolve(outputPath),
    '--receive-id',
    receiveId,
    '--message-type',
    'image',
  ];
  if (receiveIdType) {
    cmd.push('--receive-id-type', receiveIdType);
  }
  const result = spawnSync(cmd[0], cmd.slice(1), {
    cwd: path.dirname(FEISHU_FILE_SENDER_SCRIPT),
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new XhsCliError(`Failed to send QR screenshot to Feishu.\nstdout:\n${result.stdout || ''}\nstderr:\n${result.stderr || ''}`, {
      code: 'FEISHU_QR_SEND_FAILED',
    });
  }
  return { stdout: (result.stdout || '').trim() };
}

async function waitForLoginSuccess(context, { timeoutSeconds = 180, pollSeconds = 2, scope = 'creator' } = {}) {
  const { page, host, port, accountName } = context;
  const deadline = Date.now() + Math.max(5000, Math.floor(Number(timeoutSeconds || 180) * 1000));
  const pollMs = Math.max(500, Math.floor(Number(pollSeconds || 2) * 1000));

  while (Date.now() < deadline) {
    if (scope === 'home') {
      const payload = await discoverMyProfilePayload(page);
      const href = String(payload && payload.href ? payload.href : '').trim();
      const strategy = String(payload && payload.strategy ? payload.strategy : '').trim();
      if ((payload && payload.found && href) || strategy === 'exact-me-tab') {
        setCachedLoginStatus({ host, port, accountName, scope: 'home', loggedIn: true });
        return true;
      }
      if (await homeLoggedInUiPresent(page)) {
        setCachedLoginStatus({ host, port, accountName, scope: 'home', loggedIn: true });
        return true;
      }
    } else {
      const currentUrl = String(page.url() || '');
      if (!currentUrl.toLowerCase().includes('/login')) {
        const loggedIn = (await creatorLoggedInUiPresent(page)) && !(await creatorLoginPromptVisible(page));
        if (loggedIn) {
          setCachedLoginStatus({ host, port, accountName, scope: 'creator', loggedIn: true });
          return true;
        }
      }
    }
    await delay(pollMs);
  }
  return false;
}

async function openLoginPage(context) {
  const { page, host, port, accountName } = context;
  await gotoAndSettled(page, XHS_CREATOR_LOGIN_CHECK_URL, { settleMs: 1800 });
  const currentUrl = String(page.url() || '');
  if (!currentUrl.toLowerCase().includes('/login')) {
    await gotoAndSettled(page, 'https://creator.xiaohongshu.com/login', { settleMs: 1800 });
  }
  await waitForPageReady(page, 15);
  clearCachedLoginStatus({ host, port, accountName, scope: 'creator' });
  clearCachedLoginStatus({ host, port, accountName, scope: 'home' });
  return { status: 'LOGIN_READY', currentUrl: page.url() };
}

async function openHomeLoginPage(context) {
  const { page, host, port, accountName } = context;
  await gotoAndSettled(page, XHS_HOME_URL, { settleMs: 1500 });
  await waitForPageReady(page, 15);
  await delay(1500);
  if (!(await homeLoginPromptVisible(page, XHS_HOME_LOGIN_MODAL_KEYWORD))) {
    await expandHomeLoginPanel(page);
    await delay(1500);
    await waitForPageReady(page, 12);
  }
  clearCachedLoginStatus({ host, port, accountName, scope: 'creator' });
  clearCachedLoginStatus({ host, port, accountName, scope: 'home' });
  return { status: 'HOME_LOGIN_READY', currentUrl: page.url() };
}

function buildLoginQrPath({ accountName, commandName, scope }) {
  fs.mkdirSync(QR_SCREENSHOT_DIR, { recursive: true });
  return path.join(QR_SCREENSHOT_DIR, `${accountName}-${commandName}-${scope}-qr.png`);
}

module.exports = {
  checkCreatorLogin,
  checkHomeLogin,
  discoverMyProfilePayload,
  waitForPageReady,
  clearCookies,
  openLoginPage,
  openHomeLoginPage,
  captureLoginQrScreenshot,
  captureHomeLoginScreenshot,
  sendLoginQrToFeishu,
  waitForLoginSuccess,
  buildLoginQrPath,
};
