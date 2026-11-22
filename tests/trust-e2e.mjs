// E2E keamanan: skill/BEOT.md dari repo harus diizinkan dulu (default tanya).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); };

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'beot-trust-'));
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'beot-trust-home-'));
fs.mkdirSync(path.join(work, '.beot', 'skills'), { recursive: true });
fs.writeFileSync(path.join(work, '.beot', 'skills', 'proyek.md'),
  '---\nnama: proyek-skill\ndeskripsi: dari repo\n---\nInstruksi repo.\n');
fs.writeFileSync(path.join(work, 'BEOT.md'), '- proyek ini punya aturan\n');
fs.mkdirSync(path.join(home, '.beot'), { recursive: true });
fs.writeFileSync(path.join(home, '.beot', 'config.json'), JSON.stringify({
  base_url: 'http://127.0.0.1:9/v1', api_key: 'x', model: 'mock', persona: 'build',
  stream_timeout: 3, shell: 'deny', web: 'deny',
}));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const clean = (s) => String(s).replace(/\x1b\][^\x07]*\x07/g, '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');

function start() {
  const out = [];
  const child = spawn(process.execPath, [path.join(ROOT, 'tests', 'tui-run.cjs')], {
    cwd: work,
    env: { ...process.env, USERPROFILE: home, HOME: home, HOMEPATH: home },
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
  const frame = () => clean(out.join('').split('\x1b[H').pop() || '');
  return { child, text, until, frame };
}

// 1) Tolak: skill repo tidak boleh dimuat, pilihan disimpan.
const a = start();
ok(await a.until('Muat memori proyek?'), 'prompt izin muncul');
a.child.stdin.write('\x1b');
await wait(600);
ok(a.text().includes('diabaikan'), 'penolakan terlihat di layar');
a.child.stdin.write('/skill\n');
await wait(600);
ok(!a.text().includes('proyek-skill'), 'skill repo tidak dimuat setelah ditolak');
a.child.stdin.write('/exit\n');
await wait(400);
try { a.child.kill(); } catch { /* */ }

let cfg = JSON.parse(fs.readFileSync(path.join(home, '.beot', 'config.json'), 'utf8'));
ok(cfg.project_trust?.[work] === 'no', 'penolakan disimpan di config');

// 2) Tidak ditanya lagi pada start berikutnya.
const b = start();
await wait(1500);
ok(!b.text().includes('Muat memori proyek?'), 'tidak bertanya ulang');
ok(b.text().includes('diabaikan'), 'tetap diabaikan');
b.child.stdin.write('/exit\n');
await wait(400);
try { b.child.kill(); } catch { /* */ }

// 3) Setujui lewat config -> skill repo dipakai tanpa prompt.
cfg = JSON.parse(fs.readFileSync(path.join(home, '.beot', 'config.json'), 'utf8'));
cfg.project_trust = { [work]: 'yes' };
fs.writeFileSync(path.join(home, '.beot', 'config.json'), JSON.stringify(cfg));
const c = start();
await wait(1500);
ok(!c.text().includes('Muat memori proyek?'), 'tidak prompt saat sudah dipercaya');
c.child.stdin.write('/skill\n');
await wait(600);
ok(c.text().includes('proyek-skill'), 'skill repo dimuat setelah disetujui');
c.child.stdin.write('/exit\n');
await wait(400);
try { c.child.kill(); } catch { /* */ }

for (const d of [work, home]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* */ } }

if (fails.length) {
  console.error(`GAGAL ${fails.length} cek:`);
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('ok  trust-e2e: skill/BEOT.md repo butuh izin, pilihan disimpan');
process.exit(0);
