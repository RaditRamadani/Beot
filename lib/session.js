// Sesi tersimpan: satu file JSONL per sesi di ~/.beot/sessions.
// Hanya pesan user/assistant yang disimpan (bukan tool call) supaya bisa diputar ulang.
import fs from 'node:fs';
import path from 'node:path';
import { HOME_DIR } from './config.js';

export const SESSIONS_DIR = path.join(HOME_DIR, 'sessions');
const KEEP = 50;

export function ensureSessions() {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true, mode: 0o700 });
}

export function sessionFile(cwd, now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-`
    + `${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  return path.join(SESSIONS_DIR, `${stamp}-${process.pid}.jsonl`);
}

export function initSession(cwd, meta = {}) {
  ensureSessions();
  const file = sessionFile(cwd);
  const head = { t: 'meta', v: 1, cwd: path.resolve(cwd), at: new Date().toISOString(), ...meta };
  fs.writeFileSync(file, `${JSON.stringify(head)}\n`, { mode: 0o600 });
  return file;
}

export function appendTurn(file, rec) {
  if (!file) return;
  try {
    // Awali newline: file bisa saja tidak berakhir dengan baris baru (diedit manual).
    fs.appendFileSync(file, `\n${JSON.stringify({ t: 'msg', ...rec })}\n`);
  } catch { /* disk penuh / file dihapus: jangan hentikan chat */ }
}

function readMeta(file) {
  try {
    const first = fs.readFileSync(file, 'utf8').split('\n')[0];
    const row = JSON.parse(first);
    return row.t === 'meta' ? row : null;
  } catch {
    return null;
  }
}

export function listSessions(cwd, limit = 10) {
  let files = [];
  try { files = fs.readdirSync(SESSIONS_DIR).filter((f) => f.endsWith('.jsonl')); } catch { return []; }
  const want = path.resolve(cwd);
  const rows = [];
  for (const name of files) {
    const file = path.join(SESSIONS_DIR, name);
    const meta = readMeta(file);
    if (!meta || path.resolve(meta.cwd || '') !== want) continue;
    rows.push({ file, name, meta });
  }
  rows.sort((a, b) => b.name.localeCompare(a.name));
  return rows.slice(0, limit);
}

export function readSession(file) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return { meta: null, history: [] }; }
  let meta = null;
  const history = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; } // baris korup: lewati
    if (row.t === 'meta') meta = row;
    else if (row.t === 'msg' && (row.role === 'user' || row.role === 'assistant') && typeof row.content === 'string') {
      history.push({ role: row.role, content: row.content });
    }
  }
  return { meta, history };
}

export function latestSession(cwd) {
  return listSessions(cwd, 1)[0] || null;
}

export function pruneSessions(keep = KEEP) {
  let files = [];
  try { files = fs.readdirSync(SESSIONS_DIR).filter((f) => f.endsWith('.jsonl')).sort(); } catch { return 0; }
  const extra = Math.max(0, files.length - keep);
  for (const name of files.slice(0, extra)) {
    try { fs.unlinkSync(path.join(SESSIONS_DIR, name)); } catch { /* abaikan */ }
  }
  return extra;
}
