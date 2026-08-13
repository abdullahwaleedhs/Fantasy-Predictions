import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const VAPID_PUBLIC_KEY = "BEdYBDu_uNJ9TMfX8vJWnCxtdrQqM1zR64kgBFIsDm4qkkEI36R-zn_Q1zpkfF7jZtfZcBteoOf6ooCA01b-ya4";
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
  const pkcs8 = Uint8Array.from(
    atob(VAPID_PRIVATE_KEY.replace(/-/g, "+").replace(/_/g, "/")),
    (c) => c.charCodeAt(0)
  );
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

// RFC 8291 compliant Web Push encryption
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
  const serverPublicKeyRaw = new Uint8Array(
    await crypto.subtle.exportKey("raw", serverKeyPair.publicKey)
  );
  const clientPublicKey = await crypto.subtle.importKey(
    "raw", p256dh, { name: "ECDH", namedCurve: "P-256" }, false, []
  );
  const sharedSecretBits = await crypto.subtle.deriveBits(
    { name: "ECDH", public: clientPublicKey }, serverKeyPair.privateKey, 256
  );
  const sharedSecret = new Uint8Array(sharedSecretBits);

  const salt = crypto.getRandomValues(new Uint8Array(16));

  // RFC 8291: PRK = HKDF-SHA-256(salt=auth, IKM=sharedSecret, info="WebPush: info\0" || clientPub || serverPub)
  const prkInfo = concat(
    new TextEncoder().encode("WebPush: info\x00"),
    p256dh,
    serverPublicKeyRaw
  );
  const ikmKey = await crypto.subtle.importKey("raw", sharedSecret, "HKDF", false, ["deriveBits"]);
  const prkBits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: authSecret, info: prkInfo },
    ikmKey, 256
  );
  const prk = new Uint8Array(prkBits);

  const prkKey = await crypto.subtle.importKey("raw", prk, "HKDF", false, ["deriveBits"]);

  // RFC 8291: CEK info = "Content-Encoding: aes128gcm\0\x01"
  const cekInfo = concat(
    new TextEncoder().encode("Content-Encoding: aes128gcm\x00"),
    new Uint8Array([1])
  );
  const cekBits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info: cekInfo },
    prkKey, 128
  );

  // RFC 8291: nonce info = "Content-Encoding: nonce\0\x01"
  const nonceInfo = concat(
    new TextEncoder().encode("Content-Encoding: nonce\x00"),
    new Uint8Array([1])
  );
  const nonceBits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info: nonceInfo },
    prkKey, 96
  );

  const aesKey = await crypto.subtle.importKey("raw", cekBits, "AES-GCM", false, ["encrypt"]);
  const nonce = new Uint8Array(nonceBits);

  const data = new TextEncoder().encode(plaintext);
  // padding delimiter byte = 0x02
  const padded = new Uint8Array(data.length + 1);
  padded.set(data);
  padded[data.length] = 2;

  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, padded)
  );

  // RFC 8188 header: salt(16) + rs(4) + idlen(1) + keyid(serverPub)
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);

  return concat(
    salt,
    rs,
    new Uint8Array([serverPublicKeyRaw.length]),
    serverPublicKeyRaw,
    encrypted
  );
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
  const windowStart = new Date(now.getTime() + 20 * 60 * 1000);
  const windowEnd = new Date(now.getTime() + 40 * 60 * 1000);
  console.log("now:", now.toISOString(), "window:", windowStart.toISOString(), "-", windowEnd.toISOString());

  const { data: matches, error: matchErr } = await supabase
    .from("matches")
    .select("id, home, away, match_date, match_time")
    .not("match_date", "is", null)
    .not("match_time", "is", null);

  if (matchErr) console.error("matches error:", matchErr.message);
  console.log("total matches:", matches?.length ?? 0);

  if (!matches?.length) return new Response("no matches", { status: 200 });

  const upcoming = matches.filter((m) => {
    const kickoff = new Date(`${m.match_date}T${m.match_time.slice(0,5)}:00+03:00`);
    console.log(`match ${m.home} vs ${m.away}: kickoff=${kickoff.toISOString()}`);
    return kickoff >= windowStart && kickoff <= windowEnd;
  });

  console.log("upcoming:", upcoming.length);
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

    console.log("subs:", subs?.length ?? 0, "predicted:", predictedUserIds.size);
    if (!subs?.length) continue;

    const targets = subs.filter((s: { user_id: string }) => !predictedUserIds.has(s.user_id));
    console.log("targets to notify:", targets.length);

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
        console.log("push status:", status, "for user:", sub.user_id);
        if (status === 410 || status === 404) {
          await supabase.from("push_subscriptions").delete().eq("user_id", sub.user_id);
        }
      } catch (e) { console.error("push error:", e); }
    }
  }

  return new Response("done", { status: 200 });
});
