# Instagram Comment-to-DM (gratis, 24 jam, tanpa server sendiri)

Viewer comment kata tertentu di Reels kamu, otomatis dapat DM (link, prompt, dll).
Jalan di **Cloudflare Workers** (gratis, tanpa kartu kredit) dan **Instagram API** resmi dari Meta (gratis).

- Aturan **per Reels**: tiap Reels punya kata trigger dan isi DM sendiri.
- Comment di Reels lain **diabaikan**.
- Huruf besar/kecil tidak berpengaruh (`mantap` = `Mantap` = `MANTAP`), tapi harus kata utuh.
- Bot juga membalas comment secara publik (default: "cek DM!").
- **Opsional per aturan: wajib follow dulu** (lihat bagian "Wajib follow" di bawah).

> Cara tercepat: buka folder ini di **Claude Code** dan tempel isi [`PROMPT.md`](PROMPT.md). Claude akan memandu dan menjalankan langkah teknisnya. Langkah login dan persetujuan izin tetap kamu sendiri yang klik.

## Yang kamu butuhkan
- Akun Instagram **Professional** (Creator atau Business). Ubah di IG: Settings → Account type and tools.
- Akun Facebook (untuk Meta for Developers) dan akun Cloudflare (gratis).
- Node.js dan Python 3 di komputer.
- Satu halaman **Privacy Policy** online (template ada di `privacy-template.html`, bisa di-host gratis di GitHub Pages).

## Langkah 1: Bikin Meta app
1. Buka https://developers.facebook.com/apps → **Create App**.
2. Isi nama app dan email. Di use case pilih **Manage messaging & content on Instagram**. Business portfolio boleh "I don't want to connect yet".
3. Masuk **Use cases → Customize → API setup with Instagram login**.
4. Step 1: klik **Add all required permissions** (basic, manage_comments, manage_messages).
5. **App roles → Roles → Add People → Instagram Tester**, masukkan username IG kamu. Lalu di Instagram buka `instagram.com/accounts/manage_access/` → tab **Tester Invites** → **Accept**.
6. Step 2: klik **Generate token** untuk akunmu. Di layar izin, nyalakan cuma: profile/media, **manage comments**, **manage messages** (matikan publish dan insights). Token cuma ditampilkan **sekali**, salin langsung.
7. Catat juga **IG User ID** (tertera di tabel step 2) dan **Instagram app secret** (tombol Show di bagian atas halaman).

Salin `.env.example` jadi `.env` dan isi `ACCESS_TOKEN`, `IG_USER_ID`, `APP_SECRET`, dan `VERIFY_TOKEN` (string acak bebas, mis. `openssl rand -hex 16`). **Jangan pernah membagikan atau meng-commit `.env`.**

## Langkah 2: Deploy ke Cloudflare
```bash
cd worker && npm install
npx wrangler login                       # login Cloudflare di browser
npx wrangler kv namespace create STORE   # salin id yang muncul ke wrangler.toml
cd ..
cp config.example.json worker/config.json
./setup_secrets.sh                       # kirim isi .env sebagai secret
cd worker && npx wrangler deploy
```
Kalau diminta, daftarkan subdomain `workers.dev` (satu kali). URL bot kamu: `https://comment-to-dm.<subdomain>.workers.dev/`.

## Langkah 3: Sambungkan webhook ke Meta
1. Di halaman API setup, step 3: isi **Callback URL** = URL Worker kamu, **Verify token** = `VERIFY_TOKEN` di `.env`, lalu **Verify and save**.
2. Di tabel **Webhook fields**, pastikan `comments` = Subscribed.
3. Di step 2, nyalakan toggle **Webhook Subscription** untuk akunmu.

## Langkah 4: Publish app
Meta hanya mengirim webhook kalau app berstatus **Published**.
1. **App settings → Basic**: isi **Privacy policy URL**, **User data deletion** (boleh pakai URL privacy policy yang sama, asal ada bagian hapus data), dan **Category** (mis. Messaging). Simpan.
2. Menu **Publish** → klik **Publish**.

## Pakai: tambah aturan per Reels
```bash
python3 add_reel.py "https://www.instagram.com/reel/XXXX/" "mantap=Thank you" "link,mau=Ini link-nya: https://..."
```
- Beberapa kata trigger dalam satu aturan dipisah koma.
- Menjalankan ulang untuk Reels yang sama **mengganti** aturan lama Reels itu.
- Aturan langsung aktif, tidak perlu deploy ulang.
- `{username}` di isi DM otomatis diganti username pengomen.
- Ganti balasan publik: edit `public_reply` di `config.json`, lalu jalankan `add_reel.py` sekali lagi.

## Tombol link dan wajib follow (opsional per aturan)
**Tombol link** (`--button`): link pertama di isi DM dijadikan tombol di dalam bubble, mirip "Click The Link".
```bash
python3 add_reel.py "https://www.instagram.com/reel/XXXX/" --button="Click The Link" "panduan=Nih panduannya, gratis 👇 https://contoh.com/guide"
```

**Wajib follow** (`--follow`): orang harus follow dulu sebelum dapat isi DM.
```bash
python3 add_reel.py "https://www.instagram.com/reel/XXXX/" --follow --button="Click The Link" "member=Nih panduannya, gratis 👇 https://contoh.com/guide"
```
Alurnya:
1. Orang comment kata trigger → DM pertama berisi teks dan tombol **"Kirim link-nya"**.
2. Orang tap tombol → bot cek `is_user_follow_business` lewat Instagram API.
3. Sudah follow → isi DM (dengan tombol link) dikirim. Belum follow → "Eist, follow dulu dong 😅" dan tombol **"Udah follow"**. Tap lagi → dicek ulang, lalu dikirim kalau sudah follow.
4. Tap berulang tidak mengirim DM dobel.

Rantai fallback (otomatis), karena Meta resminya hanya mendokumentasikan teks untuk DM pertama:
- Tombol di bubble (template) → kalau ditolak, **quick reply** → kalau ditolak lagi, **teks** "balas dengan kata KIRIM". Pesan akhir dengan tombol link yang ditolak jadi teks berisi link.

Hal yang perlu kamu tahu:
- Cek follow baru diizinkan Meta **setelah orang membalas** DM kamu (tap tombol atau mengetik).
- Orang yang belum follow menerima DM di **Message Requests**; tampilan tombol di folder itu belum tentu sama. Tes pakai akun yang benar-benar belum follow.
- Field webhook `messages` dan `messaging_postbacks` harus **Subscribed** (biasanya sudah otomatis).
- Ubah teks lewat `follow_gate` di `config.json`: `gate_text`, `button_label` (maks 20 karakter), `not_following_text`, `recheck_label` (maks 20), `fallback_text`, `error_text`. Bisa global atau per aturan.

## Batasan dan hal penting
- **1 comment = 1 DM**, dan harus dalam 7 hari sejak comment.
- DM dari akun yang belum follow biasanya masuk ke **Message Requests**.
- Comment dari akunmu sendiri sengaja diabaikan.
- **Izin belum lewat App Review.** Untuk akunmu sendiri biasanya jalan. Untuk pemakaian lebih luas, Meta bisa meminta App Review.
- **Token berlaku 60 hari.** Sebelum habis: Generate token baru di Meta, tulis ke `.env`, lalu `cd worker && npx wrangler secret put ACCESS_TOKEN`. Pasang pengingat di kalender.
- Gunakan sewajarnya dan sesuai kebijakan Instagram/Meta. Jangan spam.

## Lihat log / debug
```bash
cd worker && npx wrangler tail     # log langsung saat ada comment masuk
```
