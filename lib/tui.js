// TUI full-screen ala OpenCode (alternate screen).
// App memiliki seluruh layar: area chat scroll internal + composer dipaku di bawah.
// Popup digambar sebagai overlay (latar diredupkan), bukan pindah layar.
import readline from 'node:readline';
import { c, raw, userPrompt } from '../ui/theme.js';
import { writeClipboardText } from './clipboard.js';
import { highlight } from './highlight.js';
import { readClipboard } from './clipboard.js';
import { filterCommands } from './commands.js';
import { splashRows } from '../ui/logo.js';

const ANSI = /\x1b\[[0-9;]*m/g;
const ESC_SEQ = /\x1b(?:\[[0-9;?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[PX^_][\s\S]*?\x1b\\|[@-_])/g;
const RESET = '\x1b[0m';
const MAX_POPUP = 10;
const MAX_LINES = 2000;
const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

const tty = () => Boolean(process.stdin.isTTY && process.stdout.isTTY);

const state = {
  started: false,
  closed: false,
  cols: 0,
  rows: 0,
  status: () => ({ left: '', right: '' }),
  splash: false,
  splashNote: '',
  headerH: 0,
  input: null,
  popup: null,
  history: [],
  renderTimer: null,
  keypressReady: false,
  exitGuard: false,
  lines: [],
  live: '',
  todos: [],
  scroll: 0,
  mouseBuf: null,
  confirm: null,
  exitArmed: 0,
  sel: null,
  mouseDrag: false,
  chatH: 0,
  chatStart: 0,
  wrapWidth: 80,
  inAlt: false,
  needClear: false,
  spin: { active: false, frame: 0, timer: null, text: '', custom: '', started: 0 },
  code: null,
  interrupt: null,
  editor: null,
  typeahead: '',
  atPicked: [],
  thoughts: new Map(),
  expanded: new Set(),
  thoughtRows: new Map(),
  attachment: null,
  clipBusy: false,
  clipNotice: '',
  insertText: null,
};

export function stripEsc(s) {
  // ESC, CSI, OSC, DCS/PM/APC + sisa kontrol C1 (0x7F–0x9F) yang juga bisa jadi escape.
  return String(s ?? '').replace(ESC_SEQ, '').replace(/[\x7f-\x9f]/g, '');
}

export function visualWidth(text) {
  let width = 0;
  for (const ch of String(text).replace(ANSI, '')) width += charWidth(ch);
  return width;
}

function charWidth(ch) {
  const cp = ch.codePointAt(0);
  if (cp === 0x200d) return 0;
  if (cp >= 0x0300 && cp <= 0x036f) return 0;
  if (cp >= 0x200b && cp <= 0x200f) return 0;
  if (cp >= 0x20d0 && cp <= 0x20ff) return 0;
  if (cp >= 0xfe00 && cp <= 0xfe0f) return 1;
  if (cp >= 0x1f000 && cp <= 0x1faff) return 2;
  if (cp >= 0x2b00 && cp <= 0x2bff) return 2;
  if (cp >= 0x2600 && cp <= 0x27bf) return 2;
  if (cp >= 0x231a && cp <= 0x231b) return 2;
  if (cp >= 0x23e9 && cp <= 0x23f3) return 2;
  if (cp >= 0x25aa && cp <= 0x25ab) return 2;
  if (cp >= 0x25fd && cp <= 0x25fe) return 2;
  const wide = (cp >= 0x1100 && cp <= 0x115f)
    || (cp >= 0x2e80 && cp <= 0xa4cf)
    || (cp >= 0xac00 && cp <= 0xd7a3)
    || (cp >= 0xf900 && cp <= 0xfaff)
    || (cp >= 0xfe30 && cp <= 0xfe6f)
    || (cp >= 0xff00 && cp <= 0xff60)
    || (cp >= 0xffe0 && cp <= 0xffe6);
  return wide ? 2 : 1;
}

function cutAnsi(text, max) {
  let out = '';
  let width = 0;
  for (let i = 0; i < text.length;) {
    if (text[i] === '\x1b') {
      const m = /^\x1b\[[0-9;]*m/.exec(text.slice(i));
      if (m) { out += m[0]; i += m[0].length; continue; }
    }
    const ch = String.fromCodePoint(text.codePointAt(i));
    const w = charWidth(ch);
    if (width + w > max) break;
    out += ch;
    width += w;
    i += ch.length;
  }
  return out;
}

export function wrapAnsi(text, width) {
  const lines = [];
  let line = '';
  let lineWidth = 0;
  let active = '';

  for (let i = 0; i < text.length;) {
    if (text[i] === '\x1b') {
      const m = /^\x1b\[[0-9;]*m/.exec(text.slice(i));
      if (m) {
        const seq = m[0];
        line += seq;
        if (seq === RESET || seq === '\x1b[0m') active = '';
        else active = seq;
        i += seq.length;
        continue;
      }
    }
    const ch = String.fromCodePoint(text.codePointAt(i));
    const w = charWidth(ch);
    if (lineWidth > 0 && lineWidth + w > width) {
      lines.push(`${line}${RESET}`);
      line = active + ch;
      lineWidth = w;
    } else {
      line += ch;
      lineWidth += w;
    }
    i += ch.length;
  }
  lines.push(`${line}${RESET}`);
  return lines;
}

function plain(text) {
  return String(text).replace(ANSI, '');
}

function wrapPlain(text, max) {
  const words = String(text).split(/\s+/).filter(Boolean);
  if (!words.length) return [''];
  const out = [];
  let cur = '';
  for (const w of words) {
    if (!cur) cur = w;
    else if (visualWidth(cur) + 1 + visualWidth(w) <= max) cur += ` ${w}`;
    else { out.push(cur); cur = w; }
  }
  if (cur) out.push(cur);
  return out;
}

function fitLine(line, width) {
  const cut = cutAnsi(line, width);
  return `${cut}${RESET}${' '.repeat(Math.max(0, width - visualWidth(cut)))}`;
}

function statusText(status, width) {
  const right = status?.right || '';
  const maxLeft = Math.max(0, width - visualWidth(right) - 1);
  let left = status?.left || '';
  if (visualWidth(left) > maxLeft) left = maxLeft > 1 ? `${cutAnsi(left, maxLeft - 1)}…` : '';
  const space = Math.max(0, width - 1 - visualWidth(left) - visualWidth(right));
  return ` ${left}${' '.repeat(space)}${right}`;
}

export function init() {
  if (state.started) return;
  state.started = true;
  if (!tty()) return;
  state.splash = true;
  state.cols = process.stdout.columns || 80;
  state.rows = process.stdout.rows || 24;
  // Full-screen: masuk alternate screen, sembunyikan cursor, bersihkan.
  process.stdout.write('\x1b[?1049h\x1b[?25l\x1b[2J\x1b[H\x1b[?2004h\x1b[?1002h\x1b[?1006h');
  state.inAlt = true;
  process.stdout.on('resize', onResize);
  if (!state.exitGuard) {
    state.exitGuard = true;
    process.on('exit', onExit);
  }
  // Satu reader untuk seluruh sesi: hindari pause/raw-mode toggle tiap giliran.
  ensureKeypress();
  process.stdin.on('keypress', dispatchKey);
  try { process.stdin.setRawMode(true); } catch { /* bukan TTY */ }
  process.stdin.resume();
}

function onResize() {
  state.sel = null;
  state.mouseDrag = false;
  state.needClear = true;
  scheduleRender();
}

function onExit() {
  try { process.stdin.setRawMode(false); } catch { /* bukan TTY */ }
  try { process.stdout.write(`${state.inAlt ? '\x1b[?1049l' : ''}\x1b[?1006l\x1b[?1002l\x1b[?1000l\x1b[?2004l\x1b[?25h`); } catch { /* abaikan */ }
}

// ---------- transcript buffer ----------

function pushLine(line) {
  state.lines.push(line);
  if (state.lines.length > MAX_LINES) state.lines.splice(0, state.lines.length - MAX_LINES);
}

// Baris kode: nomor baris + gutter, syntax highlight; baris diff +/- diberi tanda berwarna.
function codeLine(text, n, lang) {
  const num = c.dim(String(n).padStart(4));
  const bar = c.dim('│');
  // Baris diff: tanda +/- diwarnai, isi apa adanya (tanpa latar penuh).
  if (text.startsWith('+') || text.startsWith('-')) {
    const sign = text[0];
    return `${num} ${bar} ${sign === '+' ? c.mint('+') : c.maroon('-')}${stripEsc(text.slice(1))}`;
  }
  return `${num} ${bar} ${highlight(text, lang)}`;
}

// Markdown ringan: bold, inline code, bullet, heading. Bukan parser penuh.
function mdLine(line) {
  let s = line;
  if (!s) return s;
  s = s.replace(/`([^`]+)`/g, (_, m) => c.gold(m));
  s = s.replace(/\*\*([^*]+)\*\*/g, (_, m) => c.bold(m));
  s = s.replace(/^(\s*)[-*]\s+/, (_, sp) => `${sp}${c.peach('•')} `);
  s = s.replace(/^(#{1,6})\s+(.+)$/, (_, h, t) => c.bold(t));
  return s;
}

// Tabel markdown dari jawaban model → kolom rata dengan bingkai (gaya Claude Code).
const isTableRow = (line) => /^\s*\|/.test(stripEsc(String(line)));
const isTableSep = (line) => {
  const s = stripEsc(String(line)).trim();
  return s.includes('-') && /^\|?[\s:|-]+\|?$/.test(s);
};

function tableCells(line) {
  let s = stripEsc(String(line)).trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  // Pisah pada `|` yang tidak di-escape; `\|` di dalam sel jadi `|` biasa.
  return s.split(/(?<!\\)\|/).map((x) => ({
    // `**tebal**` = sel di-render tebal penuh (gaya leaderboard), marker dibersihkan.
    t: x.replace(/\\\|/g, '|').replace(/\*\*/g, '').replace(/\*/g, '').replace(/`/g, '').trim(),
    b: /\*\*/.test(x),
  }));
}

// Kolom angka (396, 1.2 s, 5/5, 360.000) rata kanan; teks tetap rata kiri.
const NUM_CELL = /^[≈~]?[-+]?[\d.,]+(\/[\d.,]+)?( s| ms|min)?[º%]?$/;

export function tableLines(block, width) {
  const hasHead = block.some(isTableSep);
  const rows = block.filter((l) => !isTableSep(l)).map(tableCells);
  if (!rows.length) return [];
  const cols = Math.max(...rows.map((r) => r.length));
  for (const r of rows) while (r.length < cols) r.push({ t: '', b: false });
  const startData = hasHead ? 1 : 0;
  const aligns = [];
  for (let i = 0; i < cols; i++) {
    const data = rows.slice(startData).map((r) => r[i]?.t).filter(Boolean);
    aligns.push(data.length > 0 && data.every((x) => NUM_CELL.test(x)) ? 'r' : 'l');
  }
  const cellW = Array(cols).fill(0);
  for (const r of rows) r.forEach((cell, i) => { cellW[i] = Math.max(cellW[i], visualWidth(cell.t)); });
  const overhead = 3 * cols + 1;
  const total = () => cellW.reduce((a, b) => a + b, 0) + overhead;
  while (total() > width && Math.max(...cellW) > 6) {
    const i = cellW.indexOf(Math.max(...cellW));
    cellW[i] -= 1;
  }
  const pad = (text, w, align) => (align === 'r'
    ? ' '.repeat(Math.max(0, w - visualWidth(text))) + text
    : text + ' '.repeat(Math.max(0, w - visualWidth(text))));
  // Kata yang lebih panjang dari kolom dipotong paksa supaya tabel tidak melewati layar.
  const wrapCell = (text, max) => wrapPlain(text, max).flatMap((line) => {
    if (visualWidth(line) <= max) return [line];
    const parts = [];
    let rest = line;
    while (visualWidth(rest) > max) {
      const head = cutAnsi(rest, max);
      parts.push(head);
      rest = rest.slice(head.length);
    }
    if (rest) parts.push(rest);
    return parts;
  });
  const rule = (left, mid, right) => `${left}${cellW.map((w) => '─'.repeat(w + 2)).join(mid)}${right}`;
  const out = [rule('╭', '┬', '╮')];
  rows.forEach((row, r) => {
    const header = hasHead && r === 0;
    const wrapped = row.map((cell, i) => wrapCell(cell.t, cellW[i]).map((x) => ({ x, b: cell.b, a: aligns[i] })));
    const h = Math.max(...wrapped.map((w) => w.length));
    for (let k = 0; k < h; k++) {
      const parts = wrapped.map((w, i) => {
        const t = pad(w[k]?.x || '', cellW[i], w[0]?.a);
        return header || w[k]?.b ? c.bold(t) : t;
      });
      out.push(`│ ${parts.join(' │ ')} │`);
    }
    // Pemisah antar baris (kecuali setelah baris terakhir; bawahnya sudah ada ╰).
    if (r < rows.length - 1) out.push(rule('├', '┼', '┤'));
  });
  out.push(rule('╰', '┴', '╯'));
  return out;
}

// Teks bot: blok ``` jadi blok kode bernomor; fence-nya tidak ikut ditampilkan.
function commitBotLine(line) {
  const m = /^\s*```(.*)$/.exec(line);
  if (m) {
    if (state.code) {
      pushLine(`${c.codeBar('▐')} ${c.dim('end')}`);
      state.code = null;
    } else {
      const lang = m[1].trim();
      state.code = { lang, n: 0 };
      pushLine(`${c.codeBar('▐')} ${c.dim(lang || 'code')}`);
    }
    return;
  }
  if (state.code) {
    state.code.n += 1;
    pushLine(codeLine(line, state.code.n, state.code.lang));
    return;
  }
  pushLine(mdLine(line));
}

// Blok diff langsung (tanpa fence) supaya isi file tidak bisa menutup blok.
export function diffBlock(lines, label = '') {
  if (!tty()) {
    // baris diff berbentuk objek {type,text,gap}; cetak apa adanya, jangan [object Object]
    for (const line of lines) process.stdout.write(`${line.gap ? '     ⋮' : `${line.type}${line.text}`}\n`);
    return;
  }
  state.code = null;
  if (state.live) { pushLine(state.live); state.live = ''; }
  pushLine(`${c.codeBar('▐')} ${c.dim(stripEsc(label || 'selisih'))}`);
  for (const line of lines) {
    if (line.gap) {
      pushLine(c.dim('     ⋮'));
      continue;
    }
    const n = line.newNo ?? line.oldNo ?? '';
    pushLine(codeLine(`${line.type}${stripEsc(line.text)}`, n, 'diff'));
  }
  render();
}

export function markLog() {
  return { lines: state.lines.length, live: state.live };
}

export function rollbackLog(mark) {
  if (!mark) return;
  state.lines.length = Math.min(state.lines.length, mark.lines);
  state.live = mark.live;
  state.code = null;
  state.sel = null;
  state.mouseDrag = false;
  render();
}

export function log(text = '') {
  if (!tty()) {
    process.stdout.write(`${text}\n`);
    return;
  }
  state.code = null; // fence tak tertutup tidak boleh bocor ke log berikutnya
  if (state.live) { pushLine(state.live); state.live = ''; }
  const s = String(text).replace(/\r/g, '');
  for (const line of s.split('\n')) pushLine(line);
  render();
}

export function append(text) {
  if (!tty()) {
    process.stdout.write(String(text));
    return;
  }
  state.live += stripEsc(String(text).replace(/\r/g, ''));
  let idx;
  while ((idx = state.live.indexOf('\n')) !== -1) {
    commitBotLine(state.live.slice(0, idx));
    state.live = state.live.slice(idx + 1);
  }
  render();
}

// Blok thinking ringkas + bisa diklik untuk buka/tutup isi penuh (gaya Claude Code).
export function thoughtBlock(ms, text) {
  const secs = (Math.max(0, ms) / 1000).toFixed(1);
  const id = ++thoughtSeq;
  state.thoughts.set(id, stripEsc(String(text || '')).replace(/\r/g, ''));
  if (state.thoughts.size > 50) state.thoughts.delete(state.thoughts.keys().next().value);
  log(`${c.dim(`✻ berpikir · ${secs}s`)}\u0001${id}\u0001`);
  log('');
}

export function clearLog() {
  if (!tty()) return;
  state.lines = [];
  state.live = '';
  state.todos = [];
  state.thoughts.clear();
  state.expanded.clear();
  state.thoughtRows.clear();
  state.scroll = 0;
  state.code = null;
  state.sel = null;
  state.mouseDrag = false;
  render();
}

// Bungkus teks bubble per kata; kata yang lebih panjang dari lebar dipotong paksa.
function wrapBubble(text, width) {
  const out = [];
  for (const ln of wrapPlain(text, width)) {
    if (visualWidth(ln) <= width) { out.push(ln); continue; }
    let rest = ln;
    while (visualWidth(rest) > width) {
      const head = cutAnsi(rest, width);
      out.push(head);
      rest = rest.slice(head.length);
    }
    if (rest) out.push(rest);
  }
  return out.length ? out : [''];
}

// Pesan user di transkrip: bar tipis + teks, tanpa blok latar (gaya buku besar).
function userBlockLines(text, width) {
  const raw = stripEsc(String(text).replace(/\r/g, ''));
  const contentW = Math.max(8, width - 2);
  const out = [];
  let first = true;
  for (const para of raw.split('\n')) {
    for (const ln of wrapBubble(para, contentW)) {
      out.push(first ? `${c.gold('▎')} ${ln}` : `  ${ln}`);
      first = false;
    }
  }
  if (!out.length) out.push(c.gold('▎'));
  return out;
}

// Baris buku besar: label kiri, titik-titik, ukuran rata kanan.
export function ledgerLine(left, right = '', width = 0) {
  const w = Math.max(28, width || (process.stdout.columns || 80) - 2);
  const r = String(right ?? '');
  const rw = visualWidth(r);
  const maxLeft = Math.max(8, w - 2 - (r ? rw + 4 : 0));
  const l = cutAnsi(String(left ?? ''), maxLeft);
  if (!r) return `  ${l}`;
  const avail = w - 2 - visualWidth(l) - rw;
  if (avail < 4) return `  ${l} ${r}`;
  return `  ${l} ${c.dim('·'.repeat(avail - 2))} ${r}`;
}

export function startLoading(text = 'Memikir') {
  if (!tty()) return;
  if (state.spin.active) {
    state.spin.text = text;
    state.spin.custom = '';
    state.spin.started = Date.now();
    return;
  }
  state.code = null;
  state.spin.active = true;
  state.spin.frame = 0;
  state.spin.text = text;
  state.spin.custom = '';
  state.spin.started = Date.now();
  state.spin.timer = setInterval(() => {
    state.spin.frame = (state.spin.frame + 1) % SPIN.length;
    render();
  }, 90);
  render();
}

export function stopLoading() {
  if (!state.spin.active) return;
  clearInterval(state.spin.timer);
  state.spin.timer = null;
  state.spin.active = false;
  render();
}

export function toolProgress(text) {
  if (!tty()) return;
  if (!state.spin.active) startLoading(text);
  else state.spin.custom = text;
}

// Esc/Ctrl+C saat bot menjawab ditangani dispatcher; di sini cuma daftar callback.
export function beginInterrupt(onAbort) {
  if (!tty() || state.interrupt) return;
  state.interrupt = onAbort;
}

export function endInterrupt() {
  state.interrupt = null;
}

export function setTitle(text) {
  if (!tty()) return;
  process.stdout.write(`\x1b]0;${text}\x07`);
}

export function bell() {
  if (!tty()) return;
  process.stdout.write('\x07');
}

export function setStatus(fn) {
  state.status = fn;
  scheduleRender();
}

// Catatan kecil di layar splash (mis. "API key belum ada").
export function setSplashNote(text) {
  state.splashNote = String(text || '');
  scheduleRender();
}

// Daftar tugas dari model; panel kecil di atas composer.
export function setTodos(list) {
  state.todos = Array.isArray(list) ? list : [];
  render();
}

export function renderNow() {
  if (state.renderTimer) {
    clearTimeout(state.renderTimer);
    state.renderTimer = null;
  }
  render();
}

function scheduleRender() {
  if (!tty() || state.closed || state.renderTimer) return;
  state.renderTimer = setTimeout(() => {
    state.renderTimer = null;
    render();
  }, 40);
}

async function requestClipboard() {
  if (state.clipBusy || state.closed) return;
  state.clipBusy = true;
  state.clipNotice = '';
  renderNow();
  let res = null;
  try {
    res = await readClipboard();
  } finally {
    state.clipBusy = false;
  }
  if (!res) return renderNow();
  if (res.type === 'error') {
    state.clipNotice = res.message;
    return renderNow();
  }
  if (res.type === 'image' || res.type === 'doc') {
    if (state.popup) {
      state.clipNotice = 'Lampiran hanya bisa dipakai di prompt chat.';
      return renderNow();
    }
    state.attachment = res;
    state.clipNotice = '';
    return renderNow();
  }
  if (res.type === 'text' && res.text) {
    state.clipNotice = '';
    // Buang escape/kontrol dari clipboard: isi asing tidak boleh menyuntik terminal.
    const text = res.text.replace(/\t/g, '  ').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, '');
    if (state.insertText) return state.insertText(text);
    if (state.typeahead.length < 1000) {
      state.typeahead += text.slice(0, 1000 - state.typeahead.length);
    }
    renderNow();
  }
}

export function takeAttachment() {
  const a = state.attachment;
  state.attachment = null;
  state.clipNotice = '';
  return a;
}

function scrollPage(dir) {
  const step = Math.max(1, (state.rows || 24) - 12);
  state.scroll = Math.max(0, state.scroll + dir * step);
  renderNow();
}

function scrollBy(lines) {
  state.scroll = Math.max(0, state.scroll + lines);
  renderNow();
}

function handleMouseSeq(seq) {
  if (state.popup) return;
  const m = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/.exec(seq);
  if (!m) return;
  const button = Number(m[1]) & ~(4 | 8 | 16);
  const x = Number(m[2]);
  const y = Number(m[3]);
  const released = m[4] === 'm';
  if (button === 64) { scrollBy(3); return; }
  if (button === 65) { scrollBy(-3); return; }
  if (released) {
    if (button === 0 || button === 32) endSelection();
    return;
  }
  if (button === 0) { startSelection(x, y); return; }
  if (button === 32) moveSelection(x, y);
}

function mousePoint(x, y) {
  const row = y - 1;
  if (row < 0 || row >= (state.chatH || 0)) return null;
  return {
    line: (state.chatStart || 0) + row,
    col: Math.max(0, Math.min(state.wrapWidth || 1, x - 1)),
  };
}

function startSelection(x, y) {
  const pos = mousePoint(x, y);
  state.sel = pos ? { a: pos, b: pos } : null;
  state.mouseDrag = Boolean(pos);
  renderNow();
}

function moveSelection(x, y) {
  if (!state.mouseDrag) return;
  const pos = mousePoint(x, y);
  if (!pos) return;
  state.sel.b = pos;
  renderNow();
}

function selectionRange() {
  const sel = state.sel;
  if (!sel) return null;
  const before = sel.a.line < sel.b.line || (sel.a.line === sel.b.line && sel.a.col <= sel.b.col);
  return before ? { a: sel.a, b: sel.b } : { a: sel.b, b: sel.a };
}

function selectionText() {
  const range = selectionRange();
  if (!range) return '';
  const lines = transcriptLines(state.wrapWidth || 80).map((l) => l.replace(ANSI, ''));
  const out = [];
  for (let i = range.a.line; i <= range.b.line; i++) {
    const text = lines[i] ?? '';
    const from = i === range.a.line ? range.a.col : 0;
    const to = i === range.b.line ? range.b.col : Number.MAX_SAFE_INTEGER;
    out.push(sliceCols(text, from, to).replace(/\s+$/, ''));
  }
  return out.join('\n');
}

function sliceCols(text, from, to) {
  let out = '';
  let col = 0;
  for (const ch of text) {
    const w = visualWidth(ch);
    if (col >= to) break;
    if (col + w > from) out += ch;
    col += w;
  }
  return out;
}

function copySelection(text) {
  process.stdout.write(`\x1b]52;c;${Buffer.from(text, 'utf8').toString('base64')}\x07`);
  writeClipboardText(text).catch(() => {});
}

function endSelection() {
  if (!state.mouseDrag) return;
  state.mouseDrag = false;
  const range = selectionRange();
  if (!range || (range.a.line === range.b.line && range.a.col === range.b.col)) {
    state.sel = null;
    if (range && toggleThoughtAt(range.a.line)) return;
    renderNow();
    return;
  }
  const text = selectionText();
  if (text.trim()) copySelection(text);
  renderNow();
}

// Klik (tanpa geser) pada baris `✻ berpikir` membuka/menutup isi penuh.
function toggleThoughtAt(line) {
  const id = state.thoughtRows.get(line);
  if (id == null) return false;
  if (state.expanded.has(id)) state.expanded.delete(id);
  else state.expanded.add(id);
  renderNow();
  return true;
}

// Sorot seleksi dengan reverse video tanpa menghapus warna asli.
function markSelection(line, from, to) {
  let out = '';
  let col = 0;
  let open = false;
  let last = 0;
  const push = (text) => {
    for (const ch of text) {
      const w = visualWidth(ch);
      if (!open && col + w > from && col < to) { out += '\x1b[7m'; open = true; }
      out += ch;
      col += w;
      if (open && col >= to) { out += '\x1b[27m'; open = false; }
    }
  };
  const re = /\x1b\[[0-9;]*m/g;
  let m;
  while ((m = re.exec(line))) {
    push(line.slice(last, m.index));
    out += m[0];
    last = m.index + m[0].length;
  }
  push(line.slice(last));
  if (open) out += '\x1b[27m';
  return out;
}

let fileSuggest = null;
let thoughtSeq = 0;
const THINK_MARK = /\u0001(\d+)\u0001/;

// Dipanggil index.js: fn(token) -> [{cmd, desc}] untuk menu @file
export function setFileSuggest(fn) {
  fileSuggest = fn;
}

export function takeAtFiles() {
  const list = state.atPicked;
  state.atPicked = [];
  return list;
}

// Satu dispatcher untuk semua keypress sepanjang sesi.
function dispatchKey(str, key = {}) {
  if (state.closed) return;
  // Mouse SGR (roda) dipecah Node jadi beberapa keypress; rangkai dulu.
  if (state.mouseBuf) {
    state.mouseBuf += typeof str === 'string' ? str : (key.sequence || '');
    if (state.mouseBuf.length > 40) state.mouseBuf = null;
    else if (/[Mm]$/.test(state.mouseBuf)) {
      const seq = state.mouseBuf;
      state.mouseBuf = null;
      handleMouseSeq(seq);
    }
    return;
  }
  if (key.sequence === '\x1b[<' || (typeof str === 'string' && str.startsWith('\x1b[<'))) {
    const seq = typeof str === 'string' ? str : '\x1b[<';
    if (/^\x1b\[<\d+;\d+;\d+[Mm]$/.test(seq)) handleMouseSeq(seq);
    else state.mouseBuf = seq;
    return;
  }
  if (state.confirm) {
    const name = key.name || '';
    if (name === 'return' || name === 'enter') {
      const done = state.confirm;
      state.confirm = null;
      render();
      done.resolve(true);
      return;
    }
    if (name === 'escape') {
      const done = state.confirm;
      state.confirm = null;
      render();
      done.resolve(false);
      return;
    }
    if (name === 'pageup') { scrollPage(1); return; }
    if (name === 'pagedown') { scrollPage(-1); return; }
    return;
  }
  const pasteKey = (key.ctrl && key.name === 'v')
    || (key.shift && key.name === 'insert')
    || key.name === 'f2';
  if (state.exitArmed && !(key.ctrl && key.name === 'c')) state.exitArmed = 0;
  if (pasteKey) {
    requestClipboard();
    return;
  }
  if (state.editor) {
    state.editor(str, key);
    return;
  }
  if (key.name === 'pageup' || key.sequence === '\x1b[5~') {
    scrollPage(1);
    return;
  }
  if (key.name === 'pagedown' || key.sequence === '\x1b[6~') {
    scrollPage(-1);
    return;
  }
  if (state.interrupt) {
    if (key.name === 'escape') {
      state.interrupt();
      return;
    }
  }
  // Tidak ada editor/bot menjawab: simpan ketikan agar masuk ke prompt berikutnya.
  if (key.ctrl || key.meta) return;
  if (key.name === 'backspace') {
    state.typeahead = state.typeahead.slice(0, -1);
    return;
  }
  if (str && !/[\x00-\x1f\x7f]/.test(str) && state.typeahead.length < 1000) {
    state.typeahead += str;
  }
}

export function confirmInline(text) {
  if (!tty()) return Promise.resolve(false);
  return new Promise((resolve) => {
    state.confirm = { text: String(text), resolve };
    render();
  });
}

// ---------- panel ----------

// Panel popup gaya OpenCode: blok gelap tanpa bingkai, judul + esc, isi rata, footer hint.
function panelLines({ title = null, body, foot, width, maxW = 64 }) {
  const boxW = Math.max(30, Math.min(maxW, width - 4));
  const padX = 4;
  const contentW = Math.max(12, boxW - padX * 2);
  const left = Math.max(0, Math.floor((width - boxW) / 2));
  const bgCode = raw('popupBg');
  const bgStart = bgCode ? `\x1b[${bgCode}m` : '';
  const paintBg = (s) => (bgStart
    ? `${bgStart}${s.replace(/\x1b\[0m/g, `\x1b[0m${bgStart}`)}\x1b[0m`
    : s);
  const full = (text, style) => {
    const clipped = cutAnsi(text, contentW);
    const inner = clipped + ' '.repeat(Math.max(0, contentW - visualWidth(clipped)));
    const line = `${' '.repeat(padX)}${inner}${' '.repeat(padX)}`;
    return paintBg(style ? style(line) : line);
  };
  const rowText = (item) => {
    let text = item.text || '';
    const right = item.right || '';
    if (right) {
      const room = contentW - visualWidth(text) - 1;
      const clippedRight = room > 0 ? cutAnsi(right, room) : '';
      const gap = Math.max(1, contentW - visualWidth(text) - visualWidth(clippedRight));
      text = `${text}${' '.repeat(gap)}${clippedRight}`;
    }
    return full(text, item.style);
  };

  const esc = c.dim('esc');
  const titleText = title ? c.bold(title) : '';
  const gap = Math.max(1, contentW - visualWidth(titleText) - visualWidth(esc));
  const lines = [full(''), full(`${titleText}${' '.repeat(gap)}${esc}`, c.selected), full('')];
  for (const item of body) lines.push(rowText(item));
  if (foot) {
    lines.push(full(''));
    lines.push(full(foot, c.dim));
  }
  lines.push(full(''));
  return { lines: lines.map((ln) => `${' '.repeat(left)}${ln}`), left, contentW, padX };
}

function itemText(item, selected, picked, multi) {
  const name = stripEsc(item.label ?? `${item.cmd ?? ''}${item.hint ? ` ${item.hint}` : ''}`);
  const desc = stripEsc(item.desc || '');
  const mark = multi && picked ? `${c.gold('✓')} ` : '';
  if (selected) return { text: `▸ ${mark}${name}`, style: c.selected };
  const dot = item.cur ? `${c.gold('●')} ` : '  ';
  return { text: `${dot}${mark}${c.peach(name)}`, right: desc ? c.dim(desc) : '' };
}

// ---------- layout ----------

function transcriptLines(width) {
  const out = [];
  state.thoughtRows = new Map();
  for (let i = 0; i < state.lines.length; i++) {
    const line = state.lines[i];
    const mark = THINK_MARK.exec(line);
    if (mark) {
      const id = Number(mark[1]);
      const shownHead = line.replace(THINK_MARK, '');
      for (const w of wrapAnsi(shownHead, width)) {
        state.thoughtRows.set(out.length, id);
        out.push(w);
      }
      if (state.expanded.has(id)) {
        const body = (state.thoughts.get(id) || '').split('\n').filter((ch) => ch.trim());
        if (body.length) out.push('');
        for (const ch of body) {
          for (const w of wrapAnsi(`  ${c.dim(ch)}`, width)) out.push(w);
        }
      }
      continue;
    }
    if (isTableRow(line) && isTableRow(state.lines[i + 1] || '')) {
      let j = i;
      while (j < state.lines.length && isTableRow(state.lines[j])) j++;
      for (const w of tableLines(state.lines.slice(i, j), width)) out.push(w);
      i = j - 1;
      continue;
    }
    for (const w of wrapAnsi(line, width)) out.push(w);
  }
  const secs = state.spin.active
    ? Math.max(0, Math.floor((Date.now() - state.spin.started) / 1000))
    : 0;
  const spinColor = secs >= 15 ? c.maroon : secs >= 5 ? c.gold : c.lav;
  const spinLabel = state.spin.custom || state.spin.text;
  const spinSuffix = state.spin.active
    ? `${spinColor(SPIN[state.spin.frame])} ${c.dim(`${spinLabel}… ${secs}s`)}`
    : '';
  // Fence yang sedang streaming jangan sempat tampil sebagai teks.
  const liveText = /^\s*```/.test(state.live) ? '' : state.live;
  const liveRaw = state.code && liveText
    ? codeLine(liveText, state.code.n + 1, state.code.lang)
    : liveText;
  if (liveRaw || spinSuffix) for (const w of wrapAnsi(`${liveRaw}${spinSuffix}`, width)) out.push(w);
  return out;
}

function statusLines(width) {
  const status = state.status();
  return [statusText({ left: status.left || '', right: status.right || '' }, width)];
}

// Panel tugas: maksimal 2 baris supaya composer tetap ringkas.
function todoLines(width) {
  const list = state.todos || [];
  if (!list.length) return [];
  const done = list.filter((t) => t.status === 'completed').length;
  const cur = list.find((t) => t.status === 'in_progress') || list.find((t) => t.status === 'pending');
  const head = ` ${c.gold('tugas')} ${c.dim(`${done}/${list.length}`)}`
    + (cur ? `  ${c.lav('◐')} ${c.dim(stripEsc(cur.content))}` : '');
  const items = list.filter((t) => t !== cur).slice(0, 4).map((t) => {
    const mark = t.status === 'completed' ? c.mint('☑') : t.status === 'in_progress' ? c.gold('◐') : c.dim('☐');
    const text = stripEsc(t.content);
    return `${mark} ${c.dim(text.length > 22 ? `${text.slice(0, 21)}…` : text)}`;
  });
  const lines = [cutAnsi(head, width)];
  if (items.length) lines.push(`  ${cutAnsi(items.join('  '), Math.max(8, width - 2))}`);
  return lines;
}

// Palette `/` layar penuh: tanpa bingkai, selebar terminal, composer disembunyikan.
// Tinggi daftar dibatasi supaya transkrip tetap kelihatan (minimal ~35% layar).
function buildPalette(menu, index, width, rows) {
  const chatMin = Math.max(4, Math.floor(rows * 0.35));
  const visible = Math.min(menu.length, Math.max(1, rows - chatMin - 5));
  const offset = Math.max(0, Math.min(index - visible + 1, menu.length - visible));
  const lines = [''];
  for (let i = 0; i < visible; i++) {
    const item = menu[offset + i];
    const name = `${item.cmd ?? ''}${item.hint ? ` ${item.hint}` : ''}`.padEnd(20);
    const desc = item.desc || '';
    if (offset + i === index) {
      const text = cutAnsi(` ${name}${desc}`, width);
      lines.push(c.selected(text + ' '.repeat(Math.max(0, width - visualWidth(text)))));
    } else {
      lines.push(`${c.peach(` ${name}`)}${c.dim(desc)}`);
    }
  }
  lines.push(c.dim('─'.repeat(width)));
  lines.push(c.dim('↑↓ pilih · tab lengkapi · enter jalankan · esc tutup'));
  lines.push('');
  lines.push(...statusLines(width));
  return { lines, cursorRow: 0, cursorCol: 0, showCursor: false };
}

function buildComposerBox(width, rows) {
  const input = state.input;
  const menu = input?.active ? (input.menu || []) : [];
  if (menu.length) return buildPalette(menu, input.menuIndex, width, rows);

  const line = input?.active ? input.line : '';
  const contentW = Math.max(10, width - 1); // 1 kolom untuk bar kiri
  const inset = '  ';
  const allLines = [];
  for (const seg of line.split('\n')) allLines.push(...wrapAnsi(inset + seg, contentW));
  const shownLines = input?.active && !line && !state.attachment && input.menuSource
    ? [`${inset}${c.dim('Ketik pesan… (/ untuk menu · F2 gambar)')}`]
    : allLines;
  const maxInputRows = Math.max(1, rows - 7);
  const hidden = Math.max(0, shownLines.length - maxInputRows);
  const inputLines = hidden ? shownLines.slice(-maxInputRows) : shownLines;
  const inputRows = inputLines.length;

  const blockRow = (text) => {
    const cut = cutAnsi(text, contentW);
    // wrapAnsi menutup baris dengan reset; pasang ulang latar supaya padding kanan ikut gelap.
    const padded = (cut + ' '.repeat(Math.max(0, contentW - visualWidth(cut))))
      .replace(/\x1b\[0m/g, '\x1b[0m\x1b[48;5;236m');
    return `${c.composerBar('▌')}\x1b[48;5;236m${padded}\x1b[0m`;
  };

  const status = state.status();
  const statusLine = statusText({ left: status.left || '', right: status.right || '' }, width);
  const scrollLine = state.scroll > 0
    ? c.lav(` ↑ ${state.scroll} baris · PgDn turun`)
    : null;
  const confirmLine = state.confirm
    ? `${c.gold('?')} ${cutAnsi(state.confirm.text, Math.max(10, width - 28))} ${c.dim('· enter=ya · esc=batal')}`
    : null;
  const attachMark = state.attachment?.type === 'doc' ? '📄' : '📎';
  const attachText = state.attachment
    ? `${c.gold(attachMark)} ${c.dim(`${state.attachment.name} · ${Math.max(1, Math.round(state.attachment.bytes / 1024))} kB · backspace hapus`)}`
    : state.clipBusy ? c.dim('Membaca clipboard…')
      : state.clipNotice ? `${c.maroon('⚠')} ${c.dim(state.clipNotice)}` : null;
  const attachLine = input?.active && !state.popup && attachText ? blockRow(`  ${attachText}`) : null;

  const todo = todoLines(width);
  const lines = [
    ...todo,
    ...(scrollLine ? [scrollLine] : []),
    ...(confirmLine ? [confirmLine] : []),
    blockRow(''),
    ...(attachLine ? [attachLine] : []),
    ...inputLines.map((ln) => blockRow(ln)),
    blockRow(''),
    '',
    statusLine,
  ];

  let cursorRow = 0;
  let cursorCol = 1;
  if (input?.active) {
    const segs = line.slice(0, input.cursor || 0).split('\n');
    let row = 0;
    for (const seg of segs) row += wrapAnsi(inset + seg, contentW).length;
    row -= 1;
    const last = segs[segs.length - 1];
    const colPos = visualWidth(inset + last) % contentW;
    cursorRow = todo.length + (scrollLine ? 1 : 0) + (attachLine ? 1 : 0) + 1
      + Math.max(0, Math.min(row - hidden, inputRows - 1));
    cursorCol = 1 + colPos;
  }
  return { lines, cursorRow, cursorCol, showCursor: Boolean(input?.active) };
}

function buildPopupBlock(width, rows) {
  const p = state.popup;

  if (p.text) {
    const shown = p.secret ? '•'.repeat(p.query.length) : stripEsc(p.query);
    const label = p.label ? `${p.label} ` : '';
    const contentW = Math.max(12, Math.max(30, Math.min(88, width - 4)) - 4);
    const descLines = (p.desc || []).flatMap((t) =>
      wrapPlain(t, contentW).map((ln) => ({ text: ln, style: c.dim })));
    const body = [
      ...descLines,
      { text: '' },
      { text: `${c.peach(label)}${shown}` },
      { text: p.error ? `⚠ ${p.error}` : '', style: p.error ? c.maroon : null },
    ];
    const panel = panelLines({
      title: p.title,
      body,
      foot: 'enter simpan · esc batal',
      width,
    });
    const cursorRow = 3 + descLines.length + 1;
    const cursorCol = panel.left + panel.padX + visualWidth(label) + visualWidth(shown);
    return {
      lines: panel.lines,
      cursorRow,
      cursorCol: Math.min(panel.left + panel.padX + panel.contentW - 1, cursorCol),
      showCursor: true,
    };
  }

  const visible = Math.min(Math.max(p.filtered.length, 1), MAX_POPUP, Math.max(1, rows - 9));
  if (p.index < 0) p.index = 0;
  if (p.filtered.length && p.index >= p.filtered.length) p.index = p.filtered.length - 1;
  const maxOffset = Math.max(0, p.filtered.length - visible);
  if (p.index < p.offset) p.offset = p.index;
  if (p.index >= p.offset + visible) p.offset = p.index - visible + 1;
  p.offset = Math.min(Math.max(0, p.offset), maxOffset);

  const body = [
    { text: `${c.bold('saring')}${c.dim(' ›')} ${stripEsc(p.query)}` },
    { text: '' },
  ];
  if (!p.filtered.length) {
    body.push({ text: '(tidak ada hasil)', style: c.dim });
    for (let i = 1; i < visible; i++) body.push({ text: '' });
  } else {
    const slice = p.filtered.slice(p.offset, p.offset + visible);
    for (let i = 0; i < visible; i++) {
      const item = slice[i];
      if (!item) { body.push({ text: '' }); continue; }
      const val = item.value ?? item.label ?? item.cmd;
      body.push(itemText(item, p.offset + i === p.index, p.multi && p.picked.has(val), p.multi));
    }
  }

  const panel = panelLines({
    title: p.title,
    body,
    foot: p.multi ? '↑↓ pilih · spasi centang (maks 4) · ↵ mulai · esc batal' : '↑↓ pilih · ↵ terapkan · esc batal',
    width,
  });
  const qWidth = Math.min(visualWidth(p.query), Math.max(0, panel.contentW - 9));
  return {
    lines: panel.lines,
    cursorRow: 3,
    cursorCol: Math.min(panel.left + panel.padX + panel.contentW - 1, panel.left + panel.padX + 9 + qWidth),
    showCursor: true,
  };
}

// Layar splash ala OpenCode: logo besar di tengah + input di tengah.
function buildSplash(width, rows) {
  const boxW = Math.max(40, Math.min(76, width - 6));
  const left = Math.max(0, Math.floor((width - boxW) / 2));
  const pad = ' '.repeat(left);
  const box = buildComposerBox(boxW, Math.max(12, rows - 4));
  const logo = splashRows();
  const notes = stripEsc(state.splashNote).split('\n').map((l) => l.trim()).filter(Boolean)
    .flatMap((l) => wrapPlain(l, Math.min(boxW, Math.max(20, width - 10))));
  const tagline = `${c.gold('v0.1')} ${c.dim('· chat AI di terminal · BYOK · nol server')}`;
  const hints = `${c.dim('shift+tab')} ${c.dim('persona')}    ${c.gold('/')} ${c.dim('menu')}    ${c.dim('F2')} ${c.dim('gambar')}`;
  const center = (s) => ' '.repeat(Math.max(0, Math.floor((width - visualWidth(s)) / 2))) + s;

  const block = [];
  for (const row of logo) block.push(center(c.gold(row)));
  block.push('');
  block.push(center(tagline));
  if (notes.length) {
    block.push('');
    for (const n of notes) block.push(center(c.dim(n)));
  }
  block.push('');
  const boxStart = block.length;
  for (const l of box.lines) block.push(`${pad}${l}`);
  block.push('');
  block.push(center(hints));

  const top = Math.max(0, Math.floor((rows - block.length) / 2));
  const lines = Array(rows).fill('');
  for (let i = 0; i < block.length && top + i < rows; i++) lines[top + i] = block[i];
  return {
    lines,
    cursorRow: Math.min(rows - 1, top + boxStart + box.cursorRow),
    cursorCol: Math.min(width - 1, left + box.cursorCol),
    showCursor: box.showCursor,
  };
}

function paint(frame, width, rows, cursorRow, cursorCol, showCursor) {
  let out = state.needClear ? '\x1b[2J' : '';
  state.needClear = false;
  out += '\x1b[?25l\x1b[H';
  for (let i = 0; i < rows; i++) {
    out += fitLine(frame[i] || '', width) + '\x1b[K';
    if (i < rows - 1) out += '\r\n';
  }
  out += `\x1b[${cursorRow + 1};${cursorCol + 1}H`;
  out += showCursor ? '\x1b[?25h' : '\x1b[?25l';
  process.stdout.write(out);
}

// ---------- render ----------

function render() {
  if (!tty() || state.closed) return;

  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;
  const width = Math.max(20, cols - 1);
  state.cols = cols;
  state.rows = rows;

  const typing = state.input?.active && (state.input.line || state.input.menu?.length || state.attachment);
  if (state.splash && !state.popup && !typing) {
    const sp = buildSplash(width, rows);
    paint(sp.lines, width, rows, sp.cursorRow, sp.cursorCol, sp.showCursor);
    return;
  }

  const box = buildComposerBox(width, rows);
  const chatH = Math.max(1, rows - box.lines.length);
  const wrapped = transcriptLines(width);
  const maxScroll = Math.max(0, wrapped.length - chatH);
  // Saat tergulir, jaga baris yang sedang dibaca tetap di tempat walau stream menambah baris.
  if (state.scroll > 0 && state.scrollTotal && state.scrollWidth === width && wrapped.length > state.scrollTotal) {
    state.scroll += wrapped.length - state.scrollTotal;
  }
  state.scrollTotal = wrapped.length;
  state.scrollWidth = width;
  state.scroll = Math.min(Math.max(0, state.scroll), maxScroll);
  const end = wrapped.length - state.scroll;
  const start = Math.max(0, end - chatH);
  const chat = [];
  for (let i = 0; i < chatH; i++) chat.push(wrapped[start + i] || '');
  state.chatH = chatH;
  state.chatStart = start;
  state.wrapWidth = width;
  const range = selectionRange();
  if (range) {
    for (let i = 0; i < chatH; i++) {
      const line = start + i;
      if (line < range.a.line || line > range.b.line) continue;
      const from = line === range.a.line ? range.a.col : 0;
      const to = line === range.b.line ? range.b.col : width;
      if (to > from) chat[i] = markSelection(chat[i], from, to);
    }
  }

  let frame = [...chat, ...box.lines];
  if (frame.length < rows) frame.push(...Array(rows - frame.length).fill(''));
  frame = frame.slice(0, rows);

  let cursorRow;
  let cursorCol;
  let showCursor;
  if (state.popup) {
    const pop = buildPopupBlock(width, rows);
    const top = Math.max(0, Math.floor((rows - pop.lines.length) / 2));
    const dimmed = frame.map((ln) => `\x1b[2m${plain(ln)}\x1b[0m`);
    for (let i = 0; i < pop.lines.length; i++) {
      const target = top + i;
      if (target < 0 || target >= rows) continue;
      dimmed[target] = fitLine(pop.lines[i], width);
    }
    frame = dimmed;
    cursorRow = Math.min(rows - 1, top + pop.cursorRow);
    cursorCol = Math.min(width - 1, pop.cursorCol);
    showCursor = pop.showCursor;
  } else {
    cursorRow = Math.min(rows - 1, chatH + box.cursorRow);
    cursorCol = Math.min(width - 1, box.cursorCol);
    showCursor = box.showCursor;
  }

  paint(frame, width, rows, cursorRow, cursorCol, showCursor);
}

// ---------- input ----------

let pipedStarted = false;
let pipedEof = false;
let pipedBuf = '';
const pipedQueue = [];
const pipedWaiters = [];

function onPipedData(chunk) {
  pipedBuf += chunk;
  let idx;
  while ((idx = pipedBuf.indexOf('\n')) !== -1) {
    const line = pipedBuf.slice(0, idx).replace(/\r$/, '');
    pipedBuf = pipedBuf.slice(idx + 1);
    const waiter = pipedWaiters.shift();
    if (waiter) waiter(line);
    else pipedQueue.push(line);
  }
}

function onPipedEnd() {
  if (pipedBuf) {
    const line = pipedBuf.replace(/\r$/, '');
    pipedBuf = '';
    const waiter = pipedWaiters.shift();
    if (waiter) waiter(line);
    else pipedQueue.push(line);
  }
  pipedEof = true;
  while (pipedWaiters.length) pipedWaiters.shift()(null);
}

function askPiped(promptText) {
  if (!pipedStarted) {
    pipedStarted = true;
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', onPipedData);
    process.stdin.on('end', onPipedEnd);
    process.stdin.resume();
  }
  process.stdout.write(promptText);
  if (pipedQueue.length) {
    const line = pipedQueue.shift().trim();
    if (line) process.stdout.write(`${line}\n`);
    return Promise.resolve(line);
  }
  if (pipedEof) return Promise.resolve(null);
  return new Promise((resolve) => {
    pipedWaiters.push((value) => {
      if (value === null) return resolve(null);
      const line = value.trim();
      if (line) process.stdout.write(`${line}\n`);
      resolve(line);
    });
  });
}

function ensureKeypress() {
  if (!state.keypressReady) {
    // Timeout ESC pendek: Esc langsung terbaca, tidak menunggu 500 ms lalu
    // bergabung dengan tombol berikutnya (mis. Esc lalu Enter = alt+enter).
    readline.emitKeypressEvents(process.stdin, { escapeCodeTimeout: 30 });
    state.keypressReady = true;
  }
}

export function ask(promptText, { menu = null, select = null, secret = false, text = null, onShiftTab = null, multi = false } = {}) {
  init();
  if (!tty()) return (select || text) ? Promise.resolve(null) : askPiped(promptText);
  ensureKeypress();

  const input = {
    active: !select && !text,
    prompt: (select || text) ? userPrompt() : promptText,
    secret,
    line: '',
    cursor: 0,
    menuSource: menu,
    menu: [],
    menuIndex: 0,
    dismissed: false,
    hist: -1,
    draft: '',
    pasting: false,
    pasteBuf: '',
    pasteCR: false,
  };
  state.input = input;
  state.atPicked = [];
  if (select) {
    const start = Math.max(0, select.findIndex((x) => x && x.cur));
    state.popup = { title: plain(promptText).trim() || 'Pilih', source: [...select], filtered: [...select], query: '', index: start, offset: start, multi, picked: new Set() };
  } else if (text) {
    state.popup = {
      text: true,
      title: plain(promptText).trim() || 'Input',
      label: text.label || '',
      desc: Array.isArray(text.desc) ? text.desc : (text.desc ? [text.desc] : []),
      secret: Boolean(text.secret),
      query: text.value || '',
      validate: typeof text.validate === 'function' ? text.validate : null,
      error: '',
    };
  } else {
    state.popup = null;
  }

  return new Promise((resolve) => {
    let done = false;

    function finish(value) {
      if (done) return;
      done = true;
      state.editor = null;
      state.insertText = null;
      const typed = input.active ? input.line : '';
      const attached = input.active ? state.attachment : null;
      const mark = attached?.type === 'doc' ? '📄' : '📎';
      const shown = attached
        ? `${typed}${typed ? '\n' : ''}${mark} ${attached.name}`
        : typed;
      state.popup = null;
      state.splash = false;
      state.input = { ...state.input, active: false, line: '', cursor: 0 };
      if ((typed || attached) && !input.secret) {
        if (typed.trim().startsWith('/')) {
          log(`${c.lav('›')} ${c.dim(typed)}`);
        } else {
          const width = Math.max(20, (process.stdout.columns || 80) - 1);
          log(userBlockLines(shown, width).join('\n'));
        }
      } else {
        render();
      }
      resolve(value);
    }

    function cancel() {
      shutdown('Keluar.');
      process.exit(0);
    }

    function refreshMenu() {
      if (!input.line) input.dismissed = false;
      let next = [];
      let kind = 'cmd';
      const at = input.dismissed ? null : /@([^\s@]*)$/.exec(input.line);
      if (at && fileSuggest && !input.line.includes('\n')) {
        next = fileSuggest(at[1]) || [];
        kind = 'file';
      } else if (input.menuSource && !input.dismissed && !input.line.includes('\n')) {
        next = filterCommands(input.line, input.menuSource);
      }
      const changed = next.length !== input.menu.length
        || next.some((item, i) => item.cmd !== input.menu[i]?.cmd);
      input.menu = next;
      input.menuKind = kind;
      if (changed) input.menuIndex = 0;
      if (input.menuIndex >= input.menu.length) input.menuIndex = Math.max(0, input.menu.length - 1);
    }

    function insertFilePick(filePath) {
      input.line = input.line.replace(/@([^\s@]*)$/, `@${filePath} `);
      input.cursor = input.line.length;
      if (!state.atPicked.includes(filePath)) state.atPicked.push(filePath);
      input.dismissed = false;
      refreshMenu();
      renderNow();
    }

    function edit(fn) {
      fn();
      input.hist = -1;
      refreshMenu();
      renderNow();
    }

    function insert(text) {
      input.line = input.line.slice(0, input.cursor) + text + input.line.slice(input.cursor);
      input.cursor += text.length;
      input.hist = -1;
      refreshMenu();
      renderNow();
    }

    function syncPopup() {
      const p = state.popup;
      const q = p.query.trim().toLowerCase();
      p.filtered = q
        ? p.source.filter((it) => `${it.label ?? it.cmd ?? ''} ${it.desc || ''}`.toLowerCase().includes(q))
        : p.source;
      p.index = 0;
      p.offset = 0;
    }

    function onPopupKey(str, key) {
      const p = state.popup;
      const name = key.name || '';
      if (key.ctrl && name === 'c') return; // Esc saja untuk batal modal/popup
      if (key.ctrl && name === 'd') return finish(null);
      if (name === 'escape') return finish(null);
      if (name === 'return' || name === 'enter') {
        if (p.text) {
          const err = typeof p.validate === 'function' ? p.validate(p.query) : '';
          if (err) { p.error = err; renderNow(); return; }
          return finish(p.query);
        }
        const item = p.filtered[p.index];
        if (!item) return;
        if (p.multi) {
          const val = (it) => it.value ?? it.label;
          const picked = p.source.filter((it) => p.picked.has(val(it))).map(val);
          if (!picked.length) return finish(item ? [val(item)] : []);
          return finish(picked);
        }
        return finish(item.value ?? item.cmd ?? item.label);
      }
      if (p.text) {
        if (name === 'backspace') {
          p.error = '';
          if (p.query) { p.query = p.query.slice(0, -1); renderNow(); }
          return;
        }
        if (key.ctrl || key.meta) return;
        if (str && !/[\x00-\x1f\x7f]/.test(str)) {
          p.query += str;
          p.error = '';
          renderNow();
        }
        return;
      }
      if (name === 'up') {
        if (p.filtered.length) p.index = (p.index - 1 + p.filtered.length) % p.filtered.length;
        return renderNow();
      }
      if (name === 'down') {
        if (p.filtered.length) p.index = (p.index + 1) % p.filtered.length;
        return renderNow();
      }
      if (name === 'home') { p.index = 0; return renderNow(); }
      if (name === 'end') { p.index = Math.max(0, p.filtered.length - 1); return renderNow(); }
      if (name === 'backspace') {
        if (p.query) { p.query = p.query.slice(0, -1); syncPopup(); renderNow(); }
        return;
      }
      if (key.ctrl || key.meta) return;
      if (name === 'space' && p.multi && p.filtered.length) {
        const item = p.filtered[p.index];
        const val = item.value ?? item.label;
        if (p.picked.has(val)) p.picked.delete(val);
        else if (p.picked.size < 4) p.picked.add(val);
        return renderNow();
      }
      if (str && !/[\x00-\x1f\x7f]/.test(str)) {
        p.query += str;
        syncPopup();
        renderNow();
      }
    }

    function historyMove(dir) {
      if (!state.history.length) return;
      if (dir < 0) {
        if (input.hist === -1) { input.draft = input.line; input.hist = state.history.length - 1; }
        else if (input.hist > 0) input.hist--;
        input.line = state.history[input.hist];
      } else {
        if (input.hist === -1) return;
        if (input.hist < state.history.length - 1) { input.hist++; input.line = state.history[input.hist]; }
        else { input.hist = -1; input.line = input.draft; }
      }
      input.cursor = input.line.length;
      refreshMenu();
      renderNow();
    }

    function submit(value) {
      if (input.menuSource && value) state.history.push(value);
      state.scroll = 0;
      state.sel = null;
      state.mouseDrag = false;
      finish(value);
    }

    function onKey(str, key = {}) {
      const name = key.name || '';
      if (state.popup) return onPopupKey(str, key);

      // Tempel multi-baris: kumpulkan dulu (tanpa render per karakter), lalu sisipkan.
      if (name === 'paste-start') {
        input.pasting = true;
        input.pasteBuf = '';
        input.pasteCR = false;
        return;
      }
      if (input.pasting) {
        if (name === 'paste-end') {
          input.pasting = false;
          const text = input.pasteBuf;
          input.pasteBuf = '';
          if (!text) {
            // Paste kosong = kemungkinan clipboard berisi gambar (Windows Terminal).
            requestClipboard();
            return;
          }
          input.line = input.line.slice(0, input.cursor) + text + input.line.slice(input.cursor);
          input.cursor += text.length;
          input.hist = -1;
          refreshMenu();
          renderNow();
          return;
        }
        let ch = str;
        if (ch === '\r') { ch = '\n'; input.pasteCR = true; }
        else if (ch === '\n') {
          if (input.pasteCR) { input.pasteCR = false; return; } // CRLF
        } else input.pasteCR = false;
        if (ch === '\t') ch = '  ';
        if (!ch || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(ch)) return;
        input.pasteBuf += ch;
        return;
      }
      if (name === 'paste-end') return;

      if (key.ctrl && name === 'o' && input.active && !input.line) return finish('/files');
      if (key.ctrl && name === 'c') {
        if (state.sel) {
          const text = selectionText();
          state.sel = null;
          state.mouseDrag = false;
          if (text.trim()) copySelection(text);
          return renderNow();
        }
        if (state.exitArmed && Date.now() - state.exitArmed < 1500) {
          state.exitArmed = 0;
          return cancel();
        }
        state.exitArmed = Date.now();
        return log(c.dim('  Tekan Ctrl+C lagi untuk keluar.'));
      }
      if (key.ctrl && name === 'd') {
        if (!input.line) return submit(null);
        if (input.cursor >= input.line.length) return;
        return edit(() => { input.line = input.line.slice(0, input.cursor) + input.line.slice(input.cursor + 1); });
      }
      if (name === 'pageup' || key.sequence === '\x1b[5~') {
        const step = Math.max(1, (state.rows || 24) - 12);
        state.scroll += step;
        return renderNow();
      }
      if (name === 'pagedown' || key.sequence === '\x1b[6~') {
        const step = Math.max(1, (state.rows || 24) - 12);
        state.scroll = Math.max(0, state.scroll - step);
        return renderNow();
      }
      if (name === 'return' || name === 'enter') {
        if (input.menu.length) {
          const item = input.menu[input.menuIndex];
          if (input.menuKind === 'file') return insertFilePick(item.cmd);
          input.line = item.cmd;
          return submit(input.line);
        }
        return submit(input.line.trim());
      }
      if (name === 'tab' && (key.shift || key.sequence === '\x1b[Z' || str === '\x1b[Z')) {
        if (onShiftTab) { onShiftTab(); return renderNow(); }
        return;
      }
      if (name === 'tab') {
        if (!input.menu.length) return;
        const item = input.menu[input.menuIndex];
        if (input.menuKind === 'file') return insertFilePick(item.cmd);
        input.line = `${item.cmd} `;
        input.cursor = input.line.length;
        input.dismissed = false;
        refreshMenu();
        return renderNow();
      }
      if (name === 'escape') {
        if (input.menu.length) { input.dismissed = true; refreshMenu(); renderNow(); }
        return;
      }
      if (name === 'up') {
        if (input.menu.length) {
          input.menuIndex = (input.menuIndex - 1 + input.menu.length) % input.menu.length;
          return renderNow();
        }
        return historyMove(-1);
      }
      if (name === 'down') {
        if (input.menu.length) {
          input.menuIndex = (input.menuIndex + 1) % input.menu.length;
          return renderNow();
        }
        return historyMove(1);
      }
      if (name === 'left') return edit(() => { input.cursor = Math.max(0, input.cursor - 1); });
      if (name === 'right') return edit(() => { input.cursor = Math.min(input.line.length, input.cursor + 1); });
      if (name === 'home') return edit(() => { input.cursor = 0; });
      if (name === 'end') return edit(() => { input.cursor = input.line.length; });
      if (name === 'backspace') {
        if (!input.line && state.attachment) {
          state.attachment = null;
          state.clipNotice = '';
          return renderNow();
        }
        if (!input.line && state.clipNotice) {
          state.clipNotice = '';
          return renderNow();
        }
        return edit(() => {
          if (input.cursor > 0) {
            input.line = input.line.slice(0, input.cursor - 1) + input.line.slice(input.cursor);
            input.cursor--;
          }
        });
      }
      if (name === 'delete') {
        return edit(() => {
          if (input.cursor < input.line.length) {
            input.line = input.line.slice(0, input.cursor) + input.line.slice(input.cursor + 1);
          }
        });
      }
      if (key.ctrl && name === 'u') return edit(() => { input.line = input.line.slice(input.cursor); input.cursor = 0; });
      if (key.ctrl && name === 'k') return edit(() => { input.line = input.line.slice(0, input.cursor); });
      if (key.ctrl && name === 'w') {
        return edit(() => {
          const before = input.line.slice(0, input.cursor);
          const kept = before.replace(/\S+\s*$/, '');
          input.line = kept + input.line.slice(input.cursor);
          input.cursor = kept.length;
        });
      }
      if (key.ctrl || key.meta) return;
      if (str && !/[\x00-\x1f\x7f]/.test(str)) insert(str);
    }

    state.insertText = (text) => {
      if (state.popup) {
        state.popup.query += text;
        if (state.popup.text) state.popup.error = '';
        else syncPopup();
        return renderNow();
      }
      input.line = input.line.slice(0, input.cursor) + text + input.line.slice(input.cursor);
      input.cursor += text.length;
      input.hist = -1;
      refreshMenu();
      renderNow();
    };
    state.clipNotice = '';
    if (input.active && state.typeahead) {
      input.line = state.typeahead + input.line;
      input.cursor = input.line.length;
    }
    state.typeahead = '';
    refreshMenu();
    state.editor = onKey;
    renderNow();
  });
}

export function shutdown(message = 'Sampai jumpa.') {
  if (state.closed) return;
  state.closed = true;
  if (state.spin.timer) { clearInterval(state.spin.timer); state.spin.timer = null; state.spin.active = false; }

  if (!tty()) {
    if (message) process.stdout.write(`${message}\n`);
    return;
  }

  process.stdout.off('resize', onResize);
  process.stdin.off('keypress', dispatchKey);
  state.editor = null;
  state.interrupt = null;
  try { process.stdin.setRawMode(false); } catch { /* bukan TTY */ }
  process.stdin.pause();

  // Lepas alternate screen; jangan dump transkrip supaya layar kembali bersih.
  let out = '\x1b[?25h\x1b[?2004l\x1b[?1006l\x1b[?1002l\x1b[?1000l';
  if (state.inAlt) { out += '\x1b[?1049l'; state.inAlt = false; }
  if (message) out += `${message}\r\n`;
  process.stdout.write(out);
}
