# Kontribusi

Terima kasih sudah mampir. Beot sengaja kecil: **satu proses, nol framework, satu dependensi**. Itu yang dijaga.

## Jalankan

```sh
npm install
npm test        # 47 cek + 4 E2E, tanpa API key dan tanpa jaringan
npm start       # coba manual
```

Butuh Node 20+. Untuk mencoba chat tanpa API key: `/model base http://localhost:11434/v1` (Ollama).

## Aturan yang tidak dinegosiasikan

1. **Jangan menambah dependensi runtime** untuk hal yang bisa ditulis < 150 baris (ZIP, PDF, tabel, diff, highlight sudah ditulis manual). Bila terpaksa, jelaskan alasannya di PR.
2. **Jangan menambah MCP/plugin/hooks/server.** Beot adalah satu proses yang bisa dibaca dalam satu malam.
3. Satu fitur = satu file `lib/*.js` baru, target < 400 baris. Kalau lebih, pecah.
4. Setiap perilaku baru wajib: **tes** (`selfcheck.js` atau `tests/`), lalu `README.md` + `beot-spec.md` disinkronkan.
5. Semua keluaran asing (model, file, nama host, clipboard) harus lewat `stripEsc` sebelum dirender.
6. Izin selalu default **tanya dulu**. Fitur baru yang bisa mengubah/mengirim data tidak boleh default `allow`.

## Peta kode

| File | Isi |
|---|---|
| `index.js` | REPL, perintah, loop chat + tool |
| `lib/tui.js` | render frame, composer, popup, diff, tabel, mouse |
| `lib/llm.js` | HTTP + parser SSE |
| `lib/filetools.js` | baca/tulis/edit/cari + sandbox |
| `lib/shell.js` | `bash` + izin + tolak-keras |
| `lib/web.js` | `web_fetch` + guard SSRF |
| `lib/exporttool.js` | PDF/XLSX/DOCX/RTF tanpa dependensi |
| `lib/session.js`, `lib/compact.js` | sesi JSONL, ringkas riwayat |
| `lib/todo.js`, `lib/cost.js` | todo panel, harga |
| `ui/theme.js` | palet + tema kustom |

## Menambah skill

Taruh `.md` di salah satu tempat (prioritas naik):

1. `skills-bawaan/` (ikut paket)
2. `~/.beot/skills/` (pribadi)
3. `<folder-kerja>/.beot/skills/` (per proyek, boleh di-commit)

Format:

```markdown
---
nama: nama-skill
deskripsi: satu kalimat kapan dipakai
---

Instruksi lengkap untuk model.
```

Cek dengan `/skill` lalu `npm test`.

## Menambah tema

`~/.beot/themes.json`:

```json
{ "senja": { "gold": "38;5;214", "lav": "38;5;180" } }
```

Hanya kode SGR (`angka;angka`). Nama `default`/`nord`/`senja`/`mono`/`kontras` tidak bisa ditimpa.

## Menambah persona

File JSON di `personas/`:

```json
{ "nama": "reviewer", "deskripsi": "fokus koreksi", "suhu": 0.4, "system_prompt": "..." }
```

## Sebelum kirim PR

- [ ] `npm test` hijau
- [ ] Tidak ada kunci API / path pribadi di diff
- [ ] `README.md` dan `beot-spec.md` ikut diperbarui
- [ ] Perubahan kecil dan satu tujuan per PR

Pertanyaan/ide: buka issue dulu, jelaskan masalahnya sebelum solusinya.
