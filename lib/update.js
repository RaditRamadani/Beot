// Cek versi terbaru di npm registry. Tidak memasang apa pun — itu tugas /update.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { HOME_DIR } from './config.js';
import { VERSION } from './version.js';

export const CACHE_PATH = path.join(HOME_DIR, 'update.json');
const DEFAULT_URL = 'https://registry.npmjs.org/beot/latest';
const TTL_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 3000;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// -1 / 0 / 1; prerelease dianggap lebih lama dari rilis final.
export function compareVersion(a, b) {
  const split = (v) => String(v || '').trim().replace(/^v/i, '').split('+')[0].split('-');
  const [coreA, ...preA] = split(a);
  const [coreB, ...preB] = split(b);
  const pa = coreA.split('.').map((n) => Number(n) || 0);
  const pb = coreB.split('.').map((n) => Number(n) || 0);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  const pre1 = preA.join('-');
  const pre2 = preB.join('-');
  if (!pre1 && pre2) return 1;
  if (pre1 && !pre2) return -1;
  if (pre1 === pre2) return 0;
  return pre1.localeCompare(pre2) > 0 ? 1 : -1;
}

function readCache(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return data && typeof data.latest === 'string' ? data : null;
  } catch {
    return null;
  }
}

function writeCache(file, value) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  } catch { /* cache gagal: bukan masalah */ }
}

function fetchLatest(url) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    let req;
    try {
      const target = new URL(url);
      const mod = target.protocol === 'https:' ? https : http;
      req = mod.request(target, {
        method: 'GET',
        timeout: TIMEOUT_MS,
        headers: { 'user-agent': `beot/${VERSION}`, accept: 'application/json' },
      }, (res) => {
        if (res.statusCode !== 200) { res.resume(); return finish(null); }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (d) => {
          body += d;
          if (body.length > 64_000) { res.destroy(); finish(null); }
        });
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            const v = String(data.version || '').trim();
            finish(/^v?\d+\.\d+\.\d+([0-9A-Za-z.+-]*)$/.test(v) ? v.replace(/^v/i, '') : null);
          } catch {
            finish(null);
          }
        });
      });
      req.on('timeout', () => { req.destroy(); finish(null); });
      req.on('error', () => finish(null));
      req.end();
    } catch {
      finish(null);
    }
  });
}

export async function checkUpdate({ force = false, cacheFile = CACHE_PATH, url = process.env.BEOT_UPDATE_URL || DEFAULT_URL, now = Date.now() } = {}) {
  const cache = readCache(cacheFile);
  if (!force && cache && now - (Number(cache.at) || 0) < TTL_MS) {
    return { current: VERSION, latest: cache.latest, available: compareVersion(cache.latest, VERSION) > 0 };
  }
  const latest = await fetchLatest(url);
  if (!latest) return null;
  writeCache(cacheFile, { at: now, latest });
  return { current: VERSION, latest, available: compareVersion(latest, VERSION) > 0 };
}

export function isGitInstall(root = process.env.BEOT_INSTALL_ROOT || ROOT) {
  return fs.existsSync(path.join(root, '.git'));
}

// Jalankan pemasangan global. Argumen tetap (tidak ada input pengguna), tanpa shell kecuali Windows.
export function runNpmUpdate({ timeoutMs = 180_000 } = {}) {
  return new Promise((resolve, reject) => {
    const win = process.platform === 'win32';
    const child = spawn(win ? 'npm.cmd' : 'npm', ['install', '-g', 'beot@latest'], {
      cwd: ROOT,
      shell: win,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    const push = (d) => {
      out += String(d);
      if (out.length > 20_000) out = out.slice(-20_000);
    };
    child.stdout.on('data', push);
    child.stderr.on('data', push);
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* */ }
      reject(new Error('waktu pemasangan habis'));
    }, timeoutMs);
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve(out);
      reject(new Error(`npm berhenti dengan kode ${code}`));
    });
  });
}
