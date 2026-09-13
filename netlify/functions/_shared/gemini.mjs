// netlify/functions/_shared/gemini.mjs
//
// Shared, resilient Gemini caller -- factored out of reason.mjs so
// every function that talks to the Reasoning/Drafting model gets the
// same behavior: retry on transient overload/rate-limit, fail fast on
// real errors (bad key, etc.), and always return clean JSON or a
// clear, human-readable error.

const GEMINI_MODEL = "gemini-flash-latest";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const MAX_ATTEMPTS = 3;

// Returns { ok: true, data: <parsed JSON> } on success, or
// { ok: false, status, error, detail, retriable } on failure --
// callers turn this straight into a Response without needing to
// know anything about Gemini's wire format.
export async function callGeminiJSON({ apiKey, systemPrompt, userContent }) {
  if (!apiKey) {
    return { ok: false, status: 500, error: "Server misconfigured: GEMINI_API_KEY not set" };
  }

  const requestBody = JSON.stringify({
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: "user", parts: [{ text: userContent }] }],
    generationConfig: { responseMimeType: "application/json" },
  });

  let response;
  let lastErrText;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    response = await fetch(GEMINI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: requestBody,
    });

    if (response.ok) break;

    const isTransient = response.status === 503 || response.status === 429;
    lastErrText = await response.text();

    if (!isTransient || attempt === MAX_ATTEMPTS) break;

    await new Promise((r) => setTimeout(r, 600 * attempt));
  }

  if (!response.ok) {
    const friendly =
      response.status === 503
        ? "The AI model is temporarily overloaded on Google's side. This usually clears within a minute -- please try again."
        : response.status === 429
        ? "Too many requests right now. Please wait a few seconds and try again."
        : "Upstream API error";

    return {
      ok: false,
      status: 502,
      error: friendly,
      detail: lastErrText,
      retriable: response.status === 503 || response.status === 429,
    };
  }

  const data = await response.json();
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
  const cleaned = raw.replace(/```json|```/g, "").trim();

  try {
    return { ok: true, data: JSON.parse(cleaned) };
  } catch {
    return { ok: false, status: 502, error: "Could not parse model output", detail: cleaned };
  }
}
