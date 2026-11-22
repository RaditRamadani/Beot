# Beot

Chat AI di terminal — karakter bebas (mode `build` & `plan`), bisa membaca file lokal sebagai konteks, kunci API milikmu sendiri, nol server. Untuk developer, tim kerja, dan siapa saja yang hidup di terminal.

```
 ◆ beot 0.1                                    build  gemini-2.0-flash
 ══════════════════════════════════════════════════════════════════
 ketik / untuk menu

▎ rangkum bab ini, ada typo?

◆ Beot
Ini intinya: ...

  baca   bab1.md ······································ 8.2 kB   ✓ 0.1 s
  tulis  ringkasan.md ·············································  ✓

 build  proyek  gemini-2.0-flash          ctx ▓▓░░░ 34%  4.2k tok  / menu
```

## Install

```sh
git clone <repo-ini> beot
cd beot
npm install
npm test     # opsional: 44 cek logika + 3 E2E dengan provider palsu
npm link     # opsional: bikin perintah `beot` bisa dipanggil dari folder mana saja
npm start
```

Butuh **Node.js 20+**.

## Mode headless (script/CI)

```sh
beot -p "ringkas README ini jadi 5 poin"
beot -p "cari bug di src/" --output-format json
```

- Hanya tool **baca** yang berjalan; tulis/shell/web otomatis ditolak (tidak ada yang menjawab izin).
- Keluaran teks polos: tanpa banner, tanpa ANSI.
- `--output-format json` → `{ text, model, tokens, toolCalls: [{name, ok}], error }`.
- Exit code: `0` sukses, `1` provider error/jawaban kosong, `2` argumen salah.

## Ambil API key gratis (2 menit)

1. Buka <https://aistudio.google.com>
2. Login Google → **Get API key** → **Create API key**
3. Salin (bentuknya `AIza...`), jalankan `Beot`, lalu `/key` → pilih **Gemini** → tempel key → pilih model.

Tanpa kartu kredit. Kuota gratis ada batasnya per hari — cukup untuk pemakaian harian.

## Perintah

Ketik `/` untuk membuka **palette perintah layar penuh**: composer diganti daftar selebar terminal tanpa bingkai (transkrip tetap terlihat di atasnya), baris terpilih berlatar **amber** penuh, garis pemisah, lalu `↑`/`↓` memilih. `Tab` mengisi perintah + spasi, `Enter` menjalankan, `Esc` menutup palette (tetap tertutup sampai baris dikosongkan). `/key`, `/model`, dan `/persona` membuka **modal di tengah layar** (latar diredupkan, judul + `esc`, item terpilih berlatar **amber**, item aktif ditandai `●`). `/key` memakai modal input dengan nilai disamarkan dan `Esc` untuk batal. **Shift+Tab** mengganti persona kapan saja (mis. `build` ↔ `plan`). Saat menunggu jawaban, baris bot menampilkan spinner `⠋ Memikir…` yang terus berjalan (detik per round) dan berubah jadi `✎ write_file · n kar` saat model mengirim argumen tool.

Input tampil sebagai **blok gelap** selebar layar dengan **bar amber `▌` di kiri** (tanpa bingkai): padding atas, area ketik, padding bawah. Satu baris status tampil **di luar blok** (dipisah satu baris kosong): `persona  folder  model` di kiri, `ctx ▓▓░░░ <pct>%  <n> tok  / menu` di kanan (rata). Saat kosong ada placeholder `Ketik pesan…`; saat digulir ada indikator `↑ n baris · PgDn turun`. `ctx` = ukuran konteks request terakhir (bukan total sesi); rincian token ada di `/status`. **Esc menghentikan jawaban** yang sedang berjalan (Ctrl+C diabaikan saat menjawab), dan ketikan selama bot menjawab **tidak hilang** — otomatis masuk ke prompt berikutnya. Stream yang diam >`stream_timeout` (default 90 detik; bisa diubah di `/setting` atau env `BEOT_STREAM_IDLE_MS`) diulang otomatis 1x; koneksi yang diputus (`terminated`) juga diulang 1x. Kalau tetap gagal tampil pesan ramah. Saat model mengirim argumen tool, spinner menampilkan `✎ write_file · n kar` supaya kelihatan progresnya. Bila model mengirim reasoning (`reasoning_content`), isinya **tidak tampil saat berpikir** (hanya spinner `Memikir… <detik>s`), lalu meringkas jadi blok `✻ berpikir · 11.9s` sebelum jawaban dengan baris kosong di atas/bawah — **klik baris itu** untuk buka/tutup isi penuh (matikan dengan `/thinking`). Spinner menampilkan detik berjalan (netral → amber → merah). Jawaban memakai markdown ringan (bold, inline code, bullet). Tema bisa diganti dengan `/theme` (default/mono/kontras). Composer selalu tampil di bawah (full-screen, alternate screen). Di transkrip, pesanmu tampil sebagai bar amber `▎` + teks (tanpa blok latar), jawaban bot sebagai `◆ Beot`. Setiap tool yang selesai tampil sebagai **baris buku besar**: label kiri, titik-titik, ukuran/durasi rata kanan (`baca  data.csv ········ 1.2 kB  ✓ 0.1 s`). Kode di jawaban (blok <code>```</code>) tampil bernomor dengan label bahasa dan warna keyword/string/komentar; tanda `+`/`-` di baris diff diberi warna hijau/merah (tanpa latar penuh). **Tempel prompt multi-baris** (Ctrl+V / Shift+Insert) masuk utuh ke composer — tidak terkirim per baris; tekan `Enter` sekali untuk mengirim semuanya sebagai satu pesan. **File manager**: tekan **Ctrl+O** (atau `/files`) untuk menjelajahi folder kerja — `📁` folder, `📄` file, `..` naik folder, Enter = baca file jadi konteks. **Agent ringan**: model bisa memanggil tool `list_dir`, `read_file` (dengan `offset`/`limit`), `grep_file`, `glob_file`, `write_file`, serta `export_pdf`/`export_xlsx`/`export_docx`/`export_rtf`; penulisan file default **langsung simpan** (bisa diubah ke mode tanya lewat `/setting`) dan dibatasi di folder kerja (`.git`/`node_modules` dilarang). Ketik **`@`** di composer untuk memilih file → isinya ikut dikirim bersama pesan (bisa banyak). **Gambar**: copy gambar (screenshot/foto) lalu **Ctrl+V** — app membaca clipboard OS sendiri (app-side), menampilkan chip `📎 gambar.png`, dan mengirimnya sebagai `image_url`. Fallback **Shift+Insert / F2** untuk terminal yang menelan Ctrl+V. Maks 5 MB, satu gambar per pesan, butuh **model vision**; file temp langsung dihapus. **Dokumen**: copy file dari Explorer lalu Ctrl+V — `.txt .md .csv .pdf` dibaca sebagai teks dan ditempel ke pesan (`[DOKUMEN: nama]`), satu file, batas ±50 kB. `.docx` dan PDF scan belum didukung. Teks yang ditempel lewat Ctrl+V juga ditangani. Riwayat chat disimpan di buffer aplikasi — scroll dengan **roda mouse** atau **PgUp/PgDn** (juga saat bot menjawab); `↑`/`↓` tetap untuk riwayat pesan. **Ctrl+C saat ada seleksi = salin** (tidak keluar); tanpa seleksi tekan **2×** untuk keluar. Saat popup/modal terbuka atau bot menjawab, Ctrl+C diabaikan — pakai **Esc** untuk batal/stop. **Drag mouse** di transkrip menyeleksi teks (highlight) dan otomatis menyalin ke clipboard saat tombol dilepas (OSC 52 + clipboard OS); klik tanpa geser menghapus seleksi. Saat keluar, layar kembali bersih: hanya pesan keluar yang dicetak, tanpa dump transkrip.

**Folder kerja**: app memakai folder tempat kamu menjalankan `Beot` (atau `beot D:\Coding\tes`). Pindah saat session dengan **`/cd <folder>`**; tambahkan folder luar dengan **`/add-dir <folder>`**. Kalau model minta file di luar folder, muncul modal **Izinkan akses?** — pilih `Izinkan` sekali atau `Tolak`. Tool tetap tidak bisa keluar dari folder kerja + folder izin tanpa persetujuanmu.

**Tabel jawaban**: tabel markdown dari model dirender rapi — bingkai `╭ ╮ ╰ ╯`, garis pemisah antar baris, kolom rata, header tebal, sel panjang di-wrap sesuai lebar terminal (baris `|---|` tidak ikut tampil).

**Diff sebelum simpan**: setiap `write_file` membuka blok `▐ <path>  ubah  +X −Y` / `▐ <path>  baru  +X` dengan **nomor baris asli file** (lama untuk `-`, baru untuk `+`) dan tanda `+`/`-` berwarna (tanpa latar penuh). Setelah blok selesai ada baris buku besar `tulis <path> ····· ✓ <durasi>`. Default **tanya dulu** (`? Simpan <nama>? · enter=ya · esc=batal`); mau langsung simpan? `/setting` → `konfirmasi tulis` → `Langsung simpan`. Isi yang sama tidak ditulis ulang. Kalau tool gagal (argumen rusak, path ditolak, file terlalu besar), transkrip menampilkan `✗ <tool> · <pesan>` — tidak lagi diam.

**Ekspor dokumen**: minta bot, mis. "buat laporan.pdf dari ringkasan ini", "buat data.xlsx dari tabel berikut", atau "buat surat.docx". Bot memanggil `export_pdf` / `export_xlsx` / `export_docx` / `export_rtf`, lalu default **tanya dulu** (`? Simpan <nama>?`); mau langsung simpan? `/setting` → `konfirmasi tulis` → `Langsung simpan`. Semua file ditulis di folder kerja/folder izin; formatnya sederhana (PDF teks + nomor halaman, Excel satu sheet dengan header tebal, Word/RTF paragraf + bullet), tanpa dependensi baru. PDF memakai font Latin-1, jadi huruf non-Latin (mis. CJK/emoji) tampil `?`.

| Perintah | Fungsi |
|---|---|
| `/persona [nama]` | ganti karakter bot |
| `/skill [nama]` | buka modal pilih skill (termasuk `(tanpa skill)`) / aktifkan berdasarkan nama |
| `/files` | file manager (Ctrl+O): jelajahi folder kerja, `📂 Ketik lokasi…` untuk path bebas, pilih file untuk dibaca |
| `/cd <folder>` | pindah folder kerja (tanpa argumen = lihat lokasi) |
| `/add-dir <folder>` | izinkan folder luar untuk session (ketik lagi = hapus) |
| `/tugas <path>` | baca file `.txt .md .csv .pdf` jadi konteks |
| `/key` | pilih provider (Gemini, Groq, OpenRouter, OpenAI, Ollama, custom) lalu isi key dan pilih model |
| `/model [nama]` | pilih model dari daftar live provider (`GET /models`, non-chat disaring) + katalog, atau ketik manual · `/model base <url>` ganti base_url |
| `/clear` | hapus riwayat sesi (sesi tersimpan tidak dihapus) |
| `/init` | buat `BEOT.md` dari ringkasan proyek (tanpa model, 0 token) |
| `/ingat [--global] <fakta>` | tambah satu baris ke `BEOT.md` proyek (atau global) |
| `/compact` | ringkas riwayat jadi satu pesan (otomatis saat konteks >85%) |
| `/sessions` | pilih & lanjutkan sesi tersimpan di folder ini |
| `/reload` | muat ulang config, persona, skill dari disk |
| `/setting` | lihat pengaturan → popup ubah base_url / model / api_key / persona / timeout stream / konfirmasi tulis / izin path luar / izin shell / izin web, atau buka file config |
| `/status` | token request terakhir + total sesi |
| `/cost` | perkiraan biaya (USD) request terakhir + total sesi dari tabel harga publik |
| `/theme [nama]` | tanpa argumen: panel **Pilih tema** (bawaan + kustom dari `~/.beot/themes.json`); dengan nama: langsung |
| `/thinking` | tampilkan/sembunyikan blok `✻ berpikir · <detik>s` |
| `/bantu` | daftar perintah |
| `/exit` | keluar |

## Persona

2 bawaan:

- **`build`** — mode eksekusi: langsung kode/perintah/langkah siap pakai, tanpa basa-basi.
- **`plan`** — mode perencanaan **read-only**: pecah masalah jadi langkah, sebutkan opsi + trade-off dan risiko. Bot hanya boleh membaca (`list_dir`/`read_file`); `write_file` dan `export_*` tidak tersedia dan setiap percobaan menulis ditolak runtime.

Satu persona = satu file di `personas/`:

```json
{
  "nama": "asisten-ku",
  "deskripsi": "gaya bebas",
  "suhu": 0.7,
  "system_prompt": "Kamu ..."
}
```

Tambah file baru → muncul otomatis di `/persona`. Temperature: kecil = konsisten/serius, besar = kreatif. Ganti cepat saat chat: **Shift+Tab** (berputar ke persona berikutnya).

## Skill — bisa ditambah siapa saja

Skill = file `.md` di salah satu dari tiga tempat (yang belakangan menang bila namanya sama):

| Tempat | Untuk siapa |
|---|---|
| `skills-bawaan/` (di repo) | bawaan, ikut terpasang |
| `~/.beot/skills/` | milikmu, semua proyek (sebelas bawaan disalin ke sini saat pertama jalan) |
| `<folder-kerja>/.beot/skills/` | **per proyek** — bisa ikut di-commit saat open source, jadi kontributor tinggal menaruh file |

Urutan prioritas: bawaan → user → proyek. Jadi repo bisa menimpa skill bawaan tanpa menyentuh folder pribadi.

Saat folder kerja punya `.beot/skills/`, startup menampilkan `skill proyek: N dari .beot/skills` — supaya kamu tahu repo yang baru di-clone membawa instruksi tambahan. **Perlakukan skill proyek seperti kode**: review dulu sebelum percaya, karena deskripsinya masuk ke prompt.

Sebelas bawaan:

- `ringkas-tugas` — rangkum dokumen jadi poin padat
- `koreksi-laporan` — koreksi laporan/dokumen
- `brainstorm-tugas` — cari ide untuk tugas
- `brainstorm` — buka banyak opsi lalu pilih satu
- `code-review` — review kode berprioritas
- `debug` — debug sistematis (reproduksi → isolasi → akar masalah)
- `rencana-kerja` — rencana bernomor + risiko + verifikasi
- `tdd` — red → green → refactor
- `desain-ui` — hierarki, kontras, state, aksesibilitas
- `copywriting` — copy jelas: audiens, manfaat, CTA
- `jelaskan-konsep` — ringkas → analogi → contoh → cek paham

**Otomatis ala Claude Code**: app selalu mengirim *index* skill (`nama — deskripsi`, ±150 token). Saat tugas cocok, model memanggil tool `skill(name)` untuk memuat isi penuh satu skill — jadi tidak semua skill ikut ke prompt (hemat token). Kalau provider tidak mendukung tool calling, chat tetap jalan tanpa skill otomatis. `/skill <nama>` tetap bisa memaksa satu skill secara manual.

Bikin skill baru tanpa koding:

```markdown
---
nama: rumus-fisika
deskripsi: bantu jelasin rumus fisika step by step
---

Kamu tutor fisika. Selalu tulis rumus, lalu arti tiap simbol, lalu contoh angka.
```

Simpan sebagai `rumus-fisika.md` → `/skill` → langsung muncul. Untuk skill yang ikut repo (open source), taruh di `.beot/skills/` dalam proyek — otomatis terbaca, tidak perlu install. Tidak ada restart; `/reload` hanya perlu setelah mengedit file.

## Pakai AI lain (BYOK)

Semua provider lewat satu format API (OpenAI-compatible). Cara termudah:

```
/key      → popup provider → isi key → popup model
/model    → popup ganti model (ada opsi ketik model sendiri)
```

Pilihan provider: **Gemini** (default, gratis), **Groq**, **OpenRouter**, **OpenAI**, **Ollama** (lokal, tanpa key), dan **Lainnya / custom** untuk base_url OpenAI-compatible apa pun.

| Provider | base_url | Key |
|---|---|---|
| Gemini (default, gratis) | `https://generativelanguage.googleapis.com/v1beta/openai` | gratis |
| Groq | `https://api.groq.com/openai/v1` | gratis |
| OpenRouter | `https://openrouter.ai/api/v1` | campur |
| OpenAI | `https://api.openai.com/v1` | bayar |
| **Ollama (lokal, offline)** | `http://localhost:11434/v1` | tidak perlu |

Daftar model diambil live dari provider (`GET /models`) dan disaring dari model non-chat; katalog statis hanya cadangan. Pilih **Ketik model sendiri…** kalau modelmu tidak ada. Key hanya disimpan di config lokal.

Config tersimpan di `~/.beot/config.json`. Kalau kamu pengguna versi lama (`~/.byok-chat/`), saat pertama jalan isinya **disalin otomatis** ke `~/.beot/` (config + skills); folder lama dibiarkan sebagai arsip.

## Memori — `BEOT.md`

Dua file dibaca **otomatis tiap request** (bukan riwayat chat):

| File | Cakupan |
|---|---|
| `<folder-kerja>/BEOT.md` | proyek itu saja |
| `~/.beot/BEOT.md` | semua proyek |

- `/init` → membuat `BEOT.md` dari ringkasan repo (package.json, perintah tes, jumlah berkas). Tanpa memanggil model, jadi 0 token. Tidak menimpa file yang sudah ada (kecuali `/init --force`).
- `/ingat <fakta>` → menambah satu baris ke `BEOT.md` proyek. `/ingat --global <fakta>` untuk global.
- Saat startup muncul `memori: proyek (9 baris)` supaya kelihatan.
- Batas 8.000 karakter per file; satu baris maks 400 karakter.

Contoh isi:

```md
# BEOT.md
- Proyek: toko v1.2 (ESM)
- Tes: `npm test`
- Node: >=20
- Jawab pakai tabel kalau ada angka
```

**Perlakukan `BEOT.md` proyek seperti kode**: kalau kamu clone repo orang, isinya ikut masuk prompt — review dulu.

## Tema kustom (skin)

Selain `default`/`mono`/`kontras`, kamu bisa menambah tema sendiri lewat `~/.beot/themes.json`:

```json
{
  "senja": {
    "gold": "38;5;214",
    "lav": "38;5;180",
    "mint": "38;5;114",
    "maroon": "38;5;131",
    "selected": "48;5;214;30",
    "composerBar": "38;5;214;48;5;236"
  }
}
```

- Isi yang boleh: kode SGR angka/titik-koma (mis. `38;5;214`). Escape mentah **ditolak**.
- Kunci yang tidak dikenal diabaikan; kunci yang kosong mewarisi `default`.
- Nama `default`/`mono`/`kontras` tidak bisa ditimpa.
- Aktifkan dengan `/theme senja`. Setelah mengedit file, jalankan `/reload`.

Kunci palet: `gold` (aksen), `lav`, `peach`, `mint` (✓), `maroon` (✗), `dim`, `bold`, `selected`, `userBlock`, `popupBg`, `composerBar`, `codeBar`, `kw`, `str`, `num`, `cmt`, `fn`, `type`, `orange`.

## Token & biaya (terukur)

Dengan 14 tool aktif, satu request mengirim ±9.7 ribu karakter ≈ **2.400–2.800 token**:

| Bagian | Ukuran | Porsi |
|---|---|---|
| System prompt | ±3.100 karakter (~0,8k token) | 32% |
| Schema tool (14) | ±6.400 karakter (~1,7k token) | **65%** |
| Riwayat | menambah sesuai isi | — |

Cara menghemat: matikan tool yang tidak dipakai (`/setting` → izin shell/web → `Matikan`), pakai `/compact` untuk chat panjang, dan provider yang punya **prompt caching** otomatis akan menagih prefix yang sama lebih murah (system + tool tidak berubah antar-request). `BEOT.md` ikut tiap request (maks 8.000 karakter ≈ 2.000 token) — jaga tetap pendek.

## Keamanan (baca ini)

- API key disimpan **hanya di komputermu**, di `~/.beot/config.json`.
- **Tidak ada server Beot.** Tidak ada yang mengumpulkan data.
- Saat chat, isi pesan + teks file yang kamu panggil dikirim **langsung ke provider AI pilihanmu** (Google/Groq/dll) — sama seperti memakai situs mereka.
- **Default aman**: file **ditanya dulu** sebelum ditulis (`? Simpan <nama>?`) dan akses path di luar folder kerja juga **ditanya** (`Izinkan akses?`). Bisa dilonggarkan lewat `/setting` → `konfirmasi tulis` / `izin path luar`. App tidak pernah menghapus file.
- **Prompt injection itu nyata**: isi file yang dibaca model adalah input tak terpercaya. Blokir di bawah berbasis **path**, bukan pemahaman isi — file biasa berisi instruksi jahat tetap bisa membuat model membaca file lain yang tidak diblokir, lalu isinya terkirim ke provider. Karena itu default tulis = tanya dulu. Jangan buka folder yang berisi rahasia saat memakai model yang belum kamu percaya.
- Path di-resolve dengan **realpath**: symlink/junction yang mengarah keluar folder izin tetap ditolak. Escape ANSI dari isi model/file dibuang saat render (termasuk C1/OSC/DCS), jadi isi asing tidak bisa menyuntik perintah terminal. File sensitif **diblokir** untuk dibaca/dicari/ditulis lewat tool: `.env*`, kredensial (`id_rsa`, `.npmrc`, `.netrc`, `.ssh/`, `.aws/`), folder `.git/`, dan seluruh `~/.beot/` (config berisi API key). Jadi API key tidak pernah terkirim ke provider lewat tool.
- **Ganti host = key dihapus**: kalau `base_url` diarahkan ke host lain (lewat `/model base` atau `/setting`), `api_key` lama otomatis dikosongkan supaya tidak terkirim ke server baru; isi lagi lewat `/key`.
- **Shell butuh izin**: tool `bash` default `ask` (setiap perintah minta `y`), dengan tolak-keras yang tidak bisa di-allow. `shell: allow` hanya untuk folder yang kamu percaya — model bisa menjalankan apa pun yang tidak masuk daftar tolak.
- **Web hanya publik**: `web_fetch` menolak `localhost`, `127.*`, `10.*`, `192.168.*`, `172.16–31.*`, `169.254.*`, dan `::1`. Default `ask` (satu konfirmasi per host); `web: allow` untuk otomatis, `deny` untuk mematikan.
- **Identitas**: `[IDENTITAS]` (APP/MODEL/PEMBUAT) dikirim tiap request; `/status` menampilkan `respons model` dari provider + peringatan bila beda config (router fallback).
- Jangan jalankan di komputer bersama; jangan bagikan file config-mu.
- Kalau key bocor: hapus key di dashboard provider, buat yang baru.

## Batas v0.1 (jujur)

- `.docx`, `.xlsx`, `.pdf`, dan `.rtf` dibuat lewat tool **export** (bukan `write_file`), dengan hasil sederhana: PDF tanpa gambar/styling, XLSX satu sheet, DOCX/RTF tanpa template.
- PDF hasil **scan/foto** belum bisa (butuh OCR).
- Isi file dipotong di ±50 kB; untuk dokumen besar, panggil per-bab.
- Riwayat **tersimpan otomatis** di `~/.beot/sessions/` (satu file per sesi). Lanjutkan dengan `beot --continue` atau `/sessions`; `/compact` meringkas riwayat saat konteks menipis, dan riwayat juga dipangkas otomatis saat perkiraan konteks >70%. File sesi bisa kamu hapus sendiri kapan saja.
- Tool loop dibatasi **16 langkah** per pesan; jika habis, muncul peringatan dan konteks tetap disimpan — ketik "lanjutkan".
- Tool `bash` menjalankan perintah di folder kerja, **selalu lewat izin** (default `ask`), dengan daftar tolak-keras (`rm -rf /`, `format`, `shutdown`, `curl|sh`, dll). Bisa dimatikan lewat `/setting` → `izin shell` → `Matikan`.
- Agent: `list_dir`/`read_file`/`write_file`/`edit_file` + `grep_file`/`glob_file` + `bash` (izin `y/n`, daftar tolak-keras) + `web_fetch` (URL publik saja) + `todo_write` + `export_pdf`/`export_xlsx`/`export_docx`/`export_rtf` (tulis dengan konfirmasi, hanya di folder kerja/folder izin) + `skill`; belum ada MCP.
- Tes ada di repo: `npm test` = `selfcheck.js` (44 cek) + `tests/chat-e2e.mjs` (chat + tool + sesi + TUI) + `tests/confirm-e2e.mjs` (default tanya dulu) + `tests/headless-e2e.mjs` (`-p` teks & JSON). Tidak butuh API key. CI menjalankan tes di Windows & Linux (Node 20/22).
- Error `524`/`502`/`503` berasal dari gateway/provider, bukan dari Beot; app hanya menampilkan status + pesan ramah, bukan halaman HTML mentah. Error yang dikirim **di dalam stream** juga ditampilkan, tidak ditelan.
- Kalau provider mengembalikan **jawaban kosong** (tanpa teks, thought, atau tool), Beot mengulang sekali lalu menampilkan `⚠ Provider tidak mengirim jawaban (kosong). Coba lagi.`
- Picker provider hanya untuk endpoint OpenAI-compatible; layanan yang butuh OAuth atau API non-OpenAI (mis. Copilot, Anthropic native) belum didukung — pakai opsi custom kalau endpoint-nya kompatibel.
- Popup picker tampil sebagai panel gelap dengan **band amber** di judul (bukan gaya OpenCode/Claude), baris `saring ›`, lebar ±64 kolom, dan item terpilih amber. Butuh terminal ber-ANSI — pakai Windows Terminal.
- Daftar model diambil **live** dari provider (`GET /models`, disaring dari model non-chat) dengan katalog statis sebagai cadangan; selalu ada opsi ketik model sendiri.
- Warna penuh: pakai **Windows Terminal / WSL / macOS**. Di `cmd` lama emoji dan warna bisa rusak.

## Cek cepat

```sh
npm run selftest
```

## Lisensi

MIT
