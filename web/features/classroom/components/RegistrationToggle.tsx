"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiFetch } from "@/shared/api/client";
import { fetchAuthStatus } from "@/lib/auth";

/** Admin control for open self-registration (classroom fork feature). */
export function RegistrationToggle() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState("student");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    void fetchAuthStatus().then((status) => {
      if (!alive) return;
      setOpen(Boolean((status as { registration_open?: boolean }).registration_open));
    });
    return () => {
      alive = false;
    };
  }, []);

  async function save(nextOpen: boolean, nextRole: string) {
    setBusy(true);
    setError("");
    try {
      const res = await apiFetch("/api/auth/registration", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allow_registration: nextOpen, registration_role: nextRole }),
      });
      if (!res.ok) throw new Error((await res.json()).detail ?? res.statusText);
      setOpen(nextOpen);
      setRole(nextRole);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-2.5 py-1.5">
      <label className="flex items-center gap-1.5 text-xs text-[var(--foreground)]">
        <input
          type="checkbox"
          checked={open}
          disabled={busy}
          onChange={(event) => void save(event.target.checked, role)}
        />
        {t("Allow open self-registration")}
      </label>
      <select
        value={role}
        disabled={busy || !open}
        aria-label={t("Registration role")}
        onChange={(event) => void save(open, event.target.value)}
        className="rounded border border-[var(--border)] bg-[var(--background)] px-1 py-0.5 text-xs"
      >
        <option value="student">{t("Student")}</option>
        <option value="user">{t("User")}</option>
      </select>
      {error && <span className="text-xs text-[var(--destructive)]">{error}</span>}
    </div>
  );
}
