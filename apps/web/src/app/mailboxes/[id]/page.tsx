"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
} from "react";
import { AppHeader } from "@/components/AppHeader";
import {
  JobProgressOverlay,
  type JobProgressState,
} from "@/components/JobProgressOverlay";
import {
  IconRefresh,
  IconSparkles,
  IconTrash,
  IconX,
} from "@/components/Icons";
import { api, ApiError } from "@/lib/api";
import { pollSingleJob, pollSyncThenClassify } from "@/lib/jobPoll";
import type {
  FolderDto,
  MailboxOrgStats,
  MessageDetail,
  MessageListItem,
  UserPublic,
} from "@imap-organizer/shared";

const MSG_DND_TYPE = "application/x-imap-organizer-message-id";

export default function MailboxDetailPage() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const folderId = search.get("folderId");
  const id = params.id;

  const [user, setUser] = useState<UserPublic | null>(null);
  const [folders, setFolders] = useState<FolderDto[]>([]);
  const [messages, setMessages] = useState<MessageListItem[]>([]);
  const [stats, setStats] = useState<MailboxOrgStats | null>(null);
  const [totalShown, setTotalShown] = useState(0);
  const [error, setError] = useState("");
  const [jobMsg, setJobMsg] = useState("");
  const [jobProgress, setJobProgress] = useState<JobProgressState | null>(null);

  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MessageDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [dragMsgId, setDragMsgId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const suppressClickRef = useRef(false);

  const load = useCallback(async () => {
    const me = await api<UserPublic>("/auth/me");
    setUser(me);
    const [f, org] = await Promise.all([
      api<FolderDto[]>(`/folders?mailboxId=${id}`),
      api<MailboxOrgStats>(`/mailboxes/${id}/org-stats`),
    ]);
    setFolders(
      f
        .filter((x) => x.active)
        .sort((a, b) => {
          if (a.source === b.source) return a.name.localeCompare(b.name);
          return a.source === "user" ? -1 : 1;
        }),
    );
    setStats(org);
    const qs = new URLSearchParams({ mailboxId: id });
    if (folderId) qs.set("folderId", folderId);
    const m = await api<{ items: MessageListItem[]; total: number }>(
      `/messages?${qs}`,
    );
    setMessages(m.items);
    setTotalShown(m.total);
  }, [id, folderId]);

  useEffect(() => {
    void load().catch((err) =>
      setError(err instanceof ApiError ? err.message : "Load failed"),
    );
  }, [load]);

  useEffect(() => {
    setConfirmDelete(false);
    if (!openId) {
      setDetail(null);
      setDetailError("");
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setDetailError("");
    void api<MessageDetail>(`/messages/${openId}`)
      .then((msg) => {
        if (!cancelled) setDetail(msg);
      })
      .catch((err) => {
        if (!cancelled) {
          setDetail(null);
          setDetailError(
            err instanceof ApiError ? err.message : "Messaggio non caricato",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [openId]);

  useEffect(() => {
    if (!openId) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpenId(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openId]);

  async function run(kind: "sync" | "classify") {
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

  const activeFolderName = folderId
    ? folders.find((f) => f.id === folderId)?.name ?? "Cartella"
    : "Tutte";

  const openIndex = openId
    ? messages.findIndex((m) => m.id === openId)
    : -1;

  function openPrev() {
    if (openIndex > 0) setOpenId(messages[openIndex - 1].id);
  }

  function openNext() {
    if (openIndex >= 0 && openIndex < messages.length - 1) {
      setOpenId(messages[openIndex + 1].id);
    }
  }

  function closeReader() {
    setOpenId(null);
    setConfirmDelete(false);
    setDeleting(false);
  }

  async function deleteCurrentMessage() {
    if (!openId || deleting) return;
    setDeleting(true);
    setDetailError("");
    try {
      await api(`/messages/${openId}`, { method: "DELETE" });
      const nextId =
        openIndex >= 0 && openIndex < messages.length - 1
          ? messages[openIndex + 1]?.id
          : openIndex > 0
            ? messages[openIndex - 1]?.id
            : null;
      setConfirmDelete(false);
      setOpenId(nextId);
      await load();
    } catch (err) {
      setDetailError(
        err instanceof ApiError
          ? err.message
          : "Eliminazione fallita",
      );
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  }

  function onMsgDragStart(e: DragEvent, messageId: string) {
    e.dataTransfer.setData(MSG_DND_TYPE, messageId);
    e.dataTransfer.setData("text/plain", messageId);
    e.dataTransfer.effectAllowed = "move";
    setDragMsgId(messageId);
    suppressClickRef.current = false;
  }

  function onMsgDragEnd() {
    setDragMsgId(null);
    setDropTargetId(null);
  }

  function onFolderDragOver(e: DragEvent, targetFolderId: string) {
    if (!dragMsgId && !e.dataTransfer.types.includes(MSG_DND_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropTargetId(targetFolderId);
  }

  function onFolderDragLeave(e: DragEvent, targetFolderId: string) {
    const related = e.relatedTarget as Node | null;
    if (related && e.currentTarget.contains(related)) return;
    if (dropTargetId === targetFolderId) setDropTargetId(null);
  }

  async function moveMessageToFolder(messageId: string, targetFolderId: string) {
    const msg = messages.find((m) => m.id === messageId);
    if (!msg || msg.folderId === targetFolderId) return;
    const target = folders.find((f) => f.id === targetFolderId);
    if (!target) return;

    setMoving(true);
    setError("");
    try {
      const updated = await api<MessageListItem>(`/messages/${messageId}`, {
        method: "PATCH",
        json: { folderId: targetFolderId },
      });

      // Leave current filtered view if this message no longer belongs here.
      if (folderId && folderId !== "uncategorized" && folderId !== targetFolderId) {
        setMessages((prev) => prev.filter((m) => m.id !== messageId));
        setTotalShown((n) => Math.max(0, n - 1));
      } else {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId
              ? {
                  ...m,
                  folderId: updated.folderId,
                  folderName: updated.folderName ?? target.name,
                }
              : m,
          ),
        );
      }

      if (openId === messageId && detail) {
        setDetail({
          ...detail,
          folderId: updated.folderId,
          folderName: updated.folderName ?? target.name,
          classification: {
            folderId: updated.folderId,
            reason: `Spostato manualmente in «${target.name}»`,
            at: new Date().toISOString(),
          },
        });
      }

      setJobMsg(`Spostato in «${target.name}»`);
      await load();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Spostamento fallito",
      );
    } finally {
      setMoving(false);
      setDragMsgId(null);
      setDropTargetId(null);
    }
  }

  async function onFolderDrop(e: DragEvent, targetFolderId: string) {
    e.preventDefault();
    const messageId =
      e.dataTransfer.getData(MSG_DND_TYPE) ||
      e.dataTransfer.getData("text/plain") ||
      dragMsgId;
    setDropTargetId(null);
    setDragMsgId(null);
    if (!messageId) return;
    suppressClickRef.current = true;
    await moveMessageToFolder(messageId, targetFolderId);
  }

  return (
    <div className="mail-shell">
      <AppHeader email={user?.email} role={user?.role} />
      <main className="mail-main">
        <div className="mail-toolbar">
          <div className="mail-toolbar-left">
            <Link href="/mailboxes">← Caselle</Link>
            <h1>Organizzazione posta</h1>
            {stats ? (
              <div className="org-stats org-stats-inline">
                <span>
                  <strong>{stats.total}</strong> sync
                </span>
                <span>
                  <strong>{stats.classified}</strong> organizzati
                </span>
                {stats.uncategorized > 0 ? (
                  <span>
                    <strong>{stats.uncategorized}</strong> in attesa classifica
                  </span>
                ) : null}
                <span>
                  <strong>{folders.length}</strong> cartelle
                </span>
              </div>
            ) : null}
          </div>
          <div className="row">
            <Link href={`/mailboxes/${id}/folders`}>Gestisci cartelle</Link>
            <button
              type="button"
              className="btn-icon"
              onClick={() => void run("sync")}
            >
              <IconRefresh /> Sync
            </button>
            <button
              type="button"
              className="btn-icon"
              onClick={() => void run("classify")}
            >
              <IconSparkles /> Solo classifica
            </button>
          </div>
        </div>
        {error ? <p className="error">{error}</p> : null}
        {jobMsg && !jobProgress ? <p className="job-badge">{jobMsg}</p> : null}
        {dragMsgId ? (
          <p className="job-badge">Trascina il messaggio su una cartella…</p>
        ) : null}
        {moving ? <p className="job-badge">Spostamento in corso…</p> : null}

        <div className="mail-workspace">
          <aside className="panel mail-side">
            <h2>Cartelle</h2>
            <p className="muted folder-dnd-hint">
              Trascina un messaggio qui per cambiare categoria
            </p>
            <ul className="folder-list">
              <li>
                <button
                  type="button"
                  className={!folderId ? "active" : undefined}
                  onClick={() => router.push(`/mailboxes/${id}`)}
                >
                  <span>Tutte</span>
                  <span className="count-pill">{stats?.total ?? 0}</span>
                </button>
              </li>
              {stats && stats.uncategorized > 0 ? (
                <li>
                  <button
                    type="button"
                    className={
                      folderId === "uncategorized" ? "active" : undefined
                    }
                    onClick={() =>
                      router.push(`/mailboxes/${id}?folderId=uncategorized`)
                    }
                  >
                    <span>In attesa classifica</span>
                    <span className="count-pill">{stats.uncategorized}</span>
                  </button>
                </li>
              ) : null}
              {folders.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    className={[
                      folderId === f.id ? "active" : "",
                      dropTargetId === f.id ? "drop-target" : "",
                      dragMsgId && messages.find((m) => m.id === dragMsgId)?.folderId === f.id
                        ? "drop-same"
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" ") || undefined}
                    onClick={() =>
                      router.push(`/mailboxes/${id}?folderId=${f.id}`)
                    }
                    onDragOver={(e) => onFolderDragOver(e, f.id)}
                    onDragLeave={(e) => onFolderDragLeave(e, f.id)}
                    onDrop={(e) => void onFolderDrop(e, f.id)}
                  >
                    <span>
                      {f.name}
                      <span className="muted"> · {f.source}</span>
                    </span>
                    <span className="count-pill">{f.messageCount ?? 0}</span>
                  </button>
                </li>
              ))}
            </ul>
          </aside>

          <section className="panel mail-messages">
            <div className="mail-messages-head">
              <h2>Messaggi · {activeFolderName}</h2>
              <span className="muted">{totalShown} in vista</span>
            </div>
            <div className="mail-messages-body">
              {messages.length === 0 ? (
                <p className="muted">
                  Nessun messaggio. Esegui Sync (e poi Classifica) dalla casella.
                </p>
              ) : (
                <table className="messages">
                  <thead>
                    <tr>
                      <th>Da</th>
                      <th>Oggetto</th>
                      <th>Cartella</th>
                      <th>Data</th>
                    </tr>
                  </thead>
                  <tbody>
                    {messages.map((m) => (
                      <tr
                        key={m.id}
                        className={[
                          "msg-row",
                          openId === m.id ? "msg-row-active" : "",
                          dragMsgId === m.id ? "msg-row-dragging" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        draggable
                        onDragStart={(e) => onMsgDragStart(e, m.id)}
                        onDragEnd={onMsgDragEnd}
                        onClick={() => {
                          if (suppressClickRef.current) {
                            suppressClickRef.current = false;
                            return;
                          }
                          setOpenId(m.id);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setOpenId(m.id);
                          }
                        }}
                        tabIndex={0}
                        role="button"
                        aria-label={`Apri o trascina: ${m.subject || "senza oggetto"}`}
                      >
                        <td>{m.from}</td>
                        <td>
                          <div className="msg-subject">
                            {m.subject || "(senza oggetto)"}
                          </div>
                          <div className="muted">{m.snippet}</div>
                        </td>
                        <td>
                          {m.folderName ? (
                            <span className="folder-tag">{m.folderName}</span>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td>{new Date(m.date).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </div>
      </main>

      {openId ? (
        <div
          className="modal-backdrop mail-reader-backdrop"
          onClick={closeReader}
          role="presentation"
        >
          <div
            className="mail-reader"
            role="dialog"
            aria-modal="true"
            aria-labelledby="mail-reader-subject"
            onClick={(ev) => ev.stopPropagation()}
          >
            <div className="mail-reader-top">
              <div className="row">
                <button
                  type="button"
                  className="secondary btn-sm"
                  onClick={openPrev}
                  disabled={openIndex <= 0 || deleting}
                >
                  ← Prec
                </button>
                <button
                  type="button"
                  className="secondary btn-sm"
                  onClick={openNext}
                  disabled={
                    openIndex < 0 ||
                    openIndex >= messages.length - 1 ||
                    deleting
                  }
                >
                  Succ →
                </button>
              </div>
              <div className="row">
                <button
                  type="button"
                  className="danger btn-sm btn-icon"
                  onClick={() => setConfirmDelete(true)}
                  disabled={!detail || deleting}
                  title="Elimina da app e da IMAP"
                  aria-label="Elimina messaggio"
                >
                  <IconTrash /> Elimina
                </button>
                <button
                  type="button"
                  className="secondary btn-sm btn-icon"
                  onClick={closeReader}
                  aria-label="Chiudi"
                  disabled={deleting}
                >
                  <IconX /> Chiudi
                </button>
              </div>
            </div>

            {detailLoading ? (
              <p className="muted">Caricamento messaggio…</p>
            ) : null}
            {detailError ? <p className="error">{detailError}</p> : null}

            {detail ? (
              <>
                <h2 id="mail-reader-subject">
                  {detail.subject || "(senza oggetto)"}
                </h2>
                <div className="mail-reader-meta">
                  <div>
                    <span className="muted">Da</span>
                    <strong>{detail.from}</strong>
                  </div>
                  <div>
                    <span className="muted">A</span>
                    <span>{detail.to || "—"}</span>
                  </div>
                  {detail.cc ? (
                    <div>
                      <span className="muted">Cc</span>
                      <span>{detail.cc}</span>
                    </div>
                  ) : null}
                  <div>
                    <span className="muted">Data</span>
                    <span>{new Date(detail.date).toLocaleString()}</span>
                  </div>
                  <div>
                    <span className="muted">Cartella</span>
                    <span>
                      {detail.folderName ? (
                        <span className="folder-tag">{detail.folderName}</span>
                      ) : (
                        "In attesa classifica"
                      )}
                    </span>
                  </div>
                  <div>
                    <span className="muted">IMAP</span>
                    <span>{detail.imapFolder}</span>
                  </div>
                </div>
                {detail.classification ? (
                  <p className="job-badge">
                    Classificazione: {detail.classification.reason}
                  </p>
                ) : null}
                <pre className="mail-reader-body">
                  {detail.bodyText || "(vuoto)"}
                </pre>
              </>
            ) : null}
          </div>

          {confirmDelete ? (
            <div
              className="modal-backdrop mail-confirm-backdrop"
              onClick={() => !deleting && setConfirmDelete(false)}
              role="presentation"
            >
              <div
                className="modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="delete-msg-title"
                onClick={(ev) => ev.stopPropagation()}
              >
                <h2 id="delete-msg-title" className="btn-icon">
                  <IconTrash /> Elimina messaggio
                </h2>
                <p>
                  Eliminazione <strong>reale</strong> da questa app e dal server
                  IMAP ({detail?.imapFolder || "INBOX"}). Non si può annullare.
                </p>
                <p className="muted">
                  {detail?.subject || "(senza oggetto)"}
                </p>
                <div className="modal-actions">
                  <button
                    type="button"
                    className="secondary btn-icon"
                    onClick={() => setConfirmDelete(false)}
                    disabled={deleting}
                  >
                    <IconX /> Annulla
                  </button>
                  <button
                    type="button"
                    className="danger btn-icon"
                    onClick={() => void deleteCurrentMessage()}
                    disabled={deleting}
                  >
                    <IconTrash /> {deleting ? "Elimino…" : "Elimina da server di posta"}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <JobProgressOverlay
        job={jobProgress}
        onDismiss={() => setJobProgress(null)}
      />
    </div>
  );
}
