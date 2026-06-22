import { supabase } from "./supabaseClient";

export async function isUsernameTaken(username, excludeUserId) {
  let query = supabase.from("profiles").select("id").eq("username", username);
  if (excludeUserId) query = query.neq("id", excludeUserId);
  const { data, error } = await query.maybeSingle();
  if (error && error.code !== "PGRST116") throw error;
  return !!data;
}

export async function registerUser({ name, username, email, password }) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;

  const userId = data.user?.id;
  if (!data.session || !userId) {
    // Email confirmation is required before a session exists, so we can't
    // create the profile row yet (RLS requires auth.uid() = id).
    return { needsEmailConfirmation: true };
  }

  const { error: profileError } = await supabase
    .from("profiles")
    .insert({ id: userId, name, username, avatar: null });
  if (profileError) throw profileError;

  return { user: { id: userId, name, username, email, avatar: null } };
}

// `identifier` can be either an email or a username - if it doesn't look
// like an email, we resolve it to the matching account's email first.
export async function loginUser({ identifier, password }) {
  let email = identifier;
  if (!identifier.includes("@")) {
    const { data, error } = await supabase.rpc("get_email_for_username", { p_username: identifier });
    if (error) throw error;
    if (!data) throw new Error("بيانات الدخول غير صحيحة");
    email = data;
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  const profile = await fetchProfile(data.user.id);
  return { id: data.user.id, email: data.user.email, ...profile };
}

export async function logoutUser() {
  await supabase.auth.signOut();
}

export async function fetchProfile(userId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("name, username, avatar, boosts_remaining, is_admin, username_changed_at")
    .eq("id", userId)
    .single();
  if (error) throw error;
  return data;
}

export async function setBoostsRemaining(userId, boostsRemaining) {
  const { error } = await supabase.from("profiles").update({ boosts_remaining: boostsRemaining }).eq("id", userId);
  if (error) throw error;
}

export async function updateProfile(userId, { name, username, avatar, usernameChanged }) {
  const fields = { name, username, avatar };
  if (usernameChanged) fields.username_changed_at = new Date().toISOString();
  const { error } = await supabase.from("profiles").update(fields).eq("id", userId);
  if (error) throw error;
}

export async function getSessionUser() {
  const { data } = await supabase.auth.getSession();
  const sessionUser = data.session?.user;
  if (!sessionUser) return null;
  try {
    const profile = await fetchProfile(sessionUser.id);
    return { id: sessionUser.id, email: sessionUser.email, ...profile };
  } catch (e) {
    // A transient network/profile error here shouldn't be treated as
    // "logged out" by the caller throwing - surface no user for this
    // load instead of crashing the auth-restore flow.
    return null;
  }
}
