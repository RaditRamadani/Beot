// Ringkas riwayat jadi satu pesan supaya konteks tidak meledak.
import { streamChat } from './llm.js';

const MAX_INPUT = 14_000;

export function buildCompactInput(history, maxChars = MAX_INPUT) {
  const parts = [];
  for (const m of history) {
    const text = typeof m.content === 'string' ? m.content : '[lampiran]';
    parts.push(`${m.role === 'user' ? 'Pengguna' : 'Asisten'}: ${text}`);
  }
  let out = parts.join('\n\n');
  if (out.length > maxChars) out = `…(dipotong)\n${out.slice(-maxChars)}`;
  return out;
}

export const COMPACT_SYSTEM = 'Ringkas percakapan berikut untuk konteks lanjutan. Pertahankan: keputusan, path file, perintah yang sudah dijalankan, temuan, dan sisa tugas. Buang basa-basi. Maksimal 400 kata, bahasa Indonesia.';

export function compactedHistory(summary) {
  return [{ role: 'user', content: `[RINGKASAN PERCAKAPAN SEBELUMNYA]\n${summary}` }];
}

export async function summarize({ history, baseUrl, apiKey, model, signal, idleMs }) {
  let out = '';
  await streamChat({
    baseUrl,
    apiKey,
    model,
    messages: [
      { role: 'system', content: COMPACT_SYSTEM },
      { role: 'user', content: buildCompactInput(history) },
    ],
    tools: null,
    temperature: 0.2,
    signal,
    idleMs,
    onToken: (d) => { out += d; },
  });
  return out.trim();
}
