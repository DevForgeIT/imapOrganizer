"use client";

import { useEffect } from "react";
import { setSessionToken } from "@/lib/session";

/**
 * SPID ACS lands here with #token=… because cookies set on the tunnel API
 * are blocked as third-party when the web app runs on localhost.
 */
export default function SpidCallbackPage() {
  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, "");
    const params = new URLSearchParams(hash);
    const token = params.get("token");
    const next = params.get("next") || "/mailboxes";

    if (token) {
      setSessionToken(token);
      window.location.replace(next.startsWith("/") ? next : "/mailboxes");
      return;
    }
    window.location.replace("/login?spid_error=Missing+session+token");
  }, []);

  return (
    <main>
      <div className="panel" style={{ maxWidth: 420, margin: "3rem auto" }}>
        <p className="muted">Completamento accesso SPID…</p>
      </div>
    </main>
  );
}
