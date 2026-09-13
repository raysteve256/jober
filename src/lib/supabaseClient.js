// src/lib/supabaseClient.js
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  // Fails loudly in dev rather than silently returning no data --
  // matches the "fail clearly, not confidently wrong" principle
  // used throughout the Reasoning Core.
  console.error(
    "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy .env.example to .env and fill them in."
  );
}

export const supabase = createClient(url, key);

// Anonymous auth is enough for the MVP: it gives every device a real
// auth.uid() so RLS on job_dna/messages/application_outcomes works,
// without requiring a signup flow yet. Upgrading an anonymous user to
// a real email/password account later is a normal Supabase flow
// (supabase.auth.updateUser) and keeps the same user_id/history.
export async function ensureSession() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) return session;

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
  return data.session;
}

export async function getCurrentUserId() {
  const session = await ensureSession();
  return session.user.id;
}
