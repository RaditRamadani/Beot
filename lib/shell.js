// Tool shell: perintah dijalankan dengan izin pengguna + daftar tolak-keras.
import { spawn } from 'node:child_process';

const MAX_OUT = 60_000;
const MAX_TIMEOUT = 120_000;

// Tidak bisa di-allow: pola yang berpotensi merusak sistem.
const DENY = [
  /\brm\s+(-[a-z]+\s+)*\/(\s|$)/i,
  /\bformat\s+[a-z]:/i,
  /\bshutdown\b/i,
  /\bdiskpart\b/i,
  /\bmkfs(\.|\s)/i,
  /\bdd\s+[^|]*of=\/dev\//i,
  /(curl|wget)[^|]*\|\s*(sh|bash|zsh)\b/i,
  /\bdel\s+\/[fsq]\b[^|]*[a-z]:\\/i,
  /\brd\s+\/s\b[^|]*[a-z]:\\/i,
  /:\(\)\s*\{/,
];

export function buildShellTool() {
  return [{
    type: 'function',
    function: {
      name: 'bash',
      description: 'Jalankan satu perintah shell di folder kerja (mis. npm test, git status, node --check). Pengguna diminta izin kecuali mode shell = allow.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Perintah lengkap, satu baris.' },
          timeout_ms: { type: 'number', description: 'Batas waktu milidetik (default 30000, maks 120000).' },
        },
        required: ['command'],
      },
    },
  }];
}

function killTree(child) {
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    else process.kill(-child.pid, 'SIGKILL');
  } catch {
    try { child.kill('SIGKILL'); } catch { /* sudah mati */ }
  }
}

const clean = (s) => String(s).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, '');
const shorten = (cmd) => (cmd.length > 46 ? `${cmd.slice(0, 43)}…` : cmd);

export async function runShellTool(args = {}, opts = {}) {
  const cmd = String(args.command || '').trim();
  if (!cmd) throw new Error('command wajib diisi.');
  if (cmd.length > 4000) throw new Error('Perintah terlalu panjang (maks 4000 karakter).');
  if (DENY.some((re) => re.test(cmd))) throw new Error('Perintah diblokir: berpotensi merusak sistem.');

  const mode = opts.planning ? 'ask' : (opts.shellMode || 'ask');
  if (mode === 'deny') throw new Error('Tool shell dimatikan (config shell = deny).');
  if (mode === 'ask') {
    const yes = opts.confirmShell ? await opts.confirmShell(cmd) : false;
    if (!yes) return { content: 'DIBATALKAN: pengguna menolak menjalankan perintah.', refused: true, note: `batal ${shorten(cmd)}` };
  }

  const timeout = Math.min(MAX_TIMEOUT, Math.max(1000, Number(args.timeout_ms) || 30_000));
  return await new Promise((resolve) => {
    let out = '';
    let cut = false;
    let timedOut = false;
    let child;
    try {
      child = spawn(cmd, {
        shell: true,
        cwd: opts.cwd,
        env: process.env,
        windowsHide: true,
        detached: process.platform !== 'win32',
      });
    } catch (err) {
      return resolve({ error: `Gagal menjalankan: ${err.message}` });
    }

    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, timeout);

    const push = (buf) => {
      if (cut) return;
      out += clean(String(buf));
      if (out.length > MAX_OUT) {
        out = out.slice(0, MAX_OUT);
        cut = true;
      }
    };
    child.stdout?.on('data', push);
    child.stderr?.on('data', push);
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ error: `Gagal menjalankan: ${err.message}` });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const body = out.trimEnd();
      if (timedOut) {
        return resolve({ error: `Perintah dihentikan setelah ${Math.round(timeout / 1000)} dtk (timeout).`, note: `timeout ${shorten(cmd)}` });
      }
      const status = code === 0 ? 'ok' : `exit ${code}${signal ? ` · ${signal}` : ''}`;
      const text = body ? `${status}\n${body}` : status;
      resolve({
        content: cut ? `${text}\n… output dipotong (${MAX_OUT} karakter)` : text,
        note: `jalan ${shorten(cmd)}`,
      });
    });
  });
}
