// netlify/functions/job-application-info.mjs
//
// On-demand (not scheduled) endpoint: given a job's source_url,
// fetches its real detail page and extracts full requirements plus
// application method. Called by the Application Layer before
// drafting, so drafts are grounded in the job's actual stated
// requirements instead of just title/company.

import { fetchApplicationInfo } from "./_shared/jobDetails.mjs";

export default async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const { sourceUrl } = await req.json();
    const result = await fetchApplicationInfo(sourceUrl);
    return new Response(JSON.stringify(result.data), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Unexpected error", detail: String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
