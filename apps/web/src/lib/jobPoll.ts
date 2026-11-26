import { api } from "@/lib/api";
import type { JobProgressState } from "@/components/JobProgressOverlay";
import type { JobDto } from "@imap-organizer/shared";

export async function pollSingleJob(
  jobId: string,
  type: "sync" | "classify",
  onProgress: (state: JobProgressState) => void,
): Promise<"completed" | "failed"> {
  onProgress({
    type,
    status: "starting",
    current: 0,
    total: 0,
    message: type === "sync" ? "Avvio sync…" : "Avvio classificazione…",
  });

  for (let i = 0; i < 180; i++) {
    const job = await api<JobDto>(`/jobs/${jobId}`);
    onProgress({
      type: job.type,
      status: job.status,
      current: job.progress.current,
      total: job.progress.total,
      message: job.progress.message,
      error: job.error,
    });
    if (job.status === "completed") {
      onProgress({
        type: job.type,
        status: "completed",
        current: job.progress.total || job.progress.current,
        total: job.progress.total || job.progress.current,
        message:
          job.type === "sync"
            ? "Sincronizzazione completata"
            : "Classificazione completata",
      });
      return "completed";
    }
    if (job.status === "failed") {
      onProgress({
        type: job.type,
        status: "failed",
        current: job.progress.current,
        total: job.progress.total,
        message: job.progress.message,
        error: job.error,
      });
      return "failed";
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  onProgress({
    type,
    status: "failed",
    current: 0,
    total: 0,
    error: "Timeout attesa job",
  });
  return "failed";
}

/** Sync then classify — both shown in the centered overlay. */
export async function pollSyncThenClassify(
  syncJobId: string,
  classifyJobId: string | undefined,
  onProgress: (state: JobProgressState) => void,
): Promise<"completed" | "failed"> {
  const syncResult = await pollSingleJob(syncJobId, "sync", (s) => {
    onProgress({
      ...s,
      message:
        s.status === "completed"
          ? "Sync ok — avvio classificazione…"
          : s.message
            ? `Sync: ${s.message}`
            : "Sincronizzazione in corso…",
    });
  });
  if (syncResult === "failed") return "failed";
  if (!classifyJobId) {
    onProgress({
      type: "sync",
      status: "completed",
      current: 1,
      total: 1,
      message: "Sincronizzazione completata",
    });
    return "completed";
  }

  onProgress({
    type: "classify",
    status: "starting",
    current: 0,
    total: 0,
    message: "Sync ok — classificazione in corso…",
  });

  const classifyResult = await pollSingleJob(classifyJobId, "classify", (s) => {
    onProgress({
      ...s,
      message:
        s.status === "completed"
          ? "Sync + classificazione completate"
          : s.message
            ? `Classifica: ${s.message}`
            : "Classificazione in corso…",
    });
  });
  return classifyResult;
}
