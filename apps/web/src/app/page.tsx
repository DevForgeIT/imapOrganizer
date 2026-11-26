"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type { UserPublic } from "@imap-organizer/shared";

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    void (async () => {
      try {
        await api<UserPublic>("/auth/me");
        router.replace("/mailboxes");
      } catch {
        router.replace("/login");
      }
    })();
  }, [router]);

  return (
    <main>
      <p className="muted">Caricamento…</p>
    </main>
  );
}
