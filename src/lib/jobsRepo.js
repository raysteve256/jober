// src/lib/jobsRepo.js
//
// Real Discovery/Trust-layer data access, replacing the earlier
// mockJobs.js in-memory array. Job listings and their trust signals
// now live in Supabase (see the `jobs` table); responsiveness comes
// from the crowdsourced `employer_responsiveness` view.
//
// The Discovery Engine itself (actually scraping BrighterMonday, Fuzu,
// company pages, etc.) is still a later build step -- this queries
// whatever is currently in the `jobs` table, which for now is the
// same four seeded rows the mock version used, so behavior is
// identical from the UI's point of view while the data source is real.

import { supabase } from "./supabaseClient";
import { computeFit } from "./scoring";
import { computeTrustStatus } from "./trustScoring";

export async function searchJobs(resolvedQuery = {}) {
  const { location, salary_min, category } = resolvedQuery;

  let query = supabase.from("jobs").select("*");

  if (location && /uganda|kampala|mukono/i.test(location)) {
    query = query.or("location.ilike.%Uganda%,location.ilike.%Remote%");
  }
  if (category) {
    query = query.eq("category", category);
  }

  const { data: jobs, error } = await query;
  if (error) throw error;

  const employers = [...new Set((jobs || []).map((j) => j.company))];
  let responsivenessByEmployer = {};

  if (employers.length > 0) {
    const { data: resp } = await supabase
      .from("employer_responsiveness")
      .select("*")
      .in("employer_name", employers);

    responsivenessByEmployer = Object.fromEntries(
      (resp || []).map((r) => [r.employer_name, r])
    );
  }

  const scored = (jobs || []).map((j) => {
    const r = responsivenessByEmployer[j.company];
    const jobForScoring = {
      title: j.title,
      location: j.location,
      salaryUGXPerMonth: j.salary_amount,
      requiresCertifiedTranscript: j.requires_certified_transcript,
      category: j.category,
    };
    const { score, positives, negatives } = computeFit(jobForScoring, resolvedQuery);
    const trust = computeTrustStatus(j);

    return {
      id: j.id,
      title: j.title,
      company: j.company,
      location: j.location,
      category: j.category,
      salaryUGXPerMonth: j.salary_amount,
      requiresCertifiedTranscript: j.requires_certified_transcript,
      sourceUrl: j.source_url,
      meetsSalaryFloor: salary_min ? j.salary_amount >= salary_min : null,
      fit: score,
      fitPositives: positives,
      fitNegatives: negatives,
      trust: {
        status: trust.status,
        reason: trust.reason,
        lastVerifiedAt: j.last_verified_at,
        daysUnchanged: j.days_unchanged,
      },
      responsiveness: r
        ? {
            responseRatePct: r.response_rate_pct,
            avgResponseDays: r.avg_response_days,
            totalLogged: r.total_logged,
          }
        : { responseRatePct: null, avgResponseDays: null, totalLogged: 0 },
    };
  });

  // Highest fit first -- the point of scoring is to surface what's
  // actually worth the person's attention, not just list everything.
  return scored.sort((a, b) => b.fit - a.fit);
}

// Lets a user submit a listing they found elsewhere (BrighterMonday,
// a WhatsApp group, a company page) -- the Discovery Engine's first
// real source, covering exactly the informal channels no scraper can
// reach. Deliberately never sends trust_status -- it always starts
// 'unverified' regardless of what the submitter believes, since a
// user submission is not self-certifying (see the migration comment).
export async function submitJob({
  userId,
  title,
  company,
  location,
  category,
  salaryAmount,
  salaryPeriod,
  requiresCertifiedTranscript,
  sourceUrl,
}) {
  const { error } = await supabase.from("jobs").insert({
    submitted_by: userId,
    title,
    company,
    location: location || null,
    category: category || null,
    salary_amount: salaryAmount || null,
    salary_currency: salaryAmount ? "UGX" : null,
    salary_period: salaryPeriod || null,
    requires_certified_transcript: !!requiresCertifiedTranscript,
    source_url: sourceUrl || null,
    posted_at: new Date().toISOString(),
    // trust_status intentionally omitted -- DB default 'unverified' applies
  });
  if (error) throw error;
}

// Fetches everything the current user has logged an outcome for,
// joined with the job's real details -- the data source for the
// Tracked view. RLS already scopes application_outcomes to the
// querying user, but filtering by userId explicitly here too keeps
// the intent obvious rather than relying on RLS silently doing it.
export async function getTrackedOutcomes(userId) {
  const { data, error } = await supabase
    .from("application_outcomes")
    .select("id, outcome, response_days, created_at, jobs(id, title, company, location, category)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw error;

  return (data || [])
    .filter((row) => row.jobs) // guard against a job that was later deleted
    .map((row) => ({
      outcomeId: row.id,
      outcome: row.outcome,
      responseDays: row.response_days,
      loggedAt: row.created_at,
      job: row.jobs,
    }));
}

// Lets a user log a real outcome, which feeds the crowdsourced
// Employer Responsiveness Score for everyone -- the Learning Loop
// mechanism from the spec, now backed by a real table.
export async function logApplicationOutcome({ userId, jobId, employerName, outcome, responseDays }) {
  const { error } = await supabase.from("application_outcomes").insert({
    user_id: userId,
    job_id: jobId,
    employer_name: employerName,
    outcome,
    response_days: responseDays ?? null,
  });
  if (error) throw error;
}
