// Baca clipboard OS: gambar (PNG base64) atau teks. Windows via PowerShell,
// macOS via osascript/pbpaste, Linux via wl-paste/xclip (best effort).
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readDoc } from './readfile.js';

const run = promisify(execFile);
const MAX_BYTES = 5 * 1024 * 1024;
const IMAGE_MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

function tempPng() {
  return path.join(os.tmpdir(), `beot-clip-${process.pid}-${Date.now()}.png`);
}

async function imageFromFile(file, mime = 'image/png', name = 'gambar.png') {
  try {
    const buf = await fs.readFile(file);
    if (!buf.length) return null;
    if (buf.length > MAX_BYTES) {
      return { type: 'error', message: 'Gambar lebih dari 5 MB — perkecil dulu.' };
    }
    return {
      type: 'image',
      mime,
      name,
      data: buf.toString('base64'),
      bytes: buf.length,
    };
  } catch {
    return null;
  } finally {
    fs.rm(file, { force: true }).catch(() => {});
  }
}

// File dari clipboard (drag/copy dari Explorer): gambar atau dokumen teks/PDF.
async function fileAttachment(file) {
  const ext = path.extname(file).toLowerCase();
  const mime = IMAGE_MIME[ext];
  const name = path.basename(file);
  try {
    if (mime) {
      const buf = await fs.readFile(file);
      if (buf.length > MAX_BYTES) {
        return { type: 'error', message: `${name} lebih dari 5 MB — perkecil dulu.` };
      }
      return { type: 'image', mime, name, data: buf.toString('base64'), bytes: buf.length };
    }
    const doc = await readDoc(file);
    return {
      type: 'doc',
      name: doc.nama,
      kind: doc.kind,
      text: doc.text,
      bytes: doc.bytes,
      truncated: doc.truncated,
    };
  } catch (err) {
    return { type: 'error', message: err.message };
  }
}

async function windowsImage() {
  const file = tempPng();
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    'Add-Type -AssemblyName System.Drawing',
    '$img = [System.Windows.Forms.Clipboard]::GetImage()',
    'if ($img -ne $null) {',
    "  $img.Save($env:BEOT_CLIP_PATH, [System.Drawing.Imaging.ImageFormat]::Png)",
    "  Write-Output 'IMG'",
    '} else { Write-Output \'NONE\' }',
  ].join('; ');
  try {
    const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-Command', script], {
      env: { ...process.env, BEOT_CLIP_PATH: file },
      timeout: 8000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    });
    if (stdout.trim() === 'IMG') return await imageFromFile(file);
  } catch {
    /* clipboard tidak bisa dibaca */
  }
  fs.rm(file, { force: true }).catch(() => {});
  return null;
}

async function windowsFiles() {
  try {
    const { stdout } = await run('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      'Get-Clipboard -Format FileDropList | ForEach-Object { $_.FullName }',
    ], { timeout: 5000, maxBuffer: 64 * 1024, windowsHide: true });
    return String(stdout).split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0] || null;
  } catch {
    return null;
  }
}

async function windowsText() {
  try {
    const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-Clipboard -Raw'], {
      timeout: 8000,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    });
    const text = String(stdout).replace(/\r\n/g, '\n').replace(/\n$/, '');
    return text ? { type: 'text', text } : null;
  } catch {
    return null;
  }
}

async function macImage() {
  const file = tempPng();
  const script = [
    'set imageData to the clipboard as «class PNGf»',
    `set out to open for access POSIX file ${JSON.stringify(file)} with write permission`,
    'write imageData to out',
    'close access out',
  ];
  const args = script.flatMap((s) => ['-e', s]);
  try {
    await run('osascript', args, { timeout: 8000 });
    return await imageFromFile(file);
  } catch {
    fs.rm(file, { force: true }).catch(() => {});
    return null;
  }
}

async function macText() {
  try {
    const { stdout } = await run('pbpaste', [], { timeout: 4000, maxBuffer: 4 * 1024 * 1024 });
    const text = String(stdout).replace(/\n$/, '');
    return text ? { type: 'text', text } : null;
  } catch {
    return null;
  }
}

async function linuxImage() {
  const cmds = [
    ['wl-paste', ['--type', 'image/png']],
    ['xclip', ['-selection', 'clipboard', '-t', 'image/png', '-o']],
  ];
  for (const [cmd, args] of cmds) {
    try {
      const { stdout } = await run(cmd, args, {
        timeout: 4000,
        maxBuffer: MAX_BYTES,
        encoding: 'buffer',
      });
      const buf = Buffer.from(stdout);
      if (buf.length) {
        if (buf.length > MAX_BYTES) return { type: 'error', message: 'Gambar lebih dari 5 MB — perkecil dulu.' };
        return { type: 'image', mime: 'image/png', name: 'gambar.png', data: buf.toString('base64'), bytes: buf.length };
      }
    } catch {
      /* coba utilitas berikutnya */
    }
  }
  return null;
}

async function linuxText() {
  const cmds = [
    ['wl-paste', ['--no-newline']],
    ['xclip', ['-selection', 'clipboard', '-o']],
    ['xsel', ['--clipboard', '--output']],
  ];
  for (const [cmd, args] of cmds) {
    try {
      const { stdout } = await run(cmd, args, { timeout: 4000, maxBuffer: 4 * 1024 * 1024 });
      const text = String(stdout).replace(/\n$/, '');
      return text ? { type: 'text', text } : null;
    } catch {
      /* coba utilitas berikutnya */
    }
  }
  return null;
}

export function writeClipboardText(text) {
  if (process.env.BEOT_NO_CLIPBOARD) return Promise.resolve(false);
  const value = String(text ?? '');
  if (!value) return Promise.resolve(false);
  const cmd = process.platform === 'win32' ? 'clip.exe'
    : process.platform === 'darwin' ? 'pbcopy' : 'wl-copy';
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, [], { stdio: ['pipe', 'ignore', 'ignore'] });
    } catch {
      resolve(false);
      return;
    }
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
    child.stdin.end(value);
  });
}

export async function readClipboard() {
  if (process.platform === 'win32') {
    const file = await windowsFiles();
    if (file) {
      const attached = await fileAttachment(file);
      if (attached) return attached;
    }
    return (await windowsImage()) || (await windowsText());
  }
  if (process.platform === 'darwin') {
    return (await macImage()) || (await macText());
  }
  return (await linuxImage()) || (await linuxText());
}
