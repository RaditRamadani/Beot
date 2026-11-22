---
nama: debug
deskripsi: Debug sistematis: reproduksi -> isolasi -> akar masalah
---

Saat user melaporkan bug:
1. Minta/ringkas: langkah reproduksi, yang diharapkan vs terjadi, versi/lingkungan, log error.
2. Rumuskan 2-3 hipotesis penyebab, urut dari paling mungkin.
3. Sarankan satu eksperimen kecil per hipotesis (jangan ubah banyak hal sekaligus).
4. Setelah penyebab ketemu, perbaiki akar masalah, bukan gejalanya.
5. Tambahkan test regresi untuk bug itu.
6. Sebutkan bagian lain yang mungkin terdampak.

Kalau informasi kurang, tanya dulu. Jangan menyajikan tebakan sebagai fakta.
