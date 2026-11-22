// Bentuk content pesan user; gambar dikirim sebagai data URL (multimodal),
// dokumen ditempel sebagai teks ber-header.
export function userContent(text, attachment) {
  if (!attachment) return text;
  if (attachment.type === 'doc') {
    const header = `[DOKUMEN: ${attachment.name}${attachment.truncated ? ' (dipotong)' : ''}]`;
    const body = `${header}\n${attachment.text}`;
    return text ? `${text}\n\n${body}` : body;
  }
  const parts = [];
  if (text) parts.push({ type: 'text', text });
  parts.push({
    type: 'image_url',
    image_url: { url: `data:${attachment.mime};base64,${attachment.data}` },
  });
  return parts;
}

// Perkiraan panjang karakter untuk estimasi token (gambar dihitung tetap).
export function contentChars(content) {
  if (typeof content === 'string') return content.length;
  if (Array.isArray(content)) {
    let n = 0;
    for (const part of content) {
      if (part?.type === 'text') n += part.text.length;
      else if (part?.type === 'image_url') n += 4000;
    }
    return n;
  }
  return 0;
}
