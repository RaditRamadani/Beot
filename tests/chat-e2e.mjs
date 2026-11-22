// E2E: chat nyata lewat provider palsu -> tool write_file -> diff -> jawaban tabel.
// Menjaga alur yang tidak tersentuh selfcheck: loop tool, render TUI, sanitasi ANSI.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); };

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'beot-e2e-'));
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'beot-e2e-home-'));

const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (d) => { raw += d; });
  req.on('end', () => {
    if (req.url.endsWith('/models')) { res.writeHead(404); res.end('{}'); return; }
    const body = JSON.parse(raw || '{}');
    const toolRounds = body.messages.filter((m) => m.role === 'tool').length;
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
    const call = (id, name, args, index = 0) => send({
      choices: [{ delta: { tool_calls: [{ index, id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }],
    });
    if (toolRounds === 0) {
      send({ choices: [{ delta: { content: 'Siap, saya kerjakan.' } }] });
      call('c1', 'todo_write', { todos: [
        { content: 'tulis laporan', status: 'completed' },
        { content: 'perbaiki isi', status: 'in_progress' },
      ] });
      send({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] });
    } else if (toolRounds === 1) {
      call('c2', 'write_file', { path: 'laporan.md', content: '# Laporan\n\nbaris dua\n' }, 0);
      call('c3', 'bash', { command: `${JSON.stringify(process.execPath)} -e "console.log(77)"` }, 1);
      send({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] });
    } else if (toolRounds === 3) {
      call('c4', 'edit_file', { path: 'laporan.md', old_string: 'baris dua', new_string: 'baris DUA' });
      send({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] });
    } else {
      // Escape ANSI diselipkan untuk memastikan dibuang sebelum tampil.
      send({ choices: [{ delta: { content: '| Produk | Perubahan |\n|---|---|\n| **Sepatu** | −18% |\n\nBAHAYA\x1b[31mMERAH\x1b[0m selesai.' } }] });
      send({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 } });
    }
    res.write('data: [DONE]\n\n');
    res.end();
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));

fs.mkdirSync(path.join(home, '.beot'), { recursive: true });
fs.writeFileSync(path.join(home, '.beot', 'config.json'), JSON.stringify({
  base_url: `http://127.0.0.1:${server.address().port}/v1`,
  api_key: 'test', model: 'mock', persona: 'build', stream_timeout: 20,
  write_confirm: false, external: 'trust', shell: 'allow', thinking: true,
}));

const out = [];
const child = spawn(process.execPath, [path.join(ROOT, 'tests', 'tui-run.cjs')], {
  cwd: work,
  env: {
    ...process.env,
    USERPROFILE: home,
    HOME: home,
    HOMEPATH: home,
  },
  stdio: ['pipe', 'pipe', 'pipe'],
});
child.stdout.on('data', (d) => out.push(String(d)));
child.stderr.on('data', (d) => out.push(String(d)));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const deadline = Date.now() + 30_000;
child.stdin.write('bikin laporan dari data penjualan\n');
while (Date.now() < deadline) {
  await wait(250);
  if (out.join('').includes('selesai.')) break;
}
child.stdin.write('/exit\n');
const code = await Promise.race([
  new Promise((r) => child.on('exit', r)),
  wait(8_000).then(() => { try { child.kill(); } catch { /* */ } return 'timeout'; }),
]);

const raw = out.join('');
const plain = raw
  .split('\x1b[H').pop()
  .replace(/\x1b\][^\x07]*\x07/g, '')
  .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
if (process.env.DUMP) process.stdout.write(`--- layar ---\n${plain.split('\n').slice(-22).join('\n')}\n---\n`);

ok(code === 0, `exit code 0 (dapat ${code})`);
ok(fs.existsSync(path.join(work, 'laporan.md')), 'write_file membuat laporan.md');
let written = '';
try { written = fs.readFileSync(path.join(work, 'laporan.md'), 'utf8'); } catch { /* belum dibuat */ }
ok(written.includes('baris DUA'), 'edit_file mengganti potongan isi');
ok(plain.includes('▐ laporan.md'), 'diff menampilkan nama file');
ok(plain.includes('tulis laporan.md'), 'baris buku besar tool tampil');
ok(plain.includes('jalan '), 'bash dijalankan dan dicatat');
ok(plain.includes('tugas 1/2') || plain.includes('tugas 2/2'), 'panel todo tampil');
ok(plain.includes('│ Produk │') && plain.includes('│ Sepatu │'), 'tabel markdown dirender');
ok(raw.includes('█▀▀▄'), 'splash logo tampil saat start');
ok(plain.includes('BAHAYA'), 'teks model tetap tampil');
ok(!raw.includes('\x1b[31mMERAH'), 'escape ANSI dari model dibuang');
ok(!/Error|TypeError|Unhandled/.test(plain), 'tidak ada stack trace di layar');

const sessDir = path.join(home, '.beot', 'sessions');
const sessFile = fs.existsSync(sessDir)
  ? fs.readdirSync(sessDir).filter((f) => f.endsWith('.jsonl')).map((f) => path.join(sessDir, f)).pop()
  : null;
ok(Boolean(sessFile), 'file sesi tersimpan');
let sessText = '';
try { sessText = sessFile ? fs.readFileSync(sessFile, 'utf8') : ''; } catch { /* */ }
ok(sessText.includes('"role":"user"') && sessText.includes('"role":"assistant"'), 'sesi memuat user + assistant');
ok(sessText.includes('"cwd"'), 'sesi punya meta cwd');

// Jalankan ulang dengan --continue: sesi terakhir harus dimuat.
const out2 = [];
const child2 = spawn(process.execPath, [path.join(ROOT, 'tests', 'tui-run.cjs'), '--continue'], {
  cwd: work,
  env: { ...process.env, USERPROFILE: home, HOME: home, HOMEPATH: home },
  stdio: ['pipe', 'pipe', 'pipe'],
});
child2.stdout.on('data', (d) => out2.push(String(d)));
child2.stderr.on('data', (d) => out2.push(String(d)));
await wait(1500);
child2.stdin.write('/exit\n');
await wait(500);
try { child2.kill(); } catch { /* sudah keluar */ }
ok(out2.join('').includes('lanjut sesi'), '--continue memuat sesi terakhir');

server.close();
for (const dir of [work, home]) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* file masih dipakai */ }
}

if (fails.length) {
  console.error(`GAGAL ${fails.length} cek:`);
  for (const f of fails) console.error(`  - ${f}`);
  console.error('\n--- layar terakhir ---');
  console.error(plain.split('\n').slice(-12).join('\n'));
  process.exit(1);
}
console.log('ok  chat-e2e: tool write_file + diff + tabel + sanitasi ANSI');
process.exit(0);
