import { logoRows, LOGO_WIDTH, LOGO_MIN_WIDTH } from './logo.js';

const ESC = '\x1b[';
export const RESET = `${ESC}0m`;

// Palet ANSI 256. `wrap` di bawah dipakai untuk semua warna agar bisa diganti runtime.
const PALETTES = {
  // Satu aksen (amber) + status; sisanya netral. Warna = informasi, bukan hiasan.
  default: {
    lav: '38;5;180', peach: '38;5;215', mint: '38;5;114', gold: '38;5;220', maroon: '38;5;131',
    amber: '38;5;214', amberHi: '38;5;227',
    dim: '2', bold: '1', selected: '48;5;179;30', userBlock: '48;5;236', popupBg: '48;5;235',
    composerBar: '38;5;220;48;5;236', codeBar: '38;5;114',
    kw: '38;5;204', str: '38;5;214', num: '38;5;179', cmt: '38;5;245', fn: '38;5;117', type: '38;5;110',
    orange: '38;5;220',
  },
  mono: {
    lav: '38;5;253', peach: '38;5;250', mint: '38;5;252', gold: '38;5;255', maroon: '38;5;245',
    amber: '38;5;250', amberHi: '38;5;255',
    dim: '2', bold: '1', selected: '48;5;250;30', userBlock: '48;5;236', popupBg: '48;5;235',
    composerBar: '38;5;253;48;5;236', codeBar: '38;5;250',
    kw: '1', str: '38;5;253', num: '38;5;250', cmt: '2', fn: '38;5;252', type: '38;5;252',
    orange: '38;5;250',
  },
  kontras: {
    lav: '38;5;45', peach: '38;5;214', mint: '38;5;46', gold: '38;5;226', maroon: '38;5;196',
    amber: '38;5;214', amberHi: '38;5;231',
    dim: '2', bold: '1', selected: '48;5;226;30', userBlock: '48;5;235', popupBg: '48;5;234',
    composerBar: '38;5;226;48;5;235', codeBar: '38;5;46',
    kw: '38;5;201', str: '38;5;226', num: '38;5;208', cmt: '38;5;244', fn: '38;5;51', type: '38;5;39',
    orange: '38;5;214',
  },
};

export const THEMES = Object.keys(PALETTES);
let current = 'default';
let plainMode = false;
export const c = {};

// Tema tambahan dari ~/.beot/themes.json: hanya kode SGR (angka/titik-koma),
// supaya file tema tidak bisa menyuntik escape terminal.
export function registerThemes(map) {
  const allowed = new Set(Object.keys(PALETTES.default));
  const builtin = new Set(['default', 'mono', 'kontras']);
  let added = 0;
  let skipped = 0;
  for (const [name, palette] of Object.entries(map || {})) {
    if (!/^[a-z0-9_-]{1,24}$/i.test(name) || builtin.has(name) || !palette || typeof palette !== 'object') {
      skipped += 1;
      continue;
    }
    const clean = {};
    for (const [key, value] of Object.entries(palette)) {
      if (allowed.has(key) && typeof value === 'string' && /^[0-9;]{1,24}$/.test(value)) clean[key] = value;
    }
    if (!Object.keys(clean).length) {
      skipped += 1;
      continue;
    }
    PALETTES[name] = { ...PALETTES.default, ...clean };
    added += 1;
  }
  return { added, skipped };
}

export function themeNames() {
  return Object.keys(PALETTES);
}

function build() {
  const p = PALETTES[current] || PALETTES.default;
  const color = (code) => (plainMode ? (s) => String(s) : (s) => `${ESC}${code}m${s}${RESET}`);
  for (const [key, code] of Object.entries(p)) c[key] = color(code);
}
build();

// Mode pipe: keluaran polos tanpa escape warna.
export function setPlain(on) {
  plainMode = Boolean(on);
  build();
}

export function setTheme(name) {
  if (PALETTES[name]) current = name;
  build();
  return current;
}

export function themeName() {
  return current;
}

export function raw(key) {
  return (PALETTES[current] || PALETTES.default)[key] || '';
}

export function banner({ persona, model, file = '', width = 60 }) {
  const w = Math.max(30, width);
  const meta = [persona, model].filter(Boolean).join(' · ');
  if (w >= LOGO_MIN_WIDTH) {
    const rows = logoRows();
    const leftW = LOGO_WIDTH + 1; // 1 spasi depan
    const room = Math.max(8, w - leftW - 2);
    const fit = (text) => (text.length > room ? `${text.slice(0, Math.max(1, room - 1))}…` : text);
    const gap = (text) => ' '.repeat(Math.max(2, w - leftW - text.length));
    const m = fit(meta);
    const note = fit(file ? `berkas ${file}` : 'v0.1');
    const line1 = ` ${c.gold(rows[0])}`;
    const line2 = ` ${c.gold(rows[1])}${gap(m)}${c.dim(m)}`;
    const line3 = ` ${c.gold(rows[2])}${gap(note)}${file ? c.gold(note) : c.dim(note)}`;
    return [
      line1,
      line2,
      line3,
      c.dim('─'.repeat(w)),
      ` ${c.dim('ketik')} ${c.gold('/')} ${c.dim('untuk menu')}`,
    ].join('\n');
  }
  const pad = Math.max(2, w - 11 - meta.length);
  const line1 = ` ${c.gold('◆')} ${c.bold('beot')} ${c.dim('0.1')}${' '.repeat(pad)}${c.dim(meta)}`;
  const line2 = c.dim('═'.repeat(w));
  const hint = ` ${c.dim('ketik')} ${c.gold('/')} ${c.dim('untuk menu')}${file ? `   ${c.dim('berkas')} ${c.gold(file)}` : ''}`;
  return `${line1}\n${line2}\n${hint}`;
}

export const hr = (width = 58) => c.dim('─'.repeat(width));

export const userPrompt = () => `${c.gold('Kamu >')} `;
export const botPrefix = () => `${c.gold('◆')} ${c.bold('Beot')}\n\n`;
export const ok = (s) => `${c.mint('✓')} ${s}`;
export const warn = (s) => `${c.maroon('⚠')} ${s}`;
