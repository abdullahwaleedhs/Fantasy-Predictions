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
  if (!userId) {
    // Email confirmation is required before a session exists.
    return { needsEmailConfirmation: true };
  }

  const { error: profileError } = await supabase
    .from("profiles")
    .insert({ id: userId, name, username, avatar: null });
  if (profileError) throw profileError;

  return { user: { id: userId, name, username, email, avatar: null } };
}

export async function loginUser({ email, password }) {
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
    .select("name, username, avatar")
    .eq("id", userId)
    .single();
  if (error) throw error;
  return data;
}

export async function updateProfile(userId, { name, username, avatar }) {
  const { error } = await supabase
    .from("profiles")
    .update({ name, username, avatar })
    .eq("id", userId);
  if (error) throw error;
}

export async function getSessionUser() {
  const { data } = await supabase.auth.getSession();
  const sessionUser = data.session?.user;
  if (!sessionUser) return null;
  const profile = await fetchProfile(sessionUser.id);
  return { id: sessionUser.id, email: sessionUser.email, ...profile };
}
