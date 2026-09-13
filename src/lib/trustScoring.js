// src/lib/trustScoring.js
//
// Trust & Verification Layer -- ghost-job scoring, per the spec.
//
// Real cross-referencing against a company's own careers page (the
// strongest ghost-job signal) needs the Discovery Engine, which isn't
// built yet. What CAN be computed right now, honestly, is freshness:
// how recently was this listing actually re-checked, and how long has
// it sat unchanged. That's a real, if partial, signal -- worth
// computing from actual timestamps instead of a value someone typed
// in by hand, which is all `jobs.trust_status` has been until now.
//
// `closed` is deliberately NOT computed here -- knowing a listing was
// actively taken down requires checking the source, which is a
// Discovery Engine capability. Until that exists, `closed` can only
// come from an explicit manual/source signal, never inferred from
// silence alone (silence and "closed" are different things, and
// conflating them would be exactly the overconfident claim the spec's
// honesty principle warns against).

const HOUR = 1000 * 60 * 60;
const DAY = HOUR * 24;

export function computeTrustStatus(job) {
  // Respect an explicit "closed" signal if one exists (source-provided,
  // not inferred) -- this always wins over any computed freshness state.
  if (job.trust_status === "closed") {
    return { status: "closed", reason: "Marked closed at the source" };
  }

  const now = Date.now();

  if (job.last_verified_at) {
    const hoursSinceVerified = (now - new Date(job.last_verified_at).getTime()) / HOUR;

    if (hoursSinceVerified < 24) {
      return { status: "verified", reason: `Re-checked ${Math.round(hoursSinceVerified)}h ago` };
    }
    if (hoursSinceVerified < 24 * 7) {
      return { status: "probably_active", reason: `Last re-checked ${Math.round(hoursSinceVerified / 24)}d ago` };
    }
    return { status: "stale", reason: "Verified once, but not re-checked recently" };
  }

  // Never verified at all -- lean on posting age and how long it's
  // sat unchanged as the only signals available.
  if (job.days_unchanged != null && job.days_unchanged > 45) {
    return {
      status: "ghost_risk",
      reason: `Unchanged for ${job.days_unchanged} days with no confirmation it's still open`,
    };
  }

  if (job.posted_at) {
    const daysSincePosted = (now - new Date(job.posted_at).getTime()) / DAY;
    if (daysSincePosted > 30) {
      return { status: "stale", reason: `Posted ${Math.round(daysSincePosted)} days ago, never re-checked` };
    }
  }

  return { status: "unverified", reason: "Not yet checked" };
}
