# Spesifikasi Beot v0.1

Status: final untuk v0.1. Dokumen ini adalah acuan perilaku yang **sudah ada** di kode.
Fitur di luar dokumen ini bukan bagian v0.1.

## 1. Tujuan

Chat AI di terminal yang:

- memakai API key milik pengguna sendiri (BYOK, bring your own key),
- bisa membaca file tugas lokal sebagai konteks,
- punya persona dan skill yang bisa diubah tanpa koding,
- tidak memakai server perantara: tidak ada backend, telemetri, atau akun Beot.

Satu percakapan, satu proses, nol penyimpanan sesi.

## 2. Lingkungan & dependensi

| Hal | Ketentuan |
|---|---|
| Runtime | Node.js >= 20 (memakai `fetch` bawaan dan ESM) |
| Modul | `"type": "module"` |
| Dependency runtime | `pdf-parse` (hanya untuk PDF) |
| Platform | Windows, macOS, Linux |
| Terminal | Windows Terminal / WSL / macOS. `cmd` lama bisa merusak emoji dan warna |
| Entry point | `node index.js` (`npm start`); setelah `npm link`, perintah `Beot` dari folder mana pun |
| Versi | package `0.1.0`, ditampilkan sebagai `v0.1` di banner |

Tidak ada framework UI, tidak ada database, tidak ada HTTP server.

## 3. Struktur berkas

```
index.js              REPL, perintah, alur chat
selfcheck.js          46 cek logika tanpa API key (npm run selftest)
tests/chat-e2e.mjs    E2E chat + tool + sesi + TUI lewat provider palsu (npm test)
tests/confirm-e2e.mjs E2E default "tanya dulu": setuju & tolak
tests/headless-e2e.mjs E2E `-p` (teks & JSON), tanpa TUI
tests/menu-e2e.mjs    E2E semua perintah + popup (menu lengkap)
lib/shell.js          tool bash: izin, tolak-keras, timeout
lib/web.js            web_fetch: HTTP publik, HTML→teks, blokir host privat
lib/cost.js           perkiraan harga token per model
lib/todo.js           daftar tugas untuk pekerjaan multi-langkah
lib/session.js        simpan/baca sesi JSONL di ~/.beot/sessions
lib/compact.js        ringkas riwayat jadi satu pesan
lib/config.js         path, default, baca/tulis config, deteksi lokal
lib/llm.js            HTTP ke provider + parser SSE
lib/attach.js         bentuk content multimodal + estimasi token
lib/clipboard.js      baca gambar/teks/file dari clipboard OS
lib/filetools.js      list/read/write/edit + grep_file/glob_file (sandbox cwd, deny .env/config)
lib/diff.js           diff baris untuk pratinjau write_file
lib/exporttool.js     generator PDF/XLSX/DOCX/RTF + tool export_* (sandbox + konfirmasi)
lib/persona.js        baca personas/*.json
lib/skills.js         parse frontmatter, salin skill bawaan, scan skill
lib/readfile.js       baca txt/md/csv/pdf, batas ukuran
lib/commands.js       daftar perintah + filter menu
lib/providers.js      katalog provider + daftar model live/static
lib/tui.js            TUI satu-frame: log, composer, popup, input pipe
ui/theme.js           warna, banner, prompt, ikon
ui/logo.js            logo blok 3 baris (B E O T) + fallback lebar
personas/*.json       2 persona bawaan
skills-bawaan/*.md    11 skill bawaan
```

## 4. Penyimpanan pengguna

Semua state pengguna berada di `~/.beot/`:

| Path | Isi |
|---|---|
| `config.json` | base_url, api_key, model, persona, owner, theme, stream_timeout, write_confirm, external, shell, web, thinking |
| `skills/` | skill milik pengguna (`.md`) |
| `themes.json` | tema kustom (opsional): `{ "nama": { "gold": "38;5;214", ... } }` |
| `BEOT.md` | memori global (dibaca tiap request; `/ingat --global`) |
| `sessions/` | riwayat per sesi: satu file `.jsonl` per sesi (meta + pesan user/assistant), maks 50 file |

Aturan:

- Folder dibuat saat config disimpan atau skill bawaan disalin (`recursive`).
- `config.json` ditulis dengan permission `0600` bila platform mendukung; kegagalan `chmod` diabaikan (Windows).
- Sesi dibuat **saat pesan pertama** dikirim (bukan saat startup), format `YYYYMMDD-HHmmss-<pid>.jsonl`, permission `0600`. Hanya pesan `user`/`assistant` yang disimpan — tool call tidak, supaya riwayat bisa diputar ulang tanpa state usang. File lama (>50) dihapus saat startup.
- Sesi dimuat lewat `--continue` (terakhir di folder ini), `--resume` (picker), atau `/sessions`. Maks 40 pesan terakhir dimuat.
- Migrasi sekali jalan: bila `~/.beot/` belum ada tapi `~/.byok-chat/` ada, isinya (`config.json` + `skills/`) **disalin** ke `~/.beot/` (tanpa membuat salinan `.bak` — key cukup satu tempat), lalu dicetak `✓ data lama dipindah: ~/.byok-chat → ~/.beot`. Folder lama tidak diubah/dihapus (arsip). Migrasi tidak diulang setelah `~/.beot/` ada.

### 4.1 Skema config

```json
{
  "base_url": "https://generativelanguage.googleapis.com/v1beta/openai",
  "api_key": "",
  "model": "gemini-2.0-flash",
  "persona": "build",
  "owner": "Radit",
  "theme": "default",
  "stream_timeout": 90,
  "write_confirm": true,
  "external": "ask",
  "shell": "ask",
  "web": "ask",
  "thinking": true
}
```

- Baca: `{...DEFAULTS, ...isiFile}`. File hilang atau JSON rusak → `null` (dianggap pertama kali jalan), bukan crash.
- Tulis: seluruh objek config, JSON 2 spasi + newline.
- Field yang tidak dikenal dipertahankan saat ditulis ulang.
- Tidak ada validasi bentuk URL atau nama model.

### 4.2 Provider

Semua provider memakai satu format: OpenAI-compatible `/chat/completions`.
Base URL hanya digabung dengan `/chat/completions` (garis miring di akhir dibuang).
Provider lokal (`localhost` / `127.0.0.1`) tidak memerlukan API key.

Contoh yang didukung: Gemini OpenAI-compat (default, gratis), Groq, OpenRouter, OpenAI, Ollama.

### 4.3 Provider & model (picker)

`/key` memakai katalog di `lib/providers.js`:

| id | Provider | base_url | Key | Saran model |
|---|---|---|---|---|
| `gemini` | Gemini (Google) | `https://generativelanguage.googleapis.com/v1beta/openai` | perlu | gemini-2.0-flash, gemini-2.5-flash, gemini-2.5-pro |
| `groq` | Groq | `https://api.groq.com/openai/v1` | perlu | llama-3.3-70b-versatile, llama-3.1-8b-instant |
| `openrouter` | OpenRouter | `https://openrouter.ai/api/v1` | perlu | openrouter/auto, google/gemini-2.5-flash, meta-llama/llama-3.3-70b-instruct |
| `openai` | OpenAI | `https://api.openai.com/v1` | perlu | gpt-4o-mini, gpt-4o, gpt-4.1-mini |
| `ollama` | Ollama (lokal) | `http://localhost:11434/v1` | tidak | qwen2.5:7b, llama3.2:3b, mistral:7b |
| `custom` | Lainnya / custom | ditanyakan | opsional | manual |

Aturan:

- Hanya endpoint OpenAI-compatible. Layanan yang butuh OAuth/API non-OpenAI (mis. GitHub Copilot, Anthropic native) tidak termasuk; pakai `custom`.
- Alur: pilih provider → (base_url untuk custom) → key (kecuali Ollama; custom boleh kosong) → pilih model dari saran atau `Ketik model sendiri…`.
- Nama provider diturunkan dari `base_url` saat ini (perbandingan tanpa slash akhir, case-insensitive).
- **Daftar model live dari provider**: `GET {base_url}/models` (`fetchModels` di `lib/providers.js`, timeout 5 dtk) → nama `data[].id` difilter dari model non-chat (embedding/audio/gambar dsb). Ditake di memori per `base_url` (60 dtk), refetched saat startup (latar), setelah `/key` (force), dan saat `/model` dibuka setelahnya. Gagal (401/timeout/tidak ada endpoint) → jatuh ke daftar statis katalog; kalau kedua-duanya kosong → langsung input `Nama model`. Judul popup menyebut sumber: `Pilih model X (N dari provider)`.
- Batal (Esc atau input kosong yang wajib) di langkah mana pun = config tidak berubah.
- Config (`base_url`, `api_key`, `model`) ditulis sekali setelah model dipilih.
- Ollama mengosongkan `api_key`.
- Nama provider diturunkan dari `base_url` saat ini (perbandingan tanpa slash akhir, case-insensitive).
- Daftar model live dari provider sekuat endpointnya; daftar statis katalog jadi cadangan dan bisa usang; model manual selalu tersedia.
- Key tidak divalidasi ke provider.

Popup provider (layer di atas frame TUI, kembali ke frame normal setelah ditutup):

```text
 Pilih provider                                                      esc
 saring ›
 ● Groq                                               gratis · cepat
   Gemini (Google)                          gratis · Google AI Studio
   OpenRouter                                  banyak model · campur
   ...
 ↑↓ pilih · enter ok · esc batal
```

## 5. Alur startup

Urutan pasti:

1. Argumen non-flag pertama (`Beot <folder>`) = folder kerja awal (`state.cwd`); bila bukan folder valid, pakai cwd + peringatan.
2. `ensureBundledSkills()` — salin skill bawaan yang belum ada.
3. `loadPersonas()` — baca `personas/*.json` di folder repo.
4. `loadConfig()` — bila `null`, pakai `DEFAULTS` (tanpa pesan khusus).
5. Pilih persona: `cfg.persona` bila ada, jika tidak persona pertama (urut nama).
   Bila tidak ada persona valid sama sekali: pakai persona darurat `default` dengan system prompt `Kamu asisten yang membantu.` dan suhu `0.7`.
6. Tampilkan banner 3 baris: `◆ beot 0.1` + meta persona/model rata kanan, garis ganda `═` selebar layar, lalu `ketik / untuk menu` (+ `berkas <nama>` bila ada file aktif). Tanpa blob, tanpa hitungan token, tanpa sapaan terpisah.
7. Bila `api_key` kosong **dan** base_url bukan lokal, tampilkan satu baris `API key belum ada — isi lewat /key kapan saja.`
8. Masuk loop REPL. Key **tidak** diminta saat startup dan tidak divalidasi.

Tidak ada panggilan jaringan saat startup.

## 6. REPL

- Argumen CLI: `beot [folder]`, `--continue` (lanjut sesi terakhir di folder itu), `--resume` (picker sesi), `-p/--print "<prompt>"` (headless), `--output-format json`, `--version`, `--help`. `--help`/`--version` dicetak **sebelum** TUI masuk alternate screen dan memakai teks polos.
- Mode `--help`/`--version` tidak pernah menyentuh config, jaringan, atau clipboard.
- Headless: `state.headless = true` → banner/ANSI mati, sesi tidak dibuat, dan semua konfirmasi (tulis/shell/web) otomatis **ditolak** sehingga hanya tool baca yang berjalan. Output: teks jawaban atau JSON `{text, model, tokens, toolCalls, error}`. Exit code `0/1/2`.
- Prompt input mode pipe: `Kamu > `. Di TTY, composer tidak menampilkan label prompt (hanya `›` + kursor). Di transkrip TTY, pesan user tampil sebagai blok latar gelap selebar layar (tanpa bar kiri); jawaban bot diawali header `◆ Beot`.
- Input dibaca per baris, di-`trim`. Baris kosong diabaikan (tidak menambah riwayat).
- EOF (Ctrl+D pada baris kosong) mengakhiri program dengan rapi. `Ctrl+C` saat ada seleksi = menyalin seleksi (tidak keluar); tanpa seleksi, tekan **2×** dalam 1,5 detik untuk mencetak `Keluar.` lalu keluar dengan exit code 0.
- Baris yang diawali `/` dianggap perintah. Perintah tidak menambah riwayat.
- Baris lain dikirim sebagai pesan chat.
- Pemisahan perintah: baris dipecah pada spasi; argumen = sisa baris yang digabung lagi dengan spasi lalu di-`trim`.
  Jadi path ber-spasi harus dikutip: `/tugas "C:\Users\me\my file.md"`.
- Perintah tidak dikenal → peringatan, loop lanjut.
- `/exit` dan `/quit` keluar (mencetak `Sampai jumpa.`).

### 6.1 Menu perintah live

Saat baris **diawali `/`** dan belum ada spasi (masih token perintah), palette perintah **menggantikan composer** (composer disembunyikan) di bagian bawah layar, penuh selebar terminal dan tanpa bingkai:

```
 /persona [nama]     ganti karakter bot
 /skill [nama]       daftar / aktifkan skill
 /cd <folder>        pindah folder kerja
 /add-dir <folder>   izinkan folder luar
 /tugas <path>       baca file jadi konteks
 …  baris terpilih: latar biru penuh, teks putih
─────────────────────────────────────────────────────────
↑↓ pilih · tab lengkapi · enter jalankan · esc tutup
 build · gemini-2.0-flash                ctx 0 · / menu
```

- Filter = awalan nama perintah (`/` menampilkan semua, `/sk` hanya `/skill`). Tidak ada yang cocok → menu hilang.
- `↑`/`↓` memilih (berputar). `Tab` mengisi perintah terpilih + spasi (siap diberi argumen). `Enter` menjalankan perintah terpilih. `Esc` menutup menu.
- Setelah `Esc`, menu tetap tertutup (tidak terbuka lagi saat mengetik) sampai baris input dikosongkan.
- Saat menu tertutup: `↑`/`↓` menelusuri riwayat input sesi ini.
- Menu hanya aktif saat `stdin` dan `stdout` adalah TTY. Bila bukan (pipe/CI), input memakai pembaca baris sederhana tanpa menu; baris yang masuk sebelum prompt tetap diantrekan dan EOF mengakhiri dengan rapi.
- Picker (`/key`, `/model`, `/persona`) dan input API key tampil sebagai **panel popup gelap dengan band judul biru** di tengah layar (identitas Beot): frame chat diredupkan; judul bold di kiri + `esc` di kanan; baris `saring ›` selalu tampil dan langsung memfilter saat mengetik; item dengan deskripsi **rata kanan**; baris terpilih berlatar biru penuh + teks putih; item aktif ditandai `●`; picker mulai dari item aktif. Input key memakai label + nilai disamarkan tanpa kotak. Footer `↑↓ pilih · enter ok · esc batal` (picker) atau `enter simpan · esc batal` (input). `Esc` batal; saat ditutup, overlay hilang. Butuh TTY; di mode pipe dianggap batal.
- Editor mendukung: kiri/kanan, Home/End, Backspace/Delete, Ctrl+U (hapus sebelum kursor), Ctrl+K (hapus setelah kursor), Ctrl+W (hapus kata sebelum kursor).
- **Ctrl+O** (saat input kosong) membuka file manager: jelajahi folder kerja (`📁` folder, `📄` file, `..` naik), `📂 Ketik lokasi…` untuk membuka path absolut/relatif, `Enter` membaca file jadi konteks.
- **`@` di composer**: mengetik `@` membuka daftar file di folder kerja (cache 10 dtk, maks 1.200 file, tampil 40 hasil). `Enter`/`Tab` menyisipkan `@<path> ` dan menandainya; saat pesan dikirim, isi file itu (maks 5 file × 40.000 karakter) disertakan sebagai `[FILE @<path>]`.
- Saat composer kosong, tampil placeholder dim `Ketik pesan… (/ untuk menu · F2 gambar)`.
- Saat transkrip digulir ke atas, muncul indikator `↑ <n> baris · PgDn turun` di atas composer.
- Saat bot menjawab, `Esc` menghentikan request (Ctrl+C diabaikan) dan kembali ke prompt (`⚠ Dihentikan.`). Karakter yang kamu ketik selama bot menjawab **disimpan (typeahead)** dan muncul di prompt berikutnya.
- **Tempel teks multi-baris** (bracketed paste, `\x1b[200~…\x1b[201~`): teks ditaruh utuh di composer (bisa beberapa baris, kursor tetap benar), tidak langsung terkirim. `Enter` mengirim seluruh blok sebagai **satu pesan**. CRLF dinormalkan jadi `\n`, Tab jadi dua spasi.
- **Tempel gambar/dokumen** (Ctrl+V / Shift+Insert / F2): app membaca clipboard OS sendiri (PowerShell di Windows, osascript/pbpaste di macOS, wl-paste/xclip di Linux). Untuk gambar: PNG disimpan sementara, dibaca base64, file temp dihapus, lalu tampil chip `📎 gambar.png`. Untuk file dari Explorer (`.txt .md .csv .pdf`): dibaca sebagai teks dan tampil chip `📄 nama`. Gambar juga didukung dari file `.png/.jpg/.jpeg/.webp/.gif`. `Backspace` saat input kosong menghapus lampiran. Ctrl+V juga menangani paste teks bila terminal tidak meneruskannya. Sinyal didukung: keypress Ctrl+V, Shift+Insert, F2, dan bracketed paste kosong (clipboard gambar murni).

## 7. Perintah

| Perintah | Perilaku |
|---|---|
| `/persona [nama]` | tanpa argumen: modal pilih persona; argumen: nama persona |
| `/skill [nama]` | tanpa argumen: daftar skill; `lepas`/`off`: matikan; nama: aktifkan |
| `/files` | file manager: jelajahi folder kerja (termasuk `Ketik lokasi…`), pilih file untuk dibaca jadi konteks (juga Ctrl+O) |
| `/cd <folder>` | pindah folder kerja (relatif/absolut); tanpa argumen: tampilkan folder kerja + folder izin |
| `/add-dir <folder>` | tambah folder izin untuk session; ketik path yang sama lagi untuk menghapus; tanpa argumen: daftar |
| `/tugas <path>` | baca file jadi konteks; tanpa argumen: petunjuk pemakaian |
| `/key` | picker provider → isi key → picker model (bagian 4.3 & 7.1) |
| `/model [nama]` | tanpa argumen: info + picker model; nama: set model; `base <url>`: ganti base_url |
| `/clear` | kosongkan riwayat, file, dan `ctx` (total sesi tetap); sesi tersimpan tidak dihapus |
| `/init [--force]` | buat `<folder-kerja>/BEOT.md` dari ringkasan lokal (package.json, skrip, jumlah berkas); menolak menimpa tanpa `--force` |
| `/ingat [--global] <fakta>` | tambah baris `- <fakta>` ke `BEOT.md` proyek (atau global); idempoten, maks 400 karakter/baris |
| `/compact` | ringkas riwayat jadi satu pesan `[RINGKASAN PERCAKAPAN SEBELUMNYA]`; otomatis sekali saat konteks ≥85% |
| `/sessions` | picker sesi tersimpan untuk folder ini; memilih = muat riwayat (maks 40 pesan) |
| `/reload` | muat ulang `config.json`, persona, dan skill dari disk; laporkan perubahan |
| `/setting` | tampilkan pengaturan saat ini (key disamarkan), lalu popup untuk ubah `base_url`/`model`/`api_key`/`persona`/`stream_timeout`/`write_confirm`/`external`/`shell`/`web` atau buka file config |
| `/status` | tampilkan token request terakhir (prompt/jawaban) + jumlah request & token sesi |
| `/cost` | perkiraan biaya USD: request terakhir + total sesi, dari tabel harga publik (`lib/cost.js`), format buku besar; model tak dikenal → hanya token |
| `/theme [nama]` | tanpa argumen: panel **Pilih tema** (swatch warna per tema, item aktif `●`, terpilih biru); `preview`/`daftar` = daftar semua tema + swatch; argumen nama: terapkan; tersimpan di config |
| `/thinking` | tampilkan/sembunyikan blok `✻ berpikir · <detik>` (toggle, tersimpan di config `thinking`) |
| `/bantu` | daftar perintah |
| `/exit` | keluar |

Menu live (bagian 6.1) adalah jalan pintas yang sama; memilih item lalu Enter menjalankan perintah itu tanpa argumen. Untuk memberi argumen, pilih dengan `Tab` lalu ketik sisanya.

### 7.1 `/key` (provider + model)

- Membuka picker provider (bagian 4.3). `↑`/`↓`, `Enter` pilih, `Esc` batal.
- `Lainnya / custom` menanyakan `base_url`; kosong = batal.
- Ollama: tanpa key. Provider lain: modal input key (nilai disamarkan `•`, `Enter` simpan, `Esc` batal); Gemini menampilkan tautan AI Studio. Key kosong (non-custom) = batal.
- Setelah key, picker model: daftar saran + `Ketik model sendiri…`.
- Semua langkah harus selesai; batal di langkah mana pun tidak mengubah config.
- Sukses: simpan `base_url`, `api_key`, `model` (sekali tulis), cetak `✓ Provider: <nama> · model: <model>` dan lokasi config.
- Key tidak divalidasi ke provider saat disimpan.

### 7.2 `/persona`

- Tanpa argumen: buka panel **Pilih persona** (baris Cari + item, terpilih biru); `↑↓` pilih, `Enter` pilih, `Esc` batal.
- Dengan argumen: dicocokkan persis dengan `nama`.
- Batal = tidak berubah.
- Tidak ditemukan → peringatan.
- Berhasil → set persona aktif, simpan `cfg.persona`, cetak konfirmasi.

### 7.3 `/skill`

- Daftar dibaca ulang dari `~/.beot/skills` setiap kali perintah dijalankan (tanpa restart).
- Tanpa argumen (TTY): buka panel **Pilih skill** — item `(tanpa skill)` + setiap skill (`nama` + deskripsi rata kanan), item aktif ditandai `●`, terpilih berlatar biru; footer `↑↓ pilih · enter ok · esc batal`. `Esc` batal.
- Tanpa argumen (pipe/non-TTY): tampilkan daftar `nama — deskripsi` + penanda aktif.
- `lepas`/`off`/`none` mematikan skill aktif.
- Nama tidak ada → peringatan.
- Skill aktif hanya satu; mengaktifkan yang lain menggantikan yang lama.
- Skill aktif tidak disimpan ke config (hilang saat keluar).

### 7.4 `/cd` dan `/add-dir`

- `/cd <folder>`: resolve relatif ke folder kerja, validasi folder, lalu `state.cwd` berpindah. Semua tool file/export dan file manager memakai folder baru. Tanpa argumen: tampilkan folder kerja + daftar folder izin.
- `/add-dir <folder>`: tambah folder ke `state.extraDirs` (session, tidak disimpan ke config); ketik path yang sama lagi untuk menghapus. Tanpa argumen: daftar.
- Path di luar folder kerja + folder izin: default `external: "ask"` → muncul modal **Izinkan akses?** (`Izinkan` menambah path, `Tolak` = error). Mode `trust` (lewat `/setting` → `izin path luar`) melewati modal dan langsung mengizinkan.
- File sensitif: `read_file`/`write_file` menolak `.env*` dan `~/.beot/config.json` (`File sensitif diblokir untuk keamanan.`) — API key tidak pernah terkirim ke provider lewat tool.
- `eot [folder]` memakai folder itu sebagai `state.cwd` saat start (argumen non-flag pertama).

### 7.5 `/tugas`

- Argumen dibersihkan dari kutip tunggal/ganda di awal-akhir.
- Path di-resolve relatif terhadap working directory proses.
- Sukses: cetak `✓ 📄 <nama> — <ukuran> kB, <kind>`; bila terpotong, tambahkan penanda dan saran memanggil per-bab.
- Gagal (tidak ada, folder, `.docx`, PDF scan, dll.): kosongkan file aktif, cetak pesan error yang jelas, aplikasi tetap jalan.
- Hanya satu file aktif; `/tugas` baru menggantikan yang lama.
- Isi file dikirim ke provider hanya saat chat, bukan saat `/tugas`.

### 7.5 `/model`

- Tanpa argumen: tampilkan `model` dan `base_url`, lalu buka picker model untuk provider yang terdeteksi dari `base_url` (atau input manual untuk base_url custom).
- `base <url>`: set `base_url` (URL kosong ditolak dengan petunjuk pemakaian).
- Nama lain: set `model` apa adanya (tanpa validasi).
- Batal pada picker = model tidak berubah.
- Setiap perubahan langsung disimpan ke config.

### 7.6 `/clear`

- Mengosongkan `history`, file aktif, dan `ctx` (total sesi tidak direset).
- Persona, skill aktif, model, dan key **tidak** diubah.
- Mencetak `Riwayat dan file dibersihkan.`

## 8. Alur chat

Prasyarat: bila `api_key` kosong dan base_url bukan lokal, pesan **tidak dikirim**. Tampilkan `⚠ API key belum ada. Ketik /key dulu, atau pakai Ollama lokal lewat /model base.`; riwayat tidak berubah dan tidak ada panggilan jaringan.

1. Pesan pengguna dimasukkan ke `history` sebagai `{role:'user', content}`. Tanpa gambar, `content` = string. Dengan gambar, `content` = array `[{type:'text',text}, {type:'image_url',image_url:{url:'data:image/png;base64,...'}}]`; teks kosong diganti `Jelaskan gambar ini.`. Di transkrip TTY tampil blok latar gelap selebar layar berisi pesan (+ baris `📎 <nama>`) — perintah diawali `/` cukup dicetak `› /perintah`, tanpa blok. Echo terjadi saat submit, sebelum chat dipanggil. Prompt bertanda `secret` tidak pernah dicatat.
2. Cetak baris kosong lalu header `◆ Beot`.
3. Susun system prompt (bagian 8.1), kirim `[system, ...history]`.
4. Temperature = `persona.suhu` (fallback `0.7`).
5. Bila provider mengirim `reasoning_content` (atau `reasoning`), isinya **tidak dicetak selama berpikir** — selama menunggu hanya spinner `Memikir… <detik>s` di status. Saat token jawaban pertama datang (atau stream selesai), reasoning diringkas jadi blok **sebelum** jawaban: baris kosong, `✻ berpikir · 11.9s`, baris kosong; **klik baris itu** (tanpa geser) membuka/menutup isi penuh inline (baris kosong + isi dim indent), gaya Claude Code. Isi thinking tidak dikirim balik ke history. Fitur ini dimatikan lewat `/thinking` dan tidak muncul bila provider tidak mengirim reasoning. Token jawaban dicetak streaming tanpa newline. Selama menunggu/menjawab, spinner menampilkan detik berjalan; `Esc` membatalkan request (AbortController), `Ctrl+C` diabaikan. Ketikan selama menunggu disimpan sebagai typeahead untuk prompt berikutnya.
   Kalau provider tidak mengirim data selama `stream_timeout` (default 90 detik; bisa diubah di `/setting` atau env `BEOT_STREAM_IDLE_MS`), request round itu **diulang otomatis 1x** (teks parsial dibuang). Koneksi yang diputus di tengah stream (`terminated`/`ECONNRESET`) diperlakukan sama: `↻ ulang karena koneksi terputus…`. Kalau percobaan kedua gagal, tampil pesan ramah (bukan teks mentah `terminated`).
6. Sukses: cetak newline, simpan jawaban ke history sebagai `assistant`, lalu perbarui `ctx` di composer (tidak mencetak baris token di transkrip).
   `ctx` = `total_tokens` request terakhir, jika tidak estimasi. Bila jawaban memakan >15 detik, kirim bel terminal.
   Jawaban kosong (tanpa teks, thought, maupun tool) **diulang otomatis 1x**; kalau tetap kosong, cetak `⚠ Provider tidak mengirim jawaban (kosong). Coba lagi.` dan jawaban kosong **tidak** masuk history.
7. Gagal: cetak newline, **buang pesan pengguna yang gagal** dari history, cetak pesan error yang ramah. Percakapan bisa dilanjutkan. Untuk HTTP 400 yang menyebut image/vision, tampilkan saran ganti ke model vision.
8. Dibatalkan: seperti gagal, tetapi pesan `⚠ Dihentikan.`; teks parsial yang sudah tampil tidak masuk history.
9. Gambar: maks 5 MB (PNG/JPG/WebP/GIF), satu per pesan, hanya dikirim jika provider/model mendukung vision; gambar tetap ada di history dan ikut dikirim ulang. Dokumen (`.txt .md .csv .pdf`, satu file) dibaca sebagai teks dan digabung ke pesan dengan header `[DOKUMEN: nama]`; batas ±50 kB/50.000 karakter, `.docx` dan PDF scan/OCR belum didukung.

### 8.1 Urutan system prompt

Digabung dengan satu baris kosong antar-bagian:

1. Instruksi tetap: jawab teks polos yang enak dibaca di terminal, hindari HTML (tabel markdown boleh — dirender rapi); kode ditulis dalam blok ` ```<bahasa> `; gunakan tool `list_dir`/`read_file`/`write_file`/`export_*` hanya bila perlu; untuk mengubah file WAJIB `write_file` (bukan sekadar menampilkan kode); file biner lewat `export_*`; cari kode/file dengan `grep_file`/`glob_file` sebelum membaca banyak file; isi write_file harus berbeda dari file lama.
2. Bila mode `plan`: instruksi `MODE PLAN` read-only.
3. `[FOLDER KERJA: <cwd>]`.
4. `[MEMORI]` bila ada `BEOT.md` (proyek dan/atau global): teks digabung, masing-masing dipotong 8.000 karakter, ditandai `# global` / `# proyek`.
5. `[FOLDER TAMBAHAN: ...]` bila ada.
6. `IZIN PATH`: mode `ask` (default) → path di luar folder kerja memunculkan konfirmasi pengguna; mode `trust` → diizinkan otomatis.
7. `[IDENTITAS]` — `APP`, `MODEL` (dari config), `PEMBUAT` (config `owner`) + aturan: jawab identitas sesuai config, dilarang mengklaim perusahaan lain (Z.ai/OpenAI/Anthropic/NVIDIA), tidak yakin → katakan tidak tahu.
8. `persona.system_prompt`.
9. Bila skill aktif: `[SKILL AKTIF: <nama>]\n<isi skill>`.
10. Bila file aktif: `[FILE YANG DIBACA: <nama>]\n<isi file>`.

Tidak ada pemotongan riwayat manual oleh user; riwayat dipangkas otomatis bila perkiraan konteks melebihi **70% context window** (pesan tertua dibuang, dicatat `⟳ riwayat dipangkas: N pesan`) dan pengguna tetap bisa `/clear`.

### 8.2 Token & konteks

Angka diambil dari `usage` provider tiap request (`prompt_tokens`, `completion_tokens`, `total_tokens`).

- `ctx` di composer = total token **request terakhir** (bukan total sesi). Kalau provider tidak mengirim `usage`, nilainya estimasi `round((karakter history + file) / 4)` dan ditandai `(estimasi)`.
- Bar konteks memakai asumsi context window **128.000 token** (konstanta `CONTEXT_WINDOW`): `▓▓░░░ 3%`, hijau <50%, biru 50–79%, merah ≥80%. Ini perkiraan, bukan batas resmi model.
- Provider **tidak** ditampilkan di baris status (cukup `persona · model`); nama provider tetap terlihat di picker `/key`/`/model`.
- Token dihitung per panggilan API; pada giliran dengan tool `skill`, tiap ronde menambah hitungan sesi.
- Jumlah token sesi = akumulasi `total_tokens` semua panggilan sukses (termasuk ronde tool). Tidak ada tampilan biaya `$` karena harga per model belum ada.
- `/status` menampilkan request terakhir (prompt + jawaban), jumlah request, total token sesi, jumlah pesan riwayat, model config, **respons model** dari provider (dibandingkan per nama model akhir — bila beda ditandai `⚠ beda dari config`), timeout stream, konfirmasi tulis, izin path luar, status `thinking`, dan folder kerja/izin. Semua baris memakai format buku besar (`label ······ nilai`).
- `/clear` mereset `ctx` dan riwayat, tetapi **tidak** mereset total sesi (sesi = sejak app dijalankan).

### 8.3 Tool file & ekspor

- Tool yang selalu dikirim: `list_dir`, `read_file`, `write_file`, `edit_file`, `grep_file`, `glob_file`, `bash`, `web_fetch`, `todo_write`, `export_pdf`, `export_xlsx`, `export_docx`, `export_rtf`; plus `skill(name)` bila mode skill otomatis.
- `grep_file`: cari regex di isi file (folder kerja/izin), hasil `path:baris: teks` (default 50 hasil, maks 200), skip biner/.git/node_modules/folder berawalan titik + file sensitif (`.env*`, kredensial, `~/.beot/`). Pola maks 300 karakter; kuantifier bersarang ditolak dan baris >4.000 karakter dilewati (cegah hang).
- `glob_file`: cari file berdasarkan pola (`**/*.py`, `src/**/*.ts`, `*.md`), hasil path relatif (default 100).
- `list_dir`: daftar folder kerja (relatif) atau folder izin, folder dulu, maks 200 entri; `.git`/`node_modules` disembunyikan.
- `read_file`: baca txt/md/csv/pdf lewat `readDoc` (batas yang sama), dari folder kerja/folder izin; dukung `offset`/`limit` (baris) untuk file besar. File sensitif (`.env*`, kredensial, `.git/`, `~/.beot/`) ditolak.
- `write_file`: untuk mengubah/membuat file teks **WAJIB lewat tool ini** (jangan hanya menampilkan kode). Hanya path relatif **di dalam folder kerja atau folder izin**; `..` keluar, `.git`, dan `node_modules` ditolak. Transkrip menampilkan blok `▐ <path>  ubah/baru  +X −Y` bernomor baris asli (`+` hijau, `-` merah, konteks), lalu baris buku besar `tulis <path> ····· ✓ <durasi>`. Default `write_confirm: true` = **tanya dulu** (`? Simpan <nama>? · enter=ya · esc=batal`); bisa dimatikan lewat `/setting` → `konfirmasi tulis` = `Langsung simpan`. Batal mengembalikan `DIBATALKAN`. Folder induk dibuat otomatis, isi maks 200.000 karakter. Ekstensi biner `.pdf`/`.xlsx`/`.docx` ditolak dan diarahkan ke tool export yang tepat.
- `edit_file`: ganti potongan (`old_string` → `new_string`). `old_string` harus muncul tepat 1× (atau `replace_all: true`); tidak ketemu/ambigu = error yang menjelaskan. File harus sudah ada (file baru lewat `write_file`). Memakai sandbox, diff, dan konfirmasi yang sama dengan `write_file`.
- `bash`: satu perintah shell di folder kerja. Output digabung (maks 60.000 karakter), timeout default 30 dtk (maks 120; process tree dimatikan). Izin mengikuti config `shell`: `ask` (default, prompt `Jalankan: …?`) / `allow` / `deny`; mode `plan` selalu `ask`. Pola berbahaya (`rm -rf /`, `format`, `shutdown`, `diskpart`, `curl|sh`, dsb.) **selalu ditolak** dan tidak bisa di-allow.
- `todo_write`: daftar tugas `{content, status}` (maks 12, status `pending`/`in_progress`/`completed`). Panel `tugas n/m` tampil di atas composer (2 baris, maks 4 item terlihat).
- `web_fetch`: GET `http(s)` publik, timeout 10 dtk, maks 1 MB; HTML diubah jadi teks (script/style dibuang). Host privat/loopback/link-local ditolak. Izin mengikuti config `web`: `ask` (default), `allow`, `deny`.
- Path di luar folder kerja/izin: `ensureAccess` memanggil `onOutside`; bila pengguna mengizinkan, path masuk `extraDirs` (session). Bila menolak, tool mengembalikan error.
- `export_pdf`: PDF teks A4 (`title`, `text`, nomor halaman), maks 200.000 karakter. Tanpa gambar/styling; huruf di luar Latin-1 menjadi `?`.
- `export_xlsx`: satu sheet (`columns`, `rows`, `sheet`), maks 60 kolom / 5.000 baris / 120.000 sel; angka dikirim sebagai number, teks sebagai string; header tebal + freeze baris 1.
- `export_docx`: Word sederhana (`title`, `text`); baris `- ` jadi bullet. `export_rtf`: fallback Word berbasis teks murni.
- Semua export memakai sandbox yang sama, mengikuti `write_confirm` (default **tanya dulu**), dan ekstensi path harus cocok (otomatis ditambah bila kosong). Tool loop maks 16 langkah; jika habis, chat berhenti dengan peringatan (konteks tetap) dan user bisa mengetik "lanjutkan". Tiap tool selesai menampilkan baris buku besar (`baca  file ····· 1.2 kB  ✓ 0.1 s`) dengan durasi. Tool yang gagal menampilkan `✗ <tool> · <pesan>` (error tetap dikirim ke model).
- Di persona `plan`, `write_file` dan semua `export_*` tidak dikirim dan runtime menolak penulisan.
- Jika provider menolak `tools` (400/404/422), chat diulang tanpa tool.

## 9. Kontrak LLM

Request:

```
POST <base_url tanpa / di akhir>/chat/completions
Content-Type: application/json
Authorization: Bearer <api_key>     // hanya bila key tidak kosong

{
  "model": "<model>",
  "messages": [ { "role": "system", ... }, ... ],
  "temperature": <number>,
  "stream": true
}
```

Pesan dengan lampiran memakai `content` berupa array (format OpenAI multimodal); tanpa lampiran tetap string. Tidak ada field `tools` kecuali tool `skill` (bagian 11).

Response non-2xx:

- Body dibaca (maks. 300 karakter) untuk pesan.
- Error membawa `status` HTTP.
- Pemetaan pesan ke pengguna:
  - `401` → key ditolak, sarankan `/key`.
  - `429` → kuota penuh, sarankan tunggu atau ganti model.
  - `404` → model/base_url tidak ditemukan.
  - `524` → gateway timeout (Cloudflare/origin terlalu lama); saran coba lagi/ganti model.
  - `502`/`503` → provider sedang tidak tersedia.
  - `520`–`523` → gateway/origin error.
  - Body HTML (halaman Cloudflare dsb.) **tidak ditampilkan**; hanya status + pesan ramah.
  - Body JSON diambil `error.message`; teks polos dipotong 300 karakter.
  - `fetch failed` / `ENOTFOUND` / `ECONNREFUSED` → provider tidak terjangkau, cek internet/base_url.
  - lainnya → pesan dipotong 300 karakter.

### 9.1 Parser SSE

- Data dialirkan sebagai teks; buffer dipotong per `\n` (`\r` dibuang oleh `trim`).
- Hanya baris berawalan `data:` yang diproses.
- `data: [DONE]` menandai selesai; pembacaan stream berhenti.
- `choices[0].finish_reason` yang terisi (mis. `stop`, `length`, `tool_calls`) juga menandai selesai — supaya provider yang tidak mengirim `[DONE]`/tidak menutup koneksi tidak membuat app menggantung. Setelah berhenti, koneksi di-`cancel()`.
- JSON yang gagal di-parse dilewati (mis. baris rusak atau potongan yang belum lengkap).
- Delta diambil dari `choices[0].delta.content`; delta kosong/null diabaikan.
- `usage` diambil dari respons terakhir yang memuatnya.
- Sisa buffer tanpa newline disimpan untuk chunk berikutnya; data tidak boleh hilang saat satu baris terbelah antar-chunk.
- Decoder memakai mode streaming agar karakter multibyte tidak rusak di batas chunk.

Tidak ada retry untuk error HTTP; hanya **timeout/koneksi putus** dan **jawaban kosong** yang diulang otomatis 1x. Error gateway yang datang di dalam stream (`data: {"error":{"message":…}}`, HTTP 200) dilempar sebagai pesan provider — tidak ditelan diam-diam. Pembatalan memakai `AbortController` (`Esc`; `Ctrl+C` diabaikan saat menjawab). Stream yang tidak mengirim data selama `stream_timeout` (default 90 detik; env `BEOT_STREAM_IDLE_MS` bisa override) atau koneksi yang ditutup (`terminated`) memicu retry, lalu pesan ramah.

## 10. Persona

Satu persona = satu file JSON di `personas/`.

```json
{
  "nama": "asisten-ku",
  "deskripsi": "gaya bebas",
  "suhu": 0.7,
  "system_prompt": "Kamu ..."
}
```

- `nama` dan `system_prompt` wajib; file tanpa keduanya dilewati.
- `suhu` default `0.7` bila tidak ada.
- `deskripsi` hanya untuk tampilan.
- File rusak dilewati tanpa menggagalkan aplikasi.
- Persona diurutkan menurut `nama` (locale compare).
- Menambah file = persona otomatis muncul; tidak perlu koding/restart.
- 2 bawaan: `build` (eksekusi: kode/perintah/langkah siap pakai) dan `plan` (rencana bertahap + opsi/trade-off/risiko). `plan` **read-only**: `write_file` dan semua `export_*` tidak dikirim ke model, prompt mode plan melarang menulis, dan runtime menolak penulisan (`Mode plan: ...`).

## 11. Skill

Skill = file `.md` dengan frontmatter:

```markdown
---
nama: rumus-fisika
deskripsi: bantu jelasin rumus fisika step by step
---

Kamu tutor fisika. ...
```

Aturan:

- Frontmatter harus diawali `---`, diakhiri `---` pada baris sendiri.
- `nama` wajib; `deskripsi` opsional; `isi` = seluruh teks setelah frontmatter, di-`trim`.
- File tanpa frontmatter/`nama` dilewati.
- Scan `*.md` dari tiga folder dengan prioritas **bawaan < user < proyek**: `skills-bawaan/` (repo), `~/.beot/skills`, lalu `<folder-kerja>/.beot/skills`. Nama sama → yang berprioritas lebih tinggi menang; hasil diurutkan menurut `nama`.
- Saat startup, 11 skill bawaan (`ringkas-tugas`, `koreksi-laporan`, `brainstorm-tugas`, `brainstorm`, `code-review`, `debug`, `rencana-kerja`, `tdd`, `desain-ui`, `copywriting`, `jelaskan-konsep`) disalin ke folder pengguna **hanya bila belum ada** (per file). File pengguna tidak pernah ditimpa.
- Menambah/mengubah file langsung terlihat pada `/skill` berikutnya (index dibangun saat request, bukan saat startup).
- Hanya nama, deskripsi, dan isi yang dipakai; tidak ada eksekusi kode.
- **Mode otomatis**: system prompt selalu memuat **index skill** (`nama — deskripsi`, ±150 token). Model bisa memanggil tool `skill(name)` untuk memuat isi penuh satu skill saat relevan. Isi tidak dimuat untuk semua skill sekaligus. Jika provider tidak mendukung tool calling (400/404/422), chat diulang sekali tanpa tool (fallback).
- **Mode manual**: `/skill <nama>` mengaktifkan satu skill; teks penuhnya dimasukkan langsung ke system prompt (tanpa index/tool). `/skill lepas` mematikan.
- Tool `skill(name)` hanya membaca dari `~/.beot/skills` (nama harus ada di katalog); bukan path bebas.
- UI menampilkan baris `skill ····· <nama>` setelah jawaban jika tool dipakai.

## 12. Membaca file

`readDoc(path)` mengembalikan:

```js
{ nama, path, text, truncated, bytes, kind }
```

- `nama` = basename, `kind` = ekstensi tanpa titik (`md`, `txt`, `csv`, `pdf`, ...; tanpa ekstensi → `text`).
- Path di-resolve dari working directory.
- Bukan file/tidak ada → error `File tidak ditemukan: <path>` / `Bukan file: <path>`.
- `.docx` → error khusus saat **dibaca**: belum didukung, sarankan simpan `.txt`/`.md` atau export PDF. (Membuat `.docx` baru tersedia lewat tool `export_docx`.)
- Selain PDF: dibaca sebagai UTF-8. Batas `MAX_BYTES` 50 KB; bila lebih, hanya awal file yang dipakai dan `truncated: true`. Batas `MAX_CHARS` 50.000 karakter juga berlaku.
- File teks tanpa ekstensi tetap dicoba dibaca.
- PDF: teks diekstrak dengan `pdf-parse`.
  - Hasil < 20 karakter dianggap PDF scan/foto → error yang menjelaskan butuh OCR.
  - Dipotong pada `MAX_CHARS`.
  - Jalur PDF bersifat async; pemanggil wajib `await`.
- File tidak pernah diubah/dihapus.

## 13. UI

- Warna memakai ANSI 256; **lima palet bawaan**: `default` (biru Beot), `nord` (biru dingin), `senja` (amber hangat), `mono` (abu), `kontras` (biru/kuning) — dipilih lewat `/theme`, disimpan di config. Palet `default` memakai **satu aksen biru**; hijau hanya untuk `✓`, merah hanya untuk `✗`/error, sisanya netral + dim. Picker menampilkan **swatch** (`■■■■■`) per tema; setelah diterapkan muncul contoh `const warna = "biru" // komentar 42` + `✓ ✗ ●`.
- Tema kustom dibaca dari `~/.beot/themes.json` (objek `nama → palet`). Hanya kunci palet yang dikenal dan nilai `^[0-9;]{1,24}$` yang diterima; kunci kosong mewarisi `default`; lima nama bawaan tidak bisa ditimpa. `/reload` memuat ulang file tema.
- **Layar splash** (TTY ≥44 kolom, transkrip kosong, belum mengirim pesan): logo 3 baris (`█▀▀▄ █▀▀▀ █▀▀█ ▀▀█▀▀`, lebar 20) di tengah dengan **gradien biru** (33 → 39 → 75), tagline `v0.1 · chat AI di terminal · BYOK · nol server`, catatan startup (API key/skill proyek/memori/sesi) berwarna biru, composer selebar ±76 kolom di tengah, lalu hint `shift+tab persona · / menu · F2 gambar` dengan tombol berwarna biru. Splash **tetap selama mengetik** dan baru hilang saat pesan/perintah dikirim; setelah itu composer kembali di bawah. Terminal <44 kolom atau non-TTY: banner satu baris `◆ beot 0.1` di transkrip.
- Garis pemisah 58 karakter `─`.
- `/bantu` menampilkan daftar perintah dengan kolom label selebar label terpanjang (maks 28) dan garis `─` selebar terminal; deskripsi panjang dipotong dengan `…`.
- **Full-screen TUI (alternate screen)**: app memiliki seluruh layar. Area chat punya tinggi tetap dan scroll internal; composer dipaku di bawah; render ulang satu frame penuh tiap perubahan. Saat keluar, alternate screen dilepas dan layar kembali ke isi sebelumnya; hanya pesan keluar (`Sampai jumpa.`/`Keluar.`) yang dicetak — transkrip tidak didump ke scrollback.
- Composer chat (TTY): **blok gelap** selebar layar **tanpa bar kiri**: baris input diawali prompt biru `›` (baris lanjutan menjorok 4 spasi), satu baris padding bawah. **Di luar blok**: satu baris kosong pemisah, lalu satu baris status — kiri `persona  folder  model`, kanan (rata) `ctx <bar> <pct>%  <n> tok  / menu` (saat menjawab: `esc hentikan`). Di layar splash composer menyempit (~76 kolom) dan diletakkan di tengah. `ctx` = token request terakhir. Saat kosong, input menampilkan placeholder dim `Ketik pesan… (/ untuk menu · F2 gambar)`. Lampiran tampil sebagai chip `📎 nama` (gambar) atau `📄 nama` (dokumen) + ukuran + `backspace hapus` di dalam blok. Kursor terlihat di area input. Hasil tempel multi-baris ditampilkan sebagai beberapa baris input; `Enter` mengirim seluruhnya.
- Input memakai **satu reader keypress permanen** selama sesi (raw mode dipasang sekali di awal, dilepas saat keluar) — tidak ada `pause`/raw toggle tiap giliran. Ketikan saat bot menjawab disimpan sebagai typeahead dan dimasukkan ke prompt berikutnya. `Esc`/`Ctrl+C` saat menjawab membatalkan request.
- **Markdown ringan** di jawaban: `**bold**`, `` `inline code` ``, bullet `-`/`*` jadi `•`, heading `#` jadi bold. Bukan parser penuh. **Tabel markdown dirender rapi**: bingkai `╭ ╮ ╰ ╯`, garis pemisah antar baris, kolom rata, header tebal, sel panjang di-wrap sesuai lebar terminal (baris pemisah `|---|` tidak ikut tampil).
- Transkrip TTY bergaya buku besar: pesan user = **blok latar gelap selebar layar** (tanpa bar kiri, teks menjorok 2 spasi); jika ada gambar, tampil baris `📎 <nama>`; jawaban bot = header `◆ Beot` (biru) lalu teks polos (token ada di composer & `/status`); perintah dicetak `› /perintah` (dim, tanpa blok). Prompt `secret` tidak pernah masuk transkrip.
- Blok kode jawaban (fence ` ```<bahasa> `) dirender sebagai header `▐ <bahasa>` dan baris bernomor (`   1 │ …`); fence-nya tidak ditampilkan. Baris diff berawalan `+`/`-` diberi tanda berwarna (hijau/merah) tanpa latar. Teks kode diwarnai sederhana tanpa dependensi: keyword, string, angka, komentar, dan nama fungsi (daftar bahasa: js/ts, python, bash, solidity, go, rust, json, dll; fallback js). Fence yang tidak ditutup direset saat log berikutnya.
- Ikon: `✓` sukses, `✗` gagal/tool error, `⚠` peringatan, `📄` file.
- `/bantu` menampilkan daftar perintah dengan kolom label selebar label terpanjang (maks 28) dan garis `─` selebar terminal; deskripsi panjang dipotong dengan `…`.
- Menu `/` tampil sebagai **palette layar penuh** yang menggantikan composer: baris perintah selebar terminal (tanpa bingkai, tanpa margin), kolom kiri 20ch + deskripsi, item terpilih berlatar biru penuh + teks hitam, garis `─` penuh, footer `↑↓ pilih · tab lengkapi · enter jalankan · esc tutup`, lalu satu baris status. Tinggi daftar dibatasi agar transkrip tetap terlihat (minimal ±35% layar); daftar digulir mengikuti pilihan. Setelah `Esc`, palette tetap tertutup dan tidak muncul lagi sampai baris input dikosongkan.
- Transkrip bisa digulir dengan **roda mouse** (3 baris per notch) atau **PgUp/PgDn** (buffer internal), juga saat bot sedang menjawab. `Up`/`Down` **tetap untuk riwayat input**, bukan scroll. **Drag mouse** di transkrip menyeleksi (highlight) dan otomatis menyalin ke clipboard saat dilepas (OSC 52 + clipboard OS); klik tanpa geser menghapus seleksi. Maksimum scroll = seluruh baris transkrip; posisi baca dipertahankan saat stream menambah baris, dan kembali ke bawah saat `Enter` mengirim pesan.
- Picker provider/model/persona dan input API key tampil sebagai **panel popup gelap dengan band judul biru** di tengah layar (lebar ±64 kolom): seluruh frame diredupkan, lalu panel dengan judul bold + `esc` kanan, baris `saring ›` yang selalu tampil, daftar item (deskripsi rata kanan, terpilih latar biru penuh, item aktif `●`), dan footer. Input key memakai label + nilai disamarkan tanpa kotak.
- Input API key memakai modal: nilai **disamarkan** (`•`), `Enter` simpan (validasi min 8 karakter), `Esc` batal.
- **Shift+Tab** mengganti persona ke berikutnya (mis. `build` ↔ `plan`) tanpa mengirim input; status `persona  folder  model` di composer langsung berubah.
- Saat menunggu jawaban, **baris bot** menampilkan spinner `⠋ <label>… <detik>s` (label tetap: `Memikir`, atau `Lanjut`/`Ulang`); warna berubah netral → biru (≥5s) → merah (≥15s). Spinner tetap tampil sampai round selesai (detik di-reset per round), dan berubah jadi `✎ <tool> · <n> kar` saat argumen tool mengalir. Jawaban >15 detik mengirim bel terminal.
- Bila model mengirim `reasoning_content`, isinya **tidak tampil saat berpikir** — spinner bawah normal (`Memikir… <detik>s`). Setelah selesai muncul blok ringkas `✻ berpikir · <detik>s` tepat sebelum jawaban, dengan jarak baris kosong di atas dan di bawahnya; klik membuka isi penuh (baris kosong + isi dim indent), klik lagi menutup. Blok dimatikan dengan `/thinking`.
- Isi reasoning lengkap dibuka dengan **klik** pada baris `✻ berpikir · <detik>s` (tanpa label tambahan); isinya muncul inline di bawah header, klik lagi menutup. Klik tanpa geser = toggle, drag tetap seleksi/copy.
- **Judul terminal** di-set `Beot · <persona>` (diperbarui saat Shift+Tab).
- Saat tool `skill` dipanggil, transkrip menampilkan baris `memuat skill ····· …` sebelum jawaban lanjut.
- **Cleanup di semua jalur keluar**: `/exit`, Ctrl+C 2× (saat prompt), SIGTERM, error tak tertangani → keluar alternate screen, keluar dari raw mode, tampilkan cursor. Tidak pernah ada kotak tertinggal. Saat bot menjawab, `Esc` = hentikan request (bukan keluar); `Ctrl+C` diabaikan. Saat popup/modal terbuka, `Esc` = batal; `Ctrl+C` diabaikan.
- **Resize terminal**: render ulang penuh dari buffer transkrip; tidak ada duplikasi/bekas frame.
- Scroll riwayat memakai **roda mouse atau PgUp/PgDn di dalam app** (buffer internal, bukan scrollback terminal).
- Emoji dan warna bergantung terminal; tema `mono` tersedia untuk terminal tanpa warna 256.

## 14. Keamanan

- API key hanya di `~/.beot/config.json` (permission 0600 bila didukung).
- Tidak ada server, telemetri, atau pengumpulan data oleh Beot.
- Isi pesan, persona, skill aktif, dan file aktif dikirim langsung ke provider yang dipilih pengguna saat chat.
- Tool file **tidak bisa** membaca/mencari/menulis: `.env*`, kredensial (`id_rsa`, `.npmrc`, `.netrc`, `.ssh/`, `.aws/`), folder `.git/`, dan seluruh `~/.beot/` (config, termasuk sisa `config.json.bak` dari versi lama). `grep_file`/`glob_file` memakai aturan yang sama, dan path di-resolve realpath (symlink/junction keluar ditolak).
- Escape ANSI/C1/OSC/DCS dari output model, isi file, nama model, dan clipboard dibuang sebelum tampil — isi asing tidak bisa menyuntik terminal.
- Tool loop dibatasi 16 langkah; regex `grep_file` dibatasi panjangnya dan pola kuantifier bersarang ditolak (cegah hang).
- Key diisi hanya lewat `/key` (tidak diminta otomatis saat startup) melalui modal input dan **disamarkan** (`•`) di layar.
- Jangan pakai di komputer bersama; jangan bagikan config.
- Key bocor → hapus di dashboard provider, buat baru.
- Konten persona/skill/file adalah input pengguna dan masuk ke system prompt; tidak ada sanitasi khusus.

## 15. Batas v0.1 (di luar lingkup)

- `.docx`, `.xlsx`, `.rtf`, dan `.pdf` hanya lewat tool export (bukan `write_file`); hasilnya sederhana: PDF tanpa gambar/styling, XLSX satu sheet, DOCX/RTF tanpa template.
- Tidak ada OCR untuk PDF scan/foto.
- Isi file dipotong ±50 kB / 50.000 karakter.
- Riwayat disimpan otomatis per sesi di `~/.beot/sessions/` (maks 50 file); riwayat di memori dipangkas saat perkiraan konteks >70%, dan `/compact` meringkas manual/otomatis.
- Agent: `list_dir`/`read_file`/`write_file`/`edit_file` + `grep_file`/`glob_file` + `bash` (izin + tolak-keras) + `web_fetch` (URL publik) + `todo_write` + `export_*` + `skill`. Tidak ada MCP/plugin/hooks/subagent.
- Tool loop maks **16 langkah** per pesan; jika habis, muncul peringatan dan konteks tetap disimpan (user bisa "lanjutkan").
- Panggilan tool **identik** (nama + argumen sama) tidak dieksekusi dua kali; pengulangan ke-3 menghentikan loop dengan `⚠ Model mengulang langkah yang sama — dihentikan.`. Catatan identik dalam satu round diringkas jadi baris buku besar `N× <note> ······ diulang`.
- Sandbox memakai **realpath**: symlink/junction yang mengarah keluar folder izin ditolak. Escape ANSI dari output model/isi file dibuang saat render (tidak bisa menyuntik perintah terminal).
- `web_fetch` membatasi diri ke URL publik: `localhost`, `127.*`, `10.*`, `192.168.*`, `172.16–31.*`, `169.254.*`, `::1`, dan `*.local` ditolak (SSRF), hanya `http(s)`, maks 1 MB, timeout 10 dtk. Default izin `ask`. Catatan: pemeriksaan berbasis nama host, bukan hasil DNS — DNS rebinding tidak ditangani (`shortcut:` di kode).
- Seleksi teks memakai implementasi app (drag → highlight → copy); bukan seleksi native terminal. Rotasi/geser window atau resize membersihkan seleksi.
- Satu folder kerja aktif per sesi (bisa `/cd`); lampiran satu per pesan. **Gambar** didukung (PNG/JPG via clipboard, maks 5 MB) dan hanya untuk model vision; audio tidak didukung.
- Tidak ada validasi key dan tidak ada tokenizer akurat; `/cost` memakai tabel harga publik (perkiraan, bukan tagihan). Timeout stream (default 90 dtk) + retry 1x dan pembatalan (Esc) tersedia.
- Tidak ada migrasi config antarversi selain migrasi sekali jalan dari `~/.byok-chat/` ke `~/.beot/` (§4).
- Tidak ada mode headless resmi; tema `mono` tersedia untuk terminal minim warna.
- Composer selalu tampil di bawah, termasuk saat bot mengetik jawaban; baris jawaban yang sedang streaming tampil di area chat di atasnya.
- Provider hanya OpenAI-compatible; tidak ada adapter OAuth/Anthropic/Copilot native.
- TUI memakai **alternate screen** (full-screen). Riwayat disimpan di buffer internal (bukan scrollback terminal); scroll dengan **roda mouse** atau **PgUp/PgDn**. Saat keluar, layar dibersihkan (transkrip tidak didump). Di terminal lama yang tidak mendukung ANSI bisa berantakan (pakai Windows Terminal).
- PgUp/PgDn dan roda mouse bekerja saat menunggu input maupun saat bot sedang menjawab; `Up`/`Down` bukan scroll (tetap riwayat input).
- Pencarian popup hanya substring case-insensitive (bukan fuzzy). Daftar panjang di-scroll mengikuti pilihan; tanpa mouse/scrollbar.
- Daftar model preferensi live dari provider (`GET /models`, cache 60 dtk); katalog statis hanya cadangan, dan model manual selalu tersedia.
- Picker tidak tersedia di mode non-TTY (dianggap batal).
- Menu mengasumsikan lebar terminal >= 80 kolom; di terminal lebih sempit baris palette bisa terpotong. Palette setinggi ±10 baris; di layar sangat pendek daftar digulir mengikuti pilihan.
- Lebar karakter dihitung dengan tabel statis (emoji, simbol, CJK); perhitungan **dibiarkan melebih** daripada kekurangan — baris bisa sedikit lebih pendek dari yang muat, tapi tidak pernah wrap yang menggeser layar. Karakter obscure di luar tabel bisa meleset 1 sel.

## 16. Self-test

`npm run selftest` menjalankan `selfcheck.js` tanpa API key dan tanpa jaringan. `npm test` menjalankan selfcheck **plus** `tests/chat-e2e.mjs`, `tests/confirm-e2e.mjs`, `tests/headless-e2e.mjs`, dan `tests/menu-e2e.mjs` (provider palsu + TUI disimulasikan lewat `tests/tui-run.cjs`). Exit code `1` bila ada yang gagal. CI (`.github/workflows/test.yml`) menjalankan `npm ci && npm test` di Ubuntu & Windows, Node 20 & 22.

Cek yang wajib lolos:

1. SSE: data terpotong antar-chunk disatukan.
2. SSE: baris rusak dilewati, baris valid tetap dipakai.
3. Persona bawaan: 2 file valid (`build`, `plan`), punya `nama`, `system_prompt`, `suhu` angka.
4. Skill: frontmatter ter-parse (`nama`, `isi`).
5. Skill: file tanpa metadata dilewati.
6. Skill: scan folder hanya mengambil file valid.
7. File: baca `.md`, isi dan `kind` benar.
8. File: isi lebih dari `MAX_CHARS` dipotong dan `truncated: true`.
9. File: membaca `.docx` ditolak dengan pesan yang menyebut docx; membuat `.docx` diuji lewat `export_docx`.
10. File: path tidak ada → error `tidak ditemukan`.
11. Config: `isLocal` benar untuk localhost dan false untuk provider publik.
12. Menu: filter perintah (`/` semua, `/sk` → `/skill`, tidak cocok → kosong, argumen menutup menu).
13. UI: lebar teks dihitung tanpa menghitung kode ANSI; emoji/simbol `Emoji_Presentation` (⭐✅⏳⌚), CJK, dan klaster `base+VS16` dihitung 2 sel; ZWJ/tanda gabung 0 — tidak boleh under-count (under-count → wrap → layar tergeser di terminal asli).
14. Editor TTY (disimulasikan): composer + status tampil, placeholder muncul saat input kosong, indikator scroll tampil saat digulir (PgUp/PgDn + roda mouse), drag mouse menyeleksi transkrip lalu auto-copy (OSC 52), Esc menghentikan jawaban, ketikan saat menjawab (typeahead) masuk ke prompt berikutnya, pesan user masuk transkrip sebagai blok latar gelap (tanpa bar kiri), tempel multi-baris tampil di composer dan terkirim utuh sebagai satu pesan, blok kode jawaban tampil bernomor dengan label bahasa, syntax highlight (keyword/string/angka/komentar/fungsi), dan baris diff hijau/merah, `/` mengganti composer dengan palette selebar layar (baris terpilih biru penuh, transkrip tetap tampil), panah + Enter menjalankan pilihan, Tab mengisi + spasi, Esc menutup palette dan palette tetap tertutup, panah atas memanggil riwayat, Shift+Tab memanggil ganti persona, Ctrl+D = EOF, prompt `secret` tidak masuk log, popup provider/model (panel tanpa bingkai: judul + esc, baris Cari, item aktif `●`, panah + Enter, Esc batal, overlay tertutup), modal input key (deskripsi + label/nilai tanpa kotak, disamarkan, Enter simpan, Esc batal).
15. Provider: katalog valid (id unik, base_url, model), `findProvider` mencocokkan base_url tanpa slash akhir.
16. Skill tool: katalog `skill(name)` valid; memuat isi skill dari folder; nama tak dikenal dan argumen JSON rusak menghasilkan error.
17. SSE: potongan `tool_calls` (id, nama fungsi, argumen) dirakit benar dari beberapa delta.
18. Highlight: keyword/string/angka/komentar/nama fungsi berwarna; lebar teks tidak berubah.
19. Theme: ganti palet mengubah warna, nama tak dikenal diabaikan, kembali ke default.
20. SSE: `finish_reason` terdeteksi sebagai akhir jawaban (walau `[DONE]` tidak dikirim).
21. Attach: gambar menghasilkan `content` array dengan `image_url` data URL; dokumen `.txt` menghasilkan teks ber-header `[DOKUMEN: nama]`; tanpa lampiran tetap string; estimasi token menghitung gambar.
22. Error: body HTML dibuang (tidak ditampilkan), pesan JSON diambil, teks polos dirapikan.
23. File tools: path di luar folder kerja ditolak; write hanya setelah konfirmasi; batal = tidak menulis; list_dir/read_file membaca folder sandbox; `extras`/`onOutside` mengizinkan path luar setelah persetujuan; diff +/- dan file baru dihitung benar, isi sama dilewati. Export: header/xref PDF valid, XLSX/DOCX adalah ZIP dengan part yang benar, RTF valid, batal/plan tidak menulis, ekstensi salah ditolak.
24. Tabel: bingkai + kolom rata +wrap sel panjang; pemisah antar baris = jumlah baris − 1; sel `**tebal**` ber-ANSI bold tanpa marker bocor; kolom angka rata kanan, teks rata kiri.
25. Daftar model: `mergeModels` menggabungkan aktif + live + statis tanpa duplikat, urutan tetap.
26. ANSI: CSI, OSC, C1 (0x7F–0x9F), dan DCS sampai ST dibuang dari teks model/file/nama.
27. File sensitif: `.env`, `.git/config`, dan `list_dir .git` diblokir; `grep_file` tidak membocorkan isi `.env` (eksplisit maupun walk); pola regex kuantifier bersarang ditolak tanpa hang.
28. PDF berurutan: dua PDF dibaca via `readDoc` tidak tertukar (bug buffer pool pdf-parse).
29. Default aman: `write_confirm: true`, `external: 'ask'`, `shell: 'ask'`; `hostChanged` mendeteksi ganti host (port/path tidak dihitung ganti host bila host sama).
30. `edit_file`: ganti potongan berhasil, `old_string` ambigu/tidak ada ditolak dengan pesan jelas, `replace_all` mengganti semua, file tidak ada diarahkan ke `write_file`.
31. Shell: pola destruktif ditolak (tidak bisa di-allow), menolak izin = tidak dijalankan, izin `allow` menghasilkan output, timeout mematikan proses.
32. Todo: validasi status/kosong, ringkasan `n/m` benar.
33. Sesi: JSONL dengan baris korup tetap terbaca, hanya `user`/`assistant` dimuat, `appendTurn` menambah pesan tanpa merusak baris terakhir.
34. Compact: input dipotong ke batas + penanda, hasil ringkasan = 1 pesan `[RINGKASAN…]`.
35. CLI: `--version` = `beot 0.1.0`, `--help` memuat flag dan tanpa escape ANSI.
36. Biaya: `priceFor` mengenali model yang ada di tabel, model asing = `null`; `costOf` menghitung 1M+1M = $0.5 untuk `gemini-2.0-flash`; `fmtUsd` tidak pernah menampilkan angka negatif.
37. Web: host privat ditolak, skema non-http ditolak, `htmlToText` membuang `script` dan mengubah entity.
38. Grep banyak file: hasil lengkap + event loop tetap berjalan (timer 0 ms sempat dieksekusi).
39. Baca file besar: teks dipotong ke `MAX_CHARS`, ukuran asli tetap dilaporkan, file tidak dimuat seluruhnya.
40. Tema kustom: `registerThemes` menerima palet sah, menolak nama bawaan, kunci asing, dan kode berisi escape; tema kustom bisa diaktifkan lewat `setTheme`.
41. Skill bertingkat: `loadSkillsFromMany` menggabungkan beberapa folder, nama sama → folder belakangan menang, file tanpa frontmatter dilewati.
42. Headless: `-p` mengembalikan hanya jawaban (tanpa ANSI/banner), `--output-format json` valid dengan `text/model/tokens/toolCalls`, prompt kosong → exit 2.
43. Memori: `appendMemory` idempoten, menolak teks kosong/>400 karakter; `memoryPrompt` memuat penanda `[MEMORI]`; `buildInitMemory` membaca `package.json` (nama + skrip tes).
44. Logo: `logoRows` menghasilkan 3 baris selebar 20; banner lebar memakai logo (5 baris), banner sempit tanpa logo (3 baris).
45. Tema: lima palet bawaan tersedia; `themeSwatch` menghasilkan 5 blok; `setTheme('nord')` memakai biru dingin.

## 17. Kriteria penerimaan v0.1

1. `npm test` → 46 cek `ok` + 4 E2E hijau, exit code 0.
2. Di mesin tanpa `~/.beot/config.json`, `node index.js` menampilkan banner 3 baris (wordmark + garis ganda + hint) dan composer tanpa meminta API key dan tanpa panggilan jaringan. Mengetik pesan chat hanya memberi peringatan; `/key` membuka picker provider.
3. `/bantu` menampilkan seluruh perintah.
4. Mengetik `/` mengganti composer dengan palette selebar layar (baris terpilih biru penuh); `↑`/`↓` memindahkan pilihan, `Tab` mengisi perintah + spasi, `Enter` menjalankan perintah terpilih. Setelah palette tertutup, composer kembali sebagai blok gelap dengan prompt biru dan status satu baris (`persona  folder  model` kiri, `ctx …` kanan).
5. `/key` → popup pilih provider → isi key → popup pilih model (atau ketik manual) → config berisi base_url/key/model yang dipilih. `/model` tanpa argumen membuka popup model.
6. `/exit` keluar dengan exit code 0.
7. Semua error provider/file tampil sebagai peringatan; tidak ada stack trace mentah ke pengguna.
8. Ctrl+O membuka file manager folder kerja; `📂 Ketik lokasi…` membuka path absolut/relatif; memilih file menampilkan `📄 nama — ukuran, kind` dan isinya masuk system prompt.
9. Model memanggil `write_file` → blok `▐ <path>  ubah/baru  +X −Y` + diff bernomor baris asli → default **tanya dulu** (`? Simpan <nama>?`; `Enter` menulis, `Esc` batal). `write_confirm: false` = langsung simpan. Isi sama = dilewati. Path di luar folder kerja → default `ask` (modal `Izinkan akses?`).
10. Model memanggil `export_pdf`/`export_xlsx`/`export_docx`/`export_rtf` → membuat file valid (PDF `%PDF-`, XLSX/DOCX bisa di-unzip); default `write_confirm: true` → prompt inline `? Simpan <nama>?` (Enter simpan, Esc batal). Di persona `plan`, tool tulis/export tidak tersedia dan runtime menolak.
11. `/cd <folder>` memindahkan folder kerja (tool + file manager ikut); `Beot <folder>` memulai di folder itu. Drag mouse di transkrip menyorot teks dan menyalinnya otomatis (OSC 52 + clipboard OS); roda mouse menggulir, `↑`/`↓` tetap riwayat input.
12. Stream timeout / koneksi putus (`terminated`) → teks parsial dibuang, `↻ ulang karena stream timeout…` / `↻ ulang karena koneksi terputus…` tampil, request diulang 1x; jika sukses, jawaban normal. Jika gagal lagi, `⚠` menampilkan pesan ramah (bukan `terminated` mentah). Jawaban kosong total diulang 1x, lalu `⚠ Provider tidak mengirim jawaban (kosong). Coba lagi.`; error di dalam SSE (`data: {"error":…}`) tampil sebagai pesan provider. Tool error tampil `⚠ <tool>: <pesan>`. Argumen tool yang dipecah antar-delta tetap dirakit dan dieksekusi.
13. Ctrl+C: bila ada seleksi → salin teks dan app tetap hidup; tanpa seleksi → tekan sekali menampilkan `Tekan Ctrl+C lagi untuk keluar.`, tekan kedua dalam 1,5 dtk keluar dengan exit code 0. Saat streaming atau popup/modal terbuka, Ctrl+C diabaikan; `Esc` yang menghentikan jawaban / membatalkan modal.
14. Identitas: system prompt memuat `[IDENTITAS]` (APP/MODEL/PEMBUAT); `/status` menampilkan `respons model` dari provider + peringatan bila beda config. Panggilan tool identik tidak dieksekusi dua kali dan pengulangan ke-3 menghentikan loop. `grep_file`/`glob_file` menemukan isi/nama file; `read_file` mendukung offset/limit; `.env*` dan config diblokir. Mengetik `@` membuka pemilih file dan isi file ikut ke pesan.
15. Thinking: provider mengirim `reasoning_content` → tidak dicetak saat berpikir (hanya spinner `Memikir…`), lalu muncul blok `✻ berpikir · <detik>s` sebelum jawaban dengan baris kosong di atas/bawah; klik baris membuka/menutup isi penuh inline; `/thinking` mematikan/menyalakan (tersimpan di config `thinking`); provider tanpa reasoning tidak menampilkan apa pun; durasi tidak pernah `0.0s` (fallback waktu request, minimum 0.1 dtk).
16. `npm test` menjalankan `tests/chat-e2e.mjs`: chat lewat provider palsu → `write_file` membuat file → diff + baris buku besar tampil → tabel dirender → escape ANSI dari model dibuang → exit code 0.
17. `/model base <url>` atau `/setting` → `base_url` ke host berbeda mengosongkan `api_key` dan mencetak peringatan; host sama (beda path/port) mempertahankan key. URL tanpa `http(s)://` ditolak.
18. `edit_file` mengganti potongan tanpa menulis ulang seluruh file; diff + konfirmasi sama seperti `write_file`.
19. `bash` meminta izin (default), menolak pola destruktif, output dikirim balik ke model; `shell: deny` menyembunyikan tool; `plan` selalu bertanya.
20. Sesi: mengirim pesan membuat `.jsonl` di `~/.beot/sessions`; `--continue` memuat sesi terakhir; `/compact` mengganti riwayat dengan satu pesan ringkasan; `/sessions` memuat sesi pilihan.
21. `/cost` menampilkan tarif model, biaya request terakhir, dan total sesi; model tanpa harga hanya menampilkan token. `web_fetch` menolak `127.0.0.1` dan `file://`, dan default `ask` sebelum mengunduh.
22. `beot -p "..."` mencetak jawaban saja (tanpa banner/ANSI) dan keluar; `--output-format json` menghasilkan JSON valid; tulis/shell/web ditolak di mode headless.
23. `/init` membuat `BEOT.md` (tidak menimpa tanpa `--force`); `/ingat` menambah baris idempoten; startup menampilkan `memori: …`; isi memori muncul di system prompt (`[MEMORI]`).
