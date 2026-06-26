import { useState, useRef, useEffect, useMemo } from "react";
import { Plus, Trash2, ChevronDown, Search, Palette, Lock, Unlock, Calendar, Clock, Menu, X, Home, Target, Trophy, BarChart3, Zap, Shield, Upload, CircleDot, Users, Copy, Check, Crown, ArrowDown, Award, TrendingUp, User, LogIn, LogOut, Mail, Camera, Eye, EyeOff, Pencil } from "lucide-react";
import { isUsernameTaken, registerUser, loginUser, logoutUser, deleteAccount, updateProfile, getSessionUser, setBoostsRemaining as setBoostsRemainingDB, requestPasswordReset, updatePassword } from "./auth";
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
  fetchPredictionsForUser,
  upsertPredictionDB,
  fetchLeaguesWithMembers,
  createLeagueDB,
  joinLeagueDB,
  fetchAllProfiles,
  fetchAllPredictionsWithProfiles,
  fetchServerTimeOffset,
} from "./data";

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
    blue: "#3B82F6",
    blueSoft: "#172A47",
    yellow: "#EAB308",
    yellowSoft: "#3A2F12",
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
    blue: "#2563EB",
    blueSoft: "#DCE6FB",
    yellow: "#CA8A04",
    yellowSoft: "#F5E7BE",
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
    blue: "#38BDF8",
    blueSoft: "#1A2E45",
    yellow: "#FACC15",
    yellowSoft: "#3A331A",
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
    blue: "#1D6FB8",
    blueSoft: "#D9E7F1",
    yellow: "#CA8A04",
    yellowSoft: "#F2E4BC",
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
    blue: "#2563EB",
    blueSoft: "#DCE6FB",
    yellow: "#CA8A04",
    yellowSoft: "#F5E7BE",
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
    blue: "#2563EB",
    blueSoft: "#DCE6FB",
    yellow: "#CA8A04",
    yellowSoft: "#F5E7BE",
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
    blue: "#38BDF8",
    blueSoft: "#1A3140",
    yellow: "#FACC15",
    yellowSoft: "#3A331A",
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
    blue: "#60A5FA",
    blueSoft: "#1B2C4D",
    yellow: "#FACC15",
    yellowSoft: "#3A331A",
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
    blue: "#0284C7",
    blueSoft: "#D2EBF7",
    yellow: "#CA8A04",
    yellowSoft: "#F5E7BE",
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
    blue: "#3B82F6",
    blueSoft: "#16233D",
    yellow: "#D4AF37",
    yellowSoft: "#3A331C",
    violet: "#A78BFA",
    violetSoft: "#221F33",
  },
];

// Build the 6-tier scale for any theme: strongest (10pts) down to neutral (0pts)
function getTiers(theme) {
  return [
    { points: 10, label: TIERS_META[0].label, example: TIERS_META[0].example, bg: theme.accentSoft, text: theme.text, ring: theme.accent },
    { points: 5, label: TIERS_META[1].label, example: TIERS_META[1].example, bg: theme.blueSoft, text: theme.text, ring: theme.blue },
    { points: 4, label: TIERS_META[2].label, example: TIERS_META[2].example, bg: theme.yellowSoft, text: theme.text, ring: theme.yellow },
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
  return new Date(`${m.date}T${m.time}:00`).getTime() - serverNow() <= 0;
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
function CountdownBadge({ kickoffISO, theme }) {
  const { locked, parts } = useCountdown(kickoffISO);

  if (!kickoffISO) {
    return <Unlock size={15} color={theme.muted} style={{ opacity: 0.5, flexShrink: 0 }} />;
  }

  const segments = parts
    ? [
        { value: parts.days, label: "DAY" },
        { value: parts.hours, label: "HOURS" },
        { value: parts.minutes, label: "MIN" },
        { value: parts.seconds, label: "SEC" },
      ]
    : null;

  const stateColor = locked ? theme.danger : theme.accent;

  return (
    <div
      dir="ltr"
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: "4px",
        background: theme.surface,
        border: `1px solid ${stateColor}`,
        borderRadius: "6px",
        padding: "3px 5px",
      }}
    >
      {locked ? (
        <Lock size={11} color={stateColor} style={{ flexShrink: 0 }} />
      ) : (
        <Unlock size={11} color={stateColor} style={{ flexShrink: 0 }} />
      )}
      {locked ? (
        <span
          dir="rtl"
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
        segments && (
          <div style={{ display: "flex", alignItems: "center", gap: "3px" }}>
            {segments.map((seg, i) => (
              <div key={seg.label} style={{ display: "flex", alignItems: "center" }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                  <span
                    style={{
                      fontFamily: "monospace",
                      fontSize: "10px",
                      fontWeight: 700,
                      color: stateColor,
                      fontVariantNumeric: "tabular-nums",
                      lineHeight: "1",
                    }}
                  >
                    {seg.value}
                  </span>
                  <span
                    style={{
                      fontFamily: "monospace",
                      fontSize: "5.5px",
                      fontWeight: 600,
                      color: stateColor,
                      letterSpacing: "0.2px",
                      lineHeight: "1",
                    }}
                  >
                    {seg.label}
                  </span>
                </div>
                {i < segments.length - 1 && (
                  <span style={{ fontSize: "10px", fontWeight: 700, color: stateColor, margin: "0 1px" }}>:</span>
                )}
              </div>
            ))}
          </div>
        )
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

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const minDate = new Date(2026, 0, 1); // allow picking any day starting January 1, 2026
  const maxDate = new Date(today);
  maxDate.setFullYear(maxDate.getFullYear() + 2); // allow scheduling up to 2 years ahead

  const selectedDate = value ? new Date(value + "T00:00:00") : null;

  const [viewYear, setViewYear] = useState((selectedDate || today).getFullYear());
  const [viewMonth, setViewMonth] = useState((selectedDate || today).getMonth());

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
  const kickoffISO = match.date && match.time ? `${match.date}T${match.time}:00` : null;
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
        flexWrap: "nowrap",
        overflowX: "auto",
      }}
    >
      {/* Right side (in RTL, appears first): date + time pickers */}
      <div style={{ display: "flex", alignItems: "center", gap: "4px", minWidth: 0, flexWrap: "nowrap", flexShrink: 0 }}>
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

      {/* Left side: countdown badge, always stays on this line */}
      <div style={{ flexShrink: 0 }}>
        <CountdownBadge kickoffISO={kickoffISO} theme={theme} />
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
  const kickoffISO = match.date && match.time ? `${match.date}T${match.time}:00` : null;

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

      <CountdownBadge kickoffISO={kickoffISO} theme={theme} />
    </div>
  );
}

// Static (non-editable) team display for the restricted user view.
function TeamDisplay({ name, logo, theme, noUnderline, logoSize = 48, isHome }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "6px", flex: 1, minWidth: 0 }}>
      <div style={{ position: "relative" }}>
        {isHome && (
          <span
            style={{
              position: "absolute",
              top: "-10px",
              left: "50%",
              transform: "translateX(-50%)",
              lineHeight: 1,
              color: theme.violet,
            }}
            title="أرض الفريق"
          >
            <Home size={14} color={theme.violet} strokeWidth={2.5} />
          </span>
        )}
        <ClubLogo logo={logo} name={name} theme={theme} size={logoSize} />
      </div>
      <span
        style={{
          fontFamily: "Cairo, sans-serif",
          fontWeight: 800,
          fontSize: "10.5px",
          color: theme.primary,
          textAlign: "center",
          ...(noUnderline ? {} : { borderBottom: `1px solid ${theme.primary}`, paddingBottom: "2px" }),
          width: "100%",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {name || "—"}
      </span>
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
  const colors = result ? tierStyleFor(theme, result.basePoints) : null;

  const num = (v) => (v === "" ? "" : String(v).replace(/[^0-9]/g, "").slice(0, 2));

  const kickoffISO = match.date && match.time ? `${match.date}T${match.time}:00` : null;
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
              <TeamDisplay name={match.home} logo={match.homeLogo} theme={theme} isHome={match.venueTeam === "home"} />
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
              <TeamDisplay name={match.away} logo={match.awayLogo} theme={theme} isHome={match.venueTeam === "away"} />
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
            <div style={{ display: "flex", justifyContent: "center", marginTop: "14px" }}>
              <button
                onClick={saveDraft}
                disabled={saveDisabled}
                style={{
                  border: `1.5px solid ${predictedTab ? (showSaved ? "#16A34A" : "#DC2626") : theme.text}`,
                  background: predictedTab ? (showSaved ? "#16A34A" : "transparent") : showSaved ? theme.text : "transparent",
                  color: predictedTab ? (showSaved ? "#FFFFFF" : "#DC2626") : showSaved ? theme.surface : theme.text,
                  borderRadius: "8px",
                  padding: "7px 18px",
                  fontFamily: "Cairo, sans-serif",
                  fontWeight: 800,
                  fontSize: "11px",
                  cursor: saveDisabled ? "not-allowed" : "pointer",
                  opacity: saveDisabled && !showSaved ? 0.5 : 1,
                  whiteSpace: "nowrap",
                }}
              >
                {showSaved ? "تم الحفظ" : "حفظ التوقع"}
              </button>
            </div>
          )}

          {/* القادمة (match hasn't happened yet) skips the result/points section
              entirely - hasn't started, so a result has no meaning there. */}
          {!hideResult && !isLocked && (
          <>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div style={{ fontSize: "11px", color: theme.muted, fontWeight: 600, marginBottom: "8px" }}>
              النتيجة الفعلية
            </div>
            <div
              style={{
                fontSize: "12px",
                color: theme.muted,
                height: "40px",
                display: "flex",
                alignItems: "center",
              }}
            >
              لم تنتهِ المباراة
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "6px", marginTop: "16px" }}>
            {noPrediction ? (
              <span style={{ color: theme.danger, fontWeight: 700, fontSize: "12px" }}>لم تتوقع المباراة</span>
            ) : (
              <div
                style={{
                  width: "44px",
                  height: "44px",
                  borderRadius: "50%",
                  border: `2px dashed ${theme.inputBorder}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "11px",
                  color: theme.muted,
                }}
              >
                —
              </div>
            )}
          </div>
          </>
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

function Scoreboard({ match, onChange, onRemove, tournaments, onAddTournament, clubsByTournament, tournamentLogos, theme }) {
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

  const kickoffISO = draft.date && draft.time ? `${draft.date}T${draft.time}:00` : null;
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
            {/* Invisible spacer matching the delete button's width, so the
                team pair stays visually centered instead of leaning toward
                the delete button's side. */}
            <div style={{ width: "24px", flexShrink: 0 }} />
            <TeamPicker
              value={draft.home}
              logo={draft.homeLogo}
              onChange={(name, logo) => updateDraft({ ...draft, home: name, homeLogo: logo })}
              clubs={clubs}
              placeholder="الفريق الأول"
              theme={theme}
              disabled={naturallyLocked}
            />
            <span style={{ color: theme.muted, fontSize: "12px", fontWeight: 600, flexShrink: 0 }}>ضد</span>
            <TeamPicker
              value={draft.away}
              logo={draft.awayLogo}
              onChange={(name, logo) => updateDraft({ ...draft, away: name, awayLogo: logo })}
              clubs={clubs}
              placeholder="الفريق الثاني"
              theme={theme}
              disabled={naturallyLocked}
            />
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

          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", marginBottom: "16px" }}>
            <button
              onClick={() => updateDraft({ ...draft, venueTeam: draft.venueTeam === "home" ? null : "home" })}
              disabled={naturallyLocked}
              title="حدد الفريق الأول كصاحب أرض"
              style={{
                background: draft.venueTeam === "home" ? theme.violetSoft : "transparent",
                border: `1px solid ${draft.venueTeam === "home" ? theme.violet : theme.inputBorder}`,
                color: draft.venueTeam === "home" ? theme.violet : theme.muted,
                borderRadius: "8px",
                padding: "5px 12px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: naturallyLocked ? "not-allowed" : "pointer",
              }}
            >
              <Home size={15} />
            </button>
            <button
              onClick={() => updateDraft({ ...draft, venueTeam: draft.venueTeam === "away" ? null : "away" })}
              disabled={naturallyLocked}
              title="حدد الفريق الثاني كصاحب أرض"
              style={{
                background: draft.venueTeam === "away" ? theme.violetSoft : "transparent",
                border: `1px solid ${draft.venueTeam === "away" ? theme.violet : theme.inputBorder}`,
                color: draft.venueTeam === "away" ? theme.violet : theme.muted,
                borderRadius: "8px",
                padding: "5px 12px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: naturallyLocked ? "not-allowed" : "pointer",
              }}
            >
              <Home size={15} />
            </button>
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

          {/* Save button - commits all staged edits (tournament, teams,
              date/time, double-points, actual result) at once. */}
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
          {value !== "الكل" && <TournamentIcon name={value} logo={tournamentLogos?.[value]} theme={theme} color={theme.muted} />}
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
              {t !== "الكل" && <TournamentIcon name={t} logo={tournamentLogos?.[t]} theme={theme} color={t === value ? theme.violet : theme.muted} />}
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
      <div style={{ maxWidth: "480px", margin: "0 auto" }}>
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

function PlayerAvatar({ name, avatar, isYou, theme, size = 32 }) {
  const initial = (name || "").trim().charAt(0) || "؟";
  if (avatar) {
    return (
      <div
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          overflow: "hidden",
          flexShrink: 0,
        }}
      >
        <img src={avatar} alt={name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </div>
    );
  }
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

function LeaderboardRow({ rank, name, username, avatar, points, isYou, theme }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        padding: "10px 12px",
        borderRadius: "10px",
        background: isYou ? theme.primarySoft : theme.surface,
        border: `1px solid ${isYou ? theme.primary : theme.border}`,
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
      <PlayerAvatar name={name} avatar={avatar} isYou={isYou} theme={theme} />
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
          <span dir="ltr" style={{ fontFamily: "monospace", fontSize: "10px", color: theme.muted, textAlign: "right" }}>
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
                    setUsername(e.target.value);
                    setUsernameError("");
                  }}
                  placeholder="username"
                  style={{ ...inputStyle, border: `1.5px solid ${usernameError ? theme.danger : theme.inputBorder}`, textAlign: "right" }}
                />
                {usernameError ? (
                  <p style={{ fontSize: "11px", color: theme.danger, marginTop: "5px" }}>{usernameError}</p>
                ) : (
                  <p style={{ fontSize: "11px", color: theme.muted, marginTop: "5px" }}>يجب أن يكون اسم المستخدم فريد، يظهر بلوحة الترتيب</p>
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
    if (result?.error) setError(result.error);
  };

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
  const [avatar, setAvatar] = useState(currentUser?.avatar || null);
  const [usernameError, setUsernameError] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // currentUser can still be loading (session restore) when this page first
  // mounts, so re-sync the fields once the real profile data arrives.
  useEffect(() => {
    if (!currentUser) return;
    setName(currentUser.name || "");
    setUsername(currentUser.username || "");
    setAvatar(currentUser.avatar || null);
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

  const handleAvatarUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    fileToBase64(file, (dataUrl) => setAvatar(dataUrl));
  };

  const handleSave = async () => {
    const normalized = username.trim().toLowerCase();
    setUsernameError("");
    setSaving(true);
    const result = await onUpdateProfile({ name: name.trim(), username: normalized, avatar });
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
          <div style={{ position: "relative" }}>
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
                overflow: "hidden",
              }}
            >
              {avatar ? (
                <img src={avatar} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                <span style={{ fontSize: "32px", fontWeight: 700, color: theme.muted }}>
                  {(name || "؟").trim().charAt(0)}
                </span>
              )}
            </div>
            <input type="file" accept="image/*" onChange={handleAvatarUpload} style={{ display: "none" }} id="avatar-upload" />
            <label
              htmlFor="avatar-upload"
              style={{
                position: "absolute",
                bottom: "-2px",
                left: "-2px",
                width: "30px",
                height: "30px",
                borderRadius: "50%",
                background: theme.violet,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                border: `2px solid ${theme.surface}`,
              }}
            >
              <Camera size={11} color="#FFFFFF" />
            </label>
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
                setUsername(e.target.value);
                setUsernameError("");
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

function GlobalLeaderboardPage({ matches, allPredictionRows, tournaments, tournamentLogos, currentUser, theme }) {
  const [tournamentFilter, setTournamentFilter] = usePersistedState("globalLeaderboard.tournamentFilter", "الكل");

  const filteredMatches = tournamentFilter === "الكل" ? matches : matches.filter((m) => (m.tournament || "بدون بطولة") === tournamentFilter);

  // Real leaderboard: every registered user is scored from their own actual
  // predictions on the matches in this filter, using the same scoring rules
  // as the stats page (calcPoints + the admin x2 / personal x3 multiplier).
  const matchById = Object.fromEntries(filteredMatches.map((m) => [m.id, m]));

  const byUser = {};
  for (const row of allPredictionRows) {
    const match = matchById[row.match_id];
    if (!match) continue; // outside the current tournament filter, or unknown match
    if (!isMatchFinished(match)) continue; // match hasn't finished/locked yet

    if (!byUser[row.user_id]) {
      byUser[row.user_id] = {
        id: row.user_id,
        name: row.profiles?.name || "مستخدم",
        username: row.profiles?.username || null,
        avatar: row.profiles?.avatar || null,
        points: 0,
        tierCounts: { 10: 0, 5: 0, 4: 0, 3: 0, 1: 0, 0: 0, none: 0 },
      };
    }
    const entry = byUser[row.user_id];

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

  const players = Object.values(byUser).map((p) => ({ ...p, isYou: currentUser && p.id === currentUser.id }));

  // Make sure the current user shows up even before they've made a single prediction.
  if (currentUser && !players.some((p) => p.id === currentUser.id)) {
    players.push({
      id: currentUser.id,
      name: currentUser.name,
      username: currentUser.username,
      avatar: currentUser.avatar,
      points: 0,
      tierCounts: { 10: 0, 5: 0, 4: 0, 3: 0, 1: 0, 0: 0, none: 0 },
      isYou: true,
    });
  }

  const ranked = [...players].sort((a, b) => b.points - a.points || compareTierCounts(a.tierCounts, b.tierCounts));

  return (
    <div style={{ padding: "20px 16px 60px" }}>
      <div style={{ maxWidth: "480px", margin: "0 auto" }}>
        <h2 style={{ fontSize: "16px", fontWeight: 800, color: theme.primary, marginBottom: "4px" }}>
          لوحة الترتيب العام
        </h2>
        <p style={{ fontSize: "12px", color: theme.muted, marginBottom: "16px" }}>
          ترتيب جميع المشاركين حسب إجمالي النقاط
        </p>

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
              <LeaderboardRow key={p.id} rank={i + 1} name={p.name} username={p.username} avatar={p.avatar} points={p.points} isYou={p.isYou} theme={theme} />
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

function PrivateLeagueDetail({ league, matches, allPredictionRows, onJoin, onBack, tournaments, tournamentLogos, currentUser, theme }) {
  const [codeCopied, setCodeCopied] = useState(false);
  const [activeTab, setActiveTab] = usePersistedState("leagueDetail.activeTab", "ranking"); // "ranking" | "predictions"
  const [tournamentFilter, setTournamentFilter] = usePersistedState("leagueDetail.tournamentFilter", "الكل");

  const youPlayer = league.players.find((p) => p.isYou);

  // Auto-join: a logged-in user who opens a league they haven't joined yet
  // is added automatically using their account name/username - no manual
  // "enter your name" step needed anymore.
  useEffect(() => {
    if (currentUser && !youPlayer) {
      onJoin(league.id, currentUser.name, currentUser.username);
    }
  }, [currentUser, youPlayer, league.id, onJoin]);

  // Tournament filter applies to both tabs (الترتيب والتوقعات) - defaults
  // to "الكل" (no filter), scoping every downstream computation below.
  const filteredMatches = tournamentFilter === "الكل" ? matches : matches.filter((m) => (m.tournament || "بدون بطولة") === tournamentFilter);

  // Every league member is scored from their own real predictions and the
  // real match results, same scoring rules as the global leaderboard - no
  // simulated/fake data for other members anymore.
  const matchById = Object.fromEntries(filteredMatches.map((m) => [m.id, m]));

  const realPointsByUserId = {};
  for (const row of allPredictionRows) {
    const match = matchById[row.match_id];
    if (!match) continue;
    if (!isMatchFinished(match)) continue;

    if (!realPointsByUserId[row.user_id]) {
      realPointsByUserId[row.user_id] = { points: 0, tierCounts: { 10: 0, 5: 0, 4: 0, 3: 0, 1: 0, 0: 0, none: 0 } };
    }
    const entry = realPointsByUserId[row.user_id];

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
      };
    })
    .sort((a, b) => b.points - a.points || compareTierCounts(a.tierCounts, b.tierCounts));

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
    .filter(isMatchFinished)
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
      <div style={{ maxWidth: "480px", margin: "0 auto" }}>
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

        {/* Tournament filter - applies to both الترتيب and التوقعات tabs */}
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
                <LeaderboardRow key={p.id} rank={i + 1} name={p.name} username={p.username} avatar={p.avatar} points={p.points} isYou={p.isYou} theme={theme} />
              ))}
            </div>

            <p style={{ fontSize: "11px", color: theme.muted, textAlign: "center", marginTop: "14px" }}>
              النقاط محسوبة من توقعات تجريبية على مباريات صفحة "توقع!" الحالية
            </p>
          </>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px" }}>
            {finishedMatches.length === 0 ? (
              <p style={{ fontSize: "12px", color: theme.muted, textAlign: "center", padding: "20px 0" }}>
                ما فيه مباريات منتهية بعد
              </p>
            ) : (
              finishedMatches.map((match) => (
                <div key={match.id} style={{ width: "280px" }}>
                  <LeaguePredictionCard match={match} league={league} playerPredictionsById={playerPredictionsById} tournamentLogos={tournamentLogos} theme={theme} />
                </div>
              ))
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
            <TeamDisplay name={match.home} logo={match.homeLogo} theme={theme} noUnderline logoSize={36} isHome={match.venueTeam === "home"} />
            <ScoreBoxStatic value={match.actualHome} theme={theme} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingTop: "24px" }}>
            <span style={{ color: theme.muted, fontSize: "11px", fontWeight: 700 }}>ضد</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "5px", flex: 1 }}>
            <TeamDisplay name={match.away} logo={match.awayLogo} theme={theme} noUnderline logoSize={36} isHome={match.venueTeam === "away"} />
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
          const colors = result ? tierStyleFor(theme, result.basePoints) : null;
          return (
            <div
              key={p.id}
              style={{
                display: "flex",
                borderTop: idx === 0 ? "none" : `1px solid ${theme.border}`,
              }}
            >
              <div style={{ flex: 1, textAlign: "center", padding: "5px 4px", borderLeft: `1px solid ${theme.border}` }}>
                <ResultPill theme={theme} border={theme.text} bg={theme.bg} color={theme.text} compact>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "60px" }}>{p.name}</span>
                </ResultPill>
              </div>
              <div style={{ flex: 1, textAlign: "center", padding: "5px 4px", borderLeft: `1px solid ${theme.border}` }}>
                {pred ? (
                  <ResultPill theme={theme} border={theme.text} bg={theme.bg} color={theme.text} compact>
                    {pred.predHome} - {pred.predAway}
                  </ResultPill>
                ) : (
                  <ResultPill theme={theme} border={theme.inputBorder} bg={theme.bg} color={theme.muted} compact>
                    لم يتوقع
                  </ResultPill>
                )}
              </div>
              <div style={{ flex: 1, textAlign: "center", padding: "5px 4px" }}>
                {result ? (
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
                    لم يتوقع
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

function PrivateLeaguesPage({ leagues, matches, allPredictionRows, onCreateLeague, onJoinLeague, tournaments, tournamentLogos, currentUser, theme }) {
  const [selectedLeagueId, setSelectedLeagueId] = usePersistedState("leagues.selectedLeagueId", null);
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
      <div style={{ maxWidth: "480px", margin: "0 auto" }}>
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

function HomePage({ theme, onNavigate }) {
  return (
    <div style={{ padding: "40px 20px 60px", textAlign: "center" }}>
      <div style={{ maxWidth: "420px", margin: "0 auto" }}>
        {/* Big headline */}
        <h1
          style={{
            fontSize: "38px",
            fontWeight: 800,
            color: theme.primary,
            lineHeight: "1.25",
            margin: "40px 0 18px",
          }}
        >
          توقع
          <br />
          المباريات
          <br />
          والبطولات!
        </h1>

        <p
          style={{
            fontSize: "14px",
            color: theme.muted,
            lineHeight: "22px",
            margin: "0 0 32px",
          }}
        >
          موقع شامل لجميع توقعات مباريات كرة القدم المهمة
        </p>

        {/* CTA buttons */}
        <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "32px" }}>
          <button
            onClick={() => onNavigate("predictions")}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
              width: "100%",
              border: "none",
              borderRadius: "12px",
              padding: "14px",
              background: theme.primary,
              color: theme.surface,
              fontFamily: "Cairo, sans-serif",
              fontWeight: 700,
              fontSize: "15px",
              cursor: "pointer",
            }}
          >
            ابدأ التوقع الآن
            <ArrowDown size={16} />
          </button>
          <button
            onClick={() => onNavigate("pointsSystem")}
            style={{
              width: "100%",
              border: `1.5px solid ${theme.violet}`,
              borderRadius: "12px",
              padding: "14px",
              background: theme.surface,
              color: theme.text,
              fontFamily: "Cairo, sans-serif",
              fontWeight: 700,
              fontSize: "15px",
              cursor: "pointer",
            }}
          >
            تعرف على نظام النقاط
          </button>
        </div>

        {/* Footer info row */}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: "10px",
            flexWrap: "wrap",
            fontSize: "11px",
            color: theme.muted,
          }}
        >
          <span>RTL كامل</span>
          <span style={{ color: theme.inputBorder }}>•</span>
          <span>يعمل بدون إنترنت</span>
          <span style={{ color: theme.inputBorder }}>•</span>
          <span>محفوظ محليًا</span>
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
      <div style={{ maxWidth: "480px", margin: "0 auto" }}>
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
      <div style={{ maxWidth: "480px", margin: "0 auto" }}>
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
  { id: "leagues", label: "الدوريات", icon: Users, color: (t) => t.blue },
  { id: "globalLeaderboard", label: "لوحة الترتيب العام", icon: Crown, color: (t) => "#D4AF37" },
  { id: "stats", label: "الإحصائيات", icon: BarChart3, color: (t) => t.accent },
  { id: "pointsSystem", label: "نظام النقاط", icon: Award, color: (t) => t.violet },
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

// Custom logo: a football inside a crosshair/target ring, symbolizing
// "predicting a match outcome" rather than a generic icon.
function PredictionLogo({ theme, size = 30 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Outer crosshair ring */}
      <circle cx="16" cy="16" r="14" stroke={theme.primary} strokeWidth="1.6" />
      <line x1="16" y1="0.5" x2="16" y2="5.5" stroke={theme.primary} strokeWidth="1.6" strokeLinecap="round" />
      <line x1="16" y1="26.5" x2="16" y2="31.5" stroke={theme.primary} strokeWidth="1.6" strokeLinecap="round" />
      <line x1="0.5" y1="16" x2="5.5" y2="16" stroke={theme.primary} strokeWidth="1.6" strokeLinecap="round" />
      <line x1="26.5" y1="16" x2="31.5" y2="16" stroke={theme.primary} strokeWidth="1.6" strokeLinecap="round" />

      {/* Ball */}
      <circle cx="16" cy="16" r="8.5" fill={theme.surface} stroke={theme.primary} strokeWidth="1.4" />
      <polygon points="16,11.8 19.99,14.7 18.47,19.4 13.53,19.4 12.01,14.7" fill={theme.violet} />
      <line x1="16" y1="11.8" x2="16" y2="8.8" stroke={theme.primary} strokeWidth="1.1" strokeLinecap="round" />
      <line x1="19.99" y1="14.7" x2="22.85" y2="13.78" stroke={theme.primary} strokeWidth="1.1" strokeLinecap="round" />
      <line x1="18.47" y1="19.4" x2="20.23" y2="21.82" stroke={theme.primary} strokeWidth="1.1" strokeLinecap="round" />
      <line x1="13.53" y1="19.4" x2="11.77" y2="21.82" stroke={theme.primary} strokeWidth="1.1" strokeLinecap="round" />
      <line x1="12.01" y1="14.7" x2="9.15" y2="13.78" stroke={theme.primary} strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

// A hand-drawn-style wavy divider line, used as a decorative violet accent
// beneath the header and above each match's schedule row.
function VioletDivider({ theme }) {
  return <div style={{ height: "0.5px", background: theme.violet }} />;
}

function TopBar({ onMenuClick, theme }) {
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
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <PredictionLogo theme={theme} />
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
  const [dataLoading, setDataLoading] = useState(true);

  useEffect(() => {
    Promise.all([fetchTournaments(), fetchClubs(), fetchMatches(), fetchAllPredictionsWithProfiles()])
      .then(([t, c, m, p]) => {
        setTournamentRows(t);
        setClubRows(c);
        setMatchRows(m);
        setAllPredictionRows(p);
      })
      .finally(() => setDataLoading(false));
  }, []);

  // Keep the server-time offset fresh so match locking can't be tricked by
  // changing the device's date/time; re-sync on load and every 2 minutes.
  useEffect(() => {
    const sync = () => fetchServerTimeOffset().then((offset) => { setServerTimeSync(Date.now() + offset); });
    sync();
    const id = setInterval(sync, 2 * 60 * 1000);
    return () => clearInterval(id);
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
  const [activePage, setActivePage] = useState(() => sessionStorage.getItem("activePage") || "home");
  const [viewMode, setViewMode] = usePersistedState("viewMode", "user"); // "admin" | "user" - only admins may switch to "admin"
  const [predictionsTabView, setPredictionsTabView] = usePersistedState("predictionsTabView", "available"); // "available" | "predicted" | "archived" - for the توقع! page's match list
  const [archivedVisibleCount, setArchivedVisibleCount] = useState(10); // المنتهية loads 10 at a time so the page doesn't slow down as old matches pile up
  const [currentUser, setCurrentUser] = useState(null); // null when logged out, { id, name, username, email, avatar } when logged in
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    // Skip this while auth is still loading on refresh - currentUser is
    // briefly null then, which would otherwise kick an admin back to
    // user mode before their session even finishes loading.
    if (!authLoading && viewMode === "admin" && !currentUser?.is_admin) setViewMode("user");
  }, [currentUser, viewMode, authLoading]);

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
      setActivePage("home");
      return {};
    } catch (err) {
      return { error: err.message || "حدث خطأ، حاول مرة أخرى" };
    }
  };

  const USERNAME_COOLDOWN_MS = 6 * 30 * 24 * 60 * 60 * 1000; // ~6 months

  const handleUpdateProfile = async ({ name, username, avatar }) => {
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

      await updateProfile(currentUser.id, { name, username, avatar, usernameChanged });
      setCurrentUser((u) => ({
        ...u,
        name,
        username,
        avatar,
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
  }, []);

  const leagues = useMemo(
    () =>
      leagueRows.map((l) => ({
        id: l.id,
        code: l.code,
        name: l.name,
        players: (l.league_members || []).map((m) => ({
          id: m.id,
          userId: m.user_id,
          name: m.display_name,
          avatar: m.profiles?.avatar || null,
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
      .then((row) => setTournamentRows((prev) => [...prev, row]))
      .catch((err) => alert("تعذّرت إضافة البطولة: " + (err?.message || "خطأ غير متوقع")));
  };

  const setTournamentLogo = (tournamentName, logo) => {
    const id = tournamentIdByName[tournamentName];
    if (!id) return;
    setTournamentLogoDB(id, logo);
    setTournamentRows((prev) => prev.map((t) => (t.id === id ? { ...t, logo } : t)));
  };

  const removeTournament = (tournamentName) => {
    const id = tournamentIdByName[tournamentName];
    if (!id) return;
    removeTournamentDB(id).then(() => {
      setTournamentRows((prev) => prev.filter((t) => t.id !== id));
      setClubRows((prev) => prev.filter((c) => c.tournament_id !== id));
      setMatchRows((prev) => prev.map((m) => (m.tournament_id === id ? { ...m, tournament_id: null } : m)));
    });
  };

  const addClub = (tournamentName, club) => {
    const tournamentId = tournamentIdByName[tournamentName];
    if (!tournamentId) return;
    addClubDB(tournamentId, club).then((row) => setClubRows((prev) => [...prev, row]));
  };

  const updateClub = (tournamentName, clubId, updated) => {
    updateClubDB(clubId, updated);
    setClubRows((prev) => prev.map((c) => (c.id === clubId ? { ...c, ...updated } : c)));
  };

  const removeClub = (tournamentName, clubId) => {
    removeClubDB(clubId);
    setClubRows((prev) => prev.filter((c) => c.id !== clubId));
  };

  const addMatch = () => {
    addMatchDB().then((row) => setMatchRows((prev) => [...prev, row]));
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
      const scoreChanged =
        prevPred && (String(prevPred.predHome ?? "") !== String(predictionFields.predHome ?? "") || String(prevPred.predAway ?? "") !== String(predictionFields.predAway ?? ""));
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
      if (prevBoost !== nextBoost) {
        const newBoostsRemaining = boostsRemaining + (nextBoost ? -1 : 1);
        setBoostsRemainingDB(currentUser.id, newBoostsRemaining);
        setCurrentUser((u) => ({ ...u, boosts_remaining: newBoostsRemaining }));
      }

      upsertPredictionDB(currentUser.id, id, predictionFields);
      setPredictionsByMatch((prev) => ({ ...prev, [id]: predictionFields }));
      setAllPredictionRows((prev) => {
        const exists = prev.some((r) => r.match_id === id && r.user_id === currentUser.id);
        const row = {
          match_id: id,
          user_id: currentUser.id,
          pred_home: predictionFields.predHome === "" ? null : Number(predictionFields.predHome),
          pred_away: predictionFields.predAway === "" ? null : Number(predictionFields.predAway),
          user_boost: !!predictionFields.userBoost,
          profiles: { name: currentUser.name, username: currentUser.username },
        };
        return exists ? prev.map((r) => (r.match_id === id && r.user_id === currentUser.id ? row : r)) : [...prev, row];
      });
    }
  };

  const confirmPrediction = (id) => {
    setConfirmedPredictions((prev) => ({ ...prev, [id]: true }));
    setSavedPredictions((prev) => ({ ...prev, [id]: true }));
  };

  const removeMatch = (id) => {
    removeMatchDB(id);
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

      <TopBar onMenuClick={() => setDrawerOpen(true)} theme={theme} />
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

      {activePage === "predictions" && !authLoading && !currentUser && (
        <LoginGate onNavigateToAuth={() => setActivePage("auth")} theme={theme} />
      )}

      {activePage === "predictions" && currentUser && (
        <div style={{ padding: "20px 16px 60px" }}>
          <div style={{ maxWidth: "480px", margin: "0 auto" }}>
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
                  انتهت
                </button>
              </div>

              {(() => {
                const isLockedCount = (m) => {
                  if (!m.date || !m.time) return false;
                  return new Date(`${m.date}T${m.time}:00`).getTime() - serverNow() <= 0;
                };
                const isPredictedCount = (m) => !!savedPredictions[m.id];
                const scheduled = viewMode === "user" ? matches.filter((m) => m.date && m.time) : matches;
                const availableCount = scheduled.filter((m) => !isLockedCount(m) && !isPredictedCount(m)).length;
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
                gap: "4px",
                padding: "8px 12px",
                fontFamily: "Cairo, sans-serif",
                fontSize: "10px",
                color: theme.muted,
                borderBottom: `1px solid ${theme.border}`,
              }}
            >
              <span>
                <strong style={{ color: theme.text }}>• الدبل:</strong> يتم تفعيله من قبل الادمن مباراة واحدة لكل أسبوع
              </span>
              <span>
                <strong style={{ color: theme.text }}>• التربل:</strong> يتم تفعيله من قبل اللاعبين ومتوفر ٣ مرات طوال الموسم ولا يمكن تفعيله على مباراة الدبل
              </span>
            </div>

            {/* Matches */}
            {(() => {
              const isLocked = (m) => {
                if (!m.date || !m.time) return false;
                return new Date(`${m.date}T${m.time}:00`).getTime() - serverNow() <= 0;
              };
              const isPredicted = (m) => !!savedPredictions[m.id];

              let tabMatches = matches.filter((m) => {
                if (predictionsTabView === "archived") return isLocked(m);
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
                predictionsTabView === "archived" ? sortedTabMatches.slice(0, archivedVisibleCount) : sortedTabMatches;
              const hasMoreArchived = predictionsTabView === "archived" && sortedTabMatches.length > archivedVisibleCount;

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
                  {hasMoreArchived && (
                    <button
                      onClick={() => setArchivedVisibleCount((c) => c + 10)}
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
                      عرض المزيد
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

      {activePage === "home" && <HomePage theme={theme} onNavigate={setActivePage} />}

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

      {activePage === "leagues" && currentUser && (
        <PrivateLeaguesPage
          leagues={leagues}
          matches={matches}
          allPredictionRows={allPredictionRows}
          onCreateLeague={createLeague}
          onJoinLeague={joinLeague}
          tournaments={tournaments}
          tournamentLogos={tournamentLogos}
          currentUser={currentUser}
          theme={theme}
        />
      )}

      {activePage === "globalLeaderboard" && (
        <GlobalLeaderboardPage
          matches={matches}
          allPredictionRows={allPredictionRows}
          tournaments={tournaments}
          tournamentLogos={tournamentLogos}
          currentUser={currentUser}
          theme={theme}
        />
      )}

      {activePage === "pointsSystem" && <PointsSystemPage theme={theme} />}

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
