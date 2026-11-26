import { getConfig } from "./config.js";
import { connectDb } from "./db.js";
import { buildApp } from "./app.js";
import { recoverStuckJobs, startJobLoop } from "./jobs/runner.js";
import { startCron } from "./jobs/cron.js";
import { seedSuperAdmin } from "./auth/seedSuperAdmin.js";

async function main() {
  const cfg = getConfig();
  await connectDb();
  await seedSuperAdmin();
  const recovered = await recoverStuckJobs();
  const app = await buildApp();
  startJobLoop(2000);
  startCron(cfg.CRON_INTERVAL_MS);
  await app.listen({ port: cfg.PORT, host: "0.0.0.0" });
  app.log.info(`API listening on ${cfg.PORT}`);
  if (recovered > 0) {
    app.log.warn(`Recovered ${recovered} stuck running job(s)`);
  }
  app.log.info(
    "Super admin: run `npm run init-db` if tbl_users has no admin yet",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
