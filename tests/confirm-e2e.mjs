// E2E: default write_confirm = true. Tanpa jawaban, file tidak ditulis.
// Skenario 1: Enter (setuju) -> file dibuat. Skenario 2: Esc (tolak) -> tidak dibuat.
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
    if (req.url.endsWith('/models')) { res.writeHead(404); res.end('{}'); return; }
    const body = JSON.parse(raw || '{}');
    const afterTool = body.messages.some((m) => m.role === 'tool');
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
    if (!afterTool) {
      send({ choices: [{ delta: { tool_calls: [{
        index: 0, id: 'c1', type: 'function',
        function: { name: 'write_file', arguments: JSON.stringify({ path: 'konfirmasi.txt', content: 'isi rahasia\n' }) },
      }] } }] });
      send({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] });
    } else {
      send({ choices: [{ delta: { content: 'Selesai diproses.' } }] });
      send({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } });
    }
    res.write('data: [DONE]\n\n');
    res.end();
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function scenario(name, keyChar, expectFile) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'beot-conf-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'beot-conf-home-'));
  fs.mkdirSync(path.join(home, '.beot'), { recursive: true });
  // write_confirm sengaja TIDAK diisi: harus memakai default (tanya dulu).
  fs.writeFileSync(path.join(home, '.beot', 'config.json'), JSON.stringify({
    base_url: `http://127.0.0.1:${server.address().port}/v1`,
    api_key: 'test', model: 'mock', persona: 'build', stream_timeout: 20,
    external: 'ask', shell: 'deny',
  }));

  const out = [];
  const child = spawn(process.execPath, [path.join(ROOT, 'tests', 'tui-run.cjs')], {
    cwd: work,
    env: { ...process.env, USERPROFILE: home, HOME: home, HOMEPATH: home },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => out.push(String(d)));
  child.stderr.on('data', (d) => out.push(String(d)));

  child.stdin.write('tulis file konfirmasi\n');
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    await wait(200);
    if (out.join('').includes('Simpan konfirmasi.txt')) break;
  }
  const promptShown = out.join('').includes('Simpan konfirmasi.txt');
  const existedBefore = fs.existsSync(path.join(work, 'konfirmasi.txt'));

  child.stdin.write(keyChar);
  await wait(1200);
  child.stdin.write('/exit\n');
  await wait(400);
  try { child.kill(); } catch { /* sudah keluar */ }

  const exists = fs.existsSync(path.join(work, 'konfirmasi.txt'));
  ok(promptShown, `${name}: prompt "Simpan" muncul tanpa konfigurasi`);
  ok(!existedBefore, `${name}: file belum ditulis sebelum dijawab`);
  ok(exists === expectFile, `${name}: file ${expectFile ? 'dibuat' : 'tidak dibuat'}`);

  for (const dir of [work, home]) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* kunci file */ }
  }
}

await scenario('setuju', '\r', true);
await scenario('tolak', '\x1b', false);

server.close();
if (fails.length) {
  console.error(`GAGAL ${fails.length} cek:`);
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('ok  confirm-e2e: default tanya dulu (setuju & tolak)');
process.exit(0);
