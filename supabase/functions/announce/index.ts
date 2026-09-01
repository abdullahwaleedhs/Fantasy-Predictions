import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as webpush from "jsr:@negrel/webpush@0.3";

const VAPID_SUBJECT = "mailto:abdullahwaleedhs@gmail.com";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Broadcast (or targeted) push notification. Body:
//   { title, body, url?, user_id? }
// If user_id is given, sends only to that user; otherwise to everyone.
// Only an admin (profiles.is_admin) may call this.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const rawVapid = Deno.env.get("VAPID_KEYS");
  if (!rawVapid) return new Response("missing VAPID_KEYS", { status: 500, headers: cors });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Verify the caller is a logged-in admin.
  const jwt = req.headers.get("Authorization")?.replace("Bearer ", "");
  if (!jwt) return new Response("unauthorized", { status: 401, headers: cors });
  const { data: userData } = await supabase.auth.getUser(jwt);
  const callerId = userData?.user?.id;
  if (!callerId) return new Response("unauthorized", { status: 401, headers: cors });
  const { data: caller } = await supabase.from("profiles").select("is_admin").eq("id", callerId).single();
  if (!caller?.is_admin) return new Response("forbidden", { status: 403, headers: cors });

  let appServer;
  try {
    const vapidKeys = await webpush.importVapidKeys(JSON.parse(rawVapid), { extractable: false });
    appServer = await webpush.ApplicationServer.new({ contactInformation: VAPID_SUBJECT, vapidKeys });
  } catch (e) {
    console.error("bad VAPID_KEYS", e);
    return new Response("bad VAPID_KEYS", { status: 500, headers: cors });
  }

  let input: { title?: string; body?: string; url?: string; user_id?: string } = {};
  try { input = await req.json(); } catch { /* defaults */ }

  const payload = JSON.stringify({
    title: input.title || "توقع المباريات",
    body: input.body || "",
    tag: `announce-${Date.now()}`,
    url: input.url || "/",
  });

  let query = supabase.from("push_subscriptions").select("user_id, subscription");
  if (input.user_id) query = query.eq("user_id", input.user_id);
  const { data: subs } = await query;
  console.log("targets:", subs?.length ?? 0, input.user_id ? `(user ${input.user_id})` : "(all)");
  if (!subs?.length) return new Response(JSON.stringify({ subscribers: 0, sent: 0 }), { status: 200, headers: cors });

  let sent = 0;
  for (const sub of subs) {
    try {
      await appServer.subscribe(sub.subscription as PushSubscriptionJSON).pushTextMessage(payload, {});
      sent++;
    } catch (e) {
      const msg = String(e);
      if (msg.includes("410") || msg.includes("404")) {
        await supabase.from("push_subscriptions").delete().eq("user_id", sub.user_id);
      }
      console.error("push error", sub.user_id, msg);
    }
  }
  return new Response(JSON.stringify({ subscribers: subs.length, sent }), { status: 200, headers: cors });
});
