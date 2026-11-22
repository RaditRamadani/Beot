import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PERSONA_DIR = path.join(HERE, '..', 'personas');

export function loadPersonas(dir = PERSONA_DIR) {
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  const personas = [];
  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      if (!data.nama || !data.system_prompt) continue;
      personas.push({ suhu: 0.7, ...data, file });
    } catch {
      // file rusak: lewati, jangan bikin seluruh app gagal
    }
  }
  return personas.sort((a, b) => a.nama.localeCompare(b.nama));
}
