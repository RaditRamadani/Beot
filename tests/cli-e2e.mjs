// E2E CLI & jalur error: semua flag, argumen folder, tool baca di -p, mode pipe, dan validasi perintah.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); };

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'beot-cli-'));
const sub = path.join(work, 'sub-proyek');
fs.mkdirSync(sub);
fs.writeFileSync(path.join(work, 'fakta.txt'), 'RAHASIA-BACA-42\n');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'beot-cli-home-'));
fs.mkdirSync(path.join(home, '.beot'), { recursive: true });

// Server mock: ronde 1 panggil read_file, ronde 2 balas isi yang dibaca.
const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (d) => { raw += d; });
  req.on('end', () => {
    if (req.url.endsWith('/models')) { res.writeHead(404); res.end('{}'); return; }
    const body = JSON.parse(raw || '{}');
    const toolMsg = body.messages.find((m) => m.role === 'tool');
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
    if (!toolMsg) {
      send({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'r1', type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ path: 'fakta.txt' }) } }] } }] });
      send({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] });
    } else {
      const found = String(toolMsg.content).includes('RAHASIA-BACA-42') ? 'TERBACA-42' : 'GAGAL';
      send({ choices: [{ delta: { content: `Hasil: ${found}` } }] });
      send({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 15, completion_tokens: 4, total_tokens: 19 } });
    }
    res.write('data: [DONE]\n\n');
    res.end();
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));

const writeCfg = (extra = {}) => {
  fs.writeFileSync(path.join(home, '.beot', 'config.json'), JSON.stringify({
    base_url: `http://127.0.0.1:${server.address().port}/v1`,
    api_key: 'sk-awal-12345678', model: 'gemini-2.0-flash', persona: 'build',
    stream_timeout: 20, ...extra,
  }));
};
writeCfg();

function run(args = [], stdinText = null, cwd = work) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'index.js'), ...args], {
      cwd,
      env: { ...process.env, USERPROFILE: home, HOME: home, HOMEPATH: home },
      stdio: [stdinText != null ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    if (stdinText != null) {
      child.stdin.write(stdinText);
      child.stdin.end();
    }
    child.on('exit', (code) => resolve({ code, out, err }));
  });
}

// 1) Flag versi & bantuan
for (const flag of ['--version', '-v']) {
  const r = await run([flag]);
  ok(r.code === 0 && r.out.trim() === 'beot 0.1.0', `${flag}: versi benar`);
}
for (const flag of ['--help', '-h']) {
  const r = await run([flag]);
  ok(r.code === 0 && r.out.includes('--output-format json') && !r.out.includes('\u001b['), `${flag}: bantuan bersih`);
}

// 2) Flag tidak dikenal & format salah -> exit 2
const badFlag = await run(['--ngawur']);
ok(badFlag.code === 2 && /flag tidak dikenal.*--ngawur/.test(badFlag.err), 'flag asing ditolak exit 2');

const badFmt = await run(['-p', 'hai', '--output-format', 'xml']);
ok(badFmt.code === 2 && /harus "text" atau "json"/.test(badFmt.err), 'output-format asing ditolak exit 2');

const badFmtEq = await run(['-p', 'hai', '--output-format=yaml']);
ok(badFmtEq.code === 2, 'output-format=yaml ditolak exit 2');

// 3) Argumen folder valid & folder hilang + /quit
const inSub = await run([sub], '/cd\n/quit\n');
ok(inSub.code === 0 && inSub.out.includes('sub-proyek'), 'beot <folder> masuk ke folder itu');
ok(!inSub.out.includes('\u001b['), 'mode pipe bebas ANSI');

const inMissing = await run([path.join(work, 'tidak-ada')], '/quit\n');
ok(inMissing.code === 0 && inMissing.out.includes('Folder tidak ditemukan'), 'beot <folder-hilang> memberi peringatan');

// 4) Headless -p dengan tool baca (read_file diizinkan di headless)
const headRead = await run(['-p', 'baca fakta.txt', '--output-format', 'json']);
let parsed = null;
try { parsed = JSON.parse(headRead.out); } catch { /* */ }
ok(headRead.code === 0, `-p read_file: exit 0 (dapat ${headRead.code})`);
ok(parsed?.text === 'Hasil: TERBACA-42', `-p read_file: isi file terbaca (dapat ${parsed?.text})`);
ok(parsed?.toolCalls?.[0]?.name === 'read_file' && parsed?.toolCalls?.[0]?.ok === true, '-p read_file: toolCalls ok:true');

// 5) Headless tanpa API key pada host non-lokal -> exit 1
writeCfg({ base_url: 'https://api.example.com/v1', api_key: '' });
const noKey = await run(['-p', 'halo']);
ok(noKey.code === 1 && /API key belum ada/.test(noKey.err), '-p tanpa key: exit 1 + pesan jelas');
writeCfg();

// 6) Sapu jalur error perintah di mode pipe + /status + /cost + /init --force + ganti host hapus key
const cmds = [
  '/status',
  '/cost',
  '/cd folder-tidak-ada',
  '/tugas file-tidak-ada.txt',
  '/model base bukan-url',
  '/theme tidak-ada',
  '/persona tidak-ada',
  '/skill tidak-ada',
  '/ingat',
  '/init',
  '/init',
  '/init --force',
  '/model base https://host-baru.test/v1',
  '/quit',
].join('\n') + '\n';
const sweep = await run([], cmds);
ok(sweep.code === 0, 'pipe sweep: exit 0 lewat /quit');
ok(!sweep.out.includes('\u001b['), 'pipe sweep: 0 byte ANSI');
for (const [needle, label] of [
  ['Status sesi', '/status di pipe mencetak teks'],
  ['Biaya (perkiraan)', '/cost di pipe mencetak teks'],
  ['Folder tidak bisa dibuka', '/cd folder hilang ditolak'],
  ['File tidak ditemukan', '/tugas file hilang ditolak'],
  ['harus diawali http://', '/model base non-http ditolak'],
  ['Tema "tidak-ada" tidak ada', '/theme asing ditolak'],
  ['Persona "tidak-ada" tidak ada', '/persona asing ditolak'],
  ['Skill "tidak-ada" tidak ada', '/skill asing ditolak'],
  ['Pakai: /ingat', '/ingat kosong ditolak'],
  ['Memori proyek dibuat: BEOT.md', '/init membuat BEOT.md'],
  ['BEOT.md sudah ada', '/init kedua menolak tanpa --force'],
  ['Host berubah — API key lama dihapus', '/model base beda host menghapus key'],
  ['Sampai jumpa.', '/quit keluar rapi'],
]) {
  ok(sweep.out.includes(needle), label);
}
const afterCfg = JSON.parse(fs.readFileSync(path.join(home, '.beot', 'config.json'), 'utf8'));
ok(afterCfg.api_key === '', 'config di disk benar-benar mengosongkan api_key setelah ganti host');

server.close();
for (const d of [work, home]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* */ } }

if (fails.length) {
  console.error(`GAGAL ${fails.length} cek:`);
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('ok  cli-e2e: semua flag CLI, tool baca -p, mode pipe, & jalur error perintah');
process.exit(0);
