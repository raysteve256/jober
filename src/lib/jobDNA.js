// src/lib/jobDNA.js
//
// Job DNA is now dual-layer:
//  - Dexie (IndexedDB): instant local read/write, works with no signal
//  - Supabase (Postgres, RLS): source of truth, syncs across devices
//
// Writes go to Dexie immediately (so the UI never waits on a network
// round trip) and to Supabase best-effort in the background. Reads
// prefer Supabase when available (freshest, cross-device) and fall
// back to the local Dexie copy when offline.

import Dexie from "dexie";
import { supabase, ensureSession } from "./supabaseClient";

export const db = new Dexie("jobDiscoveryDB");

db.version(1).stores({
  jobDNA: "id",
  messages: "++id, role, timestamp",
});

const LOCAL_ID = "local-user";

export async function getJobDNA() {
  try {
    const session = await ensureSession();
    const { data, error } = await supabase
      .from("job_dna")
      .select("data")
      .eq("user_id", session.user.id)
      .maybeSingle();

    if (!error && data) {
      await db.jobDNA.put({ id: LOCAL_ID, data: data.data });
      return data.data;
    }
  } catch (err) {
    console.warn("Supabase unavailable, falling back to local Job DNA:", err.message);
  }

  const row = await db.jobDNA.get(LOCAL_ID);
  return row?.data ?? {};
}

export async function mergeJobDNA(newFacts) {
  const current = await getJobDNA();
  const merged = { ...current };

  for (const [key, value] of Object.entries(newFacts || {})) {
    if (value !== null && value !== undefined && value !== "") {
      merged[key] = value;
    }
  }

  // Local write first -- never block the UI on network latency.
  await db.jobDNA.put({ id: LOCAL_ID, data: merged });

  // Best-effort remote sync. If this fails (offline), the next
  // getJobDNA() call will just serve the local copy until it
  // succeeds again -- no data is lost, it's just not synced yet.
  try {
    const session = await ensureSession();
    await supabase.from("job_dna").upsert({
      user_id: session.user.id,
      data: merged,
      updated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.warn("Could not sync Job DNA to Supabase (will retry next write):", err.message);
  }

  return merged;
}

export async function logMessage(role, content) {
  await db.messages.add({ role, content, timestamp: Date.now() });

  try {
    const session = await ensureSession();
    await supabase.from("messages").insert({
      user_id: session.user.id,
      role,
      content: typeof content === "string" ? { text: content } : content,
    });
  } catch (err) {
    console.warn("Could not sync message to Supabase:", err.message);
  }
}

export async function getHistory() {
  try {
    const session = await ensureSession();
    const { data, error } = await supabase
      .from("messages")
      .select("role, content, created_at")
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: true });

    if (!error && data) {
      return data.map((m) => ({
        role: m.role,
        content: m.content?.text ?? m.content,
      }));
    }
  } catch (err) {
    console.warn("Supabase unavailable, falling back to local history:", err.message);
  }

  const rows = await db.messages.orderBy("timestamp").toArray();
  return rows.map((r) => ({ role: r.role, content: r.content }));
}
