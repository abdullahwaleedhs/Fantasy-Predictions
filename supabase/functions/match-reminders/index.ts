import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as webpush from "jsr:@negrel/webpush@0.3";

const VAPID_SUBJECT = "mailto:abdullahwaleedhs@gmail.com";

Deno.serve(async () => {
  // Read + parse VAPID keys inside the handler so a missing/bad secret
  // logs a clear message instead of crashing the whole worker at boot.
  const rawVapid = Deno.env.get("VAPID_KEYS");
  if (!rawVapid) {
    const vapidNames = Object.keys(Deno.env.toObject()).filter((k) => /vapid/i.test(k));
    console.error("VAPID_KEYS secret is missing. Found VAPID-like secrets:", JSON.stringify(vapidNames));
    return new Response("missing VAPID_KEYS", { status: 500 });
  }
  let appServer;
  try {
    const vapidKeys = await webpush.importVapidKeys(JSON.parse(rawVapid), { extractable: false });
    appServer = await webpush.ApplicationServer.new({
      contactInformation: VAPID_SUBJECT,
      vapidKeys,
    });
  } catch (e) {
    console.error("failed to load VAPID keys:", e);
    return new Response("bad VAPID_KEYS", { status: 500 });
  }

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
    // Claim this match so we notify for it only once, even though the cron
    // runs every 5 min and the 20-40 min window spans several runs. The
    // primary-key insert fails if we already sent — then we skip.
    const { error: claimErr } = await supabase
      .from("sent_reminders")
      .insert({ match_id: match.id });
    if (claimErr) {
      console.log("already notified, skipping match:", match.id);
      continue;
    }

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

    // Notify everyone before the match, with a different message depending
    // on whether they already made a prediction.
    console.log("subscribers to notify:", subs.length);

    for (const sub of subs) {
      try {
        const hasPredicted = predictedUserIds.has(sub.user_id);
        const payload = JSON.stringify({
          title: "⏰ باقي ٣٠ دقيقة!",
          body: hasPredicted
            ? `${match.home} vs ${match.away} — تبي تغيّر توقعك؟`
            : `${match.home} vs ${match.away} — ادخل توقعها!`,
          tag: `match-${match.id}`,
          url: "/",
        });
        const subscription = sub.subscription as PushSubscriptionJSON;
        const subscriber = appServer.subscribe(subscription);
        await subscriber.pushTextMessage(payload, {});
        console.log("push sent for user:", sub.user_id, "predicted:", hasPredicted);
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
