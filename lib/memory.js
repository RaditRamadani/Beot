// Memori statis: BEOT.md global + proyek, dibaca tiap request (bukan riwayat chat).
import fs from 'node:fs';
import path from 'node:path';
import { HOME_DIR } from './config.js';

export const GLOBAL_MEMORY = path.join(HOME_DIR, 'BEOT.md');
const MAX_CHARS = 8000;

export function projectMemory(cwd = process.cwd()) {
  return path.join(cwd, 'BEOT.md');
}

export function readMemoryFiles(cwd = process.cwd()) {
  const out = [];
  for (const [label, file] of [['global', GLOBAL_MEMORY], ['proyek', projectMemory(cwd)]]) {
    try {
      const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').trim();
      if (text) out.push({ label, file, text: text.slice(0, MAX_CHARS) });
    } catch {
      // file tidak ada: lewati
    }
  }
  return out;
}

export function memoryPrompt(cwd = process.cwd()) {
  const files = readMemoryFiles(cwd);
  if (!files.length) return '';
  return [
    '[MEMORI] Catatan dari pengguna untuk konteks kerja. Ikuti bila relevan.',
    ...files.map((f) => `# ${f.label}\n${f.text}`),
  ].join('\n\n');
}

export function appendMemory(text, { cwd = process.cwd(), global = false } = {}) {
  const line = String(text).replace(/\s+/g, ' ').trim();
  if (!line) throw new Error('Teks kosong.');
  if (line.length > 400) throw new Error('Maksimal 400 karakter per baris.');
  const file = global ? GLOBAL_MEMORY : projectMemory(cwd);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let body = '';
  try { body = fs.readFileSync(file, 'utf8'); } catch { /* file baru */ }
  if (!body.trim()) body = '# BEOT.md\n';
  const bullet = `- ${line}`;
  if (body.includes(bullet)) return { file, added: false };
  fs.writeFileSync(file, `${body.replace(/\s*$/, '')}\n${bullet}\n`);
  return { file, added: true };
}

// /init: ringkasan proyek tanpa memanggil model (nol token, deterministik).
export function buildInitMemory(cwd = process.cwd()) {
  const lines = ['# BEOT.md', ''];
  let pkg = null;
  try { pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')); } catch { /* bukan node */ }
  if (pkg) {
    const name = pkg.name || path.basename(cwd);
    lines.push(`- Proyek: ${name}${pkg.version ? ` v${pkg.version}` : ''}${pkg.type === 'module' ? ' (ESM)' : ''}`);
    const scripts = pkg.scripts || {};
    if (scripts.test) lines.push(`- Tes: \`${scripts.test}\``);
    if (scripts.start) lines.push(`- Jalankan: \`${scripts.start}\``);
    const deps = Object.keys(pkg.dependencies || {});
    lines.push(deps.length ? `- Dependensi runtime: ${deps.join(', ')}` : '- Tanpa dependensi runtime');
    if (pkg.engines?.node) lines.push(`- Node: ${pkg.engines.node}`);
  }
  const counts = {};
  const walk = (dir, depth) => {
    if (depth > 2) return;
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.name.startsWith('.') || ['node_modules', 'dist', 'build', 'coverage'].includes(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else {
        const ext = path.extname(e.name).toLowerCase();
        if (['.js', '.mjs', '.ts', '.tsx', '.py', '.go', '.rs', '.md'].includes(ext)) {
          counts[ext] = (counts[ext] || 0) + 1;
        }
      }
    }
  };
  walk(cwd, 0);
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 4)
    .map(([ext, n]) => `${ext.slice(1)} ${n}`).join(', ');
  if (top) lines.push(`- Berkas: ${top}`);
  let title = '';
  try {
    title = fs.readFileSync(path.join(cwd, 'README.md'), 'utf8').split('\n')[0].replace(/^#+\s*/, '').trim();
  } catch { /* tanpa README */ }
  if (title) lines.push(`- Ringkas: ${title.slice(0, 120)}`);
  lines.push('', 'Tambah aturan proyek di sini; file ini dibaca tiap request.');
  return `${lines.join('\n')}\n`;
}
