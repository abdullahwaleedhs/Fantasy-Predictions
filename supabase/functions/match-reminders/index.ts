import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const VAPID_PUBLIC_KEY = "BDJ9w3tp08xuagz9B6-Mad-sRNELz6DydU44b07BqbmZjzjp9bQzYijMoKADBeGfeCA4OeEh6LcExrB4bKOQ7Yk";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = "mailto:abdullahwaleedhs@gmail.com";

async function buildVapidAuth(endpoint: string) {
  const url = new URL(endpoint);
  const audience = `${url.protocol}//${url.host}`;
  const now = Math.floor(Date.now() / 1000);
  const header = { typ: "JWT", alg: "ES256" };
  const payload = { aud: audience, exp: now + 3600, sub: VAPID_SUBJECT };
  const b64url = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  const signingInput = `${b64url(header)}.${b64url(payload)}`;
  const keyBytes = Uint8Array.from(
    atob(VAPID_PRIVATE_KEY.replace(/-/g, "+").replace(/_/g, "/")),
    (c) => c.charCodeAt(0)
  );
  const prefix = new Uint8Array([
    0x30,0x41,0x02,0x01,0x00,0x30,0x13,0x06,0x07,
    0x2a,0x86,0x48,0xce,0x3d,0x02,0x01,0x06,0x08,
    0x2a,0x86,0x48,0xce,0x3d,0x03,0x01,0x07,0x04,
    0x27,0x30,0x25,0x02,0x01,0x01,0x04,0x20,
  ]);
  const pkcs8 = new Uint8Array(prefix.length + keyBytes.length);
  pkcs8.set(prefix);
  pkcs8.set(keyBytes, prefix.length);
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    pkcs8.buffer,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    new TextEncoder().encode(signingInput)
  );
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  return `vapid t=${signingInput}.${sigB64},k=${VAPID_PUBLIC_KEY}`;
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}

async function encryptPayload(
  subscription: { keys: { p256dh: string; auth: string } },
  plaintext: string
): Promise<Uint8Array> {
  const p256dh = Uint8Array.from(
    atob(subscription.keys.p256dh.replace(/-/g, "+").replace(/_/g, "/")),
    (c) => c.charCodeAt(0)
  );
  const authSecret = Uint8Array.from(
    atob(subscription.keys.auth.replace(/-/g, "+").replace(/_/g, "/")),
    (c) => c.charCodeAt(0)
  );
  const serverKeyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]
  );
  const serverPublicKey = await crypto.subtle.exportKey("raw", serverKeyPair.publicKey);
  const clientPublicKey = await crypto.subtle.importKey(
    "raw", p256dh, { name: "ECDH", namedCurve: "P-256" }, false, []
  );
  const sharedSecret = await crypto.subtle.deriveBits(
    { name: "ECDH", public: clientPublicKey }, serverKeyPair.privateKey, 256
  );
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const ikm = await crypto.subtle.importKey("raw", sharedSecret, "HKDF", false, ["deriveBits"]);
  const prk = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: authSecret, info: new TextEncoder().encode("Content-Encoding: auth\0") },
    ikm, 256
  );
  const prkKey = await crypto.subtle.importKey("raw", prk, "HKDF", false, ["deriveBits"]);
  const serverPubArr = new Uint8Array(serverPublicKey);
  const cek = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info: concat(new TextEncoder().encode("Content-Encoding: aes128gcm\0"), new Uint8Array([0]), serverPubArr, p256dh) },
    prkKey, 128
  );
  const nonce = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info: concat(new TextEncoder().encode("Content-Encoding: nonce\0"), new Uint8Array([0]), serverPubArr, p256dh) },
    prkKey, 96
  );
  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const data = new TextEncoder().encode(plaintext);
  const padded = new Uint8Array(data.length + 1);
  padded.set(data);
  padded[data.length] = 2;
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, padded);
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  return concat(salt, rs, new Uint8Array([serverPubArr.length]), serverPubArr, new Uint8Array(encrypted));
}

async function sendPush(
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: Uint8Array
) {
  const auth = await buildVapidAuth(subscription.endpoint);
  const res = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      "Authorization": auth,
      "Content-Type": "application/octet-stream",
      "Content-Encoding": "aes128gcm",
      "TTL": "86400",
    },
    body: payload,
  });
  return res.status;
}

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const now = new Date();
  const windowStart = new Date(now.getTime() + 25 * 60 * 1000);
  const windowEnd = new Date(now.getTime() + 35 * 60 * 1000);

  const { data: matches } = await supabase
    .from("matches")
    .select("id, home, away, match_date, match_time")
    .not("match_date", "is", null)
    .not("match_time", "is", null);

  if (!matches?.length) return new Response("no matches", { status: 200 });

  const upcoming = matches.filter((m) => {
    const kickoff = new Date(`${m.match_date}T${m.match_time.slice(0,5)}:00+03:00`);
    return kickoff >= windowStart && kickoff <= windowEnd;
  });

  if (!upcoming.length) return new Response("no upcoming", { status: 200 });

  for (const match of upcoming) {
    const { data: preds } = await supabase
      .from("predictions")
      .select("user_id")
      .eq("match_id", match.id)
      .not("pred_home", "is", null)
      .not("pred_away", "is", null);

    const predictedUserIds = new Set((preds || []).map((p: { user_id: string }) => p.user_id));

    const { data: subs } = await supabase
      .from("push_subscriptions")
      .select("user_id, subscription");

    if (!subs?.length) continue;

    const targets = subs.filter((s: { user_id: string }) => !predictedUserIds.has(s.user_id));

    const payload = JSON.stringify({
      title: "⏰ باقي ٣٠ دقيقة!",
      body: `${match.home} vs ${match.away} — لم تتوقع بعد`,
      tag: `match-${match.id}`,
      url: "/",
    });

    for (const sub of targets) {
      try {
        const subscription = sub.subscription as { endpoint: string; keys: { p256dh: string; auth: string } };
        const encrypted = await encryptPayload(subscription, payload);
        const status = await sendPush(subscription, encrypted);
        if (status === 410 || status === 404) {
          await supabase.from("push_subscriptions").delete().eq("user_id", sub.user_id);
        }
      } catch (_) { /* skip */ }
    }
  }

  return new Response("done", { status: 200 });
});
