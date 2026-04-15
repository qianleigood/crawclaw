#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <absolute-file-path-or-csv> [xpath] [cdp-url] [app-name] [timeout-seconds]" >&2
  echo "Example (single): $0 /tmp/a.png" >&2
  echo "Example (multi):  $0 /tmp/a.png,/tmp/b.png" >&2
  exit 64
fi

FILE_PATHS_CSV="$1"
XPATH="${2:-/html/body/div[8]/div/div/mat-card/mat-action-list/images-files-uploader/button/span/span/div/span/div}"
CDP_URL="${3:-http://127.0.0.1:9233}"
APP_NAME="${4:-Google Chrome}"
TIMEOUT_SECONDS="${5:-15}"

IFS=',' read -r -a FILE_PATHS <<< "$FILE_PATHS_CSV"
if [[ ${#FILE_PATHS[@]} -eq 0 ]]; then
  echo "No file paths provided" >&2
  exit 64
fi

for FILE_PATH in "${FILE_PATHS[@]}"; do
  if [[ ! "$FILE_PATH" = /* ]]; then
    echo "File path must be absolute: $FILE_PATH" >&2
    exit 64
  fi
  if [[ ! -f "$FILE_PATH" ]]; then
    echo "File does not exist: $FILE_PATH" >&2
    exit 66
  fi
done

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AX_HELPER="$SCRIPT_DIR/chrome_ax_helper.swift"
OPEN_PANEL_HELPER="$SCRIPT_DIR/select_file_in_open_panel.sh"
PLAYWRIGHT_CORE='/Users/qianleilei/Library/pnpm/global/5/.pnpm/crawclaw@2026.3.24_@napi-rs+canvas@0.1.97/node_modules/playwright-core'
TMPDIR_RUN="$(mktemp -d /tmp/gemini-upload-XXXXXX)"
trap 'rm -rf "$TMPDIR_RUN"' EXIT

WAIT_LOG="$TMPDIR_RUN/wait.log"
CLICK_JSON="$TMPDIR_RUN/click.json"
VERIFY_JSON="$TMPDIR_RUN/verify.json"
FILECHOOSER_JSON="$TMPDIR_RUN/filechooser.json"

# Fast path: intercept the browser-side file chooser and set files directly.
# This avoids relying on Gemini to successfully promote the menu click into a macOS open panel.
if node - "$CDP_URL" "$FILE_PATHS_CSV" "$XPATH" "$FILECHOOSER_JSON" "$PLAYWRIGHT_CORE" <<'NODE'
const fs = require('fs');
const path = require('path');
const cdpUrl = process.argv[2];
const filePaths = process.argv[3].split(',').filter(Boolean);
const xpath = process.argv[4];
const outPath = process.argv[5];
const playwrightCore = process.argv[6];
const { chromium } = require(playwrightCore);

(async () => {
  const browser = await chromium.connectOverCDP(cdpUrl);
  const context = browser.contexts()[0] || await browser.newContext();
  const pages = context.pages();
  const page = pages.find(p => /gemini\.google\.com\/app/.test(p.url())) || pages[0] || await context.newPage();
  page.setDefaultTimeout(30000);
  await page.bringToFront();
  await page.goto('https://gemini.google.com/app', { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(1800);
  await page.keyboard.press('Escape').catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});

  async function pageState(label) {
    return await page.evaluate((label) => ({
      label,
      href: location.href,
      title: document.title,
      bodyLen: (document.body?.innerText || '').length,
      body: (document.body?.innerText || '').slice(0, 2500),
      buttons: Array.from(document.querySelectorAll('button,a,[role=button]')).slice(0, 120).map((el, i) => ({
        i,
        text: (el.innerText || el.textContent || '').trim().slice(0, 80),
        aria: el.getAttribute('aria-label') || '',
        testid: el.getAttribute('data-test-id') || ''
      })).filter(x => x.text || x.aria || x.testid)
    }), label);
  }

  async function ensureHealthyPage() {
    let state = await pageState('initial');
    for (let i = 0; i < 4; i++) {
      if (state.bodyLen >= 20) return state;
      await page.waitForTimeout(1200);
      state = await pageState(`initial-wait-${i + 1}`);
    }
    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(2500);
    return await pageState('reloaded');
  }

  async function clickFirstVisible(locators) {
    for (const locator of locators) {
      try {
        if (await locator.count()) {
          await locator.first().click({ force: true }).catch(() => {});
          return true;
        }
      } catch {}
    }
    return false;
  }

  async function preparePreferredUploadPath() {
    await page.keyboard.press('Escape').catch(() => {});
    await page.keyboard.press('Escape').catch(() => {});

    await clickFirstVisible([
      page.locator('[aria-label="发起新对话"]'),
      page.getByRole('button', { name: /发起新对话/ }),
      page.getByRole('link', { name: /发起新对话/ })
    ]);
    await page.waitForTimeout(1200);

    await clickFirstVisible([
      page.getByRole('button', { name: /制作图片/ }),
      page.locator('button[aria-label*="制作图片"]')
    ]);
    await page.waitForTimeout(800);

    const closeBtn = page.locator('button[aria-label="关闭文件上传菜单"]').first();
    if (await closeBtn.count()) return;

    await clickFirstVisible([
      page.locator('button[aria-label="打开文件上传菜单"]')
    ]);
    await page.waitForTimeout(800);
  }

  function basename(p) {
    return path.basename(p);
  }

  function basenames(paths) {
    return paths.map(p => basename(p));
  }

  const healthBefore = await ensureHealthyPage();

  const selectorCandidates = [
    { name: 'preferred-upload-button', locator: page.locator('button[data-test-id="local-images-files-uploader-button"]') },
    { name: 'preferred-upload-button-xpath', locator: page.locator("xpath=//button[@data-test-id='local-images-files-uploader-button']") },
    { name: 'aria-css', locator: page.locator('button[aria-label^="上传文件"]') },
    { name: 'text-xpath', locator: page.locator("xpath=//button[.//div[contains(normalize-space(.), '上传文件')] or .//span[contains(normalize-space(.), '上传文件')]]") },
    { name: 'user-xpath', locator: page.locator(`xpath=${xpath}`) },
    { name: 'hidden-image', locator: page.locator('button[data-test-id="hidden-local-image-upload-button"]') },
    { name: 'hidden-file', locator: page.locator('button[data-test-id="hidden-local-file-upload-button"]') },
    { name: 'hidden-selector-button', locator: page.locator('button.hidden-local-file-image-selector-button') },
  ];

  async function waitForCandidateVisibility() {
    const rounds = [];
    for (let round = 1; round <= 6; round++) {
      await preparePreferredUploadPath();
      await page.waitForTimeout(700);
      const snapshot = [];
      for (const item of selectorCandidates) {
        const count = await item.locator.count().catch(() => 0);
        snapshot.push({ name: item.name, count });
      }
      rounds.push({ round, snapshot });
      if (snapshot.some(x => x.count > 0)) return rounds;
      if (round === 3) {
        await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
        await page.waitForTimeout(2000);
      }
    }
    return rounds;
  }

  const selectorRounds = await waitForCandidateVisibility();
  const healthAfterMenu = await pageState('after-open-menu');

  const attempts = [];
  for (const item of selectorCandidates) {
    const count = await item.locator.count().catch(() => 0);
    if (!count) {
      attempts.push({ name: item.name, count: 0, chooser: false, reason: 'not-found' });
      continue;
    }

    try {
      const [chooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 2500 }),
        item.locator.first().click({ force: true, timeout: 2500 })
      ]);

      const chooserElement = await chooser.element();
      const chooserInfo = await chooserElement.evaluate(el => ({
        tag: el.tagName,
        type: el.type || '',
        outer: el.outerHTML.slice(0, 300)
      }));

      await chooser.setFiles(filePaths);

      let verify = null;
      for (let attempt = 1; attempt <= 20; attempt++) {
        await page.waitForTimeout(1000);
        verify = await page.evaluate((baseNames) => {
          const body = document.body?.innerText || '';
          const send = document.querySelector('button[aria-label="发送"]');
          const escapedNames = baseNames.map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
          const namePattern = escapedNames.length ? escapedNames.join('|') : '___NO_NAME___';
          const interesting = Array.from(document.querySelectorAll('*')).map((el, i) => ({
            i,
            tag: el.tagName,
            text: (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 160),
            aria: el.getAttribute('aria-label') || '',
            testid: el.getAttribute('data-test-id') || '',
            cls: el.getAttribute('class') || ''
          })).filter(x => new RegExp(namePattern + '|移除文件|uploaded-img|image-preview|你已上传过名为|发送', 'i').test(`${x.text} ${x.aria} ${x.testid} ${x.cls}`)).slice(0, 160);

          const previews = Array.from(document.querySelectorAll('img')).map((img, i) => ({
            i,
            alt: img.alt || '',
            src: (img.src || '').slice(0, 200),
            testid: img.getAttribute('data-test-id') || '',
            cls: img.getAttribute('class') || '',
            w: img.naturalWidth,
            h: img.naturalHeight,
          })).filter(x => /uploaded-img|image-preview|blob:/i.test(`${x.alt} ${x.src} ${x.testid} ${x.cls}`));

          const previewCount = document.querySelectorAll('[data-test-id="image-preview"], .image-preview').length;
          const removeCount = document.querySelectorAll('button[aria-label*="移除文件"]').length;
          const sendAriaDisabled = send?.getAttribute('aria-disabled') || null;
          const sendDisabled = send ? !!send.disabled : null;
          const attached = previewCount >= 1 && removeCount >= baseNames.length && sendAriaDisabled === 'false';

          return {
            body: body.slice(0, 4000),
            attached,
            previewCount,
            removeCount,
            sendAriaDisabled,
            sendDisabled,
            interesting,
            previews,
          };
        }, basenames(filePaths));
        if (verify?.attached) break;
      }

      const payload = {
        mode: 'filechooser',
        selectedSelector: item.name,
        chooserInfo,
        healthBefore,
        healthAfterMenu,
        selectorRounds,
        verify,
      };
      fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
      console.log(JSON.stringify(payload, null, 2));
      await browser.close();
      if (verify.attached) process.exit(0);
      attempts.push({ name: item.name, count, chooser: true, attached: false });
    } catch (error) {
      attempts.push({ name: item.name, count, chooser: false, reason: error.message });
    }
  }

  const payload = {
    mode: 'filechooser',
    success: false,
    healthBefore,
    healthAfterMenu,
    selectorRounds,
    attempts,
  };
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.error(JSON.stringify(payload, null, 2));
  await browser.close();
  process.exit(1);
})().catch(async (error) => {
  console.error(String(error && error.stack || error));
  process.exit(1);
});
NODE
then
  cat "$FILECHOOSER_JSON"
  exit 0
fi

# Fallback path: keep the older open-panel / AX route for cases where the chooser event is not catchable.
"$AX_HELPER" wait-open-panel --app "$APP_NAME" --timeout "$TIMEOUT_SECONDS" > "$WAIT_LOG" 2>&1 &
WAIT_PID=$!

node - "$CDP_URL" "$XPATH" "$CLICK_JSON" "$PLAYWRIGHT_CORE" <<'NODE'
const fs = require('fs');
const cdpUrl = process.argv[2];
const xpath = process.argv[3];
const outPath = process.argv[4];
const playwrightCore = process.argv[5];
const { chromium } = require(playwrightCore);
(async () => {
  const browser = await chromium.connectOverCDP(cdpUrl);
  const context = browser.contexts()[0] || await browser.newContext();
  const pages = context.pages();
  const page = pages.find(p => /gemini\.google\.com\/app/.test(p.url())) || pages[0] || await context.newPage();
  page.setDefaultTimeout(30000);
  await page.bringToFront();
  await page.goto('https://gemini.google.com/app', { waitUntil: 'domcontentloaded' }).catch(()=>{});
  await page.waitForTimeout(2500);
  await page.keyboard.press('Escape').catch(()=>{});
  await page.keyboard.press('Escape').catch(()=>{});
  async function pageState(label) {
    return await page.evaluate((label) => ({
      label,
      href: location.href,
      title: document.title,
      bodyLen: (document.body?.innerText || '').length,
      body: (document.body?.innerText || '').slice(0, 2500),
      buttons: Array.from(document.querySelectorAll('button,a,[role=button]')).slice(0, 120).map((el, i) => ({ i, text: (el.innerText || el.textContent || '').trim().slice(0, 80), aria: el.getAttribute('aria-label') || '', testid: el.getAttribute('data-test-id') || '' })).filter(x => x.text || x.aria || x.testid)
    }), label);
  }

  async function ensureHealthyPage() {
    let state = await pageState('initial');
    if (state.bodyLen < 20) {
      await page.reload({ waitUntil: 'domcontentloaded' }).catch(()=>{});
      await page.waitForTimeout(2500);
      state = await pageState('reloaded');
    }
    return state;
  }

  async function openUploadMenu() {
    await page.keyboard.press('Escape').catch(()=>{});
    await page.keyboard.press('Escape').catch(()=>{});
    const imageBtn = page.getByRole('button', { name: /制作图片/ }).first();
    if (await imageBtn.count()) {
      await imageBtn.click({ force: true }).catch(()=>{});
      await page.waitForTimeout(800);
    }
    const uploadMenuBtn = page.locator('button[aria-label="打开文件上传菜单"]').first();
    const closeBtn = page.locator('button[aria-label="关闭文件上传菜单"]').first();
    if (!(await closeBtn.count()) && await uploadMenuBtn.count()) {
      await uploadMenuBtn.click({ force: true }).catch(()=>{});
      await page.waitForTimeout(800);
    }
  }

  const healthBefore = await ensureHealthyPage();
  await openUploadMenu();
  let healthAfterMenu = await pageState('after-open-menu');
  if (healthAfterMenu.bodyLen < 20) {
    await page.reload({ waitUntil: 'domcontentloaded' }).catch(()=>{});
    await page.waitForTimeout(2500);
    await openUploadMenu();
    healthAfterMenu = await pageState('after-reload-open-menu');
  }

  const selectorCandidates = [
    { name: 'testid-css', locator: page.locator('button[data-test-id="local-images-files-uploader-button"]') },
    { name: 'testid-xpath', locator: page.locator("xpath=//button[@data-test-id='local-images-files-uploader-button']") },
    { name: 'aria-css', locator: page.locator('button[aria-label^="上传文件"]') },
    { name: 'text-xpath', locator: page.locator("xpath=//button[.//div[contains(normalize-space(.), '上传文件')] or .//span[contains(normalize-space(.), '上传文件')]]") },
    { name: 'user-xpath', locator: page.locator(`xpath=${xpath}`) },
  ];

  const candidateResults = [];
  let chosen = null;
  for (const item of selectorCandidates) {
    const count = await item.locator.count().catch(() => 0);
    let box = null;
    if (count) box = await item.locator.first().boundingBox().catch(() => null);
    candidateResults.push({ name: item.name, count, box });
    if (!chosen && count) chosen = { name: item.name, locator: item.locator, count, box };
  }

  const metrics = await page.evaluate(() => ({
    screenX: window.screenX,
    screenY: window.screenY,
    chromeTop: window.outerHeight - window.innerHeight,
    url: location.href,
    title: document.title,
    activeTag: document.activeElement?.tagName || '',
    activeAria: document.activeElement?.getAttribute('aria-label') || '',
    activeText: (document.activeElement?.innerText || document.activeElement?.textContent || '').trim().slice(0,100),
    body: document.body ? document.body.innerText.slice(0,2500) : '',
    visibleButtons: Array.from(document.querySelectorAll('button,a,[role=button]')).slice(0, 120).map((el, i) => ({ i, text: (el.innerText || el.textContent || '').trim().slice(0, 80), aria: el.getAttribute('aria-label') || '', testid: el.getAttribute('data-test-id') || '' })).filter(x => x.text || x.aria || x.testid)
  }));
  const payload = {
    xpath,
    healthBefore,
    healthAfterMenu,
    selectorCandidates: candidateResults,
    chosenSelector: chosen ? chosen.name : null,
    count: chosen ? chosen.count : 0,
    box: chosen ? chosen.box : null,
    ...metrics,
    absolutePoint: chosen && chosen.box ? {
      x: metrics.screenX + chosen.box.x + chosen.box.width / 2,
      y: metrics.screenY + metrics.chromeTop + chosen.box.y + chosen.box.height / 2,
    } : null,
  };
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log(JSON.stringify(payload, null, 2));
  await browser.close();
})();
NODE

if [[ -s "$CLICK_JSON" ]]; then
  swift - <<'SWIFT' "$CLICK_JSON"
import Foundation
import CoreGraphics
let path = CommandLine.arguments[1]
let raw = try! String(contentsOfFile: path, encoding: .utf8)
let data = raw.data(using: .utf8)!
let obj = try! JSONSerialization.jsonObject(with: data) as! [String: Any]
if let p = obj["absolutePoint"] as? [String: Double], let x = p["x"], let y = p["y"] {
    let point = CGPoint(x: x, y: y)
    func click(_ point: CGPoint) {
        CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
        usleep(150000)
        CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
        usleep(60000)
        CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
    }
    click(point)
    usleep(250000)
    click(point)
    usleep(250000)
    click(point)
    print("CGEVENT_CLICKED", x, y)
}
SWIFT
fi

for _ in 1 2 3; do
  if kill -0 "$WAIT_PID" 2>/dev/null; then
    osascript <<'APPLESCRIPT'
tell application "Google Chrome" to activate
delay 0.15
tell application "System Events"
  key code 49
end tell
APPLESCRIPT
    sleep 1
  fi
done

wait "$WAIT_PID" || true

if grep -q 'OPEN_PANEL_DETECTED' "$WAIT_LOG"; then
  if [[ ${#FILE_PATHS[@]} -ne 1 ]]; then
    echo 'OPEN_PANEL_MULTI_FILE_UNSUPPORTED' >&2
    echo 'Fallback open-panel path currently supports only one file; use the filechooser path for multi-image upload.' >&2
    exit 1
  fi
  "$OPEN_PANEL_HELPER" "${FILE_PATHS[0]}" "$TIMEOUT_SECONDS" "$APP_NAME"
else
  echo 'OPEN_PANEL_NOT_DETECTED' >&2
  cat "$WAIT_LOG" >&2 || true
  exit 1
fi

node - "$CDP_URL" "$VERIFY_JSON" "$PLAYWRIGHT_CORE" <<'NODE'
const fs = require('fs');
const cdpUrl = process.argv[2];
const outPath = process.argv[3];
const playwrightCore = process.argv[4];
const { chromium } = require(playwrightCore);
(async () => {
  const browser = await chromium.connectOverCDP(cdpUrl);
  const context = browser.contexts()[0] || await browser.newContext();
  const pages = context.pages();
  const page = pages.find(p => /gemini\.google\.com\/app/.test(p.url())) || pages[0] || await context.newPage();
  await page.waitForTimeout(1500);
  const data = await page.evaluate(() => {
    const body = document.body ? document.body.innerText.slice(0,6000) : '';
    const interesting = Array.from(document.querySelectorAll('*')).filter(el => {
      const s = ((el.innerText || el.textContent || '') + ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('data-test-id') || '')).trim();
      return /source-apple|png|上传|附件|图片|图像|移除|删除|添加/i.test(s);
    }).slice(0,80).map((el, i) => ({
      i,
      tag: el.tagName,
      text: (el.innerText || el.textContent || '').trim().slice(0,120),
      aria: el.getAttribute('aria-label') || '',
      testid: el.getAttribute('data-test-id') || '',
      cls: el.getAttribute('class') || ''
    }));
    return { url: location.href, title: document.title, body, interesting };
  });
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
  console.log(JSON.stringify(data, null, 2));
  await browser.close();
})();
NODE
