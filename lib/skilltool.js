// Tool "skill" ala Claude Code: index selalu di prompt, isi penuh dimuat on-demand.
import { loadSkills, loadSkillsFrom } from './skills.js';

export function skillIndexPrompt(dir = null, cwd = process.cwd()) {
  const skills = dir ? loadSkillsFrom(dir) : loadSkills(cwd);
  if (!skills.length) return '';
  return [
    'Skill tersedia. Untuk tugas yang benar-benar cocok dengan deskripsi skill,',
    'panggil tool skill(name) dulu untuk memuat instruksi lengkapnya, lalu ikuti.',
    ...skills.map((s) => `- ${s.nama} — ${s.deskripsi}`),
  ].join('\n');
}

export function buildSkillTools() {
  return [{
    type: 'function',
    function: {
      name: 'skill',
      description: 'Muat instruksi lengkap sebuah skill berdasarkan nama. Panggil hanya jika tugas cocok dengan deskripsi skill.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Nama skill persis seperti di daftar.' },
        },
        required: ['name'],
      },
    },
  }];
}

// name: nama fungsi dari model; argsJson: string JSON dari model.
export function runSkillTool(name, argsJson, dir = null, cwd = process.cwd()) {
  if (name && name !== 'skill') {
    return { error: `Tool "${name}" tidak dikenal.` };
  }
  let arg;
  try {
    arg = JSON.parse(argsJson || '{}');
  } catch {
    return { error: 'Argumen tool bukan JSON yang valid.' };
  }
  const want = String(arg.name || '').trim();
  if (!want) return { error: 'Nama skill kosong.' };
  const skills = dir ? loadSkillsFrom(dir) : loadSkills(cwd);
  const found = skills.find((s) => s.nama === want);
  if (!found) {
    return { error: `Skill "${want}" tidak ada. Pilihan: ${skills.map((s) => s.nama).join(', ')}` };
  }
  return { skill: found.nama, content: `[SKILL: ${found.nama}]\n${found.isi}` };
}
