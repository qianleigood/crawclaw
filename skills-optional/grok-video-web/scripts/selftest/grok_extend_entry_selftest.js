#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { resolvePuppeteerCore, resolveChromeExecutablePath } = require('../grok_puppeteer_lib');

function assert(condition, message) {
  if (!condition) {throw new Error(message);}
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function extractExtendHelpers() {
  const extendPath = path.join(__dirname, '..', 'grok_video_extend.js');
  const source = fs.readFileSync(extendPath, 'utf8');
  const match = source.match(/function parseHasTextSelector[\s\S]*?\nasync function scanResultUrls/);
  if (!match) {
    throw new Error('Unable to extract extend entry helpers from grok_video_extend.js');
  }
  return match[0].replace(/\nasync function scanResultUrls$/, '');
}

function buildFixtureHtml() {
  return `<!doctype html>
<html>
  <body>
    <div id="dummy-root"></div>
    <div>
      <div>
        <div></div>
        <div>
          <div>
            <div>
              <div>
                <div>
                  <div>
                    <main>
                      <article>
                        <div>
                          <div>result header</div>
                          <div>result media</div>
                          <div>result meta</div>
                          <div>
                            <div>unused left rail</div>
                            <div id="action-row">
                              <button type="button">Like</button>
                              <button type="button">Share</button>
                              <button type="button">Remix</button>
                              <button type="button">Download</button>
                              <button type="button">More</button>
                              <button id="primary-extend-button" type="button" aria-label="More options">
                                <svg width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="8"></circle></svg>
                              </button>
                            </div>
                          </div>
                        </div>
                      </article>
                    </main>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div id="secondary-menu" style="display:none; position:absolute; top:60px; left:60px; background:#fff; padding:8px;">
      <div role="menuitem" id="secondary-extend-video">Extend video</div>
    </div>
    <div id="extend-panel" style="display:none; margin-top:24px;">
      <button type="button">+6s</button>
      <button type="button">+10s</button>
    </div>
    <script>
      document.getElementById('primary-extend-button').addEventListener('click', () => {
        document.getElementById('secondary-menu').style.display = 'block';
      });
      document.getElementById('secondary-extend-video').addEventListener('click', () => {
        document.getElementById('extend-panel').style.display = 'block';
      });
    </script>
  </body>
</html>`;
}

async function main() {
  const puppeteer = resolvePuppeteerCore();
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-extend-entry-selftest-'));
  const browser = await puppeteer.launch({
    executablePath: resolveChromeExecutablePath(''),
    headless: true,
    userDataDir: profileDir,
    defaultViewport: { width: 1440, height: 900 },
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(buildFixtureHtml(), { waitUntil: 'domcontentloaded' });

    const sandbox = {
      module: { exports: {} },
      exports: {},
      sleep,
    };
    vm.runInNewContext(`${extractExtendHelpers()}\nmodule.exports = { detectPrimaryExtendEntry, detectSecondaryExtendEntry, detectDurationControl, waitForLocator };`, sandbox, {
      filename: 'grok_extend_entry_selftest.vm',
    });

    const { detectPrimaryExtendEntry, detectSecondaryExtendEntry, detectDurationControl, waitForLocator } = sandbox.module.exports;

    const primary = await detectPrimaryExtendEntry(page);
    assert(primary, 'primary extend entry should be detected');
    assert(primary.clickTarget === 'button', 'primary extend entry must target button');
    assert(/known_(primary_(button|svg)_xpath|secondary_menu_trigger(?:_svg_xpath_parent_button)?)|css_selector/.test(primary.source || ''), 'primary entry should come from known locator path');

    await page.click(primary.selector);
    const secondary = await waitForLocator(page, detectSecondaryExtendEntry, { timeoutMs: 1500, intervalMs: 100 });
    assert(secondary, 'secondary Extend video entry should appear after primary click');
    assert(/Extend video/i.test(secondary.text || ''), 'secondary entry text should be Extend video');

    await page.click(secondary.selector);
    const plus6 = await detectDurationControl(page, '6s');
    assert(plus6, '+6s duration should be detected after secondary click');

    console.log(JSON.stringify({
      ok: true,
      primary,
      secondary,
      duration6: plus6,
    }, null, 2));
  } finally {
    await browser.close().catch(() => {});
    fs.rmSync(profileDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
