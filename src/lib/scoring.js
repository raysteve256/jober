// src/lib/scoring.js
//
// Matching & Scoring, per the spec (section 5.5):
//   - multi-dimension fit score, not a single opaque number
//   - every score ships with "why you fit" AND "why you might not"
//   - never a hiring-probability claim -- fit score only
//
// This runs client-side against whatever is in the `jobs` table --
// it doesn't need the Discovery Engine or real scraping to be useful;
// it's just as meaningful against the 4 seeded rows as it will be
// against thousands of real ones later.

function locationScore(job, dna) {
  if (!dna.location) return { points: 10, max: 30, reason: null }; // no penalty for unstated

  const wantsRemote = /remote/i.test(dna.location);
  const jobIsRemote = /remote/i.test(job.location || "");
  const sameCountryRough =
    dna.location &&
    job.location &&
    dna.location.split(",").pop()?.trim().toLowerCase() ===
      job.location.split(",").pop()?.trim().toLowerCase();

  if (jobIsRemote) return { points: 30, max: 30, reason: { type: "positive", text: "Fully remote -- matches anywhere" } };
  if (wantsRemote && !jobIsRemote) {
    return { points: 5, max: 30, reason: { type: "negative", text: "You're open to remote; this role is on-site" } };
  }
  if (sameCountryRough) return { points: 30, max: 30, reason: { type: "positive", text: `Located in ${job.location}` } };
  return { points: 5, max: 30, reason: { type: "negative", text: `Location (${job.location}) doesn't match your stated area` } };
}

function salaryScore(job, dna) {
  if (!dna.salary_min) return { points: 15, max: 30, reason: null }; // no stated floor, neutral

  if (job.salaryUGXPerMonth == null) return { points: 10, max: 30, reason: null };

  if (job.salaryUGXPerMonth >= dna.salary_min) {
    return { points: 30, max: 30, reason: { type: "positive", text: "Meets your stated salary floor" } };
  }
  const ratio = job.salaryUGXPerMonth / dna.salary_min;
  if (ratio >= 0.75) {
    return {
      points: 15,
      max: 30,
      reason: { type: "negative", text: "Below your floor, but close -- worth a look if it grows fast" },
    };
  }
  return { points: 0, max: 30, reason: { type: "negative", text: "Well below your stated salary floor" } };
}

function credentialScore(job, dna) {
  if (!job.requiresCertifiedTranscript) {
    return { points: 20, max: 20, reason: { type: "positive", text: "No certified transcript required" } };
  }
  if (dna.credential_status === "completed-verified") {
    return { points: 20, max: 20, reason: { type: "positive", text: "Requires a certified transcript -- you have yours" } };
  }
  if (dna.credential_status === "completed-transcript-pending") {
    return {
      points: 0,
      max: 20,
      reason: { type: "negative", text: "Requires a certified transcript, which you're still waiting on" },
    };
  }
  return { points: 10, max: 20, reason: null }; // unknown credential status, don't penalize hard
}

function categoryScore(job, dna) {
  if (!dna.category && !dna.preferred_category) return { points: 10, max: 20, reason: null };
  const wanted = (dna.category || dna.preferred_category || "").toLowerCase();
  if (job.category && job.category.toLowerCase() === wanted) {
    return { points: 20, max: 20, reason: { type: "positive", text: `Matches your interest in ${job.category}` } };
  }
  return { points: 8, max: 20, reason: null };
}

// Computes an overall 0-100 fit score plus separated positive/negative
// reasons, so the UI can show "why you fit" and "why you might not"
// without ever collapsing it into an unexplained single number.
export function computeFit(job, jobDNA = {}) {
  const dimensions = [
    locationScore(job, jobDNA),
    salaryScore(job, jobDNA),
    credentialScore(job, jobDNA),
    categoryScore(job, jobDNA),
  ];

  const totalPoints = dimensions.reduce((sum, d) => sum + d.points, 0);
  const totalMax = dimensions.reduce((sum, d) => sum + d.max, 0);
  const score = Math.round((totalPoints / totalMax) * 100);

  const positives = dimensions.filter((d) => d.reason?.type === "positive").map((d) => d.reason.text);
  const negatives = dimensions.filter((d) => d.reason?.type === "negative").map((d) => d.reason.text);

  return { score, positives, negatives };
}
