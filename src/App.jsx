import { useEffect, useRef, useState } from "react";
import { getJobDNA, mergeJobDNA, logMessage, getHistory } from "./lib/jobDNA";
import { searchJobs, logApplicationOutcome, submitJob, getTrackedOutcomes } from "./lib/jobsRepo";
import { getCurrentUserId } from "./lib/supabaseClient";
import { checkAtsSafety } from "./lib/atsCheck";
import { CATEGORIES } from "./lib/parseHelpers";

// --- Small icon components, all grounded in the field-journal / -----
// --- expedition metaphor: a compass for orientation, a wax-seal ------
// --- stamp for verification, a rejection stamp for ghost risk. -------

function CompassRose({ className = "", spinning = false }) {
  return (
    <svg
      viewBox="0 0 48 48"
      className={className}
      fill="none"
      aria-hidden="true"
    >
      <circle cx="24" cy="24" r="20" stroke="var(--ink)" strokeWidth="1.2" />
      <circle cx="24" cy="24" r="15.5" stroke="var(--brass-line)" strokeWidth="0.8" />
      {[0, 90, 180, 270].map((deg) => (
        <line
          key={deg}
          x1="24"
          y1="4"
          x2="24"
          y2="8"
          stroke="var(--ink)"
          strokeWidth="1"
          transform={`rotate(${deg} 24 24)`}
        />
      ))}
      <g className={spinning ? "needle-scan" : ""}>
        <path d="M24 10 L28 24 L24 38 L20 24 Z" fill="var(--brass)" />
        <path d="M24 10 L28 24 L24 24 Z" fill="var(--ink)" />
        <path d="M24 38 L20 24 L24 24 Z" fill="var(--ink)" />
      </g>
      <circle cx="24" cy="24" r="2" fill="var(--ink)" />
    </svg>
  );
}

function VerifiedSeal({ label = "Verified" }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium -rotate-2"
      style={{
        borderColor: "var(--seal-verified)",
        color: "var(--seal-verified)",
        background: "var(--seal-verified-bg)",
      }}
    >
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
        <path d="M1 5.2 L4 8 L9 1.5" stroke="currentColor" strokeWidth="1.4" fill="none" />
      </svg>
      {label}
    </span>
  );
}

function GhostStamp({ label = "Ghost risk" }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-sm border-2 px-2 py-0.5 text-xs font-semibold rotate-2 tracking-wide"
      style={{
        borderColor: "var(--stamp-ghost)",
        color: "var(--stamp-ghost)",
        background: "var(--stamp-ghost-bg)",
      }}
    >
      {label}
    </span>
  );
}

function UnverifiedTag({ label = "Unverified" }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
      style={{ borderColor: "var(--ink-soft)", color: "var(--ink-soft)" }}
    >
      {label}
    </span>
  );
}

function TrustMark({ trust }) {
  if (trust.status === "verified") return <VerifiedSeal label="Verified" />;
  if (trust.status === "probably_active") return <VerifiedSeal label="Likely active" />;
  if (trust.status === "ghost_risk") return <GhostStamp label="Ghost risk" />;
  if (trust.status === "closed") return <GhostStamp label="Closed" />;
  if (trust.status === "stale") return <UnverifiedTag label="Stale" />;
  return <UnverifiedTag label="Unverified" />;
}

// A small dial gauge for responsiveness, instead of a generic badge --
// this is meant to read like an instrument reading, since the whole
// point of the Trust Layer is "treat this like real telemetry."
function ResponsivenessDial({ responsiveness }) {
  const pct = responsiveness.responseRatePct;
  if (!responsiveness.totalLogged || pct == null) {
    return (
      <div className="flex items-center gap-1.5 text-xs" style={{ color: "var(--ink-soft)" }}>
        <svg width="20" height="12" viewBox="0 0 20 12" aria-hidden="true">
          <path d="M1 11 A9 9 0 0 1 19 11" fill="none" stroke="var(--ink-soft)" strokeWidth="1.5" strokeDasharray="2 2" />
        </svg>
        <span>no signal yet</span>
      </div>
    );
  }

  const angle = (pct / 100) * 180;
  const rad = (Math.PI / 180) * (180 - angle);
  const x = 10 + 9 * Math.cos(rad);
  const y = 11 - 9 * Math.sin(rad);
  const color = pct >= 60 ? "var(--seal-verified)" : pct >= 30 ? "var(--brass)" : "var(--stamp-ghost)";

  return (
    <div className="flex items-center gap-1.5 font-data text-xs" style={{ color }}>
      <svg width="20" height="12" viewBox="0 0 20 12" aria-hidden="true">
        <path d="M1 11 A9 9 0 0 1 19 11" fill="none" stroke="var(--paper-deep)" strokeWidth="2" />
        <path
          d={`M1 11 A9 9 0 0 1 ${x} ${y}`}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
      <span>{pct}% reply{responsiveness.avgResponseDays ? ` · ~${Math.round(responsiveness.avgResponseDays)}d` : ""}</span>
    </div>
  );
}

function FitBadge({ fit }) {
  if (fit == null) return null;
  const color = fit >= 80 ? "var(--seal-verified)" : fit >= 55 ? "var(--brass)" : "var(--stamp-ghost)";
  return (
    <span
      className="font-data whitespace-nowrap rounded-full border px-2 py-0.5 text-xs"
      style={{ borderColor: color, color }}
    >
      {fit} fit
    </span>
  );
}

function OutcomeLogger({ job }) {
  const [logged, setLogged] = useState(null); // 'replied' | 'ghosted' | 'interviewed' | null
  const [busy, setBusy] = useState(false);

  async function log(outcome) {
    if (busy || logged) return;
    setBusy(true);
    try {
      const userId = await getCurrentUserId();
      await logApplicationOutcome({ userId, jobId: job.id, employerName: job.company, outcome });
      setLogged(outcome);
    } catch (err) {
      console.warn("Could not log outcome:", err.message);
    } finally {
      setBusy(false);
    }
  }

  if (logged) {
    return (
      <p className="mt-2.5 text-xs italic" style={{ color: "var(--ink-soft)" }}>
        Logged as {logged} — thanks, this helps future search results for everyone.
      </p>
    );
  }

  return (
    <div className="mt-2.5 flex items-center gap-3 border-t pt-2" style={{ borderColor: "var(--brass-line)" }}>
      <span className="text-[11px]" style={{ color: "var(--ink-soft)" }}>Applied? Log what happened:</span>
      <button onClick={() => log("replied")} disabled={busy} className="text-xs underline" style={{ color: "var(--seal-verified)" }}>
        Replied
      </button>
      <button onClick={() => log("interviewed")} disabled={busy} className="text-xs underline" style={{ color: "var(--seal-verified)" }}>
        Interview
      </button>
      <button onClick={() => log("ghosted")} disabled={busy} className="text-xs underline" style={{ color: "var(--stamp-ghost)" }}>
        Ghosted
      </button>
    </div>
  );
}

function ApplicationDrafter({ job, jobDNA, onBioSaved }) {
  const [stage, setStage] = useState("idle"); // idle | need-bio | drafting | drafted | error
  const [bioInput, setBioInput] = useState("");
  const [draft, setDraft] = useState("");
  const [modelCheck, setModelCheck] = useState(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(null);

  const atsResult = draft ? checkAtsSafety(draft) : null;

  async function runDraft(bio) {
    setStage("drafting");
    setError(null);
    try {
      const res = await fetch("/.netlify/functions/draft-application", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job: {
            title: job.title,
            company: job.company,
            location: job.location,
            requiresCertifiedTranscript: job.requiresCertifiedTranscript,
          },
          jobDNA,
          bio,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);

      setDraft(body.draft || "");
      setModelCheck(body.selfCheck || null);
      setStage("drafted");
    } catch (err) {
      setError(err.message);
      setStage("error");
    }
  }

  function start() {
    if (jobDNA.bio) {
      runDraft(jobDNA.bio);
    } else {
      setStage("need-bio");
    }
  }

  async function saveBioAndDraft() {
    const bio = bioInput.trim();
    if (!bio) return;
    await onBioSaved(bio);
    runDraft(bio);
  }

  function copyDraft() {
    navigator.clipboard?.writeText(draft);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (stage === "idle") {
    return (
      <button
        onClick={start}
        className="mt-2 text-xs underline"
        style={{ color: "var(--brass)" }}
      >
        Draft an application note
      </button>
    );
  }

  if (stage === "need-bio") {
    return (
      <div className="mt-2 space-y-1.5 border-t pt-2" style={{ borderColor: "var(--brass-line)" }}>
        <p className="text-xs" style={{ color: "var(--ink-soft)" }}>
          First, a short bio so drafts can reference something real about you (saved for next time):
        </p>
        <textarea
          className="w-full rounded-sm border px-2 py-1.5 text-xs"
          style={{ borderColor: "var(--brass-line)", background: "#fbf8ef", color: "var(--ink)" }}
          rows={2}
          placeholder="e.g. Wrote Appium test suites for a fintech app for the past year, comfortable with Java and SQL"
          value={bioInput}
          onChange={(e) => setBioInput(e.target.value)}
        />
        <button
          onClick={saveBioAndDraft}
          className="rounded-full border px-2.5 py-1 text-xs font-medium"
          style={{ borderColor: "var(--ink)", color: "var(--ink)" }}
        >
          Save and draft
        </button>
      </div>
    );
  }

  if (stage === "drafting") {
    return (
      <p className="mt-2 text-xs italic" style={{ color: "var(--ink-soft)" }}>
        Drafting…
      </p>
    );
  }

  if (stage === "error") {
    return (
      <div className="mt-2 border-t pt-2" style={{ borderColor: "var(--brass-line)" }}>
        <p className="text-xs" style={{ color: "var(--stamp-ghost)" }}>{error}</p>
        <button onClick={start} className="mt-1 text-xs underline" style={{ color: "var(--ink-soft)" }}>
          Try again
        </button>
      </div>
    );
  }

  // drafted
  return (
    <div className="mt-2 space-y-2 border-t pt-2" style={{ borderColor: "var(--brass-line)" }}>
      <textarea
        className="w-full rounded-sm border px-2 py-1.5 text-xs"
        style={{ borderColor: "var(--brass-line)", background: "#fbf8ef", color: "var(--ink)" }}
        rows={5}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />

      <div className="flex flex-wrap gap-1.5">
        {modelCheck && !modelCheck.soundsHuman && (
          <span className="rounded-full px-2 py-0.5 text-[11px]" style={{ background: "var(--stamp-ghost-bg)", color: "var(--stamp-ghost)" }}>
            Reads as generic -- edit before sending
          </span>
        )}
        {atsResult && !atsResult.safe && (
          <span className="rounded-full px-2 py-0.5 text-[11px]" style={{ background: "var(--stamp-ghost-bg)", color: "var(--stamp-ghost)" }}>
            ATS formatting risk
          </span>
        )}
        {modelCheck?.soundsHuman && atsResult?.safe && (
          <span className="rounded-full px-2 py-0.5 text-[11px]" style={{ background: "var(--seal-verified-bg)", color: "var(--seal-verified)" }}>
            Reads naturally, ATS-safe
          </span>
        )}
      </div>

      {(modelCheck?.notes || atsResult?.warnings.length > 0) && (
        <div className="space-y-0.5">
          {modelCheck?.notes && (
            <p className="text-[11px] italic" style={{ color: "var(--ink-soft)" }}>{modelCheck.notes}</p>
          )}
          {atsResult?.warnings.map((w, i) => (
            <p key={i} className="text-[11px] italic" style={{ color: "var(--ink-soft)" }}>{w}</p>
          ))}
        </div>
      )}

      <p className="text-[11px] italic" style={{ color: "var(--ink-soft)" }}>
        Read this before sending -- edit anything that doesn't sound like you. Nothing is sent automatically.
      </p>

      <button
        onClick={copyDraft}
        className="rounded-full border px-2.5 py-1 text-xs font-medium"
        style={{ borderColor: "var(--ink)", color: "var(--ink)" }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function FieldCard({ job, jobDNA, onBioSaved }) {
  const [showWhy, setShowWhy] = useState(false);
  const hasReasons = (job.fitPositives?.length || 0) + (job.fitNegatives?.length || 0) > 0;

  return (
    <div
      className="rounded-sm border p-3.5 shadow-sm"
      style={{ borderColor: "var(--brass-line)", background: "var(--paper-deep)" }}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-display text-[15px] leading-snug" style={{ color: "var(--ink)" }}>
            {job.title}
          </p>
          <p className="text-xs" style={{ color: "var(--ink-soft)" }}>
            {job.company} — {job.location}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <TrustMark trust={job.trust} />
          <FitBadge fit={job.fit} />
        </div>
      </div>

      {job.trust.reason && (
        <p className="mt-1 text-[11px] italic" style={{ color: "var(--ink-soft)" }}>
          {job.trust.reason}
        </p>
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <ResponsivenessDial responsiveness={job.responsiveness} />
        {job.requiresCertifiedTranscript && (
          <span className="text-xs" style={{ color: "var(--brass)" }}>
            ✎ certified transcript required
          </span>
        )}
      </div>

      <p className="font-data mt-2 text-xs" style={{ color: "var(--ink-soft)" }}>
        UGX {job.salaryUGXPerMonth.toLocaleString()}/mo
        {job.meetsSalaryFloor === true && "  ·  meets your floor"}
        {job.meetsSalaryFloor === false && "  ·  below your stated floor"}
      </p>

      {hasReasons && (
        <div className="mt-2">
          <button
            onClick={() => setShowWhy((v) => !v)}
            className="text-xs underline"
            style={{ color: "var(--ink-soft)" }}
          >
            {showWhy ? "Hide" : "Why this fit?"}
          </button>
          {showWhy && (
            <div className="mt-1.5 space-y-1">
              {job.fitPositives?.map((p, i) => (
                <p key={"p" + i} className="text-xs" style={{ color: "var(--seal-verified)" }}>
                  + {p}
                </p>
              ))}
              {job.fitNegatives?.map((n, i) => (
                <p key={"n" + i} className="text-xs" style={{ color: "var(--stamp-ghost)" }}>
                  − {n}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      <ApplicationDrafter job={job} jobDNA={jobDNA} onBioSaved={onBioSaved} />
      <OutcomeLogger job={job} />
    </div>
  );
}

function categoryLabel(slug) {
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function SubmitJobForm({ onSubmitted, onCancel }) {
  const [fields, setFields] = useState({
    title: "",
    company: "",
    location: "",
    category: "other",
    salaryAmount: "",
    salaryPeriod: "monthly",
    requiresCertifiedTranscript: false,
    sourceUrl: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const inputStyle = {
    borderColor: "var(--brass-line)",
    background: "#fbf8ef",
    color: "var(--ink)",
  };
  const labelStyle = { color: "var(--ink-soft)" };

  async function handleSubmit(e) {
    e.preventDefault();
    if (!fields.title.trim() || !fields.company.trim()) {
      setErr("Title and company are required.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const userId = await getCurrentUserId();
      await submitJob({
        userId,
        title: fields.title.trim(),
        company: fields.company.trim(),
        location: fields.location.trim(),
        category: fields.category,
        salaryAmount: fields.salaryAmount ? Number(fields.salaryAmount) : null,
        salaryPeriod: fields.salaryPeriod,
        requiresCertifiedTranscript: fields.requiresCertifiedTranscript,
        sourceUrl: fields.sourceUrl.trim(),
      });
      onSubmitted();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-2 rounded-sm border p-3"
      style={{ borderColor: "var(--brass-line)", background: "var(--paper-deep)" }}
    >
      <p className="font-display text-sm" style={{ color: "var(--ink)" }}>
        Add a listing you found
      </p>
      <p className="text-[11px] italic" style={{ color: "var(--ink-soft)" }}>
        Found something on BrighterMonday, WhatsApp, or a company page? Add it to the shared board --
        it starts unverified until confirmed.
      </p>

      <input
        className="w-full rounded-sm border px-2 py-1.5 text-sm"
        style={inputStyle}
        placeholder="Job title *"
        value={fields.title}
        onChange={(e) => setFields((f) => ({ ...f, title: e.target.value }))}
      />
      <input
        className="w-full rounded-sm border px-2 py-1.5 text-sm"
        style={inputStyle}
        placeholder="Company *"
        value={fields.company}
        onChange={(e) => setFields((f) => ({ ...f, company: e.target.value }))}
      />
      <input
        className="w-full rounded-sm border px-2 py-1.5 text-sm"
        style={inputStyle}
        placeholder="Location (e.g. Kampala, Uganda / Remote)"
        value={fields.location}
        onChange={(e) => setFields((f) => ({ ...f, location: e.target.value }))}
      />

      <div className="flex gap-2">
        <select
          className="flex-1 rounded-sm border px-2 py-1.5 text-sm"
          style={inputStyle}
          value={fields.category}
          onChange={(e) => setFields((f) => ({ ...f, category: e.target.value }))}
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{categoryLabel(c)}</option>
          ))}
        </select>
        <input
          className="w-28 rounded-sm border px-2 py-1.5 text-sm"
          style={inputStyle}
          placeholder="Salary UGX"
          inputMode="numeric"
          value={fields.salaryAmount}
          onChange={(e) => setFields((f) => ({ ...f, salaryAmount: e.target.value }))}
        />
        <select
          className="rounded-sm border px-2 py-1.5 text-sm"
          style={inputStyle}
          value={fields.salaryPeriod}
          onChange={(e) => setFields((f) => ({ ...f, salaryPeriod: e.target.value }))}
        >
          <option value="monthly">/mo</option>
          <option value="annual">/yr</option>
        </select>
      </div>

      <input
        className="w-full rounded-sm border px-2 py-1.5 text-sm"
        style={inputStyle}
        placeholder="Link to the original listing (optional)"
        value={fields.sourceUrl}
        onChange={(e) => setFields((f) => ({ ...f, sourceUrl: e.target.value }))}
      />

      <label className="flex items-center gap-1.5 text-xs" style={labelStyle}>
        <input
          type="checkbox"
          checked={fields.requiresCertifiedTranscript}
          onChange={(e) => setFields((f) => ({ ...f, requiresCertifiedTranscript: e.target.checked }))}
        />
        Requires a certified transcript to apply
      </label>

      {err && <p className="text-xs" style={{ color: "var(--stamp-ghost)" }}>{err}</p>}

      <div className="flex gap-2 pt-1">
        <button
          type="submit"
          disabled={busy}
          className="rounded-full border px-3 py-1 text-xs font-medium disabled:opacity-50"
          style={{ borderColor: "var(--ink)", color: "var(--ink)" }}
        >
          {busy ? "Adding..." : "Add to shared board"}
        </button>
        <button type="button" onClick={onCancel} className="text-xs underline" style={labelStyle}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function BrowseView({ jobDNA, onBioSaved }) {
  const [category, setCategory] = useState("");
  const [location, setLocation] = useState("");
  const [jobs, setJobs] = useState(null); // null = not loaded yet
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const results = await searchJobs({
        ...jobDNA,
        category: category || jobDNA.category,
        location: location || jobDNA.location,
      });
      setJobs(results);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex-1 space-y-3.5 overflow-y-auto px-4 py-4">
      <p className="font-display text-sm" style={{ color: "var(--ink)" }}>
        Everything in the log
      </p>

      <div className="flex gap-2">
        <select
          className="flex-1 rounded-sm border px-2 py-1.5 text-sm"
          style={{ borderColor: "var(--brass-line)", background: "#fbf8ef", color: "var(--ink)" }}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{categoryLabel(c)}</option>
          ))}
        </select>
        <input
          className="flex-1 rounded-sm border px-2 py-1.5 text-sm"
          style={{ borderColor: "var(--brass-line)", background: "#fbf8ef", color: "var(--ink)" }}
          placeholder="Location"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
        />
        <button
          onClick={load}
          className="rounded-sm border px-3 py-1.5 text-sm"
          style={{ borderColor: "var(--ink)", color: "var(--ink)" }}
        >
          Filter
        </button>
      </div>

      {loading && (
        <div className="flex items-center gap-2 pl-1">
          <CompassRose className="h-6 w-6" spinning />
          <span className="font-display italic text-sm" style={{ color: "var(--ink-soft)" }}>
            scanning the log…
          </span>
        </div>
      )}

      {error && (
        <p className="border-l-2 pl-3 py-1 text-xs" style={{ borderColor: "var(--stamp-ghost)", color: "var(--stamp-ghost)" }}>
          {error}
        </p>
      )}

      {jobs && jobs.length === 0 && !loading && (
        <p className="font-display italic text-sm py-2" style={{ color: "var(--ink-soft)" }}>
          Nothing matches those filters yet.
        </p>
      )}

      {jobs && jobs.length > 0 && (
        <div className="space-y-2">
          {jobs.map((j) => (
            <FieldCard key={j.id} job={j} jobDNA={jobDNA} onBioSaved={onBioSaved} />
          ))}
        </div>
      )}
    </div>
  );
}

function outcomeLabel(outcome) {
  if (outcome === "replied") return "Replied";
  if (outcome === "interviewed") return "Interview";
  if (outcome === "offered") return "Offered";
  if (outcome === "rejected") return "Rejected";
  if (outcome === "ghosted") return "Ghosted";
  return outcome;
}

function outcomeIsPositive(outcome) {
  return outcome === "replied" || outcome === "interviewed" || outcome === "offered";
}

function TrackedView() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const userId = await getCurrentUserId();
        const tracked = await getTrackedOutcomes(userId);
        setRows(tracked);
      } catch (err) {
        setError(err.message);
      }
    })();
  }, []);

  return (
    <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
      <p className="font-display text-sm" style={{ color: "var(--ink)" }}>
        What you've logged
      </p>

      {error && (
        <p className="border-l-2 pl-3 py-1 text-xs" style={{ borderColor: "var(--stamp-ghost)", color: "var(--stamp-ghost)" }}>
          {error}
        </p>
      )}

      {rows === null && !error && (
        <p className="font-display italic text-sm" style={{ color: "var(--ink-soft)" }}>Loading…</p>
      )}

      {rows && rows.length === 0 && (
        <p className="font-display italic text-sm py-2" style={{ color: "var(--ink-soft)" }}>
          Nothing logged yet -- use "Applied? Log what happened" on a result card once you hear
          back (or don't) from somewhere. It helps everyone else too.
        </p>
      )}

      {rows && rows.length > 0 && (
        <div className="space-y-2">
          {rows.map((r) => (
            <div
              key={r.outcomeId}
              className="rounded-sm border p-3"
              style={{ borderColor: "var(--brass-line)", background: "var(--paper-deep)" }}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-display text-[15px]" style={{ color: "var(--ink)" }}>{r.job.title}</p>
                  <p className="text-xs" style={{ color: "var(--ink-soft)" }}>{r.job.company} — {r.job.location}</p>
                </div>
                <span
                  className="whitespace-nowrap rounded-full border px-2 py-0.5 text-xs"
                  style={
                    outcomeIsPositive(r.outcome)
                      ? { borderColor: "var(--seal-verified)", color: "var(--seal-verified)", background: "var(--seal-verified-bg)" }
                      : { borderColor: "var(--stamp-ghost)", color: "var(--stamp-ghost)", background: "var(--stamp-ghost-bg)" }
                  }
                >
                  {outcomeLabel(r.outcome)}
                </span>
              </div>
              <p className="mt-1.5 text-[11px]" style={{ color: "var(--ink-soft)" }}>
                Logged {new Date(r.loggedAt).toLocaleDateString()}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NavIcon({ type }) {
  const common = { width: 20, height: 20, viewBox: "0 0 20 20", fill: "none", "aria-hidden": true };
  if (type === "search") {
    return (
      <svg {...common}>
        <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.4" />
        <line x1="13.5" y1="13.5" x2="18" y2="18" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    );
  }
  if (type === "browse") {
    return (
      <svg {...common}>
        <rect x="2.5" y="3" width="15" height="3.2" rx="0.6" stroke="currentColor" strokeWidth="1.3" />
        <rect x="2.5" y="8.4" width="15" height="3.2" rx="0.6" stroke="currentColor" strokeWidth="1.3" />
        <rect x="2.5" y="13.8" width="15" height="3.2" rx="0.6" stroke="currentColor" strokeWidth="1.3" />
      </svg>
    );
  }
  // tracked
  return (
    <svg {...common}>
      <path d="M4 2.5h9l3 3v12h-12z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M6.5 9.5 L9 12 L14 6.5" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function BottomNav({ view, setView }) {
  const tabs = [
    { id: "search", label: "Search" },
    { id: "browse", label: "Browse" },
    { id: "tracked", label: "Tracked" },
  ];
  return (
    <nav
      className="flex border-t-2"
      style={{ borderColor: "var(--ink)", background: "var(--paper-deep)" }}
    >
      {tabs.map((t) => {
        const active = view === t.id;
        return (
          <button
            key={t.id}
            onClick={() => setView(t.id)}
            className="flex flex-1 flex-col items-center gap-0.5 py-2"
            style={{ color: active ? "var(--ink)" : "var(--ink-soft)" }}
          >
            <NavIcon type={t.id} />
            <span className="text-[10px]" style={{ fontWeight: active ? 600 : 400 }}>{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

function ValueProp({ icon, children }) {
  return (
    <div className="flex items-start gap-2.5">
      <div className="mt-0.5 shrink-0" style={{ color: "var(--brass)" }}>{icon}</div>
      <p className="text-sm leading-snug" style={{ color: "var(--ink)" }}>{children}</p>
    </div>
  );
}

function WelcomeScreen({ onBegin }) {
  return (
    <div className="mx-auto flex h-dvh max-w-md flex-col paper-grain">
      <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
        <CompassRose className="h-16 w-16" />

        <h1 className="font-display mt-4 text-3xl" style={{ color: "var(--ink)" }}>
          Field Notes
        </h1>
        <p className="mt-1.5 text-sm italic" style={{ color: "var(--ink-soft)" }}>
          your job discovery log
        </p>

        <p className="mt-6 text-sm leading-relaxed" style={{ color: "var(--ink)" }}>
          Most job platforms race to show you more listings. This one asks what you actually
          need, then tells you honestly which ones are worth your time.
        </p>

        <div className="mt-7 w-full space-y-4 text-left">
          <ValueProp
            icon={
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                <path d="M3 5.5 L9 2 L15 5.5 V12.5 L9 16 L3 12.5 Z" stroke="currentColor" strokeWidth="1.3" />
                <path d="M6.5 9 L8.3 11 L12 6.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            }
          >
            Every listing carries a real trust mark — verified, likely active, or flagged as
            ghost risk — not just a match score.
          </ValueProp>
          <ValueProp
            icon={
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                <circle cx="9" cy="9" r="7" stroke="currentColor" strokeWidth="1.3" />
                <path d="M9 5 v4.5 l3 2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            }
          >
            Asks one honest question when it needs to, remembers the answer, and never asks
            again.
          </ValueProp>
          <ValueProp
            icon={
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                <path d="M2 9 L11 9 M7 5 L11 9 L7 13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M13 5.5 v7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            }
          >
            Drafts an application when asked — you read it, edit it, send it yourself. Nothing
            is ever submitted for you.
          </ValueProp>
        </div>
      </div>

      <div className="px-8 pb-8">
        <button
          onClick={onBegin}
          className="w-full rounded-full border-2 py-2.5 text-sm font-medium"
          style={{ borderColor: "var(--ink)", color: "var(--ink)", background: "var(--paper-deep)" }}
        >
          Begin
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const [chat, setChat] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [jobDNA, setJobDNA] = useState({});
  const [error, setError] = useState(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    getJobDNA().then((dna) => {
      setJobDNA(dna);
      setShowWelcome(!dna.onboarded);
    });
    getHistory().then((rows) => {
      setChat(rows.map((r) => ({ role: r.role, text: r.content })));
    });
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat, loading]);

  const [retryTarget, setRetryTarget] = useState(null); // { message, retriable }
  const [showSubmitForm, setShowSubmitForm] = useState(false);
  const [view, setView] = useState("search"); // search | browse | tracked
  const [showWelcome, setShowWelcome] = useState(false);

  async function sendMessage(message, { appendUserBubble = true } = {}) {
    if (!message || loading) return;

    setError(null);
    setRetryTarget(null);
    if (appendUserBubble) {
      setChat((c) => [...c, { role: "user", text: message }]);
      logMessage("user", message);
    }
    setLoading(true);

    try {
      const res = await fetch("/.netlify/functions/reason", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, jobDNA }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const detail = body.detail ? ` — ${body.detail}` : "";
        const err = new Error((body.error || `Request failed (${res.status})`) + detail);
        err.retriable = !!body.retriable;
        throw err;
      }

      const result = await res.json();
      const merged = await mergeJobDNA(result.facts || {});
      setJobDNA(merged);

      if (result.action === "ask") {
        setChat((c) => [...c, { role: "assistant", text: result.clarifying_question }]);
        logMessage("assistant", result.clarifying_question);
      } else if (result.action === "segment") {
        const jobs = await searchJobs(result.resolved_query || merged);
        setChat((c) => [
          ...c,
          { role: "results", segments: result.segments, jobs, note: result.notes_for_user },
        ]);
      } else {
        const jobs = await searchJobs(result.resolved_query || merged);
        setChat((c) => [
          ...c,
          { role: "results", segments: null, jobs, note: result.notes_for_user },
        ]);
      }
    } catch (err) {
      setError(err.message);
      if (err.retriable) setRetryTarget({ message });
    } finally {
      setLoading(false);
    }
  }

  function send() {
    const message = input.trim();
    if (!message) return;
    setInput("");
    sendMessage(message, { appendUserBubble: true });
  }

  function retry() {
    if (retryTarget) sendMessage(retryTarget.message, { appendUserBubble: false });
  }

  function begin() {
    setShowWelcome(false);
    mergeJobDNA({ onboarded: true }).then(setJobDNA);
  }

  if (showWelcome) {
    return <WelcomeScreen onBegin={begin} />;
  }

  return (
    <div className="mx-auto flex h-dvh max-w-md flex-col paper-grain">
      <header
        className="border-b-2 px-4 pb-3 pt-4"
        style={{ borderColor: "var(--ink)", background: "var(--paper-deep)" }}
      >
        <div className="flex items-center gap-2.5">
          <CompassRose className="h-8 w-8 shrink-0" />
          <div>
            <h1 className="font-display text-lg leading-none" style={{ color: "var(--ink)" }}>
              Field Notes
            </h1>
            <p className="mt-0.5 text-[11px]" style={{ color: "var(--ink-soft)" }}>
              your job discovery log
            </p>
          </div>
        </div>
      </header>

      {view === "search" && (
      <main className="flex-1 space-y-3.5 overflow-y-auto px-4 py-4">
        <div className="flex justify-end">
          <button
            onClick={() => setShowSubmitForm((v) => !v)}
            className="text-[11px] underline"
            style={{ color: "var(--brass)" }}
          >
            {showSubmitForm ? "Close" : "+ Add a listing you found"}
          </button>
        </div>

        {showSubmitForm && (
          <SubmitJobForm
            onCancel={() => setShowSubmitForm(false)}
            onSubmitted={() => {
              setShowSubmitForm(false);
              setChat((c) => [
                ...c,
                {
                  role: "assistant",
                  text: "Added to the shared board, marked unverified until confirmed -- thanks, this helps other job seekers too.",
                },
              ]);
            }}
          />
        )}

        {chat.length === 0 && (
          <div
            className="mt-6 rounded-sm border border-dashed p-4 text-center"
            style={{ borderColor: "var(--brass-line)" }}
          >
            <p className="font-display italic text-sm" style={{ color: "var(--ink-soft)" }}>
              A blank page. Describe the work you're looking for, however messy —
            </p>
            <p className="font-display italic text-sm mt-1" style={{ color: "var(--ink-soft)" }}>
              "IT job, min shs 2,000,000, just finished my CS degree"
            </p>
          </div>
        )}

        {chat.map((entry, i) => {
          if (entry.role === "user") {
            return (
              <div key={i} className="flex justify-end">
                <div
                  className="max-w-[85%] -rotate-1 rounded-sm border px-3 py-2 text-sm shadow-sm"
                  style={{ borderColor: "var(--brass-line)", background: "#fbf8ef", color: "var(--ink)" }}
                >
                  {entry.text}
                </div>
              </div>
            );
          }
          if (entry.role === "assistant") {
            return (
              <div key={i} className="flex justify-start">
                <div
                  className="max-w-[85%] border-l-2 pl-3 py-1 font-display italic text-[15px]"
                  style={{ borderColor: "var(--brass)", color: "var(--ink)" }}
                >
                  {entry.text}
                </div>
              </div>
            );
          }
          return (
            <div key={i} className="space-y-2.5">
              {entry.note && (
                <p
                  className="border-l-2 pl-3 py-1 text-xs italic"
                  style={{ borderColor: "var(--stamp-ghost)", color: "var(--ink-soft)" }}
                >
                  {entry.note}
                </p>
              )}
              {entry.jobs.length === 0 ? (
                <p className="font-display italic text-sm py-2" style={{ color: "var(--ink-soft)" }}>
                  Nothing in the log matches that yet. Try "+ Add a listing you found" if you've
                  seen something relevant elsewhere, or widen what you're looking for.
                </p>
              ) : entry.segments ? (
                entry.segments.map((seg) => {
                  const segJobs = entry.jobs.filter((j) => j.category === seg.toLowerCase());
                  if (segJobs.length === 0) return null;
                  return (
                    <div key={seg}>
                      <p
                        className="mb-1.5 flex items-center gap-2 text-xs font-medium uppercase tracking-wide"
                        style={{ color: "var(--brass)" }}
                      >
                        <span className="h-px flex-1" style={{ background: "var(--brass-line)" }} />
                        {seg}
                        <span className="h-px flex-1" style={{ background: "var(--brass-line)" }} />
                      </p>
                      <div className="space-y-2">
                        {segJobs.map((j) => (
                          <FieldCard key={j.id} job={j} jobDNA={jobDNA} onBioSaved={(bio) => mergeJobDNA({ bio }).then(setJobDNA)} />
                        ))}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="space-y-2">
                  {entry.jobs.map((j) => (
                    <FieldCard key={j.id} job={j} jobDNA={jobDNA} onBioSaved={(bio) => mergeJobDNA({ bio }).then(setJobDNA)} />
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {loading && (
          <div className="flex items-center gap-2 pl-1">
            <CompassRose className="h-6 w-6" spinning />
            <span className="font-display italic text-sm" style={{ color: "var(--ink-soft)" }}>
              charting the search…
            </span>
          </div>
        )}

        {error && (
          <div
            className="border-l-2 pl-3 py-1.5 text-xs"
            style={{ borderColor: "var(--stamp-ghost)", color: "var(--stamp-ghost)" }}
          >
            <p>{error}</p>
            {retryTarget && (
              <button
                onClick={retry}
                className="mt-1.5 rounded-full border px-2.5 py-1 text-xs font-medium"
                style={{ borderColor: "var(--stamp-ghost)", color: "var(--stamp-ghost)" }}
              >
                Try again
              </button>
            )}
          </div>
        )}

        <div ref={bottomRef} />
      </main>
      )}

      {view === "browse" && (
        <BrowseView jobDNA={jobDNA} onBioSaved={(bio) => mergeJobDNA({ bio }).then(setJobDNA)} />
      )}

      {view === "tracked" && <TrackedView />}

      {view === "search" && (
      <footer
        className="border-t-2 p-3"
        style={{ borderColor: "var(--ink)", background: "var(--paper-deep)" }}
      >
        <div className="flex items-end gap-2">
          <input
            className="flex-1 border-b bg-transparent px-1 pb-1.5 font-display italic text-sm outline-none placeholder:not-italic"
            style={{ borderColor: "var(--ink-soft)", color: "var(--ink)" }}
            placeholder="Describe the job you're looking for…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
          />
          <button
            onClick={send}
            disabled={loading}
            aria-label="Send"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border disabled:opacity-40"
            style={{ borderColor: "var(--ink)", color: "var(--ink)" }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M2 14 L14 8 L2 2 L2 7 L9 8 L2 9 Z" fill="currentColor" />
            </svg>
          </button>
        </div>
      </footer>
      )}

      <BottomNav view={view} setView={setView} />
    </div>
  );
}
