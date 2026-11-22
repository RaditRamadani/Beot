// E2E update: notice di splash + /update (cek, batal, sudah terbaru, update_check:false).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const clean = (s) => String(s).replace(/\x1b\][^\x07]*\x07/g, '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');

function registry(version) {
  const state = { hits: 0 };
  const server = http.createServer((req, res) => {
    state.hits += 1;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ name: 'beot', version }));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({
      url: `http://127.0.0.1:${server.address().port}/latest`,
      state,
      close: () => server.close(),
    }));
  });
}

function makeHome(updateCheck) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'beot-upd-'));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'beot-upd-work-'));
  fs.mkdirSync(path.join(home, '.beot'), { recursive: true });
  const cfg = {
    base_url: 'http://127.0.0.1:9/v1', api_key: 'x', model: 'mock', persona: 'build',
    stream_timeout: 3, shell: 'deny', web: 'deny',
  };
  if (updateCheck === false) cfg.update_check = false;
  fs.writeFileSync(path.join(home, '.beot', 'config.json'), JSON.stringify(cfg));
  return { home, work };
}

function start(home, work, url, extraEnv = {}) {
  const out = [];
  const child = spawn(process.execPath, [path.join(ROOT, 'tests', 'tui-run.cjs')], {
    cwd: work,
    env: { ...process.env, USERPROFILE: home, HOME: home, HOMEPATH: home, BEOT_UPDATE_URL: url, ...extraEnv },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => out.push(String(d)));
  child.stderr.on('data', (d) => out.push(String(d)));
  const text = () => clean(out.join(''));
  const until = async (needle, ms = 8000) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (text().includes(needle)) return true;
      await wait(120);
    }
    return false;
  };
  return { child, text, until };
}

// 1) Notifikasi muncul di splash saat ada versi lebih baru.
{
  const reg = await registry('9.9.9');
  const { home, work } = makeHome(true);
  const a = start(home, work, reg.url);
  ok(await a.until('/update untuk memasang v9.9.9'), 'splash menampilkan /update v9.9.9');
  a.child.stdin.write('/exit\n');
  await wait(400);
  try { a.child.kill(); } catch { /* */ }
  reg.close();
  for (const d of [home, work]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* */ } }
}

// 2) update_check:false -> tanpa request & tanpa tulisan.
{
  const reg = await registry('9.9.9');
  const { home, work } = makeHome(false);
  const b = start(home, work, reg.url);
  await wait(1800);
  ok(!b.text().includes('/update untuk'), 'update_check:false: tanpa notifikasi');
  ok(reg.state.hits === 0, `update_check:false: tanpa request (dapat ${reg.state.hits})`);
  b.child.stdin.write('/exit\n');
  await wait(400);
  try { b.child.kill(); } catch { /* */ }
  reg.close();
  for (const d of [home, work]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* */ } }
}

// 3) /update saat sudah terbaru.
{
  const reg = await registry('0.1.0');
  const { home, work } = makeHome(true);
  const c = start(home, work, reg.url);
  await wait(1200);
  c.child.stdin.write('/update\n');
  ok(await c.until('Sudah versi terbaru'), '/update: melaporkan sudah terbaru');
  c.child.stdin.write('/exit\n');
  await wait(400);
  try { c.child.kill(); } catch { /* */ }
  reg.close();
  for (const d of [home, work]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* */ } }
}

// 4) /update saat ada versi baru -> minta konfirmasi; Esc = batal (tidak memasang).
{
  const reg = await registry('9.9.9');
  const { home, work } = makeHome(true);
  const installRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'beot-upd-root-')); // bukan repo git
  const d = start(home, work, reg.url, { BEOT_INSTALL_ROOT: installRoot });
  await wait(1200);
  d.child.stdin.write('/update\n');
  ok(await d.until('Pasang beot v9.9.9 sekarang?'), '/update: konfirmasi pemasangan');
  d.child.stdin.write('\x1b');
  ok(await d.until('Dibatalkan'), '/update: Esc membatalkan');
  d.child.stdin.write('/exit\n');
  await wait(400);
  try { d.child.kill(); } catch { /* */ }
  reg.close();
  for (const dir of [home, work, installRoot]) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ } }
}

// 5) Instalasi dari git -> tampilkan perintah, bukan menjalankan npm.
{
  const reg = await registry('9.9.9');
  const { home, work } = makeHome(true);
  const e = start(home, work, reg.url); // tanpa override -> ROOT repo ini punya .git
  await wait(1200);
  e.child.stdin.write('/update\n');
  ok(await e.until('Instalasi dari git'), '/update di repo: menampilkan perintah git');
  ok(e.text().includes('git pull && npm install'), '/update: perintah git disebut');
  e.child.stdin.write('/exit\n');
  await wait(400);
  try { e.child.kill(); } catch { /* */ }
  reg.close();
  for (const dir of [home, work]) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ } }
}

if (fails.length) {
  console.error(`GAGAL ${fails.length} cek:`);
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('ok  update-e2e: notifikasi splash, /update, batal, update_check:false');
process.exit(0);
