#!/usr/bin/env bash
# Kirim isi .env ke Cloudflare Worker sebagai secret (nilainya tidak ditampilkan)
set -e
cd "$(dirname "$0")/worker"
for K in ACCESS_TOKEN IG_USER_ID VERIFY_TOKEN APP_SECRET; do
  V=$(grep "^$K=" ../.env | cut -d= -f2-)
  [ -n "$V" ] && printf '%s' "$V" | npx wrangler secret put "$K" || echo "$K kosong di .env, dilewati"
done
