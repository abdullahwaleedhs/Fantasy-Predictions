import { supabase } from "./supabaseClient";

export async function isUsernameTaken(username, excludeUserId) {
  let query = supabase.from("profiles").select("id").eq("username", username);
  if (excludeUserId) query = query.neq("id", excludeUserId);
  const { data, error } = await query.maybeSingle();
  if (error && error.code !== "PGRST116") return false; // can't verify; let DB unique constraint catch it
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
    // Usernames are stored lowercase, so normalize here too - login by
    // username shouldn't be case-sensitive.
    const { data, error } = await supabase.rpc("get_email_for_username", { p_username: identifier.trim().toLowerCase() });
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

export async function deleteAccount() {
  const { error } = await supabase.rpc("delete_own_account");
  if (error) throw error;
  await supabase.auth.signOut();
}

// Sends a "reset your password" email with a link back to this site;
// clicking it puts the browser into a recovery session (handled in
// App.jsx via onAuthStateChange) so the user can pick a new password.
export async function requestPasswordReset(identifier) {
  let email = identifier;
  if (!identifier.includes("@")) {
    const { data, error } = await supabase.rpc("get_email_for_username", { p_username: identifier.trim().toLowerCase() });
    if (error) throw error;
    if (!data) throw new Error("لم يتم العثور على حساب بهذا الاسم");
    email = data;
  }

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: "https://www.fantasy-predictions.com",
  });
  if (error) throw error;
}

export async function updatePassword(newPassword) {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
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
    // Profile fetch failed (likely a transient network error on PWA startup).
    // Return a minimal user so the app treats them as logged in — the caller
    // can detect the missing profile fields and retry later.
    return { id: sessionUser.id, email: sessionUser.email, _profilePending: true };
  }
}
