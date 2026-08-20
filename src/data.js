import { supabase } from "./supabaseClient";

// Gets the server's clock via the server_now() RPC function (see
// supabase/migration_8_server_now_function.sql) and returns the offset in ms
// to add to Date.now() to approximate server time. We use an RPC call (whose
// response body carries the timestamp) rather than reading the HTTP "Date"
// response header, because browsers only expose a small safelist of
// response headers to cross-origin fetches and "Date" isn't one of them -
// reading it silently returns null, which made the previous approach a
// no-op and let device-clock tampering bypass the lock undetected.
export async function fetchServerTimeOffset() {
  try {
    const { data, error } = await supabase.rpc("server_now");
    if (error || !data) return 0;
    return new Date(data).getTime() - Date.now();
  } catch {
    return 0;
  }
}

// ============ PROFILES (admin user list) ============

// Gives a user back one boost via the refund_boost() RPC (see
// supabase/migration_11_refund_boost_function.sql) - used when the admin
// deletes a match the user had spent a triple/boost on.
export async function refundBoostDB(userId) {
  const { error } = await supabase.rpc("refund_boost", { uid: userId });
  if (error) throw error;
}

export async function fetchAllProfiles() {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, name, username, is_admin, created_at")
    .order("created_at");
  if (error) throw error;
  return data;
}

// ============ TOURNAMENTS ============

let _tournamentsCache = null;
export async function fetchTournaments({ bust } = {}) {
  if (!bust && _tournamentsCache) return _tournamentsCache;
  // select("*") so the app keeps working whether or not the is_championship
  // column has been added yet (a fixed column list errors on a missing column
  // and would break the whole initial data load).
  const { data, error } = await supabase.from("tournaments").select("*").order("created_at");
  if (error) throw error;
  _tournamentsCache = data;
  return data;
}
export function bustTournamentsCache() { _tournamentsCache = null; }

export async function setTournamentChampionshipDB(tournamentId, isChampionship) {
  const { error } = await supabase.from("tournaments").update({ is_championship: isChampionship }).eq("id", tournamentId);
  if (error) throw error;
}

export async function setTournamentCupDB(tournamentId, isCup) {
  const { error } = await supabase.from("tournaments").update({ is_cup: isCup }).eq("id", tournamentId);
  if (error) throw error;
}

export async function setTournamentSortOrderDB(tournamentId, sortOrder) {
  const { error } = await supabase.from("tournaments").update({ sort_order: sortOrder }).eq("id", tournamentId);
  if (error) throw error;
}

export async function addTournamentDB(name) {
  const { data, error } = await supabase.from("tournaments").insert({ name }).select().single();
  if (error) throw error;
  return data;
}

export async function setTournamentLogoDB(tournamentId, logo) {
  const { error } = await supabase.from("tournaments").update({ logo }).eq("id", tournamentId);
  if (error) throw error;
}

export async function removeTournamentDB(tournamentId) {
  const { error } = await supabase.from("tournaments").delete().eq("id", tournamentId);
  if (error) throw error;
}

// ============ CLUBS ============

let _clubsCache = null;
export async function fetchClubs({ bust } = {}) {
  if (!bust && _clubsCache) return _clubsCache;
  const { data, error } = await supabase.from("clubs").select("id, tournament_id, name, logo").order("created_at");
  if (error) throw error;
  _clubsCache = data;
  return data;
}
export function bustClubsCache() { _clubsCache = null; }

export async function addClubDB(tournamentId, { name, logo }) {
  const { data, error } = await supabase
    .from("clubs")
    .insert({ tournament_id: tournamentId, name, logo: logo || null })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateClubDB(clubId, updated) {
  const { error } = await supabase.from("clubs").update(updated).eq("id", clubId);
  if (error) throw error;
}

export async function removeClubDB(clubId) {
  const { error } = await supabase.from("clubs").delete().eq("id", clubId);
  if (error) throw error;
}

// ============ MATCHES ============

function rowToMatch(row) {
  return {
    id: row.id,
    tournamentId: row.tournament_id,
    home: row.home,
    away: row.away,
    homeLogo: row.home_logo,
    awayLogo: row.away_logo,
    actualHome: row.actual_home === null ? "" : String(row.actual_home),
    actualAway: row.actual_away === null ? "" : String(row.actual_away),
    date: row.match_date || "",
    time: row.match_time ? row.match_time.slice(0, 5) : "",
    doublePoints: row.double_points,
    venueTeam: row.venue_team || null,
  };
}

export async function fetchMatches() {
  const { data, error } = await supabase.from("matches").select("*").order("created_at");
  if (error) throw error;
  return data.map(rowToMatch);
}

export async function addMatchDB(date) {
  const { data, error } = await supabase
    .from("matches")
    .insert({ home: "", away: "", match_date: date || null })
    .select()
    .single();
  if (error) throw error;
  return rowToMatch(data);
}

export async function updateMatchDB(matchId, { tournamentId, home, away, homeLogo, awayLogo, actualHome, actualAway, date, time, doublePoints, venueTeam }) {
  const { error } = await supabase
    .from("matches")
    .update({
      tournament_id: tournamentId || null,
      home,
      away,
      home_logo: homeLogo || null,
      away_logo: awayLogo || null,
      actual_home: actualHome === "" || actualHome === undefined ? null : Number(actualHome),
      actual_away: actualAway === "" || actualAway === undefined ? null : Number(actualAway),
      match_date: date || null,
      match_time: time || null,
      double_points: !!doublePoints,
      venue_team: venueTeam || null,
    })
    .eq("id", matchId);
  if (error) throw error;
}

export async function removeMatchDB(matchId) {
  const { error } = await supabase.from("matches").delete().eq("id", matchId);
  if (error) throw error;
}

// Who currently has a triple/boost on this match - fetched fresh right
// before deleting it, since the admin's locally-cached prediction list can
// be stale relative to predictions participants saved after the page loaded.
export async function fetchBoostedUserIdsForMatch(matchId) {
  const { data, error } = await supabase
    .from("predictions")
    .select("user_id")
    .eq("match_id", matchId)
    .eq("user_boost", true);
  if (error) throw error;
  return data.map((r) => r.user_id);
}

// ============ PREDICTIONS ============

export async function fetchPredictionsForUser(userId) {
  const { data, error } = await supabase
    .from("predictions")
    .select("match_id, pred_home, pred_away, user_boost")
    .eq("user_id", userId);
  if (error) throw error;
  return data;
}

export async function upsertPredictionDB(userId, matchId, { predHome, predAway, userBoost }) {
  const { error } = await supabase.from("predictions").upsert(
    {
      user_id: userId,
      match_id: matchId,
      pred_home: predHome === "" || predHome === undefined ? null : Number(predHome),
      pred_away: predAway === "" || predAway === undefined ? null : Number(predAway),
      user_boost: !!userBoost,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "match_id,user_id" }
  );
  if (error) throw error;
}

// Every prediction by every user, with the predicting user's name/username
// attached, for the real global leaderboard (everyone is scored from their
// own actual predictions, not simulated).
let _allPredictionsCache = null;
let _allPredictionsCacheTime = 0;
const ALL_PREDICTIONS_TTL = 5 * 60 * 1000; // 5 minutes

export async function fetchAllPredictionsWithProfiles({ bust } = {}) {
  const now = Date.now();
  if (!bust && _allPredictionsCache && (now - _allPredictionsCacheTime) < ALL_PREDICTIONS_TTL) {
    return _allPredictionsCache;
  }
  const { data, error } = await supabase
    .from("predictions")
    .select("match_id, user_id, pred_home, pred_away, user_boost, updated_at, profiles(name, username)");
  if (error) throw error;
  _allPredictionsCache = data;
  _allPredictionsCacheTime = now;
  return data;
}

export function bustAllPredictionsCache() {
  _allPredictionsCache = null;
  _allPredictionsCacheTime = 0;
}

// ============ LEAGUES ============

function generateLeagueCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

export async function fetchLeaguesWithMembers() {
  const { data, error } = await supabase
    .from("leagues")
    .select("id, code, name, created_by, league_members(id, user_id, display_name, profiles(name))")
    .order("created_at");
  if (error) throw error;
  return data;
}

export async function createLeagueDB(name, createdBy) {
  const { data, error } = await supabase
    .from("leagues")
    .insert({ name, code: generateLeagueCode(), created_by: createdBy })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function joinLeagueDB(leagueId, userId, displayName) {
  const { data, error } = await supabase
    .from("league_members")
    .insert({ league_id: leagueId, user_id: userId, display_name: displayName })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ============ CHAMPIONSHIPS (end-of-season top-3 predictions) ============
// Separate from match predictions: users predict the final top 3 of chosen
// leagues, scored independently and shown in the البطولات section.

export async function fetchChampionshipPredictionsForUser(userId) {
  const { data, error } = await supabase
    .from("championship_predictions")
    .select("tournament_id, first_team, second_team, third_team")
    .eq("user_id", userId);
  if (error) throw error;
  return data;
}

export async function upsertChampionshipPredictionDB(userId, tournamentId, { first, second, third }) {
  const { error } = await supabase
    .from("championship_predictions")
    .upsert(
      {
        user_id: userId,
        tournament_id: tournamentId,
        first_team: first || null,
        second_team: second || null,
        third_team: third || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,tournament_id" }
    );
  if (error) throw error;
}

export async function fetchAllChampionshipPredictions() {
  const { data, error } = await supabase
    .from("championship_predictions")
    .select("user_id, tournament_id, first_team, second_team, third_team, profiles(name, username)");
  if (error) throw error;
  return data;
}

export async function fetchChampionshipResults() {
  const { data, error } = await supabase
    .from("championship_results")
    .select("tournament_id, first_team, second_team, third_team");
  if (error) throw error;
  return data;
}

export async function upsertChampionshipResultDB(tournamentId, { first, second, third }) {
  const { error } = await supabase
    .from("championship_results")
    .upsert(
      {
        tournament_id: tournamentId,
        first_team: first || null,
        second_team: second || null,
        third_team: third || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "tournament_id" }
    );
  if (error) throw error;
}

export async function fetchChampionshipSettings() {
  const { data, error } = await supabase
    .from("championship_settings")
    .select("lock_at")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function updateChampionshipLockDB(lockAt) {
  const { error } = await supabase
    .from("championship_settings")
    .upsert({ id: 1, lock_at: lockAt || null }, { onConflict: "id" });
  if (error) throw error;
}
