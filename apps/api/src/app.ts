import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import { getConfig } from "./config.js";
import { authPlugin } from "./auth/plugin.js";
import { authRoutes } from "./routes/auth.js";
import { mailboxRoutes } from "./routes/mailboxes.js";
import { folderRoutes } from "./routes/folders.js";
import { messageRoutes } from "./routes/messages.js";
import { jobRoutes } from "./routes/jobs.js";
import { adminUserRoutes } from "./routes/adminUsers.js";

export async function buildApp() {
  const cfg = getConfig();
  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: cfg.WEB_ORIGIN,
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  });
  await app.register(cookie);
  await app.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute",
  });
  // Register directly (not encapsulate) so onRequest auth applies to all routes.
  await authPlugin(app);

  await app.register(async (scope) => {
    await scope.register(rateLimit, {
      max: 20,
      timeWindow: "1 minute",
    });
    await scope.register(authRoutes);
  });

  await app.register(mailboxRoutes);
  await app.register(folderRoutes);
  await app.register(messageRoutes);
  await app.register(jobRoutes);
  await app.register(adminUserRoutes);

  app.get("/health", async () => ({ ok: true }));

  return app;
}
