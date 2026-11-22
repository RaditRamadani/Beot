// web_fetch: ambil teks dari URL publik. SSRF dijaga dengan menolak host privat.
const MAX_BYTES = 1_000_000;
const TIMEOUT_MS = 10_000;

const BLOCKED_V4 = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^0\.0\.0\.0$/,
];

// Catatan: pemeriksaan berbasis nama host (bukan hasil DNS), jadi DNS rebinding
// tidak tertangani. Redirect divalidasi per-hop di runWebTool.
export function isPrivateHost(hostname) {
  let host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (host === 'localhost' || host === '::1') return true;
  if (host.endsWith('.local')) return true;
  // IPv4-mapped IPv6: ::ffff:127.0.0.1 atau ::ffff:7f00:1
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(host);
  if (mapped) return isPrivateHost(mapped[1]);
  if (host.startsWith('::ffff:')) return true;
  if (/^(fc|fd)[0-9a-f]{2}:/.test(host)) return true; // unique local
  if (/^fe[89ab][0-9a-f]:/.test(host)) return true; // link-local
  return BLOCKED_V4.some((re) => re.test(host));
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
  const mode = opts.webMode || 'ask';
  if (mode === 'deny') throw new Error('Tool web dimatikan (config web = deny).');

  const guard = (u) => {
    if (!/^https?:$/.test(u.protocol)) throw new Error('Hanya http:// atau https:// yang didukung.');
    if (isPrivateHost(u.hostname)) throw new Error('Host privat/localhost diblokir (SSRF).');
  };
  guard(url);

  if (mode === 'ask') {
    const yes = opts.confirmFetch ? await opts.confirmFetch(url.hostname) : false;
    if (!yes) return { content: 'DIBATALKAN: pengguna menolak mengunduh URL.', refused: true, note: `batal ${url.hostname}` };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res;
  try {
    let current = url;
    for (let hop = 0; hop <= 3; hop++) {
      guard(current);
      res = await fetch(current, {
        signal: ctrl.signal,
        redirect: 'manual',
        headers: { 'user-agent': 'Beot/0.1 (+terminal chat)' },
      });
      if (![301, 302, 303, 307, 308].includes(res.status)) break;
      const loc = res.headers.get('location');
      if (!loc) throw new Error(`Redirect ${res.status} tanpa Location.`);
      current = new URL(loc, current);
      if (hop === 3) throw new Error('Terlalu banyak redirect (maks 4).');
    }
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`Timeout mengunduh ${url.hostname}.`);
    throw new Error(/^(Host|Hanya|Redirect|Terlalu|URL)/.test(err.message) ? err.message : `Gagal mengunduh: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`Server menjawab HTTP ${res.status}.`);

  const type = res.headers.get('content-type') || '';
  let buf;
  let cut = false;
  const body = res.body;
  if (body && typeof body.getReader === 'function') {
    const reader = body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (total + value.length > MAX_BYTES) {
        chunks.push(value.subarray(0, MAX_BYTES - total));
        cut = true;
        try { await reader.cancel(); } catch { /* abaikan */ }
        break;
      }
      chunks.push(value);
      total += value.length;
    }
    buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  } else {
    const raw = Buffer.from(await res.arrayBuffer());
    cut = raw.length > MAX_BYTES;
    buf = raw.subarray(0, MAX_BYTES);
  }
  const text = /html/i.test(type) || /^\s*</.test(buf.toString('utf8')) ? htmlToText(buf.toString('utf8')) : buf.toString('utf8').trim();
  if (!text) throw new Error('Halaman tidak berisi teks yang bisa dibaca.');
  return {
    content: `${text}${cut ? '\n… (dipotong 1 MB)' : ''}`,
    note: `unduh ${url.hostname} (${Math.max(1, Math.round(buf.length / 1024))} kB)`,
  };
}
