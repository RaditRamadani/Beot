// Tool file ala agent: list_dir, read_file, write_file (dengan konfirmasi).
import { realpathSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readDoc } from './readfile.js';
import { HOME_DIR } from './config.js';

const MAX_WRITE_CHARS = 200_000;
const SKIP = new Set(['.git', 'node_modules']);

export function buildFileTools() {
  return [
    {
      type: 'function',
      function: {
        name: 'list_dir',
        description: 'Lihat isi folder di dalam folder kerja. Path relatif atau absolut (path luar diizinkan pada mode trust).',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: "Folder relatif/absolut, default '.'." },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Baca isi file (txt/md/csv/pdf) di folder kerja atau path absolut (diizinkan pada mode trust). Gunakan sebelum mengedit.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path relatif atau absolut.' },
            offset: { type: 'integer', description: 'Mulai baris ke berapa (1-based), opsional.' },
            limit: { type: 'integer', description: 'Berapa baris maksimal dari offset, opsional.' },
          },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'write_file',
        description: 'Buat/timpa file di folder kerja atau path absolut (diizinkan pada mode trust). Pengguna akan diminta konfirmasi bila mode tanya aktif.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path relatif atau absolut file yang dibuat/ditimpa.' },
            content: { type: 'string', description: 'Isi file lengkap.' },
          },
          required: ['path', 'content'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'edit_file',
        description: 'Ubah sebagian isi file yang sudah ada: ganti old_string dengan new_string. Pakai ini untuk perubahan kecil (jangan tulis ulang seluruh file).',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path file yang sudah ada.' },
            old_string: { type: 'string', description: 'Teks persis yang diganti (harus unik, sertakan konteks).' },
            new_string: { type: 'string', description: 'Teks pengganti.' },
            replace_all: { type: 'boolean', description: 'Ganti semua kemunculan (default false).' },
          },
          required: ['path', 'old_string', 'new_string'],
        },
      },
    },
  ];
}

export function resolveInside(p, cwd = process.cwd(), extras = []) {  const root = path.resolve(cwd);
  const target = path.resolve(root, String(p || '.'));
  const roots = [root, ...extras.map((e) => path.resolve(root, String(e)))];
  const near = (value) => {
    let cur = value;
    const rest = [];
    for (;;) {
      try {
        const real = realpathSync(cur);
        return rest.length ? path.join(real, ...rest.reverse()) : real;
      } catch {
        const dir = path.dirname(cur);
        if (dir === cur) return value;
        rest.push(path.basename(cur));
        cur = dir;
      }
    }
  };
  const norm = (value) => (process.platform === 'win32' ? value.toLowerCase() : value);
  const realTarget = norm(near(target));
  const allowed = roots.some((r) => {
    const realRoot = norm(near(r));
    return realTarget === realRoot || realTarget.startsWith(realRoot + path.sep);
  });
  if (!allowed) {
    const err = new Error('Path di luar folder kerja ditolak. Gunakan /cd atau /add-dir.');
    err.outside = true;
    throw err;
  }
  return target;
}

// Path di luar izin: tanya pengguna (sekali) lewat callback, lalu izinkan untuk session.
export async function ensureAccess(rel, opts = {}) {
  try {
    resolveInside(rel, opts.cwd, opts.extras || []);
  } catch (err) {
    if (!err.outside || typeof opts.onOutside !== 'function') throw err;
    const abs = path.resolve(opts.cwd || process.cwd(), String(rel || '.'));
    const ok = await opts.onOutside(abs);
    if (!ok) throw new Error('Akses ke path itu ditolak pengguna.');
    if (Array.isArray(opts.extras) && !opts.extras.includes(abs)) opts.extras.push(abs);
  }
}

const SECRET_NAMES = /^(\.env(\..+)?|\.envrc|\.npmrc|\.netrc|_netrc|\.git-credentials|\.pgpass|id_rsa|id_ed25519|credentials\.json)$/i;
const SECRET_DIRS = new Set(['.git', '.ssh', '.aws', '.gnupg', '.kube']);

function insideDir(target, dir) {
  const norm = (v) => (process.platform === 'win32' ? v.toLowerCase() : v);
  const t = norm(path.resolve(target));
  const d = norm(path.resolve(dir));
  return t === d || t.startsWith(d + path.sep);
}

// File yang membawa kredensial tidak boleh dibaca/dicari lewat tool.
export function sensitiveReason(target) {
  const base = path.basename(String(target || ''));
  if (SECRET_NAMES.test(base)) return 'File sensitif (kredensial) diblokir untuk keamanan.';
  const segs = path.resolve(String(target)).split(path.sep).map((s) => s.toLowerCase());
  if (segs.some((s) => SECRET_DIRS.has(s))) return 'Folder kredensial (.git/.ssh/.aws) diblokir untuk keamanan.';
  if (insideDir(target, HOME_DIR)) return 'Folder config Beot (berisi API key) diblokir untuk keamanan.';
  return null;
}

function sizeLabel(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} kB`;
}

export async function listDir(rel = '.', cwd = process.cwd(), extras = []) {
  const dir = resolveInside(rel, cwd, extras);
  const bad = sensitiveReason(dir);
  if (bad) throw new Error(bad);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const rows = [];
  for (const e of entries) {
    if (SKIP.has(e.name)) continue;
    if (e.isDirectory()) {
      rows.push({ type: 'dir', name: e.name });
    } else {
      let bytes = 0;
      try { bytes = (await fs.stat(path.join(dir, e.name))).size; } catch { /* abaikan */ }
      rows.push({ type: 'file', name: e.name, bytes });
    }
  }
  rows.sort((a, b) => (b.type === 'dir') - (a.type === 'dir') || a.name.localeCompare(b.name));
  const shown = rows.slice(0, 200);
  const lines = [`[DIR: ${path.relative(path.resolve(cwd), dir) || '.'}]`];
  if (!shown.length) lines.push('(kosong)');
  for (const r of shown) {
    lines.push(r.type === 'dir' ? `📁 ${r.name}/` : `📄 ${r.name} (${sizeLabel(r.bytes)})`);
  }
  if (rows.length > shown.length) lines.push(`… ${rows.length - shown.length} entri lagi`);
  return lines.join('\n');
}

export async function readFileTool(rel, cwd = process.cwd(), extras = [], opts = {}) {
  const file = resolveInside(rel, cwd, extras);
  const bad = sensitiveReason(file);
  if (bad) throw new Error(bad);
  const doc = await readDoc(file);
  let text = doc.text;
  let header = `[FILE: ${doc.nama}]`;
  const offset = Math.max(1, Number(opts.offset) || 1);
  const limit = Number(opts.limit) || 0;
  if (offset > 1 || limit) {
    const all = text.split('\n');
    const slice = limit ? all.slice(offset - 1, offset - 1 + limit) : all.slice(offset - 1);
    const end = offset - 1 + slice.length;
    text = slice.join('\n');
    header = `[FILE: ${doc.nama} · baris ${offset}–${end} dari ${all.length}]`;
  }
  return `${header}\n${text}${doc.truncated ? '\n(isi dipotong)' : ''}`;
}

export async function writeFileTool(rel, content, { cwd = process.cwd(), confirmWrite, allowWrite = true, extras = [], onOutside } = {}) {
  if (!allowWrite) throw new Error('Mode plan: menulis/mengubah file dinonaktifkan.');
  const name = String(rel || '').trim();
  if (!name) throw new Error('Path kosong.');
  await ensureAccess(name, { cwd, extras, onOutside });
  const text = String(content ?? '');
  if (text.length > MAX_WRITE_CHARS) throw new Error('Isi terlalu besar (>200.000 karakter).');
  const target = resolveInside(name, cwd, extras);
  const bad = sensitiveReason(target);
  if (bad) throw new Error(bad);
  const binaryTool = { '.pdf': 'export_pdf', '.xlsx': 'export_xlsx', '.docx': 'export_docx' }[path.extname(target).toLowerCase()];
  if (binaryTool) throw new Error(`File ${path.extname(target)} harus dibuat dengan ${binaryTool}, bukan write_file.`);
  const relParts = path.relative(path.resolve(cwd), target).split(path.sep);
  if (relParts.includes('.git') || relParts.includes('node_modules')) {
    throw new Error('Folder .git/node_modules tidak boleh ditulis.');
  }
  try {
    const st = await fs.stat(target);
    if (st.isDirectory()) throw new Error('Path itu folder.');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const shown = path.relative(path.resolve(cwd), target) || name;
  let old = null;
  try {
    old = await fs.readFile(target, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  if (old !== null && old === text) {
    return {
      content: `TIDAK BERUBAH: ${shown} sudah persis sama. JANGAN kirim ulang file ini — lanjutkan langkah lain atau selesaikan dengan teks.`,
      note: `skip ${shown}`,
    };
  }
  if (typeof confirmWrite === 'function') {
    const ok = await confirmWrite(shown, text, old);
    if (!ok) return { content: 'DIBATALKAN: pengguna menolak menulis file.', refused: true, note: `batal tulis ${shown}` };
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, text, 'utf8');
  const lines = text ? text.split('\n').length : 0;
  return { content: `OK: ${shown} ditulis (${lines} baris, ${text.length} karakter).`, note: `tulis ${shown}` };
}

const SKIP_DIRS = new Set(['.git', 'node_modules']);

// Pencarian gaya OpenCode/Claude: grep isi file + glob nama file.
async function walkFiles(dir, out, max) {
  if (out.length >= max) return;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (out.length >= max) return;
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
      await walkFiles(path.join(dir, e.name), out, max);
      continue;
    }
    if (e.isFile()) out.push(path.join(dir, e.name));
  }
}

function globToRegExp(glob) {
  let out = '';
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') { out += '(?:.*/)?'; i += 3; continue; }
        out += '.*';
        i += 2;
        continue;
      }
      out += '[^/]*';
      i += 1;
      continue;
    }
    if (c === '?') { out += '[^/]'; i += 1; continue; }
    if ('^$.+()[]{}|\\'.includes(c)) { out += `\\${c}`; i += 1; continue; }
    out += c;
    i += 1;
  }
  return new RegExp(`^${out}$`);
}

async function grepTool(args, opts) {
  const pattern = String(args.pattern || '');
  if (!pattern) throw new Error('pattern wajib diisi.');
  if (pattern.length > 300) throw new Error('Pola regex terlalu panjang (maks 300 karakter).');
  // shortcut: tolak pola bersarang seperti (a+)+ yang bikin backtracking ekstrem;
  // ganti ke worker+timeout kalau nanti perlu regex bebas tanpa risiko hang.
  if (/\((?:[^()\\]|\\.)*[+*](?:[^()\\]|\\.)*\)\s*[+*{]/.test(pattern)) {
    throw new Error('Pola terlalu kompleks (kuantifier bersarang) — sederhanakan regex-nya.');
  }
  let re;
  try {
    re = new RegExp(pattern, args.ignore_case ? 'i' : '');
  } catch {
    throw new Error('Regex tidak valid.');
  }
  const limit = Math.min(200, Number(args.limit) || 50);
  const root = resolveInside(args.path || '.', opts.cwd, opts.extras || []);
  const st = await fs.stat(root).catch(() => null);
  const files = [];
  if (st?.isDirectory()) await walkFiles(root, files, 4000);
  else if (st) files.push(root);
  const safe = files.filter((f) => !sensitiveReason(f));
  const out = [];
  let total = 0;
  let scanned = 0;
  for (const f of safe) {
    if (out.length >= limit) break;
    // Beri napas ke event loop supaya UI tidak membeku di folder besar.
    scanned += 1;
    if (scanned % 25 === 0) await new Promise((r) => setImmediate(r));
    let txt;
    try { txt = await fs.readFile(f, 'utf8'); } catch { continue; }
    if (txt.length > 1_000_000) txt = txt.slice(0, 1_000_000);
    if (txt.includes('\0')) continue;
    const rel = path.relative(opts.cwd || process.cwd(), f).split(path.sep).join('/');
    const lines = txt.split('\n');
    for (let n = 0; n < lines.length; n++) {
      if (lines[n].length > 4000) continue; // baris ekstrem: lewati, cegah backtracking panjang
      if (re.test(lines[n])) {
        total += 1;
        if (out.length < limit) out.push(`${rel}:${n + 1}: ${lines[n].trim().slice(0, 200)}`);
      }
    }
  }
  const body = out.length ? out.join('\n') : '(tidak ada yang cocok)';
  const more = total > out.length ? `\n… ${total - out.length} cocok lain tidak ditampilkan` : '';
  return { content: body + more, note: `grep ${total} cocok${safe.length > 1 ? ` di ${safe.length} file` : ''}` };
}

async function globTool(args, opts) {
  const pattern = String(args.pattern || '');
  if (!pattern) throw new Error('pattern wajib diisi.');
  let re;
  try {
    re = globToRegExp(pattern);
  } catch {
    throw new Error('Pola glob tidak valid.');
  }
  const limit = Math.min(500, Number(args.limit) || 100);
  const root = resolveInside(args.path || '.', opts.cwd, opts.extras || []);
  const st = await fs.stat(root).catch(() => null);
  const files = [];
  if (st?.isDirectory()) await walkFiles(root, files, 4000);
  else if (st) files.push(root);
  const hits = [];
  for (const f of files) {
    if (hits.length >= limit) break;
    if (sensitiveReason(f)) continue;
    const rel = path.relative(root, f).split(path.sep).join('/');
    if (re.test(rel)) hits.push(rel);
  }
  const body = hits.length ? hits.join('\n') : '(tidak ada file yang cocok)';
  const more = hits.length >= limit ? `\n… lebih banyak tidak ditampilkan (limit ${limit})` : '';
  return { content: body + more, note: `glob ${hits.length} file` };
}

export function buildSearchTools() {
  return [
    {
      type: 'function',
      function: {
        name: 'grep_file',
        description: 'Cari pola regex di isi file (folder kerja/folder izin). Hasil: path:baris: teks. Pakai ini dulu sebelum membaca banyak file.',
        parameters: {
          type: 'object',
          properties: {
            pattern: { type: 'string', description: 'Regex, mis. "function\\s+\\w+".' },
            path: { type: 'string', description: 'Folder relatif/absolut, default "."' },
            ignore_case: { type: 'boolean', description: 'Abai besar-kecil huruf (default false).' },
            limit: { type: 'integer', description: 'Maks hasil (default 50).' },
          },
          required: ['pattern'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'glob_file',
        description: 'Cari file berdasarkan pola nama, mis. **/*.py, src/**/*.ts, *.md. Hasil: path relatif.',
        parameters: {
          type: 'object',
          properties: {
            pattern: { type: 'string', description: 'Pola glob.' },
            path: { type: 'string', description: 'Folder relatif/absolut, default "."' },
            limit: { type: 'integer', description: 'Maks hasil (default 100).' },
          },
          required: ['pattern'],
        },
      },
    },
  ];
}

export async function editFileTool(rel, { old_string, new_string, replace_all = false } = {}, opts = {}) {
  const file = resolveInside(rel, opts.cwd, opts.extras || []);
  const bad = sensitiveReason(file);
  if (bad) throw new Error(bad);
  let old;
  try {
    old = await fs.readFile(file, 'utf8');
  } catch {
    throw new Error(`File tidak ditemukan: ${rel}. Untuk file baru pakai write_file.`);
  }
  const needle = String(old_string ?? '');
  const nextText = String(new_string ?? '');
  if (!needle) throw new Error('old_string wajib diisi.');
  const count = old.split(needle).length - 1;
  if (!count) throw new Error('old_string tidak ditemukan (cek spasi/indentasi).');
  if (count > 1 && !replace_all) {
    throw new Error(`old_string muncul ${count}× — sertakan konteks lebih atau pakai replace_all.`);
  }
  const next = replace_all ? old.split(needle).join(nextText) : old.replace(needle, nextText);
  if (next === old) return { content: 'TIDAK BERUBAH: teks pengganti sama dengan aslinya.', note: `skip ${rel}` };
  return writeFileTool(rel, next, opts);
}

export async function runFileTool(name, rawArgs, opts = {}) {
  let args;
  try {
    args = JSON.parse(rawArgs || '{}');
  } catch {
    return { error: 'Argumen tool bukan JSON valid.' };
  }
  try {
    if (name === 'list_dir') {
      await ensureAccess(args.path || '.', opts);
      return { content: await listDir(args.path || '.', opts.cwd, opts.extras || []) };
    }
    if (name === 'read_file') {
      await ensureAccess(args.path, opts);
      const content = await readFileTool(args.path, opts.cwd, opts.extras || [], {
        offset: args.offset,
        limit: args.limit,
      });
      const baris = Math.max(0, content.split('\n').length - 1);
      return { content, note: `baca ${args.path} (${baris} baris)` };
    }
    if (name === 'grep_file') {
      await ensureAccess(args.path || '.', opts);
      return await grepTool(args, opts);
    }
    if (name === 'glob_file') {
      await ensureAccess(args.path || '.', opts);
      return await globTool(args, opts);
    }
    if (name === 'write_file') return await writeFileTool(args.path, args.content, opts);
    if (name === 'edit_file') return await editFileTool(args.path, args, opts);
    return { error: `Tool "${name}" tidak dikenal.` };
  } catch (err) {
    return { error: err.message };
  }
}
