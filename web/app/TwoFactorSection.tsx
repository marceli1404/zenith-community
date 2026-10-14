import { useState } from "react";
import QRCode from "qrcode";
import { ShieldCheck, Copy, Check } from "../components/lucide";
import { authClient } from "../lib/auth";
import { toast } from "../lib/toast";
import { Button, Input, Spinner } from "../components/ui";
import { MotionIcon } from "../components/MotionIcon";

type Step = "idle" | "password" | "show" | "verify" | "disabling";

/** Two-factor authentication (TOTP) management. Enrolment: password → QR +
 *  backup codes → confirm a code. The secret/QR are generated locally; nothing
 *  is sent to any third party. */
export function TwoFactorSection({ enabled, onChange }: { enabled: boolean; onChange: () => void }) {
  const [step, setStep] = useState<Step>("idle");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState<string>("");
  const [secret, setSecret] = useState<string>("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  function reset() {
    setStep("idle"); setPassword(""); setCode(""); setQr(""); setSecret(""); setBackupCodes([]); setBusy(false);
  }

  async function beginEnable() {
    setBusy(true);
    const { data, error } = await authClient.twoFactor.enable({ password });
    setBusy(false);
    if (error || !data) {
      toast.error(error?.message || "Couldn't start setup. Check your password.");
      return;
    }
    try {
      setQr(await QRCode.toDataURL(data.totpURI, { margin: 1, width: 200 }));
    } catch { /* QR is a convenience; the manual key still works */ }
    const m = /[?&]secret=([^&]+)/.exec(data.totpURI);
    setSecret(m ? decodeURIComponent(m[1]!) : "");
    setBackupCodes(data.backupCodes ?? []);
    setPassword("");
    setStep("show");
  }

  async function confirm() {
    setBusy(true);
    const { error } = await authClient.twoFactor.verifyTotp({ code: code.trim() });
    setBusy(false);
    if (error) {
      toast.error(error.message || "That code didn't match. Try the current one.");
      return;
    }
    toast.success("Two-factor authentication is on.");
    reset();
    onChange();
  }

  async function disable() {
    setBusy(true);
    const { error } = await authClient.twoFactor.disable({ password });
    setBusy(false);
    if (error) {
      toast.error(error.message || "Couldn't disable. Check your password.");
      return;
    }
    toast.success("Two-factor authentication is off.");
    reset();
    onChange();
  }

  function copyCodes() {
    navigator.clipboard.writeText(backupCodes.join("\n")).then(
      () => { setCopied(true); setTimeout(() => setCopied(false), 2000); },
      () => toast.error("Couldn't copy the codes."),
    );
  }

  return (
    <div className="settings-row settings-row-stacked">
      <div className="flex items-start justify-between gap-4">
        <div className="settings-method">
          <MotionIcon icon={ShieldCheck} motion="shield" size={17} />
          <div>
            <strong>Two-factor authentication</strong>
            <p>{enabled ? "On. You'll be asked for a code from your authenticator app when you sign in." : "Add a code from an authenticator app to your sign-in."}</p>
          </div>
        </div>
        {step === "idle" && (
          enabled
            ? <Button variant="secondary" size="sm" onClick={() => setStep("disabling")}>Disable</Button>
            : <Button variant="secondary" size="sm" onClick={() => setStep("password")}>Enable</Button>
        )}
      </div>

      {step === "password" && (
        <form className="mt-2 space-y-3" onSubmit={(e) => { e.preventDefault(); if (password) beginEnable(); }}>
          <p className="text-sm text-muted">Confirm your password to begin.</p>
          <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Current password" aria-label="Current password" />
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={busy || !password}>{busy ? <Spinner /> : "Continue"}</Button>
            <Button type="button" variant="ghost" size="sm" onClick={reset}>Cancel</Button>
          </div>
        </form>
      )}

      {step === "show" && (
        <div className="mt-2 space-y-4">
          <div>
            <p className="text-sm text-text font-medium">1. Scan this with your authenticator app</p>
            <p className="text-xs text-muted mt-0.5">Google Authenticator, 1Password, Authy, etc.</p>
            {qr && <img src={qr} alt="Two-factor QR code" width={180} height={180} className="mt-3 rounded-[var(--radius)] border border-border bg-white p-2" />}
            {secret && (
              <p className="text-xs text-muted mt-2">Or enter this key manually: <code className="font-mono text-text break-all">{secret}</code></p>
            )}
          </div>
          {backupCodes.length > 0 && (
            <div>
              <div className="flex items-center justify-between">
                <p className="text-sm text-text font-medium">2. Save your backup codes</p>
                <button type="button" onClick={copyCodes} className="inline-flex items-center gap-1.5 text-xs text-accent">
                  {copied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy</>}
                </button>
              </div>
              <p className="text-xs text-muted mt-0.5">Each works once if you lose your device. Store them somewhere safe.</p>
              <div className="mt-2 grid grid-cols-2 gap-1.5 font-mono text-xs text-text">
                {backupCodes.map((c) => <span key={c} className="rounded-[var(--radius)] border border-border bg-surface-2 px-2 py-1">{c}</span>)}
              </div>
            </div>
          )}
          <form onSubmit={(e) => { e.preventDefault(); if (code.trim()) confirm(); }} className="space-y-2">
            <p className="text-sm text-text font-medium">3. Enter the current 6-digit code to finish</p>
            <Input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={8} placeholder="123456" aria-label="Authentication code" />
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={busy || !code.trim()}>{busy ? <Spinner /> : "Turn on"}</Button>
              <Button type="button" variant="ghost" size="sm" onClick={reset}>Cancel</Button>
            </div>
          </form>
        </div>
      )}

      {step === "disabling" && (
        <form className="mt-2 space-y-3" onSubmit={(e) => { e.preventDefault(); if (password) disable(); }}>
          <p className="text-sm text-muted">Confirm your password to turn off two-factor authentication.</p>
          <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Current password" aria-label="Current password" />
          <div className="flex gap-2">
            <Button type="submit" variant="danger" size="sm" disabled={busy || !password}>{busy ? <Spinner /> : "Disable 2FA"}</Button>
            <Button type="button" variant="ghost" size="sm" onClick={reset}>Cancel</Button>
          </div>
        </form>
      )}
    </div>
  );
}
