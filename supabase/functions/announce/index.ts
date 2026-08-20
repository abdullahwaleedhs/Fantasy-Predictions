import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as webpush from "jsr:@negrel/webpush@0.3";

const VAPID_SUBJECT = "mailto:abdullahwaleedhs@gmail.com";

// One-off broadcast: sends a push notification to every stored subscription.
// Invoke from the Supabase dashboard (Functions → announce → Send request)
// with a JSON body: { "title": "...", "body": "...", "url": "/#championships" }
Deno.serve(async (req) => {
  const rawVapid = Deno.env.get("VAPID_KEYS");
  if (!rawVapid) return new Response("missing VAPID_KEYS", { status: 500 });

  let appServer;
  try {
    const vapidKeys = await webpush.importVapidKeys(JSON.parse(rawVapid), { extractable: false });
    appServer = await webpush.ApplicationServer.new({ contactInformation: VAPID_SUBJECT, vapidKeys });
  } catch (e) {
    console.error("bad VAPID_KEYS", e);
    return new Response("bad VAPID_KEYS", { status: 500 });
  }

  let payloadIn: { title?: string; body?: string; url?: string } = {};
  try { payloadIn = await req.json(); } catch { /* use defaults */ }

  const payload = JSON.stringify({
    title: payloadIn.title || "🏆 قسم جديد: البطولات",
    body: payloadIn.body || "توقّع ترتيب الدوريات وأبطال الكؤوس — اختياري ومنفصل عن نقاط المباريات",
    tag: "announce-championships",
    url: payloadIn.url || "/#championships",
  });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { data: subs } = await supabase.from("push_subscriptions").select("user_id, subscription");
  console.log("subscribers:", subs?.length ?? 0);
  if (!subs?.length) return new Response("no subscribers", { status: 200 });

  let sent = 0;
  for (const sub of subs) {
    try {
      const subscription = sub.subscription as PushSubscriptionJSON;
      await appServer.subscribe(subscription).pushTextMessage(payload, {});
      sent++;
    } catch (e) {
      const msg = String(e);
      if (msg.includes("410") || msg.includes("404")) {
        await supabase.from("push_subscriptions").delete().eq("user_id", sub.user_id);
      }
      console.error("push error for", sub.user_id, msg);
    }
  }

  console.log("sent:", sent);
  return new Response(JSON.stringify({ subscribers: subs.length, sent }), { status: 200 });
});
