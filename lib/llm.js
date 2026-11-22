// Satu jalur untuk semua provider: format OpenAI-compatible /chat/completions.

export function parseSSEChunk(buffer, toolAcc = []) {
  const out = { deltas: [], reasoning: [], rest: buffer, done: false, finish: null, usage: null, model: null, toolCalls: toolAcc };
  let idx;
  while ((idx = out.rest.indexOf('\n')) !== -1) {
    const line = out.rest.slice(0, idx).trim();
    out.rest = out.rest.slice(idx + 1);
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (data === '[DONE]') { out.done = true; continue; }
    let json;
    try {
      json = JSON.parse(data);
    } catch {
      continue; // potongan JSON belum lengkap / baris rusak: lewati baris ini
    }
    // Error gateway yang dikirim di dalam stream (HTTP 200) tidak boleh ditelan diam-diam.
    if (json.error && !Array.isArray(json.choices)) {
      const msg = typeof json.error === 'string' ? json.error : (json.error.message || 'error dari provider');
      const err = new Error(`Provider: ${String(msg).slice(0, 300)}`);
      err.code = 'PROVIDER_ERROR';
      throw err;
    }
    const choice = json.choices?.[0] || {};
    const delta = choice.delta?.content;
    if (delta) out.deltas.push(delta);
    const think = choice.delta?.reasoning_content ?? choice.delta?.reasoning;
    if (typeof think === 'string' && think) out.reasoning.push(think);
    if (choice.finish_reason) out.finish = choice.finish_reason;
    if (json.usage) out.usage = json.usage;
    if (json.model) out.model = json.model;
    const calls = choice.delta?.tool_calls;
    if (Array.isArray(calls)) {
      for (const tc of calls) {
        const i = tc.index ?? 0;
        if (!toolAcc[i]) toolAcc[i] = { id: '', type: 'function', function: { name: '', arguments: '' } };
        if (tc.id) toolAcc[i].id = tc.id;
        if (tc.type) toolAcc[i].type = tc.type;
        if (tc.function?.name) toolAcc[i].function.name += tc.function.name;
        if (tc.function?.arguments) toolAcc[i].function.arguments += tc.function.arguments;
      }
    }
  }
  return out;
}

// Ringkas body error: JSON → pesan, HTML → kosong (jangan dump halaman gateway).
export function errorMessage(text) {
  const raw = String(text || '');
  if (!raw.trim()) return '';
  if (/^\s*</.test(raw)) return '';
  try {
    const json = JSON.parse(raw);
    const m = json?.error?.message || json?.message || json?.error;
    if (typeof m === 'string') return m.replace(/\s+/g, ' ').trim().slice(0, 300);
  } catch {
    /* bukan JSON */
  }
  return raw.replace(/\s+/g, ' ').trim().slice(0, 300);
}

function isConnLost(err) {
  const msg = String(err?.message || err || '');
  return /terminated|ECONNRESET|UND_ERR_SOCKET|other side closed|socket hang up/i.test(msg);
}

export async function streamChat({
  baseUrl, apiKey, model, messages, temperature = 0.7, tools = null, stream = true, onToken, onToolDelta, onThoughtEnd, signal, idleMs,
}) {
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const body = { model, messages, temperature, stream };
  if (Array.isArray(tools) && tools.length) body.tools = tools;

  const own = new AbortController();
  const merged = signal && typeof AbortSignal.any === 'function'
    ? AbortSignal.any([signal, own.signal])
    : (signal || own.signal);

  const reqStart = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: merged,
  }).catch((err) => {
    if (isConnLost(err)) err.code = 'CONN_LOST';
    throw err;
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const detail = errorMessage(text);
    const err = new Error(`HTTP ${res.status}${detail ? `: ${detail}` : ''}`);
    err.status = res.status;
    err.html = /^\s*</.test(String(text || ''));
    throw err;
  }

  if (!stream) {
    const json = await res.json();
    const msg = json.choices?.[0]?.message || {};
    const think = msg.reasoning_content ?? msg.reasoning;
    return {
      text: msg.content || '',
      usage: json.usage || null,
      toolCalls: msg.tool_calls || [],
      reported: json.model || null,
      reasoning: typeof think === 'string' && think ? think : null,
      reasoningMs: 0,
    };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const idleLimit = Math.max(1000, Number(process.env.BEOT_STREAM_IDLE_MS) || Number(process.env.BYOK_STREAM_IDLE_MS) || Number(idleMs) || 60000);
  let buffer = '';
  let text = '';
  let usage = null;
  let reported = null;
  let reasoning = '';
  let thinkStart = 0;
  let thinkEnd = 0;
  const toolAcc = [];
  const toolSeen = new Map();

  // Cukup sekali: saat token jawaban pertama datang atau saat stream selesai.
  const ensureThoughtEnd = () => {
    if (!thinkStart || thinkEnd) return;
    thinkEnd = Date.now();
    const span = thinkEnd - thinkStart;
    // Reasoning + jawaban bisa datang dalam satu paket (span 0): pakai waktu sejak request.
    const ms = span >= 50 ? span : Math.max(thinkEnd - reqStart, 100);
    if (onThoughtEnd) onThoughtEnd(reasoning, ms);
  };

  while (true) {
    let timer;
    const idle = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const err = new Error('Stream timeout: provider berhenti mengirim data.');
        err.code = 'STREAM_TIMEOUT';
        reject(err);
      }, idleLimit);
    });
    let chunk;
    try {
      const read = reader.read();
      read.catch(() => { /* penanganan di bawah */ });
      chunk = await Promise.race([read, idle]);
    } catch (err) {
      own.abort();
      try { await res.body?.cancel?.(); } catch { /* sudah tertutup */ }
      try { await reader.cancel(); } catch { /* sudah tertutup */ }
      if (isConnLost(err)) err.code = 'CONN_LOST';
      throw err;
    } finally {
      clearTimeout(timer);
    }
    const { done, value } = chunk;
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let parsed;
    try {
      parsed = parseSSEChunk(buffer, toolAcc);
    } catch (err) {
      try { await reader.cancel(); } catch { /* sudah tertutup */ }
      throw err;
    }
    buffer = parsed.rest;
    if (parsed.usage) usage = parsed.usage;
    if (parsed.model) reported = parsed.model;
    if (parsed.reasoning.length) {
      if (!thinkStart) thinkStart = Date.now();
      reasoning += parsed.reasoning.join('');
    }
    for (const delta of parsed.deltas) {
      ensureThoughtEnd();
      text += delta;
      if (onToken) onToken(delta);
    }
    if (onToolDelta) {
      for (let i = 0; i < toolAcc.length; i++) {
        const tc = toolAcc[i];
        if (!tc) continue;
        const name = tc.function.name || '';
        const len = tc.function.arguments.length;
        const prev = toolSeen.get(i);
        if (!prev || prev.name !== name || prev.len !== len) {
          toolSeen.set(i, { name, len });
          onToolDelta(name, len, i);
        }
      }
    }
    if (parsed.done || parsed.finish) break;
  }

  // Tutup koneksi walau provider tidak mengirim [DONE]/menutup stream.
  try { await reader.cancel(); } catch { /* sudah selesai */ }

  ensureThoughtEnd();

  const thinkMs = thinkStart
    ? (() => {
      const end = thinkEnd || Date.now();
      const span = end - thinkStart;
      return span >= 50 ? span : Math.max(end - reqStart, 100);
    })()
    : 0;
  return {
    text,
    usage,
    toolCalls: toolAcc.filter(Boolean),
    reported,
    reasoning: reasoning || null,
    reasoningMs: thinkMs,
  };
}
