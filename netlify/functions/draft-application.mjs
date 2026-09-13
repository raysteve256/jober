// netlify/functions/draft-application.mjs
//
// The Application Layer, per the spec: the AI drafts, a human reviews
// and sends. Deliberately NOT an auto-apply/auto-submit tool -- that's
// now actively counterproductive, since employers are adding friction
// specifically to filter out AI-generated, high-volume applications
// (see the spec's Application Layer section). This function never
// submits anything anywhere; it only returns text for a person to
// read, edit, and send themselves.
//
// It also self-checks its own output for exactly the failure mode
// employers are now screening for: generic, templated, obviously-AI
// phrasing ("I am excited to apply...", "I believe I would be a great
// fit..."). This is a real, if imperfect, stand-in for the spec's
// "sounds human, not templated" pass.

import { callGeminiJSON } from "./_shared/gemini.mjs";

const SYSTEM_PROMPT = `You draft short, specific job application notes --
NOT formal cover letters. Think "a thoughtful two-paragraph message a
real person would actually send", not a template.

Rules:
- Reference at least one SPECIFIC, concrete detail from the
  candidate's background (from their bio/Job DNA) AND at least one
  SPECIFIC detail from the job (title, company, or stated
  requirements). Generic sentences that could apply to any job or any
  candidate are a failure, not a stylistic choice.
- Never use these generic-AI phrases or close variants of them: "I am
  excited to apply", "I believe I would be a great fit", "I am
  writing to express my interest", "I am confident that my skills",
  "passionate about". If the draft would otherwise need one of these,
  replace it with something specific to this candidate and this job
  instead.
- Keep it short: 2 short paragraphs, plain language, no bullet lists,
  no headers, no placeholder brackets like [Company Name] -- use the
  real name given.
- If the job requires a certified transcript and the candidate's
  credential_status is completed-transcript-pending, the draft should
  honestly and briefly acknowledge that (e.g. offering a completion
  letter in the meantime) rather than ignoring it or pretending it
  isn't a factor.

After drafting, self-check your own output honestly:
- soundsHuman: false if it contains any generic-AI phrase above, is
  vague enough to apply to any job, or reads as templated.
- atsSafe: false only if the draft itself contains formatting an ATS
  would mangle (tables, unusual unicode, bullet characters) -- plain
  prose is always safe.
- notes: one short honest sentence explaining any flag, or null if
  both checks pass.

Respond with ONLY valid JSON, no prose, no markdown fences:
{
  "draft": "the application note text",
  "selfCheck": { "soundsHuman": true|false, "atsSafe": true|false, "notes": "string or null" }
}`;

export default async (req, context) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const { job, jobDNA, bio } = await req.json();

    if (!job || !job.title || !job.company) {
      return new Response(
        JSON.stringify({ error: "Missing 'job' (needs at least title and company) in request body" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const userContent = `Candidate's Job DNA (structured facts already known about them):
${JSON.stringify(jobDNA ?? {}, null, 2)}

Candidate's own bio/background, in their own words (use this for concrete specifics):
"""${bio || "(no bio provided -- rely on Job DNA only, and keep the draft more general as a result)"}"""

The job to draft a note for:
${JSON.stringify(job, null, 2)}`;

    const result = await callGeminiJSON({
      apiKey: process.env.GEMINI_API_KEY,
      systemPrompt: SYSTEM_PROMPT,
      userContent,
    });

    if (!result.ok) {
      return new Response(
        JSON.stringify({ error: result.error, detail: result.detail, retriable: result.retriable }),
        { status: result.status, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify(result.data), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Unexpected server error", detail: String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
