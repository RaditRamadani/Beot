// E2E headless: beot -p "..." (teks & JSON), tanpa TUI, tanpa ANSI.
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
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
    send({ choices: [{ delta: { content: 'halo dunia' } }] });
    send({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 } });
    res.write('data: [DONE]\n\n');
    res.end();
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'beot-head-'));
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'beot-head-home-'));
fs.mkdirSync(path.join(home, '.beot'), { recursive: true });
fs.writeFileSync(path.join(home, '.beot', 'config.json'), JSON.stringify({
  base_url: `http://127.0.0.1:${server.address().port}/v1`,
  api_key: 'test', model: 'mock', persona: 'build', stream_timeout: 20,
}));

function run(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'index.js'), ...args], {
      cwd: work,
      env: { ...process.env, USERPROFILE: home, HOME: home, HOMEPATH: home },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('exit', (code) => resolve({ code, out, err }));
  });
}

const json = await run(['-p', 'hai', '--output-format', 'json']);
let parsed = null;
try { parsed = JSON.parse(json.out); } catch { /* di bawah */ }
ok(json.code === 0, `json: exit 0 (dapat ${json.code})`);
ok(parsed && parsed.text === 'halo dunia', 'json: teks jawaban');
ok(parsed && parsed.model === 'mock', 'json: model');
ok(parsed && parsed.tokens === 15, 'json: token dari usage');
ok(Array.isArray(parsed?.toolCalls), 'json: toolCalls array');
ok(!json.out.includes('\u001b['), 'json: tanpa ANSI');
ok(!json.out.includes('beot 0.1'), 'json: tanpa banner');

const text = await run(['-p', 'hai']);
ok(text.code === 0, `teks: exit 0 (dapat ${text.code})`);
ok(text.out.trim() === 'halo dunia', `teks: hanya jawaban (dapat ${JSON.stringify(text.out.trim())})`);
ok(!text.out.includes('\u001b['), 'teks: tanpa ANSI');

const empty = await run(['-p', '']);
ok(empty.code === 2, `prompt kosong: exit 2 (dapat ${empty.code})`);
ok(/Prompt kosong/.test(empty.err), 'prompt kosong: pesan di stderr');

server.close();
for (const dir of [work, home]) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ } }

if (fails.length) {
  console.error(`GAGAL ${fails.length} cek:`);
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('ok  headless-e2e: -p teks & JSON, tanpa ANSI');
process.exit(0);
