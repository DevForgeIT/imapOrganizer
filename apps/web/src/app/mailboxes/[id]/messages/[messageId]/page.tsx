"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { api, ApiError } from "@/lib/api";
import type { MessageDetail, UserPublic } from "@imap-organizer/shared";

export default function MessageDetailPage() {
  const { id, messageId } = useParams<{ id: string; messageId: string }>();
  const [user, setUser] = useState<UserPublic | null>(null);
  const [msg, setMsg] = useState<MessageDetail | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        setUser(await api<UserPublic>("/auth/me"));
        setMsg(await api<MessageDetail>(`/messages/${messageId}`));
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Load failed");
      }
    })();
  }, [messageId]);

  return (
    <>
      <AppHeader email={user?.email} role={user?.role} />
      <main>
        <p>
          <Link href={`/mailboxes/${id}`}>← Torna ai messaggi</Link>
        </p>
        {error ? <p className="error">{error}</p> : null}
        {!msg ? (
          <p className="muted">Caricamento…</p>
        ) : (
          <div className="panel stack">
            <h1>{msg.subject}</h1>
            <p className="muted">
              Da: {msg.from}
              <br />
              A: {msg.to}
              <br />
              Data: {new Date(msg.date).toLocaleString()}
              <br />
              IMAP: {msg.imapFolder}
              <br />
              Cartella:{" "}
              {msg.folderName ? (
                <span className="folder-tag">{msg.folderName}</span>
              ) : (
                "In attesa classifica"
              )}
            </p>
            {msg.classification ? (
              <p className="job-badge">
                Classificazione: {msg.classification.reason}
              </p>
            ) : null}
            <pre
              style={{
                whiteSpace: "pre-wrap",
                background: "#0d1218",
                padding: "1rem",
                borderRadius: 8,
                border: "1px solid var(--border)",
              }}
            >
              {msg.bodyText || "(vuoto)"}
            </pre>
          </div>
        )}
      </main>
    </>
  );
}
