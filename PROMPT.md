# Prompt untuk Claude Code

Buka folder repo ini di Claude Code, lalu tempel prompt di bawah.

---

Aku mau memasang bot Instagram comment-to-DM dari repo ini (baca `README.md` dulu).
Akun IG-ku: **@GANTI_USERNAME_KAMU**, email kontak: **GANTI_EMAIL_KAMU**.

Tolong pandu aku langkah demi langkah dan jalankan bagian teknisnya sendiri:
1. Cek Node.js dan Python 3. Jalankan `npm install` di `worker/`.
2. Bantu aku login Cloudflare (`npx wrangler login`), bikin KV namespace, dan isi `id` di `worker/wrangler.toml`.
3. Pandu aku bikin Meta app dan semua langkah di README (Langkah 1), tapi **aku yang klik dan login sendiri**. Jangan masukkan password. Jelaskan layar apa yang aku lihat dan tombol apa yang diklik.
4. Waktu aku menyalin token dan secret dari Meta, **jangan tampilkan nilainya di chat**. Simpan langsung ke `.env` (mis. dari clipboard) dan cukup konfirmasi panjangnya.
5. Siapkan halaman privacy policy dari `privacy-template.html` (isi username dan emailku), dan bantu aku host di GitHub Pages.
6. Jalankan `./setup_secrets.sh` dan `npx wrangler deploy`, lalu tes verifikasi webhook.
7. Bantu isi Callback URL di Meta, subscribe `comments`, lalu Publish app.
8. Setelah itu tambahkan aturan Reels pertamaku dengan `add_reel.py`. Aku akan tes sendiri dari akun lain.

Aturan main: konfirmasi dulu sebelum tindakan yang tidak bisa dibatalkan (publish, menyetujui izin, membuat repo publik). Jangan pernah membagikan atau meng-commit `.env`.

---
