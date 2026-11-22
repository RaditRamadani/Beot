# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/id/1.1.0/), versi [SemVer](https://semver.org/lang/id/).

## [0.1.0] - 2026-11-22

Rilis pertama.

### Ada
- Chat terminal BYOK: provider OpenAI-compatible (Gemini, Groq, OpenRouter, OpenAI, Ollama, custom), daftar model live.
- Agent: baca/tulis/edit file, grep/glob, bash dengan izin + tolak-keras, web_fetch (publik saja), todo, ekspor PDF/XLSX/DOCX/RTF, skill.
- Sesi tersimpan (`--continue`, `/sessions`), `/compact`, memori `BEOT.md` (`/init`, `/ingat`).
- UI splash + panel popup, tabel rapi, tema bawaan + kustom, `/status`, `/cost`.
- Headless `-p` (teks/JSON), mode pipe bersih tanpa ANSI.
- Keamanan: sandbox realpath, blokir kredensial, SSRF + DNS pinning, env shell bersih, izin memori repo.
- 48 cek + 7 E2E, CI Windows/Linux (Node 20/22).

### Belum ada
- MCP, plugin, hooks, subagent, auto-update.
