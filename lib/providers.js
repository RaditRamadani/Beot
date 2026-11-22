// Katalog provider OpenAI-compatible. Daftar model = saran; user selalu bisa ketik sendiri.
export const PROVIDERS = [
  {
    id: 'gemini',
    nama: 'Gemini (Google)',
    base_url: 'https://generativelanguage.googleapis.com/v1beta/openai',
    catatan: 'gratis · Google AI Studio',
    keyless: false,
    models: ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.5-pro'],
  },
  {
    id: 'groq',
    nama: 'Groq',
    base_url: 'https://api.groq.com/openai/v1',
    catatan: 'gratis · cepat',
    keyless: false,
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
  },
  {
    id: 'openrouter',
    nama: 'OpenRouter',
    base_url: 'https://openrouter.ai/api/v1',
    catatan: 'banyak model · campur',
    keyless: false,
    models: ['openrouter/auto', 'google/gemini-2.5-flash', 'meta-llama/llama-3.3-70b-instruct'],
  },
  {
    id: 'openai',
    nama: 'OpenAI',
    base_url: 'https://api.openai.com/v1',
    catatan: 'berbayar',
    keyless: false,
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'],
  },
  {
    id: 'ollama',
    nama: 'Ollama (lokal)',
    base_url: 'http://localhost:11434/v1',
    catatan: 'lokal · tanpa key',
    keyless: true,
    models: ['qwen2.5:7b', 'llama3.2:3b', 'mistral:7b'],
  },
  {
    id: 'custom',
    nama: 'Lainnya / custom',
    base_url: '',
    catatan: 'OpenAI-compatible',
    keyless: false,
    models: [],
  },
];

const norm = (url) => (url || '').replace(/\/+$/, '').toLowerCase();

export function findProvider(baseUrl) {
  const target = norm(baseUrl);
  if (!target) return null;
  return PROVIDERS.find((p) => p.base_url && norm(p.base_url) === target) || null;
}

// Model non-chat (embedding, audio, gambar) tidak usah masuk picker.
const NON_CHAT = /embed|rerank|moderation|modera|whisper|tts|transcri|speech|audio|dall-e|imagen|sora|diffusion|guard|safety|clip|ocr|vision$|-vl\b/i;

// Ambil daftar model live dari provider: GET {base_url}/models (OpenAI-compatible).
// Gagal (401/timeout/provider dsb) → null, caller jatuh ke daftar statis.
export async function fetchModels(baseUrl, apiKey) {
  if (!baseUrl) return null;
  const url = `${baseUrl.replace(/\/+$/, '')}/models`;
  const headers = {};
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(5000) });
  if (!res.ok) return null;
  const json = await res.json();
  const list = Array.isArray(json?.data) ? json.data : (Array.isArray(json?.models) ? json.models : []);
  const ids = list
    .map((m) => (typeof m === 'string' ? m : m?.id || m?.name))
    .filter((id) => typeof id === 'string' && id && !NON_CHAT.test(id));
  return [...new Set(ids)];
}

// Gabung: model aktif + live (provider) + statis (katalog); tanpa duplikat.
export function mergeModels(current, live = [], statis = []) {
  const out = [];
  for (const m of [current, ...live, ...statis]) {
    if (m && !out.includes(m)) out.push(m);
  }
  return out;
}

