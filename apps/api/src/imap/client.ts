import { ImapFlow } from "imapflow";

export type ImapConnOpts = {
  host: string;
  port: number;
  tls: boolean;
  username: string;
  password: string;
};

function formatImapError(err: unknown): string {
  if (!err || typeof err !== "object") return String(err);
  const e = err as {
    message?: string;
    responseText?: string;
    response?: string;
    authenticationFailed?: boolean;
    code?: string;
    serverResponseCode?: string;
  };
  const parts = [
    e.message,
    e.responseText,
    e.response,
    e.code,
    e.serverResponseCode,
    e.authenticationFailed ? "authenticationFailed" : "",
  ].filter(Boolean);
  return [...new Set(parts)].join(" — ") || "IMAP connection failed";
}

export async function withImap<T>(
  opts: ImapConnOpts,
  fn: (client: ImapFlow) => Promise<T>,
): Promise<T> {
  const useSecure = opts.tls || opts.port === 993;
  const client = new ImapFlow({
    host: opts.host,
    port: opts.port,
    secure: useSecure,
    auth: { user: opts.username, pass: opts.password },
    logger: false,
    tls: {
      // Gmail and most providers; set rejectUnauthorized false only if needed later
      rejectUnauthorized: true,
      minVersion: "TLSv1.2",
    },
  });

  let connected = false;
  try {
    await client.connect();
    connected = true;
    return await fn(client);
  } catch (err) {
    throw new Error(formatImapError(err));
  } finally {
    if (connected) {
      try {
        await client.logout();
      } catch {
        try {
          client.close();
        } catch {
          /* ignore */
        }
      }
    } else {
      try {
        client.close();
      } catch {
        /* ignore */
      }
    }
  }
}

export async function testImapConnection(
  opts: ImapConnOpts,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await withImap(opts, async (client) => {
      // Prove the session can open INBOX read-only
      const lock = await client.getMailboxLock("INBOX", { readOnly: true });
      lock.release();
    });
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
