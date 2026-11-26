"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { api, ApiError } from "@/lib/api";
import type { FolderDto, UserPublic } from "@imap-organizer/shared";

export default function FoldersPage() {
  const { id } = useParams<{ id: string }>();
  const [user, setUser] = useState<UserPublic | null>(null);
  const [folders, setFolders] = useState<FolderDto[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setUser(await api<UserPublic>("/auth/me"));
    setFolders(await api<FolderDto[]>(`/folders?mailboxId=${id}`));
  }, [id]);

  useEffect(() => {
    void load().catch((err) =>
      setError(err instanceof ApiError ? err.message : "Load failed"),
    );
  }, [load]);

  async function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    try {
      await api("/folders", {
        method: "POST",
        json: {
          mailboxId: id,
          name: String(fd.get("name") || ""),
          description: String(fd.get("description") || ""),
        },
      });
      form.reset();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Create failed");
    }
  }

  async function remove(folder: FolderDto) {
    try {
      await api(`/folders/${folder.id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Delete failed");
    }
  }

  return (
    <>
      <AppHeader email={user?.email} role={user?.role} />
      <main>
        <p>
          <Link href={`/mailboxes/${id}`}>← Torna alla casella</Link>
        </p>
        <h1>Cartelle</h1>
        {error ? <p className="error">{error}</p> : null}

        <div className="panel">
          <h2>Nuova cartella utente</h2>
          <form className="stack" onSubmit={onCreate}>
            <label>
              Nome
              <input name="name" required />
            </label>
            <label>
              Descrizione (per LLM)
              <textarea name="description" rows={3} />
            </label>
            <button type="submit">Crea</button>
          </form>
        </div>

        <div className="panel">
          <ul className="stack">
            {folders.map((f) => (
              <li key={f.id} className="row" style={{ justifyContent: "space-between" }}>
                <div>
                  <strong>{f.name}</strong>{" "}
                  <span className="muted">
                    {f.slug} · {f.source} · {f.active ? "active" : "off"}
                  </span>
                  <div className="muted">{f.description}</div>
                </div>
                <button
                  type="button"
                  className="danger"
                  onClick={() => void remove(f)}
                >
                  {f.source === "system" ? "Disattiva" : "Elimina"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </main>
    </>
  );
}
