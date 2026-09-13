// netlify/functions/_shared/gemini.mjs
//
// Shared, resilient Gemini caller -- factored out of reason.mjs so
// every function that talks to the Reasoning/Drafting model gets the
// same behavior: retry on genuinely short-lived transient errors,
// fail fast and clearly on everything else (bad key, daily quota
// exhaustion, etc.), and always return clean JSON or a message a
// normal user can actually understand.

const GEMINI_MODEL = "gemini-flash-latest";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const MAX_ATTEMPTS = 3;

// A 429 is not always the same kind of problem. Google's own error
// body distinguishes them via the QuotaFailure violation's quotaId
// and an explicit RetryInfo.retryDelay -- worth reading instead of
// treating every 429 as "wait a few seconds and retry", which is
// actively misleading for a per-day quota that won't clear for hours.
function classify429(parsedBody) {
  const details = parsedBody?.error?.details || [];
  const quotaFailure = details.find((d) => d["@type"]?.includes("QuotaFailure"));
  const retryInfo = details.find((d) => d["@type"]?.includes("RetryInfo"));

  const quotaId = quotaFailure?.violations?.[0]?.quotaId || "";
  const isDailyQuota = /PerDay/i.test(quotaId);

  let retryDelaySeconds = null;
  if (retryInfo?.retryDelay) {
    const match = String(retryInfo.retryDelay).match(/(\d+(\.\d+)?)/);
    if (match) retryDelaySeconds = parseFloat(match[1]);
  }

  // Treat anything Google says will take more than a few seconds to
  // clear as not worth retrying inside this request -- a serverless
  // function can't usefully sit and wait tens of seconds, and doing
  // so would just make the person's request hang instead of failing
  // clearly.
  const worthRetryingNow = !isDailyQuota && (retryDelaySeconds == null || retryDelaySeconds <= 5);

  return { isDailyQuota, retryDelaySeconds, worthRetryingNow };
}

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
  let quotaInfo = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    response = await fetch(GEMINI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: requestBody,
    });

    if (response.ok) break;

    lastErrText = await response.text();
    let parsedBody = null;
    try {
      parsedBody = JSON.parse(lastErrText);
    } catch {
      // non-JSON error body -- fall through, treated as non-retriable below
    }

    if (response.status === 503) {
      // Genuine transient overload -- Google doesn't give a specific
      // delay for this one, so a short fixed backoff is reasonable.
      if (attempt === MAX_ATTEMPTS) break;
      await new Promise((r) => setTimeout(r, 600 * attempt));
      continue;
    }

    if (response.status === 429) {
      quotaInfo = classify429(parsedBody);
      if (quotaInfo.worthRetryingNow && attempt < MAX_ATTEMPTS) {
        const waitMs = (quotaInfo.retryDelaySeconds ?? 1) * 1000;
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      break; // daily quota or a long delay -- not worth retrying now
    }

    break; // any other status -- not retriable
  }

  if (!response.ok) {
    let friendly;
    let retriable;

    if (response.status === 503) {
      friendly = "The AI model is temporarily overloaded on Google's side. This usually clears within a minute -- please try again.";
      retriable = true;
    } else if (response.status === 429 && quotaInfo?.isDailyQuota) {
      friendly = "This app has reached its daily AI usage limit on the free plan. Please try again after the quota resets, or let the site owner know it's time to raise the plan's limit.";
      retriable = false;
    } else if (response.status === 429) {
      const wait = quotaInfo?.retryDelaySeconds ? `about ${Math.ceil(quotaInfo.retryDelaySeconds)} seconds` : "a little while";
      friendly = `Too many requests right now. Please wait ${wait} and try again.`;
      retriable = true;
    } else {
      friendly = "Upstream API error";
      retriable = false;
    }

    return { ok: false, status: 502, error: friendly, detail: lastErrText, retriable };
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
