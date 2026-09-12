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

  return (jobs || []).map((j) => {
    const r = responsivenessByEmployer[j.company];
    return {
      id: j.id,
      title: j.title,
      company: j.company,
      location: j.location,
      category: j.category,
      salaryUGXPerMonth: j.salary_amount,
      requiresCertifiedTranscript: j.requires_certified_transcript,
      meetsSalaryFloor: salary_min ? j.salary_amount >= salary_min : null,
      // fit score is a Matching & Scoring concern, not built yet --
      // placeholder until that module exists
      fit: null,
      trust: {
        status: j.trust_status,
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
