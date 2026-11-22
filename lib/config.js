import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const HOME_DIR = path.join(os.homedir(), '.beot');
export const CONFIG_PATH = path.join(HOME_DIR, 'config.json');
export const SKILLS_DIR = path.join(HOME_DIR, 'skills');
export const THEMES_PATH = path.join(HOME_DIR, 'themes.json');
export const LEGACY_DIR = path.join(os.homedir(), '.byok-chat');

export const DEFAULTS = {
  base_url: 'https://generativelanguage.googleapis.com/v1beta/openai',
  api_key: '',
  model: 'gemini-2.0-flash',
  persona: 'build',
  owner: 'Radit',
  theme: 'default',
  stream_timeout: 90,
  write_confirm: true,
  external: 'ask',
  shell: 'ask',
  shell_env: 'clean',
  project_trust: {},
  web: 'ask',
  thinking: true,
};

export function ensureDirs() {
  fs.mkdirSync(SKILLS_DIR, { recursive: true });
}

// Nama lama (~/.byok-chat) dipindah sekali ke ~/.beot; folder lama dibiarkan sebagai arsip.
export function migrateLegacy() {
  try {
    if (fs.existsSync(HOME_DIR) || !fs.existsSync(LEGACY_DIR)) return false;
    fs.mkdirSync(HOME_DIR, { recursive: true });
    const oldCfg = path.join(LEGACY_DIR, 'config.json');
    if (fs.existsSync(oldCfg)) fs.copyFileSync(oldCfg, CONFIG_PATH);
    const oldSkills = path.join(LEGACY_DIR, 'skills');
    if (fs.existsSync(oldSkills)) fs.cpSync(oldSkills, SKILLS_DIR, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

export function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8').replace(/^\uFEFF/, '');
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return null;
  }
}

// Tema kustom (opsional). Format: { "nama": { "gold": "38;5;45", ... } }
export function loadThemeFile() {
  try {
    const raw = fs.readFileSync(THEMES_PATH, 'utf8').replace(/^\uFEFF/, '');
    const data = JSON.parse(raw);
    return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

export function saveConfig(cfg) {
  ensureDirs();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n');
  try { fs.chmodSync(CONFIG_PATH, 0o600); } catch { /* Windows tidak support, abaikan */ }
}

export function isLocal(baseUrl) {
  try {
    const host = new URL(baseUrl).hostname;
    return host === 'localhost' || host === '127.0.0.1';
  } catch {
    return false;
  }
}

// Ganti host = key lama tidak boleh ikut terkirim ke server baru.
export function hostChanged(oldUrl, newUrl) {
  const host = (u) => {
    try { return new URL(String(u)).host.toLowerCase(); } catch { return String(u || '').trim().toLowerCase(); }
  };
  return host(oldUrl) !== host(newUrl);
}
