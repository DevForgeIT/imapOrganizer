"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import type { UserPublic } from "@imap-organizer/shared";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const fd = new FormData(e.currentTarget);
    try {
      const user = await api<UserPublic>("/auth/login", {
        method: "POST",
        json: {
          email: String(fd.get("email") || ""),
          password: String(fd.get("password") || ""),
        },
      });
      router.push(user.role === "super_admin" ? "/admin/users" : "/mailboxes");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
      <div className="panel" style={{ maxWidth: 420, margin: "3rem auto" }}>
        <h1>Accedi</h1>
        <p className="muted">Compila i campi per accedere all'applicazione.</p>
        <form className="stack" onSubmit={onSubmit}>
          <label>
            Email
            <input name="email" type="email" required autoComplete="username" />
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
      </div>
    </main>
  );
}
