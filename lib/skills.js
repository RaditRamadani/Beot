import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SKILLS_DIR, ensureDirs } from './config.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const BUNDLED_DIR = path.join(HERE, '..', 'skills-bawaan');

export function parseSkillFile(text, filename = '') {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return null;
  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i === -1) continue;
    meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  if (!meta.nama) return null;
  return {
    nama: meta.nama,
    deskripsi: meta.deskripsi || '',
    isi: match[2].trim(),
    file: filename,
  };
}

// Skill bawaan disalin sekali ke folder user supaya user bisa lihat & timpa.
export function ensureBundledSkills(fromDir = BUNDLED_DIR, toDir = SKILLS_DIR) {
  ensureDirs();
  let files = [];
  try { files = fs.readdirSync(fromDir).filter((f) => f.endsWith('.md')); } catch { return 0; }
  let copied = 0;
  for (const file of files) {
    const target = path.join(toDir, file);
    if (fs.existsSync(target)) continue;
    try {
      fs.copyFileSync(path.join(fromDir, file), target);
      copied++;
    } catch {
      // gagal salin: tetap jalan dengan yang ada
    }
  }
  return copied;
}

export function loadSkillsFrom(dir = SKILLS_DIR) {
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.md')); } catch { return []; }
  const skills = [];
  for (const file of files) {
    try {
      const skill = parseSkillFile(fs.readFileSync(path.join(dir, file), 'utf8'), file);
      if (skill) skills.push(skill);
    } catch {
      // file rusak: lewati
    }
  }
  return skills.sort((a, b) => a.nama.localeCompare(b.nama));
}

// Urutan prioritas: bawaan < user < proyek. Nama sama = yang belakangan menang.
export function loadSkillsFromMany(dirs) {
  const byName = new Map();
  for (const dir of dirs) {
    for (const skill of loadSkillsFrom(dir)) byName.set(skill.nama, skill);
  }
  return [...byName.values()].sort((a, b) => a.nama.localeCompare(b.nama));
}

export function skillDirs(cwd = process.cwd(), includeProject = true) {
  const dirs = [BUNDLED_DIR, SKILLS_DIR];
  if (includeProject) dirs.push(path.join(cwd, '.beot', 'skills'));
  return dirs;
}

export function loadSkills(cwd = process.cwd(), includeProject = true) {
  return loadSkillsFromMany(skillDirs(cwd, includeProject));
}
