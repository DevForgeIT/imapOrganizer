import { getConfig } from "../config.js";
import { mailboxes, jobs } from "../models/collections.js";
import { enqueueJob } from "./runner.js";

let cronTimer: ReturnType<typeof setInterval> | null = null;

async function tick(): Promise<void> {
  const active = await mailboxes().find({ active: true }).toArray();
  for (const box of active) {
    for (const type of ["sync", "classify"] as const) {
      const existing = await jobs().findOne({
        mailboxId: box._id,
        type,
        status: { $in: ["queued", "running"] },
      });
      if (existing) continue;
      await enqueueJob({
        userId: box.userId,
        mailboxId: box._id,
        type,
        triggeredBy: "cron",
      });
    }
  }
}

export function startCron(intervalMs?: number): void {
  if (cronTimer) return;
  const ms = intervalMs ?? getConfig().CRON_INTERVAL_MS;
  cronTimer = setInterval(() => {
    void tick();
  }, ms);
}
