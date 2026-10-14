import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Download, Monitor, Trash2 } from "../components/lucide";
import { api, ApiError } from "../lib/api";
import { toast } from "../lib/toast";
import { useAuth } from "../lib/auth";
import { Button, ConfirmDialog, Input, Spinner } from "../components/ui";
import { PageHeader, Panel } from "./ConsoleKit";
import { TwoFactorSection } from "./TwoFactorSection";

interface AccountSettings {
  profile: { name: string; email: string; emailVerified: boolean; createdAt: number; twoFactorEnabled: boolean };
  connectedProviders: string[];
  notificationPreferences: { downtime: boolean; recovery: boolean; auditFinished: boolean };
  sessions: Array<{ id: string; expiresAt: number; createdAt: number; updatedAt: number; userAgent: string | null; current: boolean }>;
}

const DATE = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export default function Settings() {
  const { signOut } = useAuth();
  const [settings, setSettings] = useState<AccountSettings | null>(null);
  const [error, setError] = useState(false);
  const [name, setName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busySession, setBusySession] = useState("");

  const load = useCallback(async () => {
    try {
      const value = await api.get<AccountSettings>("/api/account/settings");
      setSettings(value);
      setName(value.profile.name);
      setError(false);
    } catch { setError(true); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function saveName(event: FormEvent) {
    event.preventDefault();
    const next = name.trim();
    if (!next || !settings) return;
    setSavingName(true);
    try {
      await api.patch("/api/account/settings/profile", { name: next });
      toast.success("Name updated.");
      await load();
    } catch (err) { toast.error(err instanceof ApiError ? err.message : "Could not update your name."); }
    finally { setSavingName(false); }
  }

  async function saveNotification(key: keyof AccountSettings["notificationPreferences"], checked: boolean) {
    if (!settings) return;
    const next = { ...settings.notificationPreferences, [key]: checked };
    setSettings({ ...settings, notificationPreferences: next });
    try { await api.patch("/api/account/settings/notifications", next); }
    catch (err) {
      setSettings(settings);
      toast.error(err instanceof ApiError ? err.message : "Could not save notification preferences.");
    }
  }

  async function revokeSession(id: string) {
    setBusySession(id);
    try { await api.del(`/api/account/sessions/${encodeURIComponent(id)}`); await load(); toast.success("Session signed out."); }
    catch (err) { toast.error(err instanceof ApiError ? err.message : "Could not end that session."); }
    finally { setBusySession(""); }
  }

  async function revokeOthers() {
    setBusySession("others");
    try { await api.del("/api/account/sessions/others"); await load(); toast.success("Other sessions signed out."); }
    catch (err) { toast.error(err instanceof ApiError ? err.message : "Could not end other sessions."); }
    finally { setBusySession(""); }
  }

  async function deleteAccount() {
    setDeleting(true);
    try {
      await api.del("/api/account");
      await signOut();
      window.location.assign("/");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not delete the account.");
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  if (!settings) return <div className="cn-page"><PageHeader title="Settings" description="Your profile, notifications, security, and data." />{error ? <Panel title="Settings could not load" actions={<Button onClick={load}>Retry</Button>}>Check your connection and try again.</Panel> : <Spinner />}</div>;

  return <div className="cn-page">
    <PageHeader title="Settings" description="Manage your profile, notifications, sign-in security, and account data." />
    <ConfirmDialog open={confirmDelete} title="Delete your account?" description="This permanently deletes your account and its sites, monitoring history, incidents, audits, and reports." confirmLabel="Delete account" loading={deleting} onConfirm={deleteAccount} onClose={() => setConfirmDelete(false)} />
    <Panel title="Profile" description="Your account name and email address.">
      <form onSubmit={saveName} className="space-y-3">
        <label className="block text-sm">Name<Input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required /></label>
        <p className="cn-muted">{settings.profile.email} · {settings.profile.emailVerified ? "verified" : "not verified"}</p>
        <Button type="submit" disabled={savingName || name.trim() === settings.profile.name}>{savingName ? <Spinner /> : "Save name"}</Button>
      </form>
    </Panel>
    <Panel title="Notifications" description="Choose which operational emails Zenith sends you.">
      <div className="space-y-3">
        {([["downtime", "Downtime alerts"], ["recovery", "Recovery alerts"], ["auditFinished", "Audit completed"]] as const).map(([key, label]) => <label key={key} className="flex items-center gap-3"><input type="checkbox" checked={settings.notificationPreferences[key]} onChange={(event) => void saveNotification(key, event.target.checked)} />{label}</label>)}
      </div>
    </Panel>
    <Panel title="Sign-in security" description="Protect your account and review active sessions.">
      <TwoFactorSection enabled={settings.profile.twoFactorEnabled} onChange={() => void load()} />
      <div className="mt-4 space-y-3">
        {settings.sessions.map((session) => <div key={session.id} className="flex items-center justify-between gap-3"><div><strong><Monitor size={15} /> {session.current ? "This session" : session.userAgent || "Signed-in device"}</strong><p className="cn-muted">Last active {DATE.format(new Date(session.updatedAt))} · expires {DATE.format(new Date(session.expiresAt))}</p></div>{!session.current && <Button variant="secondary" size="sm" disabled={busySession === session.id} onClick={() => void revokeSession(session.id)}>{busySession === session.id ? <Spinner /> : "Sign out"}</Button>}</div>)}
        {settings.sessions.filter((session) => !session.current).length > 1 && <Button variant="ghost" size="sm" disabled={busySession === "others"} onClick={() => void revokeOthers()}>{busySession === "others" ? <Spinner /> : "Sign out other sessions"}</Button>}
      </div>
    </Panel>
    <Panel title="Your data" description="Export a copy or permanently delete your account.">
      <div className="flex flex-wrap gap-3"><a href="/api/account/export" className="cn-button"><Download size={16} /> Export account data</a><Button variant="danger" onClick={() => setConfirmDelete(true)}><Trash2 size={16} /> Delete account</Button></div>
    </Panel>
  </div>;
}
