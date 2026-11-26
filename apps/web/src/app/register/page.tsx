"use client";

import Link from "next/link";

export default function RegisterPage() {
  return (
    <main>
      <div className="panel" style={{ maxWidth: 420, margin: "3rem auto" }}>
        <h1>Registrazione disabilitata</h1>
        <p className="muted">
          Gli account vengono creati solo da un super admin.
        </p>
        <p>
          <Link href="/login">Vai al login</Link>
        </p>
      </div>
    </main>
  );
}
