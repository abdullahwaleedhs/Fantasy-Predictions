import { useState, useRef, useEffect, useMemo } from "react";
import { Plus, Trash2, ChevronDown, ChevronRight, Search, Palette, Lock, Unlock, Calendar, Clock, Menu, X, Home, Target, Trophy, BarChart3, Zap, Shield, Upload, CircleDot, Users, Copy, Check, Crown, ArrowDown, Award, TrendingUp, User, LogIn, LogOut, Mail, Camera, Eye, EyeOff, Pencil, Globe, ListOrdered } from "lucide-react";
import { isUsernameTaken, registerUser, loginUser, logoutUser, deleteAccount, updateProfile, fetchProfile, getSessionUser, setBoostsRemaining as setBoostsRemainingDB, requestPasswordReset, updatePassword } from "./auth";
import { supabase } from "./supabaseClient";
import {
  fetchTournaments,
  addTournamentDB,
  setTournamentLogoDB,
  removeTournamentDB,
  fetchClubs,
  addClubDB,
  updateClubDB,
  removeClubDB,
  fetchMatches,
  addMatchDB,
  updateMatchDB,
  removeMatchDB,
  fetchBoostedUserIdsForMatch,
  refundBoostDB,
  fetchPredictionsForUser,
  upsertPredictionDB,
  fetchLeaguesWithMembers,
  createLeagueDB,
  joinLeagueDB,
  fetchAllProfiles,
  fetchAllPredictionsWithProfiles,
  fetchServerTimeOffset,
  bustTournamentsCache,
  bustClubsCache,
  bustAllPredictionsCache,
  setTournamentChampionshipDB,
  setTournamentCupDB,
  setTournamentSortOrderDB,
  fetchChampionshipPredictionsForUser,
  upsertChampionshipPredictionDB,
  fetchAllChampionshipPredictions,
  fetchChampionshipResults,
  upsertChampionshipResultDB,
  fetchChampionshipSettings,
  updateChampionshipLockDB,
} from "./data";

const VAPID_PUBLIC_KEY = "BMI9_xrcnuEuLcAcbO9USRxVmnPL8wF6Y37KyyYQnu4oh5LhD-G5CeUVvZxST7FxMhQn5QH9FDTvSJXX-e53BO4";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function subscribeToPush(userId) {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;
  const reg = await navigator.serviceWorker.ready;
  // Always drop any existing subscription first: if it was created with an
  // older VAPID key it is now useless, and iOS won't let us re-subscribe with
  // a different key otherwise.
  const existing = await reg.pushManager.getSubscription();
  if (existing) await existing.unsubscribe();
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  });
  await supabase.from("push_subscriptions").delete().eq("user_id", userId);
  await supabase.from("push_subscriptions").insert({ user_id: userId, subscription: sub.toJSON() });
  return sub;
}

async function unsubscribeFromPush(userId) {
  if (!("serviceWorker" in navigator)) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    await sub.unsubscribe();
    await supabase.from("push_subscriptions").delete().eq("user_id", userId);
  }
}

// Tracks the server's clock relative to a *monotonic* timer (performance.now),
// not the device's wall clock - so that changing the phone's date/time after
// the app loaded can't move the countdown/lock at all, since performance.now()
// keeps ticking at a steady rate regardless of what the user sets the system
// date/time to. Synced once on app load (and periodically) in App().
let serverSyncedAtMs = Date.now();
let serverSyncedPerf = performance.now();
function setServerTimeSync(serverNowMs) {
  serverSyncedAtMs = serverNowMs;
  serverSyncedPerf = performance.now();
}
function serverNow() {
  return serverSyncedAtMs + (performance.now() - serverSyncedPerf);
}

// Persists a piece of UI state (active tab, sub-view, open filter, etc.) in
// sessionStorage, so reloading the page keeps the user exactly where they
// were instead of resetting to that component's default view.
function usePersistedState(key, defaultValue) {
  const [value, setValue] = useState(() => {
    const saved = sessionStorage.getItem(key);
    return saved !== null ? JSON.parse(saved) : defaultValue;
  });
  useEffect(() => {
    sessionStorage.setItem(key, JSON.stringify(value));
  }, [key, value]);
  return [value, setValue];
}

const DEFAULT_TOURNAMENTS = [
  "دوري روشن السعودي",
  "الدوري الإنجليزي الممتاز",
  "الدوري الإسباني",
  "الدوري الإيطالي",
  "الدوري الألماني",
  "الدوري الفرنسي",
  "دوري أبطال أوروبا",
  "الدوري الأوروبي",
  "كأس الملك",
  "كأس العالم",
  "كأس آسيا",
  "كأس العرب",
  "دوري أبطال آسيا",
];

const TIERS_META = [
  {
    points: 10,
    label: "نتيجة كاملة صحيحة",
    example: { home: "الهلال", away: "النصر", winner: "الهلال", loser: "النصر", predHome: 3, predAway: 1, actualHome: 3, actualAway: 1, note: "توقع كامل صحيح" },
  },
  {
    points: 5,
    label: "فائز صحيح مع هدف صحيح",
    example: { home: "الهلال", away: "النصر", winner: "الهلال", loser: "النصر", predHome: 2, predAway: 1, actualHome: 3, actualAway: 1, note: "توقع فوز الهلال + عدد أهداف النصر" },
  },
  {
    points: 4,
    label: "فائز صحيح فقط",
    example: { home: "الهلال", away: "النصر", winner: "الهلال", loser: "النصر", predHome: 2, predAway: 1, actualHome: 1, actualAway: 0, note: "توقع فوز الهلال فقط" },
  },
  {
    points: 3,
    label: "تعادل غير دقيق",
    example: { home: "الهلال", away: "النصر", winner: "تعادل", loser: "تعادل", predHome: 2, predAway: 2, actualHome: 1, actualAway: 1, note: "توقع التعادل مع اختلاف رقمي" },
  },
  {
    points: 1,
    label: "عدد أهداف صحيح",
    example: { home: "الهلال", away: "النصر", winner: "الهلال", loser: "النصر", predHome: 1, predAway: 2, actualHome: 1, actualAway: 1, note: "توقع عدد أهداف لفريق واحد" },
  },
  {
    points: 0,
    label: "توقع كامل خاطئ",
    example: { home: "الهلال", away: "النصر", winner: "الهلال", loser: "النصر", predHome: 3, predAway: 1, actualHome: 2, actualAway: 4, note: "توقع كل شي بشكل خاطئ" },
  },
];

// ---------- THEME SYSTEM ----------
// Each theme defines every token the UI needs. Tier colors are derived
// per-theme so the "10/5/4/3/1/0" scale always reads from strong to neutral
// within that theme's own palette logic, not a fixed hardcoded set.

const THEMES = [
  {
    id: "crimson-night",
    name: "أحمر ليلي",
    bg: "#120A0A",
    surface: "#1D1212",
    primary: "#E11D48",
    primarySoft: "#3D1620",
    accent: "#22C55E",
    accentSoft: "#163322",
    text: "#F5E8E8",
    muted: "#8C7070",
    border: "#321E1E",
    inputBorder: "#432626",
    danger: "#F87171",
    dangerSoft: "#3A1B1B",
    blue: "#60A5FA",
    blueSoft: "#172A47",
    navyBlue: "#1D4ED8",
    navyBlueSoft: "#0F1F3D",
    yellow: "#EAB308",
    yellowSoft: "#3A2F12",
    sky: "#22D3EE",
    skySoft: "#103A42",
    violet: "#A78BFA",
    violetSoft: "#2A2140",
  },
  {
    id: "teal-lagoon",
    name: "بحيرة فيروزية",
    bg: "#F1FAF9",
    surface: "#FFFFFF",
    primary: "#0F766E",
    primarySoft: "#CCEAE6",
    accent: "#22C55E",
    accentSoft: "#D7F0DC",
    text: "#10302C",
    muted: "#7FA39D",
    border: "#D5EDE9",
    inputBorder: "#BFE1DC",
    danger: "#DC2626",
    dangerSoft: "#FAD9D5",
    blue: "#3B82F6",
    blueSoft: "#DCE6FB",
    navyBlue: "#1E3A8A",
    navyBlueSoft: "#DCE3F5",
    yellow: "#CA8A04",
    yellowSoft: "#F5E7BE",
    sky: "#0891B2",
    skySoft: "#D6F0F5",
    violet: "#7C3AED",
    violetSoft: "#EDE5FB",
  },
  {
    id: "violet-storm",
    name: "عاصفة بنفسجية",
    bg: "#100B1C",
    surface: "#1B1430",
    primary: "#8B5CF6",
    primarySoft: "#2E2350",
    accent: "#22C55E",
    accentSoft: "#173326",
    text: "#EFEAFB",
    muted: "#8378A3",
    border: "#2A2148",
    inputBorder: "#382C5E",
    danger: "#FB7185",
    dangerSoft: "#3A1B26",
    blue: "#7DD3FC",
    blueSoft: "#1A2E45",
    navyBlue: "#1D4ED8",
    navyBlueSoft: "#0F1F3D",
    yellow: "#FACC15",
    yellowSoft: "#3A331A",
    sky: "#22D3EE",
    skySoft: "#103A42",
    violet: "#8B5CF6",
    violetSoft: "#2E2350",
  },
  {
    id: "burnt-orange",
    name: "برتقالي محروق",
    bg: "#FBF1E8",
    surface: "#FFFFFF",
    primary: "#C2410C",
    primarySoft: "#F4DAC3",
    accent: "#22C55E",
    accentSoft: "#D7EFDA",
    text: "#3A2415",
    muted: "#AB8E72",
    border: "#F0DEC8",
    inputBorder: "#E3C9A6",
    danger: "#B91C1C",
    dangerSoft: "#F2D7D0",
    blue: "#3B9AE0",
    blueSoft: "#D9E7F1",
    navyBlue: "#1E3A8A",
    navyBlueSoft: "#DCE3F5",
    yellow: "#CA8A04",
    yellowSoft: "#F2E4BC",
    sky: "#0891B2",
    skySoft: "#D6F0F5",
    violet: "#7C3AED",
    violetSoft: "#EAE0FA",
  },
  {
    id: "slate-mono",
    name: "رمادي أحادي",
    bg: "#F4F4F5",
    surface: "#FFFFFF",
    primary: "#27272A",
    primarySoft: "#D4D4D8",
    accent: "#22C55E",
    accentSoft: "#D6F0DA",
    highlight: "#FFFFFF",
    text: "#18181B",
    muted: "#8E8E96",
    border: "#E4E4E7",
    inputBorder: "#D1D1D6",
    danger: "#DC2626",
    dangerSoft: "#F4D6D2",
    blue: "#3B82F6",
    blueSoft: "#DCE6FB",
    navyBlue: "#1E3A8A",
    navyBlueSoft: "#DCE3F5",
    yellow: "#CA8A04",
    yellowSoft: "#F5E7BE",
    sky: "#0891B2",
    skySoft: "#D6F0F5",
    violet: "#6D28D9",
    violetSoft: "#EEE8FB",
  },
  {
    id: "rose-blush",
    name: "وردي فاتح",
    bg: "#FFF5F7",
    surface: "#FFFFFF",
    primary: "#BE185D",
    primarySoft: "#FAD3E3",
    accent: "#22C55E",
    accentSoft: "#D9F0DD",
    text: "#3A1C28",
    muted: "#B98998",
    border: "#F6DDE6",
    inputBorder: "#EFC2D5",
    danger: "#DC2626",
    dangerSoft: "#FAD9D5",
    blue: "#3B82F6",
    blueSoft: "#DCE6FB",
    navyBlue: "#1E3A8A",
    navyBlueSoft: "#DCE3F5",
    yellow: "#CA8A04",
    yellowSoft: "#F5E7BE",
    sky: "#0891B2",
    skySoft: "#D6F0F5",
    violet: "#9333EA",
    violetSoft: "#F1E3FB",
  },
  {
    id: "forest-deep",
    name: "غابة كثيفة",
    bg: "#0D1410",
    surface: "#16201A",
    primary: "#16A34A",
    primarySoft: "#1E3B28",
    accent: "#FB923C",
    accentSoft: "#3A2B17",
    text: "#E6F0E9",
    muted: "#7C9484",
    border: "#21321F",
    inputBorder: "#2C4530",
    danger: "#F87171",
    dangerSoft: "#3A1F1F",
    blue: "#7DD3FC",
    blueSoft: "#1A3140",
    navyBlue: "#1D4ED8",
    navyBlueSoft: "#0F1F3D",
    yellow: "#FACC15",
    yellowSoft: "#3A331A",
    sky: "#22D3EE",
    skySoft: "#103A42",
    violet: "#A78BFA",
    violetSoft: "#221C3D",
  },
  {
    id: "indigo-deep",
    name: "نيلي عميق",
    bg: "#0B0F1F",
    surface: "#141A33",
    primary: "#4338CA",
    primarySoft: "#23295A",
    accent: "#22C55E",
    accentSoft: "#173326",
    text: "#E8EAF8",
    muted: "#7378A0",
    border: "#202752",
    inputBorder: "#2B3268",
    danger: "#FB7185",
    dangerSoft: "#3A1B26",
    blue: "#93C5FD",
    blueSoft: "#1B2C4D",
    navyBlue: "#1D4ED8",
    navyBlueSoft: "#0F1F3D",
    yellow: "#FACC15",
    yellowSoft: "#3A331A",
    sky: "#22D3EE",
    skySoft: "#103A42",
    violet: "#A78BFA",
    violetSoft: "#2B2350",
  },
  {
    id: "ocean-deep",
    name: "محيط عميق",
    bg: "#E8F1F7",
    surface: "#FFFFFF",
    primary: "#075985",
    primarySoft: "#C7E1EE",
    accent: "#22C55E",
    accentSoft: "#D7EFDA",
    text: "#0C2233",
    muted: "#7E9DAE",
    border: "#D4E6EF",
    inputBorder: "#B9D8E6",
    danger: "#DC2626",
    dangerSoft: "#F4D6D2",
    blue: "#38BDF8",
    blueSoft: "#D2EBF7",
    navyBlue: "#1E3A8A",
    navyBlueSoft: "#DCE3F5",
    yellow: "#CA8A04",
    yellowSoft: "#F5E7BE",
    sky: "#0891B2",
    skySoft: "#D6F0F5",
    violet: "#7C3AED",
    violetSoft: "#E7DDFA",
  },
  {
    id: "midnight-gold",
    name: "ذهبي ليلي",
    bg: "#10100C",
    surface: "#1A1914",
    primary: "#D4AF37",
    primarySoft: "#3A331C",
    accent: "#22C55E",
    accentSoft: "#16331F",
    highlight: "#000000",
    text: "#F2EFE6",
    muted: "#8A8470",
    border: "#2E2C22",
    inputBorder: "#403D2E",
    danger: "#EF4444",
    dangerSoft: "#3A1C1C",
    blue: "#60A5FA",
    blueSoft: "#16233D",
    navyBlue: "#1D4ED8",
    navyBlueSoft: "#0F1F3D",
    yellow: "#D4AF37",
    yellowSoft: "#3A331C",
    sky: "#22D3EE",
    skySoft: "#103A42",
    violet: "#A78BFA",
    violetSoft: "#221F33",
  },
];

// Build the 6-tier scale for any theme: strongest (10pts) down to neutral (0pts)
function getTiers(theme) {
  return [
    { points: 10, label: TIERS_META[0].label, example: TIERS_META[0].example, bg: theme.accentSoft, text: theme.text, ring: theme.accent },
    { points: 5, label: TIERS_META[1].label, example: TIERS_META[1].example, bg: theme.navyBlueSoft, text: theme.text, ring: theme.navyBlue },
    { points: 4, label: TIERS_META[2].label, example: TIERS_META[2].example, bg: theme.skySoft, text: theme.text, ring: theme.sky },
    { points: 3, label: TIERS_META[3].label, example: TIERS_META[3].example, bg: theme.primarySoft, text: theme.text, ring: theme.muted },
    { points: 1, label: TIERS_META[4].label, example: TIERS_META[4].example, bg: theme.surface, text: theme.muted, ring: theme.inputBorder },
    { points: 0, label: TIERS_META[5].label, example: TIERS_META[5].example, bg: theme.dangerSoft, text: theme.danger, ring: theme.danger },
  ];
}

function tierStyleFor(theme, points) {
  const tiers = getTiers(theme);
  return tiers.find((t) => t.points === points) || tiers[tiers.length - 1];
}

function calcPoints(predHome, predAway, actualHome, actualAway, multiplier = 1) {
  if ([predHome, predAway, actualHome, actualAway].some((v) => v === "" || v === null || isNaN(v))) {
    return null;
  }
  const ph = Number(predHome), pa = Number(predAway);
  const ah = Number(actualHome), aa = Number(actualAway);

  const withMultiplier = (points, label) => ({ points: points * multiplier, basePoints: points, label, multiplier });

  if (ph === ah && pa === aa) {
    return withMultiplier(10, TIERS_META[0].label);
  }

  const predDiff = ph - pa;
  const actualDiff = ah - aa;
  const predWinner = predDiff > 0 ? "home" : predDiff < 0 ? "away" : "draw";
  const actualWinner = actualDiff > 0 ? "home" : actualDiff < 0 ? "away" : "draw";

  const homeGoalsExact = ph === ah;
  const awayGoalsExact = pa === aa;

  if (predWinner === actualWinner && predWinner !== "draw" && (homeGoalsExact || awayGoalsExact)) {
    return withMultiplier(5, TIERS_META[1].label);
  }
  if (predWinner === actualWinner && predWinner !== "draw") {
    return withMultiplier(4, TIERS_META[2].label);
  }
  if (predWinner === "draw" && actualWinner === "draw") {
    return withMultiplier(3, TIERS_META[3].label);
  }
  if (ph === ah || pa === aa) {
    return withMultiplier(1, TIERS_META[4].label);
  }
  return withMultiplier(0, TIERS_META[5].label);
}

// A match only counts toward stats/leaderboard/tournament points once it has
// an actual result AND its kickoff time has actually passed (i.e. it's truly
// finished and locked) - entering a result early as admin must not award
// points before the match is over.
function isMatchFinished(m) {
  const hasActual = m.actualHome !== "" && m.actualHome != null && m.actualAway !== "" && m.actualAway != null;
  if (!hasActual) return false;
  if (!m.date || !m.time) return true;
  return new Date(`${m.date}T${m.time}:00+03:00`).getTime() - serverNow() <= 0;
}

// Kickoff has passed, regardless of whether the admin has entered a result
// yet - used by the league predictions tab so a match shows up there (with
// "بإنتظار النتيجة") as soon as it locks, not only once it's fully finished.
function isMatchLocked(m) {
  if (!m.date || !m.time) return false;
  return new Date(`${m.date}T${m.time}:00+03:00`).getTime() - serverNow() <= 0;
}

// Computes all statistics shown on the stats page from the current matches.
// Only matches that have an actual result (finished matches) are counted.
// A finished match with an empty prediction counts as the "didn't predict"
// bucket (7th case) rather than being excluded.
function computeStats(matches) {
  const tierCounts = { 10: 0, 5: 0, 4: 0, 3: 0, 1: 0, 0: 0, none: 0 };
  const teamPoints = {}; // { teamName: totalPoints }
  const tournamentPoints = {}; // { tournamentName: { points, matches } }
  let totalFinished = 0;
  let totalPredicted = 0;
  let totalPoints = 0;

  matches.forEach((m) => {
    if (!isMatchFinished(m)) return; // match hasn't finished/locked yet, exclude entirely

    totalFinished += 1;

    const hasPrediction = m.predHome !== "" && m.predHome != null && m.predAway !== "" && m.predAway != null;
    // Same effective-multiplier logic as UserMatchCard: the admin's "مباراة
    // الدبل" (x2) takes priority and blocks the personal boost; otherwise
    // the participant's own "التربل" (x3) applies if they activated it.
    const adminMultiplier = m.doublePoints ? 2 : 1;
    const userMultiplier = m.userBoost ? 3 : 1;
    const multiplier = m.doublePoints ? adminMultiplier : userMultiplier;

    let points = 0;
    if (!hasPrediction) {
      tierCounts.none += 1;
    } else {
      totalPredicted += 1;
      const result = calcPoints(m.predHome, m.predAway, m.actualHome, m.actualAway, multiplier);
      if (result) {
        tierCounts[result.basePoints] = (tierCounts[result.basePoints] || 0) + 1;
        points = result.points;
      }
    }

    totalPoints += points;

    // Attribute points to both teams involved in this match (a team is
    // credited for any match it's part of, home or away).
    [m.home, m.away].forEach((team) => {
      if (!team) return;
      teamPoints[team] = (teamPoints[team] || 0) + points;
    });

    // Attribute points to the tournament this match belongs to.
    const tName = m.tournament || "بدون بطولة";
    if (!tournamentPoints[tName]) tournamentPoints[tName] = { points: 0, matches: 0 };
    tournamentPoints[tName].points += points;
    tournamentPoints[tName].matches += 1;
  });

  const topTeam = Object.entries(teamPoints).sort((a, b) => b[1] - a[1])[0] || null;

  return {
    totalFinished,
    totalPredicted,
    totalPoints,
    tierCounts,
    topTeam: topTeam ? { name: topTeam[0], points: topTeam[1] } : null,
    teamPoints,
    tournamentPoints,
  };
}

// Orders matches by kickoff date+time ascending (nearest match first).
// Matches without a date/time set yet have no defined position in a
// time-based sort, so they're placed at the end, in their original order.
function sortMatchesByKickoff(matches) {
  const withKickoff = [];
  const withoutKickoff = [];

  matches.forEach((m) => {
    if (m.date && m.time) {
      withKickoff.push(m);
    } else {
      withoutKickoff.push(m);
    }
  });

  withKickoff.sort((a, b) => {
    const aTime = new Date(`${a.date}T${a.time}:00`).getTime();
    const bTime = new Date(`${b.date}T${b.time}:00`).getTime();
    return aTime - bTime;
  });

  return [...withKickoff, ...withoutKickoff];
}

function ThemeSwitcher({ theme, setTheme }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          background: theme.surface,
          border: `1.5px solid ${theme.violet}`,
          borderRadius: "10px",
          padding: "8px 12px",
          fontFamily: "Cairo, sans-serif",
          fontWeight: 600,
          fontSize: "12px",
          color: theme.text,
          cursor: "pointer",
        }}
      >
        <Palette size={11} color={theme.accent} />
        {theme.name}
        <ChevronDown size={12} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            right: 0,
            zIndex: 30,
            background: theme.surface,
            border: `1.5px solid ${theme.violet}`,
            borderRadius: "12px",
            boxShadow: "0 10px 26px rgba(0,0,0,0.18)",
            maxHeight: "280px",
            overflowY: "auto",
            minWidth: "220px",
          }}
        >
          {THEMES.map((t) => (
            <div
              key={t.id}
              onClick={() => {
                setTheme(t);
                setOpen(false);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                padding: "10px 12px",
                cursor: "pointer",
                background: t.id === theme.id ? theme.primarySoft : "transparent",
              }}
              onMouseEnter={(e) => {
                if (t.id !== theme.id) e.currentTarget.style.background = theme.bg;
              }}
              onMouseLeave={(e) => {
                if (t.id !== theme.id) e.currentTarget.style.background = "transparent";
              }}
            >
              <div style={{ display: "flex", flexShrink: 0 }}>
                <span style={{ width: "14px", height: "14px", borderRadius: "50%", background: t.bg, border: `1px solid ${t.border}` }} />
                <span style={{ width: "14px", height: "14px", borderRadius: "50%", background: t.primary, marginRight: "-4px" }} />
                <span style={{ width: "14px", height: "14px", borderRadius: "50%", background: t.accent, marginRight: "-4px" }} />
              </div>
              <span style={{ fontFamily: "Cairo, sans-serif", fontSize: "10px", fontWeight: 600, color: theme.text }}>
                {t.name}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Decides which simple icon represents a tournament: a trophy for cup-style
// competitions (names containing "كأس" or "بطولة"), a ball otherwise (leagues).
function tournamentIconFor(name) {
  if (!name) return CircleDot;
  if (name.includes("كأس") || name.includes("بطولة")) return Trophy;
  return CircleDot;
}

function TournamentIcon({ name, logo, size = 14, color, theme }) {
  if (logo) {
    return (
      <div
        style={{
          width: size,
          height: size,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <img
          src={logo}
          alt={name}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
            display: "block",
          }}
        />
      </div>
    );
  }
  const Icon = tournamentIconFor(name);
  return <Icon size={size} color={color} style={{ flexShrink: 0 }} />;
}

function TournamentPicker({ value, onChange, tournaments, onAddTournament, tournamentLogos, theme, allowAdd = true, noMargin, topRadius = "8px 8px 0 0" }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const filtered = tournaments.filter((t) => t.includes(query.trim()));
  const exactExists = tournaments.some((t) => t === query.trim());

  return (
    <div ref={ref} style={{ position: "relative", marginBottom: noMargin ? 0 : "8px" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          background: theme.primary,
          color: theme.bg === theme.surface ? theme.accentSoft : (theme.highlight || theme.accent),
          border: "none",
          borderRadius: topRadius,
          padding: "6px 12px",
          fontFamily: "Cairo, sans-serif",
          fontWeight: 700,
          fontSize: "12px",
          cursor: "pointer",
          width: "100%",
          justifyContent: "space-between",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          {value && <TournamentIcon name={value} logo={tournamentLogos?.[value]} theme={theme} color={theme.bg === theme.surface ? theme.accentSoft : (theme.highlight || theme.accent)} />}
          {value || (tournaments.length === 0 ? "+ أضف بطولة" : "اختر البطولة")}
        </span>
        <ChevronDown size={11} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
      </button>

      {open && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px",
          }}
          onClick={() => {
            setOpen(false);
            setQuery("");
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: "360px",
              maxHeight: "70vh",
              display: "flex",
              flexDirection: "column",
              background: theme.surface,
              border: `1px solid ${theme.border}`,
              borderRadius: "14px",
              boxShadow: "0 12px 32px rgba(0,0,0,0.28)",
              overflow: "hidden",
            }}
          >
            <div style={{ padding: "10px", borderBottom: `1px solid ${theme.border}`, display: "flex", alignItems: "center", gap: "6px" }}>
              <Search size={11} color={theme.muted} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="بحث أو إضافة بطولة جديدة..."
                style={{
                  border: "none",
                  outline: "none",
                  flex: 1,
                  fontFamily: "Cairo, sans-serif",
                  fontSize: "16px",
                  color: theme.text,
                  background: "transparent",
                }}
              />
              <button
                onClick={() => {
                  setOpen(false);
                  setQuery("");
                }}
                aria-label="إغلاق"
                style={{ background: "transparent", border: "none", color: theme.muted, cursor: "pointer", display: "flex" }}
              >
                <X size={16} />
              </button>
            </div>

            <div style={{ overflowY: "auto", flex: 1 }}>
              {filtered.map((t) => (
                <div
                  key={t}
                  onClick={() => {
                    onChange(t);
                    setOpen(false);
                    setQuery("");
                  }}
                  style={{
                    padding: "12px 14px",
                    fontSize: "10px",
                    fontFamily: "Cairo, sans-serif",
                    color: t === value ? theme.primary : theme.text,
                    fontWeight: t === value ? 700 : 400,
                    background: t === value ? theme.primarySoft : "transparent",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = theme.bg)}
                  onMouseLeave={(e) => (e.currentTarget.style.background = t === value ? theme.primarySoft : "transparent")}
                >
                  <TournamentIcon name={t} logo={tournamentLogos?.[t]} theme={theme} color={t === value ? theme.primary : theme.muted} />
                  {t}
                </div>
              ))}

              {allowAdd && query.trim() && !exactExists && (
                <div
                  onClick={() => {
                    onAddTournament(query.trim());
                    onChange(query.trim());
                    setOpen(false);
                    setQuery("");
                  }}
                  style={{
                    padding: "12px 14px",
                    fontSize: "10px",
                    fontFamily: "Cairo, sans-serif",
                    color: theme.accent,
                    fontWeight: 700,
                    cursor: "pointer",
                    borderTop: `1px solid ${theme.border}`,
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  <Plus size={11} />
                  إضافة "{query.trim()}"
                </div>
              )}

              {filtered.length === 0 && !query.trim() && (
                <div style={{ padding: "14px", fontSize: "12px", color: theme.muted, textAlign: "center" }}>
                  {allowAdd ? "لا توجد بطولات بعد — اكتب اسم البطولة بخانة البحث بالأعلى لإضافتها" : "لا توجد بطولات بعد"}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TeamField({ value, onChange, placeholder, theme, disabled }) {
  const initial = value.trim().charAt(0) || "؟";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "6px", flex: 1, minWidth: 0 }}>
      <div
        style={{
          width: "32px",
          height: "32px",
          borderRadius: "50%",
          background: theme.bg,
          border: `1px solid ${theme.inputBorder}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "10px",
          fontWeight: 700,
          color: theme.muted,
          flexShrink: 0,
        }}
      >
        {initial}
      </div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        style={{
          width: "100%",
          minWidth: 0,
          textAlign: "center",
          border: "none",
          borderBottom: `2px solid ${theme.primary}`,
          fontFamily: "Cairo, sans-serif",
          fontWeight: 700,
          fontSize: "12px",
          color: theme.primary,
          padding: "4px 2px",
          outline: "none",
          background: "transparent",
          opacity: disabled ? 0.6 : 1,
        }}
      />
    </div>
  );
}

// Picks a club from the clubs added for the match's tournament (with logo),
// or falls back to free-text entry if no clubs were added for that
// tournament yet, so the admin is never blocked.
function TeamPicker({ value, logo, onChange, clubs, placeholder, theme, disabled }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  if (!clubs || clubs.length === 0) {
    // No clubs registered for this tournament yet - fall back to free text.
    return <TeamField value={value} onChange={onChange} placeholder={placeholder} theme={theme} disabled={disabled} />;
  }

  return (
    <div ref={ref} style={{ position: "relative", flex: 1, minWidth: 0 }}>
      <button
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "6px",
          width: "100%",
          background: "transparent",
          border: "none",
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.6 : 1,
        }}
      >
        <ClubLogo logo={logo} name={value} theme={theme} />
        <span
          style={{
            fontFamily: "Cairo, sans-serif",
            fontWeight: 700,
            fontSize: "10.5px",
            color: theme.primary,
            width: "100%",
            textAlign: "center",
            whiteSpace: "normal",
            overflowWrap: "break-word",
            lineHeight: "1.2",
          }}
        >
          {value || placeholder}
        </span>
      </button>

      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 100,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: theme.surface,
              border: `1px solid ${theme.border}`,
              borderRadius: "14px",
              boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
              width: "100%",
              maxWidth: "320px",
              maxHeight: "70vh",
              overflowY: "auto",
            }}
          >
            {clubs.map((club) => (
              <div
                key={club.id}
                onClick={() => {
                  onChange(club.name, club.logo);
                  setOpen(false);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "10px 12px",
                  cursor: "pointer",
                  background: club.name === value ? theme.primarySoft : "transparent",
                }}
                onMouseEnter={(e) => {
                  if (club.name !== value) e.currentTarget.style.background = theme.bg;
                }}
                onMouseLeave={(e) => {
                  if (club.name !== value) e.currentTarget.style.background = "transparent";
                }}
              >
                <ClubLogo logo={club.logo} name={club.name} theme={theme} size={26} />
                <span style={{ fontFamily: "Cairo, sans-serif", fontSize: "13px", fontWeight: 600, color: theme.text }}>
                  {club.name}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ScoreInput({ value, onChange, actual, theme, disabled, small }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      style={{
        width: small ? "38px" : "48px",
        height: small ? "36px" : "44px",
        textAlign: "center",
        textAlignLast: "center",
        borderRadius: "8px",
        border: "1px solid #000000",
        background: theme.bg,
        fontFamily: "Cairo, sans-serif",
        fontWeight: 700,
        fontSize: small ? "13px" : "16px",
        lineHeight: "1",
        color: theme.text,
        outline: "none",
        appearance: "none",
        WebkitAppearance: "none",
        cursor: disabled ? "not-allowed" : "pointer",
        padding: 0,
        paddingTop: "1px",
        margin: "0",
        boxSizing: "border-box",
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <option value="">-</option>
      {Array.from({ length: 21 }, (_, i) => (
        <option key={i} value={i}>
          {i}
        </option>
      ))}
    </select>
  );
}

function useCountdown(kickoffISO) {
  const [now, setNow] = useState(() => serverNow());

  useEffect(() => {
    const id = setInterval(() => setNow(serverNow()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!kickoffISO) return { locked: false, parts: null };

  const kickoff = new Date(kickoffISO).getTime();
  const diff = kickoff - now;

  if (diff <= 0) {
    return { locked: true, parts: null };
  }

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
  const minutes = Math.floor((diff / (1000 * 60)) % 60);
  const seconds = Math.floor((diff / 1000) % 60);

  const pad = (n) => String(n).padStart(2, "0");

  return {
    locked: false,
    parts: { days: pad(days), hours: pad(hours), minutes: pad(minutes), seconds: pad(seconds) },
  };
}

// Shared countdown badge used by both the admin (DateTimeRow) and the
// participant (MatchInfoBar) views. Shows day:hour:minute:second with small
// labels under each segment, solid violet background, black text, and the
// lock/unlock icon positioned on the left (reversed from RTL default).
function CountdownBadge({ kickoffISO, theme, small }) {
  const { locked, parts } = useCountdown(kickoffISO);

  if (!kickoffISO) {
    return <Unlock size={15} color={theme.muted} style={{ opacity: 0.5, flexShrink: 0 }} />;
  }

  const segments = parts
    ? [
        { value: parts.days, label: "يوم" },
        { value: parts.hours, label: "ساعة" },
        { value: parts.minutes, label: "دقيقة" },
        { value: parts.seconds, label: "ثانية" },
      ]
    : null;

  const stateColor = locked ? theme.danger : theme.accent;

  return (
    <div
      dir="rtl"
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: "2px",
        background: theme.surface,
        border: `1px solid ${stateColor}`,
        borderRadius: "6px",
        padding: "4px 7px",
      }}
    >
      {locked ? (
        <span
          style={{
            fontFamily: "Cairo, sans-serif",
            fontSize: "10px",
            fontWeight: 700,
            color: stateColor,
            whiteSpace: "nowrap",
          }}
        >
          مقفل
        </span>
      ) : (
        segments && segments.map((seg, i) => (
          <div key={seg.label} style={{ display: "flex", alignItems: "center" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: small ? "16px" : "22px" }}>
              <span
                style={{
                  fontFamily: "Cairo, sans-serif",
                  fontSize: small ? "9px" : "11px",
                  fontWeight: 800,
                  color: stateColor,
                  fontVariantNumeric: "tabular-nums",
                  lineHeight: "1.1",
                }}
              >
                {seg.value}
              </span>
              <span
                style={{
                  fontFamily: "Cairo, sans-serif",
                  fontSize: small ? "5px" : "7px",
                  fontWeight: 600,
                  color: stateColor,
                  lineHeight: "1",
                }}
              >
                {seg.label}
              </span>
            </div>
            {i < segments.length - 1 && (
              <span style={{ fontFamily: "Cairo, sans-serif", fontSize: small ? "9px" : "11px", fontWeight: 700, color: stateColor, margin: "0 1px", lineHeight: "1", paddingBottom: small ? "4px" : "6px" }}>:</span>
            )}
          </div>
        ))
      )}
    </div>
  );
}


// Builds a list of upcoming dates (today + next 60 days) in Gregorian calendar,
// using local date components directly (no UTC conversion) to avoid off-by-one
// day shifts in timezones ahead of UTC. Labels are in English.
function toLocalISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function buildDateOptions() {
  const options = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = 0; i < 60; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const iso = toLocalISODate(d);
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();
    const label = `${dd}-${mm}-${yyyy}`;
    options.push({ iso, label });
  }
  return options;
}

const DATE_OPTIONS = buildDateOptions();

const MONTH_NAMES_EN = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const MONTH_NAMES_AR = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
];

// A button + popup calendar: month and year tabs on top, a 7-column day
// grid below. Restricted to the same 60-day forward range as DATE_OPTIONS
// (today through +59 days), so admins can only schedule within that window.
function DateCalendarPicker({ value, onChange, theme, disabled }) {
  const [open, setOpen] = useState(false);
  const activeMonthRef = useRef(null);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const minDate = new Date(2026, 0, 1); // allow picking any day starting January 1, 2026
  const maxDate = new Date(today);
  maxDate.setFullYear(maxDate.getFullYear() + 2); // allow scheduling up to 2 years ahead

  const selectedDate = value ? new Date(value + "T00:00:00") : null;

  const [viewYear, setViewYear] = useState((selectedDate || today).getFullYear());
  const [viewMonth, setViewMonth] = useState((selectedDate || today).getMonth());

  // When opening the picker, jump straight to today's month/year tab instead
  // of leaving the view wherever it last was (which defaults to the earliest
  // available month - January - on first open since the tab row scrolls
  // to its start).
  useEffect(() => {
    if (open) {
      const base = selectedDate || today;
      setViewYear(base.getFullYear());
      setViewMonth(base.getMonth());
      activeMonthRef.current?.scrollIntoView({ block: "nearest", inline: "center" });
    }
  }, [open]);

  // Only months that contain at least one day within the allowed range.
  const availableMonths = [];
  {
    let cursor = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
    const stop = new Date(maxDate.getFullYear(), maxDate.getMonth(), 1);
    while (cursor <= stop) {
      availableMonths.push({ year: cursor.getFullYear(), month: cursor.getMonth() });
      cursor.setMonth(cursor.getMonth() + 1);
    }
  }
  const availableYears = [...new Set(availableMonths.map((m) => m.year))];
  const monthsForViewYear = availableMonths.filter((m) => m.year === viewYear);

  // Day grid for the current viewMonth/viewYear, padded so the first day
  // lands on the correct weekday (week starts Sunday).
  const firstOfMonth = new Date(viewYear, viewMonth, 1);
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const startWeekday = firstOfMonth.getDay(); // 0 = Sunday
  const dayCells = [...Array(startWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];

  const isDaySelectable = (day) => {
    const d = new Date(viewYear, viewMonth, day);
    return d >= minDate && d <= maxDate;
  };
  const isDaySelected = (day) => selectedDate && selectedDate.getFullYear() === viewYear && selectedDate.getMonth() === viewMonth && selectedDate.getDate() === day;

  const label = value
    ? (() => {
        const [y, m, d] = value.split("-");
        return `${d}-${m}-${y}`;
      })()
    : "التاريخ";

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        style={{
          border: `1px solid ${theme.inputBorder}`,
          borderRadius: "6px",
          background: theme.surface,
          color: theme.text,
          fontFamily: "Cairo, sans-serif",
          fontSize: "11px",
          fontWeight: 600,
          padding: "4px 6px",
          outline: "none",
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.6 : 1,
          minWidth: "90px",
          textAlign: "center",
        }}
      >
        {label}
      </button>

      {!disabled && open && (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.45)",
              zIndex: 100,
            }}
          />
          <div
            style={{
              position: "fixed",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              zIndex: 101,
              background: theme.surface,
              border: `1.5px solid ${theme.violet}`,
              borderRadius: "12px",
              boxShadow: "0 12px 28px rgba(0,0,0,0.25)",
              padding: "14px",
              width: "300px",
              maxWidth: "90vw",
            }}
          >
            {/* Year tabs */}
            <div style={{ display: "flex", gap: "4px", marginBottom: "6px" }}>
            {availableYears.map((y) => (
              <button
                key={y}
                type="button"
                onClick={() => {
                  setViewYear(y);
                  const firstMonthForYear = availableMonths.find((m) => m.year === y)?.month;
                  if (firstMonthForYear != null) setViewMonth(firstMonthForYear);
                }}
                style={{
                  flex: 1,
                  padding: "5px 0",
                  borderRadius: "6px",
                  border: "none",
                  background: viewYear === y ? theme.primary : theme.bg,
                  color: viewYear === y ? theme.surface : theme.muted,
                  fontFamily: "Cairo, sans-serif",
                  fontWeight: 700,
                  fontSize: "11px",
                  cursor: "pointer",
                }}
              >
                {y}
              </button>
            ))}
          </div>

          {/* Month tabs */}
          <div style={{ display: "flex", gap: "4px", marginBottom: "10px", overflowX: "auto" }}>
            {monthsForViewYear.map(({ month, year }) => (
              <button
                key={month}
                type="button"
                ref={viewMonth === month ? activeMonthRef : null}
                onClick={() => setViewMonth(month)}
                style={{
                  flexShrink: 0,
                  padding: "5px 8px",
                  borderRadius: "6px",
                  border: "none",
                  background: viewMonth === month ? theme.violetSoft : theme.bg,
                  color: viewMonth === month ? theme.violet : theme.muted,
                  fontFamily: "Cairo, sans-serif",
                  fontWeight: 700,
                  fontSize: "10px",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                {MONTH_NAMES_AR[month]} {year}
              </button>
            ))}
          </div>

          {/* Weekday headers */}
          <div dir="ltr" style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "2px", marginBottom: "4px" }}>
            {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
              <div key={i} style={{ textAlign: "center", fontSize: "9px", fontWeight: 700, color: theme.muted }}>
                {d}
              </div>
            ))}
          </div>

          {/* Day grid */}
          <div dir="ltr" style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "2px" }}>
            {dayCells.map((day, i) => {
              if (day === null) return <div key={`pad-${i}`} />;
              const selectable = isDaySelectable(day);
              const selected = isDaySelected(day);
              return (
                <button
                  key={day}
                  type="button"
                  disabled={!selectable}
                  onClick={() => {
                    const iso = toLocalISODate(new Date(viewYear, viewMonth, day));
                    onChange(iso);
                    setOpen(false);
                  }}
                  style={{
                    aspectRatio: "1",
                    border: "none",
                    borderRadius: "6px",
                    background: selected ? theme.primary : "transparent",
                    color: selected ? theme.surface : selectable ? theme.text : theme.inputBorder,
                    fontFamily: "Cairo, sans-serif",
                    fontSize: "11px",
                    fontWeight: selected ? 800 : 500,
                    cursor: selectable ? "pointer" : "not-allowed",
                  }}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>
        </>
      )}
    </div>
  );
}

// Single combined time dropdown (e.g. "08:30 PM") instead of separate
// hour/minute/AM-PM controls. Internally still emits 24-hour "HH:MM".
function buildTimeOptions() {
  const options = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 15) {
      const hh = String(h).padStart(2, "0");
      const mm = String(m).padStart(2, "0");
      const value = `${hh}:${mm}`;
      const h12 = h % 12 === 0 ? 12 : h % 12;
      const ampm = h >= 12 ? "PM" : "AM";
      const label = `${String(h12).padStart(2, "0")}:${mm} ${ampm}`;
      options.push({ value, label });
    }
  }
  return options;
}

const TIME_OPTIONS = buildTimeOptions();

function TimePicker({ value, onChange, theme }) {
  return (
    <select
      dir="ltr"
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      style={{
        border: `1px solid ${theme.inputBorder}`,
        borderRadius: "6px",
        background: theme.surface,
        color: theme.text,
        fontFamily: "Cairo, sans-serif",
        fontSize: "11px",
        fontWeight: 600,
        padding: "4px 6px",
        outline: "none",
        cursor: "pointer",
        textAlign: "center",
        textAlignLast: "center",
      }}
    >
      <option value="">الوقت</option>
      {TIME_OPTIONS.map((t) => (
        <option key={t.value} value={t.value}>
          {t.label}
        </option>
      ))}
    </select>
  );
}

// Fully flexible time picker: any hour 0-23, any minute 0-59 (not limited
// to 15-minute steps like TIME_OPTIONS). Opens a fixed-position modal with
// two independently scrollable columns, same modal pattern as
// DateCalendarPicker so it isn't clipped by any ancestor's overflow:hidden.
function TimeFlexPicker({ value, onChange, theme, disabled }) {
  const [open, setOpen] = useState(false);

  const [hh, mm] = value ? value.split(":") : ["", ""];
  const selectedHour = hh !== "" ? Number(hh) : null;
  const selectedMinute = mm !== "" ? Number(mm) : null;

  const commit = (hour, minute) => {
    const h = hour != null ? hour : selectedHour ?? 0;
    const m = minute != null ? minute : selectedMinute ?? 0;
    onChange(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  };

  const label = value
    ? (() => {
        const h12 = Number(hh) % 12 === 0 ? 12 : Number(hh) % 12;
        const ampm = Number(hh) >= 12 ? "PM" : "AM";
        return `${String(h12).padStart(2, "0")}:${mm} ${ampm}`;
      })()
    : "الوقت";

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        dir="ltr"
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        style={{
          border: `1px solid ${theme.inputBorder}`,
          borderRadius: "6px",
          background: theme.surface,
          color: theme.text,
          fontFamily: "Cairo, sans-serif",
          fontSize: "11px",
          fontWeight: 600,
          padding: "4px 6px",
          outline: "none",
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.6 : 1,
          minWidth: "90px",
          textAlign: "center",
        }}
      >
        {label}
      </button>

      {!disabled && open && (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.45)",
              zIndex: 100,
            }}
          />
          <div
            style={{
              position: "fixed",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              zIndex: 101,
              background: theme.surface,
              border: `1.5px solid ${theme.violet}`,
              borderRadius: "12px",
              boxShadow: "0 12px 28px rgba(0,0,0,0.25)",
              padding: "14px",
              width: "220px",
              maxWidth: "90vw",
            }}
          >
            <div dir="ltr" style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
              <span style={{ flex: 1, textAlign: "center", fontFamily: "Cairo, sans-serif", fontSize: "11px", fontWeight: 700, color: theme.muted }}>
                الدقيقة
              </span>
              <span style={{ flex: 1, textAlign: "center", fontFamily: "Cairo, sans-serif", fontSize: "11px", fontWeight: 700, color: theme.muted }}>
                الساعة
              </span>
            </div>

            <div dir="ltr" style={{ display: "flex", gap: "8px" }}>
              {/* Minutes 0-59 */}
              <div
                style={{
                  flex: 1,
                  maxHeight: "220px",
                  overflowY: "auto",
                  border: `1px solid ${theme.border}`,
                  borderRadius: "8px",
                  padding: "4px",
                }}
              >
                {Array.from({ length: 60 }, (_, m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => commit(null, m)}
                    style={{
                      display: "block",
                      width: "100%",
                      padding: "7px 0",
                      borderRadius: "6px",
                      border: "none",
                      background: selectedMinute === m ? theme.primary : "transparent",
                      color: selectedMinute === m ? theme.surface : theme.text,
                      fontFamily: "Cairo, sans-serif",
                      fontWeight: selectedMinute === m ? 800 : 500,
                      fontSize: "12px",
                      cursor: "pointer",
                      marginBottom: "2px",
                    }}
                  >
                    {String(m).padStart(2, "0")}
                  </button>
                ))}
              </div>

              {/* Hours 0-23 */}
              <div
                style={{
                  flex: 1,
                  maxHeight: "220px",
                  overflowY: "auto",
                  border: `1px solid ${theme.border}`,
                  borderRadius: "8px",
                  padding: "4px",
                }}
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => commit(h, null)}
                    style={{
                      display: "block",
                      width: "100%",
                      padding: "7px 0",
                      borderRadius: "6px",
                      border: "none",
                      background: selectedHour === h ? theme.primary : "transparent",
                      color: selectedHour === h ? theme.surface : theme.text,
                      fontFamily: "Cairo, sans-serif",
                      fontWeight: selectedHour === h ? 800 : 500,
                      fontSize: "12px",
                      cursor: "pointer",
                      marginBottom: "2px",
                    }}
                  >
                    {String(h).padStart(2, "0")}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="button"
              onClick={() => setOpen(false)}
              style={{
                width: "100%",
                marginTop: "10px",
                padding: "8px 0",
                borderRadius: "8px",
                border: "none",
                background: theme.primary,
                color: theme.surface,
                fontFamily: "Cairo, sans-serif",
                fontWeight: 700,
                fontSize: "12px",
                cursor: "pointer",
              }}
            >
              تم
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function DateTimeRow({ match, onChange, theme, disabled }) {
  const kickoffISO = match.date && match.time ? `${match.date}T${match.time}:00+03:00` : null;
  const isLocked = disabled;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "6px",
        padding: "10px 12px",
        background: theme.bg,
        borderBottom: `1px solid ${theme.border}`,
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "4px", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "3px" }}>
          <Calendar size={13} color={theme.muted} />
          <DateCalendarPicker
            value={match.date || ""}
            onChange={(iso) => onChange({ ...match, date: iso })}
            theme={theme}
            disabled={isLocked}
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "3px" }}>
          <Clock size={13} color={theme.muted} />
          <TimeFlexPicker
            value={match.time || ""}
            onChange={(v) => onChange({ ...match, time: v })}
            theme={theme}
            disabled={isLocked}
          />
        </div>
      </div>

      <div style={{ flexShrink: 0 }}>
        <CountdownBadge kickoffISO={kickoffISO} theme={theme} small />
      </div>
    </div>
  );
}

// Admin setting: mark this match as double points for everyone. Lives
// inside the violet-framed white box (below the date/time row), not the
// schedule bar above it.
function DoublePointsToggle({ match, onChange, theme, disabled }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "8px",
        padding: "8px 12px",
        background: match.doublePoints ? theme.yellowSoft : theme.surface,
        borderBottom: `1px solid ${theme.border}`,
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
        <Zap size={13} color={match.doublePoints ? theme.yellow : theme.muted} />
        <span
          style={{
            fontFamily: "Cairo, sans-serif",
            fontSize: "11px",
            fontWeight: 600,
            color: match.doublePoints ? theme.text : theme.muted,
          }}
        >
          مباراة الدبل (x2)
        </span>
      </div>
      <button
        onClick={() => !disabled && onChange({ ...match, doublePoints: !match.doublePoints })}
        disabled={disabled}
        style={{
          width: "38px",
          height: "20px",
          borderRadius: "10px",
          border: "none",
          background: match.doublePoints ? theme.yellow : theme.inputBorder,
          position: "relative",
          cursor: disabled ? "not-allowed" : "pointer",
          flexShrink: 0,
          padding: 0,
        }}
        aria-label="تبديل دبل النقاط من قبل المنظم"
      >
        <span
          style={{
            position: "absolute",
            top: "2px",
            right: match.doublePoints ? "2px" : "20px",
            width: "16px",
            height: "16px",
            borderRadius: "50%",
            background: theme.surface,
            transition: "right 0.15s ease",
          }}
        />
      </button>
    </div>
  );
}

// Read-only version of the schedule bar for the restricted user view:
// shows date/time/countdown/lock as plain text, no editable pickers.
function MatchInfoBar({ match, theme, dark }) {
  const kickoffISO = match.date && match.time ? `${match.date}T${match.time}:00+03:00` : null;

  const dateLabel = match.date
    ? (() => {
        const [y, m, d] = match.date.split("-");
        return `${d}-${m}-${y}`;
      })()
    : "—";
  const timeLabel = match.time
    ? (() => {
        const [hh, mm] = match.time.split(":");
        const h12 = Number(hh) % 12 === 0 ? 12 : Number(hh) % 12;
        const ampm = Number(hh) >= 12 ? "PM" : "AM";
        return `${String(h12).padStart(2, "0")}:${mm} ${ampm}`;
      })()
    : "—";

  const textColor = dark ? "#FFFFFF" : theme.text;
  const iconColor = dark ? "#FFFFFF" : theme.muted;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "8px",
        padding: "10px 12px",
        background: dark ? "transparent" : theme.bg,
        borderBottom: dark ? "none" : `1px solid ${theme.border}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <Calendar size={13} color={iconColor} />
          <span dir="ltr" style={{ fontFamily: "Cairo, sans-serif", fontSize: "11px", fontWeight: 600, color: textColor }}>
            {dateLabel}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <Clock size={13} color={iconColor} />
          <span dir="ltr" style={{ fontFamily: "Cairo, sans-serif", fontSize: "11px", fontWeight: 600, color: textColor }}>
            {timeLabel}
          </span>
        </div>
      </div>

      <div style={{ flexShrink: 0 }}>
        <CountdownBadge kickoffISO={kickoffISO} theme={theme} />
      </div>
    </div>
  );
}

// Static (non-editable) team display for the restricted user view.
function TeamDisplay({ name, logo, theme, logoSize = 48, venueLabel }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "6px", flex: 1, minWidth: 0 }}>
      <div style={{ position: "relative" }}>
        <ClubLogo logo={logo} name={name} theme={theme} size={logoSize} />
      </div>
      <span
        style={{
          fontFamily: "Cairo, sans-serif",
          fontWeight: 800,
          fontSize: "10.5px",
          color: theme.primary,
          textAlign: "center",
          width: "100%",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {name || "—"}
      </span>
      {venueLabel && (
        <span style={{ fontFamily: "Cairo, sans-serif", fontWeight: 700, fontSize: "9px", color: theme.muted }}>{venueLabel}</span>
      )}
    </div>
  );
}

// Restricted match card for regular participants: everything is read-only
// (tournament, teams, schedule, actual result) except the prediction inputs.
// Also supports the personal "double points" boost (limited uses per season).
function UserMatchCard({ match, onChange, theme, boostsRemaining, tournamentLogos, hideResult, confirmed, onConfirm, predictedTab }) {
  // Score edits stay local (draft) until "حفظ التوقع" is pressed - nothing
  // is written to the DB on keystroke, so an unsaved edit doesn't survive
  // a page refresh.
  const [draftHome, setDraftHome] = useState(match.predHome);
  const [draftAway, setDraftAway] = useState(match.predAway);
  const [draftBoost, setDraftBoost] = useState(!!match.userBoost);

  const userMultiplier = match.userBoost ? 3 : 1;
  const adminMultiplier = match.doublePoints ? 2 : 1;
  const effectiveMultiplier = match.doublePoints ? adminMultiplier : userMultiplier;

  const result = calcPoints(match.predHome, match.predAway, match.actualHome, match.actualAway, effectiveMultiplier);
  const colors = result
    ? match.userBoost
      ? { bg: theme.yellowSoft, text: theme.yellow, ring: theme.yellow }
      : tierStyleFor(theme, result.basePoints)
    : null;

  const num = (v) => (v === "" ? "" : String(v).replace(/[^0-9]/g, "").slice(0, 2));

  const kickoffISO = match.date && match.time ? `${match.date}T${match.time}:00+03:00` : null;
  const isLocked = kickoffISO ? new Date(kickoffISO).getTime() - serverNow() <= 0 : false;

  const hasActual = match.actualHome !== "" && match.actualAway !== "" && match.actualHome != null && match.actualAway != null;

  const noPrediction = match.predHome === "" || match.predHome == null || match.predAway === "" || match.predAway == null;
  const noPredictionDraft = draftHome === "" || draftHome == null || draftAway === "" || draftAway == null;
  const isDirty =
    String(draftHome ?? "") !== String(match.predHome ?? "") ||
    String(draftAway ?? "") !== String(match.predAway ?? "") ||
    draftBoost !== !!match.userBoost;
  const showSaved = confirmed && !isDirty && !noPredictionDraft;
  const saveDisabled = !isDirty;

  const boostDisabled = match.doublePoints || isLocked || noPredictionDraft || (!draftBoost && boostsRemaining <= 0);

  const isGold = match.doublePoints || draftBoost || match.userBoost;

  const saveDraft = () => {
    onChange({ ...match, predHome: draftHome, predAway: draftAway, userBoost: draftBoost });
    if (!noPredictionDraft) onConfirm();
  };

  return (
    <div style={{ marginBottom: "14px" }}>
      <div
        style={{
          background: theme.surface,
          border: isGold ? `2px solid ${theme.yellow}` : `1.5px solid ${theme.violet}`,
          borderRadius: "14px",
          overflow: "hidden",
        }}
      >
        {/* Tournament name */}
        <div
          style={{
            padding: "10px 12px",
            fontFamily: "Cairo, sans-serif",
            fontWeight: 700,
            fontSize: "10px",
            color: isGold ? theme.yellow : theme.primary,
            textAlign: "center",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "6px",
            borderBottom: `1px solid ${theme.border}`,
          }}
        >
          {match.tournament && (
            <TournamentIcon name={match.tournament} logo={tournamentLogos?.[match.tournament]} theme={theme} color={isGold ? theme.yellow : theme.primary} />
          )}
          {match.tournament || "بطولة غير محددة"}
        </div>

        {/* Date/lock row */}
        <div style={{ borderBottom: `1px solid ${theme.border}` }}>
          <MatchInfoBar match={match} theme={theme} />
        </div>

        <div style={{ padding: "16px 18px 18px" }}>
          {/* Team + your prediction, grouped per column, with the personal
              boost control sitting in the middle gap between the two
              prediction boxes - hidden entirely if admin already doubled
              this match. */}
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "10px", marginBottom: isLocked ? "0" : "16px" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px", flex: 1 }}>
              <TeamDisplay name={match.home} logo={match.homeLogo} theme={theme} venueLabel={match.venueTeam === "home" ? "المستضيف" : match.venueTeam === "away" ? "الضيف" : null} />
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "6px", marginTop: "4px" }}>
                <span style={{ fontSize: "10px", color: theme.muted, fontWeight: 600 }}>توقعك</span>
                {isLocked ? (
                  <ScoreBoxStatic value={match.predHome} theme={theme} />
                ) : (
                  <ScoreInput
                    value={draftHome}
                    onChange={(v) => {
                      const newHome = num(v);
                      if (newHome === "" && draftBoost) setDraftBoost(false);
                      setDraftHome(newHome);
                    }}
                    theme={theme}
                    disabled={isLocked}
                  />
                )}
              </div>
            </div>

            {isLocked ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minWidth: "64px", paddingTop: "62px" }}>
                <span style={{ color: theme.muted, fontSize: "13px", fontWeight: 700 }}>ضد</span>
              </div>
            ) : match.doublePoints ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingTop: "62px" }}>
                <span style={{ color: theme.muted, fontSize: "12px", fontWeight: 700 }}>ضد</span>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "5px", paddingTop: "62px" }}>
                <button
                  onClick={() => setDraftBoost((b) => !b)}
                  disabled={boostDisabled}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: "64px",
                    boxSizing: "border-box",
                    borderRadius: "7px",
                    padding: "5px 6px",
                    fontSize: "11px",
                    fontFamily: "Cairo, sans-serif",
                    fontWeight: 800,
                    border: `1.5px solid ${theme.yellow}`,
                    background: draftBoost ? theme.yellowSoft : "transparent",
                    color: draftBoost ? theme.yellow : theme.text,
                    cursor: boostDisabled ? "not-allowed" : "pointer",
                    opacity: boostDisabled && !draftBoost ? 0.5 : 1,
                    whiteSpace: "nowrap",
                  }}
                >
                  تربل
                </button>
                <span
                  style={{
                    fontSize: "9px",
                    color: theme.muted,
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                    width: "100%",
                    textAlign: "center",
                  }}
                >
                  ({boostsRemaining} متبقية)
                </span>
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px", flex: 1 }}>
              <TeamDisplay name={match.away} logo={match.awayLogo} theme={theme} venueLabel={match.venueTeam === "away" ? "المستضيف" : match.venueTeam === "home" ? "الضيف" : null} />
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "6px", marginTop: "4px" }}>
                <span style={{ fontSize: "10px", color: theme.muted, fontWeight: 600 }}>توقعك</span>
                {isLocked ? (
                  <ScoreBoxStatic value={match.predAway} theme={theme} />
                ) : (
                  <ScoreInput
                    value={draftAway}
                    onChange={(v) => {
                      const newAway = num(v);
                      if (newAway === "" && draftBoost) setDraftBoost(false);
                      setDraftAway(newAway);
                    }}
                    theme={theme}
                    disabled={isLocked}
                  />
                )}
              </div>
            </div>
          </div>

          {!isLocked && (
            <div style={{ borderTop: `1px solid ${theme.border}`, padding: "10px 14px", marginTop: "10px" }}>
              <button
                onClick={saveDraft}
                disabled={saveDisabled}
                style={{
                  width: "100%",
                  border: `1.5px solid ${predictedTab ? (showSaved ? "#16A34A" : "#DC2626") : theme.text}`,
                  background: predictedTab ? (showSaved ? "#16A34A" : "transparent") : showSaved ? theme.text : "transparent",
                  color: predictedTab ? (showSaved ? "#FFFFFF" : "#DC2626") : showSaved ? theme.surface : theme.text,
                  borderRadius: "8px",
                  padding: "9px 18px",
                  fontFamily: "Cairo, sans-serif",
                  fontWeight: 800,
                  fontSize: "12px",
                  cursor: saveDisabled ? "not-allowed" : "pointer",
                  opacity: saveDisabled && !showSaved ? 0.5 : 1,
                  whiteSpace: "nowrap",
                }}
              >
                {showSaved ? "تم الحفظ" : "حفظ التوقع"}
              </button>
            </div>
          )}
        </div>

        {/* Finished/locked match: read-only footer with three equal cells -
            boost used, actual result (+ winner logo), and points earned. */}
        {isLocked && !hideResult && (
          <MatchResultFooter
            match={match}
            theme={theme}
            hasActual={hasActual}
            result={result}
            colors={colors}
            noPrediction={noPrediction}
          />
        )}
      </div>
    </div>
  );
}

function ScoreBoxStatic({ value, theme }) {
  return (
    <div
      style={{
        width: "38px",
        height: "38px",
        borderRadius: "8px",
        border: "1px solid #000000",
        background: theme.bg,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "Cairo, sans-serif",
        fontWeight: 800,
        fontSize: "15px",
        lineHeight: "1",
        paddingTop: "1px",
        color: theme.text,
      }}
    >
      {value === "" || value == null ? "-" : value}
    </div>
  );
}

function ResultPill({ theme, border, bg, color, bold, compact, children }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: "64px",
        boxSizing: "border-box",
        borderRadius: "7px",
        padding: compact ? "3px 6px" : "5px 6px",
        fontSize: compact ? "10px" : "11px",
        marginTop: compact ? "0" : "11px",
        fontFamily: "Cairo, sans-serif",
        fontWeight: bold ? 800 : 600,
        border: `1.5px solid ${border}`,
        background: bg,
        color,
      }}
    >
      {children}
    </span>
  );
}

function MatchResultFooter({ match, theme, hasActual, result, colors, noPrediction }) {
  const winnerLogo = hasActual
    ? match.actualHome > match.actualAway
      ? match.homeLogo
      : match.actualAway > match.actualHome
      ? match.awayLogo
      : null
    : null;
  const winnerName = hasActual
    ? match.actualHome > match.actualAway
      ? match.home
      : match.actualAway > match.actualHome
      ? match.away
      : null
    : null;

  return (
    <div style={{ display: "flex", borderTop: `1px solid ${theme.border}` }}>
      <div style={{ flex: 1, textAlign: "center", padding: "8px 4px", borderLeft: `1px solid ${theme.border}` }}>
        <div style={{ fontSize: "11px", color: theme.muted, marginBottom: "5px" }}>مضاعفة النقاط</div>
        {match.doublePoints ? (
          <ResultPill theme={theme} border={theme.yellow} bg={theme.yellowSoft} color={theme.yellow} bold>
            دبل
          </ResultPill>
        ) : match.userBoost ? (
          <ResultPill theme={theme} border={theme.yellow} bg={theme.yellowSoft} color={theme.yellow} bold>
            تربل
          </ResultPill>
        ) : (
          <ResultPill theme={theme} border={theme.inputBorder} bg={theme.bg} color={theme.muted} bold>
            لا يوجد
          </ResultPill>
        )}
      </div>
      <div style={{ flex: 1, textAlign: "center", padding: "8px 4px", borderLeft: `1px solid ${theme.border}` }}>
        <div style={{ fontSize: "11px", color: theme.muted, marginBottom: "5px" }}>النتيجة الفعلية</div>
        <ResultPill theme={theme} border={theme.violet} bg={theme.bg} color={theme.violet} bold>
          {hasActual ? `${match.actualHome} - ${match.actualAway}` : "لم تنتهِ"}
        </ResultPill>
        <div style={{ height: "22px", display: "flex", alignItems: "center", justifyContent: "center", marginTop: "4px" }}>
          {winnerLogo !== null || winnerName ? <ClubLogo logo={winnerLogo} name={winnerName} theme={theme} size={16} /> : null}
        </div>
      </div>
      <div style={{ flex: 1, textAlign: "center", padding: "8px 4px" }}>
        <div style={{ fontSize: "11px", color: theme.muted, marginBottom: "5px" }}>نقاطك</div>
        {result ? (
          <ResultPill theme={theme} border={colors.ring} bg={colors.bg} color={colors.text} bold>
            {result.points}
          </ResultPill>
        ) : noPrediction ? (
          <ResultPill theme={theme} border={theme.danger} bg={theme.dangerSoft} color={theme.danger} bold>
            لم تتوقع
          </ResultPill>
        ) : (
          <ResultPill theme={theme} border={theme.inputBorder} bg={theme.bg} color={theme.muted} bold>
            —
          </ResultPill>
        )}
      </div>
    </div>
  );
}

function Scoreboard({ match, onChange, onRemove, tournaments, onAddTournament, clubsByTournament, tournamentLogos, allPredictionRows, theme }) {
  const num = (v) => (v === "" ? "" : String(v).replace(/[^0-9]/g, "").slice(0, 2));

  // Local draft: edits accumulate here and only commit to the real match
  // (via onChange) when "حفظ" is pressed. This matters specifically for the
  // date field, since changing it could move the match to the "المنتهية"
  // tab immediately - staging the edit avoids that until the admin is done.
  const [draft, setDraft] = useState(match);
  const [dirty, setDirty] = useState(false);

  // If the match changes from outside (e.g. another tab/sync), and there
  // are no unsaved local edits, refresh the draft to match it.
  useEffect(() => {
    if (!dirty) setDraft(match);
  }, [match, dirty]);

  const updateDraft = (updated) => {
    setDraft(updated);
    setDirty(true);
  };

  const save = () => {
    onChange(draft);
    setDirty(false);
  };

  const kickoffISO = draft.date && draft.time ? `${draft.date}T${draft.time}:00+03:00` : null;
  const naturallyLocked = kickoffISO ? new Date(kickoffISO).getTime() - serverNow() <= 0 : false;

  // المنظم يقدر يفتح مباراة منتهية للتعديل بعد تأكيد، بدل ما تبقى مقفلة للأبد.
  const [forceUnlocked, setForceUnlocked] = useState(false);
  const isLocked = naturallyLocked && !forceUnlocked;

  const clubs = clubsByTournament?.[draft.tournament] || [];

  return (
    <div style={{ marginBottom: "14px" }}>
      <div
        style={{
          background: theme.surface,
          border: `1.5px solid ${theme.violet}`,
          borderRadius: "14px",
          overflow: "hidden",
        }}
      >
        <TournamentPicker
          value={draft.tournament}
          onChange={(t) => updateDraft({ ...draft, tournament: t, home: "", away: "", homeLogo: null, awayLogo: null })}
          tournaments={tournaments}
          onAddTournament={onAddTournament}
          tournamentLogos={tournamentLogos}
          theme={theme}
          noMargin
          topRadius="0"
        />
        <div style={{ background: theme.bg }}>
          <DateTimeRow match={draft} onChange={updateDraft} theme={theme} disabled={isLocked} />
        </div>
        <DoublePointsToggle match={draft} onChange={updateDraft} theme={theme} disabled={isLocked} />
        <div style={{ padding: "16px 18px 18px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "8px" }}>
            <div style={{ width: "24px", flexShrink: 0 }} />
            <div style={{ display: "flex", flexDirection: "column", gap: "4px", flex: 1, minWidth: 0 }}>
              <TeamPicker
                value={draft.home}
                logo={draft.homeLogo}
                onChange={(name, logo) => updateDraft({ ...draft, home: name, homeLogo: logo })}
                clubs={clubs}
                placeholder="الفريق الأول"
                theme={theme}
                disabled={naturallyLocked}
              />
              <button
                onClick={() => updateDraft({ ...draft, venueTeam: draft.venueTeam === "home" ? null : "home" })}
                disabled={naturallyLocked}
                title="حدد الفريق الأول كصاحب أرض"
                style={{
                  alignSelf: "center",
                  background: draft.venueTeam === "home" ? theme.violetSoft : "transparent",
                  border: `1px solid ${draft.venueTeam === "home" ? theme.violet : theme.inputBorder}`,
                  color: draft.venueTeam === "home" ? theme.violet : theme.muted,
                  borderRadius: "8px",
                  padding: "3px 10px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: naturallyLocked ? "not-allowed" : "pointer",
                }}
              >
                <Home size={14} />
              </button>
            </div>
            <span style={{ color: theme.muted, fontSize: "12px", fontWeight: 600, flexShrink: 0 }}>ضد</span>
            <div style={{ display: "flex", flexDirection: "column", gap: "4px", flex: 1, minWidth: 0 }}>
              <TeamPicker
                value={draft.away}
                logo={draft.awayLogo}
                onChange={(name, logo) => updateDraft({ ...draft, away: name, awayLogo: logo })}
                clubs={clubs}
                placeholder="الفريق الثاني"
                theme={theme}
                disabled={naturallyLocked}
              />
              <button
                onClick={() => updateDraft({ ...draft, venueTeam: draft.venueTeam === "away" ? null : "away" })}
                disabled={naturallyLocked}
                title="حدد الفريق الثاني كصاحب أرض"
                style={{
                  alignSelf: "center",
                  background: draft.venueTeam === "away" ? theme.violetSoft : "transparent",
                  border: `1px solid ${draft.venueTeam === "away" ? theme.violet : theme.inputBorder}`,
                  color: draft.venueTeam === "away" ? theme.violet : theme.muted,
                  borderRadius: "8px",
                  padding: "3px 10px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: naturallyLocked ? "not-allowed" : "pointer",
                }}
              >
                <Home size={14} />
              </button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "4px", flexShrink: 0 }}>
              <button
                onClick={() => {
                  if (window.confirm("حذف هذي المباراة نهائيًا؟")) onRemove();
                }}
                aria-label="حذف المباراة"
                style={{
                  background: "transparent",
                  border: "none",
                  color: theme.muted,
                  cursor: "pointer",
                  padding: "4px",
                  width: "24px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Trash2 size={16} />
              </button>
              {naturallyLocked && (
                <button
                  onClick={() => {
                    if (forceUnlocked) {
                      setForceUnlocked(false);
                    } else if (window.confirm("تبي تعدل هذي المباراة المنتهية؟")) {
                      setForceUnlocked(true);
                    }
                  }}
                  aria-label="تعديل المباراة"
                  style={{
                    background: "transparent",
                    border: "none",
                    color: forceUnlocked ? theme.primary : theme.muted,
                    cursor: "pointer",
                    padding: "4px",
                    width: "24px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Pencil size={16} />
                </button>
              )}
            </div>
          </div>

          {/* Admin only enters the actual result - no predictions, no points */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div style={{ fontSize: "11px", color: theme.muted, fontWeight: 600, marginBottom: "8px" }}>
              النتيجة الفعلية
            </div>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <ScoreInput value={draft.actualHome} onChange={(v) => updateDraft({ ...draft, actualHome: num(v) })} actual theme={theme} />
              <span style={{ color: theme.muted, fontWeight: 700 }}>-</span>
              <ScoreInput value={draft.actualAway} onChange={(v) => updateDraft({ ...draft, actualAway: num(v) })} actual theme={theme} />
            </div>
          </div>

          {/* Save button */}
          <button
            onClick={save}
            disabled={!dirty}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "6px",
              width: "100%",
              marginTop: "16px",
              padding: "10px 0",
              borderRadius: "10px",
              border: "none",
              background: dirty ? theme.violet : theme.inputBorder,
              color: dirty ? "#FFFFFF" : theme.muted,
              fontFamily: "Cairo, sans-serif",
              fontWeight: 700,
              fontSize: "10px",
              cursor: dirty ? "pointer" : "not-allowed",
            }}
          >
            <Check size={15} />
            {dirty ? "حفظ التعديلات" : "تم الحفظ"}
          </button>
        </div>

        {allPredictionRows && (() => {
          const matchPreds = allPredictionRows
            .filter((r) => r.match_id === match.id && r.pred_home !== null && r.pred_away !== null)
            .sort((a, b) => new Date(a.updated_at) - new Date(b.updated_at));
          if (matchPreds.length === 0) return null;
          const fmt = (iso) => {
            if (!iso) return "—";
            const d = new Date(iso);
            const day = d.getDate();
            const month = d.toLocaleDateString("en-GB", { month: "short" });
            const year = d.getFullYear();
            const time = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
            return `${day} ${month} ${year} ${time}`;
          };
          return (
            <div style={{ borderTop: `1px solid ${theme.border}` }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 60px 1fr", padding: "6px 12px", borderBottom: `1px solid ${theme.border}`, background: theme.bg }}>
                <span style={{ fontSize: "9px", fontWeight: 700, color: theme.muted }}>المشارك</span>
                <span style={{ fontSize: "9px", fontWeight: 700, color: theme.muted, textAlign: "center" }}>التوقع</span>
                <span style={{ fontSize: "9px", fontWeight: 700, color: theme.muted, textAlign: "left" }}>وقت الإدخال</span>
              </div>
              {matchPreds.map((r) => (
                <div key={r.user_id} style={{ display: "grid", gridTemplateColumns: "1fr 60px 1fr", alignItems: "center", padding: "7px 12px", borderBottom: `1px solid ${theme.border}` }}>
                  <span style={{ fontSize: "11px", fontWeight: 700, color: theme.text }}>{r.profiles?.name || "—"}</span>
                  <span style={{ fontSize: "11px", fontWeight: 800, color: theme.violet, textAlign: "center" }}>{r.pred_away}-{r.pred_home}</span>
                  <span dir="ltr" style={{ fontSize: "9px", color: theme.muted, textAlign: "left", display: "block" }}>{fmt(r.updated_at)}</span>
                </div>
              ))}
            </div>
          );
        })()}
      </div>
    </div>
  );
}

// Helper: convert an uploaded image file to a base64 data URL for in-session
// storage (no backend yet, so this only persists for the current browser tab).
// Generates a random 6-character join code (letters + numbers) for a new
// private league, e.g. "ABC123".
function generateLeagueCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I to avoid confusion
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// Tiebreaker comparator: when total points are equal, the player with more
// 10-point results ranks higher; if still tied, compare 5-point counts,
// then 4, then 3, then 1, in that order, until the tie is broken.
const TIEBREAK_TIER_ORDER = [10, 5, 4, 3, 1];
function compareTierCounts(a, b) {
  for (const tier of TIEBREAK_TIER_ORDER) {
    const diff = (b[tier] || 0) - (a[tier] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// Shared real-data ranking: scores every registered user from their own
// actual predictions on the given (already filtered) matches, using the same
// rules as the stats page (calcPoints + the admin x2 / personal x3
// multiplier). Used by the global leaderboard and the home page summary.
function computeGlobalRanking(matches, allPredictionRows, currentUser) {
  const matchById = Object.fromEntries(matches.map((m) => [m.id, m]));

  const finishedMatchIds = new Set(matches.filter(isMatchFinished).map((m) => m.id));
  const finishedMatchCount = finishedMatchIds.size;

  // Find the last finished match kickoff time to use for tiebreaker
  const finishedMatches = matches.filter(isMatchFinished);
  const lastFinishedMatch = finishedMatches.length > 0
    ? finishedMatches.reduce((a, b) => new Date(`${a.date}T${a.time}:00+03:00`) > new Date(`${b.date}T${b.time}:00+03:00`) ? a : b)
    : null;

  const byUser = {};
  const predictedMatchIdsByUser = {};
  for (const row of allPredictionRows) {
    const match = matchById[row.match_id];
    if (!match) continue;
    if (!isMatchFinished(match)) continue;

    if (!byUser[row.user_id]) {
      byUser[row.user_id] = {
        id: row.user_id,
        name: row.profiles?.name || "مستخدم",
        username: row.profiles?.username || null,
        points: 0,
        tierCounts: { 10: 0, 5: 0, 4: 0, 3: 0, 1: 0, 0: 0, none: 0 },
        lastMatchPredAt: null,
      };
      predictedMatchIdsByUser[row.user_id] = new Set();
    }
    const entry = byUser[row.user_id];

    // Track when this user submitted their prediction for the last finished match
    if (lastFinishedMatch && row.match_id === lastFinishedMatch.id && row.updated_at) {
      entry.lastMatchPredAt = row.updated_at;
    }

    const adminMultiplier = match.doublePoints ? 2 : 1;
    const userMultiplier = row.user_boost ? 3 : 1;
    const multiplier = match.doublePoints ? adminMultiplier : userMultiplier;

    const hasPrediction = row.pred_home !== null && row.pred_home !== undefined && row.pred_away !== null && row.pred_away !== undefined;
    if (!hasPrediction) {
      entry.tierCounts.none += 1;
      predictedMatchIdsByUser[row.user_id].add(row.match_id);
      continue;
    }
    predictedMatchIdsByUser[row.user_id].add(row.match_id);
    const result = calcPoints(row.pred_home, row.pred_away, match.actualHome, match.actualAway, multiplier);
    if (result) {
      entry.tierCounts[result.basePoints] = (entry.tierCounts[result.basePoints] || 0) + 1;
      entry.points += result.points;
    }
  }

  // Count finished matches the user never submitted a prediction row for
  for (const userId in byUser) {
    const missed = finishedMatchCount - (predictedMatchIdsByUser[userId]?.size || 0);
    if (missed > 0) byUser[userId].tierCounts.none += missed;
  }

  const players = Object.values(byUser).map((p) => ({ ...p, isYou: currentUser && p.id === currentUser.id }));

  if (currentUser && !players.some((p) => p.id === currentUser.id)) {
    players.push({
      id: currentUser.id,
      name: currentUser.name,
      username: currentUser.username,
      points: 0,
      tierCounts: { 10: 0, 5: 0, 4: 0, 3: 0, 1: 0, 0: 0, none: finishedMatchCount },
      isYou: true,
    });
  }

  return [...players].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    const tierDiff = compareTierCounts(a.tierCounts, b.tierCounts);
    if (tierDiff !== 0) return tierDiff;
    // Tiebreaker: earliest prediction on last finished match wins
    if (a.lastMatchPredAt && b.lastMatchPredAt) return new Date(a.lastMatchPredAt) - new Date(b.lastMatchPredAt);
    if (a.lastMatchPredAt) return -1;
    if (b.lastMatchPredAt) return 1;
    return 0;
  });
}

// Logos/avatars are stored as base64 directly in the database (no file
// storage bucket), so an unresized phone photo can be several MB - and since
// every match/club/tournament row embeds its logo, that gets re-downloaded
// in full on every page load. Downscaling to a small logo-sized canvas before
// encoding keeps each image to a few KB so the page loads quickly.
function fileToBase64(file, callback) {
  const MAX_SIZE = 200;
  const img = new Image();
  const reader = new FileReader();
  reader.onload = () => {
    img.onload = () => {
      const scale = Math.min(1, MAX_SIZE / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      callback(canvas.toDataURL("image/png"));
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

function ClubLogo({ logo, name, theme, size = 32 }) {
  const initial = (name || "").trim().charAt(0) || "؟";
  if (logo) {
    return (
      <div
        style={{
          width: size,
          height: size,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <img
          src={logo}
          alt={name}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
          }}
        />
      </div>
    );
  }
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: theme.bg,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.4,
        fontWeight: 700,
        color: theme.muted,
        flexShrink: 0,
      }}
    >
      {initial}
    </div>
  );
}

// Visually matches TournamentPicker (rectangular bar + dropdown with search),
// but used for filtering a list rather than assigning a tournament to a
// match. Always includes "الكل" (All) as the first option, and never lets
// the user add a new tournament from here (that stays admin-only).
function TournamentFilterPicker({ value, onChange, tournaments, tournamentLogos, theme }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const allOptions = ["الكل", ...tournaments];
  const filtered = allOptions.filter((t) => t.includes(query.trim()));

  return (
    <div ref={ref} style={{ position: "relative", marginBottom: "20px" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          background: theme.surface,
          color: theme.text,
          border: `1.5px solid ${theme.violet}`,
          borderRadius: open ? "10px 10px 0 0" : "10px",
          padding: "10px 14px",
          fontFamily: "Cairo, sans-serif",
          fontWeight: 700,
          fontSize: "10px",
          cursor: "pointer",
          width: "100%",
          justifyContent: "space-between",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          {value === "الكل" ? <Globe size={11} color={theme.muted} /> : <TournamentIcon name={value} logo={tournamentLogos?.[value]} theme={theme} color={theme.muted} />}
          {value}
        </span>
        <ChevronDown size={11} color={theme.muted} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            right: 0,
            left: 0,
            zIndex: 20,
            background: theme.surface,
            border: `1.5px solid ${theme.violet}`,
            borderTop: "none",
            borderRadius: "0 0 10px 10px",
            boxShadow: "0 8px 20px rgba(0,0,0,0.18)",
            maxHeight: "260px",
            overflowY: "auto",
          }}
        >
          <div style={{ padding: "8px", borderBottom: `1px solid ${theme.border}`, display: "flex", alignItems: "center", gap: "6px" }}>
            <Search size={11} color={theme.muted} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="بحث عن بطولة..."
              style={{
                border: "none",
                outline: "none",
                flex: 1,
                fontFamily: "Cairo, sans-serif",
                fontSize: "16px",
                color: theme.text,
                background: "transparent",
              }}
            />
          </div>

          {filtered.map((t) => (
            <div
              key={t}
              onClick={() => {
                onChange(t);
                setOpen(false);
                setQuery("");
              }}
              style={{
                padding: "10px 12px",
                fontSize: "10px",
                fontFamily: "Cairo, sans-serif",
                color: t === value ? theme.violet : theme.text,
                fontWeight: t === value ? 700 : 400,
                background: t === value ? theme.violetSoft : "transparent",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = theme.bg)}
              onMouseLeave={(e) => (e.currentTarget.style.background = t === value ? theme.violetSoft : "transparent")}
            >
              {t === "الكل" ? <Globe size={11} color={t === value ? theme.violet : theme.muted} /> : <TournamentIcon name={t} logo={tournamentLogos?.[t]} theme={theme} color={t === value ? theme.violet : theme.muted} />}
              {t}
            </div>
          ))}

          {filtered.length === 0 && (
            <div style={{ padding: "14px", fontSize: "12px", color: theme.muted, textAlign: "center" }}>
              لا توجد بطولات مطابقة
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const AR_MONTHS = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];

function monthLabel(ym) {
  if (!ym) return "الكل";
  const [y, m] = ym.split("-");
  return `${AR_MONTHS[parseInt(m, 10) - 1]} ${y}`;
}

function getFinishedMonths() {
  // Fixed season months: Aug 2026 → Jun 2027
  return [
    "2026-08","2026-09","2026-10","2026-11","2026-12",
    "2027-01","2027-02","2027-03","2027-04","2027-05","2027-06",
  ];
}

function filterMatchesByMonth(matches, month) {
  if (!month || month === "الكل") return matches;
  return matches.filter((m) => m.date && m.date.slice(0, 7) === month);
}

function MonthFilterPicker({ value, onChange, matches, theme }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const months = getFinishedMonths();
  const options = ["الكل", ...months];

  return (
    <div ref={ref} style={{ position: "relative", marginBottom: "12px" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex", alignItems: "center", gap: "6px",
          background: theme.surface, color: theme.text,
          border: `1.5px solid ${value !== "الكل" ? theme.violet : theme.border}`,
          borderRadius: open ? "10px 10px 0 0" : "10px",
          padding: "10px 14px", fontFamily: "Cairo, sans-serif",
          fontWeight: 700, fontSize: "10px", cursor: "pointer",
          width: "100%", justifyContent: "space-between",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          {value === "الكل" && <Globe size={11} color={theme.muted} />}
          {value === "الكل" ? "الكل" : monthLabel(value)}
        </span>
        <ChevronDown size={11} color={theme.muted} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
      </button>

      {open && (
        <div style={{
          position: "absolute", top: "100%", right: 0, left: 0, zIndex: 20,
          background: theme.surface, border: `1.5px solid ${theme.violet}`,
          borderTop: "none", borderRadius: "0 0 10px 10px",
          boxShadow: "0 8px 20px rgba(0,0,0,0.18)", maxHeight: "260px", overflowY: "auto",
        }}>
          {options.map((opt) => (
            <div
              key={opt}
              onClick={() => { onChange(opt); setOpen(false); }}
              style={{
                padding: "10px 14px", fontSize: "11px", fontFamily: "Cairo, sans-serif",
                color: opt === value ? theme.violet : theme.text,
                fontWeight: opt === value ? 700 : 400,
                background: opt === value ? theme.violetSoft : "transparent",
                cursor: "pointer",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = theme.bg)}
              onMouseLeave={(e) => (e.currentTarget.style.background = opt === value ? theme.violetSoft : "transparent")}
            >
              <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                {opt === "الكل" && <Globe size={11} color={opt === value ? theme.violet : theme.muted} />}
                {opt === "الكل" ? "الكل" : monthLabel(opt)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ClubsManagementPage({ tournaments, onAddTournament, clubsByTournament, onAddClub, onUpdateClub, onRemoveClub, tournamentLogos, onSetTournamentLogo, onRemoveTournament, theme }) {
  const [selectedTournament, setSelectedTournament] = useState("");
  const [newClubName, setNewClubName] = useState("");
  const [newClubLogo, setNewClubLogo] = useState(null);
  const [newTournamentName, setNewTournamentName] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [importSource, setImportSource] = useState("");
  const [importSelected, setImportSelected] = useState([]);
  const fileInputRef = useRef(null);

  const handleAddTournament = () => {
    const name = newTournamentName.trim();
    if (!name || tournaments.includes(name)) return;
    onAddTournament(name);
    setSelectedTournament(name);
    setNewTournamentName("");
  };

  const clubs = clubsByTournament[selectedTournament] || [];
  const importCandidates = clubsByTournament[importSource] || [];
  const existingNames = new Set(clubs.map((c) => c.name));

  const toggleImportClub = (clubId) => {
    setImportSelected((prev) => (prev.includes(clubId) ? prev.filter((id) => id !== clubId) : [...prev, clubId]));
  };

  const handleImportClubs = () => {
    const toImport = importCandidates.filter((c) => importSelected.includes(c.id));
    toImport.forEach((c) => {
      if (existingNames.has(c.name)) return;
      onAddClub(selectedTournament, { id: `c${Date.now()}${Math.random().toString(36).slice(2, 7)}`, name: c.name, logo: c.logo });
    });
    setImportSelected([]);
    setImportOpen(false);
    setImportSource("");
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    fileToBase64(file, (dataUrl) => setNewClubLogo(dataUrl));
  };

  const handleAddClub = () => {
    if (!newClubName.trim() || !selectedTournament) return;
    onAddClub(selectedTournament, {
      id: `c${Date.now()}`,
      name: newClubName.trim(),
      logo: newClubLogo,
    });
    setNewClubName("");
    setNewClubLogo(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div style={{ padding: "20px 16px 60px" }}>
      <div className="page-container">
        <h2 style={{ fontSize: "16px", fontWeight: 800, color: theme.primary, marginBottom: "4px" }}>
          إدارة الأندية
        </h2>
        <p style={{ fontSize: "12px", color: theme.muted, marginBottom: "18px" }}>
          اختر بطولة، وأضف أنديتها مع شعاراتها — تظهر تلقائيًا عند إدخال المباريات
        </p>

        {/* Add a new tournament - separate from the picker below */}
        <div
          style={{
            background: theme.surface,
            border: `1.5px solid ${theme.violet}`,
            borderRadius: "12px",
            padding: "14px",
            marginBottom: "14px",
          }}
        >
          <p style={{ fontSize: "12px", fontWeight: 700, color: theme.text, marginBottom: "10px" }}>
            إضافة بطولة جديدة
          </p>
          <div style={{ display: "flex", gap: "8px" }}>
            <input
              value={newTournamentName}
              onChange={(e) => setNewTournamentName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddTournament()}
              placeholder="اسم البطولة (مثلاً: الدوري الإنقليزي)"
              style={{
                flex: 1,
                border: `1.5px solid ${theme.inputBorder}`,
                borderRadius: "8px",
                padding: "8px 10px",
                fontFamily: "Cairo, sans-serif",
                fontSize: "16px",
                color: theme.text,
                background: theme.bg,
                outline: "none",
              }}
            />
            <button
              onClick={handleAddTournament}
              disabled={!newTournamentName.trim()}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                border: "none",
                borderRadius: "8px",
                padding: "8px 14px",
                background: newTournamentName.trim() ? theme.primary : theme.inputBorder,
                color: theme.surface,
                fontFamily: "Cairo, sans-serif",
                fontWeight: 700,
                fontSize: "12px",
                cursor: newTournamentName.trim() ? "pointer" : "not-allowed",
                whiteSpace: "nowrap",
              }}
            >
              <Plus size={11} />
              إضافة
            </button>
          </div>
        </div>

        {/* Tournament selector (reusing the same searchable picker style) - no inline add here */}
        <TournamentPicker
          value={selectedTournament}
          onChange={setSelectedTournament}
          tournaments={tournaments}
          onAddTournament={onAddTournament}
          allowAdd={false}
          tournamentLogos={tournamentLogos}
          theme={theme}
        />

        {/* Tournament logo upload - applies to the selected tournament and
            reflects everywhere that tournament's name is shown */}
        {selectedTournament && (
          <div
            style={{
              background: theme.surface,
              border: `1px solid ${theme.border}`,
              borderTop: "none",
              padding: "12px 16px",
              marginBottom: "0",
              display: "flex",
              alignItems: "center",
              gap: "10px",
            }}
          >
            <TournamentIcon
              name={selectedTournament}
              logo={tournamentLogos?.[selectedTournament]}
              size={32}
              theme={theme}
              color={theme.muted}
            />
            <span style={{ flex: 1, fontFamily: "Cairo, sans-serif", fontSize: "12px", color: theme.muted }}>
              شعار البطولة (يظهر بدل الأيقونة العامة بكل مكان)
            </span>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                fileToBase64(file, (dataUrl) => onSetTournamentLogo(selectedTournament, dataUrl));
              }}
              style={{ display: "none" }}
              id="tournament-logo-upload"
            />
            <label
              htmlFor="tournament-logo-upload"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                border: `1.5px dashed ${theme.inputBorder}`,
                borderRadius: "8px",
                padding: "6px 10px",
                fontFamily: "Cairo, sans-serif",
                fontSize: "11px",
                fontWeight: 600,
                color: theme.muted,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              <Upload size={13} />
              {tournamentLogos?.[selectedTournament] ? "تغيير الشعار" : "رفع شعار"}
            </label>
            <button
              onClick={() => {
                if (!window.confirm(`حذف بطولة "${selectedTournament}" نهائيًا مع كل أنديتها؟`)) return;
                onRemoveTournament(selectedTournament);
                setSelectedTournament("");
              }}
              aria-label="حذف البطولة"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: `1.5px solid ${theme.danger}`,
                borderRadius: "8px",
                padding: "6px",
                background: "transparent",
                color: theme.danger,
                cursor: "pointer",
              }}
            >
              <Trash2 size={13} />
            </button>
          </div>
        )}

        {/* Club list for the selected tournament */}
        {!selectedTournament ? (
          <div
            style={{
              background: theme.surface,
              border: `1px solid ${theme.border}`,
              borderTop: "none",
              borderRadius: "0 0 14px 14px",
              padding: "16px",
              marginBottom: "18px",
            }}
          >
            <p style={{ fontSize: "12px", color: theme.muted, textAlign: "center", padding: "12px 0" }}>
              أضف بطولة أولاً من الأعلى عشان تقدر تضيف أنديتها
            </p>
          </div>
        ) : (
        <div
          style={{
            background: theme.surface,
            border: `1px solid ${theme.border}`,
            borderTop: "none",
            borderRadius: "0 0 14px 14px",
            padding: "16px",
            marginBottom: "18px",
          }}
        >
          {clubs.length === 0 ? (
            <p style={{ fontSize: "12px", color: theme.muted, textAlign: "center", padding: "12px 0" }}>
              لا توجد أندية مضافة لهذي البطولة بعد
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "16px" }}>
              {clubs.map((club) => (
                <div
                  key={club.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    padding: "8px 10px",
                    borderRadius: "10px",
                    background: theme.bg,
                  }}
                >
                  <ClubLogo logo={club.logo} name={club.name} theme={theme} />
                  <span style={{ flex: 1, fontFamily: "Cairo, sans-serif", fontSize: "10px", fontWeight: 600, color: theme.text }}>
                    {club.name}
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (!file) return;
                      fileToBase64(file, (dataUrl) => onUpdateClub(selectedTournament, club.id, { name: club.name, logo: dataUrl }));
                    }}
                    style={{ display: "none" }}
                    id={`club-logo-edit-${club.id}`}
                  />
                  <label
                    htmlFor={`club-logo-edit-${club.id}`}
                    aria-label="تعديل شعار النادي"
                    style={{ background: "transparent", border: "none", color: theme.muted, cursor: "pointer", display: "flex" }}
                  >
                    <Pencil size={15} />
                  </label>
                  <button
                    onClick={() => onRemoveClub(selectedTournament, club.id)}
                    aria-label="حذف النادي"
                    style={{ background: "transparent", border: "none", color: theme.muted, cursor: "pointer", display: "flex" }}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Import existing clubs from another tournament */}
          {tournaments.filter((t) => t !== selectedTournament).length > 0 && (
            <div style={{ marginBottom: "16px" }}>
              <button
                onClick={() => setImportOpen((o) => !o)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "6px",
                  width: "100%",
                  border: `1.5px dashed ${theme.violet}`,
                  borderRadius: "8px",
                  padding: "8px",
                  background: "transparent",
                  color: theme.violet,
                  fontFamily: "Cairo, sans-serif",
                  fontWeight: 700,
                  fontSize: "12px",
                  cursor: "pointer",
                }}
              >
                <Upload size={11} />
                استيراد أندية من بطولة أخرى
              </button>

              {importOpen && (
                <div
                  style={{
                    marginTop: "10px",
                    border: `1px solid ${theme.border}`,
                    borderRadius: "10px",
                    padding: "12px",
                    background: theme.bg,
                  }}
                >
                  <TournamentPicker
                    value={importSource}
                    onChange={(name) => {
                      setImportSource(name);
                      setImportSelected([]);
                    }}
                    tournaments={tournaments.filter((t) => t !== selectedTournament)}
                    onAddTournament={() => {}}
                    allowAdd={false}
                    tournamentLogos={tournamentLogos}
                    theme={theme}
                  />

                  {importSource && (
                    <>
                      {importCandidates.length === 0 ? (
                        <p style={{ fontSize: "12px", color: theme.muted, textAlign: "center", padding: "10px 0" }}>
                          هذي البطولة ما فيها أندية بعد
                        </p>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "8px" }}>
                          {(() => {
                            const selectableIds = importCandidates.filter((c) => !existingNames.has(c.name)).map((c) => c.id);
                            const allSelected = selectableIds.length > 0 && selectableIds.every((id) => importSelected.includes(id));
                            return (
                              <label
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "10px",
                                  padding: "6px 8px",
                                  borderRadius: "8px",
                                  borderBottom: `1px solid ${theme.border}`,
                                  marginBottom: "4px",
                                  cursor: selectableIds.length > 0 ? "pointer" : "not-allowed",
                                  opacity: selectableIds.length > 0 ? 1 : 0.5,
                                }}
                              >
                                <input
                                  type="checkbox"
                                  disabled={selectableIds.length === 0}
                                  checked={allSelected}
                                  onChange={() => setImportSelected(allSelected ? [] : selectableIds)}
                                />
                                <span style={{ fontFamily: "Cairo, sans-serif", fontSize: "12px", fontWeight: 700, color: theme.text }}>
                                  تحديد الكل
                                </span>
                              </label>
                            );
                          })()}
                          {importCandidates.map((c) => {
                            const alreadyAdded = existingNames.has(c.name);
                            return (
                              <label
                                key={c.id}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "10px",
                                  padding: "6px 8px",
                                  borderRadius: "8px",
                                  background: theme.surface,
                                  opacity: alreadyAdded ? 0.5 : 1,
                                  cursor: alreadyAdded ? "not-allowed" : "pointer",
                                }}
                              >
                                <input
                                  type="checkbox"
                                  disabled={alreadyAdded}
                                  checked={importSelected.includes(c.id)}
                                  onChange={() => toggleImportClub(c.id)}
                                />
                                <ClubLogo logo={c.logo} name={c.name} theme={theme} size={26} />
                                <span style={{ flex: 1, fontFamily: "Cairo, sans-serif", fontSize: "12px", fontWeight: 600, color: theme.text }}>
                                  {c.name}
                                </span>
                                {alreadyAdded && (
                                  <span style={{ fontSize: "10px", color: theme.muted }}>مضاف بالفعل</span>
                                )}
                              </label>
                            );
                          })}
                        </div>
                      )}

                      <button
                        onClick={handleImportClubs}
                        disabled={importSelected.length === 0}
                        style={{
                          marginTop: "10px",
                          width: "100%",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: "6px",
                          border: "none",
                          borderRadius: "8px",
                          padding: "8px",
                          background: importSelected.length > 0 ? theme.primary : theme.inputBorder,
                          color: theme.surface,
                          fontFamily: "Cairo, sans-serif",
                          fontWeight: 700,
                          fontSize: "12px",
                          cursor: importSelected.length > 0 ? "pointer" : "not-allowed",
                        }}
                      >
                        <Plus size={11} />
                        استيراد المحدد ({importSelected.length})
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Add new club form */}
          <div style={{ display: "flex", flexDirection: "column", gap: "10px", paddingTop: clubs.length > 0 ? "12px" : 0, borderTop: clubs.length > 0 ? `1px solid ${theme.border}` : "none" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <ClubLogo logo={newClubLogo} name={newClubName} theme={theme} />
              <input
                value={newClubName}
                onChange={(e) => setNewClubName(e.target.value)}
                placeholder="اسم النادي"
                style={{
                  flex: 1,
                  border: `1.5px solid ${theme.inputBorder}`,
                  borderRadius: "8px",
                  padding: "8px 10px",
                  fontFamily: "Cairo, sans-serif",
                  fontSize: "16px",
                  color: theme.text,
                  background: theme.bg,
                  outline: "none",
                }}
              />
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                style={{ display: "none" }}
                id="club-logo-upload"
              />
              <label
                htmlFor="club-logo-upload"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  border: `1.5px dashed ${theme.inputBorder}`,
                  borderRadius: "8px",
                  padding: "7px 12px",
                  fontFamily: "Cairo, sans-serif",
                  fontSize: "12px",
                  fontWeight: 600,
                  color: theme.muted,
                  cursor: "pointer",
                }}
              >
                <Upload size={11} />
                {newClubLogo ? "تغيير الشعار" : "رفع شعار"}
              </label>
              <button
                onClick={handleAddClub}
                disabled={!newClubName.trim()}
                style={{
                  flex: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "6px",
                  border: "none",
                  borderRadius: "8px",
                  padding: "8px",
                  background: newClubName.trim() ? theme.primary : theme.inputBorder,
                  color: theme.surface,
                  fontFamily: "Cairo, sans-serif",
                  fontWeight: 700,
                  fontSize: "12px",
                  cursor: newClubName.trim() ? "pointer" : "not-allowed",
                }}
              >
                <Plus size={11} />
                إضافة النادي
              </button>
            </div>
          </div>
        </div>
        )}
      </div>
    </div>
  );
}

function PlayerAvatar({ name, isYou, theme, size = 32 }) {
  const initial = (name || "").trim().charAt(0) || "؟";
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: isYou ? theme.primarySoft : theme.bg,
        border: `1.5px solid ${isYou ? theme.primary : theme.inputBorder}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.4,
        fontWeight: 700,
        color: isYou ? theme.primary : theme.muted,
        flexShrink: 0,
      }}
    >
      {initial}
    </div>
  );
}

function LeaderboardRow({ rank, name, username, points, isYou, theme, onViewProfile }) {
  return (
    <div
      onClick={onViewProfile}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        padding: "10px 12px",
        borderRadius: "10px",
        background: isYou ? theme.primarySoft : theme.surface,
        border: `1px solid ${isYou ? theme.primary : theme.border}`,
        cursor: onViewProfile ? "pointer" : "default",
      }}
    >
      <div style={{ width: "22px", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        {rank === 1 ? (
          <Crown size={15} color={theme.yellow} />
        ) : (
          <span style={{ fontFamily: "Cairo, sans-serif", fontSize: "12px", fontWeight: 700, color: theme.muted }}>
            {rank}
          </span>
        )}
      </div>
      <PlayerAvatar name={name} isYou={isYou} theme={theme} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <span
          style={{
            fontFamily: "Cairo, sans-serif",
            fontWeight: isYou ? 700 : 600,
            fontSize: "10px",
            color: theme.text,
          }}
        >
          {name} {isYou && <span style={{ fontSize: "10px", color: theme.primary }}>(أنت)</span>}
        </span>
        {username && (
          <span dir="ltr" style={{ fontFamily: "system-ui, -apple-system, sans-serif", fontSize: "10px", color: theme.muted, textAlign: "right", letterSpacing: "0.5px" }}>
            @{username}
          </span>
        )}
      </div>
      <span style={{ fontFamily: "Cairo, sans-serif", fontWeight: 800, fontSize: "14px", color: theme.primary }}>
        {points}
      </span>
    </div>
  );
}

function UserProfilePage({ user, matches, allPredictionRows, onBack, theme }) {
  // Always compute global stats so the profile shows the same numbers
  // regardless of whether the user was tapped from the global leaderboard
  // or from inside a private league (which may be filtered to a subset).
  const userId = user.userId || user.id;
  const { globalEntry, globalRank } = useMemo(() => {
    const ranked = computeGlobalRanking(matches, allPredictionRows, null);
    const idx = ranked.findIndex((p) => p.id === userId);
    return { globalEntry: idx >= 0 ? ranked[idx] : null, globalRank: idx >= 0 ? idx + 1 : null };
  }, [matches, allPredictionRows, userId]);

  const tierColors = [
    { key: 10, color: theme.accent, label: TIERS_META[0].label },
    { key: 5, color: theme.navyBlue, label: TIERS_META[1].label },
    { key: 4, color: theme.sky, label: TIERS_META[2].label },
    { key: 3, color: theme.muted, label: TIERS_META[3].label },
    { key: 1, color: theme.inputBorder, label: TIERS_META[4].label },
    { key: 0, color: theme.danger, label: TIERS_META[5].label },
    { key: "none", color: theme.violet, label: "لم يتم توقعها" },
  ];

  const tierCounts = (globalEntry?.tierCounts) || { 10: 0, 5: 0, 4: 0, 3: 0, 1: 0, 0: 0, none: 0 };
  const globalPoints = globalEntry?.points ?? 0;
  const totalScored = tierColors.reduce((sum, t) => sum + (tierCounts[t.key] || 0), 0);

  let acc = 0;
  const segmentStartByKey = {};
  const gradientStops = tierColors
    .filter((t) => tierCounts[t.key] > 0)
    .map((t) => {
      const from = (acc / totalScored) * 100;
      segmentStartByKey[t.key] = acc;
      acc += tierCounts[t.key];
      const to = (acc / totalScored) * 100;
      return `${t.color} ${from}% ${to}%`;
    });

  const name = globalEntry?.name || user.name || user.displayName || "؟";
  const username = globalEntry?.username || user.username || null;
  const initial = name.charAt(0).toUpperCase();

  return (
    <div style={{ padding: "20px 16px 60px" }}>
      <div className="page-container">
        <button
          onClick={onBack}
          style={{ background: "none", border: "none", cursor: "pointer", color: theme.primary, fontFamily: "Cairo, sans-serif", fontWeight: 700, fontSize: "13px", padding: "0 0 16px 0", display: "flex", alignItems: "center", gap: "4px" }}
        >
          <ChevronRight size={16} /> رجوع
        </button>

        {/* Avatar + name */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "10px", marginBottom: "24px" }}>
          <div style={{ width: "80px", height: "80px", borderRadius: "50%", background: theme.violetSoft, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "30px", fontWeight: 800, color: theme.violet }}>
            {initial}
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "18px", fontWeight: 800, color: theme.text }}>{name}</div>
            {username && <div dir="ltr" style={{ fontFamily: "system-ui, -apple-system, sans-serif", fontSize: "13px", color: theme.muted, letterSpacing: "0.5px" }}>@{username}</div>}
          </div>
          <div style={{ display: "flex", gap: "10px" }}>
            <div style={{ background: theme.violetSoft, color: theme.violet, borderRadius: "10px", padding: "6px 18px", textAlign: "center" }}>
              <div style={{ fontSize: "11px", fontWeight: 600, marginBottom: "2px" }}>إجمالي النقاط</div>
              <div style={{ fontSize: "22px", fontWeight: 900 }}>{globalPoints}</div>
            </div>
            {globalRank && (
              <div style={{ background: theme.violetSoft, color: theme.violet, borderRadius: "10px", padding: "6px 14px", textAlign: "center" }}>
                <div style={{ fontSize: "11px", fontWeight: 600, marginBottom: "2px" }}>الترتيب العام</div>
                <div style={{ fontSize: "22px", fontWeight: 900 }}>{globalRank}</div>
              </div>
            )}
          </div>
        </div>


        {/* Stats donut */}
        <p style={{ fontSize: "12px", fontWeight: 700, color: theme.muted, marginBottom: "8px" }}>الإحصائيات</p>
        <div style={{ background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: "14px", padding: "14px" }}>
          {totalScored === 0 ? (
            <p style={{ fontSize: "12px", color: theme.muted, textAlign: "center", padding: "16px 0" }}>لا توجد مباريات منتهية بعد</p>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
              <div
                style={{
                  position: "relative",
                  width: "140px",
                  height: "140px",
                  flexShrink: 0,
                  borderRadius: "50%",
                  background: `conic-gradient(${gradientStops.join(", ")})`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <div style={{ width: "86px", height: "86px", borderRadius: "50%", background: theme.surface, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                  <div style={{ fontSize: "18px", fontWeight: 900, color: theme.text, lineHeight: 1 }}>{(() => { const finishedIds = new Set(matches.filter(isMatchFinished).map((m) => m.id)); return allPredictionRows.filter((r) => r.user_id === userId && r.pred_home !== null && r.pred_away !== null && finishedIds.has(r.match_id)).length; })()}</div>
                  <div style={{ fontSize: "8px", color: theme.muted, marginTop: "3px" }}>عدد التوقعات</div>
                </div>
                {tierColors
                  .filter((t) => tierCounts[t.key] > 0)
                  .map((t) => {
                    const pct = Math.round((tierCounts[t.key] / totalScored) * 100);
                    const from = (segmentStartByKey[t.key] / totalScored) * 360;
                    const to = ((segmentStartByKey[t.key] + tierCounts[t.key]) / totalScored) * 360;
                    const midAngleRad = ((from + to) / 2) * (Math.PI / 180);
                    const r = 56;
                    const x = 70 + r * Math.sin(midAngleRad);
                    const y = 70 - r * Math.cos(midAngleRad);
                    return (
                      <span
                        key={t.key}
                        style={{
                          position: "absolute",
                          left: `${x}px`,
                          top: `${y}px`,
                          transform: "translate(-50%, -50%)",
                          fontSize: "8px",
                          fontWeight: 800,
                          color: "#FFFFFF",
                          textShadow: "0 1px 2px rgba(0,0,0,0.45)",
                          pointerEvents: "none",
                        }}
                      >
                        {pct}%
                      </span>
                    );
                  })}
              </div>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "7px" }}>
                {tierColors.map((t) => (
                  <div key={t.key} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span
                      style={{
                        width: "22px",
                        height: "22px",
                        borderRadius: "50%",
                        border: `2.5px solid ${t.color}`,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                        fontSize: "8px",
                        fontWeight: 800,
                        color: t.color,
                      }}
                    >
                      {tierCounts[t.key] || 0}
                    </span>
                    <span style={{ fontSize: "11px", color: theme.text }}>{t.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// A password <input> with an eye icon to toggle showing the typed value.
function PasswordField({ value, onChange, placeholder, inputStyle, theme }) {
  const [visible, setVisible] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <input
        dir="ltr"
        type={visible ? "text" : "password"}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        style={{ ...inputStyle, paddingRight: "38px" }}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        style={{
          position: "absolute",
          right: "10px",
          top: "50%",
          transform: "translateY(-50%)",
          background: "transparent",
          border: "none",
          padding: 0,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
        }}
        aria-label={visible ? "إخفاء كلمة السر" : "إظهار كلمة السر"}
      >
        {visible ? <EyeOff size={16} color={theme.muted} /> : <Eye size={16} color={theme.muted} />}
      </button>
    </div>
  );
}

// Login/register page, backed by Supabase Auth + the profiles table.
function AuthPage({ onRegister, onLoginExisting, onForgotPassword, onBack, theme }) {
  const [mode, setMode] = useState("login"); // "register" | "login" | "forgot"
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [usernameError, setUsernameError] = useState("");
  const [checkingUsername, setCheckingUsername] = useState(false);
  const [authError, setAuthError] = useState("");
  const [authNotice, setAuthNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setAuthError("");
    setAuthNotice("");
    if (mode === "forgot") {
      if (!email.trim()) return;
      setSubmitting(true);
      const result = await onForgotPassword({ identifier: email.trim() });
      setSubmitting(false);
      if (result?.error) setAuthError(result.error);
      else setAuthNotice("تم إرسال رابط لإعادة تعيين كلمة السر إلى بريدك الإلكتروني");
      return;
    }

    if (mode === "login") {
      if (!email.trim() || !password.trim()) return;
      setSubmitting(true);
      const result = await onLoginExisting({ identifier: email.trim(), password });
      setSubmitting(false);
      if (result?.error) setAuthError(result.error);
      return;
    }

    if (!name.trim() || !username.trim() || !email.trim() || !password.trim()) return;

    if (!/^[a-zA-Z0-9]+$/.test(username.trim())) {
      setUsernameError("اسم المستخدم يقبل فقط حروف إنجليزية وأرقام بدون مسافات أو رموز");
      return;
    }

    if (password !== confirmPassword) {
      setAuthError("كلمتا السر غير متطابقتين");
      return;
    }

    setUsernameError("");
    setSubmitting(true);
    const result = await onRegister({ name: name.trim(), username: username.trim().toLowerCase(), email: email.trim(), password });
    setSubmitting(false);
    if (result?.usernameError) {
      setUsernameError(result.usernameError);
    } else if (result?.error) {
      setAuthError(result.error);
    } else if (result?.needsEmailConfirmation) {
      setAuthError("تم إنشاء الحساب — تحقق من بريدك الإلكتروني لتأكيد التسجيل قبل تسجيل الدخول");
    }
  };

  const inputStyle = {
    width: "100%",
    border: `1.5px solid ${theme.inputBorder}`,
    borderRadius: "10px",
    padding: "12px 14px",
    fontFamily: "Cairo, sans-serif",
    fontSize: "16px",
    color: theme.text,
    background: theme.surface,
    outline: "none",
  };

  return (
    <div style={{ padding: "30px 20px 60px" }}>
      <div style={{ maxWidth: "420px", margin: "0 auto" }}>
        <button
          onClick={onBack}
          style={{
            background: "transparent",
            border: "none",
            color: theme.muted,
            fontSize: "12px",
            fontWeight: 600,
            cursor: "pointer",
            padding: 0,
            marginBottom: "20px",
          }}
        >
          → رجوع
        </button>

        <h2 style={{ fontSize: "20px", fontWeight: 800, color: theme.primary, marginBottom: "6px", textAlign: "center" }}>
          {mode === "register" ? "إنشاء حساب جديد" : mode === "forgot" ? "نسيت كلمة السر" : "تسجيل الدخول"}
        </h2>
        <p style={{ fontSize: "12px", color: theme.muted, marginBottom: "24px", textAlign: "center" }}>
          {mode === "register"
            ? "أدخل بياناتك لإنشاء حسابك"
            : mode === "forgot"
            ? "أدخل بريدك الإلكتروني أو اسم المستخدم، وبنرسل لك رابط لإعادة تعيين كلمة السر"
            : "سجّل دخولك بالبريد وكلمة السر"}
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {mode === "register" && (
            <>
              <div>
                <label style={{ fontSize: "11px", fontWeight: 700, color: theme.muted, display: "block", marginBottom: "6px" }}>
                  الاسم
                </label>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="اسمك الكامل" style={inputStyle} />
              </div>

              <div>
                <label style={{ fontSize: "11px", fontWeight: 700, color: theme.muted, display: "block", marginBottom: "6px" }}>
                  اسم المستخدم
                </label>
                <input
                  dir="ltr"
                  value={username}
                  onChange={(e) => {
                    const val = e.target.value;
                    setUsername(val);
                    if (val && !/^[a-zA-Z0-9]*$/.test(val)) {
                      setUsernameError("حروف وأرقام فقط");
                    } else {
                      setUsernameError("");
                    }
                  }}
                  onBlur={async () => {
                    const val = username.trim().toLowerCase();
                    if (!val || !/^[a-zA-Z0-9]+$/.test(val)) return;
                    setCheckingUsername(true);
                    const taken = await isUsernameTaken(val);
                    setCheckingUsername(false);
                    if (taken) setUsernameError("اسم المستخدم هذا مستخدم من قبل، جرّب واحد ثاني");
                  }}
                  placeholder="username"
                  style={{ ...inputStyle, border: `1.5px solid ${usernameError ? theme.danger : theme.inputBorder}`, textAlign: "right" }}
                />
                {usernameError ? (
                  <p style={{ fontSize: "11px", color: theme.danger, marginTop: "5px" }}>{usernameError}</p>
                ) : checkingUsername ? (
                  <p style={{ fontSize: "11px", color: theme.muted, marginTop: "5px" }}>جاري التحقق...</p>
                ) : (
                  <p style={{ fontSize: "11px", color: theme.muted, marginTop: "5px" }}>حروف وأرقام فقط</p>
                )}
              </div>
            </>
          )}

          <div>
            <label style={{ fontSize: "11px", fontWeight: 700, color: theme.muted, display: "block", marginBottom: "6px" }}>
              {mode === "login" || mode === "forgot" ? "البريد الإلكتروني أو اسم المستخدم" : "البريد الإلكتروني"}
            </label>
            <div style={{ position: "relative" }}>
              <input
                dir="ltr"
                type={mode === "register" ? "email" : "text"}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={mode === "register" ? "you@example.com" : "you@example.com أو username"}
                style={{ ...inputStyle, paddingRight: "38px" }}
              />
              <Mail size={16} color={theme.muted} style={{ position: "absolute", right: "12px", top: "50%", transform: "translateY(-50%)" }} />
            </div>
          </div>

          {mode !== "forgot" && (
            <div>
              <label style={{ fontSize: "11px", fontWeight: 700, color: theme.muted, display: "block", marginBottom: "6px" }}>
                كلمة السر
              </label>
              <PasswordField
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                inputStyle={inputStyle}
                theme={theme}
              />
            </div>
          )}

          {mode === "register" && (
            <div>
              <label style={{ fontSize: "11px", fontWeight: 700, color: theme.muted, display: "block", marginBottom: "6px" }}>
                تأكيد كلمة السر
              </label>
              <PasswordField
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                inputStyle={inputStyle}
                theme={theme}
              />
            </div>
          )}

          {mode === "login" && (
            <button
              onClick={() => {
                setMode("forgot");
                setAuthError("");
                setAuthNotice("");
              }}
              style={{
                background: "transparent",
                border: "none",
                color: theme.muted,
                fontFamily: "Cairo, sans-serif",
                fontWeight: 600,
                fontSize: "12px",
                cursor: "pointer",
                padding: 0,
                textAlign: "right",
                alignSelf: "flex-end",
              }}
            >
              نسيت كلمة السر؟
            </button>
          )}

          {authError && (
            <p style={{ fontSize: "12px", color: theme.danger, textAlign: "center" }}>{authError}</p>
          )}
          {authNotice && (
            <p style={{ fontSize: "12px", color: theme.primary, textAlign: "center" }}>{authNotice}</p>
          )}

          <button
            onClick={handleSubmit}
            disabled={submitting}
            style={{
              width: "100%",
              marginTop: "8px",
              padding: "13px 0",
              borderRadius: "10px",
              border: "none",
              background: theme.primary,
              color: theme.surface,
              fontFamily: "Cairo, sans-serif",
              fontWeight: 700,
              fontSize: "14px",
              cursor: submitting ? "not-allowed" : "pointer",
              opacity: submitting ? 0.6 : 1,
            }}
          >
            {submitting ? "..." : mode === "register" ? "إنشاء الحساب" : mode === "forgot" ? "إرسال رابط إعادة التعيين" : "دخول"}
          </button>

          {mode === "forgot" ? (
            <button
              onClick={() => {
                setMode("login");
                setAuthError("");
                setAuthNotice("");
              }}
              style={{
                background: "transparent",
                border: "none",
                color: theme.violet,
                fontFamily: "Cairo, sans-serif",
                fontWeight: 700,
                fontSize: "12px",
                cursor: "pointer",
                padding: "8px 0",
              }}
            >
              رجوع لتسجيل الدخول
            </button>
          ) : (
            <button
              onClick={() => setMode((m) => (m === "register" ? "login" : "register"))}
              style={{
                background: "transparent",
                border: "none",
                color: theme.violet,
                fontFamily: "Cairo, sans-serif",
                fontWeight: 700,
                fontSize: "12px",
                cursor: "pointer",
                padding: "8px 0",
              }}
            >
              {mode === "register" ? "عندك حساب؟ سجّل دخولك" : "ما عندك حساب؟ سوّ حساب جديد"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Shown after the user clicks the reset-password link from their email;
// Supabase puts the browser into a "recovery" session so updateUser can
// set the new password without needing the old one.
function ResetPasswordPage({ onUpdatePassword, theme }) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState(false);

  const inputStyle = {
    width: "100%",
    border: `1.5px solid ${theme.inputBorder}`,
    borderRadius: "10px",
    padding: "12px 14px",
    fontFamily: "Cairo, sans-serif",
    fontSize: "16px",
    color: theme.text,
    background: theme.surface,
    outline: "none",
  };

  const handleSubmit = async () => {
    setError("");
    if (!password.trim() || password.length < 6) {
      setError("كلمة السر يجب أن تكون 6 أحرف على الأقل");
      return;
    }
    if (password !== confirmPassword) {
      setError("كلمتا السر غير متطابقتين");
      return;
    }
    setSubmitting(true);
    const result = await onUpdatePassword(password);
    setSubmitting(false);
    if (result?.error) {
      setError(result.error);
    } else if (result?.success) {
      setSaved(true);
    }
  };

  if (saved) {
    return (
      <div style={{ padding: "60px 20px", display: "flex", flexDirection: "column", alignItems: "center", gap: "16px" }}>
        <div style={{ fontSize: "48px" }}>✅</div>
        <h2 style={{ fontSize: "20px", fontWeight: 800, color: theme.primary, textAlign: "center", margin: 0 }}>تم حفظ كلمة السر</h2>
        <p style={{ fontSize: "13px", color: theme.muted, textAlign: "center", margin: 0 }}>رح نسجّلك دخول الحين...</p>
      </div>
    );
  }

  return (
    <div style={{ padding: "30px 20px 60px" }}>
      <div style={{ maxWidth: "420px", margin: "0 auto" }}>
        <h2 style={{ fontSize: "20px", fontWeight: 800, color: theme.primary, marginBottom: "6px", textAlign: "center" }}>
          اختر كلمة سر جديدة
        </h2>
        <p style={{ fontSize: "12px", color: theme.muted, marginBottom: "24px", textAlign: "center" }}>
          أدخل كلمة السر الجديدة لحسابك
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div>
            <label style={{ fontSize: "11px", fontWeight: 700, color: theme.muted, display: "block", marginBottom: "6px" }}>
              كلمة السر الجديدة
            </label>
            <PasswordField
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              inputStyle={inputStyle}
              theme={theme}
            />
          </div>

          <div>
            <label style={{ fontSize: "11px", fontWeight: 700, color: theme.muted, display: "block", marginBottom: "6px" }}>
              تأكيد كلمة السر
            </label>
            <PasswordField
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
              inputStyle={inputStyle}
              theme={theme}
            />
          </div>

          {error && <p style={{ fontSize: "12px", color: theme.danger, textAlign: "center" }}>{error}</p>}

          <button
            onClick={handleSubmit}
            disabled={submitting}
            style={{
              width: "100%",
              marginTop: "8px",
              padding: "13px 0",
              borderRadius: "10px",
              border: "none",
              background: theme.primary,
              color: theme.surface,
              fontFamily: "Cairo, sans-serif",
              fontWeight: 700,
              fontSize: "14px",
              cursor: submitting ? "not-allowed" : "pointer",
              opacity: submitting ? 0.6 : 1,
            }}
          >
            {submitting ? "..." : "حفظ كلمة السر"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Profile page: edit avatar, name, and username after registering.
// Admin-only page: shows how many people registered, and their basic
// info, so the organizer can find someone they want to remove. Actually
// deleting an account has to happen from the Supabase dashboard (it
// requires admin-level access we don't expose in the browser), so this
// page just helps the organizer find the right person and explains the
// one extra step.
function UsersAdminPage({ theme }) {
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAllProfiles()
      .then(setProfiles)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div style={{ padding: "24px 18px 60px" }}>
      <div style={{ maxWidth: "560px", margin: "0 auto" }}>
        <h2 style={{ fontSize: "16px", fontWeight: 800, color: theme.primary, marginBottom: "6px", textAlign: "center" }}>
          المستخدمون المسجّلون
        </h2>
        <p style={{ fontSize: "10px", color: theme.muted, textAlign: "center", marginBottom: "18px" }}>
          العدد الكلي: {loading ? "..." : profiles.length}
        </p>

        <div
          style={{
            background: theme.surface,
            border: `1.5px solid ${theme.border}`,
            borderRadius: "14px",
            overflow: "hidden",
            marginBottom: "18px",
          }}
        >
          {loading ? (
            <div style={{ padding: "24px", textAlign: "center", fontSize: "10px", color: theme.muted }}>
              جاري التحميل...
            </div>
          ) : profiles.length === 0 ? (
            <div style={{ padding: "24px", textAlign: "center", fontSize: "10px", color: theme.muted }}>
              لا يوجد مستخدمون بعد
            </div>
          ) : (
            profiles.map((p, i) => (
              <div
                key={p.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "12px 14px",
                  borderTop: i === 0 ? "none" : `1px solid ${theme.border}`,
                }}
              >
                <div>
                  <div style={{ fontSize: "10px", fontWeight: 700, color: theme.text }}>
                    {p.name} {p.is_admin && <span style={{ color: theme.primary }}>(منظّم)</span>}
                  </div>
                  <div dir="ltr" style={{ fontSize: "12px", color: theme.muted, textAlign: "right" }}>
                    @{p.username}
                  </div>
                </div>
                <div style={{ fontSize: "11px", color: theme.muted }}>
                  {p.created_at ? new Date(p.created_at).toLocaleDateString("ar-EG") : ""}
                </div>
              </div>
            ))
          )}
        </div>

        <div
          style={{
            background: theme.bg,
            border: `1px solid ${theme.border}`,
            borderRadius: "12px",
            padding: "14px",
            fontSize: "12px",
            color: theme.muted,
            lineHeight: 1.7,
          }}
        >
          عشان تحذف حساب أي مستخدم: روح لموقع Supabase، بعدين Authentication، بعدين Users، دور على اسم المستخدم أو البريد، واضغط حذف. حذف الحساب من هناك يمسح معه كل توقعاته وعضويته في الدوريات تلقائيًا.
        </div>
      </div>
    </div>
  );
}

// Shown instead of a page's content when the visitor isn't logged in yet.
function LoginGate({ onNavigateToAuth, theme }) {
  return (
    <div style={{ padding: "60px 20px", textAlign: "center" }}>
      <Lock size={40} color={theme.muted} style={{ marginBottom: "14px" }} />
      <p style={{ fontSize: "10px", color: theme.muted, marginBottom: "16px" }}>
        سجّل دخولك عشان تقدر تشوف هذي الصفحة
      </p>
      <button
        onClick={onNavigateToAuth}
        style={{
          border: "none",
          borderRadius: "10px",
          padding: "10px 24px",
          background: theme.primary,
          color: theme.surface,
          fontFamily: "Cairo, sans-serif",
          fontWeight: 700,
          fontSize: "10px",
          cursor: "pointer",
        }}
      >
        تسجيل الدخول
      </button>
    </div>
  );
}

function ProfilePage({ currentUser, onUpdateProfile, onNavigateToAuth, onDeleteAccount, theme }) {
  const [name, setName] = useState(currentUser?.name || "");
  const [username, setUsername] = useState(currentUser?.username || "");
  const [usernameError, setUsernameError] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    navigator.serviceWorker.ready.then((reg) =>
      reg.pushManager.getSubscription().then((sub) => setPushEnabled(!!sub))
    );
  }, []);

  // currentUser can still be loading (session restore) when this page first
  // mounts, so re-sync the fields once the real profile data arrives.
  useEffect(() => {
    if (!currentUser) return;
    setName(currentUser.name || "");
    setUsername(currentUser.username || "");
  }, [currentUser]);

  if (!currentUser) {
    return (
      <div style={{ padding: "60px 20px", textAlign: "center" }}>
        <User size={40} color={theme.muted} style={{ marginBottom: "14px" }} />
        <p style={{ fontSize: "10px", color: theme.muted, marginBottom: "16px" }}>
          سجّل دخولك عشان تقدر تعدّل ملفك الشخصي
        </p>
        <button
          onClick={onNavigateToAuth}
          style={{
            border: "none",
            borderRadius: "10px",
            padding: "10px 24px",
            background: theme.primary,
            color: theme.surface,
            fontFamily: "Cairo, sans-serif",
            fontWeight: 700,
            fontSize: "10px",
            cursor: "pointer",
          }}
        >
          تسجيل الدخول
        </button>
      </div>
    );
  }

  const handleSave = async () => {
    const normalized = username.trim().toLowerCase();
    if (normalized && !/^[a-zA-Z0-9]+$/.test(normalized)) {
      setUsernameError("اسم المستخدم يقبل فقط حروف إنجليزية وأرقام بدون مسافات أو رموز");
      return;
    }
    setUsernameError("");
    setSaving(true);
    const result = await onUpdateProfile({ name: name.trim(), username: normalized });
    setSaving(false);
    if (result?.usernameError) {
      setUsernameError(result.usernameError);
      return;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleDeleteAccount = async () => {
    setDeleting(true);
    try {
      await onDeleteAccount();
    } catch (err) {
      setDeleting(false);
      alert("تعذّر حذف الحساب: " + (err?.message || "خطأ غير متوقع"));
    }
  };

  return (
    <div style={{ padding: "30px 20px 60px" }}>
      <div style={{ maxWidth: "420px", margin: "0 auto" }}>
        <h2 style={{ fontSize: "16px", fontWeight: 800, color: theme.primary, marginBottom: "20px", textAlign: "center" }}>
          الملف الشخصي
        </h2>

        <div style={{ display: "flex", justifyContent: "center", marginBottom: "24px" }}>
          <div
            style={{
              width: "84px",
              height: "84px",
              borderRadius: "50%",
              background: theme.bg,
              border: "2px solid #000000",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <span style={{ fontSize: "32px", fontWeight: 700, color: theme.muted }}>
              {(name || "؟").trim().charAt(0)}
            </span>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div>
            <label style={{ fontSize: "11px", fontWeight: 700, color: theme.muted, display: "block", marginBottom: "6px" }}>
              الاسم
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{
                width: "100%",
                border: `1.5px solid ${theme.inputBorder}`,
                borderRadius: "10px",
                padding: "12px 14px",
                fontFamily: "Cairo, sans-serif",
                fontSize: "16px",
                color: theme.text,
                background: theme.surface,
                outline: "none",
              }}
            />
          </div>

          <div>
            <label style={{ fontSize: "11px", fontWeight: 700, color: theme.muted, display: "block", marginBottom: "6px" }}>
              اسم المستخدم
            </label>
            <input
              dir="ltr"
              value={username}
              onChange={(e) => {
                const val = e.target.value;
                setUsername(val);
                if (val && !/^[a-zA-Z0-9]*$/.test(val)) {
                  setUsernameError("حروف وأرقام فقط");
                } else {
                  setUsernameError("");
                }
              }}
              style={{
                width: "100%",
                border: `1.5px solid ${usernameError ? theme.danger : theme.inputBorder}`,
                borderRadius: "10px",
                padding: "12px 14px",
                fontFamily: "Cairo, sans-serif",
                fontSize: "16px",
                color: theme.text,
                background: theme.surface,
                outline: "none",
                textAlign: "right",
              }}
            />
            <p style={{ fontSize: "11px", color: theme.muted, marginTop: "5px" }}>
              تنبيه: تقدر تغيّر اسم المستخدم مرة واحدة كل 6 شهور فقط
            </p>
            {usernameError && <p style={{ fontSize: "11px", color: theme.danger, marginTop: "5px" }}>{usernameError}</p>}
          </div>

          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              width: "100%",
              marginTop: "8px",
              padding: "13px 0",
              borderRadius: "10px",
              border: "none",
              background: saved ? theme.accent : theme.violet,
              color: "#FFFFFF",
              fontFamily: "Cairo, sans-serif",
              fontWeight: 700,
              fontSize: "14px",
              cursor: saving ? "not-allowed" : "pointer",
              opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? "..." : saved ? "تم الحفظ ✓" : "حفظ التعديلات"}
          </button>
        </div>

        <p style={{ fontSize: "11px", color: theme.muted, textAlign: "center", marginTop: "16px" }}>
          اسمك واسم مستخدمك يظهرون بلوحة الترتيب العام - الاسم ممكن يتكرر بين المستخدمين، لكن اسم المستخدم لازم يكون فريد
        </p>

        <div style={{ marginTop: "32px", borderTop: `1px solid ${theme.border}`, paddingTop: "20px" }}>
          <button
            onClick={() => setShowDeleteConfirm(true)}
            style={{
              width: "100%",
              padding: "12px 0",
              borderRadius: "10px",
              border: `1.5px solid ${theme.danger}`,
              background: "transparent",
              color: theme.danger,
              fontFamily: "Cairo, sans-serif",
              fontWeight: 700,
              fontSize: "10px",
              cursor: "pointer",
            }}
          >
            حذف الحساب نهائياً
          </button>
        </div>

        {/* Push notifications toggle */}
        {"serviceWorker" in navigator && "PushManager" in window && (
          <div style={{ background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: "14px", padding: "16px", marginBottom: "16px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontSize: "13px", fontWeight: 700, color: theme.text }}>إشعارات المباريات</div>
                <div style={{ fontSize: "11px", color: theme.muted, marginTop: "2px" }}>تنبيه قبل ٣٠ دقيقة من بدء مباراة لم تتوقعها</div>
              </div>
              <button
                onClick={async () => {
                  setPushLoading(true);
                  try {
                    if (pushEnabled) {
                      await unsubscribeFromPush(currentUser.id);
                      setPushEnabled(false);
                    } else {
                      const result = await subscribeToPush(currentUser.id);
                      setPushEnabled(!!result);
                    }
                  } catch (e) {
                    alert("تعذّر تغيير إعداد الإشعارات");
                  }
                  setPushLoading(false);
                }}
                disabled={pushLoading}
                style={{
                  width: "48px", height: "28px", borderRadius: "14px", border: "none", cursor: "pointer",
                  background: pushEnabled ? theme.violet : theme.border,
                  transition: "background 0.2s", flexShrink: 0, position: "relative",
                }}
              >
                <div style={{
                  width: "22px", height: "22px", borderRadius: "50%", background: "#fff",
                  position: "absolute", top: "3px",
                  right: pushEnabled ? "3px" : "23px",
                  transition: "right 0.2s",
                }} />
              </button>
            </div>
          </div>
        )}

        {showDeleteConfirm && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.5)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 100,
              padding: "20px",
            }}
            onClick={() => !deleting && setShowDeleteConfirm(false)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: theme.surface,
                borderRadius: "14px",
                padding: "24px 20px",
                maxWidth: "340px",
                width: "100%",
                textAlign: "center",
              }}
            >
              <p style={{ fontSize: "14px", fontWeight: 700, color: theme.text, marginBottom: "8px" }}>
                هل أنت متأكد؟
              </p>
              <p style={{ fontSize: "12px", color: theme.muted, marginBottom: "20px" }}>
                سيتم حذف حسابك وجميع توقعاتك نهائياً، ولا يمكن التراجع عن هذا الإجراء
              </p>
              <div style={{ display: "flex", gap: "10px" }}>
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  disabled={deleting}
                  style={{
                    flex: 1,
                    padding: "11px 0",
                    borderRadius: "10px",
                    border: `1.5px solid ${theme.inputBorder}`,
                    background: "transparent",
                    color: theme.text,
                    fontFamily: "Cairo, sans-serif",
                    fontWeight: 700,
                    fontSize: "10px",
                    cursor: deleting ? "not-allowed" : "pointer",
                  }}
                >
                  إلغاء
                </button>
                <button
                  onClick={handleDeleteAccount}
                  disabled={deleting}
                  style={{
                    flex: 1,
                    padding: "11px 0",
                    borderRadius: "10px",
                    border: "none",
                    background: theme.danger,
                    color: "#FFFFFF",
                    fontFamily: "Cairo, sans-serif",
                    fontWeight: 700,
                    fontSize: "10px",
                    cursor: deleting ? "not-allowed" : "pointer",
                    opacity: deleting ? 0.6 : 1,
                  }}
                >
                  {deleting ? "..." : "حذف نهائياً"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function GlobalLeaderboardPage({ matches, allPredictionRows, tournaments, tournamentLogos, currentUser, onViewProfile, theme }) {
  const [tournamentFilter, setTournamentFilter] = usePersistedState("globalLeaderboard.tournamentFilter", "الكل");
  const [monthFilter, setMonthFilter] = usePersistedState("globalLeaderboard.monthFilter", "الكل");

  const byTournament = tournamentFilter === "الكل" ? matches : matches.filter((m) => (m.tournament || "بدون بطولة") === tournamentFilter);
  const filteredMatches = filterMatchesByMonth(byTournament, monthFilter === "الكل" ? null : monthFilter);

  const ranked = computeGlobalRanking(filteredMatches, allPredictionRows, currentUser);

  return (
    <div style={{ padding: "20px 16px 60px" }}>
      <div className="page-container">
        <h2 style={{ fontSize: "16px", fontWeight: 800, color: theme.primary, marginBottom: "4px" }}>
          لوحة الترتيب العام
        </h2>
        <p style={{ fontSize: "12px", color: theme.muted, marginBottom: "16px" }}>
          ترتيب جميع المشاركين حسب إجمالي النقاط
        </p>

        <p style={{ fontSize: "11px", fontWeight: 700, color: theme.muted, marginBottom: "4px" }}>الفترة</p>
        <MonthFilterPicker value={monthFilter} onChange={setMonthFilter} matches={matches} theme={theme} />

        <p style={{ fontSize: "11px", fontWeight: 700, color: theme.muted, marginBottom: "4px", marginTop: "8px" }}>البطولات</p>
        <TournamentFilterPicker
          value={tournamentFilter}
          onChange={setTournamentFilter}
          tournaments={tournaments}
          tournamentLogos={tournamentLogos}
          theme={theme}
        />

        {ranked.length === 0 ? (
          <p style={{ fontSize: "12px", color: theme.muted, textAlign: "center", marginTop: "30px" }}>
            لا يوجد توقعات لمباريات منتهية بعد
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {ranked.map((p, i) => (
              <LeaderboardRow key={p.id} rank={i + 1} name={p.name} username={p.username} points={p.points} isYou={p.isYou} theme={theme} onViewProfile={() => onViewProfile(p)} />
            ))}
          </div>
        )}

        <p style={{ fontSize: "11px", color: theme.muted, textAlign: "center", marginTop: "14px" }}>
          الترتيب محسوب من توقعات المستخدمين الحقيقيين فقط على المباريات اللي انتهت
        </p>
      </div>
    </div>
  );
}

function PrivateLeagueDetail({ league, matches, allPredictionRows, onJoin, onBack, tournaments, tournamentLogos, currentUser, onViewProfile, theme }) {
  const [codeCopied, setCodeCopied] = useState(false);
  const [activeTab, setActiveTab] = usePersistedState("leagueDetail.activeTab", "ranking"); // "ranking" | "predictions"
  const [tournamentFilter, setTournamentFilter] = usePersistedState("leagueDetail.tournamentFilter", "الكل");
  const [monthFilter, setMonthFilter] = usePersistedState("leagueDetail.monthFilter", "الكل");
  const [leaguePredVisibleCount, setLeaguePredVisibleCount] = useState(5);

  const youPlayer = league.players.find((p) => p.isYou);

  useEffect(() => {
    if (currentUser && !youPlayer) {
      onJoin(league.id, currentUser.name, currentUser.username);
    }
  }, [currentUser, youPlayer, league.id, onJoin]);

  const byTournament = tournamentFilter === "الكل" ? matches : matches.filter((m) => (m.tournament || "بدون بطولة") === tournamentFilter);
  const filteredMatches = filterMatchesByMonth(byTournament, monthFilter === "الكل" ? null : monthFilter);

  // Every league member is scored from their own real predictions and the
  // real match results, same scoring rules as the global leaderboard - no
  // simulated/fake data for other members anymore.
  const matchById = Object.fromEntries(filteredMatches.map((m) => [m.id, m]));

  const finishedMatchesSorted = filteredMatches.filter(isMatchFinished)
    .sort((a, b) => new Date(`${b.date}T${b.time}:00+03:00`) - new Date(`${a.date}T${a.time}:00+03:00`));
  const lastFinishedMatchForLeague = finishedMatchesSorted[0] || null;

  const realPointsByUserId = {};
  for (const row of allPredictionRows) {
    const match = matchById[row.match_id];
    if (!match) continue;
    if (!isMatchFinished(match)) continue;

    if (!realPointsByUserId[row.user_id]) {
      realPointsByUserId[row.user_id] = { points: 0, tierCounts: { 10: 0, 5: 0, 4: 0, 3: 0, 1: 0, 0: 0, none: 0 }, lastMatchPredAt: null };
    }
    const entry = realPointsByUserId[row.user_id];

    if (lastFinishedMatchForLeague && row.match_id === lastFinishedMatchForLeague.id && row.updated_at) {
      entry.lastMatchPredAt = row.updated_at;
    }

    const adminMultiplier = match.doublePoints ? 2 : 1;
    const userMultiplier = row.user_boost ? 3 : 1;
    const multiplier = match.doublePoints ? adminMultiplier : userMultiplier;

    const hasPrediction = row.pred_home !== null && row.pred_home !== undefined && row.pred_away !== null && row.pred_away !== undefined;
    if (!hasPrediction) {
      entry.tierCounts.none += 1;
      continue;
    }
    const result = calcPoints(row.pred_home, row.pred_away, match.actualHome, match.actualAway, multiplier);
    if (result) {
      entry.tierCounts[result.basePoints] = (entry.tierCounts[result.basePoints] || 0) + 1;
      entry.points += result.points;
    }
  }

  const ranked = [...league.players]
    .map((p) => {
      const stats = realPointsByUserId[p.userId];
      return {
        ...p,
        points: stats ? stats.points : 0,
        tierCounts: stats ? stats.tierCounts : { 10: 0, 5: 0, 4: 0, 3: 0, 1: 0, 0: 0, none: 0 },
        lastMatchPredAt: stats ? stats.lastMatchPredAt : null,
      };
    })
    .sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      const tierDiff = compareTierCounts(a.tierCounts, b.tierCounts);
      if (tierDiff !== 0) return tierDiff;
      if (a.lastMatchPredAt && b.lastMatchPredAt) return new Date(a.lastMatchPredAt) - new Date(b.lastMatchPredAt);
      if (a.lastMatchPredAt) return -1;
      if (b.lastMatchPredAt) return 1;
      return 0;
    });

  // التوقعات tab: every finished match, most recently finished first.
  const predictionRowsByUserId = {};
  for (const row of allPredictionRows) {
    if (!predictionRowsByUserId[row.user_id]) predictionRowsByUserId[row.user_id] = {};
    const hasPrediction = row.pred_home !== null && row.pred_home !== undefined && row.pred_away !== null && row.pred_away !== undefined;
    if (hasPrediction) {
      predictionRowsByUserId[row.user_id][row.match_id] = { predHome: row.pred_home, predAway: row.pred_away, userBoost: !!row.user_boost };
    }
  }
  const playerPredictionsById = {};
  league.players.forEach((p) => {
    playerPredictionsById[p.id] = predictionRowsByUserId[p.userId] || {};
  });

  const finishedMatches = filteredMatches
    .filter(isMatchLocked)
    .sort((a, b) => new Date(`${b.date}T${b.time}:00`).getTime() - new Date(`${a.date}T${a.time}:00`).getTime());

  const copyCode = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(league.code).catch(() => {});
    }
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 1500);
  };

  return (
    <div style={{ padding: "20px 16px 60px" }}>
      <div className="page-container">
        <button
          onClick={onBack}
          style={{
            background: "transparent",
            border: "none",
            color: theme.muted,
            fontSize: "12px",
            fontWeight: 600,
            cursor: "pointer",
            padding: 0,
            marginBottom: "14px",
          }}
        >
          → رجوع للدوريّات الخاصة
        </button>

        <h2 style={{ fontSize: "17px", fontWeight: 800, color: theme.primary, marginBottom: "4px" }}>
          {league.name}
        </h2>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            marginBottom: "18px",
          }}
        >
          <span style={{ fontSize: "12px", color: theme.muted }}>كود الدوري:</span>
          <span
            dir="ltr"
            style={{
              fontFamily: "monospace",
              fontWeight: 800,
              fontSize: "14px",
              color: theme.text,
              background: theme.primarySoft,
              padding: "3px 10px",
              borderRadius: "6px",
              letterSpacing: "1px",
            }}
          >
            {league.code}
          </span>
          <button
            onClick={copyCode}
            aria-label="نسخ الكود"
            style={{ background: "transparent", border: "none", color: theme.primary, cursor: "pointer", display: "flex" }}
          >
            {codeCopied ? <Check size={11} /> : <Copy size={11} />}
          </button>
        </div>

        {!youPlayer && !currentUser && (
          <div
            style={{
              background: theme.surface,
              border: `1.5px solid ${theme.violet}`,
              borderRadius: "12px",
              padding: "14px",
              marginBottom: "18px",
              textAlign: "center",
            }}
          >
            <p style={{ fontSize: "12px", color: theme.muted }}>
              سجّل دخولك عشان تنضم للدوري وتدخل الترتيب
            </p>
          </div>
        )}

        <p style={{ fontSize: "11px", fontWeight: 700, color: theme.muted, marginBottom: "4px" }}>الفترة</p>
        <MonthFilterPicker value={monthFilter} onChange={setMonthFilter} matches={matches} theme={theme} />

        {/* Tournament filter - applies to both الترتيب and التوقعات tabs */}
        <p style={{ fontSize: "11px", fontWeight: 700, color: theme.muted, marginBottom: "4px", marginTop: "8px" }}>البطولات</p>
        <TournamentFilterPicker
          value={tournamentFilter}
          onChange={setTournamentFilter}
          tournaments={tournaments}
          tournamentLogos={tournamentLogos}
          theme={theme}
        />

        {/* Tabs: الترتيب / التوقعات */}
        <div
          style={{
            display: "flex",
            background: theme.bg,
            border: `1px solid ${theme.border}`,
            borderRadius: "10px",
            padding: "3px",
            marginBottom: "18px",
          }}
        >
          <button
            onClick={() => setActiveTab("ranking")}
            style={{
              flex: 1,
              padding: "8px 12px",
              borderRadius: "8px",
              border: "none",
              background: activeTab === "ranking" ? theme.primary : "transparent",
              color: activeTab === "ranking" ? theme.surface : theme.muted,
              fontFamily: "Cairo, sans-serif",
              fontWeight: 700,
              fontSize: "12px",
              cursor: "pointer",
            }}
          >
            الترتيب
          </button>
          <button
            onClick={() => setActiveTab("predictions")}
            style={{
              flex: 1,
              padding: "8px 12px",
              borderRadius: "8px",
              border: "none",
              background: activeTab === "predictions" ? theme.primary : "transparent",
              color: activeTab === "predictions" ? theme.surface : theme.muted,
              fontFamily: "Cairo, sans-serif",
              fontWeight: 700,
              fontSize: "12px",
              cursor: "pointer",
            }}
          >
            التوقعات
          </button>
        </div>

        {activeTab === "ranking" ? (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {ranked.map((p, i) => (
                <LeaderboardRow key={p.id} rank={i + 1} name={p.name} username={p.username} points={p.points} isYou={p.isYou} theme={theme} onViewProfile={onViewProfile ? () => onViewProfile(p) : undefined} />
              ))}
            </div>


          </>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {finishedMatches.length === 0 ? (
              <p style={{ fontSize: "12px", color: theme.muted, textAlign: "center", padding: "20px 0" }}>
                ما فيه مباريات منتهية بعد
              </p>
            ) : (
              <>
                {finishedMatches.slice(0, leaguePredVisibleCount).map((match) => (
                  <LeaguePredictionCard key={match.id} match={match} league={league} playerPredictionsById={playerPredictionsById} tournamentLogos={tournamentLogos} theme={theme} />
                ))}
                {finishedMatches.length > leaguePredVisibleCount && (
                  <button
                    onClick={() => setLeaguePredVisibleCount((c) => c + 5)}
                    style={{
                      width: "100%",
                      padding: "12px",
                      borderRadius: "12px",
                      border: `1.5px dashed ${theme.inputBorder}`,
                      background: "transparent",
                      color: theme.text,
                      fontFamily: "Cairo, sans-serif",
                      fontWeight: 600,
                      fontSize: "13px",
                      cursor: "pointer",
                    }}
                  >
                    عرض المزيد ({finishedMatches.length - leaguePredVisibleCount} متبقية)
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function LeaguePredictionCard({ match, league, playerPredictionsById, tournamentLogos, theme }) {
  const dateLabel = match.date
    ? (() => {
        const [y, m, d] = match.date.split("-");
        return `${d}-${m}-${y}`;
      })()
    : "—";
  const timeLabel = match.time
    ? (() => {
        const [hh, mm] = match.time.split(":");
        const h12 = Number(hh) % 12 === 0 ? 12 : Number(hh) % 12;
        const ampm = Number(hh) >= 12 ? "PM" : "AM";
        return `${String(h12).padStart(2, "0")}:${mm} ${ampm}`;
      })()
    : "—";
  const isGold = !!match.doublePoints;
  const hasActual = match.actualHome !== "" && match.actualHome != null && match.actualAway !== "" && match.actualAway != null;

  return (
    <div
      style={{
        background: theme.surface,
        border: isGold ? `2px solid ${theme.yellow}` : `1.5px solid ${theme.violet}`,
        borderRadius: "12px",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "8px 10px",
          fontFamily: "Cairo, sans-serif",
          fontWeight: 700,
          fontSize: "9px",
          color: isGold ? theme.yellow : theme.primary,
          textAlign: "center",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "5px",
          borderBottom: `1px solid ${theme.border}`,
        }}
      >
        {match.tournament && <TournamentIcon name={match.tournament} logo={tournamentLogos?.[match.tournament]} theme={theme} color={isGold ? theme.yellow : theme.primary} />}
        {match.tournament || "بطولة غير محددة"}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "8px",
          padding: "7px 10px",
          background: theme.bg,
          borderBottom: `1px solid ${theme.border}`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "3px" }}>
          <Clock size={11} color={theme.muted} />
          <span dir="ltr" style={{ fontFamily: "Cairo, sans-serif", fontSize: "10px", fontWeight: 600, color: theme.text }}>
            {timeLabel}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "3px" }}>
          <span dir="ltr" style={{ fontFamily: "Cairo, sans-serif", fontSize: "10px", fontWeight: 600, color: theme.text }}>
            {dateLabel}
          </span>
          <Calendar size={11} color={theme.muted} />
        </div>
      </div>

      <div style={{ padding: "10px 12px 12px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "5px", flex: 1 }}>
            <TeamDisplay name={match.home} logo={match.homeLogo} theme={theme} logoSize={36} venueLabel={match.venueTeam === "home" ? "المستضيف" : match.venueTeam === "away" ? "الضيف" : null} />
            <ScoreBoxStatic value={match.actualHome} theme={theme} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingTop: "24px" }}>
            <span style={{ color: theme.muted, fontSize: "11px", fontWeight: 700 }}>{hasActual ? "ضد" : "بالإنتظار"}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "5px", flex: 1 }}>
            <TeamDisplay name={match.away} logo={match.awayLogo} theme={theme} logoSize={36} venueLabel={match.venueTeam === "away" ? "المستضيف" : match.venueTeam === "home" ? "الضيف" : null} />
            <ScoreBoxStatic value={match.actualAway} theme={theme} />
          </div>
        </div>
      </div>

      {/* Per-player breakdown - same three-box footer style as the
          participant's منتهية card (المزايا المستخدمة / النتيجة الفعلية / النقاط). */}
      <div
        style={{
          borderTop: `1px solid ${theme.border}`,
          margin: "10px 12px",
          background: theme.bg,
          border: `1px solid ${theme.border}`,
          borderRadius: "10px",
          overflow: "hidden",
        }}
      >
        {league.players.map((p, idx) => {
          const pred = playerPredictionsById[p.id]?.[match.id];
          const multiplier = match.doublePoints ? 2 : pred?.userBoost ? 3 : 1;
          const result = pred ? calcPoints(pred.predHome, pred.predAway, match.actualHome, match.actualAway, multiplier) : null;
          const colors = result
            ? pred?.userBoost
              ? { bg: theme.yellowSoft, text: theme.yellow, ring: theme.yellow }
              : tierStyleFor(theme, result.basePoints)
            : null;
          return (
            <div
              key={p.id}
              style={{
                display: "flex",
                borderTop: idx === 0 ? "none" : `1px solid ${theme.border}`,
              }}
            >
              <div style={{ flex: 1, textAlign: "center", padding: "5px 4px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ fontSize: "11px", fontWeight: 700, color: theme.text, wordBreak: "break-word" }}>{p.name}</span>
              </div>
              <div style={{ flex: 1, textAlign: "center", padding: "5px 4px" }}>
                {pred ? (
                  <span style={{ fontSize: "11px", fontWeight: 700, color: theme.text }}>
                    {pred.predHome} - {pred.predAway}
                  </span>
                ) : (
                  <span style={{ fontSize: "11px", fontWeight: 700, color: theme.muted }}>
                    لم يتوقع
                  </span>
                )}
              </div>
              <div style={{ flex: 1, textAlign: "center", padding: "5px 4px" }}>
                {!hasActual ? (
                  <ResultPill theme={theme} border={theme.inputBorder} bg={theme.bg} color={theme.muted} compact>
                    بالإنتظار
                  </ResultPill>
                ) : result ? (
                  pred?.userBoost ? (
                    <ResultPill theme={theme} border={theme.yellow} bg={theme.yellowSoft} color={theme.yellow} compact>
                      {result.points}
                    </ResultPill>
                  ) : (
                    <ResultPill theme={theme} border={colors.ring} bg={colors.bg} color={colors.text} compact>
                      {result.points}
                    </ResultPill>
                  )
                ) : (
                  <ResultPill theme={theme} border={theme.inputBorder} bg={theme.bg} color={theme.muted} compact>
                    -
                  </ResultPill>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PrivateLeaguesPage({ leagues, matches, allPredictionRows, onCreateLeague, onJoinLeague, tournaments, tournamentLogos, currentUser, onViewProfile, initialLeagueId, theme }) {
  const [selectedLeagueId, setSelectedLeagueId] = usePersistedState("leagues.selectedLeagueId", null);
  useEffect(() => { if (initialLeagueId) setSelectedLeagueId(initialLeagueId); }, [initialLeagueId]);
  const [newLeagueName, setNewLeagueName] = useState("");
  const [joinCodeInput, setJoinCodeInput] = useState("");
  const [joinError, setJoinError] = useState("");

  const selectedLeague = leagues.find((l) => l.id === selectedLeagueId);

  if (selectedLeague) {
    return (
      <PrivateLeagueDetail
        league={selectedLeague}
        matches={matches}
        allPredictionRows={allPredictionRows}
        onJoin={onJoinLeague}
        onBack={() => setSelectedLeagueId(null)}
        tournaments={tournaments}
        tournamentLogos={tournamentLogos}
        currentUser={currentUser}
        onViewProfile={onViewProfile}
        theme={theme}
      />
    );
  }

  const handleCreate = async () => {
    if (!newLeagueName.trim()) return;
    const name = newLeagueName.trim();
    setNewLeagueName("");
    const id = await onCreateLeague(name);
    setSelectedLeagueId(id);
  };

  const handleJoinByCode = () => {
    const code = joinCodeInput.trim().toUpperCase();
    if (!code) return;
    const found = leagues.find((l) => l.code === code);
    if (!found) {
      setJoinError("ما فيه دوري بهذا الكود");
      return;
    }
    setJoinError("");
    setJoinCodeInput("");
    setSelectedLeagueId(found.id);
  };

  return (
    <div style={{ padding: "20px 16px 60px" }}>
      <div className="page-container">
        <h2 style={{ fontSize: "16px", fontWeight: 800, color: theme.primary, marginBottom: "4px" }}>
          الدوريات
        </h2>
        <p style={{ fontSize: "12px", color: theme.muted, marginBottom: "18px" }}>
          سوّي دوري خاص بينك وبين جماعتك، أو انضم بدوري موجود عن طريق الكود
        </p>

        {/* Create new league */}
        <div
          style={{
            background: theme.surface,
            border: `1.5px solid ${theme.violet}`,
            borderRadius: "12px",
            padding: "14px",
            marginBottom: "14px",
          }}
        >
          <p style={{ fontSize: "12px", fontWeight: 700, color: theme.text, marginBottom: "10px" }}>
            إنشاء دوري جديد
          </p>
          <div style={{ display: "flex", gap: "8px" }}>
            <input
              value={newLeagueName}
              onChange={(e) => setNewLeagueName(e.target.value)}
              placeholder="اسم الدوري (مثلاً: دوري الأصدقاء)"
              style={{
                flex: 1,
                border: `1.5px solid ${theme.inputBorder}`,
                borderRadius: "8px",
                padding: "8px 10px",
                fontFamily: "Cairo, sans-serif",
                fontSize: "16px",
                color: theme.text,
                background: theme.bg,
                outline: "none",
              }}
            />
            <button
              onClick={handleCreate}
              disabled={!newLeagueName.trim()}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                border: "none",
                borderRadius: "8px",
                padding: "8px 14px",
                background: newLeagueName.trim() ? theme.primary : theme.inputBorder,
                color: theme.surface,
                fontFamily: "Cairo, sans-serif",
                fontWeight: 700,
                fontSize: "12px",
                cursor: newLeagueName.trim() ? "pointer" : "not-allowed",
                whiteSpace: "nowrap",
              }}
            >
              <Plus size={11} />
              إنشاء
            </button>
          </div>
        </div>

        {/* Join by code */}
        <div
          style={{
            background: theme.surface,
            border: `1.5px solid ${theme.violet}`,
            borderRadius: "12px",
            padding: "14px",
            marginBottom: "20px",
          }}
        >
          <p style={{ fontSize: "12px", fontWeight: 700, color: theme.text, marginBottom: "10px" }}>
            الانضمام بكود
          </p>
          <div style={{ display: "flex", gap: "8px" }}>
            <input
              dir="ltr"
              value={joinCodeInput}
              onChange={(e) => setJoinCodeInput(e.target.value)}
              placeholder="ABC123"
              style={{
                flex: 1,
                border: `1.5px solid ${theme.inputBorder}`,
                borderRadius: "8px",
                padding: "8px 10px",
                fontFamily: "monospace",
                fontWeight: 700,
                fontSize: "16px",
                color: theme.text,
                background: theme.bg,
                outline: "none",
                textAlign: "center",
                letterSpacing: "1px",
              }}
            />
            <button
              onClick={handleJoinByCode}
              disabled={!joinCodeInput.trim()}
              style={{
                border: "none",
                borderRadius: "8px",
                padding: "8px 16px",
                background: joinCodeInput.trim() ? theme.primary : theme.inputBorder,
                color: theme.surface,
                fontFamily: "Cairo, sans-serif",
                fontWeight: 700,
                fontSize: "12px",
                cursor: joinCodeInput.trim() ? "pointer" : "not-allowed",
                whiteSpace: "nowrap",
              }}
            >
              دخول
            </button>
          </div>
          {joinError && (
            <p style={{ fontSize: "11px", color: theme.danger, marginTop: "8px" }}>{joinError}</p>
          )}
        </div>

        {/* My leagues list - only leagues the current user has actually
            joined (has a player entry), not every league that exists in
            the system. A league someone else made/shared a code for stays
            hidden until you actually join it. */}
        {(() => {
          const myLeagues = leagues.filter((l) => l.players.some((p) => p.isYou));
          return myLeagues.length > 0 && (
            <>
              <p style={{ fontSize: "12px", fontWeight: 700, color: theme.text, marginBottom: "10px" }}>
                دوريّاتي
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {myLeagues.map((league) => (
                  <button
                    key={league.id}
                    onClick={() => setSelectedLeagueId(league.id)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      padding: "12px 14px",
                      borderRadius: "10px",
                      border: `1px solid ${theme.border}`,
                      background: theme.surface,
                      cursor: "pointer",
                    textAlign: "right",
                    width: "100%",
                  }}
                >
                  <Users size={16} color={theme.primary} />
                  <span style={{ flex: 1, fontFamily: "Cairo, sans-serif", fontWeight: 700, fontSize: "10px", color: theme.text }}>
                    {league.name}
                  </span>
                  <span style={{ fontSize: "11px", color: theme.muted }}>
                    {league.players.length} لاعب
                  </span>
                </button>
              ))}
              </div>
            </>
          );
        })()}
      </div>
    </div>
  );
}

function HomeSectionHeader({ title, onMore, theme }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 2px 8px", marginTop: "4px" }}>
      <span style={{ fontSize: "13px", fontWeight: 800, color: theme.text }}>{title}</span>
      {onMore && (
        <span onClick={onMore} style={{ fontSize: "11px", color: theme.violet, fontWeight: 600, cursor: "pointer" }}>
          عرض الكل
        </span>
      )}
    </div>
  );
}

function HomePage({ theme, onNavigate, onGoToPredictions, onOpenLeague, currentUser, matches, allPredictionRows, leagues, tournamentLogos }) {
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => {
    const id = setInterval(() => setNow(serverNow()), 1000);
    return () => clearInterval(id);
  }, []);

  const globalRanked = useMemo(() => computeGlobalRanking(matches, allPredictionRows, currentUser), [matches, allPredictionRows, currentUser]);
  const me = currentUser ? globalRanked.find((p) => p.isYou) : null;
  const myGlobalRank = currentUser ? globalRanked.findIndex((p) => p.isYou) + 1 : 0;
  const pointsByUserId = useMemo(() => Object.fromEntries(globalRanked.map((p) => [p.id, p.points])), [globalRanked]);

  const myPredictedMatchIds = useMemo(() => {
    if (!currentUser) return new Set();
    return new Set(
      allPredictionRows
        .filter((r) => r.user_id === currentUser.id && r.pred_home !== null && r.pred_away !== null)
        .map((r) => r.match_id)
    );
  }, [allPredictionRows, currentUser]);

  const unpredictedMatches = useMemo(() => {
    const now = serverNow();
    return matches
      .filter((m) => m.date && m.time)
      .map((m) => ({ ...m, kickoff: new Date(`${m.date}T${m.time}:00+03:00`).getTime() }))
      .filter((m) => m.kickoff > now && !myPredictedMatchIds.has(m.id))
      .sort((a, b) => a.kickoff - b.kickoff);
  }, [matches, myPredictedMatchIds]);

  const myLeagues = useMemo(
    () =>
      leagues
        .filter((l) => l.players.some((p) => p.isYou))
        .map((l) => {
          const globalRankById = Object.fromEntries(globalRanked.map((p, i) => [p.id, i]));
          const ranked = [...l.players].sort((a, b) => {
            const pa = pointsByUserId[a.userId] || 0;
            const pb = pointsByUserId[b.userId] || 0;
            if (pb !== pa) return pb - pa;
            return (globalRankById[a.userId] ?? 9999) - (globalRankById[b.userId] ?? 9999);
          });
          const myRank = ranked.findIndex((p) => p.isYou) + 1;
          return { ...l, myRank, memberCount: l.players.length };
        }),
    [leagues, pointsByUserId, globalRanked]
  );

  const tierCounts = me?.tierCounts || { 10: 0, 5: 0, 4: 0, 3: 0, 1: 0, 0: 0, none: 0 };
  const tierColors = [
    { key: 10, color: theme.accent, label: TIERS_META[0].label },
    { key: 5, color: theme.navyBlue, label: TIERS_META[1].label },
    { key: 4, color: theme.sky, label: TIERS_META[2].label },
    { key: 3, color: theme.muted, label: TIERS_META[3].label },
    { key: 1, color: theme.inputBorder, label: TIERS_META[4].label },
    { key: 0, color: theme.danger, label: TIERS_META[5].label },
    { key: "none", color: theme.violet, label: "لم يتم توقعها" },
  ];
  const totalScored = tierColors.reduce((sum, t) => sum + (tierCounts[t.key] || 0), 0);

  let acc = 0;
  const segmentStartByKey = {};
  const gradientStops = tierColors
    .filter((t) => tierCounts[t.key] > 0)
    .map((t) => {
      const from = (acc / totalScored) * 100;
      segmentStartByKey[t.key] = acc;
      acc += tierCounts[t.key];
      const to = (acc / totalScored) * 100;
      return `${t.color} ${from}% ${to}%`;
    });

  const mostCommonActualResult = useMemo(() => {
    const counts = {};
    matches.forEach((m) => {
      if (m.actualHome === "" || m.actualHome == null || m.actualAway === "" || m.actualAway == null) return;
      const a = Number(m.actualHome);
      const b = Number(m.actualAway);
      const key = a >= b ? `${a}-${b}` : `${b}-${a}`;
      counts[key] = (counts[key] || 0) + 1;
    });
    let best = null;
    for (const key in counts) {
      if (!best || counts[key] > counts[best]) best = key;
    }
    return best;
  }, [matches]);

  const mostCommonPredictedResult = useMemo(() => {
    const counts = {};
    allPredictionRows.forEach((row) => {
      if (row.pred_home === "" || row.pred_home == null || row.pred_away === "" || row.pred_away == null) return;
      const a = Number(row.pred_home);
      const b = Number(row.pred_away);
      const key = a >= b ? `${a}-${b}` : `${b}-${a}`;
      counts[key] = (counts[key] || 0) + 1;
    });
    let best = null;
    for (const key in counts) {
      if (!best || counts[key] > counts[best]) best = key;
    }
    return best;
  }, [allPredictionRows]);

  return (
    <div style={{ padding: "20px 16px 60px" }}>
      <div style={{ maxWidth: "980px", margin: "0 auto" }}>
      <div className="home-grid">
      <div className="home-col">
        {/* Points + rank hero */}
        <div
          style={{
            background: theme.surface,
            border: `1px solid ${theme.border}`,
            borderRadius: "16px",
            padding: "16px",
            marginBottom: "16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            <div style={{ fontSize: "30px", fontWeight: 900, color: theme.violet }}>{me?.points || 0}</div>
            <div style={{ fontSize: "11px", color: theme.muted, marginTop: "2px" }}>إجمالي نقاطك</div>
          </div>
          <div style={{ background: theme.violetSoft, color: theme.violet, borderRadius: "10px", padding: "6px 14px", fontSize: "12px", fontWeight: 700, textAlign: "center" }}>
            الترتيب العام
            <div style={{ fontSize: "16px", marginTop: "2px" }}>{myGlobalRank || "—"}</div>
          </div>
        </div>

        {/* Next 24h matches */}
        <HomeSectionHeader title="مباريات متاحة لم يتم توقعها" onMore={() => onGoToPredictions()} theme={theme} />
        <div style={{ background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: "14px", padding: "8px", marginBottom: "20px" }}>
          {unpredictedMatches.length === 0 ? (
            <p style={{ fontSize: "12px", color: theme.muted, textAlign: "center", padding: "16px 0" }}>أحسنت! توقعت كل المباريات المتاحة</p>
          ) : (
            unpredictedMatches.slice(0, 5).map((m) => {
              const kickoffISO = `${m.date}T${m.time}:00+03:00`;
              return (
                <div
                  key={m.id}
                  style={{ padding: "10px 10px", borderBottom: `1px solid ${theme.border}` }}
                >
                  {m.tournament && (
                    <div style={{ display: "flex", alignItems: "center", gap: "5px", marginBottom: "5px" }}>
                      <TournamentIcon name={m.tournament} logo={tournamentLogos?.[m.tournament]} theme={theme} size={12} color={theme.muted} />
                      <span style={{ fontSize: "11px", color: theme.muted, fontWeight: 600 }}>{m.tournament}</span>
                    </div>
                  )}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                    <div style={{ fontFamily: "Cairo, sans-serif", fontWeight: 700, fontSize: "12px", color: theme.text }}>
                      {m.home} <span style={{ color: theme.muted, fontWeight: 400, fontSize: "10px" }}>vs</span> {m.away}
                    </div>
                    <div style={{ flexShrink: 0 }}>
                      <CountdownBadge kickoffISO={kickoffISO} theme={theme} />
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <button
            onClick={() => onGoToPredictions(unpredictedMatches.length === 0 ? "predicted" : "available")}
            style={{
              width: "100%",
              marginTop: "6px",
              background: theme.violet,
              color: "#fff",
              border: "none",
              borderRadius: "10px",
              padding: "11px",
              fontFamily: "Cairo, sans-serif",
              fontWeight: 800,
              fontSize: "13px",
              cursor: "pointer",
            }}
          >
            {unpredictedMatches.length === 0 ? "شاهد توقعك" : "أدخل توقعك"}
          </button>
        </div>

        {/* My leagues */}
        <HomeSectionHeader title="دورياتي" onMore={() => onNavigate("leagues")} theme={theme} />
        <div style={{ marginBottom: "20px" }}>
          {myLeagues.length === 0 ? (
            <div style={{ background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: "12px", padding: "16px", textAlign: "center" }}>
              <p style={{ fontSize: "12px", color: theme.muted }}>ما انضممت لأي دوري بعد</p>
            </div>
          ) : (
            <div style={{ background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: "12px", overflow: "hidden" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 60px", borderBottom: `1px solid ${theme.border}` }}>
                <div style={{ display: "flex", alignItems: "center", fontSize: "10px", fontWeight: 700, color: theme.text, borderInlineEnd: `1px solid ${theme.border}`, padding: "8px 12px" }}>الدوري</div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", fontSize: "10px", fontWeight: 700, color: theme.text }}>الترتيب</div>
              </div>
              {myLeagues.map((l, i) => (
                <div
                  key={l.id}
                  onClick={() => onOpenLeague ? onOpenLeague(l.id) : onNavigate("leagues")}
                  style={{ display: "grid", gridTemplateColumns: "1fr 60px", borderBottom: i < myLeagues.length - 1 ? `1px solid ${theme.border}` : "none", cursor: "pointer" }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", borderInlineEnd: `1px solid ${theme.border}`, padding: "10px 12px" }}>
                    <div style={{ width: "32px", height: "32px", borderRadius: "50%", background: theme.violetSoft, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <Users size={14} color={theme.violet} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: "12px", fontWeight: 700, color: theme.text }}>{l.name}</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <span style={{ fontSize: "11px", fontWeight: 800, color: theme.violet, background: theme.violetSoft, padding: "4px 9px", borderRadius: "8px" }}>
                      {l.myRank}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="home-col">
        {/* Global leaderboard preview */}
        <HomeSectionHeader title="لوحة الترتيب العام" onMore={() => onNavigate("globalLeaderboard")} theme={theme} />
        <div style={{ background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: "14px", padding: "12px", marginBottom: "20px" }}>
          {globalRanked.length === 0 ? (
            <p style={{ fontSize: "12px", color: theme.muted, textAlign: "center", padding: "12px 0" }}>لا يوجد توقعات لمباريات منتهية بعد</p>
          ) : (
            globalRanked.slice(0, 5).map((p, i) => (
              <div
                key={p.id}
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 2px", fontSize: "12px", borderBottom: `1px solid ${theme.border}` }}
              >
                <span style={{ display: "flex", alignItems: "center" }}>
                  <span
                    style={{
                      width: "20px",
                      height: "20px",
                      borderRadius: "50%",
                      background: theme.violetSoft,
                      color: theme.violet,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "10px",
                      marginLeft: "8px",
                      fontWeight: 700,
                    }}
                  >
                    {i + 1}
                  </span>
                  {p.isYou ? "أنت" : p.name}
                </span>
                <span style={{ color: p.isYou ? theme.violet : theme.text, fontWeight: p.isYou ? 700 : 400 }}>{p.points} نقطة</span>
              </div>
            ))
          )}
        </div>

        {/* Stats */}
        <HomeSectionHeader title="إحصائيات" onMore={() => onNavigate("stats")} theme={theme} />
        <div style={{ background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: "14px", padding: "14px", marginBottom: "10px" }}>
          {totalScored === 0 ? (
            <p style={{ fontSize: "12px", color: theme.muted, textAlign: "center", padding: "16px 0" }}>لا توجد مباريات منتهية بعد</p>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
              <div
                style={{
                  position: "relative",
                  width: "140px",
                  height: "140px",
                  flexShrink: 0,
                  borderRadius: "50%",
                  background: `conic-gradient(${gradientStops.join(", ")})`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <div style={{ width: "86px", height: "86px", borderRadius: "50%", background: theme.surface, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                  <div style={{ fontSize: "18px", fontWeight: 900, color: theme.text, lineHeight: 1 }}>{(() => { const finishedMatchIds = new Set(matches.filter((m) => m.actualHome !== "" && m.actualHome != null && m.actualAway !== "" && m.actualAway != null).map((m) => m.id)); return allPredictionRows.filter((r) => r.user_id === currentUser?.id && r.pred_home !== null && r.pred_away !== null && finishedMatchIds.has(r.match_id)).length; })()}</div>
                  <div style={{ fontSize: "8px", color: theme.muted, marginTop: "3px" }}>عدد التوقعات</div>
                </div>
                {tierColors
                  .filter((t) => tierCounts[t.key] > 0)
                  .map((t) => {
                    const pct = Math.round((tierCounts[t.key] / totalScored) * 100);
                    const from = (segmentStartByKey[t.key] / totalScored) * 360;
                    const to = ((segmentStartByKey[t.key] + tierCounts[t.key]) / totalScored) * 360;
                    const midAngleRad = ((from + to) / 2) * (Math.PI / 180);
                    const r = 56;
                    const x = 70 + r * Math.sin(midAngleRad);
                    const y = 70 - r * Math.cos(midAngleRad);
                    return (
                      <span
                        key={t.key}
                        style={{
                          position: "absolute",
                          left: `${x}px`,
                          top: `${y}px`,
                          transform: "translate(-50%, -50%)",
                          fontSize: "8px",
                          fontWeight: 800,
                          color: "#FFFFFF",
                          textShadow: "0 1px 2px rgba(0,0,0,0.45)",
                          pointerEvents: "none",
                        }}
                      >
                        {pct}%
                      </span>
                    );
                  })}
              </div>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "7px" }}>
                {tierColors.map((t) => (
                  <div key={t.key} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span
                      style={{
                        width: "22px",
                        height: "22px",
                        borderRadius: "50%",
                        border: `2.5px solid ${t.color}`,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                        fontSize: "8px",
                        fontWeight: 800,
                        color: t.color,
                      }}
                    >
                      {tierCounts[t.key] || 0}
                    </span>
                    <span style={{ fontSize: "11px", color: theme.text }}>{t.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {(mostCommonActualResult || mostCommonPredictedResult) && (
            <div style={{ display: "flex", gap: "10px", marginTop: "14px", paddingTop: "14px", borderTop: `1px solid ${theme.border}` }}>
              {mostCommonActualResult && (
                <div style={{ flex: 1, textAlign: "center" }}>
                  <div style={{ fontSize: "11px", color: theme.muted, marginBottom: "5px" }}>أكثر نتيجة انتهت بها المباريات</div>
                  <div style={{ fontSize: "18px", fontWeight: 800, color: theme.text }}>{mostCommonActualResult}</div>
                </div>
              )}
              {mostCommonPredictedResult && (
                <div style={{ flex: 1, textAlign: "center" }}>
                  <div style={{ fontSize: "11px", color: theme.muted, marginBottom: "5px" }}>أكثر نتيجة مدخلة من المشاركين</div>
                  <div style={{ fontSize: "18px", fontWeight: 800, color: theme.text }}>{mostCommonPredictedResult}</div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      </div>
      </div>
    </div>
  );
}

function ExampleTable({ example, theme }) {
  const { home, away, predHome, predAway, actualHome, actualAway, note, winner, loser } = example;
  const cellStyle = {
    border: `1px solid ${theme.border}`,
    padding: "8px 10px",
    textAlign: "center",
    fontSize: "10px",
  };
  const labelCellStyle = {
    ...cellStyle,
    background: theme.bg,
    fontWeight: 800,
    color: theme.muted,
    whiteSpace: "nowrap",
  };

  // Determine if the predicted winner/draw outcome matches what actually
  // happened, so the الفائز/الخاسر row can be colored correctly (green if
  // right, red if wrong) instead of always green.
  const predDiff = predHome - predAway;
  const actualDiff = actualHome - actualAway;
  const predOutcome = predDiff > 0 ? "home" : predDiff < 0 ? "away" : "draw";
  const actualOutcome = actualDiff > 0 ? "home" : actualDiff < 0 ? "away" : "draw";
  const winnerColor = predOutcome === actualOutcome ? theme.accent : theme.danger;

  return (
    <div style={{ overflow: "hidden", borderRadius: "8px", border: `1px solid ${theme.border}` }}>
      <table dir="rtl" style={{ width: "100%", borderCollapse: "collapse", fontFamily: "Cairo, sans-serif" }}>
        <tbody>
          <tr>
            <td style={{ ...cellStyle, fontWeight: 700, color: theme.text }}>{away}</td>
            <td style={{ ...cellStyle, fontWeight: 700, color: theme.text }}>{home}</td>
            <td style={labelCellStyle}>المباراة</td>
          </tr>
          {winner && (
            <tr>
              <td style={{ ...cellStyle, fontWeight: 700, color: winnerColor }} colSpan={2}>{winner}</td>
              <td style={labelCellStyle}>الفائز</td>
            </tr>
          )}
          {loser && (
            <tr>
              <td style={{ ...cellStyle, fontWeight: 700, color: winnerColor }} colSpan={2}>{loser}</td>
              <td style={labelCellStyle}>الخاسر</td>
            </tr>
          )}
          <tr>
            <td style={{ ...cellStyle, fontWeight: 700, color: predAway === actualAway ? theme.accent : theme.danger }}>{predAway}</td>
            <td style={{ ...cellStyle, fontWeight: 700, color: predHome === actualHome ? theme.accent : theme.danger }}>{predHome}</td>
            <td style={labelCellStyle}>الأهداف</td>
          </tr>
          <tr>
            <td style={{ ...cellStyle, fontWeight: 700, color: theme.text }}>{actualAway}</td>
            <td style={{ ...cellStyle, fontWeight: 700, color: theme.text }}>{actualHome}</td>
            <td style={labelCellStyle}>النتيجة الفعلية</td>
          </tr>
          <tr>
            <td style={{ ...cellStyle, color: theme.text }} colSpan={2}>{note}</td>
            <td style={labelCellStyle}>إيضاح</td>

          </tr>
        </tbody>
      </table>
    </div>
  );
}

function PointsSystemPage({ theme }) {
  const tiers = getTiers(theme);
  const [expandedPoints, setExpandedPoints] = useState(null);

  return (
    <div style={{ padding: "20px 16px 60px" }}>
      <div className="page-container">
        <h2 style={{ fontSize: "16px", fontWeight: 800, color: theme.primary, marginBottom: "4px" }}>
          نظام النقاط
        </h2>
        <p style={{ fontSize: "12px", color: theme.muted, marginBottom: "20px" }}>
          كل توقع يُقارن بالنتيجة الفعلية، وتُمنح النقاط حسب أعلى حالة تنطبق (بدون تجميع بين الحالات). اضغط على أي حالة لمشاهدة مثال
        </p>

        <div
          style={{
            background: theme.surface,
            border: `1px solid ${theme.border}`,
            borderRadius: "14px",
            padding: "4px 18px",
            boxShadow: "0 2px 10px rgba(0,0,0,0.05)",
          }}
        >
          {tiers.map((t, i) => {
            const isOpen = expandedPoints === t.points;
            const isLast = i === tiers.length - 1;
            return (
              <div key={t.points} style={{ borderBottom: isLast ? "none" : `1px solid ${theme.border}` }}>
                <button
                  onClick={() => setExpandedPoints(isOpen ? null : t.points)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    padding: "12px 0",
                    width: "100%",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    textAlign: "right",
                  }}
                >
                  <div
                    style={{
                      width: "34px",
                      height: "34px",
                      borderRadius: "50%",
                      background: t.bg,
                      border: `1.5px solid ${t.ring}`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: t.text,
                      flexShrink: 0,
                    }}
                  >
                    <span
                      style={{
                        fontSize: "10px",
                        lineHeight: "1",
                        fontWeight: 800,
                        display: "inline-block",
                        paddingTop: "1px",
                      }}
                    >
                      {t.points}
                    </span>
                  </div>
                  <span style={{ flex: 1, fontSize: "10px", color: theme.text, fontWeight: 600, fontFamily: "Cairo, sans-serif" }}>{t.label}</span>
                  <ChevronDown
                    size={16}
                    color={theme.muted}
                    style={{ transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s", flexShrink: 0 }}
                  />
                </button>

                {isOpen && (
                  <div
                    style={{
                      marginBottom: "14px",
                    }}
                  >
                    <ExampleTable example={t.example} theme={theme} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Adds the 7th "didn't predict" case to the 6 scoring tiers for display
// purposes on the stats page.
function getStatsTiers(theme) {
  return [
    ...getTiers(theme),
    { points: "none", label: "لم يتوقع", bg: theme.bg, text: theme.muted, ring: theme.inputBorder },
  ];
}

function StatBox({ label, value, theme }) {
  return (
    <div
      style={{
        flex: 1,
        background: theme.surface,
        border: `1.5px solid ${theme.violet}`,
        borderRadius: "12px",
        padding: "14px",
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: "22px", fontWeight: 800, color: theme.primary, fontFamily: "Cairo" }}>{value}</div>
      <div style={{ fontSize: "11px", color: theme.muted, marginTop: "4px" }}>{label}</div>
    </div>
  );
}

function StatsPage({ matches, tournaments, tournamentLogos, theme }) {
  const [tournamentFilter, setTournamentFilter] = usePersistedState("stats.tournamentFilter", "الكل");
  const [tierView, setTierView] = usePersistedState("stats.tierView", "count"); // "count" | "percent"
  const statsTiers = getStatsTiers(theme);

  const filteredMatches = tournamentFilter === "الكل" ? matches : matches.filter((m) => (m.tournament || "بدون بطولة") === tournamentFilter);
  const stats = computeStats(filteredMatches);

  return (
    <div style={{ padding: "20px 16px 60px" }}>
      <div className="page-container">
        <h2 style={{ fontSize: "16px", fontWeight: 800, color: theme.primary, marginBottom: "4px" }}>
          الإحصائيات
        </h2>
        <p style={{ fontSize: "12px", color: theme.muted, marginBottom: "16px" }}>
          أداؤك في كل التوقعات اللي دخلتها على المباريات المنتهية
        </p>

        {/* Tournament filter - same dropdown style as the admin's tournament picker,
            sharing the same tournaments list across the whole app */}
        <TournamentFilterPicker
          value={tournamentFilter}
          onChange={setTournamentFilter}
          tournaments={tournaments}
          tournamentLogos={tournamentLogos}
          theme={theme}
        />

        {/* Summary boxes */}
        <div style={{ display: "flex", gap: "10px", marginBottom: "20px" }}>
          <StatBox label="توقعات أدخلتها" value={stats.totalPredicted} theme={theme} />
          <StatBox label="إجمالي النقاط" value={stats.totalPoints} theme={theme} />
        </div>

        {/* Top team */}
        {stats.topTeam && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              background: theme.violetSoft,
              border: `1px solid ${theme.violet}`,
              borderRadius: "12px",
              padding: "12px 16px",
              marginBottom: "20px",
            }}
          >
            <TrendingUp size={18} color={theme.violet} />
            <span style={{ flex: 1, fontSize: "12px", color: theme.text }}>
              أكثر فريق جابلك نقاط: <strong>{stats.topTeam.name}</strong>
            </span>
            <span style={{ fontFamily: "Cairo", fontWeight: 800, fontSize: "16px", color: theme.violet }}>
              {stats.topTeam.points}
            </span>
          </div>
        )}

        {/* Tier breakdown with count/percent toggle */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
          <span style={{ fontSize: "12px", fontWeight: 700, color: theme.text }}>توزيع النتائج حسب الحالة</span>
          <div
            style={{
              display: "flex",
              background: theme.bg,
              borderRadius: "8px",
              padding: "3px",
            }}
          >
            <button
              onClick={() => setTierView("count")}
              style={{
                padding: "5px 12px",
                borderRadius: "6px",
                border: "none",
                background: tierView === "count" ? theme.violet : "transparent",
                color: tierView === "count" ? "#FFFFFF" : theme.muted,
                fontFamily: "Cairo, sans-serif",
                fontWeight: 700,
                fontSize: "11px",
                cursor: "pointer",
              }}
            >
              العدد
            </button>
            <button
              onClick={() => setTierView("percent")}
              style={{
                padding: "5px 12px",
                borderRadius: "6px",
                border: "none",
                background: tierView === "percent" ? theme.violet : "transparent",
                color: tierView === "percent" ? "#FFFFFF" : theme.muted,
                fontFamily: "Cairo, sans-serif",
                fontWeight: 700,
                fontSize: "11px",
                cursor: "pointer",
              }}
            >
              النسبة
            </button>
          </div>
        </div>

        <div
          style={{
            background: theme.surface,
            border: `1.5px solid ${theme.violet}`,
            borderRadius: "12px",
            padding: "6px 16px",
          }}
        >
          {statsTiers.map((t, i) => {
            const count = stats.tierCounts[t.points] || 0;
            const pct = stats.totalFinished > 0 ? Math.round((count / stats.totalFinished) * 100) : 0;
            const isLast = i === statsTiers.length - 1;
            return (
              <div
                key={`tier-${t.points}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  padding: "14px 0",
                  borderBottom: isLast ? "none" : `1px solid ${theme.border}`,
                }}
              >
                <div
                  style={{
                    width: "36px",
                    height: "36px",
                    borderRadius: "50%",
                    background: t.bg,
                    border: `1.5px solid ${t.ring}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: t.text,
                    flexShrink: 0,
                  }}
                >
                  <span
                    style={{
                      fontSize: "10px",
                      lineHeight: "13px",
                      fontWeight: 800,
                      display: "inline-block",
                      transform: "translateY(0.5px)",
                    }}
                  >
                    {t.points === "none" ? "—" : t.points}
                  </span>
                </div>
                <span style={{ flex: 1, fontSize: "10px", color: theme.text, fontWeight: 600 }}>{t.label}</span>
                <div
                  style={{
                    fontFamily: "Cairo, sans-serif",
                    fontWeight: 800,
                    fontSize: "20px",
                    color: theme.violet,
                    minWidth: "50px",
                    textAlign: "left",
                  }}
                >
                  {tierView === "count" ? count : `${pct}%`}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const NAV_ITEMS = [
  { id: "home", label: "الرئيسية", icon: Home, color: (t) => t.violet },
  { id: "predictions", label: "توقع المباريات", icon: Target, color: (t) => t.danger },
  { id: "championships", label: "البطولات", icon: ListOrdered, color: (t) => "#D4AF37" },
  { id: "leagues", label: "الدوريات", icon: Users, color: (t) => t.blue },
  { id: "globalLeaderboard", label: "لوحة الترتيب العام", icon: Trophy, color: (t) => "#10B981" },
  { id: "stats", label: "الإحصائيات", icon: BarChart3, color: (t) => "#F59E0B" },
  { id: "pointsSystem", label: "نظام النقاط", icon: Award, color: (t) => t.violet },
  { id: "prizes", label: "الجوائز", icon: Crown, color: (t) => "#D4AF37" },
  { id: "profile", label: "الملف الشخصي", icon: User, color: (t) => t.blue },
];

// Admin-only section, shown as a collapsible group above the general nav
// items (only visible when viewMode === "admin").
const ADMIN_NAV_ITEMS = [
  { id: "clubs", label: "إدارة الأندية", icon: Shield, color: (t) => t.muted },
  { id: "users", label: "المستخدمون", icon: Users, color: (t) => t.muted },
];

function NavDrawer({ open, onClose, activePage, onNavigate, viewMode, setViewMode, currentUser, onLogout, theme }) {
  const [adminSectionOpen, setAdminSectionOpen] = useState(false);

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.45)",
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          transition: "opacity 0.25s ease",
          zIndex: 40,
        }}
      />

      {/* Drawer panel - slides in from the right */}
      <div
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: "78%",
          maxWidth: "300px",
          background: theme.surface,
          borderLeft: `2px solid ${theme.violet}`,
          transform: open ? "translateX(0)" : "translateX(100%)",
          transition: "transform 0.28s ease",
          zIndex: 50,
          display: "flex",
          flexDirection: "column",
          padding: "20px 18px",
          overflowY: "auto",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
          <span style={{ fontFamily: "Cairo, sans-serif", fontWeight: 800, fontSize: "16px", color: theme.primary }}>
            القوائم
          </span>
          <button
            onClick={onClose}
            aria-label="إغلاق القائمة"
            style={{ background: "transparent", border: "none", color: theme.muted, cursor: "pointer", padding: "4px", display: "flex" }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Admin-only section toggle - only visible in المنظّم mode */}
        {viewMode === "admin" && (
          <div style={{ marginBottom: "12px" }}>
            <button
              onClick={() => setAdminSectionOpen((o) => !o)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                padding: "12px 14px",
                borderRadius: "10px",
                border: `1px solid ${theme.violet}`,
                background: theme.violetSoft,
                color: theme.violet,
                fontFamily: "Cairo, sans-serif",
                fontWeight: 700,
                fontSize: "10px",
                cursor: "pointer",
                width: "100%",
              }}
            >
              <Shield size={17} />
              قوائم المنظّم
              <ChevronDown
                size={16}
                style={{ marginRight: "auto", transform: adminSectionOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}
              />
            </button>

            {adminSectionOpen && (
              <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginTop: "6px" }}>
                {ADMIN_NAV_ITEMS.map((item) => {
                  const Icon = item.icon;
                  const isActive = activePage === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => {
                        onNavigate(item.id);
                        onClose();
                      }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "12px",
                        padding: "11px 14px",
                        borderRadius: "10px",
                        border: "none",
                        background: isActive ? theme.primarySoft : theme.bg,
                        color: isActive ? theme.primary : theme.text,
                        fontFamily: "Cairo, sans-serif",
                        fontWeight: isActive ? 700 : 500,
                        fontSize: "10px",
                        cursor: "pointer",
                        textAlign: "right",
                        width: "100%",
                      }}
                    >
                      <Icon size={16} color={isActive ? theme.primary : item.color(theme)} />
                      {item.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <nav style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activePage === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  onNavigate(item.id);
                  onClose();
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  padding: "13px 14px",
                  borderRadius: "10px",
                  border: "none",
                  background: isActive ? theme.primarySoft : "transparent",
                  color: isActive ? theme.primary : theme.text,
                  fontFamily: "Cairo, sans-serif",
                  fontWeight: isActive ? 700 : 500,
                  fontSize: "14px",
                  cursor: "pointer",
                  textAlign: "right",
                  width: "100%",
                }}
              >
                <Icon size={18} color={isActive ? theme.primary : item.color(theme)} />
                {item.label}
                {isActive && (
                  <span
                    style={{
                      marginRight: "auto",
                      fontSize: "10px",
                      fontWeight: 700,
                      color: theme.primary,
                      background: theme.surface,
                      border: `1px solid ${theme.primary}`,
                      borderRadius: "20px",
                      padding: "2px 8px",
                    }}
                  >
                    أنت هنا
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Admin/User mode switch - affects what the whole app shows.
            Only the organizer (currentUser.is_admin) can see or use this;
            everyone else is locked to المشارك (participant) mode. */}
        <div style={{ marginTop: "auto", paddingTop: "16px", borderTop: `1px solid ${theme.border}` }}>
          {currentUser?.is_admin && (
          <>
          <span style={{ fontFamily: "Cairo, sans-serif", fontSize: "11px", fontWeight: 600, color: theme.muted, display: "block", marginBottom: "8px" }}>
            وضع الاستخدام
          </span>
          <div
            style={{
              display: "flex",
              background: theme.bg,
              border: `1px solid ${theme.border}`,
              borderRadius: "10px",
              padding: "3px",
              marginBottom: "12px",
            }}
          >
            <button
              onClick={() => setViewMode("admin")}
              style={{
                flex: 1,
                padding: "8px 12px",
                borderRadius: "8px",
                border: "none",
                background: viewMode === "admin" ? theme.primary : "transparent",
                color: viewMode === "admin" ? theme.surface : theme.muted,
                fontFamily: "Cairo, sans-serif",
                fontWeight: 700,
                fontSize: "12px",
                cursor: "pointer",
              }}
            >
              المنظّم
            </button>
            <button
              onClick={() => {
                setViewMode("user");
                if (activePage === "clubs") onNavigate("home");
              }}
              style={{
                flex: 1,
                padding: "8px 12px",
                borderRadius: "8px",
                border: "none",
                background: viewMode === "user" ? theme.primary : "transparent",
                color: viewMode === "user" ? theme.surface : theme.muted,
                fontFamily: "Cairo, sans-serif",
                fontWeight: 700,
                fontSize: "12px",
                cursor: "pointer",
              }}
            >
              المشارك
            </button>
          </div>
          </>
          )}

          {/* Login / logout */}
          <button
            onClick={() => {
              if (currentUser) {
                onLogout();
                onClose();
              } else {
                onNavigate("auth");
                onClose();
              }
            }}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
              width: "100%",
              padding: "10px 14px",
              borderRadius: "10px",
              border: `1px solid ${currentUser ? theme.danger : theme.primary}`,
              background: "transparent",
              color: currentUser ? theme.danger : theme.primary,
              fontFamily: "Cairo, sans-serif",
              fontWeight: 700,
              fontSize: "10px",
              cursor: "pointer",
            }}
          >
            {currentUser ? <LogOut size={16} /> : <LogIn size={16} />}
            {currentUser ? "تسجيل الخروج" : "تسجيل الدخول"}
          </button>
        </div>
      </div>
    </>
  );
}

// A hand-drawn-style wavy divider line, used as a decorative violet accent
// beneath the header and above each match's schedule row.
function VioletDivider({ theme }) {
  return <div style={{ height: "0.5px", background: theme.violet }} />;
}

function TopBar({ onMenuClick, onLogoClick, theme }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "16px 18px",
        background: theme.surface,
      }}
    >
      <div
        onClick={onLogoClick}
        style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer" }}
      >
        <img src="/logo.png" alt="" width={48} height={48} style={{ borderRadius: "8px" }} />
        <div>
          <h1
            style={{
              fontSize: "18px",
              fontWeight: 800,
              color: theme.primary,
              margin: 0,
              fontFamily: "Cairo, sans-serif",
            }}
          >
            فانتسي التوقعات
          </h1>
          <p
            dir="ltr"
            style={{
              fontSize: "10px",
              fontWeight: 500,
              color: theme.muted,
              margin: 0,
              fontFamily: "Cairo, sans-serif",
              letterSpacing: "0.3px",
            }}
          >
            Fantasy Predictions
          </p>
        </div>
      </div>
      <button
        onClick={onMenuClick}
        aria-label="فتح القوائم"
        style={{
          background: "transparent",
          border: "none",
          color: theme.text,
          cursor: "pointer",
          padding: "6px",
          display: "flex",
        }}
      >
        <Menu size={24} />
      </button>
    </div>
  );
}

// Points for one competition's prediction against the final standings.
//
// League (top 3), max 10:  exact 1st = 5, exact 2nd = 3, exact 3rd = 2,
//   right team but wrong position (still in the actual top 3) = 1, else 0.
//
// Cup (champion + runner-up only), max 25:
//   champion exact = 15, predicted champion who became runner-up = 5,
//   runner-up exact = 10, predicted runner-up who became champion = 5, else 0.
// Per-team result for one predicted position: how many points it earned and
// the colour that represents it (green = exact, orange = right team wrong
// position, red = wrong / outside).
function champTeamScore(team, posIndex, result, isCup) {
  const GREEN = "#10B981", ORANGE = "#F59E0B", RED = "#EF4444";
  if (!team) return { pts: 0, color: null };
  if (isCup) {
    const champ = result.first_team, runner = result.second_team;
    if (posIndex === 0) {
      if (team === champ) return { pts: 15, color: GREEN };
      if (team === runner) return { pts: 5, color: ORANGE };
      return { pts: 0, color: RED };
    }
    // runner-up prediction
    if (team === runner) return { pts: 10, color: GREEN };
    if (team === champ) return { pts: 5, color: ORANGE };
    return { pts: 0, color: RED };
  }
  const exactPts = [5, 3, 2][posIndex];
  const actualAtPos = [result.first_team, result.second_team, result.third_team][posIndex];
  const actualTop3 = [result.first_team, result.second_team, result.third_team].filter(Boolean);
  if (team === actualAtPos) return { pts: exactPts, color: GREEN };
  if (actualTop3.includes(team)) return { pts: 1, color: ORANGE };
  return { pts: 0, color: RED };
}

function champPoints(pick, result, isCup) {
  if (!result) return null;
  if (isCup) {
    const champ = result.first_team;
    const runner = result.second_team;
    let pts = 0;
    if (pick.first) pts += pick.first === champ ? 15 : pick.first === runner ? 5 : 0;
    if (pick.second) pts += pick.second === runner ? 10 : pick.second === champ ? 5 : 0;
    return pts;
  }
  const actualTop3 = [result.first_team, result.second_team, result.third_team].filter(Boolean);
  const scorePos = (team, actualTeam, exactPts) => {
    if (!team) return 0;
    if (actualTeam && actualTeam === team) return exactPts;
    if (actualTop3.includes(team)) return 1;
    return 0;
  };
  return (
    scorePos(pick.first, result.first_team, 5) +
    scorePos(pick.second, result.second_team, 3) +
    scorePos(pick.third, result.third_team, 2)
  );
}

// Championships section: predict the final top 3 of chosen leagues. Scored
// separately from match predictions; standings are revealed once the organizer
// enters the final results at the end of the season.
function ChampionshipsPage({
  tournamentRows,
  clubsByTournament,
  tournamentLogos,
  championshipPredsByTournament,
  championshipResults,
  championshipSettings,
  allChampionshipPreds,
  currentUser,
  viewMode,
  onSavePick,
  onSaveResult,
  onToggleChampionship,
  onToggleCup,
  onMoveLeague,
  onSaveLock,
  theme,
}) {
  const isAdmin = viewMode === "admin";
  const lockAt = championshipSettings?.lock_at ? new Date(championshipSettings.lock_at) : null;
  const locked = lockAt ? serverNow() >= lockAt.getTime() : false;

  const leagues = tournamentRows
    .filter((t) => t.is_championship)
    .sort((a, b) => (a.sort_order ?? 9999) - (b.sort_order ?? 9999));
  const resultByTournament = {};
  for (const r of championshipResults) resultByTournament[r.tournament_id] = r;

  const [drafts, setDrafts] = useState({}); // tournamentId -> {first, second, third}
  const [savedFlash, setSavedFlash] = useState({});
  const [resultFlash, setResultFlash] = useState({});
  const [adminResults, setAdminResults] = useState({});
  const [lockInput, setLockInput] = useState(
    championshipSettings?.lock_at ? new Date(championshipSettings.lock_at).toISOString().slice(0, 16) : ""
  );

  const getPick = (tid) => drafts[tid] || championshipPredsByTournament[tid] || { first: "", second: "", third: "" };
  const getAdminResult = (tid) => adminResults[tid] || resultByTournament[tid] ? {
    first: (adminResults[tid]?.first ?? resultByTournament[tid]?.first_team) || "",
    second: (adminResults[tid]?.second ?? resultByTournament[tid]?.second_team) || "",
    third: (adminResults[tid]?.third ?? resultByTournament[tid]?.third_team) || "",
  } : { first: "", second: "", third: "" };

  // Championship leaderboard: total points across all leagues that have a
  // final result entered.
  const leaderboard = (() => {
    const hasAnyResult = championshipResults.length > 0;
    if (!hasAnyResult) return null;
    const cupByTournament = {};
    for (const t of tournamentRows) cupByTournament[t.id] = !!t.is_cup;
    const byUser = {};
    for (const row of allChampionshipPreds) {
      const result = resultByTournament[row.tournament_id];
      if (!result) continue;
      const pts = champPoints(
        { first: row.first_team, second: row.second_team, third: row.third_team },
        result,
        cupByTournament[row.tournament_id]
      );
      if (!byUser[row.user_id]) {
        byUser[row.user_id] = {
          userId: row.user_id,
          name: row.profiles?.name || "مستخدم",
          username: row.profiles?.username || "",
          points: 0,
        };
      }
      byUser[row.user_id].points += pts || 0;
    }
    return Object.values(byUser).sort((a, b) => b.points - a.points);
  })();

  const selectStyle = {
    width: "100%",
    border: `1.5px solid ${theme.inputBorder}`,
    borderRadius: "10px",
    padding: "10px 12px",
    fontFamily: "Cairo, sans-serif",
    fontSize: "14px",
    color: theme.text,
    background: theme.surface,
    outline: "none",
  };

  const PositionSelect = ({ teams, value, onChange, exclude, placeholder, disabled }) => (
    <select style={{ ...selectStyle, opacity: disabled ? 0.6 : 1 }} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
      <option value="">{placeholder}</option>
      {teams
        .filter((name) => name === value || !exclude.includes(name))
        .map((name) => (
          <option key={name} value={name}>{name}</option>
        ))}
    </select>
  );

  return (
    <div style={{ padding: "20px 16px 60px", maxWidth: "560px", margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px", justifyContent: "center" }}>
        <ListOrdered size={22} color="#D4AF37" />
        <h2 style={{ fontSize: "20px", fontWeight: 900, color: theme.text, margin: 0 }}>البطولات</h2>
      </div>
      <p style={{ fontSize: "12px", color: theme.muted, textAlign: "center", marginBottom: "14px", lineHeight: 1.7 }}>
        توقّع أبطال الدوريات والكؤوس. نقاط منفصلة تماماً عن توقعات المباريات، وتظهر نهاية الموسم.
      </p>

      {/* Scoring explanation */}
      <div style={{ background: theme.surface, border: `1.5px solid ${theme.border}`, borderRadius: "14px", padding: "14px 16px", marginBottom: "18px" }}>
        <div style={{ fontSize: "13px", fontWeight: 800, color: theme.primary, marginBottom: "8px" }}>كيف تُحسب النقاط؟</div>

        <div style={{ fontSize: "12.5px", fontWeight: 800, color: theme.text, marginBottom: "4px" }}>🏆 الدوري (ترتيب أول ٣) — الأقصى ١٠</div>
        <ul style={{ margin: "0 0 12px", paddingInlineStart: "18px", color: theme.muted, fontSize: "12px", lineHeight: 1.9 }}>
          <li>المركز الأول صحيح = <b style={{ color: theme.text }}>٥ نقاط</b></li>
          <li>الوصيف (الثاني) صحيح = <b style={{ color: theme.text }}>٣ نقاط</b></li>
          <li>المركز الثالث صحيح = <b style={{ color: theme.text }}>نقطتان</b></li>
          <li>فريق ضمن الأول ٣ لكن بمركز مختلف = <b style={{ color: theme.text }}>نقطة</b></li>
          <li>فريق خارج الأول ٣ = <b style={{ color: theme.text }}>صفر</b></li>
        </ul>

        <div style={{ fontSize: "12.5px", fontWeight: 800, color: theme.text, marginBottom: "4px" }}>🥇 الكأس (بطل ووصيف) — الأقصى ٢٥</div>
        <ul style={{ margin: 0, paddingInlineStart: "18px", color: theme.muted, fontSize: "12px", lineHeight: 1.9 }}>
          <li>توقّعت البطل صحيح = <b style={{ color: theme.text }}>١٥ نقطة</b></li>
          <li>توقّعت البطل لكنه صار وصيف = <b style={{ color: theme.text }}>٥ نقاط</b></li>
          <li>توقّعت الوصيف صحيح = <b style={{ color: theme.text }}>١٠ نقاط</b></li>
          <li>توقّعت الوصيف لكنه صار بطل = <b style={{ color: theme.text }}>٥ نقاط</b></li>
          <li>غير ذلك = <b style={{ color: theme.text }}>صفر</b></li>
        </ul>
      </div>

      {lockAt && (
        <div
          style={{
            background: locked ? theme.dangerSoft || theme.surface : theme.surface,
            border: `1.5px solid ${locked ? theme.danger : theme.primary}`,
            borderRadius: "12px",
            padding: "10px 14px",
            marginBottom: "16px",
            textAlign: "center",
            fontSize: "12px",
            fontWeight: 700,
            color: locked ? theme.danger : theme.text,
          }}
        >
          {locked
            ? "🔒 أُقفلت توقعات البطولات"
            : `⏳ تُقفل التوقعات: ${lockAt.toLocaleString("ar", { dateStyle: "medium", timeStyle: "short" })}`}
        </div>
      )}

      {/* ===== Admin controls ===== */}
      {isAdmin && (
        <div style={{ background: theme.surface, border: `1.5px solid ${theme.border}`, borderRadius: "14px", padding: "16px", marginBottom: "20px" }}>
          <div style={{ fontSize: "13px", fontWeight: 800, color: theme.primary, marginBottom: "12px" }}>⚙️ إعدادات المنظم</div>

          <label style={{ fontSize: "11px", fontWeight: 700, color: theme.muted, display: "block", marginBottom: "6px" }}>
            موعد إقفال التوقعات
          </label>
          <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
            <input
              type="datetime-local"
              value={lockInput}
              onChange={(e) => setLockInput(e.target.value)}
              style={{ ...selectStyle, flex: 1 }}
            />
            <button
              onClick={() => onSaveLock(lockInput ? new Date(lockInput).toISOString() : null)}
              style={{ background: theme.primary, color: theme.surface, border: "none", borderRadius: "10px", padding: "0 16px", fontFamily: "Cairo, sans-serif", fontWeight: 700, fontSize: "13px", cursor: "pointer" }}
            >
              حفظ
            </button>
          </div>

          <div style={{ fontSize: "11px", fontWeight: 700, color: theme.muted, marginBottom: "8px" }}>
            الدوريات المعروضة في البطولات — فعّلها، وعلّم "كأس" للبطولات (بطل ووصيف فقط):
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {tournamentRows.map((t) => (
              <div key={t.id} style={{ display: "flex", alignItems: "center", gap: "14px", fontSize: "13px", color: theme.text }}>
                <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", flex: 1 }}>
                  <input
                    type="checkbox"
                    checked={!!t.is_championship}
                    onChange={(e) => onToggleChampionship(t.id, e.target.checked)}
                  />
                  {t.name}
                </label>
                {t.is_championship && (
                  <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", color: theme.muted, fontSize: "12px" }}>
                    <input
                      type="checkbox"
                      checked={!!t.is_cup}
                      onChange={(e) => onToggleCup(t.id, e.target.checked)}
                    />
                    كأس
                  </label>
                )}
              </div>
            ))}
          </div>

          {leagues.length > 1 && (
            <div style={{ marginTop: "16px" }}>
              <div style={{ fontSize: "11px", fontWeight: 700, color: theme.muted, marginBottom: "8px" }}>
                ترتيب عرض الدوريات (بالأسهم):
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {leagues.map((t, i) => (
                  <div key={t.id} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: theme.text }}>
                    <span style={{ flex: 1 }}>{i + 1}. {t.name}</span>
                    <button
                      onClick={() => onMoveLeague(t.id, -1)}
                      disabled={i === 0}
                      style={{ background: theme.bg, border: `1px solid ${theme.border}`, borderRadius: "6px", padding: "4px 9px", cursor: i === 0 ? "default" : "pointer", opacity: i === 0 ? 0.4 : 1, color: theme.text, fontSize: "13px" }}
                    >
                      ▲
                    </button>
                    <button
                      onClick={() => onMoveLeague(t.id, 1)}
                      disabled={i === leagues.length - 1}
                      style={{ background: theme.bg, border: `1px solid ${theme.border}`, borderRadius: "6px", padding: "4px 9px", cursor: i === leagues.length - 1 ? "default" : "pointer", opacity: i === leagues.length - 1 ? 0.4 : 1, color: theme.text, fontSize: "13px" }}
                    >
                      ▼
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {leagues.length === 0 && (
        <div style={{ textAlign: "center", color: theme.muted, fontSize: "13px", padding: "30px 0" }}>
          {isAdmin ? "فعّل دوري أو أكثر من الإعدادات فوق لبدء البطولات." : "لم تُفتح البطولات بعد."}
        </div>
      )}

      {/* ===== Total points across all leagues (participant view) ===== */}
      {!isAdmin && (() => {
        let total = 0, max = 0, anyResult = false;
        for (const lg of leagues) {
          const res = resultByTournament[lg.id];
          if (!res) continue;
          anyResult = true;
          total += champPoints(getPick(lg.id), res, !!lg.is_cup) || 0;
          max += lg.is_cup ? 25 : 10;
        }
        if (!anyResult) return null;
        return (
          <div
            style={{
              background: theme.surface,
              border: `2px solid #D4AF37`,
              borderRadius: "14px",
              padding: "14px 16px",
              marginBottom: "16px",
              display: "flex",
              alignItems: "center",
              gap: "10px",
            }}
          >
            <Trophy size={22} color="#D4AF37" />
            <div style={{ fontSize: "14px", fontWeight: 800, color: theme.text }}>إجمالي نقاطك في البطولات</div>
            <div style={{ marginInlineStart: "auto", fontSize: "18px", fontWeight: 900, color: "#D4AF37" }}>
              {total} / {max}
            </div>
          </div>
        );
      })()}

      {/* ===== Per-league prediction cards ===== */}
      {leagues.map((league) => {
        const teams = (clubsByTournament[league.name] || []).map((c) => c.name);
        const pick = getPick(league.id);
        const result = resultByTournament[league.id];
        const isCup = !!league.is_cup;
        const points = result ? champPoints(pick, result, isCup) : null;
        const maxPts = isCup ? 25 : 10;
        const positions = isCup
          ? [
              { field: "first", label: "🥇 البطل", ph: "اختر البطل" },
              { field: "second", label: "🥈 الوصيف", ph: "اختر الوصيف" },
            ]
          : [
              { field: "first", label: "🥇 المركز الأول", ph: "اختر البطل" },
              { field: "second", label: "🥈 الوصيف", ph: "اختر الوصيف" },
              { field: "third", label: "🥉 المركز الثالث", ph: "اختر الثالث" },
            ];
        const canEdit = !locked && !!currentUser;

        const setField = (field, val) =>
          setDrafts((prev) => ({ ...prev, [league.id]: { ...getPick(league.id), [field]: val } }));

        return (
          <div key={league.id} style={{ background: theme.surface, border: `1.5px solid ${theme.violet}`, borderRadius: "14px", padding: "16px", marginBottom: "14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
              <TournamentIcon name={league.name} logo={tournamentLogos?.[league.name]} theme={theme} size={20} color={theme.primary} />
              <div style={{ fontSize: "15px", fontWeight: 800, color: theme.text }}>{league.name}</div>
              {points != null && !isAdmin && (
                <div style={{ marginRight: "auto", fontSize: "13px", fontWeight: 900, color: "#D4AF37" }}>{points} / {maxPts}</div>
              )}
            </div>

            {teams.length === 0 ? (
              <div style={{ fontSize: "12px", color: theme.muted }}>
                لا توجد فرق لهذا الدوري بعد. أضِف الفرق من صفحة إدارة الأندية.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {/* Personal top-3 prediction — hidden in the organizer view,
                    which only enters the final results below. */}
                {!isAdmin && result ? (
                  /* Results are in: show each pick coloured with points earned. */
                  <>
                    {positions.map(({ field, label }, i) => {
                      const team = pick[field];
                      const { pts, color } = champTeamScore(team, i, result, isCup);
                      return (
                        <div
                          key={field}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                            padding: "9px 11px",
                            borderRadius: "10px",
                            border: `1.5px solid ${color || theme.inputBorder}`,
                            background: color ? `${color}1a` : theme.bg,
                          }}
                        >
                          <span style={{ fontSize: "13px" }}>{label.split(" ")[0]}</span>
                          <span style={{ fontSize: "13px", fontWeight: 700, color: theme.text }}>{team || "—"}</span>
                          <span style={{ marginInlineStart: "auto", fontSize: "12px", fontWeight: 900, color: color || theme.muted }}>
                            {pts > 0 ? `+${pts}` : "٠"} نقطة
                          </span>
                        </div>
                      );
                    })}
                    <div style={{ marginTop: "4px", fontSize: "12px", color: theme.muted, lineHeight: 1.8 }}>
                      <span style={{ fontWeight: 700, color: theme.text }}>الترتيب الفعلي: </span>
                      {isCup
                        ? `🥇 ${result.first_team || "—"} · 🥈 ${result.second_team || "—"}`
                        : `🥇 ${result.first_team || "—"} · 🥈 ${result.second_team || "—"} · 🥉 ${result.third_team || "—"}`}
                    </div>
                  </>
                ) : !isAdmin ? (
                  <>
                    {positions.map(({ field, label, ph }) => (
                      <div key={field}>
                        <label style={{ fontSize: "11px", fontWeight: 700, color: theme.muted, display: "block", marginBottom: "4px" }}>{label}</label>
                        <PositionSelect
                          teams={teams}
                          value={pick[field]}
                          onChange={(v) => setField(field, v)}
                          exclude={positions.map((p) => pick[p.field]).filter((x) => x && x !== pick[field])}
                          placeholder={ph}
                          disabled={!canEdit}
                        />
                      </div>
                    ))}

                    {canEdit && (
                      <button
                        onClick={async () => {
                          try {
                            await onSavePick(league.id, getPick(league.id));
                            setSavedFlash((p) => ({ ...p, [league.id]: true }));
                            setTimeout(() => setSavedFlash((p) => ({ ...p, [league.id]: false })), 1800);
                          } catch (e) {
                            alert("تعذّر حفظ التوقع: " + (e?.message || "خطأ غير متوقع"));
                          }
                        }}
                        style={{ marginTop: "8px", width: "100%", background: savedFlash[league.id] ? "#10B981" : theme.primary, color: theme.surface, border: "none", borderRadius: "10px", padding: "11px 0", fontFamily: "Cairo, sans-serif", fontWeight: 800, fontSize: "13px", cursor: "pointer" }}
                      >
                        {savedFlash[league.id] ? "✓ تم الحفظ" : "حفظ التوقع"}
                      </button>
                    )}
                  </>
                ) : null}

                {/* Admin: enter final result for this league */}
                {isAdmin && (
                  <div style={{ marginTop: "12px", borderTop: `1px dashed ${theme.border}`, paddingTop: "12px" }}>
                    <div style={{ fontSize: "11px", fontWeight: 800, color: theme.primary, marginBottom: "6px" }}>
                      {isCup ? "البطل والوصيف (المنظم)" : "الترتيب النهائي الفعلي (المنظم)"}
                    </div>
                    {positions.map(({ field }, i) => {
                      const ar = getAdminResult(league.id);
                      const ph = isCup ? ["البطل", "الوصيف"][i] : ["المركز الأول", "الوصيف", "الثالث"][i];
                      return (
                        <div key={field} style={{ marginBottom: "6px" }}>
                          <PositionSelect
                            teams={teams}
                            value={ar[field]}
                            onChange={(v) => setAdminResults((prev) => ({ ...prev, [league.id]: { ...getAdminResult(league.id), [field]: v } }))}
                            exclude={positions.map((p) => ar[p.field]).filter((x) => x && x !== ar[field])}
                            placeholder={ph}
                            disabled={false}
                          />
                        </div>
                      );
                    })}
                    <button
                      onClick={async () => {
                        try {
                          await onSaveResult(league.id, getAdminResult(league.id));
                          setResultFlash((p) => ({ ...p, [league.id]: true }));
                          setTimeout(() => setResultFlash((p) => ({ ...p, [league.id]: false })), 1800);
                        } catch (e) {
                          alert("تعذّر حفظ النتيجة: " + (e?.message || "خطأ غير متوقع"));
                        }
                      }}
                      style={{ width: "100%", background: resultFlash[league.id] ? "#10B981" : theme.text, color: theme.surface, border: "none", borderRadius: "10px", padding: "9px 0", fontFamily: "Cairo, sans-serif", fontWeight: 700, fontSize: "12px", cursor: "pointer", marginTop: "2px" }}
                    >
                      {resultFlash[league.id] ? "✓ تم حفظ النتيجة" : "حفظ النتيجة النهائية"}
                    </button>

                    {/* All participants' predictions for this league */}
                    {(() => {
                      const subs = allChampionshipPreds
                        .filter((r) => r.tournament_id === league.id)
                        .sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));
                      return (
                        <div style={{ marginTop: "14px", borderTop: `1px dashed ${theme.border}`, paddingTop: "12px" }}>
                          <div style={{ fontSize: "11px", fontWeight: 800, color: theme.primary, marginBottom: "8px" }}>
                            توقعات المشاركين ({subs.length})
                          </div>
                          {subs.length === 0 ? (
                            <div style={{ fontSize: "12px", color: theme.muted }}>لا توجد توقعات بعد.</div>
                          ) : (
                            <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                              {subs.map((r) => (
                                <div
                                  key={r.user_id}
                                  style={{
                                    background: theme.bg,
                                    borderRadius: "8px",
                                    padding: "6px 8px",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "8px",
                                    flexWrap: "nowrap",
                                    whiteSpace: "nowrap",
                                    overflowX: "auto",
                                    fontSize: "10px",
                                  }}
                                >
                                  <span style={{ fontWeight: 800, color: theme.text }}>{r.profiles?.name || "مستخدم"}</span>
                                  <span style={{ display: "inline-flex", gap: "6px", alignItems: "center" }}>
                                    {(isCup ? ["first", "second"] : ["first", "second", "third"]).map((f, i) => {
                                      const medal = ["🥇", "🥈", "🥉"][i];
                                      const team = r[f + "_team"];
                                      const sc = result ? champTeamScore(team, i, result, isCup) : null;
                                      return (
                                        <span key={f} style={{ color: sc?.color || theme.text, fontWeight: sc?.color ? 800 : 400 }}>
                                          {medal}{team || "—"}{sc ? ` (${sc.pts})` : ""}
                                        </span>
                                      );
                                    })}
                                  </span>
                                  {r.updated_at && (
                                    <span style={{ color: theme.muted }}>
                                      · {new Date(r.updated_at).toLocaleString("ar", { dateStyle: "short", timeStyle: "short" })}
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* ===== Championship leaderboard ===== */}
      {leagues.length > 0 && (
        <div style={{ background: theme.surface, border: `1.5px solid ${theme.border}`, borderRadius: "14px", padding: "16px", marginTop: "8px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
            <Trophy size={18} color="#D4AF37" />
            <div style={{ fontSize: "14px", fontWeight: 800, color: theme.text }}>ترتيب البطولات</div>
          </div>
          {!leaderboard ? (
            <div style={{ fontSize: "12px", color: theme.muted, textAlign: "center", padding: "12px 0" }}>
              تظهر النقاط بعد إدخال النتائج النهائية.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {leaderboard.map((u, i) => (
                <div
                  key={u.userId}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    padding: "8px 10px",
                    borderRadius: "10px",
                    background: u.userId === currentUser?.id ? theme.bg : "transparent",
                  }}
                >
                  <div style={{ width: "22px", fontSize: "13px", fontWeight: 900, color: i < 3 ? "#D4AF37" : theme.muted }}>{i + 1}</div>
                  <div style={{ flex: 1, fontSize: "13px", fontWeight: 700, color: theme.text }}>{u.name}</div>
                  <div style={{ fontSize: "14px", fontWeight: 900, color: "#D4AF37" }}>{u.points}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// One-time announcement shown to logged-in users who haven't turned on push
// notifications yet, pointing them to the profile page to enable them.
function NotificationUpdateBanner({ currentUser, onGoToProfile, theme }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!currentUser) { setShow(false); return; }
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    if (localStorage.getItem("pushBannerDismissed") === "1") return;
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setShow(!sub))
      .catch(() => {});
  }, [currentUser?.id]);

  if (!show) return null;

  const dismiss = () => {
    localStorage.setItem("pushBannerDismissed", "1");
    setShow(false);
  };

  return (
    <div style={{ padding: "10px 12px 0" }}>
      <div
        style={{
          background: theme.surface,
          border: `1.5px solid ${theme.primary}`,
          borderRadius: "12px",
          padding: "12px 14px",
          display: "flex",
          alignItems: "center",
          gap: "10px",
        }}
      >
        <span style={{ fontSize: "22px", flexShrink: 0 }}>🔔</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "12px", fontWeight: 800, color: theme.text, marginBottom: "2px" }}>
            جديد: تنبيه قبل المباراة
          </div>
          <div style={{ fontSize: "11px", color: theme.muted, lineHeight: 1.6 }}>
            يوصلك إشعار قبل المباراة بـ٣٠ دقيقة. ادخل الملف الشخصي وفعّل الإشعارات.
          </div>
        </div>
        <button
          onClick={() => { dismiss(); onGoToProfile(); }}
          style={{
            flexShrink: 0,
            background: theme.primary,
            color: theme.surface,
            border: "none",
            borderRadius: "8px",
            padding: "8px 12px",
            fontFamily: "Cairo, sans-serif",
            fontSize: "12px",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          فعّل
        </button>
        <button
          onClick={dismiss}
          aria-label="إغلاق"
          style={{
            flexShrink: 0,
            background: "transparent",
            color: theme.muted,
            border: "none",
            cursor: "pointer",
            padding: "4px",
            display: "flex",
          }}
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const [theme, setTheme] = useState(THEMES.find((t) => t.id === "slate-mono"));

  // Tournaments, clubs and matches are loaded from Supabase. We keep the raw
  // DB rows in state and derive the name-keyed shapes the rest of the UI
  // already expects (tournaments as a list of names, clubsByTournament keyed
  // by tournament name, etc.) so the components below didn't need to change.
  const [tournamentRows, setTournamentRows] = useState([]); // [{id, name, logo}]
  const [clubRows, setClubRows] = useState([]); // [{id, tournament_id, name, logo}]
  const [matchRows, setMatchRows] = useState([]); // raw matches (no per-user prediction fields)
  const [predictionsByMatch, setPredictionsByMatch] = useState({}); // matchId -> {predHome, predAway, userBoost}, for currentUser only
  const [confirmedPredictions, setConfirmedPredictions] = usePersistedState("confirmedPredictions", {}); // matchId -> true while the save button is in its "تم الحفظ" state; cleared by any edit (score or boost) so the button re-opens
  const [savedPredictions, setSavedPredictions] = usePersistedState("savedPredictions", {}); // matchId -> true once a full prediction has been saved at least once; controls تم توقعها tab placement, only cleared when the prediction is fully cleared
  const [allPredictionRows, setAllPredictionRows] = useState([]); // every user's predictions, for the global leaderboard
  const [championshipResults, setChampionshipResults] = useState([]); // [{tournament_id, first_team, second_team, third_team}]
  const [championshipSettings, setChampionshipSettings] = useState(null); // {lock_at}
  const [allChampionshipPreds, setAllChampionshipPreds] = useState([]); // every user's top-3 picks, for the championship leaderboard
  const [championshipPredsByTournament, setChampionshipPredsByTournament] = useState({}); // tournamentId -> {first, second, third}, current user only
  const [dataLoading, setDataLoading] = useState(true);
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const [pullY, setPullY] = useState(0);

  const refreshData = () => {
    return Promise.all([
      fetchTournaments(),
      fetchClubs(),
      fetchMatches(),
      fetchAllPredictionsWithProfiles(),
    ]).then(([t, c, m, p]) => {
      setTournamentRows(t);
      setClubRows(c);
      setMatchRows(m);
      setAllPredictionRows(p);
    });
  };

  // Championship data is only needed on the البطولات page, so it's loaded
  // lazily when that page opens (keeps normal app loads / refreshes light on
  // egress) rather than on every refreshData().
  const refreshChampionshipData = () => {
    return Promise.all([
      fetchChampionshipResults().catch(() => []),
      fetchChampionshipSettings().catch(() => null),
      fetchAllChampionshipPredictions().catch(() => []),
    ]).then(([cr, cs, cp]) => {
      setChampionshipResults(cr || []);
      setChampionshipSettings(cs);
      setAllChampionshipPreds(cp || []);
    });
  };

  useEffect(() => {
    refreshData().finally(() => setDataLoading(false));
  }, []);

  // Pull-to-refresh for PWA/standalone mode on iOS/iPad
  useEffect(() => {
    const THRESHOLD = 80;
    let startY = 0;
    let currentY = 0;
    let active = false;

    const onTouchStart = (e) => {
      if (window.scrollY === 0) {
        startY = e.touches[0].clientY;
        active = false; // wait for clear downward movement before activating
      }
    };
    const onTouchMove = (e) => {
      if (startY === 0) return;
      currentY = e.touches[0].clientY;
      const diff = currentY - startY;
      // only activate after a clear downward pull (>10px) to avoid tab taps
      if (!active && diff > 10 && window.scrollY === 0) active = true;
      if (!active) return;
      const clamped = Math.max(0, Math.min(diff, THRESHOLD * 1.5));
      if (clamped > 0) setPullY(clamped);
    };
    const onTouchEnd = () => {
      if (!active) return;
      active = false;
      const diff = currentY - startY;
      setPullY(0);
      if (diff >= THRESHOLD) {
        setPullRefreshing(true);
        refreshData().catch(() => {}).finally(() => setPullRefreshing(false));
      }
    };

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: true });
    document.addEventListener("touchend", onTouchEnd);
    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
    };
  }, []);

  // Keep the server-time offset fresh so match locking can't be tricked by
  // changing the device's date/time; re-sync on load and every 2 minutes.
  useEffect(() => {
    const sync = () => fetchServerTimeOffset().then((offset) => { setServerTimeSync(Date.now() + offset); });
    sync();
    const id = setInterval(sync, 2 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  // Register service worker for push notifications, and force it to check
  // for a newer version on every load so devices never stay on stale JS
  // (important on iOS PWAs, which cache aggressively).
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js")
        .then((reg) => reg.update().catch(() => {}))
        .catch(() => {});
    }
  }, []);

  const tournaments = useMemo(() => tournamentRows.map((t) => t.name), [tournamentRows]);
  const tournamentLogos = useMemo(
    () => Object.fromEntries(tournamentRows.map((t) => [t.name, t.logo])),
    [tournamentRows]
  );
  const tournamentIdByName = useMemo(
    () => Object.fromEntries(tournamentRows.map((t) => [t.name, t.id])),
    [tournamentRows]
  );
  const tournamentNameById = useMemo(
    () => Object.fromEntries(tournamentRows.map((t) => [t.id, t.name])),
    [tournamentRows]
  );

  const clubsByTournament = useMemo(() => {
    const grouped = {};
    for (const club of clubRows) {
      const tName = tournamentNameById[club.tournament_id];
      if (!tName) continue;
      if (!grouped[tName]) grouped[tName] = [];
      grouped[tName].push({ id: club.id, name: club.name, logo: club.logo });
    }
    return grouped;
  }, [clubRows, tournamentNameById]);

  const matches = useMemo(
    () =>
      matchRows.map((row) => {
        const pred = predictionsByMatch[row.id];
        return {
          id: row.id,
          tournament: tournamentNameById[row.tournamentId] || "",
          home: row.home,
          away: row.away,
          homeLogo: row.homeLogo,
          awayLogo: row.awayLogo,
          actualHome: row.actualHome,
          actualAway: row.actualAway,
          date: row.date,
          time: row.time,
          doublePoints: row.doublePoints,
          venueTeam: row.venueTeam,
          predHome: pred?.predHome != null ? String(pred.predHome) : "",
          predAway: pred?.predAway != null ? String(pred.predAway) : "",
          userBoost: pred?.userBoost || false,
        };
      }),
    [matchRows, tournamentNameById, predictionsByMatch]
  );

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activePage, setActivePage] = useState(() => {
    // If the URL contains a Supabase password-recovery token, go straight to
    // the reset form before sessionStorage can push us elsewhere.
    if (window.location.hash.includes("type=recovery")) return "resetPassword";
    return sessionStorage.getItem("activePage") || "home";
  });
  const [profileUser, setProfileUser] = useState(null); // { id, name, username, avatar, points, tierCounts } - when set, show UserProfilePage overlay
  const [openLeagueId, setOpenLeagueId] = useState(null); // when set, leagues page opens directly to this league
  const [viewMode, setViewMode] = usePersistedState("viewMode", "user"); // "admin" | "user" - only admins may switch to "admin"
  const [predictionsTabView, setPredictionsTabView] = usePersistedState("predictionsTabView", "available"); // "available" | "predicted" | "archived" - for the توقع! page's match list
  const [archivedVisibleCount, setArchivedVisibleCount] = useState(5);
  const [currentUser, setCurrentUser] = useState(null); // null when logged out, { id, name, username, email, avatar } when logged in
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    // Skip this while auth is still loading on refresh - currentUser is
    // briefly null then, which would otherwise kick an admin back to
    // user mode before their session even finishes loading.
    if (!authLoading && viewMode === "admin" && !currentUser?.is_admin) setViewMode("user");
  }, [currentUser, viewMode, authLoading]);

  // Reset archived count when switching tabs
  useEffect(() => {
    setArchivedVisibleCount(5);
  }, [predictionsTabView]);

  // The organizer doesn't have a تم توقعها tab - bounce back to متاحة if
  // it was left selected before switching into admin mode.
  useEffect(() => {
    setPredictionsTabView((prev) => (viewMode === "admin" && prev === "predicted" ? "available" : prev));
  }, [viewMode]);

  // Remember the current page across reloads, so refreshing doesn't
  // bounce the user back to the home page.
  useEffect(() => {
    sessionStorage.setItem("activePage", activePage);
  }, [activePage]);


  // Restore the session (if any) when the app first loads, so a refresh
  // doesn't log the user out.
  useEffect(() => {
    getSessionUser()
      .then((user) => setCurrentUser(user))
      .finally(() => setAuthLoading(false));
  }, []);

  // If the profile failed to load on startup (e.g. no network when PWA opened),
  // retry once the device is back online.
  useEffect(() => {
    if (!currentUser?._profilePending) return;
    const retry = () => {
      fetchProfile(currentUser.id)
        .then((profile) => setCurrentUser((u) => u?._profilePending ? { ...u, ...profile, _profilePending: false } : u))
        .catch(() => {});
    };
    retry();
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, [currentUser?._profilePending, currentUser?.id]);

  // Clicking the password-reset link from the email lands back here and
  // Supabase fires this event instead of a normal sign-in - send the user
  // to the "pick a new password" page rather than treating it as a login.
  useEffect(() => {
    const { data: subscription } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setActivePage("resetPassword");
    });
    return () => subscription.subscription.unsubscribe();
  }, []);

  // Load this user's own predictions whenever they log in; clear them on logout.
  useEffect(() => {
    if (!currentUser) {
      setPredictionsByMatch({});
      return;
    }
    fetchPredictionsForUser(currentUser.id).then((rows) => {
      const byMatch = {};
      const confirmed = {};
      for (const row of rows) {
        byMatch[row.match_id] = { predHome: row.pred_home, predAway: row.pred_away, userBoost: row.user_boost };
        if (row.pred_home != null && row.pred_away != null) confirmed[row.match_id] = true;
      }
      setPredictionsByMatch(byMatch);
      setConfirmedPredictions(confirmed);
      setSavedPredictions(confirmed);
    });
  }, [currentUser?.id]);

  // Load championship results/settings/leaderboard data only when the user
  // actually opens the البطولات page — not on every app load.
  const championshipLoadedRef = useRef(false);
  useEffect(() => {
    if (activePage === "championships" && !championshipLoadedRef.current) {
      championshipLoadedRef.current = true;
      refreshChampionshipData();
    }
  }, [activePage]);

  // Load this user's own championship (top-3) picks on login.
  useEffect(() => {
    if (!currentUser) {
      setChampionshipPredsByTournament({});
      return;
    }
    fetchChampionshipPredictionsForUser(currentUser.id).then((rows) => {
      const byTournament = {};
      for (const row of rows) {
        byTournament[row.tournament_id] = {
          first: row.first_team || "",
          second: row.second_team || "",
          third: row.third_team || "",
        };
      }
      setChampionshipPredsByTournament(byTournament);
    }).catch(() => {});
  }, [currentUser?.id]);

  const handleRegister = async ({ name, username, email, password }) => {
    try {
      if (await isUsernameTaken(username)) {
        return { usernameError: "اسم المستخدم هذا مستخدم من قبل، جرّب واحد ثاني" };
      }
      const result = await registerUser({ name, username, email, password });
      if (result.needsEmailConfirmation) return { needsEmailConfirmation: true };
      setCurrentUser(result.user);
      setActivePage("home");
      return {};
    } catch (err) {
      // Postgres unique-constraint violation on the username column
      if (err.message && (err.message.includes("profiles_username_key") || err.message.includes("duplicate key") || err.message.includes("unique"))) {
        return { usernameError: "اسم المستخدم هذا مستخدم من قبل، جرّب واحد ثاني" };
      }
      return { error: err.message || "حدث خطأ، حاول مرة أخرى" };
    }
  };

  const handleLoginExisting = async ({ identifier, password }) => {
    try {
      const user = await loginUser({ identifier, password });
      setCurrentUser(user);
      setActivePage("home");
      return {};
    } catch (err) {
      return { error: "بيانات الدخول غير صحيحة" };
    }
  };

  const handleLogout = async () => {
    await logoutUser();
    setCurrentUser(null);
  };

  const handleDeleteAccount = async () => {
    await deleteAccount();
    setCurrentUser(null);
    setActivePage("home");
  };

  const handleForgotPassword = async ({ identifier }) => {
    try {
      await requestPasswordReset(identifier);
      return {};
    } catch (err) {
      return { error: err.message || "حدث خطأ، حاول مرة أخرى" };
    }
  };

  const handleUpdatePassword = async (newPassword) => {
    try {
      await updatePassword(newPassword);
      // brief pause so the success screen shows, then send to login
      setTimeout(async () => {
        await logoutUser();
        setCurrentUser(null);
        setActivePage("auth");
      }, 2000);
      return { success: true };
    } catch (err) {
      return { error: err.message || "حدث خطأ، حاول مرة أخرى" };
    }
  };

  const USERNAME_COOLDOWN_MS = 6 * 30 * 24 * 60 * 60 * 1000; // ~6 months

  const handleUpdateProfile = async ({ name, username }) => {
    try {
      const usernameChanged = username !== currentUser.username;

      if (usernameChanged && currentUser.username_changed_at) {
        const lastChange = new Date(currentUser.username_changed_at).getTime();
        const elapsed = Date.now() - lastChange;
        if (elapsed < USERNAME_COOLDOWN_MS) {
          const nextDate = new Date(lastChange + USERNAME_COOLDOWN_MS);
          const nextDateStr = nextDate.toLocaleDateString("ar-EG");
          return { usernameError: `ما تقدر تغيّر اسم المستخدم إلا مرة كل 6 شهور. تقدر تغيّره من تاريخ ${nextDateStr}` };
        }
      }

      if (usernameChanged && (await isUsernameTaken(username, currentUser.id))) {
        return { usernameError: "اسم المستخدم هذا مستخدم من قبل، جرّب واحد ثاني" };
      }

      await updateProfile(currentUser.id, { name, username, usernameChanged });
      setCurrentUser((u) => ({
        ...u,
        name,
        username,
        username_changed_at: usernameChanged ? new Date().toISOString() : u.username_changed_at,
      }));
      return {};
    } catch (err) {
      return { error: err.message || "حدث خطأ، حاول مرة أخرى" };
    }
  };

  const boostsRemaining = currentUser?.boosts_remaining ?? 3;

  // Leagues are loaded from Supabase (leagues + league_members), and
  // re-shaped into the {id, code, name, players:[{id, name, isYou}]} form
  // the league UI already expects.
  const [leagueRows, setLeagueRows] = useState([]); // [{id, code, name, created_by, league_members:[{id,user_id,display_name}]}]

  useEffect(() => {
    fetchLeaguesWithMembers().then(setLeagueRows);
  }, [activePage]);

  const leagues = useMemo(
    () =>
      leagueRows.map((l) => ({
        id: l.id,
        code: l.code,
        name: l.name,
        players: (l.league_members || []).map((m) => ({
          id: m.id,
          userId: m.user_id,
          name: m.profiles?.name || m.display_name,
          isYou: currentUser ? m.user_id === currentUser.id : false,
        })),
      })),
    [leagueRows, currentUser]
  );

  const createLeague = async (name) => {
    if (!currentUser) return null;
    const row = await createLeagueDB(name, currentUser.id);
    setLeagueRows((prev) => [...prev, { ...row, league_members: [] }]);
    return row.id;
  };

  const joinLeague = (leagueId, playerName) => {
    if (!currentUser) return;
    joinLeagueDB(leagueId, currentUser.id, playerName).then((member) => {
      setLeagueRows((prev) =>
        prev.map((l) => (l.id === leagueId ? { ...l, league_members: [...(l.league_members || []), member] } : l))
      );
    });
  };

  const addTournament = (name) => {
    if (tournaments.includes(name)) return;
    addTournamentDB(name)
      .then((row) => { bustTournamentsCache(); setTournamentRows((prev) => [...prev, row]); })
      .catch((err) => alert("تعذّرت إضافة البطولة: " + (err?.message || "خطأ غير متوقع")));
  };

  const setTournamentLogo = (tournamentName, logo) => {
    const id = tournamentIdByName[tournamentName];
    if (!id) return;
    setTournamentLogoDB(id, logo);
    bustTournamentsCache();
    setTournamentRows((prev) => prev.map((t) => (t.id === id ? { ...t, logo } : t)));
  };

  const removeTournament = (tournamentName) => {
    const id = tournamentIdByName[tournamentName];
    if (!id) return;
    removeTournamentDB(id).then(() => {
      bustTournamentsCache();
      setTournamentRows((prev) => prev.filter((t) => t.id !== id));
      setClubRows((prev) => prev.filter((c) => c.tournament_id !== id));
      setMatchRows((prev) => prev.map((m) => (m.tournament_id === id ? { ...m, tournament_id: null } : m)));
    });
  };

  const addClub = (tournamentName, club) => {
    const tournamentId = tournamentIdByName[tournamentName];
    if (!tournamentId) return;
    addClubDB(tournamentId, club).then((row) => { bustClubsCache(); setClubRows((prev) => [...prev, row]); });
  };

  const updateClub = (tournamentName, clubId, updated) => {
    updateClubDB(clubId, updated);
    bustClubsCache();
    setClubRows((prev) => prev.map((c) => (c.id === clubId ? { ...c, ...updated } : c)));
  };

  const removeClub = (tournamentName, clubId) => {
    removeClubDB(clubId);
    bustClubsCache();
    setClubRows((prev) => prev.filter((c) => c.id !== clubId));
  };

  const addMatch = () => {
    const tempId = `temp-${Date.now()}`;
    const date = toLocalISODate(new Date(serverNow()));
    setMatchRows((prev) => [...prev, { id: tempId, home: "", away: "", homeLogo: null, awayLogo: null, actualHome: "", actualAway: "", date, time: "", doublePoints: false, venueTeam: null, tournamentId: null }]);
    addMatchDB(date).then((row) => setMatchRows((prev) => prev.map((m) => m.id === tempId ? row : m)));
  };

  const updateMatch = (id, updated) => {
    const tournamentId = tournamentIdByName[updated.tournament];
    const matchFields = {
      tournamentId,
      home: updated.home,
      away: updated.away,
      homeLogo: updated.homeLogo,
      awayLogo: updated.awayLogo,
      actualHome: updated.actualHome,
      actualAway: updated.actualAway,
      date: updated.date,
      time: updated.time,
      doublePoints: updated.doublePoints,
      venueTeam: updated.venueTeam,
    };
    updateMatchDB(id, matchFields).catch((err) => {
      alert("فشل حفظ المباراة: " + err.message);
    });
    setMatchRows((prev) => prev.map((x) => (x.id === id ? { ...x, ...matchFields } : x)));

    if (currentUser) {
      const predictionFields = { predHome: updated.predHome, predAway: updated.predAway, userBoost: updated.userBoost };
      const prevPred = predictionsByMatch[id];
      // Treat a missing previous prediction as empty, so a first-time
      // prediction (nothing -> a score) still counts as a change and gets
      // written to the DB. Otherwise the card moves the match to "تم توقعها"
      // via onConfirm while the score is never actually saved.
      const scoreChanged =
        String(prevPred?.predHome ?? "") !== String(predictionFields.predHome ?? "") ||
        String(prevPred?.predAway ?? "") !== String(predictionFields.predAway ?? "");
      if (scoreChanged) {
        setConfirmedPredictions((prev) => {
          if (!prev[id]) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });
        const cleared = predictionFields.predHome === "" || predictionFields.predHome == null || predictionFields.predAway === "" || predictionFields.predAway == null;
        if (cleared) {
          setSavedPredictions((prev) => {
            if (!prev[id]) return prev;
            const next = { ...prev };
            delete next[id];
            return next;
          });
        }
      }
      const prevBoost = !!prevPred?.userBoost;
      const nextBoost = !!predictionFields.userBoost;
      const boostChanged = prevBoost !== nextBoost;

      // Only touch the predictions table if the participant's own prediction
      // or boost actually changed — not when the admin merely edits match
      // details (home/away teams, actual result, date, etc.).
      if (scoreChanged || boostChanged) {
        if (boostChanged) {
          const newBoostsRemaining = boostsRemaining + (nextBoost ? -1 : 1);
          setBoostsRemainingDB(currentUser.id, newBoostsRemaining);
          setCurrentUser((u) => ({ ...u, boosts_remaining: newBoostsRemaining }));
        }
        upsertPredictionDB(currentUser.id, id, predictionFields);
        bustAllPredictionsCache();
        setPredictionsByMatch((prev) => ({ ...prev, [id]: predictionFields }));
        setAllPredictionRows((prev) => {
          const exists = prev.some((r) => r.match_id === id && r.user_id === currentUser.id);
          const row = {
            match_id: id,
            user_id: currentUser.id,
            pred_home: predictionFields.predHome === "" ? null : Number(predictionFields.predHome),
            pred_away: predictionFields.predAway === "" ? null : Number(predictionFields.predAway),
            user_boost: !!predictionFields.userBoost,
            updated_at: new Date().toISOString(),
            profiles: { name: currentUser.name, username: currentUser.username },
          };
          return exists ? prev.map((r) => (r.match_id === id && r.user_id === currentUser.id ? row : r)) : [...prev, row];
        });
      }
    }
  };

  const confirmPrediction = (id) => {
    setConfirmedPredictions((prev) => ({ ...prev, [id]: true }));
    setSavedPredictions((prev) => ({ ...prev, [id]: true }));
  };

  // ===== Championship (top-3) handlers =====
  const saveChampionshipPick = async (tournamentId, pick) => {
    if (!currentUser) return;
    setChampionshipPredsByTournament((prev) => ({ ...prev, [tournamentId]: pick }));
    await upsertChampionshipPredictionDB(currentUser.id, tournamentId, pick);
    // reflect in the all-preds list used by the leaderboard
    setAllChampionshipPreds((prev) => {
      const exists = prev.some((r) => r.tournament_id === tournamentId && r.user_id === currentUser.id);
      const row = {
        user_id: currentUser.id,
        tournament_id: tournamentId,
        first_team: pick.first || null,
        second_team: pick.second || null,
        third_team: pick.third || null,
        profiles: { name: currentUser.name, username: currentUser.username },
      };
      return exists
        ? prev.map((r) => (r.tournament_id === tournamentId && r.user_id === currentUser.id ? row : r))
        : [...prev, row];
    });
  };

  const saveChampionshipResult = async (tournamentId, result) => {
    await upsertChampionshipResultDB(tournamentId, result);
    setChampionshipResults((prev) => {
      const exists = prev.some((r) => r.tournament_id === tournamentId);
      const row = { tournament_id: tournamentId, first_team: result.first || null, second_team: result.second || null, third_team: result.third || null };
      return exists ? prev.map((r) => (r.tournament_id === tournamentId ? row : r)) : [...prev, row];
    });
  };

  const toggleChampionshipTournament = async (tournamentId, isChampionship) => {
    setTournamentRows((prev) => prev.map((t) => (t.id === tournamentId ? { ...t, is_championship: isChampionship } : t)));
    try {
      await setTournamentChampionshipDB(tournamentId, isChampionship);
      bustTournamentsCache();
    } catch (e) {
      // revert the optimistic change so the UI reflects what's really saved
      setTournamentRows((prev) => prev.map((t) => (t.id === tournamentId ? { ...t, is_championship: !isChampionship } : t)));
      alert("لم يُحفظ الإعداد في قاعدة البيانات. تأكد أنك شغّلت SQL البطولات كامل.\n" + (e?.message || ""));
    }
  };

  const toggleChampionshipCup = async (tournamentId, isCup) => {
    setTournamentRows((prev) => prev.map((t) => (t.id === tournamentId ? { ...t, is_cup: isCup } : t)));
    try {
      await setTournamentCupDB(tournamentId, isCup);
      bustTournamentsCache();
    } catch (e) {
      setTournamentRows((prev) => prev.map((t) => (t.id === tournamentId ? { ...t, is_cup: !isCup } : t)));
      alert("لم يُحفظ إعداد الكأس. تأكد أنك شغّلت SQL البطولات كامل.\n" + (e?.message || ""));
    }
  };

  // Reorder a championship league up (-1) or down (+1) in the البطولات list.
  const moveChampionshipLeague = async (tournamentId, dir) => {
    const champs = tournamentRows
      .filter((t) => t.is_championship)
      .sort((a, b) => (a.sort_order ?? 9999) - (b.sort_order ?? 9999));
    const idx = champs.findIndex((t) => t.id === tournamentId);
    const swap = idx + dir;
    if (idx < 0 || swap < 0 || swap >= champs.length) return;
    const reordered = [...champs];
    [reordered[idx], reordered[swap]] = [reordered[swap], reordered[idx]];
    const orderById = {};
    reordered.forEach((t, i) => { orderById[t.id] = i; });
    setTournamentRows((prev) => prev.map((t) => (t.id in orderById ? { ...t, sort_order: orderById[t.id] } : t)));
    for (const t of reordered) await setTournamentSortOrderDB(t.id, orderById[t.id]).catch(() => {});
    bustTournamentsCache();
  };

  const saveChampionshipLock = async (lockAt) => {
    const prev = championshipSettings;
    setChampionshipSettings({ lock_at: lockAt });
    try {
      await updateChampionshipLockDB(lockAt);
    } catch (e) {
      setChampionshipSettings(prev);
      alert("لم يُحفظ موعد الإقفال. تأكد أنك شغّلت SQL البطولات كامل.\n" + (e?.message || ""));
    }
  };

  const removeMatch = (id) => {
    fetchBoostedUserIdsForMatch(id).then((boostedUserIds) => {
      boostedUserIds.forEach((uid) => {
        refundBoostDB(uid);
        if (uid === currentUser?.id) {
          setCurrentUser((u) => ({ ...u, boosts_remaining: (u?.boosts_remaining ?? 3) + 1 }));
        }
      });
      removeMatchDB(id);
    });
    setMatchRows((prev) => prev.filter((x) => x.id !== id));
    setPredictionsByMatch((prev) => {
      const { [id]: _removed, ...rest } = prev;
      return rest;
    });
  };

  const tiers = getTiers(theme);

  return (
    <div
      dir="rtl"
      style={{
        minHeight: "100vh",
        background: theme.bg,
        fontFamily: "Cairo, system-ui, sans-serif",
        transition: "background 0.2s",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;700;800&display=swap');
        * { box-sizing: border-box; }
        input::placeholder { color: ${theme.muted}; opacity: 0.7; }
      `}</style>

      {/* Pull-to-refresh indicator */}
      {(pullY > 0 || pullRefreshing) && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, zIndex: 999,
          display: "flex", alignItems: "center", justifyContent: "center",
          height: `${pullRefreshing ? 56 : Math.min(pullY * 0.6, 56)}px`,
          background: theme.violetSoft,
          transition: pullRefreshing ? "none" : "height 0.1s",
          overflow: "hidden",
        }}>
          <div style={{
            width: "22px", height: "22px", borderRadius: "50%",
            border: `3px solid ${theme.violet}`, borderTopColor: "transparent",
            animation: pullRefreshing ? "spin 0.7s linear infinite" : "none",
            opacity: pullRefreshing ? 1 : Math.min(pullY / 80, 1),
          }} />
        </div>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      <TopBar onMenuClick={() => setDrawerOpen(true)} onLogoClick={() => setActivePage("home")} theme={theme} />
      <div style={{ background: theme.surface }}>
        <VioletDivider theme={theme} />
      </div>

      <NavDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        activePage={activePage}
        onNavigate={setActivePage}
        viewMode={viewMode}
        setViewMode={setViewMode}
        currentUser={currentUser}
        onLogout={handleLogout}
        theme={theme}
      />

      <NotificationUpdateBanner
        currentUser={currentUser}
        onGoToProfile={() => setActivePage("profile")}
        theme={theme}
      />

      {activePage === "predictions" && !authLoading && !currentUser && (
        <LoginGate onNavigateToAuth={() => setActivePage("auth")} theme={theme} />
      )}

      {activePage === "predictions" && currentUser && (
        <div style={{ padding: "20px 16px 60px" }}>
          <div className="page-container">
            {/* Theme switcher - admin only */}
            {viewMode === "admin" && (
              <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "16px" }}>
                <ThemeSwitcher theme={theme} setTheme={setTheme} />
              </div>
            )}

            {viewMode === "admin" && (
              <p style={{ fontSize: "12px", color: theme.muted, marginBottom: "16px", textAlign: "center" }}>
                وضع المنظّم — أضف المباريات وأدخل النتائج الفعلية
              </p>
            )}

            {/* Title + tabs in one merged box */}
            <div
              style={{
                background: theme.surface,
                border: `1.5px solid ${theme.violet}`,
                borderRadius: "10px",
                marginBottom: "16px",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  padding: "10px 14px",
                  textAlign: "center",
                  fontFamily: "Cairo, sans-serif",
                  fontWeight: 800,
                  fontSize: "13px",
                  color: theme.primary,
                  borderBottom: `1px solid ${theme.border}`,
                }}
              >
                توقعات
              </div>

              {/* Tabs: متاحة / تم توقعها / المنتهية - a match stays in متاحة
                  until the user predicts it, moves to تم توقعها once predicted
                  (as long as the deadline hasn't locked yet), and moves to
                  المنتهية the moment the deadline locks. Admin keeps full edit
                  rights across tabs. */}
              <div
                style={{
                  display: "flex",
                  background: theme.bg,
                  padding: "3px",
                }}
              >
                <button
                  onClick={() => setPredictionsTabView("available")}
                  style={{
                    flex: 1,
                    padding: "8px 10px",
                    borderRadius: "8px",
                    border: "none",
                    background: predictionsTabView === "available" ? theme.primary : "transparent",
                    color: predictionsTabView === "available" ? theme.surface : theme.muted,
                    fontFamily: "Cairo, sans-serif",
                    fontWeight: 700,
                    fontSize: "11px",
                    cursor: "pointer",
                  }}
                >
                  متاحة
                </button>
                {viewMode !== "admin" && (
                  <button
                    onClick={() => setPredictionsTabView("predicted")}
                    style={{
                      flex: 1,
                      padding: "8px 10px",
                      borderRadius: "8px",
                      border: "none",
                      background: predictionsTabView === "predicted" ? theme.primary : "transparent",
                      color: predictionsTabView === "predicted" ? theme.surface : theme.muted,
                      fontFamily: "Cairo, sans-serif",
                      fontWeight: 700,
                      fontSize: "11px",
                      cursor: "pointer",
                    }}
                  >
                    تم توقعها
                  </button>
                )}
                <button
                  onClick={() => {
                    setPredictionsTabView("archived");
                    setArchivedVisibleCount(10);
                  }}
                  style={{
                    flex: 1,
                    padding: "8px 10px",
                    borderRadius: "8px",
                    border: "none",
                    background: predictionsTabView === "archived" ? theme.primary : "transparent",
                    color: predictionsTabView === "archived" ? theme.surface : theme.muted,
                    fontFamily: "Cairo, sans-serif",
                    fontWeight: 700,
                    fontSize: "11px",
                    cursor: "pointer",
                  }}
                >
                  مغلقة
                </button>
              </div>

              {(() => {
                const isLockedCount = (m) => {
                  if (!m.date || !m.time) return false;
                  return new Date(`${m.date}T${m.time}:00+03:00`).getTime() - serverNow() <= 0;
                };
                const isPredictedCount = (m) => !!savedPredictions[m.id];
                const scheduled = viewMode === "user" ? matches.filter((m) => m.date && m.time) : matches;
                const availableCount = scheduled.filter((m) => !isLockedCount(m) && (viewMode === "admin" || !isPredictedCount(m))).length;
                const predictedCount = scheduled.filter((m) => !isLockedCount(m) && isPredictedCount(m)).length;
                const archivedCount = matches.filter((m) => isLockedCount(m)).length;
                return (
                  <div
                    style={{
                      display: "flex",
                      borderTop: `1px solid ${theme.border}`,
                      padding: "6px 3px",
                    }}
                  >
                    <div style={{ flex: 1, textAlign: "center", fontFamily: "Cairo, sans-serif", fontWeight: 800, fontSize: "11px", color: theme.muted }}>
                      {availableCount}
                    </div>
                    {viewMode !== "admin" && (
                      <div style={{ flex: 1, textAlign: "center", fontFamily: "Cairo, sans-serif", fontWeight: 800, fontSize: "11px", color: theme.muted }}>
                        {predictedCount}
                      </div>
                    )}
                    <div style={{ flex: 1, textAlign: "center", fontFamily: "Cairo, sans-serif", fontWeight: 800, fontSize: "11px", color: theme.muted }}>
                      {archivedCount}
                    </div>
                  </div>
                );
              })()}
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "6px",
                padding: "10px 12px",
                fontFamily: "Cairo, sans-serif",
                fontSize: "12px",
                color: theme.muted,
                borderBottom: `1px solid ${theme.border}`,
              }}
            >
              <div style={{ display: "flex", gap: "4px", alignItems: "flex-start" }}>
                <strong style={{ color: theme.text, flexShrink: 0 }}>• الدبل:</strong>
                <span>يتم تفعيله من قبل المنظم مباراة واحدة لكل أسبوع وتكون المباراة بالإطار الذهبي</span>
              </div>
              <div style={{ display: "flex", gap: "4px", alignItems: "flex-start" }}>
                <strong style={{ color: theme.text, flexShrink: 0 }}>• التربل:</strong>
                <span>يتم تفعيله من قبل اللاعبين ومتوفر ٣ مرات طوال الموسم ولا يمكن تفعيله على مباراة الدبل</span>
              </div>
            </div>

            {/* Matches */}
            {(() => {
              const isLocked = (m) => {
                if (!m.date || !m.time) return false;
                return new Date(`${m.date}T${m.time}:00+03:00`).getTime() - serverNow() <= 0;
              };
              const isPredicted = (m) => !!savedPredictions[m.id];

              let tabMatches = matches.filter((m) => {
                if (predictionsTabView === "archived") return isLocked(m);
                if (viewMode === "admin") return !isLocked(m); // admin sees all unlocked matches regardless of predictions
                if (predictionsTabView === "predicted") return !isLocked(m) && isPredicted(m);
                return !isLocked(m) && !isPredicted(m);
              });

              // Participants shouldn't see matches the admin hasn't scheduled
              // yet (no date/time set) - admin still sees them so they can
              // set the schedule.
              if (viewMode === "user" && predictionsTabView !== "archived") {
                tabMatches = tabMatches.filter((m) => m.date && m.time);
              }

              const countBox = null;

              if (dataLoading) {
                return (
                  <>
                    {countBox}
                    <p style={{ fontSize: "12px", color: theme.muted, textAlign: "center", padding: "30px 0" }}>
                      جاري التحميل...
                    </p>
                  </>
                );
              }

              if (tabMatches.length === 0) {
                return (
                  <>
                    {countBox}
                    <p style={{ fontSize: "12px", color: theme.muted, textAlign: "center", padding: "30px 0" }}>
                      {predictionsTabView === "archived"
                        ? "ما فيه مباريات منتهية بعد"
                        : predictionsTabView === "predicted"
                        ? "ما فيه مباريات توقعتها بعد"
                        : "ما فيه مباريات متاحة للتوقع"}
                    </p>
                  </>
                );
              }

              const sortByKickoff = (a, b) => {
                const aTime = a.date && a.time ? new Date(`${a.date}T${a.time}:00`).getTime() : null;
                const bTime = b.date && b.time ? new Date(`${b.date}T${b.time}:00`).getTime() : null;
                if (aTime === null && bTime === null) return 0;
                if (aTime === null) return 1; // matches without a date/time go last
                if (bTime === null) return -1;
                // المنتهية: most recently finished first. القادمة: nearest to farthest.
                return predictionsTabView === "archived" ? bTime - aTime : aTime - bTime;
              };

              const sortedTabMatches = [...tabMatches].sort(sortByKickoff);
              const visibleTabMatches =
                (viewMode !== "admin" && predictionsTabView === "archived")
                  ? sortedTabMatches.slice(0, archivedVisibleCount)
                  : sortedTabMatches;
              const hasMore = viewMode !== "admin" && predictionsTabView === "archived" && sortedTabMatches.length > archivedVisibleCount;

              return (
                <>
                  {countBox}
                  {viewMode === "admin"
                    ? visibleTabMatches.map((match) => (
                        <Scoreboard
                          key={match.id}
                          match={match}
                          onChange={(updated) => updateMatch(match.id, updated)}
                          onRemove={() => removeMatch(match.id)}
                          tournaments={tournaments}
                          onAddTournament={addTournament}
                          clubsByTournament={clubsByTournament}
                          tournamentLogos={tournamentLogos}
                          allPredictionRows={allPredictionRows}
                          theme={theme}
                        />
                      ))
                    : visibleTabMatches.map((match) => (
                        <UserMatchCard
                          key={match.id}
                          match={match}
                          onChange={(updated) => updateMatch(match.id, updated)}
                          theme={theme}
                          boostsRemaining={boostsRemaining}
                          tournamentLogos={tournamentLogos}
                          hideResult={predictionsTabView !== "archived"}
                          confirmed={!!confirmedPredictions[match.id]}
                          onConfirm={() => confirmPrediction(match.id)}
                          predictedTab={predictionsTabView === "predicted"}
                        />
                      ))}
                  {hasMore && (
                    <button
                      onClick={() => setArchivedVisibleCount((c) => c + 5)}
                      style={{
                        width: "100%",
                        padding: "12px",
                        borderRadius: "12px",
                        border: `1.5px dashed ${theme.inputBorder}`,
                        background: "transparent",
                        color: theme.text,
                        fontFamily: "Cairo, sans-serif",
                        fontWeight: 600,
                        fontSize: "13px",
                        cursor: "pointer",
                        marginTop: "4px",
                      }}
                    >
                      عرض المزيد ({sortedTabMatches.length - archivedVisibleCount} متبقية)
                    </button>
                  )}
                </>
              );
            })()}

            {/* Add button - admin only, and only in متاحة (new matches have no prediction yet) */}
            {viewMode === "admin" && predictionsTabView === "available" && (
              <button
                onClick={addMatch}
                style={{
                  width: "100%",
                  padding: "12px",
                  borderRadius: "12px",
                  border: `1.5px dashed ${theme.inputBorder}`,
                  background: "transparent",
                  color: theme.text,
                  fontFamily: "Cairo, sans-serif",
                  fontWeight: 600,
                  fontSize: "14px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "6px",
                  marginTop: "4px",
                }}
              >
                <Plus size={16} />
                إضافة مباراة
              </button>
            )}

            {/* Legend */}
            <div
              style={{
                marginTop: "28px",
                background: theme.surface,
                border: `1px solid ${theme.border}`,
                borderRadius: "12px",
                padding: "16px 18px",
              }}
            >
              <div style={{ fontSize: "12px", fontWeight: 700, color: theme.primary, marginBottom: "10px" }}>
                نظام النقاط
              </div>
              {tiers.map((t) => (
                <div
                  key={t.points}
                  style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}
                >
                  <div
                    style={{
                      width: "24px",
                      height: "24px",
                      borderRadius: "50%",
                      background: t.bg,
                      border: `1.5px solid ${t.ring}`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: t.text,
                      flexShrink: 0,
                    }}
                  >
                    <span
                      style={{
                        fontSize: "10px",
                        lineHeight: "1",
                        fontWeight: 800,
                        display: "inline-block",
                      }}
                    >
                      {t.points}
                    </span>
                  </div>
                  <span style={{ fontSize: "12px", color: theme.text }}>{t.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {activePage === "prizes" && (
        <div style={{ padding: "20px 16px" }}>
          <div style={{ fontSize: "18px", fontWeight: 800, color: theme.text, marginBottom: "16px", textAlign: "right" }}>الجوائز</div>
          <div style={{ background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: "14px", padding: "20px 18px", textAlign: "center" }}>
            <Crown size={36} color="#D4AF37" style={{ marginBottom: "12px" }} />
            <p style={{ fontSize: "14px", color: theme.text, fontWeight: 600, lineHeight: 1.8 }}>
              سيتم تحديد الجوائز في منتصف الموسم بعد رؤية مستوى الفعالية من قبل المشاركين
            </p>
          </div>
        </div>
      )}

      {activePage === "home" && (
        <HomePage
          theme={theme}
          onNavigate={setActivePage}
          onGoToPredictions={(tab) => { setPredictionsTabView(tab || "available"); setActivePage("predictions"); }}
          onOpenLeague={(id) => { setOpenLeagueId(id); setActivePage("leagues"); }}
          currentUser={currentUser}
          matches={matches}
          allPredictionRows={allPredictionRows}
          leagues={leagues}
          tournamentLogos={tournamentLogos}
        />
      )}

      {activePage === "clubs" && (
        <ClubsManagementPage
          tournaments={tournaments}
          onAddTournament={addTournament}
          clubsByTournament={clubsByTournament}
          onAddClub={addClub}
          onUpdateClub={updateClub}
          onRemoveClub={removeClub}
          tournamentLogos={tournamentLogos}
          onSetTournamentLogo={setTournamentLogo}
          onRemoveTournament={removeTournament}
          theme={theme}
        />
      )}

      {activePage === "users" && <UsersAdminPage theme={theme} />}

      {activePage === "leagues" && !authLoading && !currentUser && (
        <LoginGate onNavigateToAuth={() => setActivePage("auth")} theme={theme} />
      )}

      {activePage === "leagues" && currentUser && !profileUser && (
        <PrivateLeaguesPage
          leagues={leagues}
          matches={matches}
          allPredictionRows={allPredictionRows}
          onCreateLeague={createLeague}
          onJoinLeague={joinLeague}
          tournaments={tournaments}
          tournamentLogos={tournamentLogos}
          currentUser={currentUser}
          onViewProfile={setProfileUser}
          initialLeagueId={openLeagueId}
          theme={theme}
        />
      )}

      {activePage === "globalLeaderboard" && !profileUser && (
        <GlobalLeaderboardPage
          matches={matches}
          allPredictionRows={allPredictionRows}
          tournaments={tournaments}
          tournamentLogos={tournamentLogos}
          currentUser={currentUser}
          onViewProfile={setProfileUser}
          theme={theme}
        />
      )}

      {profileUser && (
        <UserProfilePage
          user={profileUser}
          matches={matches}
          allPredictionRows={allPredictionRows}
          onBack={() => setProfileUser(null)}
          theme={theme}
        />
      )}

      {activePage === "pointsSystem" && <PointsSystemPage theme={theme} />}

      {activePage === "championships" && (
        <ChampionshipsPage
          tournamentRows={tournamentRows}
          clubsByTournament={clubsByTournament}
          tournamentLogos={tournamentLogos}
          championshipPredsByTournament={championshipPredsByTournament}
          championshipResults={championshipResults}
          championshipSettings={championshipSettings}
          allChampionshipPreds={allChampionshipPreds}
          currentUser={currentUser}
          viewMode={viewMode}
          onSavePick={saveChampionshipPick}
          onSaveResult={saveChampionshipResult}
          onToggleChampionship={toggleChampionshipTournament}
          onToggleCup={toggleChampionshipCup}
          onMoveLeague={moveChampionshipLeague}
          onSaveLock={saveChampionshipLock}
          theme={theme}
        />
      )}

      {activePage === "stats" && !authLoading && !currentUser && <LoginGate onNavigateToAuth={() => setActivePage("auth")} theme={theme} />}

      {activePage === "stats" && currentUser && (
        <StatsPage matches={matches} tournaments={tournaments} tournamentLogos={tournamentLogos} theme={theme} />
      )}

      {activePage === "profile" && (
        <ProfilePage
          currentUser={currentUser}
          onUpdateProfile={handleUpdateProfile}
          onNavigateToAuth={() => setActivePage("auth")}
          onDeleteAccount={handleDeleteAccount}
          theme={theme}
        />
      )}

      {activePage === "auth" && (
        <AuthPage
          onRegister={handleRegister}
          onLoginExisting={handleLoginExisting}
          onForgotPassword={handleForgotPassword}
          onBack={() => setActivePage("profile")}
          theme={theme}
        />
      )}

      {activePage === "resetPassword" && (
        <ResetPasswordPage onUpdatePassword={handleUpdatePassword} theme={theme} />
      )}
    </div>
  );
}
