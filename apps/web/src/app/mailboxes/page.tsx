"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { AppHeader } from "@/components/AppHeader";
import {
  JobProgressOverlay,
  type JobProgressState,
} from "@/components/JobProgressOverlay";
import {
  IconEdit,
  IconMail,
  IconPlug,
  IconPlus,
  IconRefresh,
  IconSave,
  IconSparkles,
  IconTrash,
  IconX,
} from "@/components/Icons";
import { pollSingleJob, pollSyncThenClassify } from "@/lib/jobPoll";
import type { MailboxPublic, UserPublic } from "@imap-organizer/shared";

type ModalMode = "edit" | "delete" | null;

export default function MailboxesPage() {
  const [user, setUser] = useState<UserPublic | null>(null);
  const [boxes, setBoxes] = useState<MailboxPublic[]>([]);
  const [error, setError] = useState("");
  const [jobMsg, setJobMsg] = useState("");
  const [jobProgress, setJobProgress] = useState<JobProgressState | null>(null);
  const [modal, setModal] = useState<ModalMode>(null);
  const [selected, setSelected] = useState<MailboxPublic | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const me = await api<UserPublic>("/auth/me");
    setUser(me);
    const list = await api<MailboxPublic[]>("/mailboxes");
    setBoxes(list);
  }, []);

  useEffect(() => {
    void load().catch((err) =>
      setError(err instanceof ApiError ? err.message : "Load failed"),
    );
  }, [load]);

  function openEdit(b: MailboxPublic) {
    setError("");
    setSelected(b);
    setModal("edit");
  }

  function openDelete(b: MailboxPublic) {
    setError("");
    setSelected(b);
    setModal("delete");
  }

  function closeModal() {
    if (busy) return;
    setModal(null);
    setSelected(null);
  }

  async function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setJobMsg("");
    const form = e.currentTarget;
    const fd = new FormData(form);
    try {
      const created = await api<MailboxPublic>("/mailboxes", {
        method: "POST",
        json: {
          label: String(fd.get("label") || "").trim(),
          host: String(fd.get("host") || "").trim(),
          port: Number(fd.get("port") || 993),
          tls: fd.get("tls") === "on",
          username: String(fd.get("username") || "").trim(),
          password: String(fd.get("password") || ""),
        },
      });
      form.reset();
      setJobMsg(`Casella creata: ${created.label}`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Create failed");
    }
  }

  async function onEdit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selected) return;
    setBusy(true);
    setError("");
    const fd = new FormData(e.currentTarget);
    const password = String(fd.get("password") || "");
    const payload: Record<string, unknown> = {
      label: String(fd.get("label") || "").trim(),
      host: String(fd.get("host") || "").trim(),
      port: Number(fd.get("port") || 993),
      tls: fd.get("tls") === "on",
      username: String(fd.get("username") || "").trim(),
    };
    if (password) payload.password = password;

    try {
      const updated = await api<MailboxPublic>(`/mailboxes/${selected.id}`, {
        method: "PATCH",
        json: payload,
      });
      setJobMsg(`Casella aggiornata: ${updated.label}`);
      setModal(null);
      setSelected(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  async function onDeleteConfirm() {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      await api(`/mailboxes/${selected.id}`, { method: "DELETE" });
      setJobMsg(`Casella eliminata: ${selected.label}`);
      setModal(null);
      setSelected(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  async function testBox(id: string) {
    setError("");
    setJobMsg("");
    setJobProgress({
      type: "test",
      status: "starting",
      current: 0,
      total: 0,
      message: "Test IMAP in corso…",
    });
    try {
      await api(`/mailboxes/${id}/test`, { method: "POST" });
      setJobProgress({
        type: "test",
        status: "ok",
        current: 1,
        total: 1,
        message: "Connessione IMAP OK",
      });
      setJobMsg("Connessione IMAP OK");
    } catch (err) {
      setJobProgress(null);
      const msg = err instanceof ApiError ? err.message : "Test failed";
      setError(
        /AUTHENTICATIONFAILED|Invalid credentials/i.test(msg)
          ? "Gmail: autenticazione fallita. Usa un'App Password (16 caratteri), non la password del account. Poi Modifica la casella e aggiorna la password."
          : msg,
      );
    }
  }

  async function runJob(id: string, kind: "sync" | "classify") {
    setError("");
    setJobMsg("");
    try {
      if (kind === "sync") {
        const res = await api<{ jobId: string; classifyJobId?: string }>(
          `/mailboxes/${id}/sync`,
          { method: "POST" },
        );
        const result = await pollSyncThenClassify(
          res.jobId,
          res.classifyJobId,
          setJobProgress,
        );
        setJobMsg(
          result === "completed"
            ? "Sync + classificazione completate"
            : "Operazione fallita",
        );
      } else {
        const res = await api<{ jobId: string }>(`/mailboxes/${id}/classify`, {
          method: "POST",
        });
        const result = await pollSingleJob(res.jobId, "classify", setJobProgress);
        setJobMsg(
          result === "completed"
            ? "Classificazione completata"
            : "Classificazione fallita",
        );
      }
      await load();
    } catch (err) {
      setJobProgress(null);
      setError(err instanceof ApiError ? err.message : "Job failed");
    }
  }

  return (
    <>
      <AppHeader email={user?.email} role={user?.role} />
      <main>
        <h1>Caselle IMAP</h1>
        {error ? <p className="error">{error}</p> : null}
        {jobMsg && !jobProgress ? (
          <p className="job-badge ok">{jobMsg}</p>
        ) : null}

        <div className="panel">
          <h2 className="btn-icon">
            <IconPlus /> Aggiungi casella
          </h2>
          <p className="muted">
            Gmail: usa una{" "}
            <a
              href="https://myaccount.google.com/apppasswords"
              target="_blank"
              rel="noreferrer"
            >
              App Password
            </a>{" "}
            (16 caratteri), non la password del account. Host{" "}
            <code>imap.gmail.com</code>, porta <code>993</code>, TLS attivo.
          </p>
          <form className="stack" onSubmit={onCreate}>
            <div className="row">
              <label>
                Etichetta
                <input name="label" required placeholder="Lavoro" />
              </label>
              <label>
                Host
                <input name="host" required placeholder="imap.gmail.com" />
              </label>
              <label>
                Porta
                <input name="port" type="number" defaultValue={993} required />
              </label>
            </div>
            <div className="row">
              <label>
                Username
                <input name="username" required />
              </label>
              <label>
                Password / App Password
                <input name="password" type="password" required />
              </label>
              <label
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: "0.5rem",
                }}
              >
                <input name="tls" type="checkbox" defaultChecked />
                TLS
              </label>
            </div>
            <button type="submit" className="btn-icon">
              <IconSave /> Salva
            </button>
          </form>
        </div>

        <div className="panel">
          <h2>Le tue caselle</h2>
          {boxes.length === 0 ? (
            <p className="muted">Nessuna casella.</p>
          ) : (
            <ul className="mailbox-cards">
              {boxes.map((b) => (
                <li key={b.id} className="mailbox-card">
                  <div className="mailbox-card-title">
                    <Link href={`/mailboxes/${b.id}`}>
                      <strong>{b.label}</strong>
                    </Link>
                  </div>
                  <div className="mailbox-card-meta muted">
                    {b.username} · {b.host}:{b.port} · last sync{" "}
                    {b.lastSyncAt
                      ? new Date(b.lastSyncAt).toLocaleString()
                      : "mai"}
                  </div>
                  <div className="mailbox-card-actions">
                    <Link
                      href={`/mailboxes/${b.id}`}
                      className="btn btn-sm btn-icon"
                      title="Vedi organizzazione e messaggi"
                    >
                      <IconMail /> Apri posta
                    </Link>
                    <button
                      type="button"
                      className="secondary btn-sm btn-icon"
                      onClick={() => openEdit(b)}
                      title="Modifica"
                    >
                      <IconEdit /> Modifica
                    </button>
                    <button
                      type="button"
                      className="secondary btn-sm btn-icon"
                      onClick={() => void testBox(b.id)}
                      title="Test"
                    >
                      <IconPlug /> Test
                    </button>
                    <button
                      type="button"
                      className="btn-sm btn-icon"
                      onClick={() => void runJob(b.id, "sync")}
                      title="Sync"
                    >
                      <IconRefresh /> Sync
                    </button>
                    <button
                      type="button"
                      className="btn-sm btn-icon"
                      onClick={() => void runJob(b.id, "classify")}
                      title="Solo classifica"
                    >
                      <IconSparkles /> Solo classifica
                    </button>
                    <button
                      type="button"
                      className="danger btn-sm btn-icon"
                      onClick={() => openDelete(b)}
                      title="Elimina"
                    >
                      <IconTrash /> Elimina
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>

      {modal === "edit" && selected ? (
        <div className="modal-backdrop" onClick={closeModal} role="presentation">
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-mailbox-title"
            onClick={(ev) => ev.stopPropagation()}
          >
            <h2 id="edit-mailbox-title" className="btn-icon">
              <IconEdit /> Modifica casella
            </h2>
            <form className="stack" onSubmit={onEdit}>
              <label>
                Etichetta
                <input
                  name="label"
                  required
                  defaultValue={selected.label}
                />
              </label>
              <label>
                Host
                <input name="host" required defaultValue={selected.host} />
              </label>
              <label>
                Porta
                <input
                  name="port"
                  type="number"
                  required
                  defaultValue={selected.port}
                />
              </label>
              <label>
                Username
                <input
                  name="username"
                  required
                  defaultValue={selected.username}
                />
              </label>
              <label>
                Nuova password / App Password (opzionale)
                <input name="password" type="password" />
              </label>
              <label
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: "0.5rem",
                }}
              >
                <input
                  name="tls"
                  type="checkbox"
                  defaultChecked={selected.tls}
                />
                TLS
              </label>
              <div className="modal-actions">
                <button
                  type="button"
                  className="secondary btn-icon"
                  onClick={closeModal}
                  disabled={busy}
                >
                  <IconX /> Annulla
                </button>
                <button type="submit" className="btn-icon" disabled={busy}>
                  <IconSave /> {busy ? "…" : "Salva"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {modal === "delete" && selected ? (
        <div className="modal-backdrop" onClick={closeModal} role="presentation">
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-mailbox-title"
            onClick={(ev) => ev.stopPropagation()}
          >
            <h2 id="delete-mailbox-title" className="btn-icon">
              <IconTrash /> Elimina casella
            </h2>
            <p>
              Confermi l&apos;eliminazione di{" "}
              <strong>{selected.label}</strong> ({selected.username})?
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="secondary btn-icon"
                onClick={closeModal}
                disabled={busy}
              >
                <IconX /> Annulla
              </button>
              <button
                type="button"
                className="danger btn-icon"
                onClick={() => void onDeleteConfirm()}
                disabled={busy}
              >
                <IconTrash /> {busy ? "…" : "Elimina"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <JobProgressOverlay
        job={jobProgress}
        onDismiss={() => setJobProgress(null)}
      />
    </>
  );
}
