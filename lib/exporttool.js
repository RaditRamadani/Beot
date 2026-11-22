// Generator dokumen biner (PDF/XLSX/DOCX/RTF) + tool export_* dengan konfirmasi.
// Tanpa dependensi: PDF ditulis manual, XLSX/DOCX memakai ZIP store + OOXML minimal.
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveInside, ensureAccess } from './filetools.js';

const MAX_TEXT = 200_000;
const MAX_COLS = 60;
const MAX_ROWS = 5000;

// ---------- util ----------

function sizeLabel(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} kB`;
}

function asText(value, label) {
  const text = String(value ?? '');
  if (text.length > MAX_TEXT) throw new Error(`${label} terlalu panjang (>200.000 karakter).`);
  return text;
}

function cleanXml(s) {
  return String(s).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ' ');
}

function xmlEsc(s) {
  return cleanXml(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function ensureExt(rel, ext) {
  const name = String(rel || '').trim();
  if (!name) throw new Error('Path kosong.');
  const got = path.extname(name).toLowerCase();
  if (!got) return name + ext;
  if (got !== ext) throw new Error(`Path harus berakhiran ${ext} (bukan ${got}).`);
  return name;
}

// ---------- PDF ----------

const PDF_W = 595.28;
const PDF_H = 841.89;
const PDF_MARGIN = 56;
const PDF_BODY = 11;
const PDF_LEAD = 15;
const PDF_MAX_CHARS = Math.floor((PDF_W - PDF_MARGIN * 2) / (PDF_BODY * 0.5));

function pdfEscape(s) {
  let out = '';
  for (const ch of String(s)) {
    const code = ch.codePointAt(0);
    if (ch === '\\' || ch === '(' || ch === ')') out += `\\${ch}`;
    else if (code >= 32 && code <= 255) out += ch;
    else out += '?';
  }
  return out;
}

function wrapPdf(text, maxChars) {
  const out = [];
  for (const raw of String(text).replace(/\r/g, '').split('\n')) {
    if (!raw.trim()) {
      out.push('');
      continue;
    }
    let line = '';
    for (const word of raw.split(/\s+/)) {
      const piece = word.length > maxChars ? word.match(new RegExp(`.{1,${maxChars}}`, 'g')) : [word];
      for (const part of piece) {
        const next = line ? `${line} ${part}` : part;
        if (next.length > maxChars && line) {
          out.push(line);
          line = part;
        } else {
          line = next;
        }
      }
    }
    if (line) out.push(line);
  }
  return out;
}

export function buildPdf({ title = '', text = '' } = {}) {
  const pages = [];
  let content = [];
  let y = PDF_H - PDF_MARGIN;

  const newPage = () => {
    pages.push(content);
    content = [];
    y = PDF_H - PDF_MARGIN;
  };

  const push = (line, font, size, lead) => {
    if (y - lead < PDF_MARGIN + 24) newPage();
    if (line) {
      content.push(`BT /${font} ${size} Tf ${PDF_MARGIN} ${y.toFixed(2)} Td (${pdfEscape(line)}) Tj ET`);
    }
    y -= lead;
  };

  if (title.trim()) {
    for (const line of wrapPdf(title, Math.floor((PDF_W - PDF_MARGIN * 2) / 9))) {
      push(line, 'F2', 18, 26);
    }
    push('', 'F1', PDF_BODY, 10);
  }
  for (const line of wrapPdf(text, PDF_MAX_CHARS)) {
    if (!line) push('', 'F1', PDF_BODY, 8);
    else push(line, 'F1', PDF_BODY, PDF_LEAD);
  }
  pages.push(content);

  const total = pages.length;
  const bodies = pages.map((lines, i) => {
    const body = [...lines, `BT /F1 9 Tf ${PDF_MARGIN} 28 Td (${i + 1} / ${total}) Tj ET`];
    return body.join('\n');
  });

  const objs = [];
  objs[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  const kids = [];
  for (let i = 0; i < bodies.length; i++) {
    const pageId = 5 + i * 2;
    kids.push(`${pageId} 0 R`);
    objs[pageId - 1] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PDF_W} ${PDF_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageId + 1} 0 R >>`;
    objs[pageId] = `<< /Length ${Buffer.byteLength(bodies[i], 'latin1')} >>\nstream\n${bodies[i]}\nendstream`;
  }
  objs[1] = `<< /Type /Pages /Count ${bodies.length} /Kids [${kids.join(' ')}] >>`;
  objs[2] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';

  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((obj, i) => {
    offsets[i] = Buffer.byteLength(out, 'latin1');
    out += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

// ---------- ZIP (store) ----------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zipStore(files) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(String(file.data), 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE(offset, 42);
    chunks.push(local, name, data);
    central.push(Buffer.concat([cd, name]));
    offset += local.length + name.length + data.length;
  }
  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, cdBuf, eocd]);
}

// ---------- XLSX ----------

function colName(index) {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function sheetName(name) {
  return cleanXml(String(name || 'Sheet1')).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet1';
}

export function buildXlsx({ sheet = 'Sheet1', columns = [], rows = [] } = {}) {
  const cols = Array.isArray(columns) ? columns.slice(0, MAX_COLS).map((c) => String(c ?? '')) : [];
  const data = Array.isArray(rows) ? rows.slice(0, MAX_ROWS) : [];
  if (!cols.length && !data.length) throw new Error('Minimal isi columns atau rows.');
  let cells = 0;
  const rowsXml = [];
  const emitRow = (values, r, bold) => {
    const rowCells = values.slice(0, MAX_COLS).map((value, c) => {
      cells += 1;
      const ref = `${colName(c)}${r}`;
      if (!bold && typeof value === 'number' && Number.isFinite(value)) {
        return `<c r="${ref}"><v>${value}</v></c>`;
      }
      const text = cleanXml(String(value ?? '')).slice(0, 32767);
      return `<c r="${ref}"${bold ? ' s="1"' : ''} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(text)}</t></is></c>`;
    });
    rowsXml.push(`<row r="${r}">${rowCells.join('')}</row>`);
  };
  let r = 1;
  if (cols.length) emitRow(cols, r++, true);
  for (const row of data) {
    const values = Array.isArray(row) ? row : cols.map((c) => row?.[c]);
    emitRow(values, r++, false);
  }
  if (cells > 120_000) throw new Error('Terlalu banyak sel (>120.000). Pecah jadi beberapa file.');

  const widest = Math.max(cols.length, ...data.map((x) => (Array.isArray(x) ? Math.min(x.length, MAX_COLS) : cols.length)));
  const range = `A1:${colName(Math.max(0, widest - 1))}${Math.max(1, r - 1)}`;
  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="${range}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>${rowsXml.join('')}</sheetData></worksheet>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlEsc(sheetName(sheet))}" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`;
  return zipStore([
    {
      name: '[Content_Types].xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    },
    {
      name: '_rels/.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    { name: 'xl/workbook.xml', data: workbook },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    { name: 'xl/worksheets/sheet1.xml', data: sheetXml },
    { name: 'xl/styles.xml', data: styles },
  ]);
}

// ---------- DOCX ----------

export function buildDocx({ title = '', text = '' } = {}) {
  const paras = [];
  const para = (inner, { bold = false, size = 22, spaceAfter = 120, indent = 0 } = {}) => {
    const pPr = `<w:pPr><w:spacing w:after="${spaceAfter}"/>${indent ? `<w:ind w:left="${indent}"/>` : ''}</w:pPr>`;
    const rPr = `<w:rPr>${bold ? '<w:b/>' : ''}<w:sz w:val="${size}"/></w:rPr>`;
    paras.push(`<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${xmlEsc(inner)}</w:t></w:r></w:p>`);
  };
  if (title.trim()) para(title, { bold: true, size: 36, spaceAfter: 240 });
  for (const line of String(text).replace(/\r/g, '').split('\n')) {
    if (!line.trim()) {
      paras.push('<w:p><w:pPr><w:spacing w:after="80"/></w:pPr></w:p>');
      continue;
    }
    const bullet = /^\s*[-*•]\s+/.test(line);
    para(bullet ? line.replace(/^\s*[-*•]\s+/, '• ') : line, { indent: bullet ? 360 : 0 });
  }
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paras.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  return zipStore([
    {
      name: '[Content_Types].xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    },
    {
      name: '_rels/.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    },
    { name: 'word/document.xml', data: document },
  ]);
}

// ---------- RTF ----------

function rtfEsc(s) {
  let out = '';
  for (const ch of String(s)) {
    const code = ch.codePointAt(0);
    if (ch === '\\' || ch === '{' || ch === '}') out += `\\${ch}`;
    else if (ch === '\n') out += '\\par\n';
    else if (ch === '\t') out += '\\tab ';
    else if (code < 128) out += ch;
    else if (code <= 0xffff) out += `\\u${code > 32767 ? code - 65536 : code}?`;
    else out += '?';
  }
  return out;
}

export function buildRtf({ title = '', text = '' } = {}) {
  const body = String(text).replace(/\r/g, '').split('\n').map((line) => `${rtfEsc(line)}\\par`).join('\n');
  const head = title.trim() ? `{\\fs36\\b ${rtfEsc(title)}\\b0\\fs22\\par}\\par\n` : '';
  return Buffer.from(`{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0 Calibri;}}\\fs22\n${head}${body}\n}\n`, 'latin1');
}

// ---------- tools ----------

export function buildExportTools() {
  return [
    {
      type: 'function',
      function: {
        name: 'export_pdf',
        description: 'Buat file PDF (teks) di folder kerja dari judul + isi. Butuh konfirmasi pengguna.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path relatif/absolut, mis. laporan.pdf.' },
            title: { type: 'string', description: 'Judul dokumen (opsional).' },
            text: { type: 'string', description: 'Isi dokumen; baris baru = paragraf baru.' },
          },
          required: ['path', 'text'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'export_xlsx',
        description: 'Buat file Excel (.xlsx) satu sheet dari columns + rows. Angka dikirim sebagai number, teks sebagai string. Butuh konfirmasi.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path relatif/absolut, mis. data.xlsx.' },
            sheet: { type: 'string', description: 'Nama sheet (opsional).' },
            columns: { type: 'array', items: { type: 'string' }, description: 'Nama kolom (baris header).' },
            rows: {
              type: 'array',
              items: { type: 'array', items: {} },
              description: 'Baris data; tiap baris array sesuai urutan columns.',
            },
          },
          required: ['path', 'rows'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'export_docx',
        description: 'Buat file Word (.docx) dari judul + isi. Baris diawali "- " jadi bullet. Butuh konfirmasi.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path relatif/absolut, mis. laporan.docx.' },
            title: { type: 'string', description: 'Judul dokumen (opsional).' },
            text: { type: 'string', description: 'Isi dokumen; baris baru = paragraf baru.' },
          },
          required: ['path', 'text'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'export_rtf',
        description: 'Buat file RTF (bisa dibuka Word) dari judul + isi, tanpa format kompleks. Butuh konfirmasi.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path relatif/absolut, mis. catatan.rtf.' },
            title: { type: 'string', description: 'Judul dokumen (opsional).' },
            text: { type: 'string', description: 'Isi dokumen.' },
          },
          required: ['path', 'text'],
        },
      },
    },
  ];
}

export const EXPORT_NAMES = new Set(['export_pdf', 'export_xlsx', 'export_docx', 'export_rtf']);

async function saveExport(rel, ext, buffer, preview, opts = {}) {
  if (opts.allowWrite === false) throw new Error('Mode plan: menulis/mengubah file dinonaktifkan.');
  const name = ensureExt(rel, ext);
  await ensureAccess(name, opts);
  const target = resolveInside(name, opts.cwd || process.cwd(), opts.extras || []);
  const parts = path.relative(path.resolve(opts.cwd || process.cwd()), target).split(path.sep);
  if (parts.includes('.git') || parts.includes('node_modules')) {
    throw new Error('Folder .git/node_modules tidak boleh ditulis.');
  }
  try {
    const st = await fs.stat(target);
    if (st.isDirectory()) throw new Error('Path itu folder.');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const shown = path.relative(path.resolve(opts.cwd || process.cwd()), target) || name;
  if (typeof opts.confirmWrite === 'function') {
    const ok = await opts.confirmWrite(shown, preview);
    if (!ok) return { content: 'DIBATALKAN: pengguna menolak menulis file.', refused: true, note: `batal buat ${shown}` };
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, buffer);
  return { content: `OK: ${shown} dibuat (${sizeLabel(buffer.length)}).`, note: `buat ${shown}` };
}

export async function runExportTool(name, rawArgs, opts = {}) {
  let args;
  try {
    args = JSON.parse(rawArgs || '{}');
  } catch {
    return { error: 'Argumen tool bukan JSON valid.' };
  }
  try {
    if (name === 'export_pdf') {
      const text = asText(args.text, 'Isi');
      const title = asText(args.title || '', 'Judul');
      return await saveExport(args.path, '.pdf', buildPdf({ title, text }), `${title}\n${text}`.trim(), opts);
    }
    if (name === 'export_xlsx') {
      if (!Array.isArray(args.rows)) throw new Error('rows harus berupa array baris.');
      const columns = Array.isArray(args.columns) ? args.columns.map(String) : [];
      const rows = args.rows;
      const buffer = buildXlsx({ columns, rows, sheet: args.sheet });
      const preview = [columns.join('\t'), ...rows.slice(0, 100).map((r) => (Array.isArray(r) ? r.join('\t') : ''))].join('\n');
      return await saveExport(args.path, '.xlsx', buffer, preview, opts);
    }
    if (name === 'export_docx') {
      const text = asText(args.text, 'Isi');
      const title = asText(args.title || '', 'Judul');
      return await saveExport(args.path, '.docx', buildDocx({ title, text }), `${title}\n${text}`.trim(), opts);
    }
    if (name === 'export_rtf') {
      const text = asText(args.text, 'Isi');
      const title = asText(args.title || '', 'Judul');
      return await saveExport(args.path, '.rtf', buildRtf({ title, text }), `${title}\n${text}`.trim(), opts);
    }
    return { error: `Tool "${name}" tidak dikenal.` };
  } catch (err) {
    return { error: err.message };
  }
}

