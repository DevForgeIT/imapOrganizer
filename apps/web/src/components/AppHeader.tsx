"use client";

import Link from "next/link";
import { api } from "@/lib/api";
import { useRouter } from "next/navigation";
import type { UserRole } from "@imap-organizer/shared";
import { IconUsers } from "@/components/Icons";

export function AppHeader({
  email,
  role,
}: {
  email?: string;
  role?: UserRole;
}) {
  const router = useRouter();

  async function logout() {
    await api("/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <header className="app-header">
      <Link className="brand" href="/mailboxes">
        IMAP Organizer
      </Link>
      <div className="row">
        {role === "super_admin" ? (
          <Link href="/admin/users" className="btn-icon">
            <IconUsers size={18} /> Utenti
          </Link>
        ) : null}
        {email ? <span className="muted">{email}</span> : null}
        {email ? (
          <button type="button" className="secondary" onClick={() => void logout()}>
            Esci
          </button>
        ) : null}
      </div>
    </header>
  );
}
