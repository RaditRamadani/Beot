// Diff baris sederhana untuk menampilkan perubahan file sebelum disimpan.
const MAX_CELLS = 4_000_000;

// Potong diff tapi pastikan kedua warna (- dan +) tetap terlihat.
function truncateLines(lines, maxLines) {
  if (lines.length <= maxLines) return lines;
  const hasMinus = lines.some((l) => !l.gap && l.type === '-');
  const hasPlus = lines.some((l) => !l.gap && l.type === '+');
  let start = 0;
  const head = lines.slice(0, maxLines);
  const headMinus = head.some((l) => !l.gap && l.type === '-');
  const headPlus = head.some((l) => !l.gap && l.type === '+');
  if (hasMinus && hasPlus && !(headMinus && headPlus)) {
    const boundary = lines.findIndex((l, i) => i > 0 && !l.gap && l.type === '+' && lines.slice(0, i).some((x) => !x.gap && x.type === '-'));
    if (boundary > 0) start = Math.max(0, boundary - Math.floor(maxLines * 0.6));
  }
  const out = [];
  if (start > 0) out.push({ type: ' ', text: `… (${start} baris lain)`, gap: true });
  const room = maxLines - out.length;
  const chosen = lines.slice(start, start + room);
  out.push(...chosen);
  const after = lines.length - (start + chosen.length);
  if (after > 0 && out.length < maxLines) out.push({ type: ' ', text: `… (${after} baris lain)`, gap: true });
  return out;
}

function splitLines(text) {
  return String(text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '').split('\n');
}

function lcsOps(a, b) {
  const n = a.length;
  const m = b.length;
  const table = new Uint32Array((n + 1) * (m + 1));
  const at = (i, j) => i * (m + 1) + j;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[at(i, j)] = a[i] === b[j]
        ? table[at(i + 1, j + 1)] + 1
        : Math.max(table[at(i + 1, j)], table[at(i, j + 1)]);
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: ' ', text: a[i] });
      i += 1;
      j += 1;
    } else if (table[at(i + 1, j)] >= table[at(i, j + 1)]) {
      ops.push({ type: '-', text: a[i] });
      i += 1;
    } else {
      ops.push({ type: '+', text: b[j] });
      j += 1;
    }
  }
  while (i < n) { ops.push({ type: '-', text: a[i] }); i += 1; }
  while (j < m) { ops.push({ type: '+', text: b[j] }); j += 1; }
  return ops;
}

function fallbackOps(a, b) {
  return [...a.map((text) => ({ type: '-', text })), ...b.map((text) => ({ type: '+', text }))];
}

export function buildDiff(oldText, newText, { context = 2, maxLines = 240 } = {}) {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  let ops;
  if (a.length * b.length > MAX_CELLS) ops = fallbackOps(a, b);
  else ops = lcsOps(a, b);

  const added = ops.filter((o) => o.type === '+').length;
  const removed = ops.filter((o) => o.type === '-').length;
  let oldNo = 0;
  let newNo = 0;
  for (const op of ops) {
    if (op.type === ' ') { oldNo += 1; newNo += 1; op.oldNo = oldNo; op.newNo = newNo; }
    else if (op.type === '-') { oldNo += 1; op.oldNo = oldNo; op.newNo = null; }
    else { newNo += 1; op.newNo = newNo; op.oldNo = null; }
  }
  const keep = new Set();
  ops.forEach((o, i) => {
    if (o.type === ' ') return;
    for (let k = Math.max(0, i - context); k <= Math.min(ops.length - 1, i + context); k++) keep.add(k);
  });
  const lines = [];
  let gap = false;
  ops.forEach((o, i) => {
    if (keep.has(i)) {
      if (gap) lines.push({ type: ' ', text: '…', gap: true });
      gap = false;
      lines.push(o);
    } else {
      gap = true;
    }
  });
  const truncated = lines.length > maxLines;
  return {
    added,
    removed,
    truncated,
    lines: truncateLines(lines, maxLines),
  };
}

export function buildNewFileDiff(text, { maxLines = 160 } = {}) {
  const all = splitLines(text);
  return {
    added: all.length,
    removed: 0,
    truncated: all.length > maxLines,
    lines: all.slice(0, maxLines).map((line, i) => ({ type: '+', text: line, oldNo: null, newNo: i + 1 })),
  };
}
