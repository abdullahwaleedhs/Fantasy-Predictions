import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as webpush from "jsr:@negrel/webpush@0.3";

// VAPID keys stored as a JSON string in the VAPID_KEYS secret:
// {"publicKey":{...jwk...},"privateKey":{...jwk...}}
const VAPID_KEYS_JSON = Deno.env.get("VAPID_KEYS")!;
const VAPID_SUBJECT = "mailto:abdullahwaleedhs@gmail.com";

const vapidKeys = await webpush.importVapidKeys(JSON.parse(VAPID_KEYS_JSON), {
  extractable: false,
});
const appServer = await webpush.ApplicationServer.new({
  contactInformation: VAPID_SUBJECT,
  vapidKeys,
});

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
    const kickoff = new Date(`${m.match_date}T${m.match_time.slice(0, 5)}:00+03:00`);
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
        const subscription = sub.subscription as PushSubscriptionJSON;
        const subscriber = appServer.subscribe(subscription);
        await subscriber.pushTextMessage(payload, {});
        console.log("push sent for user:", sub.user_id);
      } catch (e) {
        console.error("push error for user:", sub.user_id, e);
        // Remove dead subscriptions
        const msg = String(e);
        if (msg.includes("410") || msg.includes("404")) {
          await supabase.from("push_subscriptions").delete().eq("user_id", sub.user_id);
        }
      }
    }
  }

  return new Response("done", { status: 200 });
});
