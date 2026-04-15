const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { TMP_DIR } = require('../core/constants');
const { XhsCliError } = require('../core/errors');

const DEFAULT_TIMEOUT_MS = 30_000;
const VIDEO_TIMEOUT_MS = DEFAULT_TIMEOUT_MS * 4;
const TEMP_DIR_PREFIX = 'xhs_media_';

function ensureTempDir(tempDir) {
  if (tempDir) {
    const resolved = path.resolve(String(tempDir));
    fs.mkdirSync(resolved, { recursive: true });
    return { tempDir: resolved, ownsDir: false };
  }
  const base = path.join(TMP_DIR, 'downloads');
  fs.mkdirSync(base, { recursive: true });
  const resolved = fs.mkdtempSync(path.join(base, TEMP_DIR_PREFIX));
  return { tempDir: resolved, ownsDir: true };
}

function guessVideoExtension(url, contentType) {
  try {
    const pathname = new URL(url).pathname || '';
    const ext = path.extname(decodeURIComponent(pathname)).toLowerCase();
    if (['.mp4', '.mov', '.avi', '.mkv', '.flv', '.wmv', '.webm'].includes(ext)) {
      return ext;
    }
  } catch (error) {
    // ignore
  }
  const ct = String(contentType || '').toLowerCase();
  const map = {
    'video/mp4': '.mp4',
    'video/quicktime': '.mov',
    'video/x-msvideo': '.avi',
    'video/x-matroska': '.mkv',
    'video/x-flv': '.flv',
    'video/x-ms-wmv': '.wmv',
    'video/webm': '.webm',
  };
  for (const [mime, ext] of Object.entries(map)) {
    if (ct.includes(mime)) {return ext;}
  }
  return '.mp4';
}

function defaultReferer(url) {
  const parsed = new URL(url);
  return `${parsed.protocol}//${parsed.host}/`;
}

async function streamToFile(response, filePath) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const fileStream = fs.createWriteStream(filePath);
  try {
    for await (const chunk of response.body) {
      if (!fileStream.write(chunk)) {
        await new Promise((resolve, reject) => {
          fileStream.once('drain', resolve);
          fileStream.once('error', reject);
        });
      }
    }
    await new Promise((resolve, reject) => {
      fileStream.end((error) => (error ? reject(error) : resolve()));
    });
  } catch (error) {
    fileStream.destroy();
    throw error;
  }
}

class MediaDownloader {
  constructor(options = {}) {
    const payload = ensureTempDir(options.tempDir);
    this.tempDir = payload.tempDir;
    this._ownsDir = payload.ownsDir;
    this.downloadedFiles = [];
  }

  async downloadVideo(url, referer = null) {
    const normalizedUrl = String(url || '').trim();
    if (!normalizedUrl) {
      throw new XhsCliError('Video URL cannot be empty.', { code: 'EMPTY_VIDEO_URL' });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('video download timeout')), VIDEO_TIMEOUT_MS);
    try {
      const headers = {
        Referer: referer || defaultReferer(normalizedUrl),
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      };
      const response = await fetch(normalizedUrl, {
        headers,
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new XhsCliError(`Video download failed with status ${response.status}: ${normalizedUrl}`, { code: 'VIDEO_DOWNLOAD_FAILED' });
      }
      const ext = guessVideoExtension(normalizedUrl, response.headers.get('content-type'));
      const fileName = `${crypto.randomUUID().slice(0, 12)}${ext}`;
      const filePath = path.join(this.tempDir, fileName);
      await streamToFile(response, filePath);
      this.downloadedFiles.push(filePath);
      return filePath;
    } catch (error) {
      if (error instanceof XhsCliError) {throw error;}
      throw new XhsCliError(`Video download failed: ${error.message}`, { code: 'VIDEO_DOWNLOAD_FAILED', cause: error });
    } finally {
      clearTimeout(timer);
    }
  }

  cleanup() {
    if (this._ownsDir && fs.existsSync(this.tempDir)) {
      fs.rmSync(this.tempDir, { recursive: true, force: true });
      this.downloadedFiles = [];
      return;
    }
    for (const item of this.downloadedFiles) {
      try {
        fs.rmSync(item, { force: true });
      } catch (error) {
        // ignore
      }
    }
    this.downloadedFiles = [];
  }
}

module.exports = {
  MediaDownloader,
};
