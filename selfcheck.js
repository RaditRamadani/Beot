// Self-check: logika yang gampang rusak tanpa perlu API key.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseSSEChunk, errorMessage } from './lib/llm.js';
import { loadPersonas } from './lib/persona.js';
import { parseSkillFile, loadSkillsFrom, loadSkillsFromMany } from './lib/skills.js';
import { buildSkillTools, runSkillTool } from './lib/skilltool.js';
import { readDoc, MAX_CHARS } from './lib/readfile.js';
import { isLocal, DEFAULTS, HOME_DIR, LEGACY_DIR, hostChanged } from './lib/config.js';
import { COMMANDS, filterCommands } from './lib/commands.js';
import { PROVIDERS, findProvider, mergeModels } from './lib/providers.js';
import { visualWidth, ask, log as tuiLog, append, clearLog, init as tuiInit, setStatus, renderNow, info, confirmInline, beginInterrupt, endInterrupt, markLog, rollbackLog, diffBlock, tableLines, stripEsc, ledgerLine } from './lib/tui.js';
import { highlight } from './lib/highlight.js';
import { userContent, contentChars } from './lib/attach.js';
import { resolveInside, listDir, writeFileTool, runFileTool, sensitiveReason, editFileTool } from './lib/filetools.js';
import { normalizeTodos, runTodoTool } from './lib/todo.js';
import { appendTurn, readSession } from './lib/session.js';
import { buildCompactInput, compactedHistory } from './lib/compact.js';
import { runShellTool } from './lib/shell.js';
import { buildWebTool, runWebTool, isPrivateHost, isPrivateIp, resolveSafe, htmlToText } from './lib/web.js';
import { costOf, priceFor, fmtUsd } from './lib/cost.js';
import { compareVersion } from './lib/update.js';
import { memoryPrompt, appendMemory, buildInitMemory } from './lib/memory.js';
import { buildPdf, buildXlsx, buildDocx, buildRtf, runExportTool } from './lib/exporttool.js';
import { buildDiff, buildNewFileDiff } from './lib/diff.js';
import { banner, c as themeColors, setTheme, registerThemes, themeNames } from './ui/theme.js';
import { logoRows, LOGO_WIDTH } from './ui/logo.js';

process.env.BEOT_NO_CLIPBOARD = '1'; // jangan sentuh clipboard OS saat selftest

let passed = 0;
const check = (name, fn) => {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}\n       ${err.message}`);
    process.exitCode = 1;
  }
};

const acheck = async (name, fn) => {
  try {
    await fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}\n       ${err.message}`);
    process.exitCode = 1;
  }
};

check('SSE: data terpotong antar-chunk', () => {
  const first = parseSSEChunk('data: {"choices":[{"delta":{"content":"ha');
  assert.deepEqual(first.deltas, []);
  const second = parseSSEChunk(first.rest + 'i"}}]}\ndata: [DONE]\n');
  assert.deepEqual(second.deltas, ['hai']);
  assert.equal(second.done, true);
});

check('SSE: baris rusak dilewati', () => {
  const out = parseSSEChunk('data: bukan-json\ndata: {"choices":[{"delta":{"content":"ok"}}]}\n');
  assert.deepEqual(out.deltas, ['ok']);
});

check('SSE: finish_reason menandai selesai', () => {
  const out = parseSSEChunk('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n');
  assert.equal(out.finish, 'stop');
  assert.equal(parseSSEChunk('data: {"choices":[{"delta":{"content":"a"}}]}\n').finish, null);
});

check('SSE: tool_calls dirakit dari delta', () => {  const acc = [];
  const c1 = { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'skill', arguments: '{"na' } }] } }] };
  const c2 = { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'me":"code-review"}' } }] } }] };
  parseSSEChunk(`data: ${JSON.stringify(c1)}\n`, acc);
  parseSSEChunk(`data: ${JSON.stringify(c2)}\n`, acc);
  assert.equal(acc.length, 1);
  assert.equal(acc[0].id, 'call_1');
  assert.equal(acc[0].function.name, 'skill');
  assert.equal(acc[0].function.arguments, '{"name":"code-review"}');
});

check('SSE: reasoning_content ditangkap', () => {
  const out = parseSSEChunk('data: {"choices":[{"delta":{"reasoning_content":"pikir "}}]}\n');
  assert.deepEqual(out.reasoning, ['pikir ']);
  assert.deepEqual(out.deltas, []);
  const alt = parseSSEChunk('data: {"choices":[{"delta":{"reasoning":"a"}}]}\n');
  assert.deepEqual(alt.reasoning, ['a']);
});

check('SSE: error provider di dalam stream dilempar', () => {
  assert.throws(
    () => parseSSEChunk('data: {"error":{"message":"gateway meledak"}}\n'),
    /Provider: gateway meledak/,
  );
  // Error tanpa pesan tetap dilempar, bukan ditelan.
  assert.throws(() => parseSSEChunk('data: {"error":true}\n'), /Provider: error dari provider/);
  // Payload normal tetap jalan.
  assert.deepEqual(parseSSEChunk('data: {"choices":[{"delta":{"content":"ok"}}]}\n').deltas, ['ok']);
});

check('Tabel markdown: rata, berbingkai, di-wrap', () => {
  const block = [
    '| Kategori | Contoh |',
    '|---|:---:|',
    '| Bisnis | Juara 1 *National Business Plan Competition* regional dan nasional |',
    '| Digital | GDSC Solution Challenge |',
  ];
  const lines = tableLines(block, 52);
  assert.ok(lines[0].startsWith('╭'), 'bingkai atas');
  assert.ok(lines.at(-1).startsWith('╰'), 'bingkai bawah');
  assert.ok(lines.some((l) => l.includes('┼')), 'pemisah header');
  assert.ok(lines.some((l) => l.includes('Kategori') && l.includes('Contoh')), 'header satu baris');
  assert.ok(!lines.join('\n').includes('---'), 'baris pemisah markdown tidak tampil');
  assert.ok(!lines.join('\n').includes('*'), 'marker * dibersihkan');
  assert.equal(lines.filter((l) => l.includes('┼')).length, 2, 'garis pemisah antar baris');
  for (const l of lines) assert.ok(visualWidth(l) <= 52, `lebar baris ${visualWidth(l)} ≤ 52`);
  // Tanpa baris pemisah: tetap rapi, tanpa header tebal.
  const plain = tableLines(['| a | b |', '| c | d |'], 40);
  assert.ok(plain[0].startsWith('╭') && plain.join('\n').includes('│ a │ b │'));
  assert.equal(plain.filter((l) => l.includes('┼')).length, 1, 'satu pemisah untuk dua baris');
  // Sel **tebal** tetap dibuat tebal (ANSI), marker tidak bocor.
  const bold = tableLines(['| n |', '| **396** |'], 20).join('\n');
  assert.ok(!bold.includes('**'));
  assert.ok(bold.includes('\x1b[1m'), 'sel tebal ber-ANSI bold');
  // Kolom angka rata kanan.
  const num = tableLines(['| a | b |', '|---|---|', '| x | 5 |', '| yy | 41 |'], 40).join('\n');
  const rowsNum = num.split('\n').filter((l) => l.includes('│'));
  assert.ok(rowsNum.some((l) => /│ x\s+│\s+5\s+│/.test(l)), 'angka nempel kanan');
  assert.ok(rowsNum.some((l) => /│ yy\s+│\s+41\s+│/.test(l)), 'lebar tetap lurus');
  // Kolom teks tetap rata kiri.
  const txt = tableLines(['| a | b |', '|---|---|', '| isian | data teks |'], 40).join('\n');
  assert.ok(txt.includes('│ isian │ data teks │'));
  // Pipe di dalam sel di-escape `\|` dan tidak memecah kolom.
  const escaped = tableLines(['| a | b |', '|---|---|', '| x \\| y | z |'], 30).join('\n');
  assert.ok(escaped.includes('x | y') && escaped.includes('│ z'), 'pipe ter-escape tetap satu sel');
  // Kata panjang tanpa spasi dipotong paksa: tabel tidak melewati lebar terminal.
  const word = tableLines(['| a | b |', '|---|---|', '| https://contoh.panjangsekali/alamat | ok |'], 24);
  for (const l of word) assert.ok(visualWidth(l) <= 24, `kata panjang dipotong (${visualWidth(l)} ≤ 24)`);
});

check('UI: baris buku besar (label ········ ukuran)', () => {
  const line = ledgerLine('baca data.csv', '✓ 0.1 s', 40);
  assert.equal(visualWidth(line), 40, 'tepat selebar terminal');
  assert.ok(line.trimEnd().endsWith('✓ 0.1 s'), 'ukuran rata kanan');
  assert.ok(line.includes('·'), 'titik penghubung');
  assert.ok(visualWidth(ledgerLine('jalankan npm test', '', 40)) <= 40, 'tanpa ukuran tetap muat');
  assert.ok(visualWidth(ledgerLine('x'.repeat(50), '✓', 30)) <= 32, 'label kepanjangan tidak melewati layar');
});

check('Daftar model: merge aktif + live + statis tanpa duplikat & urutan', () => {
  assert.deepEqual(mergeModels('aktif', ['b', 'aktif', 'c'], ['a', 'b']), ['aktif', 'b', 'c', 'a']);
  assert.deepEqual(mergeModels(null, [], []), []);
  assert.deepEqual(mergeModels(null, ['x'], ['x', 'y']), ['x', 'y']);
});

check('Persona bawaan: 2 file valid (build, plan)', () => {
  const personas = loadPersonas();
  assert.equal(personas.length, 2);
  const names = personas.map((p) => p.nama).sort();
  assert.deepEqual(names, ['build', 'plan']);
  for (const p of personas) {
    assert.ok(p.nama && p.system_prompt);
    assert.equal(typeof p.suhu, 'number');
  }
});

check('Skill: parse frontmatter', () => {
  const skill = parseSkillFile('---\nnama: coba\ndeskripsi: tes\n---\n\nIsi instruksi.\n');
  assert.equal(skill.nama, 'coba');
  assert.equal(skill.isi, 'Isi instruksi.');
});

check('Skill: skip file tanpa metadata', () => {
  assert.equal(parseSkillFile('tanpa frontmatter'), null);
});

check('Skill: scan folder', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'beot-skills-'));
  fs.writeFileSync(path.join(dir, 'a.md'), '---\nnama: a\ndeskripsi: x\n---\nisi\n');
  fs.writeFileSync(path.join(dir, 'b.md'), 'rusak tanpa header\n');
  const skills = loadSkillsFrom(dir);
  assert.equal(skills.length, 1);
  assert.equal(skills[0].nama, 'a');
});

check('Skill tool: katalog + muat + error', () => {
  const tools = buildSkillTools();
  assert.equal(tools[0].function.name, 'skill');
  assert.deepEqual(tools[0].function.parameters.required, ['name']);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'beot-skilltool-'));
  fs.writeFileSync(path.join(dir, 'x.md'), '---\nnama: x\ndeskripsi: tes\n---\nIsi X.');
  const good = runSkillTool('skill', JSON.stringify({ name: 'x' }), dir);
  assert.equal(good.skill, 'x');
  assert.ok(good.content.includes('Isi X'), 'isi skill termuat');
  const missing = runSkillTool('skill', JSON.stringify({ name: 'nope' }), dir);
  assert.ok(missing.error.includes('tidak ada'), 'skill tak dikenal');
  const broken = runSkillTool('skill', '{rusak', dir);
  assert.ok(broken.error.includes('JSON'), 'argumen rusak');
  fs.rmSync(dir, { recursive: true, force: true });
});

check('File: baca txt', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'beot-file-'));
  const file = path.join(dir, 'catatan.md');
  fs.writeFileSync(file, 'halo tugas');
  const doc = readDoc(file);
  assert.equal(doc.text, 'halo tugas');
  assert.equal(doc.kind, 'md');
});

check('File: potong kalau kepanjangan', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'beot-big-'));
  const file = path.join(dir, 'besar.txt');
  fs.writeFileSync(file, 'x'.repeat(MAX_CHARS + 100));
  const doc = readDoc(file);
  assert.equal(doc.text.length, MAX_CHARS);
  assert.equal(doc.truncated, true);
});

check('File: .docx ditolak jelas', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'beot-docx-'));
  const file = path.join(dir, 'laporan.docx');
  fs.writeFileSync(file, 'x');
  assert.throws(() => readDoc(file), /docx/i);
});

check('File: path tidak ada', () => {
  assert.throws(() => readDoc('C:/tidak/ada/file.txt'), /tidak ditemukan/i);
});

check('Config: direktori & nama Beot', () => {
  assert.ok(HOME_DIR.endsWith('.beot'), 'config baru di ~/.beot');
  assert.ok(LEGACY_DIR.endsWith('.byok-chat'), 'folder lama dikenali untuk migrasi');
  assert.equal(isLocal('http://localhost:11434/v1'), true);
  assert.equal(isLocal('https://api.openai.com/v1'), false);
});

check('Menu: filter perintah live', () => {
  assert.equal(filterCommands('/', COMMANDS).length, COMMANDS.length);
  assert.ok(COMMANDS.some((x) => x.cmd === '/status'), 'perintah /status ada');
  assert.ok(COMMANDS.some((x) => x.cmd === '/cd'), 'perintah /cd ada');
  assert.ok(COMMANDS.some((x) => x.cmd === '/add-dir'), 'perintah /add-dir ada');
  assert.equal(DEFAULTS.stream_timeout, 90, 'default timeout stream 90 dtk');
  assert.equal(DEFAULTS.write_confirm, true, 'default tulis = tanya dulu');
  assert.equal(DEFAULTS.external, 'ask', 'default path luar = tanya dulu');
  assert.equal(DEFAULTS.shell, 'ask', 'default shell = tanya dulu');
  assert.equal(DEFAULTS.owner, 'Radit', 'default pemilik aplikasi');
  assert.equal(DEFAULTS.thinking, true, 'default tampilkan thought');
  assert.deepEqual(filterCommands('/sk', COMMANDS).map((x) => x.cmd), ['/skill']);
  assert.deepEqual(filterCommands('/zzz', COMMANDS), []);
  assert.deepEqual(filterCommands('/model base', COMMANDS), []);
});

check('Config: ganti host = key lama tidak ikut', () => {
  assert.equal(hostChanged('https://a.test/v1', 'https://a.test/v1/'), false, 'path sama = host sama');
  assert.equal(hostChanged('https://a.test/v1', 'https://b.test/v1'), true, 'host beda terdeteksi');
  assert.equal(hostChanged('http://localhost:11434/v1', 'http://127.0.0.1:11434/v1'), true, 'port/host beda');
  assert.equal(hostChanged('bukan-url', 'bukan-url'), false, 'nilai rusak dibandingkan apa adanya');
});

check('UI: lebar teks mengabaikan ANSI', () => {
  assert.equal(visualWidth('\x1b[31mabc\x1b[0m'), 3);
  assert.equal(visualWidth('Kamu > '), 7);
  // Emoji/simbol lebar = 2 sel (kalau 1, baris wrap -> layar geser di terminal asli)
  assert.equal(visualWidth('⭐'), 2, 'emoji lebar');
  assert.equal(visualWidth('✅ ⏳ ⌚'), 8, 'simbol Emoji_Presentation');
  assert.equal(visualWidth('日本'), 4, 'CJK');
  assert.ok(visualWidth('❤️') >= 2, 'base + VS16 tidak boleh under-count');
  assert.equal(visualWidth('a‍b'), 2, 'ZWJ tidak menambah lebar');
});

check('ANSI: C1/DCS/OSC ikut dibuang, bukan cuma CSI', () => {
  assert.equal(stripEsc('\x1b[31mMERAH\x1b[0m'), 'MERAH');
  assert.equal(stripEsc('\x1b]52;c;AAAA\x07X'), 'X', 'OSC dibuang');
  assert.equal(stripEsc('\x9b31mC1CSI'), '31mC1CSI', 'C1 CSI dibuang');
  assert.equal(stripEsc('\x1bP1;2|DCS\x1b\\aman'), 'aman', 'DCS sampai ST dibuang');
  assert.equal(stripEsc('nama\x1b[?25l'), 'nama');
});

check('Highlight: keyword, string, angka, komentar, fungsi', () => {
  const out = highlight('const x = "hi"; // note\nlet n = 42;', 'js');
  assert.ok(out.includes('\x1b[38;5;204m'), 'keyword berwarna');
  assert.ok(out.includes('\x1b[38;5;214m'), 'string berwarna');
  assert.ok(out.includes('\x1b[38;5;179m'), 'angka berwarna');
  assert.ok(out.includes('\x1b[38;5;245m'), 'komentar berwarna');
  assert.ok(highlight('foo(1);', 'js').includes('\x1b[38;5;117m'), 'nama fungsi berwarna');
  assert.equal(visualWidth(out), visualWidth('const x = "hi"; // note\nlet n = 42;'), 'lebar tidak berubah');
});

check('Logo: 3 baris rata + banner fallback', () => {
  const rows = logoRows();
  assert.equal(rows.length, 3, 'tiga baris');
  for (const row of rows) assert.equal(row.length, LOGO_WIDTH, 'lebar seragam');
  const wide = banner({ persona: 'build', model: 'm', width: 80 });
  assert.ok(wide.includes('█▀▀▄'), 'banner lebar memuat logo');
  const narrow = banner({ persona: 'build', model: 'm', width: 40 });
  assert.ok(!narrow.includes('█▀▀▄'), 'tanpa logo di terminal sempit');
  assert.equal(narrow.split('\n').length, 3, 'fallback tiga baris');
});

check('Update: bandingkan versi', () => {
  assert.equal(compareVersion('0.1.0', '0.1.0'), 0, 'sama');
  assert.equal(compareVersion('v0.2.0', '0.1.0'), 1, 'v prefix + lebih baru');
  assert.equal(compareVersion('0.1.0', '0.2.0'), -1, 'lebih lama');
  assert.equal(compareVersion('0.10.0', '0.9.9'), 1, 'numerik, bukan string');
  assert.equal(compareVersion('1.0.0-beta', '1.0.0'), -1, 'prerelease lebih lama');
  assert.equal(compareVersion('1.0.0', '1.0.0-beta'), 1, 'rilis lebih baru dari prerelease');
});

check('Theme: 5 bawaan + nord', () => {
  for (const name of ['default', 'mono', 'kontras', 'nord', 'senja']) {
    assert.ok(themeNames().includes(name), `${name} tersedia`);
  }
  setTheme('nord');
  try {
    assert.ok(themeColors.gold('x').includes('38;5;75'), 'nord memakai biru dingin');
  } finally {
    setTheme('default');
  }
});

check('Theme: palet bisa diganti', () => {
  const before = themeColors.mint('x');
  setTheme('mono');
  try {
    assert.notEqual(themeColors.mint('x'), before, 'warna berubah');
    assert.equal(setTheme('tidak-ada'), 'mono', 'nama tak dikenal diabaikan');
  } finally {
    setTheme('default');
  }
  assert.equal(themeColors.mint('x'), before, 'kembali ke default');
});

check('Theme: kustom dari themes.json + validasi kode', () => {
  const res = registerThemes({
    'kustom-uji': { gold: '38;5;208', lav: '38;5;180' },
    default: { gold: '1' },
    jahat: { gold: '38;5;220m\x1b[31' },
    kosong: {},
  });
  assert.ok(themeNames().includes('kustom-uji'), 'tema sah terdaftar');
  assert.ok(!themeNames().includes('jahat'), 'kode injeksi ditolak');
  assert.equal(res.added, 1, 'hanya satu tema sah');
  assert.ok(res.skipped >= 3, 'bawaan/kosong/injeksi dilewati');
  setTheme('kustom-uji');
  try {
    assert.ok(themeColors.gold('x').includes('38;5;208'), 'kode kustom dipakai');
    assert.ok(!themeColors.gold('x').includes('\x1b[31m'), 'escape tidak bocor');
  } finally {
    setTheme('default');
  }
});

check('Attach: content multimodal + estimasi', () => {
  const img = { type: 'image', mime: 'image/png', data: 'AAA', name: 'x.png', bytes: 3 };
  const arr = userContent('halo', img);
  assert.ok(Array.isArray(arr), 'gambar menghasilkan content array');
  assert.equal(arr[0].type, 'text');
  assert.ok(arr[1].image_url.url.startsWith('data:image/png;base64,'), 'data URL');
  assert.equal(userContent('halo', null), 'halo', 'tanpa gambar tetap string');
  const doc = { type: 'doc', name: 'a.txt', text: 'ISI', truncated: false };
  const txt = userContent('ringkas', doc);
  assert.ok(txt.includes('[DOKUMEN: a.txt]') && txt.includes('ISI') && txt.startsWith('ringkas'));
  assert.equal(userContent('', doc), '[DOKUMEN: a.txt]\nISI');
  assert.equal(contentChars('abcd'), 4);
  assert.ok(contentChars(arr) > 4000, 'estimasi gambar dihitung');
});

check('Error: body HTML dibuang, JSON diambil pesannya', () => {
  assert.equal(errorMessage('<!DOCTYPE html><html><body>524</body></html>'), '');
  assert.equal(errorMessage('{"error":{"message":"model overloaded"}}'), 'model overloaded');
  assert.equal(errorMessage('  plain   error '), 'plain error');
  assert.equal(errorMessage(''), '');
});

check('File tools: path di luar folder kerja ditolak', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'beot-sandbox-'));
  assert.throws(() => resolveInside('../jail.txt', dir), /luar folder kerja/);
  assert.equal(resolveInside('a.txt', dir), path.join(dir, 'a.txt'));
  fs.rmSync(dir, { recursive: true, force: true });
});

check('Provider: katalog & deteksi base_url', () => {
  assert.ok(PROVIDERS.length >= 6);
  assert.equal(new Set(PROVIDERS.map((p) => p.id)).size, PROVIDERS.length);
  for (const p of PROVIDERS) {
    assert.ok(p.nama && p.catatan, `provider ${p.id} lengkap`);
    if (p.id !== 'custom') assert.ok(p.base_url.startsWith('http'), `base_url ${p.id}`);
    if (!p.keyless && p.id !== 'custom') assert.ok(p.models.length > 0, `model ${p.id}`);
  }
  assert.equal(findProvider('https://api.groq.com/openai/v1/')?.id, 'groq');
  assert.equal(findProvider('http://localhost:11434/v1')?.id, 'ollama');
  assert.equal(findProvider('https://contoh.test/v1'), null);
});

// Editor TTY disimulasikan: tidak butuh terminal asli, cukup event keypress.
let editorSaved;
try {
  const stdin = process.stdin;
  editorSaved = {
    inTTY: stdin.isTTY,
    outTTY: process.stdout.isTTY,
    raw: stdin.setRawMode,
    resume: stdin.resume,
    pause: stdin.pause,
    write: process.stdout.write,
  };
  const chunks = [];
  const plain = () => chunks.join('')
    .replace(/\x1b\[[0-9;]*[ABCDEFGHJKSTfmins]/g, '') // cursor positioning, clear, etc.
    .replace(/\x1b\[[0-9;]*m/g, '');                    // colors
  const press = async (name, str = '', extra = {}) => {
    stdin.emit('keypress', str, { name, ...extra });
    await new Promise((r) => setImmediate(r));
  };
  const type = async (text) => {
    for (const ch of text) await press(ch, ch);
  };

  stdin.isTTY = true;
  process.stdout.isTTY = true;
  process.stdout.columns = 80;
  process.stdout.rows = 24;
  stdin.setRawMode = () => {};
  stdin.resume = () => {};
  stdin.pause = () => {};
  process.stdout.write = (s) => { chunks.push(String(s)); return true; };

  // Inisialisasi TUI
  tuiInit();
  setStatus(() => ({ left: 'build · gemini-2.0-flash', right: 'ctx 0 · / menu' }));
  await new Promise((r) => setTimeout(r, 60)); // tunggu render awal

  chunks.length = 0;
  let p = ask('Kamu > ', { menu: COMMANDS });
  await type('x');
  const inputRow = chunks.join('').split('\r\n')
    .find((ln) => ln.includes('48;5;236') && ln.includes(' x'));
  assert.ok(inputRow && inputRow.includes('\x1b[0m\x1b[48;5;236m'), 'composer: latar gelap penuh di baris input');
  const statusRow = chunks.join('').split('\r\n')
    .find((ln) => ln.includes('build') && ln.includes('ctx 0'));
  assert.ok(statusRow, 'status: persona & ctx sejajar dalam satu baris');
  const statusRows = chunks.join('').split('\r\n');
  const statusIndex = statusRows.findIndex((ln) => ln.includes('build') && ln.includes('ctx 0'));
  const stripAnsi = (ln) => (ln || '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
  assert.equal(stripAnsi(statusRows[statusIndex - 1]).trim(), '', 'status diberi jarak dari blok chat');
  await press('backspace');
  assert.ok(plain().includes('Ketik pesan'), 'placeholder tampil saat input kosong');
  chunks.length = 0;
  await type('/');
  assert.ok(!plain().includes('›'), 'palette: composer disembunyikan');
  assert.ok(plain().includes('build · gemini-2.0-flash'), 'palette: status tetap tampil');
  assert.ok(plain().split('\n').some((ln) => ln.includes('build') && ln.includes('ctx 0')), 'palette: status satu baris');
  assert.ok(plain().includes('tab lengkapi') && plain().includes('/persona'), 'palette / tampil');
  const selected = chunks.join('').split('\r\n').find((ln) => ln.includes('48;5;33'));
  const selectedPlain = (selected || '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
  assert.equal(visualWidth(selectedPlain), 79, 'baris terpilih biru selebar layar');
  await press('down');
  await press('return', '\r');
  assert.equal(await p, '/skill', 'panah + Enter menjalankan pilihan');

  chunks.length = 0;
  let cycled = 0;
  p = ask('Kamu > ', { menu: COMMANDS, onShiftTab: () => { cycled++; } });
  await press('tab', '', { shift: true });
  assert.equal(cycled, 1, 'Shift+Tab mengganti persona');
  await press('d', '\x04', { ctrl: true });
  assert.equal(await p, null, 'Shift+Tab tidak mengirim input');
  chunks.length = 0;
  p = ask('Kamu > ', { menu: COMMANDS });
  await type('/tu');
  await press('tab');
  await type('README.md');
  await press('return', '\r');
  assert.equal(await p, '/tugas README.md', 'Tab mengisi perintah + spasi');

  chunks.length = 0;
  p = ask('Kamu > ', { menu: COMMANDS });
  await type('/');
  chunks.length = 0;
  await press('escape');
  assert.ok(!plain().includes('/persona'), 'Esc menutup palette');
  assert.ok(plain().includes('›'), 'composer kembali setelah Esc');
  chunks.length = 0;
  await type('p');
  assert.ok(!plain().includes('/persona'), 'menu tetap tertutup setelah Esc (tidak muncul lagi)');
  await press('return', '\r');
  assert.equal(await p, '/p', 'Esc menutup menu (Enter mengirim teks, bukan item terpilih)');

  chunks.length = 0;
  for (let i = 1; i <= 30; i++) tuiLog(`baris ${i}`);
  renderNow();
  p = ask('Kamu > ', { menu: COMMANDS });
  chunks.length = 0;
  await press('pageup');
  assert.ok(!plain().includes('baris 30'), 'PgUp menggulir ke atas');
  assert.ok(plain().includes('PgDn'), 'indikator scroll tampil');
  await press('pagedown');
  assert.ok(plain().includes('baris 30'), 'PgDn menggulir ke bawah');
  const logMark = markLog();
  tuiLog('baris rollback-hapus');
  chunks.length = 0;
  rollbackLog(logMark);
  assert.ok(!plain().includes('baris rollback-hapus'), 'rollback log menghapus teks parsial');
  const wheel = async (code) => {
    stdin.emit('keypress', undefined, { sequence: '\x1b[<', name: 'undefined' });
    for (const ch of `${code};10;5M`) stdin.emit('keypress', ch, { sequence: ch, name: ch });
    await new Promise((r) => setImmediate(r));
  };
  const mouse = async (code, x, y, term = 'M') => {
    stdin.emit('keypress', undefined, { sequence: '\x1b[<', name: 'undefined' });
    for (const ch of `${code};${x};${y}${term}`) stdin.emit('keypress', ch, { sequence: ch, name: ch });
    await new Promise((r) => setImmediate(r));
  };
  chunks.length = 0;
  await wheel(64);
  assert.ok(!plain().includes('baris 30'), 'roda mouse menggulir ke atas');
  assert.ok(plain().includes('PgDn'), 'roda mouse menampilkan indikator scroll');
  await press('up');
  assert.ok(!plain().includes('baris 30'), 'panah Up tetap untuk riwayat, bukan scroll');
  await press('u', '\x15', { ctrl: true });
  chunks.length = 0;
  await wheel(65);
  assert.ok(plain().includes('baris 30'), 'roda mouse menggulir ke bawah');
  chunks.length = 0;
  await mouse(0, 1, 1);
  await mouse(32, 9, 1);
  assert.ok(chunks.join('').includes('\x1b[7m'), 'drag menyeleksi (highlight)');
  await mouse(0, 9, 1, 'm');
  const osc = chunks.join('').match(/\x1b\]52;c;([A-Za-z0-9+/=]+)\x07/);
  assert.ok(osc, 'seleksi otomatis copy (OSC 52)');
  assert.ok(Buffer.from(osc[1], 'base64').toString('utf8').includes('baris'), 'teks tersalin dari transkrip');
  assert.ok(!plain().includes('disalin'), 'tanpa notifikasi copy di composer');
  await mouse(0, 1, 1);
  await mouse(0, 1, 1, 'm');
  chunks.length = 0;
  await mouse(0, 1, 1);
  await mouse(32, 8, 1);
  chunks.length = 0;
  await press('c', '\x03', { ctrl: true });
  assert.ok(chunks.join('').includes('\x1b]52;c;'), 'Ctrl+C saat seleksi = salin (tidak keluar)');
  chunks.length = 0;
  await press('c', '\x03', { ctrl: true });
  assert.ok(plain().includes('Tekan Ctrl+C lagi untuk keluar'), 'Ctrl+C sekali = minta konfirmasi');
  chunks.length = 0;
  await type('/');
  assert.ok(plain().includes('baris 30'), 'palette tidak menghilangkan transkrip');
  await press('escape');
  await press('backspace');
  await press('d', '\x04', { ctrl: true });
  assert.equal(await p, null, 'EOF setelah scroll');

  chunks.length = 0;
  p = ask('Pilih skill', {
    select: [
      { label: 'code-review', value: 'code-review' },
      { label: 'debug', value: 'debug' },
    ],
  });
  await press('down');
  await press('return', '\r');
  assert.equal(await p, 'debug', 'popup: panah memindah pilihan');

  chunks.length = 0;
  p = ask('Kamu > ', { menu: COMMANDS });
  stdin.emit('keypress', '\x1b[200~', { name: 'paste-start', sequence: '\x1b[200~' });
  for (const ch of 'baris satu\r\nbaris dua\nbaris tiga') {
    const name = ch === '\r' ? 'return' : ch === '\n' ? 'enter' : ch;
    stdin.emit('keypress', ch, { name, sequence: ch });
  }
  stdin.emit('keypress', '\x1b[201~', { name: 'paste-end', sequence: '\x1b[201~' });
  await new Promise((r) => setImmediate(r));
  renderNow();
  assert.ok(plain().includes('baris dua') && plain().includes('baris tiga'), 'tempel multi-baris tampil di composer');
  await press('return', '\r');
  assert.equal(await p, 'baris satu\nbaris dua\nbaris tiga', 'tempel multi-baris dikirim utuh');
  assert.ok(plain().includes('baris dua'), 'semua baris pesan tampil di transkrip');

  chunks.length = 0;
  clearLog();
  chunks.length = 0;
  append('contoh:\n```js\nconst A = "x"; // note\n+const added = "hi";\n-const removed = 1; // x\n```\nselesai\n');
  renderNow();
  const codePlain = plain();
  assert.ok(codePlain.includes('js'), 'blok kode: label bahasa');
  assert.ok(codePlain.includes('1 │'), 'blok kode: nomor baris');
  assert.ok(codePlain.includes('selesai'), 'teks setelah blok kode kembali normal');
  const codeRaw = chunks.join('');
  assert.ok(codeRaw.includes('\x1b[38;5;204m'), 'kode: keyword berwarna');
  assert.ok(codeRaw.includes('\x1b[38;5;214m'), 'kode: string berwarna');
  assert.ok(codeRaw.includes('\x1b[38;5;114m+'), 'diff: tanda + berwarna');
  assert.ok(codeRaw.includes('\x1b[38;5;131m-'), 'diff: tanda - berwarna');

  chunks.length = 0;
  append('**tebal** dan `kode`\n- item\n');
  renderNow();
  assert.ok(plain().includes('tebal') && plain().includes('kode'), 'markdown: teks tampil');
  assert.ok(plain().includes('• item'), 'markdown: bullet');
  assert.ok(chunks.join('').includes('\x1b[1m'), 'markdown: bold ANSI');

  chunks.length = 0;
  p = ask('API key', { text: { label: 'API key tes', secret: true } });
  await type('abc123');
  assert.ok(plain().includes('API key tes'), 'modal input key tampil');
  assert.ok(!plain().includes('abc123'), 'nilai key disamarkan di modal');
  await press('return', '\r');
  assert.equal(await p, 'abc123', 'modal input mengembalikan nilai');

  chunks.length = 0;
  p = ask('API key', { text: { label: 'API key tes', secret: true } });
  await press('escape');
  assert.equal(await p, null, 'modal input: Esc = batal');

  chunks.length = 0;
  p = ask('API key', {
    text: {
      label: 'API key tes',
      secret: true,
      validate: (v) => (v.length >= 8 ? '' : 'Key kependekan'),
    },
  });
  await type('abc');
  await press('return', '\r');
  assert.ok(plain().includes('Key kependekan'), 'modal input: validasi menampilkan error');
  await type('defghij');
  await press('return', '\r');
  assert.equal(await p, 'abcdefghij', 'modal input: lolos setelah validasi');

  chunks.length = 0;
  p = ask('Kamu > ', { menu: COMMANDS });
  await type('halo');
  chunks.length = 0;
  await press('return', '\r');
  assert.equal(await p, 'halo', 'teks biasa tetap terkirim');
  const rawRows = chunks.join('').split('\r\n');
  const userRow = rawRows.find((ln) => ln.includes('halo') && ln.includes('48;5;236'));
  assert.ok(userRow, 'pesan user memakai blok latar');
  assert.ok(!chunks.join('').includes('▎'), 'tanpa bar kiri');

  chunks.length = 0;
  let infoClosed = false;
  const ip = info({ title: 'Uji Info', body: [{ text: 'kunci', right: 'nilai' }], foot: 'esc tutup' })
    .then(() => { infoClosed = true; });
  await new Promise((r) => setImmediate(r));
  assert.ok(plain().includes('Uji Info') && plain().includes('nilai'), 'panel info tampil');
  await press('escape');
  await ip;
  assert.ok(infoClosed, 'panel info tertutup dengan esc');

  chunks.length = 0;
  const cp = confirmInline(`Jalankan: ${'x'.repeat(120)}`);
  await new Promise((r) => setImmediate(r));
  assert.ok((plain().match(/x/g) || []).length >= 100, 'perintah panjang tampil utuh (tidak dipotong)');
  await press('escape');
  await cp;

  chunks.length = 0;
  append('halo \x1b[31mMERAH\x1b[0m selesai');
  renderNow();
  assert.ok(!chunks.join('').includes('\x1b[31m') && plain().includes('MERAH'), 'escape dari model dibuang');
  chunks.length = 0;
  diffBlock([{ type: '+', text: 'aman \x1b[31mX\x1b[0m', oldNo: null, newNo: 1 }]);
  assert.ok(!chunks.join('').includes('\x1b[31m') && plain().includes('aman'), 'escape dari file dibuang di diff');

  chunks.length = 0;
  p = ask('API key > ', { secret: true });
  await type('rahasia123');
  await press('return', '\r');
  assert.equal(await p, 'rahasia123', 'prompt rahasia mengembalikan nilai');
  chunks.length = 0;
  renderNow(); // render ulang dari log: key tidak boleh tertinggal
  assert.ok(!plain().includes('rahasia123'), 'prompt rahasia tidak masuk log');

  p = ask('Kamu > ', { menu: COMMANDS });
  await press('up');
  await press('return', '\r');
  assert.equal(await p, 'halo', 'panah atas memanggil riwayat');

  p = ask('Kamu > ', { menu: COMMANDS });
  await press('d', '\x04', { ctrl: true });
  assert.equal(await p, null, 'Ctrl+D = EOF');

  chunks.length = 0;
  tuiLog('LATAR CHAT');
  await new Promise((r) => setTimeout(r, 60)); // tunggu render
  p = ask('Pilih provider', {
    select: [{ label: 'Gemini', value: 'gemini' }, { label: 'Groq', value: 'groq' }],
  });
  await press('down');
  assert.ok(plain().includes('LATAR CHAT'), 'popup: latar chat tampil');
  assert.ok(plain().includes('saring'), 'popup: kolom saring tampil');
  assert.ok(!plain().includes('╭'), 'popup: tanpa bingkai luar');
  assert.ok(chunks.join('').includes('48;5;33'), 'popup: baris terpilih biru penuh');
  assert.ok(plain().includes('Pilih provider'), 'popup: judul tampil');
  await press('return', '\r');
  assert.equal(await p, 'groq', 'popup: panah + Enter');

  p = ask('Pilih model', {
    select: [{ label: 'alpha', value: 'a' }, { label: 'beta', value: 'b' }],
  });
  await type('bet');
  await press('return', '\r');
  assert.equal(await p, 'b', 'popup: cari + Enter');

  chunks.length = 0;
  p = ask('Pilih model', { select: [{ label: 'gemini-2.0-flash', value: 'gemini-2.0-flash' }] });
  chunks.length = 0;
  await press('escape');
  assert.equal(await p, null, 'popup: Esc batal');
  assert.ok(!plain().includes('Pilih model'), 'popup: overlay tertutup');

  let aborted = false;
  beginInterrupt(() => { aborted = true; });
  stdin.emit('keypress', '\x1b', { name: 'escape', sequence: '\x1b' });
  await new Promise((r) => setImmediate(r));
  endInterrupt();
  assert.ok(aborted, 'Esc menghentikan jawaban');

  chunks.length = 0;
  beginInterrupt(() => {});
  stdin.emit('keypress', 'h', { name: 'h', sequence: 'h' });
  stdin.emit('keypress', 'i', { name: 'i', sequence: 'i' });
  endInterrupt();
  p = ask('Kamu > ', { menu: COMMANDS });
  await new Promise((r) => setImmediate(r));
  assert.ok(plain().includes('hi'), 'typeahead tampil di prompt berikutnya');
  await press('return', '\r');
  assert.equal(await p, 'hi', 'typeahead terkirim utuh');

  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'beot-tools-'));
  try {
    const wrote = await writeFileTool('sub/a.txt', 'isi file', { cwd: sandbox, confirmWrite: async () => true });
    assert.ok(wrote.content.includes('ditulis'), 'tulis file berhasil');
    assert.equal(fs.readFileSync(path.join(sandbox, 'sub', 'a.txt'), 'utf8'), 'isi file');
    let confirmed = false;
    const same = await writeFileTool('sub/a.txt', 'isi file', { cwd: sandbox, confirmWrite: async () => { confirmed = true; return true; } });
    assert.ok(same.content.includes('TIDAK BERUBAH') && !confirmed, 'isi sama = tidak tanya/tulis ulang');
    const fresh = buildNewFileDiff('satu\ndua');
    const asText = (d) => d.lines.map((l) => `${l.type}${l.text}`);
    assert.ok(fresh.added === 2 && asText(fresh)[0] === '+satu', 'diff file baru semua +');
    assert.deepEqual(fresh.lines.map((l) => l.newNo), [1, 2], 'nomor baris file baru');
    const changed = buildDiff('a\nb\nc', 'a\nB\nc');
    assert.deepEqual({ added: changed.added, removed: changed.removed }, { added: 1, removed: 1 }, 'diff hitung +/-');
    const changedText = asText(changed);
    assert.ok(changedText.includes('-b') && changedText.includes('+B') && changedText.includes(' a'), 'diff memuat konteks');
    const minus = changed.lines.find((l) => l.type === '-');
    const plus = changed.lines.find((l) => l.type === '+');
    assert.ok(minus.oldNo === 2 && plus.newNo === 2, 'nomor baris lama/baru benar');
    const big = buildDiff(Array.from({ length: 400 }, (_, i) => `lama ${i}`).join('\n'), Array.from({ length: 400 }, (_, i) => `baru ${i}`).join('\n'));
    assert.ok(big.truncated && big.lines.length <= 240, 'diff besar dipotong');
    assert.ok(big.lines.some((l) => l.type === '-') && big.lines.some((l) => l.type === '+'), 'diff terpotong tetap punya - dan +');
    assert.deepEqual(buildDiff('sama', 'sama').lines, [], 'diff tanpa perubahan kosong');
    const refused = await writeFileTool('b.txt', 'x', { cwd: sandbox, confirmWrite: async () => false });
    assert.ok(refused.refused && !fs.existsSync(path.join(sandbox, 'b.txt')), 'batal = tidak menulis');
    await assert.rejects(
      writeFileTool('c.txt', 'x', { cwd: sandbox, confirmWrite: async () => true, allowWrite: false }),
      /Mode plan/,
    );
    assert.ok(!fs.existsSync(path.join(sandbox, 'c.txt')), 'mode plan = tulis ditolak');
    const listing = await listDir('.', sandbox);
    assert.ok(listing.includes('sub/'), 'list_dir melihat folder');
    const read = await runFileTool('read_file', JSON.stringify({ path: 'sub/a.txt' }), { cwd: sandbox });
    assert.ok(read.content.includes('isi file'), 'read_file membaca isi');
    const linkRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'beot-link-'));
    try {
      fs.writeFileSync(path.join(linkRoot, 'secret.txt'), 'RAHASIA');
      try {
        fs.symlinkSync(linkRoot, path.join(sandbox, 'link'), 'junction');
        assert.throws(() => resolveInside('link/secret.txt', sandbox), /luar folder kerja/, 'symlink keluar ditolak');
      } catch (err) {
        if (err.code !== 'EPERM' && err.code !== 'EACCES') throw err;
      }
    } finally {
      fs.rmSync(linkRoot, { recursive: true, force: true });
    }
    const outside = await runFileTool('read_file', JSON.stringify({ path: '../x' }), { cwd: sandbox });
    assert.ok(outside.error.includes('luar folder'), 'tool menolak path luar');

    fs.writeFileSync(path.join(sandbox, 'latih.txt'), 'alpha\nBETA gamma\n');
    const grepHit = await runFileTool('grep_file', JSON.stringify({ pattern: 'beta', ignore_case: true }), { cwd: sandbox });
    assert.ok(grepHit.content.includes('latih.txt:2: BETA gamma'), 'grep_file menemukan isi file');
    const globHit = await runFileTool('glob_file', JSON.stringify({ pattern: '**/*.txt' }), { cwd: sandbox });
    assert.ok(globHit.content.includes('latih.txt'), 'glob_file menemukan nama file');
    const badRe = await runFileTool('grep_file', JSON.stringify({ pattern: '([' }), { cwd: sandbox });
    assert.ok(badRe.error.includes('Regex'), 'regex rusak ditolak');
    const ranged = await runFileTool('read_file', JSON.stringify({ path: 'latih.txt', offset: 2, limit: 1 }), { cwd: sandbox });
    assert.ok(ranged.content.includes('baris 2–2 dari 3') && ranged.content.includes('BETA gamma'), 'read_file offset/limit');
    fs.writeFileSync(path.join(sandbox, '.env'), 'RAHASIA=1');
    const env = await runFileTool('read_file', JSON.stringify({ path: '.env' }), { cwd: sandbox });
    assert.ok(env.error.includes('diblokir'), '.env diblokir untuk dibaca');
    const envWrite = await runFileTool('write_file', JSON.stringify({ path: '.env', content: 'x' }), { cwd: sandbox, confirmWrite: async () => true });
    assert.ok(envWrite.error.includes('diblokir'), '.env diblokir untuk ditulis');
    const extra = fs.mkdtempSync(path.join(os.tmpdir(), 'beot-extra-'));
    try {
      fs.writeFileSync(path.join(extra, 'luar.txt'), 'isi luar');
      const luar = path.join(extra, 'luar.txt');
      const allowed = await runFileTool('read_file', JSON.stringify({ path: luar }), { cwd: sandbox, extras: [extra] });
      assert.ok(allowed.content.includes('isi luar'), 'extras mengizinkan baca di luar cwd');
      const extras = [];
      let asked = '';
      const viaPrompt = await runFileTool('read_file', JSON.stringify({ path: luar }), {
        cwd: sandbox,
        extras,
        onOutside: async (abs) => { asked = abs; extras.push(abs); return true; },
      });
      assert.ok(asked === luar && viaPrompt.content.includes('isi luar'), 'izin pengguna membuka path luar');
      const denied = await runFileTool('read_file', JSON.stringify({ path: luar }), {
        cwd: sandbox,
        extras: [],
        onOutside: async () => false,
      });
      assert.ok(denied.error.includes('ditolak'), 'tolak akses = path tetap diblokir');
    } finally {
      fs.rmSync(extra, { recursive: true, force: true });
    }

    const pdf = buildPdf({ title: 'Uji', text: 'Halo (dunia).\nBaris kedua.' }).toString('latin1');
    assert.ok(pdf.startsWith('%PDF-1.4') && pdf.trimEnd().endsWith('%%EOF'), 'PDF punya header/EOF');
    const xrefPos = Number(pdf.match(/startxref\n(\d+)/)?.[1] || NaN);
    assert.ok(pdf.slice(xrefPos).startsWith('xref'), 'startxref menunjuk xref');
    const refs = pdf.slice(xrefPos).split('\n').slice(2).filter((line) => line.endsWith(' n '));
    refs.forEach((line, i) => {
      assert.ok(pdf.slice(Number(line.slice(0, 10))).startsWith(`${i + 1} 0 obj`), `xref obj ${i + 1} valid`);
    });

    const xlsx = buildXlsx({ sheet: 'Data', columns: ['Nama', 'Nilai'], rows: [['Andi', 10]] });
    assert.equal(xlsx.subarray(0, 4).toString('hex'), '504b0304', 'XLSX adalah ZIP');
    for (const part of ['xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/styles.xml']) {
      assert.ok(xlsx.includes(Buffer.from(part)), `XLSX memuat ${part}`);
    }
    assert.ok(xlsx.includes(Buffer.from('<v>10</v>')) && xlsx.includes(Buffer.from('Andi')), 'XLSX memuat sel angka & teks');

    const docx = buildDocx({ title: 'Judul', text: 'Paragraf.\n- bullet' });
    assert.ok(docx.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 3, 4])), 'DOCX adalah ZIP');
    assert.ok(docx.includes(Buffer.from('word/document.xml')) && docx.includes(Buffer.from('Judul')), 'DOCX memuat document.xml');

    const rtf = buildRtf({ title: 'Catatan', text: 'Halo é' }).toString('latin1');
    assert.ok(rtf.startsWith('{\\rtf1') && rtf.includes('\\par'), 'RTF valid dasar');
    assert.ok(rtf.includes('\\u233?'), 'RTF meng-encode non-ASCII');

    const madePdf = await runExportTool('export_pdf', JSON.stringify({ path: 'laporan', text: 'Halo' }), { cwd: sandbox, confirmWrite: async () => true });
    assert.ok(madePdf.content.includes('dibuat'), 'export_pdf menulis file');
    assert.equal(fs.readFileSync(path.join(sandbox, 'laporan.pdf')).subarray(0, 5).toString(), '%PDF-');
    const madeXlsx = await runExportTool('export_xlsx', JSON.stringify({ path: 'data.xlsx', columns: ['A'], rows: [[1]] }), { cwd: sandbox, confirmWrite: async () => true });
    assert.ok(madeXlsx.content.includes('dibuat'), 'export_xlsx menulis file');
    const batalExport = await runExportTool('export_docx', JSON.stringify({ path: 'x.docx', text: 'x' }), { cwd: sandbox, confirmWrite: async () => false });
    assert.ok(batalExport.refused && !fs.existsSync(path.join(sandbox, 'x.docx')), 'batal export = tidak menulis');
    const planExport = await runExportTool('export_rtf', JSON.stringify({ path: 'p.rtf', text: 'x' }), { cwd: sandbox, confirmWrite: async () => true, allowWrite: false });
    assert.ok(planExport.error.includes('Mode plan') && !fs.existsSync(path.join(sandbox, 'p.rtf')), 'mode plan = export ditolak');
    const salahExt = await runExportTool('export_pdf', JSON.stringify({ path: 'salah.txt', text: 'x' }), { cwd: sandbox, confirmWrite: async () => true });
    assert.ok(salahExt.error.includes('.pdf'), 'ekstensi export divalidasi');
    const binWrite = await runFileTool('write_file', JSON.stringify({ path: 'salah.pdf', content: 'x' }), { cwd: sandbox, confirmWrite: async () => true });
    assert.ok(binWrite.error.includes('export_pdf'), 'write_file menolak file biner');

    // --- regresi audit: bypass file sensitif, regex DoS, PDF berurutan ---
    const grepEnv = await runFileTool('grep_file', JSON.stringify({ pattern: 'RAHASIA' }), { cwd: sandbox });
    assert.ok(!grepEnv.content.includes('RAHASIA=1'), 'grep_file tidak membocorkan .env');
    const grepEnvPath = await runFileTool('grep_file', JSON.stringify({ pattern: 'RAHASIA', path: '.env' }), { cwd: sandbox });
    assert.ok(!String(grepEnvPath.content || '').includes('RAHASIA=1'), 'grep_file eksplisit .env diblokir');
    fs.mkdirSync(path.join(sandbox, '.git'), { recursive: true });
    fs.writeFileSync(path.join(sandbox, '.git', 'config'), '[remote "origin"] url = https://token@github.com/x/y.git\n');
    const gitRead = await runFileTool('read_file', JSON.stringify({ path: '.git/config' }), { cwd: sandbox });
    assert.ok(gitRead.error.includes('diblokir'), '.git/config diblokir');
    const gitList = await runFileTool('list_dir', JSON.stringify({ path: '.git' }), { cwd: sandbox });
    assert.ok(gitList.error.includes('diblokir'), 'list_dir .git diblokir');
    assert.ok(sensitiveReason(path.join(HOME_DIR, 'config.json.bak')), 'backup config diblokir');
    assert.equal(sensitiveReason(path.join(sandbox, 'biasa.txt')), null, 'file biasa tetap boleh');
    const nested = await runFileTool('grep_file', JSON.stringify({ pattern: '^(a+)+$' }), { cwd: sandbox });
    assert.ok(nested.error.includes('kompleks'), 'regex bersarang ditolak (tidak hang)');
    const pdfA = path.join(sandbox, 'a.pdf');
    const pdfB = path.join(sandbox, 'b.pdf');
    fs.writeFileSync(pdfA, buildPdf({ title: 'Dok A', text: 'Isi PERTAMA.' }));
    fs.writeFileSync(pdfB, buildPdf({ title: 'Dok B', text: 'Isi KEDUA.' }));
    const docA = await readDoc(pdfA);
    const docB = await readDoc(pdfB);
    assert.ok(docA.text.includes('PERTAMA') && docB.text.includes('KEDUA'), 'PDF berurutan tidak tertukar');
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }

  passed++;
  process.stdout.write = editorSaved.write;
  console.log('  ok  Editor TTY: composer, menu, popup, Tab, Esc, riwayat, EOF');
} catch (err) {
  console.error(`  FAIL Editor TTY: menu, Tab, Esc, riwayat, EOF\n       ${err.message}`);
  process.exitCode = 1;
} finally {
  if (editorSaved) {
    const stdin = process.stdin;
    stdin.isTTY = editorSaved.inTTY;
    process.stdout.isTTY = editorSaved.outTTY;
    stdin.setRawMode = editorSaved.raw;
    stdin.resume = editorSaved.resume;
    stdin.pause = editorSaved.pause;
    process.stdout.write = editorSaved.write;
  }
}

// --- fitur baru: edit_file, shell, sesi, compact, CLI ---

await acheck('edit_file: potongan, ambigu, replace_all', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'beot-edit-'));
  try {
    const file = path.join(dir, 'a.txt');
    fs.writeFileSync(file, 'satu\ndua\nsatu\n');
    const opts = { cwd: dir, confirmWrite: async () => true };
    const one = await editFileTool('a.txt', { old_string: 'dua', new_string: 'DUA' }, opts);
    assert.ok(one.content.includes('ditulis'), 'edit berhasil');
    assert.ok(fs.readFileSync(file, 'utf8').includes('DUA'));

    const amb = await runFileTool('edit_file', JSON.stringify({ path: 'a.txt', old_string: 'satu', new_string: 'x' }), opts);
    assert.ok(/muncul 2/.test(amb.error), 'ambigu ditolak');

    const miss = await runFileTool('edit_file', JSON.stringify({ path: 'a.txt', old_string: 'tidak-ada', new_string: 'x' }), opts);
    assert.ok(/tidak ditemukan/.test(miss.error), 'teks tidak ada ditolak');

    const all = await editFileTool('a.txt', { old_string: 'satu', new_string: 'SATU', replace_all: true }, opts);
    assert.ok(all.content.includes('ditulis'), 'replace_all jalan');
    assert.equal(fs.readFileSync(file, 'utf8'), 'SATU\nDUA\nSATU\n');

    const missing = await runFileTool('edit_file', JSON.stringify({ path: 'baru.txt', old_string: 'a', new_string: 'b' }), opts);
    assert.ok(/write_file/.test(missing.error), 'file tidak ada diarahkan ke write_file');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

await acheck('Shell: izin, tolak-keras, output, timeout', async () => {
  const node = `"${process.execPath}"`;
  const denied = await runShellTool({ command: 'rm -rf /' }, { cwd: process.cwd(), shellMode: 'allow' })
    .then(() => null, (e) => e);
  assert.ok(denied && /diblokir/.test(denied.message), 'perintah destruktif ditolak');

  const no = await runShellTool({ command: `${node} -e "console.log(42)"` }, {
    cwd: process.cwd(), shellMode: 'ask', confirmShell: async () => false,
  });
  assert.ok(no.refused, 'menolak izin = tidak dijalankan');

  const yes = await runShellTool({ command: `${node} -e "console.log(42)"` }, {
    cwd: process.cwd(), shellMode: 'ask', confirmShell: async () => true,
  });
  assert.ok(yes.content.includes('42'), 'output perintah masuk');
  assert.ok(yes.note.startsWith('jalan'), 'catatan ledger dibuat');

  const to = await runShellTool({ command: `${node} -e "setTimeout(()=>{},5000)"`, timeout_ms: 1000 }, {
    cwd: process.cwd(), shellMode: 'allow',
  });
  assert.ok(to.error && /timeout/i.test(to.error), 'timeout menghentikan perintah');

  process.env.BEOT_TEST_SECRET = 'rahasia-env';
  try {
    const envCmd = `${node} -e "console.log(process.env.BEOT_TEST_SECRET||'kosong')"`;
    const cleaned = await runShellTool({ command: envCmd }, { cwd: process.cwd(), shellMode: 'allow' });
    assert.ok(cleaned.content.includes('kosong') && !cleaned.content.includes('rahasia-env'), 'env kredensial dibuang');
    const full = await runShellTool({ command: envCmd }, { cwd: process.cwd(), shellMode: 'allow', shellEnv: 'full' });
    assert.ok(full.content.includes('rahasia-env'), 'shellEnv full meneruskan env');
  } finally {
    delete process.env.BEOT_TEST_SECRET;
  }
});

await acheck('Todo: validasi & ringkasan', () => {
  const list = normalizeTodos([
    { content: 'baca data', status: 'completed' },
    { content: 'tulis laporan', status: 'in_progress' },
  ]);
  assert.equal(list.length, 2);
  const res = runTodoTool({ todos: list });
  assert.ok(res.content.includes('1/2') && res.content.includes('tulis laporan'));
  assert.throws(() => normalizeTodos([]), /minimal satu/);
  assert.throws(() => normalizeTodos([{ content: 'x', status: 'selesai' }]), /pending\/in_progress/);
});

await acheck('Sesi: JSONL dibaca, baris rusak dilewati, append', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'beot-sess-'));
  try {
    const file = path.join(dir, 's.jsonl');
    fs.writeFileSync(file, [
      JSON.stringify({ t: 'meta', v: 1, cwd: dir, at: '2026-01-01T00:00:00Z' }),
      '{bukan json',
      JSON.stringify({ t: 'msg', role: 'user', content: 'halo' }),
      JSON.stringify({ t: 'msg', role: 'tool', content: 'abaikan' }),
      JSON.stringify({ t: 'msg', role: 'assistant', content: 'hai' }),
    ].join('\n'));
    const got = readSession(file);
    assert.equal(got.meta.cwd, dir, 'meta terbaca');
    assert.deepEqual(got.history.map((m) => m.role), ['user', 'assistant'], 'hanya user/assistant');
    appendTurn(file, { role: 'user', content: 'lagi' });
    assert.equal(readSession(file).history.length, 3, 'append menambah pesan');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

await acheck('Compact: input dibatasi, hasil = 1 pesan', () => {
  const long = Array.from({ length: 40 }, (_, i) => ({
    role: i % 2 ? 'assistant' : 'user',
    content: 'x'.repeat(1000),
  }));
  const input = buildCompactInput(long, 800);
  assert.ok(input.length <= 830, 'input dipotong');
  assert.ok(input.startsWith('…(dipotong)'), 'penanda potong ada');
  const hist = compactedHistory('ringkasan inti');
  assert.equal(hist.length, 1);
  assert.ok(hist[0].content.startsWith('[RINGKASAN'));
});

await acheck('CLI: --version & --help tanpa masuk TUI', () => {
  const root = path.dirname(fileURLToPath(import.meta.url));
  const run = (...args) => execFileSync(process.execPath, [path.join(root, 'index.js'), ...args], { encoding: 'utf8' });
  assert.equal(run('--version').trim(), 'beot 0.1.0');
  const help = run('--help');
  assert.ok(help.includes('--continue') && help.includes('beot [folder]'), 'help memuat flag');
  assert.ok(!help.includes('\x1b['), 'help tanpa escape ANSI');
});

await acheck('Biaya: harga model & hitungan', () => {
  const p = priceFor('gemini-2.0-flash');
  assert.ok(p && p.input === 0.1 && p.output === 0.4, 'harga flash terbaca');
  assert.equal(priceFor('model-tidak-dikenal'), null);
  const c = costOf({ model: 'gemini-2.0-flash', prompt: 1_000_000, completion: 1_000_000 });
  assert.ok(Math.abs(c - 0.5) < 1e-9, 'hitung biaya 1M+1M');
  assert.equal(costOf({ model: 'x', prompt: 10 }), null, 'model tak dikenal = null');
  assert.equal(fmtUsd(0), '$0');
  assert.ok(fmtUsd(0.00002).startsWith('<'));
});

await acheck('Web: host privat & HTML jadi teks', async () => {
  assert.equal(isPrivateHost('localhost'), true);
  assert.equal(isPrivateHost('localhost.'), true, 'titik akhir tetap lokal');
  assert.equal(isPrivateHost('127.0.0.1'), true);
  assert.equal(isPrivateHost('192.168.1.5'), true);
  assert.equal(isPrivateHost('172.20.0.1'), true);
  assert.equal(isPrivateHost('[::1]'), true, 'IPv6 loopback');
  assert.equal(isPrivateHost('[::ffff:7f00:1]'), true, 'IPv4-mapped IPv6');
  assert.equal(isPrivateHost('[::ffff:127.0.0.1]'), true, 'mapped dotted');
  assert.equal(isPrivateHost('[fe80::1]'), true, 'link-local');
  assert.equal(isPrivateHost('[fd00::1]'), true, 'unique local');
  assert.equal(isPrivateHost('example.com'), false);
  const privateErr = await runWebTool({ url: 'http://127.0.0.1/x' }, { webMode: 'allow' }).then(() => null, (e) => e);
  assert.ok(privateErr && /privat/i.test(privateErr.message), 'localhost diblokir');
  const schemeErr = await runWebTool({ url: 'file:///etc/passwd' }, { webMode: 'allow' }).then(() => null, (e) => e);
  assert.ok(schemeErr && /http/i.test(schemeErr.message), 'skema non-http ditolak');
  assert.equal(isPrivateIp('::ffff:7f00:1'), true, 'mapped IPv6 privat');
  assert.equal(isPrivateIp('8.8.8.8'), false, 'IP publik lolos');
  const evil = await resolveSafe('evil.test', async () => [{ address: '127.0.0.1', family: 4 }]).then(() => null, (e) => e);
  assert.ok(evil && /privat/i.test(evil.message), 'DNS yang mengarah privat ditolak');
  const good = await resolveSafe('example.com', async () => [{ address: '93.184.216.34', family: 4 }]);
  assert.equal(good.address, '93.184.216.34', 'DNS publik dipakai untuk pinning');
  const txt = htmlToText('<html><script>alert(1)</script><h1>Judul</h1><p>Halo &amp; dunia</p></html>');
  assert.ok(txt.includes('Judul') && txt.includes('Halo & dunia'), 'tag & entity dirapikan');
  assert.ok(!txt.includes('alert'), 'script dibuang');
});

await acheck('Grep: banyak file, event loop tetap jalan', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'beot-grep-'));
  try {
    for (let i = 0; i < 60; i++) {
      fs.writeFileSync(path.join(dir, `f${i}.txt`), `baris ${i}\nkata kunci ${i}\n`);
    }
    let ticked = false;
    const timer = setTimeout(() => { ticked = true; }, 0);
    const res = await runFileTool('grep_file', JSON.stringify({ pattern: 'kata kunci', limit: 100 }), { cwd: dir });
    clearTimeout(timer);
    assert.ok(res.content.includes('kata kunci 59'), 'hasil dari file terakhir ada');
    assert.ok(ticked, 'timer sempat jalan selama grep (tidak memblokir)');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

check('Perintah baru terdaftar', () => {
  for (const cmd of ['/cost', '/sessions', '/compact', '/quit']) {
    assert.ok(COMMANDS.some((x) => x.cmd === cmd), `${cmd} ada di menu`);
  }
  assert.equal(DEFAULTS.web, 'ask', 'default web = tanya dulu');
});

await acheck('Baca teks besar tidak memuat seluruh file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'beot-big-'));
  try {
    const file = path.join(dir, 'besar.txt');
    fs.writeFileSync(file, 'a'.repeat(300 * 1024));
    const doc = readDoc(file);
    assert.equal(doc.truncated, true);
    assert.ok(doc.text.length <= MAX_CHARS, 'teks dipotong ke batas');
    assert.ok(doc.bytes >= 300 * 1024, 'ukuran asli tetap dilaporkan');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

await acheck('Skill: proyek menimpa user, file rusak dilewati', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'beot-skill-'));
  try {
    const low = path.join(dir, 'low');
    const high = path.join(dir, 'high');
    fs.mkdirSync(low);
    fs.mkdirSync(high);
    fs.writeFileSync(path.join(low, 'a.md'), '---\nnama: sama\ndeskripsi: versi user\n---\nIsi user');
    fs.writeFileSync(path.join(high, 'a.md'), '---\nnama: sama\ndeskripsi: versi proyek\n---\nIsi proyek');
    fs.writeFileSync(path.join(high, 'b.md'), '---\nnama: tambahan\ndeskripsi: hanya di proyek\n---\nIsi');
    fs.writeFileSync(path.join(high, 'rusak.md'), 'tanpa frontmatter');
    const merged = loadSkillsFromMany([low, high]);
    assert.equal(merged.length, 2, 'duplikat digabung, file rusak dilewati');
    assert.equal(merged.find((s) => s.nama === 'sama').deskripsi, 'versi proyek', 'proyek menang');
    assert.ok(merged.some((s) => s.nama === 'tambahan'));
    assert.deepEqual(loadSkillsFromMany([high, low]).find((s) => s.nama === 'sama').deskripsi, 'versi user', 'urutan menentukan');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

await acheck('Memori: /ingat idempoten, prompt, /init', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'beot-mem-'));
  try {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
      name: 'demo', type: 'module', scripts: { test: 'node t.js' }, engines: { node: '>=20' },
    }));
    const first = appendMemory('tes pakai npm test', { cwd: dir });
    assert.ok(first.added, 'baris pertama ditambahkan');
    assert.equal(appendMemory('tes pakai npm test', { cwd: dir }).added, false, 'tidak dobel');
    const prompt = memoryPrompt(dir);
    assert.ok(prompt.startsWith('[MEMORI]'), 'prompt memori berawalan penanda');
    assert.ok(prompt.includes('tes pakai npm test'), 'isi memori masuk prompt');
    const init = buildInitMemory(dir);
    assert.ok(init.includes('demo') && init.includes('node t.js'), '/init membaca package.json');
    assert.throws(() => appendMemory('   ', { cwd: dir }), /kosong/);
    assert.throws(() => appendMemory('x'.repeat(401), { cwd: dir }), /400/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

await acheck('Keamanan: grep/glob tidak menembus junction', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'beot-junc-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'beot-junc-out-'));
  try {
    fs.writeFileSync(path.join(outside, 'rahasia.txt'), 'TOPSECRET-123\n');
    fs.writeFileSync(path.join(root, 'biasa.txt'), 'aman\n');
    try { fs.symlinkSync(outside, path.join(root, 'link'), 'junction'); } catch { /* tanpa izin: lewati */ }
    const g = await runFileTool('grep_file', JSON.stringify({ pattern: 'TOPSECRET' }), { cwd: root });
    assert.ok(!String(g.content).includes('TOPSECRET'), 'grep tidak bocor lewat junction');
    const gl = await runFileTool('glob_file', JSON.stringify({ pattern: '**/*.txt' }), { cwd: root });
    assert.ok(!String(gl.content).includes('rahasia.txt'), 'glob tidak menyebut file luar');
    const long = await runShellTool({ command: `echo ${'a'.repeat(500)}` }, { cwd: root, shellMode: 'allow' })
      .then(() => null, (e) => e);
    assert.ok(long && /panjang/i.test(long.message), 'perintah >400 karakter ditolak');
  } finally {
    for (const d of [root, outside]) {
      try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* junction terkunci */ }
    }
  }
});

console.log(`\n${passed} cek lolos.`);