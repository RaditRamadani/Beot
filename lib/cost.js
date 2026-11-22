// Perkiraan harga publik per 1 juta token (USD). Bisa berubah kapan saja —
// ini tebakan untuk laporan sesi, bukan tagihan resmi.
const PRICES = [
  ['gemini-2.0-flash', 0.10, 0.40],
  ['gemini-2.5-flash', 0.30, 2.50],
  ['gemini-1.5-flash', 0.075, 0.30],
  ['gpt-4o-mini', 0.15, 0.60],
  ['gpt-4o', 2.50, 10.00],
  ['claude-3-5-haiku', 0.80, 4.00],
  ['claude-3-5-sonnet', 3.00, 15.00],
  ['deepseek-chat', 0.27, 1.10],
  ['llama-3.3-70b', 0.59, 0.79],
];

export function priceFor(model) {
  const m = String(model || '').toLowerCase();
  const hit = PRICES.find(([name]) => m.includes(name));
  return hit ? { input: hit[1], output: hit[2] } : null;
}

export function costOf({ model, prompt, completion }) {
  const p = priceFor(model);
  if (!p) return null;
  const pin = Number(prompt) || 0;
  const pout = Number(completion) || 0;
  if (!pin && !pout) return null;
  return (pin / 1e6) * p.input + (pout / 1e6) * p.output;
}

export function fmtUsd(value) {
  if (!Number.isFinite(value) || value <= 0) return '$0';
  if (value < 0.0001) return '<$0.0001';
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(3)}`;
}
