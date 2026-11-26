"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, API_URL } from "@/lib/api";
import { setSessionToken } from "@/lib/session";
import type { UserPublic } from "@imap-organizer/shared";

type AuthFeatures = {
  spidEnabled: boolean;
  localLoginEnabled: boolean;
};

function SpidLogo({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="16" cy="16" r="16" fill="#06C" />
      <path
        fill="#fff"
        d="M9.2 21.6V10.4h3.1c1.85 0 3.05.95 3.05 2.55 0 1.05-.55 1.9-1.5 2.3l2.15 6.35h-2.45l-1.85-5.7h-.75v5.7H9.2zm2.75-7.55h.55c.7 0 1.15-.4 1.15-1.05s-.45-1-1.15-1H11.95v2.05zM18.05 21.6l2.7-11.2h2.55l2.7 11.2h-2.5l-.4-1.85h-2.15l-.4 1.85h-2.5zm3.35-3.95h1.35l-.65-3.05-.7 3.05z"
      />
    </svg>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [features, setFeatures] = useState<AuthFeatures | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const spidErr = params.get("spid_error");
    if (spidErr) setError(spidErr);
  }, []);

  useEffect(() => {
    let cancelled = false;
    api<AuthFeatures>("/auth/features")
      .then((f) => {
        if (!cancelled) setFeatures(f);
      })
      .catch(() => {
        if (!cancelled) {
          setFeatures({ spidEnabled: false, localLoginEnabled: true });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const fd = new FormData(e.currentTarget);
    try {
      const user = await api<UserPublic & { token?: string }>("/auth/login", {
        method: "POST",
        json: {
          email: String(fd.get("email") || ""),
          password: String(fd.get("password") || ""),
        },
      });
      if (user.token) setSessionToken(user.token);
      router.push(user.role === "super_admin" ? "/admin/users" : "/mailboxes");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  const showLocal = features?.localLoginEnabled !== false;
  const showSpid = features?.spidEnabled === true;

  return (
    <main>
      <div className="panel" style={{ maxWidth: 420, margin: "3rem auto" }}>
        <h1>Accedi</h1>
        <p className="muted">Compila i campi per accedere all&apos;applicazione.</p>

        {showLocal ? (
          <form className="stack" onSubmit={onSubmit}>
            <label>
              Email
              <input
                name="email"
                type="email"
                required
                autoComplete="username"
              />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                required
                minLength={8}
                autoComplete="current-password"
              />
            </label>
            {error ? <p className="error">{error}</p> : null}
            <button type="submit" disabled={loading}>
              {loading ? "…" : "Login"}
            </button>
          </form>
        ) : null}

        {showSpid ? (
          <>
            {showLocal ? (
              <div className="login-divider" role="separator">
                <span>oppure</span>
              </div>
            ) : null}
            <a
              className="spid-button"
              href={`${API_URL}/auth/spid/login`}
              aria-label="Entra con SPID"
            >
              <SpidLogo />
              <span>Entra con SPID</span>
            </a>
          </>
        ) : null}

        {features === null ? (
          <p className="muted" style={{ marginTop: "1rem" }}>
            Caricamento opzioni di accesso…
          </p>
        ) : null}
      </div>
    </main>
  );
}
