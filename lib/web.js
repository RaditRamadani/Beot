// web_fetch: ambil teks dari URL publik. SSRF dijaga dengan menolak host privat.
const MAX_BYTES = 1_000_000;
const TIMEOUT_MS = 10_000;

const BLOCKED_HOST = [
  /^localhost$/i,
  /\.local$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^0\.0\.0\.0$/,
  /^\[?::1\]?$/,
  /^\[?fc00:/i,
  /^\[?fe80:/i,
];

export function isPrivateHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  return BLOCKED_HOST.some((re) => re.test(host));
}

export function htmlToText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|br)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function buildWebTool() {
  return [{
    type: 'function',
    function: {
      name: 'web_fetch',
      description: 'Ambil isi teks sebuah URL publik (http/https). Tidak bisa mengakses localhost/jaringan privat.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL lengkap, diawali http:// atau https://.' },
        },
        required: ['url'],
      },
    },
  }];
}

export async function runWebTool(args = {}, opts = {}) {
  let url;
  try {
    url = new URL(String(args.url || '').trim());
  } catch {
    throw new Error('URL tidak valid.');
  }
  if (!/^https?:$/.test(url.protocol)) throw new Error('Hanya http:// atau https:// yang didukung.');
  if (isPrivateHost(url.hostname)) throw new Error('Host privat/localhost diblokir (SSRF).');

  const mode = opts.webMode || 'ask';
  if (mode === 'deny') throw new Error('Tool web dimatikan (config web = deny).');
  if (mode === 'ask') {
    const yes = opts.confirmFetch ? await opts.confirmFetch(url.hostname) : false;
    if (!yes) return { content: 'DIBATALKAN: pengguna menolak mengunduh URL.', refused: true, note: `batal ${url.hostname}` };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'Beot/0.1 (+terminal chat)' },
    });
  } catch (err) {
    throw new Error(err.name === 'AbortError' ? `Timeout mengunduh ${url.hostname}.` : `Gagal mengunduh: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`Server menjawab HTTP ${res.status}.`);

  const type = res.headers.get('content-type') || '';
  const buf = Buffer.from(await res.arrayBuffer());
  const cut = buf.length > MAX_BYTES;
  const body = buf.subarray(0, MAX_BYTES).toString('utf8');
  const text = /html/i.test(type) || /^\s*</.test(body) ? htmlToText(body) : body.trim();
  if (!text) throw new Error('Halaman tidak berisi teks yang bisa dibaca.');
  return {
    content: `${text}${cut ? '\n… (dipotong 1 MB)' : ''}`,
    note: `unduh ${url.hostname} (${Math.max(1, Math.round(buf.length / 1024))} kB)`,
  };
}
