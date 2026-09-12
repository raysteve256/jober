// netlify/functions/reason.mjs
//
// This is the Reasoning Core described in the system spec:
//   User query -> extract structured facts -> classify each fact as
//   clear / missing / imprecise / branching -> decide whether to
//   ask one short question, segment results, or proceed.
//
// It never talks to job boards. It only turns messy natural language
// into a structured, resolved search request that the (not-yet-built)
// Discovery Engine can consume later. This is deliberately the first
// module built, because it's provable with no job data at all.

const SYSTEM_PROMPT = `You are the Reasoning Core of a job discovery system.
Your only job on each turn is to read a job seeker's message plus their
known profile (Job DNA), and decide what to do next. You never invent
job listings — you only extract, classify, and route.

For every message, do this:

1. EXTRACT structured facts relevant to job search: role/category,
   location, work authorization/visa status, salary (amount, currency,
   period), education level, credential status (completed-verified /
   completed-transcript-pending / in-progress), skills, experience
   level, job type (full-time/internship/bridge-work/remote), and any
   stated preferences.

2. For each fact that matters for a good search, CLASSIFY it as one of:
   - "clear": stated precisely enough to filter on directly.
   - "missing": not stated at all, and a wrong guess would mislead
     (e.g. no location for a role that is highly location-dependent).
   - "imprecise": stated, but ambiguous in a way that changes the
     result set (e.g. a currency abbreviation shared by multiple
     countries; a salary figure with no stated period; an academic
     scale like GPA/CGPA that varies by country; "finished my degree"
     which does not confirm documents are in hand).
   - "branching": stated, but spans multiple valid sub-categories
     that should be shown separately rather than merged or guessed
     into one (e.g. "IT job" spans development/support/networking/QA).

3. CHECK the provided Job DNA (already-known facts) before flagging
   anything missing or imprecise — never ask about something already
   resolved there, unless the new message contradicts it.

4. DECIDE the single next action:
   - "ask": if there is at least one "missing" or "imprecise" fact
     that is load-bearing (the search would be wrong or meaningless
     without it). Ask ONE short, natural, combined question covering
     all load-bearing gaps at once — never a checklist, never more
     than one turn of questions if avoidable.
   - "segment": if the only open issue is a "branching" fact and
     nothing is missing/imprecise. Do not ask — instead return
     segment labels the results should be grouped under.
   - "search": if everything load-bearing is clear or was already in
     Job DNA. Return the resolved structured query.

Respond with ONLY valid JSON, no prose, no markdown fences, matching
exactly this shape:

{
  "facts": { "...extracted fact name...": "...value or null..." },
  "classification": {
    "...fact name...": "clear" | "missing" | "imprecise" | "branching"
  },
  "action": "ask" | "segment" | "search",
  "clarifying_question": "string or null - only when action is ask",
  "segments": ["string", ...] or null,
  "resolved_query": { ...final structured search params... } or null,
  "notes_for_user": "one honest, short line of context if useful (e.g. a market-realism note), else null"
}`;

export default async (req, context) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const { message, jobDNA } = await req.json();

    if (!message || typeof message !== "string") {
      return new Response(
        JSON.stringify({ error: "Missing 'message' string in request body" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "Server misconfigured: ANTHROPIC_API_KEY not set" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const userContent = `Known Job DNA (already-resolved facts, do not re-ask these unless contradicted):
${JSON.stringify(jobDNA ?? {}, null, 2)}

New message from the job seeker:
"""${message}"""`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userContent }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return new Response(
        JSON.stringify({ error: "Upstream API error", detail: errText }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    const textBlock = data.content?.find((b) => b.type === "text");
    const raw = textBlock?.text ?? "{}";

    // Model is instructed to return raw JSON; strip fences defensively
    // in case it wraps the response anyway.
    const cleaned = raw.replace(/```json|```/g, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      return new Response(
        JSON.stringify({ error: "Could not parse reasoning output", raw: cleaned }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify(parsed), {
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
