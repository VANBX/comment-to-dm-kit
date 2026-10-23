import bundled from "./config.json";

const API = "https://graph.instagram.com/v21.0";

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

function matchRule(cfg, text, mediaId) {
  const t = text.toLowerCase();
  // aturan hanya berlaku di postingan yang di-set (media_id wajib), sisanya diabaikan
  for (const rule of cfg.rules) {
    if (!rule.media_id || rule.media_id !== mediaId) continue;
    for (const kw of rule.keywords) {
      const esc = kw.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`(?<![\\p{L}\\p{N}_])${esc}(?![\\p{L}\\p{N}_])`, "u").test(t)) return rule;
    }
  }
  return null;
}

async function graphPost(env, path, body) {
  const res = await fetch(`${API}/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return [res.status, await res.json().catch(() => ({}))];
}

async function handleComment(v, env) {
  const cid = v.id;
  const user = v.from || {};
  if (!cid) return;
  if (env.IG_USER_ID && user.id === env.IG_USER_ID) return; // komen sendiri
  if (await env.STORE.get(`seen:${cid}`)) return;

  const stored = await env.STORE.get("config");
  const cfg = stored ? JSON.parse(stored) : bundled;
  const rule = matchRule(cfg, v.text || "", v.media && v.media.id);
  if (!rule) return;
  await env.STORE.put(`seen:${cid}`, "1", { expirationTtl: 8 * 86400 });

  const dm = rule.dm.replaceAll("{username}", user.username || "");
  if (!env.ACCESS_TOKEN) {
    console.log(JSON.stringify({ event: "dry_run_dm", comment_id: cid, user: user.username, dm }));
    return;
  }
  const [st, res] = await graphPost(env, `${env.IG_USER_ID}/messages`,
    { recipient: { comment_id: cid }, message: { text: dm } });
  console.log(JSON.stringify({ event: "dm", status: st, comment_id: cid, user: user.username, res }));
  const reply = rule.public_reply || cfg.public_reply;
  if (reply && st === 200) {
    const [st2, res2] = await graphPost(env, `${cid}/replies`, { message: reply });
    console.log(JSON.stringify({ event: "public_reply", status: st2, comment_id: cid, res: res2 }));
  }
}
