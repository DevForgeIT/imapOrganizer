"use client";

import type { JobDto, JobType } from "@imap-organizer/shared";

export type JobProgressState = {
  type: JobType | "test";
  status: JobDto["status"] | "starting" | "ok";
  current: number;
  total: number;
  message?: string;
  error?: string | null;
};

function titleFor(type: JobProgressState["type"]): string {
  if (type === "sync") return "Sincronizzazione IMAP";
  if (type === "classify") return "Classificazione";
  return "Test connessione";
}

export function JobProgressOverlay({
  job,
  onDismiss,
}: {
  job: JobProgressState | null;
  onDismiss?: () => void;
}) {
  if (!job) return null;

  const done = job.status === "completed" || job.status === "ok";
  const failed = job.status === "failed";
  const pct =
    job.total > 0
      ? Math.min(100, Math.round((job.current / job.total) * 100))
      : done
        ? 100
        : job.status === "starting" || job.status === "queued"
          ? 0
          : 15;

  const label = failed
    ? job.error || "Operazione fallita"
    : done
      ? job.message || "Completato"
      : job.message ||
        (job.total > 0
          ? `${job.current} / ${job.total}`
          : "In corso…");

  return (
    <div className="job-overlay" role="alertdialog" aria-modal="true" aria-live="polite">
      <div className="job-overlay-card">
        <p className="job-overlay-kicker">{titleFor(job.type)}</p>
        <h2 className="job-overlay-title">
          {failed ? "Errore" : done ? "Fatto" : "In corso"}
        </h2>
        <p className={`job-overlay-msg ${failed ? "fail" : done ? "ok" : ""}`}>
          {label}
        </p>
        <div className="job-progress-track" aria-hidden={!job.total}>
          <div
            className={`job-progress-fill ${failed ? "fail" : done ? "ok" : ""}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        {!failed && !done ? (
          <p className="muted job-overlay-pct">
            {job.total > 0 ? `${pct}%` : "Attendere…"}
          </p>
        ) : null}
        {(done || failed) && onDismiss ? (
          <button type="button" className="btn job-overlay-dismiss" onClick={onDismiss}>
            Chiudi
          </button>
        ) : null}
      </div>
    </div>
  );
}
