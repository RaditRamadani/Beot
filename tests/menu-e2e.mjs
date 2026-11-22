// E2E menu: tekan setiap perintah di app nyata (TUI palsu) dan cek hasilnya.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); };

const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (d) => { raw += d; });
  req.on('end', () => {
    if (req.url.endsWith('/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'mock' }, { id: 'mock-2' }, { id: 'text-embedding-3-small' }] }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'jawaban uji' } }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 2, total_tokens: 22 } })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'beot-menu-'));
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'beot-menu-home-'));
const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'beot-menu-out-'));
fs.mkdirSync(path.join(work, 'sub'));
fs.writeFileSync(path.join(work, 'catatan.txt'), 'isi catatan\n');
fs.mkdirSync(path.join(home, '.beot'), { recursive: true });
fs.writeFileSync(path.join(home, '.beot', 'config.json'), JSON.stringify({
  base_url: `http://127.0.0.1:${server.address().port}/v1`,
  api_key: 'test', model: 'mock', persona: 'build', stream_timeout: 20,
  write_confirm: false, external: 'ask', shell: 'deny', web: 'deny',
}));

const out = [];
const child = spawn(process.execPath, [path.join(ROOT, 'tests', 'tui-run.cjs')], {
  cwd: work,
  env: { ...process.env, USERPROFILE: home, HOME: home, HOMEPATH: home },
  stdio: ['pipe', 'pipe', 'pipe'],
});
child.stdout.on('data', (d) => out.push(String(d)));
child.stderr.on('data', (d) => out.push(String(d)));
const exited = new Promise((r) => child.on('exit', r));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const clean = (s) => String(s)
  .replace(/\x1b\][^\x07]*\x07/g, '')
  .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');

async function waitFor(needles, from, ms = 6000) {
  const list = Array.isArray(needles) ? needles : [needles];
  const deadline = Date.now() + ms;
  for (;;) {
    const text = clean(out.join('').slice(from));
    if (list.every((n) => text.includes(n))) return true;
    if (Date.now() > deadline) return false;
    await wait(120);
  }
}

async function step(line, expect, { esc = false } = {}) {
  const from = out.length > 0 ? out.join('').length : 0;
  child.stdin.write(`${line}\n`);
  if (expect) {
    const got = await waitFor(expect, from);
    ok(got, `${line}: harus menampilkan ${JSON.stringify(expect)}`);
  } else {
    await wait(500);
  }
  if (esc) {
    child.stdin.write('\x1b');
    await wait(500);
  }
}

await waitFor('█▀▀▄', 0, 10_000);
ok(out.join('').includes('█▀▀▄'), 'splash logo tampil saat startup');

// Mengetik belum boleh memindahkan layout: splash harus tetap, teks masuk di tengah.
const frameOf = (from = 0) => clean(out.join('').slice(from).split('\x1b[H').pop() || '');
child.stdin.write('ha');
await wait(500);
const typedFrame = frameOf();
ok(typedFrame.includes('█▀▀▄'), 'splash tetap saat mengetik');
ok(typedFrame.includes('ha'), 'teks ketikan tampil di input splash');
child.stdin.write('\x7f\x7f');
await wait(300);

await step('/bantu', 'Perintah');
await step('/status', 'Status sesi', { esc: true });
await step('/cost', 'Biaya (perkiraan)', { esc: true });
await step('/theme mono', 'tema mono');
await step('/theme default', 'tema default');
await step('/theme preview', 'Tema (');
await step('/theme nord', 'tema nord');
await step('/theme default', 'tema default');
await step('/thinking', 'Thinking off');
await step('/thinking', 'Thinking on');
await step('/tugas catatan.txt', 'catatan.txt');
await step('/cd sub', 'Folder kerja');
await step('/cd ..', 'Folder kerja');
await step(`/add-dir "${outside}"`, 'Folder izin ditambah');
await step(`/add-dir "${outside}"`, 'Folder izin dihapus');
await step('/init', 'Memori proyek dibuat');
await step('/ingat tes pakai node', 'Diingat');
await step('/reload', 'dimuat ulang');
await step('/model mock-2', 'Model: mock-2');
await step('/model mock', 'Model: mock');
await step('/compact', 'Riwayat masih pendek');
await step('/sessions', 'Belum ada sesi');
await step('/clear', 'Riwayat dan file dibersihkan');
await step('/persona', 'Pilih persona', { esc: true });
await step('/skill', 'Pilih skill', { esc: true });
await step('/setting', 'Ubah apa', { esc: true });
await step('/key', 'Pilih asal API key', { esc: true });
await step('/files', 'File ·', { esc: true });
await step('/theme', 'Pilih tema', { esc: true });
await step('/model', ['Pilih model', 'mock-2'], { esc: true });
await step('/cd', 'folder kerja');
await step('/add-dir', 'Belum ada folder tambahan');
await step('/tugas', 'Pakai: /tugas');
await step('/persona build', 'Persona aktif');
await step('/skill debug', 'Skill aktif');
await step('/skill lepas', 'Skill dimatikan');
await step('/zzz', 'tidak dikenal');
await step('halo', 'jawaban uji');
await step('/sessions', 'Lanjutkan sesi', { esc: true });
await step('/exit', null);

const code = await Promise.race([
  exited,
  wait(6000).then(() => { try { child.kill(); } catch { /* */ } return 'timeout'; }),
]);

const raw = out.join('');
const plain = raw.split('\x1b[H').pop().replace(/\x1b\][^\x07]*\x07/g, '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
ok(code === 0, `exit code 0 (dapat ${code})`);
ok(!/TypeError|ReferenceError|UnhandledPromise|is not a function/.test(raw), 'tidak ada error runtime');
ok(!plain.includes('Perintah "/bantu" tidak dikenal'), 'perintah dikenal semua');
ok(fs.existsSync(path.join(work, 'BEOT.md')), '/init menulis BEOT.md');
ok(fs.readFileSync(path.join(work, 'BEOT.md'), 'utf8').includes('tes pakai node'), '/ingat masuk BEOT.md');
const sessDir = path.join(home, '.beot', 'sessions');
ok(fs.existsSync(sessDir) && fs.readdirSync(sessDir).some((f) => f.endsWith('.jsonl')), 'chat membuat file sesi');

// Regresi: cwd = folder home -> ~/.beot/skills jangan dihitung sebagai skill proyek.
const homeOut = [];
const child2 = spawn(process.execPath, [path.join(ROOT, 'tests', 'tui-run.cjs')], {
  cwd: home,
  env: { ...process.env, USERPROFILE: home, HOME: home, HOMEPATH: home },
  stdio: ['pipe', 'pipe', 'pipe'],
});
child2.stdout.on('data', (d) => homeOut.push(String(d)));
child2.stderr.on('data', (d) => homeOut.push(String(d)));
await wait(1500);
child2.stdin.write('/exit\n');
await wait(500);
try { child2.kill(); } catch { /* sudah keluar */ }
ok(!homeOut.join('').includes('skill proyek'), 'cwd=home tidak menghitung skill user sebagai proyek');

server.close();
for (const dir of [work, home, outside]) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* kunci file */ }
}

if (fails.length) {
  console.error(`GAGAL ${fails.length} cek:`);
  for (const f of fails) console.error(`  - ${f}`);
  console.error('\n--- layar terakhir ---');
  console.error(plain.split('\n').slice(-14).join('\n'));
  process.exit(1);
}
console.log('ok  menu-e2e: 36 perintah & popup dijalankan tanpa error');
process.exit(0);
