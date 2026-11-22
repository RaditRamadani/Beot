// Daftar tugas singkat: model mengisi, UI menampilkan progres.
const STATUS = new Set(['pending', 'in_progress', 'completed']);
const MAX = 12;

export function buildTodoTool() {
  return [{
    type: 'function',
    function: {
      name: 'todo_write',
      description: 'Simpan daftar tugas untuk pekerjaan multi-langkah. Kirim seluruh daftar setiap kali (bukan tambahan).',
      parameters: {
        type: 'object',
        properties: {
          todos: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                content: { type: 'string', description: 'Satu langkah singkat.' },
                status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
              },
              required: ['content', 'status'],
            },
          },
        },
        required: ['todos'],
      },
    },
  }];
}

export function normalizeTodos(input) {
  if (!Array.isArray(input) || !input.length) throw new Error('todos harus berisi minimal satu item.');
  const list = input.slice(0, MAX).map((t, i) => {
    const content = String(t?.content ?? '').trim();
    if (!content) throw new Error(`todo #${i + 1} tanpa content.`);
    const status = String(t?.status || 'pending');
    if (!STATUS.has(status)) throw new Error(`status todo #${i + 1} harus pending/in_progress/completed.`);
    return { content: content.slice(0, 160), status };
  });
  return list;
}

// Murni: kembalikan daftar baru; pemanggil yang menyimpan.
export function runTodoTool(args = {}) {
  const todos = normalizeTodos(args.todos);
  const done = todos.filter((t) => t.status === 'completed').length;
  const cur = todos.find((t) => t.status === 'in_progress');
  return {
    todos,
    content: `TODO ${done}/${todos.length}${cur ? ` · sekarang: ${cur.content}` : ''}`,
    note: `todo ${done}/${todos.length}`,
  };
}
