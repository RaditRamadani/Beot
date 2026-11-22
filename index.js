#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, saveConfig, DEFAULTS, isLocal, CONFIG_PATH, SKILLS_DIR, migrateLegacy, hostChanged, loadThemeFile } from './lib/config.js';
import { streamChat } from './lib/llm.js';
import { loadPersonas } from './lib/persona.js';
import { ensureBundledSkills, loadSkills, loadSkillsFrom } from './lib/skills.js';
import { buildSkillTools, runSkillTool, skillIndexPrompt } from './lib/skilltool.js';
import { buildFileTools, runFileTool, buildSearchTools } from './lib/filetools.js';
import { buildExportTools, runExportTool, EXPORT_NAMES } from './lib/exporttool.js';
import { readDoc } from './lib/readfile.js';
import { buildDiff, buildNewFileDiff } from './lib/diff.js';
import { ask, log as tuiLog, append as tuiAppend, clearLog, init as tuiInit, setStatus, setSplashNote, shutdown, startLoading, stopLoading, beginInterrupt, endInterrupt, setTitle, bell, takeAttachment, diffBlock, markLog, rollbackLog, toolProgress, confirmInline, stripEsc, visualWidth, setFileSuggest, takeAtFiles, thoughtBlock, ledgerLine, setTodos } from './lib/tui.js';
import { COMMANDS } from './lib/commands.js';
import { buildTodoTool, runTodoTool } from './lib/todo.js';
import { initSession, appendTurn, listSessions, readSession, latestSession, pruneSessions } from './lib/session.js';
import { summarize, compactedHistory } from './lib/compact.js';
import { buildShellTool, runShellTool } from './lib/shell.js';
import { buildWebTool, runWebTool } from './lib/web.js';
import { costOf, priceFor, fmtUsd } from './lib/cost.js';
import { memoryPrompt, readMemoryFiles, appendMemory, buildInitMemory, projectMemory } from './lib/memory.js';
import { PROVIDERS, findProvider, fetchModels, mergeModels } from './lib/providers.js';
import { userContent, contentChars } from './lib/attach.js';
import { banner, c, hr, userPrompt, botPrefix, ok, warn, setTheme, themeName, themeNames, registerThemes, setPlain } from './ui/theme.js';

const CONTEXT_WINDOW = 128000; // perkiraan; sesuaikan bila window model diketahui

const state = {
  cfg: DEFAULTS,
  personas: [],
  persona: null,
  skill: null,
  file: null,
  history: [],
  tokens: 0,
  last: { total: 0, prompt: null, completion: null, estimated: false, reported: null },
  session: { requests: 0, tokens: 0, cost: 0 },
  liveModels: { url: null, time: 0, models: [] },
  cwd: process.cwd(),
  extraDirs: [],
  busy: false,
  sessionFile: null,
  autoCompacted: false,
  silent: false,
  headless: false,
  lastTools: [],
  lastError: null,
};

const say = (text = '') => {
  if (state.silent) return;
  tuiLog(`${text}`);
};
const write = (text) => {
  if (state.silent) return;
  tuiAppend(text);
};
function estTokens() {
  return Math.round(
    state.history.reduce((sum, m) => sum + contentChars(m.content), 0) / 4
    + (state.file?.text.length || 0) / 4,
  );
}

function usageTotal(u) {
  if (!u) return null;
  if (Number.isFinite(u.total_tokens)) return u.total_tokens;
  const p = Number.isFinite(u.prompt_tokens) ? u.prompt_tokens : 0;
  const q = Number.isFinite(u.completion_tokens) ? u.completion_tokens : 0;
  return p || q ? p + q : null;
}

function systemPrompt() {
  const planning = state.persona?.nama === 'plan';
  const parts = [
    'Kamu adalah asisten chat di terminal. Jawab dalam teks polos yang enak dibaca di terminal (hindari HTML; tabel markdown boleh, akan dirender rapi).',
    'Tulis kode di dalam blok ```<bahasa> ... ``` supaya tampil rapi.',
    planning
      ? 'Kamu punya tool list_dir dan read_file (hanya baca). Jangan menulis atau mengubah file.'
      : 'Kamu punya tool list_dir, read_file, write_file, edit_file, grep_file, dan glob_file. Untuk MENGUBAH atau MEMBUAT file WAJIB panggil tool (jangan hanya menampilkan kode atau bilang akan menulis); pengguna melihat diff lalu konfirmasi. Perubahan kecil pada file yang sudah ada: pakai edit_file (old_string → new_string), bukan write_file. Untuk MENEMUKAN kode/file pakai grep_file (regex) atau glob_file (pola nama) dulu sebelum membaca banyak file. Untuk pekerjaan ≥3 langkah, pakai todo_write supaya progres terlihat. Tool bash menjalankan perintah (setiap perintah butuh izin pengguna; jangan pakai untuk hal yang bisa dikerjakan tool file). web_fetch untuk membaca dokumentasi/URL publik. Dokumen biner pakai export_pdf, export_xlsx, export_docx, atau export_rtf.',
  ];
  if (planning) {
    parts.push('MODE PLAN: dilarang membuat/mengubah file atau mengeksekusi perubahan. Berikan rencana langkah bernomor, opsi + trade-off, risiko, dan cara verifikasi.');
  }
  parts.push(`[FOLDER KERJA: ${state.cwd}]`);
  const memory = memoryPrompt(state.cwd);
  if (memory) parts.push(memory);
  if (state.extraDirs.length) parts.push(`[FOLDER TAMBAHAN: ${state.extraDirs.join(', ')}]`);
  parts.push(state.cfg.external === 'trust'
    ? 'IZIN PATH: path absolut di luar folder kerja DIIZINKAN OTOMATIS (mode trust). Jangan menolak hanya karena file di luar folder; langsung panggil tool dengan path relatif/absolut. Hanya .git dan node_modules yang dilarang.'
    : 'IZIN PATH: path di luar folder kerja akan memunculkan konfirmasi pengguna. Tetap panggil tool dengan path yang diminta; pengguna yang memutuskan izin.');
  parts.push(`[IDENTITAS]\nAPP: Beot v0.1 (aplikasi chat terminal; model dijalankan lewat API milik pengguna)\nMODEL: ${state.cfg.model}\nPEMBUAT: ${state.cfg.owner || 'pengembang Beot'}`);
  parts.push('Jawaban identitas: ditanya siapa yang membangun aplikasinya → "Beot dibuat oleh <PEMBUAT>". Ditanya model apa → jawab sesuai MODEL di atas. Jangan mengklaim sebagai produk perusahaan lain (Z.ai, OpenAI, Anthropic, NVIDIA, dll) kecuali sesuai MODEL. Tidak yakin → katakan tidak tahu, jangan mengarang. Model ≠ aplikasi: model tidak mengenal penulis aplikasinya.');
  parts.push('Sebelum write_file, pastikan isi baru BERBEDA dari file yang sudah ada; kalau sama persis, jangan tulis ulang (cukup lanjut ke langkah lain atau selesai).');
  parts.push(state.persona.system_prompt);
  if (state.skill) {
    parts.push(`[SKILL AKTIF: ${state.skill.nama}]\n${state.skill.isi}`);
  } else {
    const index = skillIndexPrompt(null, state.cwd);
    if (index) parts.push(index);
  }
  if (state.file) {
    parts.push(`[FILE YANG DIBACA: ${state.file.nama}]\n${state.file.text}`);
  }
  return parts.join('\n\n');
}

const SPLASH_MIN = 44;

// Splash layar penuh hanya di TTY yang cukup lebar.
function splashActive() {
  return process.stdin.isTTY && process.stdout.isTTY
    && Math.max(30, (process.stdout.columns || 80) - 1) >= SPLASH_MIN;
}

function renderBanner() {
  const w = Math.max(30, (process.stdout.columns || 80) - 1);
  say(banner({
    persona: state.persona?.nama || '-',
    model: stripEsc(state.cfg.model),
    file: state.file?.nama ? stripEsc(state.file.nama) : '',
    width: w,
  }));
}

function fmtK(n) {
  if (!n) return '0';
  if (n >= 10000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(n);
}

function fmtDuration(ms) {
  if (ms < 950) return `${Math.max(10, Math.round(ms / 10) * 10)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function contextPct(tokens) {
  if (!tokens) return 0;
  return Math.min(100, Math.max(1, Math.round((tokens / CONTEXT_WINDOW) * 100)));
}

function contextBar(tokens) {
  const pct = contextPct(tokens);
  const filled = pct === 0 ? 0 : Math.min(5, Math.max(1, Math.round(pct / 20)));
  const color = pct >= 80 ? c.maroon : pct >= 50 ? c.gold : c.mint;
  return `${color('▓'.repeat(filled))}${c.dim('░'.repeat(5 - filled))} ${c.dim(`${pct}%`)}`;
}

function composerStatus() {
  const spent = state.session.cost > 0.00005 ? ` ${c.dim(fmtUsd(state.session.cost))}` : '';
  const right = `${c.dim('ctx')} ${contextBar(state.tokens)} ${c.dim(`${fmtK(state.tokens)} tok`)}${spent}`
    + (state.busy ? `  ${c.gold('esc hentikan')}` : `  ${c.dim('/ menu')}`);
  const folder = path.basename(state.cwd) || state.cwd;
  const extra = state.extraDirs.length ? ` +${state.extraDirs.length}` : '';
  return {
    left: `${c.gold(state.persona?.nama || '-')}  ${c.dim(folder)}${c.dim(extra)}  ${stripEsc(state.cfg.model)}`,
    right,
  };
}

// Shift+Tab: giliran persona berikutnya (build ↔ plan, dst).
function cyclePersona() {
  if (!state.personas.length) return;
  const i = state.personas.findIndex((p) => p.nama === state.persona?.nama);
  const next = state.personas[(i + 1) % state.personas.length] || state.personas[0];
  state.persona = next;
  state.cfg.persona = next.nama;
  setStatus(composerStatus);
  setTitle(`Beot · ${next.nama}`);
}

function handleStatus() {
  const width = Math.max(40, (process.stdout.columns || 80) - 2);
  const room = Math.max(12, width - 26);
  const row = (label, value) => {
    const text = String(value ?? '');
    const short = visualWidth(text) > room ? `${stripEsc(text).slice(0, Math.max(1, room - 1))}…` : text;
    say(ledgerLine(label, short, width));
  };
  const last = state.last;
  say(c.bold('Status sesi'));
  if (!state.session.requests) {
    row('request terakhir', c.dim('belum ada'));
  } else {
    row('request terakhir', `${fmtK(last.total)} token${last.estimated ? ' (estimasi)' : ''}`);
    if (last.prompt != null || last.completion != null) {
      row('rincian', `${fmtK(last.prompt ?? 0)} prompt + ${fmtK(last.completion ?? 0)} jawaban`);
    }
    row('konteks', `${contextPct(last.total)}% ${contextBar(last.total)}`);
  }
  row('sesi ini', `${state.session.requests} request · ${fmtK(state.session.tokens)} token`);
  row('riwayat', `${state.history.length} pesan`);
  row('model', stripEsc(state.cfg.model));
  const base = (v) => String(v || '').split('/').pop().toLowerCase();
  if (state.last.reported) {
    const same = base(state.last.reported) === base(state.cfg.model);
    row('respons model', `${c.mint(stripEsc(state.last.reported))}${same ? '' : c.gold(' ⚠ beda dari config')}`);
  } else {
    row('respons model', '-');
  }
  row('timeout stream', `${Number(state.cfg.stream_timeout) || 90} dtk`);
  row('thinking', state.cfg.thinking === false ? 'off' : 'on');
  row('folder kerja', stripEsc(state.cwd));
  if (state.extraDirs.length) row('folder izin', state.extraDirs.join(', '));
}

async function handleFiles() {
  let root = state.cwd;
  let dir = root;
  for (;;) {
    let entries;
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch (err) {
      return say(warn(`Tidak bisa membaca folder: ${err.message}`));
    }
    entries = entries
      .filter((e) => e.name !== '.git' && e.name !== 'node_modules')
      .sort((a, b) => (b.isDirectory() - a.isDirectory()) || a.name.localeCompare(b.name))
      .slice(0, 300);
    const items = [{ label: '📂 Ketik lokasi…', desc: 'buka folder / file dari path bebas', value: 'goto' }];
    if (dir !== root) items.push({ label: '..', desc: 'naik folder', value: '..' });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        items.push({ label: `📁 ${e.name}`, desc: 'folder', value: `dir:${e.name}` });
      } else {
        let size = '';
        try { size = `${Math.max(1, Math.round((await fs.promises.stat(full)).size / 1024))} kB`; } catch { /* abaikan */ }
        items.push({ label: `📄 ${e.name}`, desc: size, value: `file:${e.name}` });
      }
    }
    if (!items.length) items.push({ label: '(kosong)', desc: '', value: 'none' });
    const picked = await ask(`File · ${dir}`, { select: items });
    if (!picked || picked === 'none') return;
    if (picked === 'goto') {
      const input = await ask('Lokasi file / folder', {
        text: {
          label: 'Path >',
          desc: ['Path absolut (D:\\folder\\file.html) atau relatif ke folder kerja.'],
          validate: (v) => (v.trim() ? '' : 'Path tidak boleh kosong'),
        },
      });
      if (!input) continue;
      const target = path.resolve(state.cwd, input.replace(/^"|"$/g, '').trim());
      try {
        const st = await fs.promises.stat(target);
        if (st.isDirectory()) {
          root = target;
          dir = target;
          continue;
        }
        const doc = await readDoc(target);
        state.file = doc;
        say(ok(`📄 ${doc.nama} — ${(doc.bytes / 1024).toFixed(1)} kB, ${doc.kind}${doc.truncated ? c.maroon(' (dipotong)') : ''}`));
        return;
      } catch (err) {
        say(warn(err.message));
        continue;
      }
    }
    if (picked === '..') {
      dir = path.dirname(dir);
      continue;
    }
    if (picked.startsWith('dir:')) {
      dir = path.join(dir, picked.slice(4));
      continue;
    }
    const file = path.join(dir, picked.slice(5));
    try {
      const doc = await readDoc(file);
      state.file = doc;
      const size = `${(doc.bytes / 1024).toFixed(1)} kB`;
      say(ok(`📄 ${doc.nama} — ${size}, ${doc.kind}${doc.truncated ? c.maroon(' (dipotong)') : ''}`));
      return;
    } catch (err) {
      say(warn(err.message));
      return;
    }
  }
}

function cleanPath(arg) {
  return String(arg || '').replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1').trim();
}

function handleCd(arg) {
  const want = cleanPath(arg);
  if (!want) {
    say(`  folder kerja : ${c.lav(state.cwd)}`);
    if (state.extraDirs.length) say(`  folder izin  : ${c.dim(state.extraDirs.join(', '))}`);
    return;
  }
  const target = path.resolve(state.cwd, want);
  try {
    if (!fs.statSync(target).isDirectory()) return say(warn(`Bukan folder: ${target}`));
  } catch (err) {
    return say(warn(`Folder tidak bisa dibuka: ${err.message}`));
  }
  state.cwd = target;
  fileCache = { at: 0, items: [] };
  setStatus(composerStatus);
  say(ok(`Folder kerja: ${c.lav(target)}`));
}

function handleAddDir(arg) {
  const want = cleanPath(arg);
  if (!want) {
    if (!state.extraDirs.length) return say(c.dim('Belum ada folder tambahan. Pakai /add-dir <folder>.'));
    say('  folder tambahan:');
    for (const p of state.extraDirs) say(`   ${c.lav(p)}`);
    return;
  }
  const target = path.resolve(state.cwd, want);
  const i = state.extraDirs.findIndex((p) => p.toLowerCase() === target.toLowerCase());
  if (i >= 0) {
    state.extraDirs.splice(i, 1);
    setStatus(composerStatus);
    return say(ok(`Folder izin dihapus: ${target}`));
  }
  try {
    if (!fs.statSync(target).isDirectory()) return say(warn(`Bukan folder: ${target}`));
  } catch (err) {
    return say(warn(`Folder tidak bisa dibuka: ${err.message}`));
  }
  state.extraDirs.push(target);
  setStatus(composerStatus);
  say(ok(`Folder izin ditambah: ${c.lav(target)}`));
}

const THEME_DESC = {
  default: 'amber di atas netral (standar)',
  mono: 'abu-abu netral, minim warna',
  kontras: 'kontras tinggi (cyan/kuning)',
};

function applyTheme(picked) {
  setTheme(picked);
  state.cfg.theme = picked;
  try { saveConfig(state.cfg); } catch { /* tema tetap dipakai untuk sesi ini */ }
  setStatus(composerStatus);
  say(ok(`Tema: ${c.lav(picked)}`));
  say(`  ${c.kw('const')} ${c.fn('contoh')} = ${c.str('"warna"')} ${c.dim('// komentar')} ${c.num('42')}`);
}

async function handleTheme(arg) {
  const names = themeNames();
  const want = String(arg || '').trim().toLowerCase();
  if (want) {
    if (!names.includes(want)) {
      return say(warn(`Tema "${want}" tidak ada. Pilihan: ${names.join(', ')}.`));
    }
    return applyTheme(want);
  }
  const picked = await ask('Pilih tema', {
    select: names.map((t) => ({
      label: t,
      desc: THEME_DESC[t] || 'tema kustom (themes.json)',
      value: t,
      cur: t === themeName(),
    })),
  });
  if (!picked) return say(c.dim('Dibatalkan.'));
  return applyTheme(picked);
}

function showHelp() {
  const width = Math.max(40, (process.stdout.columns || 80) - 1);
  const labels = COMMANDS.map(({ cmd, hint }) => `${cmd}${hint ? ` ${hint}` : ''}`);
  const pad = Math.min(28, Math.max(17, ...labels.map((l) => l.length)));
  const room = Math.max(12, width - pad - 4);
  say(hr(width));
  say(c.bold('Perintah'));
  for (let i = 0; i < COMMANDS.length; i++) {
    const { desc } = COMMANDS[i];
    const text = desc.length > room ? `${desc.slice(0, Math.max(1, room - 1))}…` : desc;
    say(`  ${c.peach(labels[i].padEnd(pad))} ${c.dim(text)}`);
  }
  say(hr(width));
}

function printError(err) {
  if (err.code === 'CONN_LOST') {
    return warn('Koneksi ke provider terputus di tengah jawaban (bukan dari Beot). Coba lagi, naikkan timeout di /setting, atau ganti model lewat /model.');
  }
  if (err.status === 401) return warn('Key ditolak provider (401). Ketik /key untuk ganti.');
  if (err.status === 429) return warn('Kuota/limit provider penuh (429). Tunggu sebentar atau ganti model dengan /model.');
  if (err.status === 404) return warn('Model atau base_url tidak ditemukan (404). Cek /model.');
  if (err.status === 524) {
    return warn('Gateway timeout (524): server provider (Cloudflare/9router) terlalu lama merespons. Coba lagi atau ganti model/combo.');
  }
  if ([502, 503].includes(err.status)) {
    return warn(`Provider sedang tidak tersedia (${err.status}). Coba lagi sebentar atau cek 9router.`);
  }
  if ([520, 521, 522, 523].includes(err.status)) {
    return warn(`Gateway error (${err.status}): origin provider tidak merespons dengan benar. Cek 9router/base_url.`);
  }
  const msg = stripEsc(err.message || String(err));
  if (err.html || /<!DOCTYPE|<html/i.test(msg)) {
    return warn(`Provider mengembalikan halaman HTML (HTTP ${err.status || '?'}) — kemungkinan gateway/proxy. Cek base_url/9router.`);
  }
  if (err.status === 400 && /image|vision|multimodal/i.test(msg)) {
    return warn('Model ini tampaknya tidak mendukung gambar. Ganti ke model vision lewat /model.');
  }
  if (/fetch failed|ENOTFOUND|ECONNREFUSED/i.test(msg)) {
    return warn(`Tidak bisa menghubungi provider. Cek internet atau base_url. (${msg.slice(0, 120)})`);
  }
  return warn(msg.slice(0, 300));
}

async function chooseProvider() {
  const current = findProvider(state.cfg.base_url);
  const id = await ask('Pilih asal API key', {
    select: PROVIDERS.map((p) => ({ label: p.nama, desc: p.catatan, value: p.id, cur: current?.id === p.id })),
  });
  return id ? PROVIDERS.find((p) => p.id === id) || null : null;
}

// Daftar model live dari provider (GET /models), cache 60 dtk per base_url.
async function getLiveModels(force = false) {
  const cfg = state.cfg;
  const { url, time, models } = state.liveModels;
  if (!force && url === cfg.base_url && Date.now() - time < 60_000) return models;
  if (!cfg.api_key && !isLocal(cfg.base_url)) return [];
  let got = [];
  try {
    got = (await fetchModels(cfg.base_url, cfg.api_key)) || [];
  } catch (err) {
    got = url === cfg.base_url ? models : []; // gagal → pakai cache lama bila ada
  }
  state.liveModels = { url: cfg.base_url, time: Date.now(), models: got };
  return got;
}

async function chooseModel(provider) {
  const live = await getLiveModels().catch(() => []);
  const models = mergeModels(state.cfg.model, live, provider.models);
  if (!models.filter((m) => m !== state.cfg.model).length) {
    return (await ask('Nama model', {
      text: {
        label: 'Model >',
        desc: ['Ketik nama model persis seperti yang didukung provider.'],
        validate: (v) => (v.trim() ? '' : 'Nama model tidak boleh kosong'),
      },
    }))?.trim() || null;
  }
  const judul = `Pilih model ${provider.nama.replace(/\s*\(.*\)$/, '')}${live.length ? ` (${live.length} dari provider)` : ''}`;
  const items = models.map((m) => ({
    label: m,
    value: m,
    desc: m === state.cfg.model ? 'aktif' : '',
    cur: m === state.cfg.model,
  }));
  items.push({ label: 'Ketik model sendiri…', desc: 'model yang tidak ada di daftar', value: '__custom__' });
  const picked = await ask(judul, { select: items });
  if (!picked) return null;
  if (picked !== '__custom__') return picked;
  return (await ask('Nama model', {
    text: {
      label: 'Model >',
      desc: ['Ketik nama model persis seperti yang didukung provider.'],
      validate: (v) => (v.trim() ? '' : 'Nama model tidak boleh kosong'),
    },
  }))?.trim() || null;
}

async function handleKey() {
  const provider = await chooseProvider();
  if (!provider) return say(c.dim('Dibatalkan.'));

  let baseUrl = provider.base_url;
  if (provider.id === 'custom') {
    const ans = await ask('base_url', {
      text: {
        label: 'URL >',
        value: baseUrl,
        desc: ['Endpoint OpenAI-compatible. Contoh: http://localhost:11434/v1'],
        validate: (v) => (v.trim() ? '' : 'base_url tidak boleh kosong'),
      },
    });
    if (ans === null) return say(c.dim('Dibatalkan.'));
    baseUrl = ans.trim();
    if (!baseUrl) return say(warn('base_url kosong — dibatalkan.'));
  }

  let apiKey = '';
  if (provider.keyless) {
    say(c.dim(`${provider.nama} tidak butuh API key.`));
  } else {
    const short = provider.nama.replace(/\s*\(.*\)$/, '');
    const desc = [];
    if (provider.id === 'gemini') {
      desc.push('Tempel key-mu di sini. Belum punya? Ambil gratis di aistudio.google.com → Get API key.');
    } else {
      desc.push(`Tempel API key ${short} di sini.`);
    }
    desc.push(`Disimpan lokal di ${CONFIG_PATH}, hanya dikirim ke API ${short}.`);
    const ans = await ask(`API key ${short}`, {
      text: {
        label: 'Key >',
        secret: true,
        desc,
        validate: provider.id === 'custom'
          ? null
          : (v) => (v.trim().length >= 8 ? '' : 'Key kependekan, coba tempel lagi'),
      },
    });
    if (ans === null) return say(c.dim('Dibatalkan.'));
    apiKey = ans.trim();
    if (!apiKey && provider.id !== 'custom') {
      return say(warn('Key kosong — provider tidak diubah.'));
    }
  }

  const model = await chooseModel(provider);
  if (!model) return say(warn('Model tidak dipilih — provider tidak diubah.'));

  state.cfg.base_url = baseUrl;
  state.cfg.api_key = apiKey;
  state.cfg.model = model;
  saveConfig(state.cfg);
  getLiveModels(true).catch(() => {}); // muat ulang daftar untuk provider baru
  say(ok(`Provider: ${c.lav(provider.nama)} · model: ${c.mint(stripEsc(model))}`));
  say(c.dim(`Key/base_url disimpan di ${CONFIG_PATH}`));
  if (!apiKey && !isLocal(baseUrl)) {
    say(warn('Belum ada key — chat akan menunggu sampai /key.'));
  }
}

// Ganti base_url; kalau host berubah, key lama dibuang supaya tidak terkirim ke server baru.
function applyBaseUrl(url) {
  const old = state.cfg.base_url;
  state.cfg.base_url = url;
  let cleared = false;
  if (state.cfg.api_key && hostChanged(old, url)) {
    state.cfg.api_key = '';
    cleared = true;
  }
  saveConfig(state.cfg);
  if (cleared) say(warn('Host berubah — API key lama dihapus. Isi lagi lewat /key.'));
  return cleared;
}

async function handleModel(arg) {
  if (!arg) {
    say(`${c.dim('model')}    ${c.mint(stripEsc(state.cfg.model))}`);
    say(`${c.dim('base_url')} ${c.dim(state.cfg.base_url)}`);
    const provider = findProvider(state.cfg.base_url)
      || { nama: 'Custom', base_url: state.cfg.base_url, models: [] };
    const model = await chooseModel(provider);
    if (!model) return;
    state.cfg.model = model;
    saveConfig(state.cfg);
    return say(ok(`Model: ${c.mint(stripEsc(model))}`));
  }
  if (arg === 'base' || arg.startsWith('base ')) {
    const url = arg.slice(4).trim();
    if (!url) return say(warn('Pakai: /model base <url>. Contoh: /model base http://localhost:11434/v1'));
    if (!/^https?:\/\/\S+$/i.test(url)) return say(warn('base_url harus diawali http:// atau https://'));
    applyBaseUrl(url);
    return say(ok(`base_url: ${state.cfg.base_url}`));
  }
  state.cfg.model = arg;
  saveConfig(state.cfg);
  say(ok(`Model: ${c.mint(stripEsc(arg))}`));
}

async function handlePersona(arg) {
  if (!arg) {
    const chosen = await ask('Pilih persona', {
      select: state.personas.map((p) => ({
        label: p.nama,
        desc: p.deskripsi,
        value: p.nama,
        cur: p.nama === state.persona?.nama,
      })),
    });
    if (!chosen) return;
    arg = chosen;
  }
  const chosen = state.personas.find((p) => p.nama === arg);
  if (!chosen) return say(warn(`Persona "${arg}" tidak ada. Ketik /persona untuk lihat daftar.`));
  state.persona = chosen;
  state.cfg.persona = chosen.nama;
  saveConfig(state.cfg);
  say(ok(`Persona aktif: ${c.lav(chosen.nama)}`));
}

async function handleSkill(arg) {
  const skills = loadSkills(state.cwd);
  if (!arg) {
    // Mode pipe/tanpa TTY: tampilkan daftar (picker tidak tersedia).
    if (!(process.stdin.isTTY && process.stdout.isTTY)) {
      say(c.bold(`Skill (${skills.length})`));
      for (const s of skills) {
        const active = s.nama === state.skill?.nama ? c.gold(' ← aktif') : '';
        say(`  ${c.lav(s.nama)} ${c.dim(`— ${s.deskripsi}`)}${active}`);
      }
      say(c.dim('  tambah: ~/.beot/skills/*.md atau .beot/skills/*.md (proyek)'));
      return;
    }
    const items = [
      { label: '(tanpa skill)', desc: 'matikan skill', value: '__none__', cur: !state.skill },
      ...skills.map((s) => ({
        label: s.nama,
        desc: s.deskripsi,
        value: s.nama,
        cur: s.nama === state.skill?.nama,
      })),
    ];
    const picked = await ask('Pilih skill', { select: items });
    if (!picked) return; // Esc = batal
    if (picked === '__none__') {
      state.skill = null;
      return say(ok('Skill dimatikan.'));
    }
    arg = picked;
  }
  if (arg === 'lepas' || arg === 'off' || arg === 'none') {
    state.skill = null;
    return say(ok('Skill dimatikan.'));
  }
  const found = skills.find((s) => s.nama === arg);
  if (!found) return say(warn(`Skill "${arg}" tidak ada. Ketik /skill untuk lihat daftar.`));
  state.skill = found;
  say(ok(`Skill aktif: ${c.lav(found.nama)}`));
}

function handleReload() {
  const prev = { ...state.cfg };
  const saved = loadConfig();
  state.cfg = saved || { ...DEFAULTS };
  state.personas = loadPersonas();
  state.persona = state.personas.find((p) => p.nama === state.cfg.persona) || state.personas[0] || state.persona;
  state.skill = null;
  const skills = loadSkills(state.cwd);
  const changed = [];
  if (prev.base_url !== state.cfg.base_url) changed.push(`base_url → ${state.cfg.base_url}`);
  if (prev.model !== state.cfg.model) changed.push(`model → ${state.cfg.model}`);
  if (prev.api_key !== state.cfg.api_key) changed.push(`api_key → ${state.cfg.api_key ? 'terisi' : 'kosong'}`);
  if (prev.persona !== state.cfg.persona) changed.push(`persona → ${state.cfg.persona}`);
  say(ok(changed.length ? `Config dimuat ulang: ${changed.join(' · ')}` : 'Config dimuat ulang (tidak ada perubahan).'));
  const custom = loadThemeFile();
  const reg = custom ? registerThemes(custom) : { added: 0, skipped: 0 };
  setTheme(state.cfg.theme || 'default');
  setStatus(composerStatus);
  say(c.dim(`${state.personas.length} persona · ${skills.length} skill · ${themeNames().length} tema${reg.added ? ` (+${reg.added} kustom)` : ''}${reg.skipped ? ` · ${reg.skipped} tema dilewati` : ''}`));
}

async function handleSetting() {
  const mask = state.cfg.api_key
    ? `${state.cfg.api_key.slice(0, 6)}…${state.cfg.api_key.slice(-4)}`
    : '(kosong)';
  say(c.bold('Pengaturan'));
  say(`  ${c.dim('base_url')} ${c.mint(stripEsc(state.cfg.base_url))}`);
  say(`  ${c.dim('model')}    ${c.mint(stripEsc(state.cfg.model))}`);
  say(`  ${c.dim('api_key')}  ${state.cfg.api_key ? c.mint(mask) : c.dim('(kosong)')}`);
  say(`  ${c.dim('persona')}  ${c.lav(state.cfg.persona)}`);
  say(`  ${c.dim('timeout')}  ${c.mint(`${Number(state.cfg.stream_timeout) || 90} dtk`)}`);
  say(`  ${c.dim('tulis')}    ${c.mint(state.cfg.write_confirm === false ? 'langsung' : 'konfirmasi')}`);
  say(`  ${c.dim('path luar')} ${c.mint(state.cfg.external === 'trust' ? 'izin otomatis' : 'tanya')}`);
  say(`  ${c.dim('file')}     ${c.dim(CONFIG_PATH)}`);
  say('');

  const pilih = await ask('Ubah apa', {
    select: [
      { label: 'base_url', desc: 'endpoint provider', value: 'base_url' },
      { label: 'model', desc: 'nama model / combo', value: 'model' },
      { label: 'API key', desc: 'ganti kunci', value: 'api_key' },
      { label: 'persona', desc: 'ganti karakter bot', value: 'persona' },
      { label: 'timeout stream', desc: 'detik diam sebelum ulang (default 90)', value: 'stream_timeout' },
      { label: 'konfirmasi tulis', desc: state.cfg.write_confirm === false ? 'sekarang: langsung simpan' : 'sekarang: tanya dulu', value: 'write_confirm' },
      { label: 'izin path luar', desc: state.cfg.external === 'trust' ? 'sekarang: izin otomatis' : 'sekarang: tanya dulu', value: 'external' },
      { label: 'izin shell', desc: state.cfg.shell === 'allow' ? 'sekarang: jalankan otomatis' : state.cfg.shell === 'deny' ? 'sekarang: dimatikan' : 'sekarang: tanya dulu', value: 'shell' },
      { label: 'izin web', desc: state.cfg.web === 'allow' ? 'sekarang: unduh otomatis' : state.cfg.web === 'deny' ? 'sekarang: dimatikan' : 'sekarang: tanya dulu', value: 'web' },
      { label: 'Buka file config', desc: 'edit manual di editor', value: 'file' },
    ],
  });
  if (!pilih) return;

  if (pilih === 'file') {
    const { spawn } = await import('node:child_process');
    const child = spawn('notepad.exe', [CONFIG_PATH], { detached: true, stdio: 'ignore' });
    child.unref();
    return say(c.dim('Config dibuka di Notepad. Pakai /reload setelah save.'));
  }

  if (pilih === 'persona') {
    const answer = await ask('Pilih persona', {
      select: state.personas.map((p) => ({
        label: p.nama,
        desc: p.deskripsi,
        value: p.nama,
        cur: p.nama === state.persona?.nama,
      })),
    });
    if (!answer) return;
    const chosen = state.personas.find((p) => p.nama === answer);
    if (!chosen) return say(warn(`Persona "${answer}" tidak ada.`));
    state.persona = chosen;
    state.cfg.persona = chosen.nama;
    saveConfig(state.cfg);
    return say(ok(`Persona aktif: ${c.lav(chosen.nama)}`));
  }

  if (pilih === 'write_confirm') {
    const answer = await ask('Konfirmasi sebelum menulis?', {
      select: [
        { label: 'Tanya dulu', desc: 'muncul ? Simpan <nama>? · enter=ya · esc=batal', value: 'yes' },
        { label: 'Langsung simpan', desc: 'tanpa prompt, diff tetap tampil', value: 'no' },
      ],
    });
    if (!answer) return;
    state.cfg.write_confirm = answer === 'yes';
    saveConfig(state.cfg);
    return say(ok(state.cfg.write_confirm ? 'Konfirmasi tulis: tanya dulu' : 'Konfirmasi tulis: langsung simpan'));
  }

  if (pilih === 'external') {
    const answer = await ask('Akses path di luar folder?', {
      select: [
        { label: 'Tanya dulu', desc: 'modal Izinkan akses? per path', value: 'no' },
        { label: 'Izin otomatis', desc: 'langsung izinkan tanpa modal', value: 'yes' },
      ],
    });
    if (!answer) return;
    state.cfg.external = answer === 'yes' ? 'trust' : 'ask';
    saveConfig(state.cfg);
    return say(ok(`Path luar: ${state.cfg.external === 'trust' ? 'izin otomatis' : 'tanya dulu'}`));
  }

  if (pilih === 'shell') {
    const answer = await ask('Jalankan perintah shell?', {
      select: [
        { label: 'Tanya dulu', desc: 'y/n setiap perintah', value: 'ask' },
        { label: 'Izinkan otomatis', desc: 'langsung jalan (daftar tolak-keras tetap berlaku)', value: 'allow' },
        { label: 'Matikan', desc: 'tool bash tidak dikirim ke model', value: 'deny' },
      ],
    });
    if (!answer) return;
    state.cfg.shell = answer;
    saveConfig(state.cfg);
    return say(ok(`Shell: ${answer}`));
  }

  if (pilih === 'web') {
    const answer = await ask('Unduh halaman web?', {
      select: [
        { label: 'Tanya dulu', desc: 'y/n setiap URL', value: 'ask' },
        { label: 'Izinkan otomatis', desc: 'hanya URL publik (localhost/privat diblokir)', value: 'allow' },
        { label: 'Matikan', desc: 'tool web_fetch tidak dikirim ke model', value: 'deny' },
      ],
    });
    if (!answer) return;
    state.cfg.web = answer;
    saveConfig(state.cfg);
    return say(ok(`Web: ${answer}`));
  }

  if (pilih === 'stream_timeout') {
    const answer = await ask('Timeout stream (detik)', {
      text: {
        label: 'Detik >',
        desc: ['Diam berapa lama sebelum request diulang. 30–300 dtk.'],
        value: String(Number(state.cfg.stream_timeout) || 90),
        validate: (v) => {
          const n = Number(v);
          return Number.isFinite(n) && n >= 5 && n <= 600 ? '' : 'Isi angka 5–600';
        },
      },
    });
    if (answer === null) return say(c.dim('Dibatalkan.'));
    state.cfg.stream_timeout = Number(answer);
    saveConfig(state.cfg);
    return say(ok(`Timeout stream: ${c.mint(`${state.cfg.stream_timeout} dtk`)}`));
  }

  if (pilih === 'base_url') {
    const ans = await ask('base_url', {
      text: {
        label: 'URL >',
        desc: ['Endpoint OpenAI-compatible, mis. http://localhost:11434/v1'],
        value: state.cfg.base_url,
        validate: (v) => (/^https?:\/\/\S+$/i.test(v.trim()) ? '' : 'Harus diawali http:// atau https://'),
      },
    });
    if (ans === null) return say(c.dim('Dibatalkan.'));
    applyBaseUrl(ans.trim());
    return say(ok(`base_url → ${c.mint(stripEsc(state.cfg.base_url))}`));
  }
  const labels = { model: 'model', api_key: 'API key' };
  const secret = pilih === 'api_key';
  const tips = {
    model: ['Nama model atau combo persis seperti yang didukung provider.'],
    api_key: [`Disimpan lokal di ${CONFIG_PATH}, hanya dikirim ke provider.`],
  };
  const ans = await ask(labels[pilih], {
    text: {
      label: `${pilih === 'api_key' ? 'Key' : 'Nilai'} >`,
      secret,
      desc: tips[pilih],
      value: secret ? '' : state.cfg[pilih],
      validate: (v) => (v.trim() ? '' : 'Tidak boleh kosong'),
    },
  });
  if (ans === null) return say(c.dim('Dibatalkan.'));
  const value = ans.trim();
  if (!value) return say(warn('Kosong — tidak diubah.'));
  state.cfg[pilih] = value;
  saveConfig(state.cfg);
  say(ok(`${labels[pilih]} → ${secret ? c.mint('***') : c.mint(value)}`));
}

async function handleTugas(arg) {
  if (!arg) return say(warn('Pakai: /tugas <path file>. Contoh: /tugas "C:\\Users\\me\\Documents\\bab1.md"'));
  const clean = arg.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1').trim();
  try {
    const doc = await readDoc(clean);
    state.file = doc;
    const size = `${(doc.bytes / 1024).toFixed(1)} kB`;
    say(ok(`📄 ${doc.nama} — ${size}, ${doc.kind}${doc.truncated ? c.maroon(' (dipotong ke batas aman)') : ''}`));
    if (doc.truncated) say(c.dim('File kepanjangan, hanya bagian awal yang dipakai. Untuk dokumen besar, panggil per-bab.'));
  } catch (err) {
    state.file = null;
    say(warn(err.message));
  }
}

async function confirmOutside(abs) {
  if (state.headless) return false;
  if (state.cfg.external === 'trust') {
    if (!state.extraDirs.includes(abs)) state.extraDirs.push(abs);
    say(c.dim(`  izin otomatis: ${stripEsc(abs)}`));
    return true;
  }
  const ans = await ask('Izinkan akses?', {
    select: [
      { label: 'Izinkan', desc: abs, value: 'yes' },
      { label: 'Tolak', desc: 'path tetap diblokir', value: 'no' },
    ],
  });
  if (ans !== 'yes') return false;
  if (!state.extraDirs.includes(abs)) state.extraDirs.push(abs);
  setStatus(composerStatus);
  say(ok(`Akses diizinkan: ${abs}`));
  return true;
}

async function confirmWrite(rel, content, oldText) {
  if (state.headless) return false;
  const safeRel = stripEsc(rel);
  const lines = content ? content.split('\n').length : 0;
  let stat = `${lines} baris`;
  if (oldText !== undefined) {
    const d = oldText === null ? buildNewFileDiff(content) : buildDiff(oldText, content);
    stat = oldText === null ? `file baru · ${d.added} baris` : `+${d.added} −${d.removed}`;
    if (d.lines.length) {
      say('');
      const head = oldText === null ? `baru  +${d.added}` : `ubah  +${d.added}${d.removed ? ` −${d.removed}` : ''}`;
      diffBlock(d.lines, `${safeRel}  ${head}`);
      if (d.truncated) say(c.dim('  … diff dipotong (file besar)'));
    }
  }
  if (state.cfg.write_confirm === false) return true;
  return confirmInline(`Simpan ${safeRel}?  ${stat}`);
}

let fileCache = { at: 0, items: [] };

function fileListCached() {
  if (Date.now() - fileCache.at < 10_000 && fileCache.items.length) return fileCache.items;
  const items = [];
  const walk = (dir) => {
    if (items.length >= 1200) return;
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (items.length >= 1200) break;
      if (e.isDirectory()) {
        if (['.git', 'node_modules'].includes(e.name) || e.name.startsWith('.')) continue;
        walk(path.join(dir, e.name));
      } else if (e.isFile()) {
        items.push(path.relative(state.cwd, path.join(dir, e.name)).split(path.sep).join('/'));
      }
    }
  };
  walk(state.cwd);
  fileCache = { at: Date.now(), items };
  return items;
}

function registerFileSuggest() {
  setFileSuggest((token) => {
    const q = String(token || '').toLowerCase();
    const all = fileListCached();
    const hit = q ? all.filter((p) => p.toLowerCase().includes(q)) : all;
    return hit.slice(0, 40).map((p) => ({ cmd: p, desc: '' }));
  });
}

function trimHistory() {
  const budget = Math.floor(CONTEXT_WINDOW * 0.7);
  let removed = 0;
  while (state.history.length > 2 && estTokens() > budget) {
    state.history.shift();
    removed += 1;
  }
  return removed;
}

function ensureSession() {
  if (state.headless) return null;
  if (!state.sessionFile) {
    state.sessionFile = initSession(state.cwd, { model: state.cfg.model, persona: state.cfg.persona });
  }
  return state.sessionFile;
}

async function confirmShell(cmd) {
  const short = cmd.length > 62 ? `${cmd.slice(0, 59)}…` : cmd;
  return confirmInline(`Jalankan: ${stripEsc(short)}`);
}

async function confirmFetch(host) {
  return confirmInline(`Unduh ${stripEsc(host)}?`);
}

async function compactHistory() {
  if (state.history.length < 4) return say(warn('Riwayat masih pendek — compact belum perlu.'));
  const before = state.history.length;
  startLoading('Merangkum');
  try {
    const sum = await summarize({
      history: state.history,
      baseUrl: state.cfg.base_url,
      apiKey: state.cfg.api_key,
      model: state.cfg.model,
      idleMs: (Number(state.cfg.stream_timeout) || 90) * 1000,
    });
    if (!sum) throw new Error('ringkasan kosong');
    state.history = compactedHistory(sum);
    state.tokens = 0;
    state.autoCompacted = true;
    say(ledgerLine('ringkas riwayat', `${c.mint('✓')} ${c.dim(`${before} → 1 pesan`)}`));
  } catch (err) {
    say(warn(`Compact gagal: ${err.message}. Riwayat lama dipertahankan.`));
  } finally {
    stopLoading();
  }
}

async function runTool(call, planning) {
  const name = call.function.name;
  const raw = call.function.arguments;
  const opts = { cwd: state.cwd, extras: state.extraDirs, confirmWrite, allowWrite: !planning, onOutside: confirmOutside };
  try {
    if (name === 'skill') return runSkillTool(name, raw, null, state.cwd);
    if (name === 'todo_write') {
      const res = runTodoTool(JSON.parse(raw || '{}'));
      setTodos(res.todos);
      return res;
    }
    if (name === 'bash') {
      let args = {};
      try { args = JSON.parse(raw || '{}'); } catch { /* biar tool yang melaporkan */ }
      return await runShellTool(args, { ...opts, planning, shellMode: state.cfg.shell, confirmShell });
    }
    if (name === 'web_fetch') {
      let args = {};
      try { args = JSON.parse(raw || '{}'); } catch { /* biar tool yang melaporkan */ }
      return await runWebTool(args, { webMode: state.cfg.web, confirmFetch });
    }
    if (EXPORT_NAMES.has(name)) return runExportTool(name, raw, opts);
    return runFileTool(name, raw, opts);
  } catch (err) {
    return { error: err.message };
  }
}

async function chat(userText, attachment = null) {
  state.lastTools = [];
  state.lastError = null;
  if (!state.cfg.api_key && !isLocal(state.cfg.base_url)) {
    state.lastError = new Error('API key belum ada. Isi lewat /key atau config.json.');
    return say(warn('API key belum ada. Ketik /key dulu, atau pakai Ollama lokal lewat /model base.'));
  }
  const trimmed = trimHistory();
  if (trimmed) say(c.dim(`  ⟳ riwayat dipangkas: ${trimmed} pesan lama dibuang (mode >70% context window)`));
  const picked = takeAtFiles().slice(0, 5);
  let atText = '';
  for (const p of picked) {
    try {
      const doc = await readDoc(path.resolve(state.cwd, p));
      atText += `\n\n[FILE @${p}]\n${doc.text.slice(0, 40000)}`;
    } catch (err) {
      say(warn(`@${p} tidak bisa dibaca: ${err.message}`));
    }
  }
  const baseText = userText || (attachment?.type === 'doc' ? '' : 'Jelaskan gambar ini.');
  state.history.push({
    role: 'user',
    content: userContent(baseText + atText, attachment),
  });
  appendTurn(ensureSession(), { role: 'user', content: baseText + atText });
  if (!state.autoCompacted && contextPct(state.tokens) >= 85 && state.history.length > 6) {
    state.autoCompacted = true; // sekali per sesi, walau gagal
    await compactHistory();
  }
  state.busy = true;
  say('');
  write(botPrefix());

  const t0 = Date.now();
  const controller = new AbortController();
  beginInterrupt(() => controller.abort());
  let text = '';
  const usedSkills = [];
  startLoading('Memikir');
  try {
    const messages = [{ role: 'system', content: systemPrompt() }, ...state.history];
    const planning = state.persona?.nama === 'plan';
    const fileTools = buildFileTools().filter((t) => !(planning && ['write_file', 'edit_file'].includes(t.function.name)));
    // Tool file read-only di mode plan; teks skill manual sudah ada di system prompt.
    let tools = [...fileTools, ...buildSearchTools(), ...(planning ? [] : buildExportTools()), ...buildTodoTool(), ...(state.cfg.shell === 'deny' ? [] : buildShellTool()), ...(state.cfg.web === 'deny' ? [] : buildWebTool()), ...(state.skill ? [] : buildSkillTools())];
    let final = null;
    let retries = 0;
    let emptyRetries = 0;
    let reported = null;
    const doneCalls = new Set();
    let dupCount = 0;
    const printedNotes = new Map();

    for (let step = 0; step < 16; step++) {
      const mark = markLog();
      const textBefore = text.length;
      let result;
      try {
        result = await streamChat({
          baseUrl: state.cfg.base_url,
          apiKey: state.cfg.api_key,
          model: state.cfg.model,
          messages,
          tools,
          temperature: state.persona?.suhu ?? 0.7,
          signal: controller.signal,
          idleMs: (Number(state.cfg.stream_timeout) || 90) * 1000,
          onToken: (delta) => {
            text += delta;
            write(delta);
          },
          onToolDelta: (name, len) => {
            toolProgress(name ? `✎ ${name} · ${len} kar` : `✎ menyiapkan tool · ${len} kar`);
          },
          onThoughtEnd: (reasoning, ms) => {
            if (state.headless || state.cfg.thinking === false) return;
            thoughtBlock(ms, reasoning);
          },
        });
      } catch (err) {
        // Provider tidak mendukung tool calling: ulangi sekali tanpa tools.
        if (tools && step === 0 && [400, 404, 422].includes(err.status)) {
          tools = null;
          continue;
        }
        // Provider diam / koneksi putus: ulangi sekali dari awal round ini.
        if ((err.code === 'STREAM_TIMEOUT' || err.code === 'CONN_LOST') && retries < 1) {
          retries += 1;
          rollbackLog(mark);
          text = text.slice(0, textBefore);
          say(c.dim(err.code === 'CONN_LOST' ? '  ↻ ulang karena koneksi terputus…' : '  ↻ ulang karena stream timeout…'));
          startLoading('Ulang');
          continue;
        }
        throw err;
      }

      if (result.reported) reported = result.reported;
      if (!result.toolCalls || !result.toolCalls.length) {
        // Provider diam total (tanpa teks, thought, atau tool): coba sekali lagi sebelum menyerah.
        if (!result.text && !result.reasoning && emptyRetries < 1) {
          emptyRetries += 1;
          rollbackLog(mark);
          text = text.slice(0, textBefore);
          startLoading('Ulang');
          continue;
        }
        final = result;
        break;
      }

      state.session.requests += 1;
      const roundTotal = usageTotal(result.usage);
      if (roundTotal != null) state.session.tokens += roundTotal;

      const calls = result.toolCalls.map((c, i) => ({
        id: c.id || `call_${step}_${i}`,
        type: c.type || 'function',
        function: {
          name: c.function?.name || '',
          arguments: typeof c.function?.arguments === 'string'
            ? c.function.arguments
            : JSON.stringify(c.function?.arguments || {}),
        },
      }));
      messages.push({
        role: 'assistant',
        content: result.text || null,
        tool_calls: calls,
      });
      if (result.toolCalls.some((x) => x.function?.name === 'skill')) say(ledgerLine('memuat skill', c.dim('…')));
      const roundNotes = new Map();
      for (let i = 0; i < calls.length; i++) {
        const call = calls[i];
        stopLoading();
        const tCall = Date.now();
        const sig = `${call.function.name} ${call.function.arguments}`;
        let res;
        if (doneCalls.has(sig)) {
          dupCount += 1;
          res = { content: 'SUDAH DIEKSEKUSI SEBELUMNYA dan tidak ada perubahan. JANGAN ulangi panggilan ini; lanjutkan langkah lain atau selesaikan dengan teks.' };
          if (dupCount >= 2) {
            messages.push({ role: 'tool', tool_call_id: call.id, content: res.content });
            say(warn('  Model mengulang langkah yang sama — dihentikan.'));
            final = { text, usage: null, toolCalls: [], reported };
            break;
          }
        } else {
          doneCalls.add(sig);
          res = await runTool(call, planning);
        }
        if (res.skill) usedSkills.push(res.skill);
        state.lastTools.push({ name: call.function.name, ok: !res.error });
        const took = fmtDuration(Date.now() - tCall);
        if (res.error) say(`${c.maroon('✗')} ${stripEsc(call.function.name)} · ${stripEsc(res.error)}`);
        else if (res.note) {
          const n = (roundNotes.get(res.note) || 0) + 1;
          roundNotes.set(res.note, n);
          if (n === 1) say(ledgerLine(stripEsc(res.note), `${c.mint('✓')} ${c.dim(took)}`));
        }
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: res.content || res.error || 'error',
        });
        startLoading('Lanjut');
      }
      for (const [note, n] of roundNotes) {
        if (n > 1) say(ledgerLine(`${n}× ${stripEsc(note)}`, c.dim('diulang')));
      }
      if (final) break;
      // Teks antar-round tool: beri baris baru supaya tidak menempel ke kalimat berikutnya.
      if (text && !text.endsWith('\n')) {
        write('\n');
        text += '\n';
      }
    }

    if (!final) {
      say(warn('Batas langkah tool (16) tercapai. Ketik "lanjutkan" untuk meneruskan pekerjaan.'));
      final = { text: text || '', usage: null, toolCalls: [] };
    }

    write('\n');
    if (usedSkills.length) say(ledgerLine('skill', c.dim([...new Set(usedSkills)].join(', '))));
    const answerText = final.text || text;
    if (!answerText.trim()) {
      say(warn('Provider tidak mengirim jawaban (kosong). Coba lagi.'));
    } else {
      state.history.push({ role: 'assistant', content: answerText });
      appendTurn(state.sessionFile, { role: 'assistant', content: answerText });
    }
    const u = final.usage || {};
    const total = usageTotal(u) ?? estTokens();
    state.last = {
      total,
      prompt: Number.isFinite(u.prompt_tokens) ? u.prompt_tokens : null,
      completion: Number.isFinite(u.completion_tokens) ? u.completion_tokens : null,
      estimated: usageTotal(u) === null,
      reported: (final.reported || reported) || null,
    };
    state.tokens = total;
    const spent = costOf({ model: state.cfg.model, prompt: state.last.prompt, completion: state.last.completion });
    state.last.cost = spent;
    if (spent != null) state.session.cost += spent;
    state.session.requests += 1;
    if (usageTotal(u) != null) state.session.tokens += usageTotal(u);
    if (Date.now() - t0 > 15000) bell();
  } catch (err) {
    write('\n');
    state.history.pop(); // pesan user yang gagal jangan mengotori konteks berikutnya
    state.lastError = err;
    if (err.name === 'AbortError') say(warn('Dihentikan.'));
    else say(printError(err));
  } finally {
    endInterrupt();
    stopLoading();
    state.busy = false;
    say('');
  }
}

function handleCost() {
  const width = Math.max(40, (process.stdout.columns || 80) - 2);
  const price = priceFor(state.cfg.model);
  say(c.bold('Biaya (perkiraan)'));
  say(ledgerLine('model', c.mint(stripEsc(state.cfg.model)), width));
  if (!price) {
    say(c.dim('  harga model ini belum ada di tabel — token tetap dihitung di /status.'));
    return;
  }
  say(ledgerLine('tarif', c.dim(`$${price.input}/1M masuk · $${price.output}/1M keluar`), width));
  const last = state.last.cost != null ? c.mint(fmtUsd(state.last.cost)) : c.dim('-');
  say(ledgerLine('request', `${last} ${c.dim(`${state.last.prompt ?? 0} masuk · ${state.last.completion ?? 0} keluar`)}`, width));
  say(ledgerLine('sesi', `${c.gold(fmtUsd(state.session.cost))} ${c.dim(`${fmtK(state.session.tokens)} token · ${state.session.requests} request`)}`, width));
  say(c.dim('  perkiraan dari harga publik, bukan tagihan resmi.'));
}

function handleInit(arg) {
  const file = projectMemory(state.cwd);
  if (fs.existsSync(file) && arg !== '--force') {
    return say(warn('BEOT.md sudah ada. Pakai /init --force untuk menimpa, atau edit langsung.'));
  }
  const text = buildInitMemory(state.cwd);
  fs.writeFileSync(file, text);
  const lines = text.split('\n').filter((l) => l.trim() && !l.startsWith('#')).length;
  say(ok(`Memori proyek dibuat: BEOT.md (${lines} baris)`));
  say(c.dim('  Edit file itu untuk menambah aturan; otomatis dibaca tiap request.'));
}

function handleIngat(arg) {
  const global = /^--global(\s|$)/i.test(arg);
  const text = arg.replace(/^--global\s*/i, '').trim();
  if (!text) return say(warn('Pakai: /ingat [--global] <fakta singkat>. Contoh: /ingat tes pakai npm test'));
  try {
    const res = appendMemory(text, { cwd: state.cwd, global });
    if (res.added) return say(ok(`Diingat (${global ? 'global' : 'proyek'}): ${text}`));
    return say(c.dim('Sudah ada di BEOT.md.'));
  } catch (err) {
    return say(warn(err.message));
  }
}

async function handleSessions() {
  const rows = listSessions(state.cwd, 10);
  if (!rows.length) return say(c.dim('Belum ada sesi tersimpan untuk folder ini.'));
  const items = rows.map((r) => ({
    label: r.name,
    desc: `${r.meta?.model || '?'} · ${new Date(r.meta?.at || 0).toLocaleString('id-ID')}`,
    value: r.file,
  }));
  const pick = await ask('Lanjutkan sesi', { select: items });
  if (!pick) return;
  state.history = readSession(pick).history.slice(-40);
  state.sessionFile = pick;
  state.tokens = 0;
  setTodos([]);
  clearLog();
  renderBanner();
  say(ok(`Sesi dimuat · ${state.history.length} pesan`));
}

function parseArgs(argv) {
  const out = { dir: null, cont: false, resume: false, help: false, version: false, prompt: null, format: 'text' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--version' || a === '-v') out.version = true;
    else if (a === '--continue') out.cont = true;
    else if (a === '--resume') out.resume = true;
    else if (a === '-p' || a === '--print') out.prompt = argv[++i] ?? '';
    else if (a === '--output-format') out.format = argv[++i] || 'text';
    else if (a.startsWith('--output-format=')) out.format = a.slice(16);
    else if (!a.startsWith('-') && !out.dir) out.dir = a;
  }
  return out;
}

async function runHeadless(prompt, format) {
  if (!prompt || !prompt.trim()) {
    process.stderr.write('Prompt kosong. Pakai: beot -p "pertanyaanmu"\n');
    process.exitCode = 2;
    return;
  }
  await chat(prompt);
  const answer = [...state.history].reverse().find((m) => m.role === 'assistant' && typeof m.content === 'string');
  const text = answer ? answer.content : '';
  const errText = state.lastError ? String(state.lastError.message || state.lastError) : null;
  if (format === 'json') {
    process.stdout.write(`${JSON.stringify({
      text,
      model: state.cfg.model,
      tokens: state.last.total || 0,
      toolCalls: state.lastTools,
      error: errText,
    }, null, 2)}\n`);
  } else if (text) {
    process.stdout.write(`${text}\n`);
  }
  if (!text) {
    process.stderr.write(`beot: ${errText || 'provider tidak mengirim jawaban.'}\n`);
    process.exitCode = 1;
  }
}

function printUsage() {
  process.stdout.write([
    'beot — chat AI di terminal (BYOK, nol server)',
    '',
    'Pakai:',
    '  beot [folder]             mulai di folder itu',
    '  beot --continue           lanjut sesi terakhir di folder ini',
    '  beot --resume             pilih sesi tersimpan',
    '  beot -p "<prompt>"        mode non-interaktif: jawab lalu keluar',
    '  beot -p "<prompt>" --output-format json',
    '  beot --version            cetak versi',
    '  beot --help               bantuan ini',
    '',
    'Headless hanya mengizinkan tool baca (tulis/shell/web butuh izin → ditolak).',
    'Di dalam app: / untuk menu, Shift+Tab ganti persona, Esc hentikan jawaban.',
    '',
  ].join('\n'));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.version) {
    process.stdout.write('beot 0.1.0\n');
    return;
  }
  if (args.help) {
    printUsage();
    return;
  }
  setPlain(!(process.stdin.isTTY && process.stdout.isTTY));
  state.headless = args.prompt != null;
  state.silent = state.headless;
  tuiInit();
  const migrated = migrateLegacy();
  registerFileSuggest();
  const startDir = args.dir;
  if (startDir) {
    const target = path.resolve(startDir);
    if (fs.existsSync(target) && fs.statSync(target).isDirectory()) state.cwd = target;
    else say(warn(`Folder tidak ditemukan: ${target} (pakai folder sekarang).`));
  }
  ensureBundledSkills();
  state.personas = loadPersonas();
  if (!state.personas.length) {
    say(warn('Folder personas/ kosong atau rusak. Pakai prompt bawaan.'));
    state.persona = { nama: 'default', system_prompt: 'Kamu asisten yang membantu.', suhu: 0.7 };
  }

  const saved = loadConfig();
  if (!saved) {
    state.cfg = { ...DEFAULTS };
  } else {
    state.cfg = saved;
  }
  setTheme('default');
  const customThemes = loadThemeFile();
  if (customThemes) registerThemes(customThemes);
  setTheme(state.cfg.theme || 'default');

  state.persona = state.personas.find((p) => p.nama === state.cfg.persona) || state.personas[0];
  // Config lama bisa menunjuk persona yang sudah tidak ada: ikuti persona aktif tanpa mengubah file.
  if (state.persona) state.cfg.persona = state.persona.nama;
  setTitle(`Beot · ${state.persona?.nama || 'build'}`);
  if (!state.headless) getLiveModels().catch(() => {}); // daftar provider di latar, picker tak nunggu
  pruneSessions();
  if (!state.headless && (args.cont || args.resume)) {
    const last = latestSession(state.cwd);
    if (last) {
      state.history = readSession(last.file).history.slice(-40);
      state.sessionFile = last.file;
    }
  }

  const notes = [];
  if (state.sessionFile) notes.push(`↺ lanjut sesi · ${state.history.length} pesan`);
  const projectSkillDir = path.join(state.cwd, '.beot', 'skills');
  const sameDir = (a, b) => (process.platform === 'win32'
    ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
    : path.resolve(a) === path.resolve(b));
  // Saat cwd = folder home, folder skill "proyek" sama dengan folder skill user: jangan dihitung dua kali.
  const projectSkills = sameDir(projectSkillDir, SKILLS_DIR) ? [] : loadSkillsFrom(projectSkillDir);
  if (projectSkills.length) notes.push(`skill proyek: ${projectSkills.length} dari .beot/skills`);
  const mem = readMemoryFiles(state.cwd);
  if (mem.length) {
    const total = mem.reduce((n, m) => n + m.text.split('\n').filter((l) => l.trim()).length, 0);
    notes.push(`memori: ${mem.map((m) => m.label).join(' + ')} (${total} baris)`);
  }
  if (migrated) notes.push('✓ data lama dipindah: ~/.byok-chat → ~/.beot');
  if (!state.cfg.api_key && !isLocal(state.cfg.base_url)) {
    notes.push('API key belum ada — isi lewat /key kapan saja.');
  }

  if (splashActive()) {
    setSplashNote(notes.join('\n'));
  } else {
    say('');
    renderBanner();
    for (const n of notes) say(c.dim(`  ${n}`));
    say('');
  }

  setStatus(composerStatus);
  if (state.headless) {
    await runHeadless(args.prompt, args.format);
    return;
  }
  if (args.resume && process.stdin.isTTY) await handleSessions();

  for (;;) {
    const answer = await ask(userPrompt(), { menu: COMMANDS, onShiftTab: cyclePersona });
    const attachment = takeAttachment();
    if (answer === null) break; // Ctrl+D / EOF
    const line = answer.trim();
    if (!line && !attachment) continue;
    if (line === '/exit' || line === '/quit') break;

    const [cmd, ...rest] = line.split(' ');
    const arg = rest.join(' ').trim();

    if (line.startsWith('/')) {
      switch (cmd) {
        case '/persona': await handlePersona(arg); break;
        case '/skill': await handleSkill(arg); break;
        case '/files': await handleFiles(); break;
        case '/tugas': await handleTugas(arg); break;
        case '/cd': handleCd(arg); break;
        case '/add-dir': handleAddDir(arg); break;
        case '/key': await handleKey(); break;
        case '/model': await handleModel(arg); break;
        case '/clear':
          state.history = [];
          state.file = null;
          state.tokens = 0;
          state.sessionFile = null;
          setTodos([]);
          clearLog();
          say('');
          renderBanner();
          say(ok('Riwayat dan file dibersihkan.'));
          break;
        case '/reload': handleReload(); break;
        case '/compact': await compactHistory(); break;
        case '/sessions': await handleSessions(); break;
        case '/init': handleInit(arg); break;
        case '/ingat': handleIngat(arg); break;
        case '/setting': await handleSetting(); break;
        case '/status': handleStatus(); break;
        case '/cost': handleCost(); break;
        case '/theme': await handleTheme(arg); break;
        case '/thinking':
          state.cfg.thinking = state.cfg.thinking === false;
          saveConfig(state.cfg);
          say(ok(`Thinking ${state.cfg.thinking === false ? 'off' : 'on'}.`));
          break;
        case '/thought': {
          say(warn('Sudah diganti: klik baris `✻ thought` di transkrip untuk buka/tutup isi.'));
          break;
        }
        case '/bantu': showHelp(); break;
        default: say(warn(`Perintah "${cmd}" tidak dikenal. Ketik /bantu.`));
      }
      continue;
    }

    await chat(line, attachment);
  }

  shutdown(c.dim('Sampai jumpa.'));
  // Pastikan proses benar-benar keluar walau ada socket/stream yang tertinggal.
  if (process.stdout.isTTY) process.exit(0);
}

process.on('SIGINT', () => {
  shutdown(c.dim('Keluar.'));
  process.exit(0);
});

main().catch((err) => {
  shutdown(warn(err.message || String(err)));
  process.exit(1);
});
