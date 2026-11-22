// Satu sumber daftar perintah: dipakai /bantu, menu live, dan selfcheck.
export const COMMANDS = [
  { cmd: '/persona', hint: '[nama]', desc: 'ganti karakter bot' },
  { cmd: '/skill', hint: '[nama]', desc: 'daftar / aktifkan skill (lepas = matikan)' },
  { cmd: '/files', hint: '', desc: 'jelajahi folder & baca file (ctrl+o)' },
  { cmd: '/cd', hint: '<folder>', desc: 'pindah folder kerja (tanpa argumen = lihat)' },
  { cmd: '/add-dir', hint: '<folder>', desc: 'izinkan folder luar (sekali lagi = hapus)' },
  { cmd: '/tugas', hint: '<path>', desc: 'baca file txt/md/csv/pdf jadi konteks' },
  { cmd: '/key', hint: '', desc: 'pilih provider + isi API key' },
  { cmd: '/model', hint: '[nama]', desc: 'pilih model / ganti base_url' },
  { cmd: '/clear', hint: '', desc: 'hapus riwayat sesi' },
  { cmd: '/compact', hint: '', desc: 'ringkas riwayat jadi satu pesan' },
  { cmd: '/sessions', hint: '', desc: 'lihat / lanjutkan sesi tersimpan' },
  { cmd: '/reload', hint: '', desc: 'muat ulang config, persona, skill' },
  { cmd: '/setting', hint: '', desc: 'lihat / ubah pengaturan' },
  { cmd: '/status', hint: '', desc: 'token & konteks sesi' },
  { cmd: '/cost', hint: '', desc: 'perkiraan biaya request & sesi' },
  { cmd: '/theme', hint: '[nama]', desc: 'pilih tema (panel) / langsung pakai nama' },
  { cmd: '/thinking', hint: '', desc: 'tampilkan / sembunyikan thought' },
  { cmd: '/bantu', hint: '', desc: 'tampilkan bantuan' },
  { cmd: '/exit', hint: '', desc: 'keluar' },
  { cmd: '/quit', hint: '', desc: 'keluar (sama dengan /exit)' },
];

// Menu hanya untuk token pertama yang diawali "/" (belum ada argumen).
export function filterCommands(token, list = COMMANDS) {
  if (!token.startsWith('/') || token.includes(' ')) return [];
  return list.filter((item) => item.cmd.startsWith(token));
}
