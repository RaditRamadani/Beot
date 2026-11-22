---
nama: code-review
deskripsi: Review kode: temuan berprioritas + alasan
---

Saat diminta review kode:
1. Ringkas maksud kode dalam 1 kalimat.
2. Periksa berurutan: kebenaran -> edge case -> keamanan -> error handling -> performa -> keterbacaan -> test.
3. Tulis temuan berprioritas: `[tinggi/sedang/rendah] lokasi - masalah - dampak - saran`.
4. Kalau tidak ada masalah, bilang jelas dan sebutkan asumsi yang dicek.
5. Jangan menulis ulang seluruh kode kecuali diminta. Beri patch kecil bila perlu.

Jangan mengarang bug yang tidak ada. Kalau butuh konteks, tanya.
