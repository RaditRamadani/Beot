import fs from 'node:fs';
import path from 'node:path';

export const MAX_BYTES = 50 * 1024;
export const MAX_CHARS = 50_000;
const MAX_PDF_BYTES = 30 * 1024 * 1024;

const TEXT_EXT = new Set(['.txt', '.md', '.markdown', '.csv', '.json', '.log', '.js', '.ts', '.py', '.html', '.css', '.xml', '.yml', '.yaml']);

// Jalur PDF memakai pdf-parse (async): pemanggil wajib await.
export function readDoc(inputPath, cwd = process.cwd()) {
  const filePath = path.resolve(cwd, inputPath);

  if (!fs.existsSync(filePath)) {
    throw new Error(`File tidak ditemukan: ${filePath}`);
  }
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    throw new Error(`Bukan file: ${filePath}`);
  }

  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.docx') {
    throw new Error('File .docx belum didukung v0.1. Simpan dulu sebagai .txt/.md atau export ke PDF.');
  }

  if (ext === '.pdf') {
    if (stat.size > MAX_PDF_BYTES) {
      throw new Error(`PDF terlalu besar (${(stat.size / 1024 / 1024).toFixed(0)} MB). Maks 30 MB — pecah atau export ulang.`);
    }
    return readPdf(filePath, stat.size);
  }

  if (!TEXT_EXT.has(ext) && ext !== '') {
    // tetap coba sebagai teks: banyak file kode tidak punya ekstensi umum
  }

  // Baca hanya sampai batas, jangan muat seluruh file raksasa ke memori.
  const len = Math.min(stat.size, MAX_BYTES + 4);
  const buf = Buffer.alloc(len);
  const fd = fs.openSync(filePath, 'r');
  let read = 0;
  try {
    read = fs.readSync(fd, buf, 0, len, 0);
  } finally {
    fs.closeSync(fd);
  }
  const raw = buf.subarray(0, read);
  const truncatedByBytes = stat.size > MAX_BYTES;
  let text = raw.subarray(0, MAX_BYTES).toString('utf8');
  let truncated = truncatedByBytes;
  if (text.length > MAX_CHARS) {
    text = text.slice(0, MAX_CHARS);
    truncated = true;
  }
  return {
    nama: path.basename(filePath),
    path: filePath,
    text,
    truncated,
    bytes: stat.size,
    kind: ext.slice(1) || 'text',
  };
}

async function readPdf(filePath, bytes) {
  let pdfParse;
  try {
    const mod = await import('pdf-parse');
    pdfParse = mod.default || mod;
  } catch {
    throw new Error("pdf-parse belum terpasang. Jalankan 'npm install' di folder proyek.");
  }
  const raw = fs.readFileSync(filePath);
  // pdf.js lama memakai .buffer dan mengabaikan byteOffset: Buffer kecil berbagi pool
  // Node, jadi file kedua bisa terbaca sebagai file pertama. Beri buffer utuh sendiri.
  const exclusive = raw.byteOffset === 0 && raw.byteLength === raw.buffer.byteLength;
  const buffer = exclusive ? new Uint8Array(raw.buffer) : new Uint8Array(raw);
  const data = await pdfParse(buffer);
  let text = (data.text || '').trim();
  if (text.length < 20) {
    throw new Error('PDF ini sepertinya hasil scan/foto (tidak ada teks). Butuh OCR — belum didukung v0.1.');
  }
  let truncated = false;
  if (text.length > MAX_CHARS) {
    text = text.slice(0, MAX_CHARS);
    truncated = true;
  }
  return {
    nama: path.basename(filePath),
    path: filePath,
    text,
    truncated,
    bytes,
    kind: 'pdf',
  };
}
