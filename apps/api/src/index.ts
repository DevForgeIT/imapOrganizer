import { getConfig } from "./config.js";
import { connectDb } from "./db.js";
import { buildApp } from "./app.js";
import { startJobLoop } from "./jobs/runner.js";
import { startCron } from "./jobs/cron.js";
import { seedSuperAdmin } from "./auth/seedSuperAdmin.js";

async function main() {
  const cfg = getConfig();
  await connectDb();
  const seed = await seedSuperAdmin();
  const app = await buildApp();
  startJobLoop(2000);
  startCron(cfg.CRON_INTERVAL_MS);
  await app.listen({ port: cfg.PORT, host: "0.0.0.0" });
  app.log.info(`API listening on ${cfg.PORT}`);
  if (seed === "created") {
    app.log.info(`Bootstrap super admin created: ${cfg.SUPER_ADMIN_EMAIL}`);
  } else if (seed === "skipped") {
    app.log.info(
      "SUPER_ADMIN_* not set — using existing users in Mongo (tbl_users)",
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
