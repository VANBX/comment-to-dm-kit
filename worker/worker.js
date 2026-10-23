import bundled from "./config.json";

const API = "https://graph.instagram.com/v21.0";

const DEFAULT_GATE = {
  gate_text: "Halo @{username}! Follow akun ini dulu ya, terus tap tombol di bawah buat dapet yang kamu minta 👇",
  button_label: "Kirim link-nya", // maks 20 karakter
  not_following_text: "Eist, follow dulu dong 😅 Kalau udah, tap tombol di bawah ya 👇",
  recheck_label: "Udah follow", // maks 20 karakter
  fallback_text: "Halo @{username}! Follow akun ini dulu ya, terus balas pesan ini dengan kata KIRIM biar aku kirim yang kamu minta.",
  error_text: "Lagi ada gangguan ngecek follow, coba tap tombolnya lagi sebentar lagi ya 🙏",
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "GET") {
      const p = url.searchParams;
      if (p.get("hub.mode") === "subscribe" && p.get("hub.verify_token") === env.VERIFY_TOKEN) {
        return new Response(p.get("hub.challenge"));
      }
      return url.pathname === "/" ? new Response("ok") : new Response("forbidden", { status: 403 });
    }
    if (request.method !== "POST") return new Response("method not allowed", { status: 405 });

    const raw = await request.text();
    if (!(await validSignature(raw, request.headers.get("X-Hub-Signature-256"), env.APP_SECRET))) {
      return new Response("bad signature", { status: 403 });
    }
    let data;
    try { data = JSON.parse(raw); } catch { return new Response("ok"); }
    for (const entry of data.entry || []) {
      for (const ch of entry.changes || []) {
        if (ch.field === "comments") ctx.waitUntil(handleComment(ch.value, env));
      }
      for (const m of entry.messaging || []) {
        ctx.waitUntil(handleMessage(m, env));
      }
    }
    return new Response("EVENT_RECEIVED");
  },
};

async function validSignature(raw, header, secret) {
  if (!secret) return true;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return header === `sha256=${hex}`;
}

async function loadConfig(env) {
  const stored = await env.STORE.get("config");
  return stored ? JSON.parse(stored) : bundled;
}

// Aturan hanya berlaku di postingan yang di-set (media_id wajib), sisanya diabaikan.
// Mengembalikan { rule, kw } (kw = kata yang cocok), atau null.
function matchRule(cfg, text, mediaId) {
  const t = text.toLowerCase();
  for (const rule of cfg.rules) {
    if (!rule.media_id || rule.media_id !== mediaId) continue;
    for (const kw of rule.keywords) {
      const esc = kw.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`(?<![\\p{L}\\p{N}_])${esc}(?![\\p{L}\\p{N}_])`, "u").test(t)) {
        return { rule, kw: kw.toLowerCase() };
      }
    }
  }
  return null;
}

function findRule(cfg, mediaId, kw) {
  return cfg.rules.find((r) => r.media_id === mediaId && r.keywords.some((k) => k.toLowerCase() === kw));
}

const gateTexts = (cfg, rule) => ({ ...DEFAULT_GATE, ...(cfg.follow_gate || {}), ...(rule.follow_gate || {}) });
const fill = (s, username) => s.replaceAll("{username}", username || "");
const log = (o) => console.log(JSON.stringify(o));

async function graphPost(env, path, body) {
  const res = await fetch(`${env.GRAPH_BASE || API}/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return [res.status, await res.json().catch(() => ({}))];
}

async function graphGet(env, path) {
  const res = await fetch(`${env.GRAPH_BASE || API}/${path}`, {
    headers: { Authorization: `Bearer ${env.ACCESS_TOKEN}` },
  });
  return [res.status, await res.json().catch(() => ({}))];
}

// --- bentuk pesan ---
const buttonTemplate = (text, buttons) => ({
  attachment: { type: "template", payload: { template_type: "button", text, buttons } },
});
const postbackButton = (title, payload) => ({ type: "postback", title, payload });
const urlButton = (title, url) => ({ type: "web_url", url, title });

const sendMsg = (env, recipient, message) =>
  graphPost(env, `${env.IG_USER_ID}/messages`, { recipient, message });

// Pesan dengan satu tombol balasan. Urutan percobaan: tombol di bubble (template) ->
// quick reply -> teks biasa. Mengembalikan [status, res, mode].
async function sendInteractive(env, recipient, text, label, payload, fallbackText) {
  let r = await sendMsg(env, recipient, buttonTemplate(text, [postbackButton(label, payload)]));
  if (r[0] === 200) return [...r, "template"];
  r = await sendMsg(env, recipient, {
    text, quick_replies: [{ content_type: "text", title: label, payload }],
  });
  if (r[0] === 200) return [...r, "quick_reply"];
  r = await sendMsg(env, recipient, { text: fallbackText });
  return [...r, "text"];
}

// Isi DM dari aturan. Kalau ada button_url: tombol link di bubble (fallback: link di teks).
async function sendRuleDm(env, recipient, rule, username) {
  const text = fill(rule.dm, username);
  if (rule.button_url) {
    const title = rule.button_title || "Buka link";
    const r = await sendMsg(env, recipient, buttonTemplate(text || title, [urlButton(title, rule.button_url)]));
    if (r[0] === 200) return [...r, "template"];
    const r2 = await sendMsg(env, recipient, { text: `${text}\n${rule.button_url}`.trim() });
    return [...r2, "text"];
  }
  const r = await sendMsg(env, recipient, { text });
  return [...r, "text"];
}

async function handleComment(v, env) {
  const cid = v.id;
  const user = v.from || {};
  if (!cid) return;
  if (env.IG_USER_ID && user.id === env.IG_USER_ID) return; // komen sendiri
  if (await env.STORE.get(`seen:${cid}`)) return;

  const cfg = await loadConfig(env);
  const hit = matchRule(cfg, v.text || "", v.media && v.media.id);
  if (!hit) return;
  const { rule, kw } = hit;
  await env.STORE.put(`seen:${cid}`, "1", { expirationTtl: 8 * 86400 });

  if (rule.require_follow) {
    await sendGate(env, cfg, rule, kw, cid, user);
  } else {
    if (!env.ACCESS_TOKEN) {
      return log({ event: "dry_run_dm", comment_id: cid, user: user.username, dm: fill(rule.dm, user.username) });
    }
    const [st, res, mode] = await sendRuleDm(env, { comment_id: cid }, rule, user.username);
    log({ event: "dm", mode, status: st, comment_id: cid, user: user.username, res });
    if (st !== 200) return;
  }

  const reply = rule.public_reply || cfg.public_reply;
  if (reply && env.ACCESS_TOKEN) {
    const [st2, res2] = await graphPost(env, `${cid}/replies`, { message: reply });
    log({ event: "public_reply", status: st2, comment_id: cid, res: res2 });
  }
}

// DM pertama untuk aturan require_follow: teks + tombol (fallback: teks "balas KIRIM")
async function sendGate(env, cfg, rule, kw, cid, user) {
  const g = gateTexts(cfg, rule);
  const payload = `g|${rule.media_id}|${kw}`;
  if (!env.ACCESS_TOKEN) {
    return log({ event: "dry_run_gate", comment_id: cid, user: user.username, text: fill(g.gate_text, user.username) });
  }
  const [st, res, mode] = await sendInteractive(env, { comment_id: cid },
    fill(g.gate_text, user.username), g.button_label, payload, fill(g.fallback_text, user.username));
  log({ event: "gate", mode, status: st, comment_id: cid, user: user.username, res });
  if (st === 200) {
    const rid = res.recipient_id || user.id;
    await env.STORE.put(`gate:${rid}`, JSON.stringify({ media_id: rule.media_id, kw }), { expirationTtl: 7 * 86400 });
  }
}

// Orang membalas (tap tombol / quick reply / ketik) -> cek follow -> kirim isi DM atau minta follow
async function handleMessage(m, env) {
  const sender = m.sender && m.sender.id;
  // tap tombol template datang sebagai "postback", quick reply sebagai "message"
  const msg = m.message || (m.postback && { mid: m.postback.mid, quick_reply: { payload: m.postback.payload } });
  if (!sender || !msg || msg.is_echo || sender === env.IG_USER_ID) return;
  if (msg.mid) {
    if (await env.STORE.get(`mid:${msg.mid}`)) return;
    await env.STORE.put(`mid:${msg.mid}`, "1", { expirationTtl: 86400 });
  }

  let target = null;
  const qp = msg.quick_reply && msg.quick_reply.payload;
  if (qp && qp.startsWith("g|")) {
    const [, media, ...kw] = qp.split("|");
    target = { media_id: media, kw: kw.join("|") };
  } else {
    const pend = await env.STORE.get(`gate:${sender}`);
    if (pend) target = JSON.parse(pend);
  }
  if (!target) return;

  const cfg = await loadConfig(env);
  const rule = findRule(cfg, target.media_id, target.kw);
  if (!rule || !rule.require_follow) return;
  const g = gateTexts(cfg, rule);
  const payload = `g|${target.media_id}|${target.kw}`;
  if (!env.ACCESS_TOKEN) return log({ event: "dry_run_gate_reply", sender, kw: target.kw });

  const [pst, prof] = await graphGet(env, `${sender}?fields=username,is_user_follow_business`);
  if (pst !== 200 || typeof prof.is_user_follow_business !== "boolean") {
    log({ event: "follow_check_error", status: pst, sender, res: prof });
    const [st, res, mode] = await sendInteractive(env, { id: sender }, g.error_text, g.recheck_label, payload, g.error_text);
    return log({ event: "error_reply", mode, status: st, res });
  }
  if (!prof.is_user_follow_business) {
    const [st, res, mode] = await sendInteractive(env, { id: sender }, g.not_following_text, g.recheck_label, payload, g.not_following_text);
    return log({ event: "not_following", mode, status: st, sender, user: prof.username, res });
  }

  const sentKey = `sent:${sender}:${target.media_id}:${target.kw}`;
  if (await env.STORE.get(sentKey)) return;
  const [st, res, mode] = await sendRuleDm(env, { id: sender }, rule, prof.username);
  log({ event: "dm_after_follow", mode, status: st, sender, user: prof.username, res });
  if (st === 200) {
    await env.STORE.put(sentKey, "1", { expirationTtl: 8 * 86400 });
    await env.STORE.delete(`gate:${sender}`);
  }
}
