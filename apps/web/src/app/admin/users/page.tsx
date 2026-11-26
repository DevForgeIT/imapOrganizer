"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import {
  IconEdit,
  IconPlus,
  IconSave,
  IconTrash,
  IconUsers,
  IconX,
} from "@/components/Icons";
import { api, ApiError } from "@/lib/api";
import type { UserPublic } from "@imap-organizer/shared";

type AdminUser = {
  id: string;
  email: string;
  role: "super_admin" | "user";
  active: boolean;
  createdAt: string;
};

type ModalMode = "edit" | "delete" | null;

export default function AdminUsersPage() {
  const router = useRouter();
  const [me, setMe] = useState<UserPublic | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [modal, setModal] = useState<ModalMode>(null);
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const user = await api<UserPublic>("/auth/me");
    if (user.role !== "super_admin") {
      router.replace("/mailboxes");
      return;
    }
    setMe(user);
    setUsers(await api<AdminUser[]>("/admin/users"));
  }, [router]);

  useEffect(() => {
    void load().catch((err) =>
      setError(err instanceof ApiError ? err.message : "Load failed"),
    );
  }, [load]);

  function openEdit(u: AdminUser) {
    setError("");
    setOk("");
    setSelected(u);
    setModal("edit");
  }

  function openDelete(u: AdminUser) {
    setError("");
    setOk("");
    setSelected(u);
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
    setOk("");
    const form = e.currentTarget;
    const fd = new FormData(form);
    const email = String(fd.get("email") || "").trim();
    const password = String(fd.get("password") || "");
    const role = String(fd.get("role") || "user");
    if (password.length < 8) {
      setError("Password minimo 8 caratteri");
      return;
    }
    try {
      const created = await api<{ email: string }>("/admin/users", {
        method: "POST",
        json: { email, password, role },
      });
      form.reset();
      setOk(`Utente creato: ${created.email}`);
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
    setOk("");
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get("email") || "").trim();
    const password = String(fd.get("password") || "");
    const role = String(fd.get("role") || "user");
    const active = fd.get("active") === "on";

    const payload: Record<string, unknown> = {
      email,
      role,
      active,
    };
    if (password) {
      if (password.length < 8) {
        setError("Password minimo 8 caratteri (o lascia vuota)");
        setBusy(false);
        return;
      }
      payload.password = password;
    }

    try {
      const updated = await api<AdminUser>(`/admin/users/${selected.id}`, {
        method: "PATCH",
        json: payload,
      });
      setOk(`Utente aggiornato: ${updated.email}`);
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
    setOk("");
    try {
      await api(`/admin/users/${selected.id}`, { method: "DELETE" });
      setOk(`Utente eliminato: ${selected.email}`);
      setModal(null);
      setSelected(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <AppHeader email={me?.email} role={me?.role} />
      <main>
        <h1 className="btn-icon">
          <IconUsers size={28} /> Gestione utenti
        </h1>
        <p className="muted">
          Solo super admin. La registrazione pubblica è disabilitata.
        </p>
        {error ? <p className="error">{error}</p> : null}
        {ok ? <p className="job-badge ok">{ok}</p> : null}

        <div className="panel">
          <h2 className="btn-icon">
            <IconPlus /> Crea utente
          </h2>
          <form className="stack" onSubmit={onCreate}>
            <div className="row">
              <label>
                Email
                <input name="email" type="email" required />
              </label>
              <label>
                Password
                <input name="password" type="password" required minLength={8} />
              </label>
              <label>
                Ruolo
                <select name="role" defaultValue="user">
                  <option value="user">user</option>
                  <option value="super_admin">super_admin</option>
                </select>
              </label>
            </div>
            <button type="submit" className="btn-icon">
              <IconPlus /> Crea
            </button>
          </form>
        </div>

        <div className="panel">
          <h2 className="btn-icon">
            <IconUsers /> Utenti
          </h2>
          <table className="messages">
            <thead>
              <tr>
                <th>Email</th>
                <th>Ruolo</th>
                <th>Stato</th>
                <th>Creato</th>
                <th>Azioni</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.email}</td>
                  <td>{u.role}</td>
                  <td>{u.active ? "active" : "disabled"}</td>
                  <td>{new Date(u.createdAt).toLocaleString()}</td>
                  <td>
                    <div className="row">
                      <button
                        type="button"
                        className="secondary btn-sm btn-icon"
                        onClick={() => openEdit(u)}
                        title="Modifica"
                      >
                        <IconEdit /> Modifica
                      </button>
                      <button
                        type="button"
                        className="danger btn-sm btn-icon"
                        onClick={() => openDelete(u)}
                        disabled={me?.id === u.id}
                        title={
                          me?.id === u.id
                            ? "Non puoi cancellare te stesso"
                            : "Elimina"
                        }
                      >
                        <IconTrash /> Elimina
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>

      {modal === "edit" && selected ? (
        <div className="modal-backdrop" onClick={closeModal} role="presentation">
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-user-title"
            onClick={(ev) => ev.stopPropagation()}
          >
            <h2 id="edit-user-title" className="btn-icon">
              <IconEdit /> Modifica utente
            </h2>
            <form className="stack" onSubmit={onEdit}>
              <label>
                Email
                <input
                  name="email"
                  type="email"
                  required
                  defaultValue={selected.email}
                />
              </label>
              <label>
                Nuova password (opzionale)
                <input name="password" type="password" minLength={8} />
              </label>
              <label>
                Ruolo
                <select name="role" defaultValue={selected.role}>
                  <option value="user">user</option>
                  <option value="super_admin">super_admin</option>
                </select>
              </label>
              <label
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: "0.5rem",
                }}
              >
                <input
                  name="active"
                  type="checkbox"
                  defaultChecked={selected.active}
                />
                Attivo
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
            aria-labelledby="delete-user-title"
            onClick={(ev) => ev.stopPropagation()}
          >
            <h2 id="delete-user-title" className="btn-icon">
              <IconTrash /> Elimina utente
            </h2>
            <p>
              Confermi l&apos;eliminazione di{" "}
              <strong>{selected.email}</strong>? L&apos;operazione non è
              reversibile.
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
    </>
  );
}
