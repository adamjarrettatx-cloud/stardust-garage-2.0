"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Wordmark from "@/app/components/Wordmark";
import { pinProblem, birthdateProblem } from "@/lib/time-clock/profile.mjs";
import { chicagoYmd } from "@/lib/time-clock/periods.mjs";

// Shrink large camera photos in the browser before upload (JPEG, longest
// side 1280px). Formats the browser cannot decode (e.g. HEIC outside
// Safari) are sent as-is; the server enforces type and size either way.
export async function preparePhoto(file) {
  if (!file) return null;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
    if (blob && blob.size >= 1024) return new File([blob], "photo.jpg", { type: "image/jpeg" });
  } catch {
    /* Fall through to the original file. */
  }
  return file;
}

export function PinBoxes({ id, label, value, onChange, disabled, autoFocus }) {
  const ref = useRef(null);
  const [focused, setFocused] = useState(false);
  return (
    <div>
      <label htmlFor={id} className="block text-xs text-[#aaa] mb-2">{label}</label>
      <div className="relative inline-flex gap-2" onClick={() => ref.current?.focus()}>
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            aria-hidden="true"
            className={`w-11 h-12 rounded-[6px] border bg-[#0a0a0a] flex items-center justify-center text-xl ${
              focused && (value.length === i || (value.length === 4 && i === 3)) ? "border-white" : "border-white/20"
            }`}
          >
            {value[i] ? "•" : ""}
          </span>
        ))}
        <input
          ref={ref}
          id={id}
          type="password"
          inputMode="numeric"
          autoComplete="off"
          pattern="[0-9]{4}"
          maxLength={4}
          value={value}
          disabled={disabled}
          autoFocus={autoFocus}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 4))}
          className="absolute inset-0 w-full h-full opacity-0 cursor-text"
        />
      </div>
    </div>
  );
}

export function PhotoPicker({ file, onFile, disabled, existingUrl }) {
  const [preview, setPreview] = useState(null);
  useEffect(() => {
    if (!file) return setPreview(null);
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const shown = preview || existingUrl;
  return (
    <div className="flex gap-4 items-center">
      <label className="w-20 h-20 shrink-0 rounded-[6px] border border-dashed border-white/30 bg-[#0a0a0a] flex items-center justify-center text-[11px] text-[#999] text-center leading-tight overflow-hidden cursor-pointer">
        {shown ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shown} alt="Your photo" className="w-full h-full object-cover" />
        ) : (
          <span className="px-2">Take or upload photo</span>
        )}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
          className="sr-only"
          disabled={disabled}
          onChange={(e) => onFile(e.target.files?.[0] || null)}
        />
      </label>
      <div className="text-sm text-[#ddd]">
        Clear photo of your face.
        <p className="text-xs text-[#999] mt-1">Only managers can see this photo.</p>
        {shown && <p className="text-xs text-[#999] mt-1">Tap the photo to change it.</p>}
      </div>
    </div>
  );
}

const card = "rounded-[8px] border border-white/10 bg-[#141414] p-4";
const input =
  "w-full rounded-[6px] border border-white/20 bg-[#0a0a0a] px-3 py-2.5 text-base text-white outline-none focus:border-white disabled:opacity-60";
const req = <span className="ml-1.5 text-[11px] font-normal text-[#e58f86]">required</span>;

export default function EmployeeSetup({ token, invite }) {
  const [form, setForm] = useState({
    username: invite?.username || "",
    password: "",
    confirm: "",
    pin: "",
    pinConfirm: "",
    birthdate: "",
  });
  const [photo, setPhoto] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(null);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const pinOnly = invite?.kind === "pin";
  const needsPassword = !pinOnly && !invite?.existingAccount;

  async function submit(e) {
    e.preventDefault();
    setError("");
    const problem =
      (needsPassword && form.password.length < 10 && "Use a password of at least 10 characters.") ||
      (needsPassword && form.password !== form.confirm && "The passwords do not match.") ||
      pinProblem(form.pin, form.pinConfirm) ||
      (!pinOnly && birthdateProblem(form.birthdate, chicagoYmd())) ||
      (!pinOnly && !photo && "Add a photo of yourself.");
    if (problem) return setError(problem);
    setBusy(true);
    try {
      const body = new FormData();
      body.append("token", token);
      body.append("pin", form.pin);
      body.append("pin_confirm", form.pinConfirm);
      if (!pinOnly) {
        body.append("username", form.username);
        body.append("birthdate", form.birthdate);
        if (needsPassword) body.append("password", form.password);
        const prepared = await preparePhoto(photo);
        body.append("photo", prepared, prepared.name || "photo.jpg");
      }
      const res = await fetch("/api/employee/setup", { method: "POST", credentials: "same-origin", body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Setup failed. Try again.");
      if (data.destination) return window.location.replace(data.destination);
      setDone(data);
      setBusy(false);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-[#f5f5f5] flex justify-center px-5 py-12">
      <div className="w-full max-w-[680px]">
        <div className="flex justify-center mb-8">
          <Wordmark size="md" align="center" />
        </div>
        {!invite ? (
          <div className="max-w-[420px] mx-auto text-center">
            <h1 className="text-2xl font-bold mb-3">This link has expired</h1>
            <p className="text-sm text-[#aaa] mb-6">
              Setup links work once and expire after 72 hours. Ask a manager to resend your invite.
            </p>
            <Link href="/employee/login" className="underline text-sm">Go to employee sign in</Link>
          </div>
        ) : done ? (
          <div className="max-w-[420px] mx-auto text-center">
            <h1 className="text-2xl font-bold mb-3">{pinOnly ? "PIN saved" : "You're all set"}</h1>
            <p className="text-sm text-[#aaa] mb-6">{done.text}</p>
            <Link href="/employee/login" className="inline-block rounded-[8px] bg-white text-black px-5 py-3 font-semibold">
              Go to employee sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} noValidate>
            <h1 className="text-2xl font-bold mb-1">{pinOnly ? "Choose a new iPad PIN" : "Set up your account"}</h1>
            <p className="text-sm text-[#aaa] mb-6">
              {invite.name}
              {invite.roles.length ? ` · ${invite.roles.join(", ")}` : ""}
            </p>
            <div className={pinOnly ? "grid gap-3 max-w-[340px]" : "grid gap-3 sm:grid-cols-2"}>
              {!pinOnly && (
                <section className={card}>
                  <h2 className="text-sm font-semibold mb-3">Login</h2>
                  <label className="block text-xs text-[#aaa] mb-1.5" htmlFor="setup-username">Username</label>
                  <input id="setup-username" className={`${input} mb-3`} autoCapitalize="none" spellCheck={false}
                    autoComplete="username" maxLength={32} value={form.username} disabled={busy}
                    onChange={(e) => set("username", e.target.value.toLowerCase())} />
                  {needsPassword ? (
                    <>
                      <label className="block text-xs text-[#aaa] mb-1.5" htmlFor="setup-password">Password{req}</label>
                      <input id="setup-password" type="password" className={`${input} mb-3`} autoComplete="new-password"
                        minLength={10} maxLength={72} value={form.password} disabled={busy}
                        onChange={(e) => set("password", e.target.value)} />
                      <label className="block text-xs text-[#aaa] mb-1.5" htmlFor="setup-confirm">Confirm password</label>
                      <input id="setup-confirm" type="password" className={input} autoComplete="new-password"
                        minLength={10} maxLength={72} value={form.confirm} disabled={busy}
                        onChange={(e) => set("confirm", e.target.value)} />
                      <p className="text-xs text-[#999] mt-2">At least 10 characters. You can also sign in with {invite.email}.</p>
                    </>
                  ) : (
                    <p className="text-xs text-[#999]">
                      {invite.email} already has a Stardust Garage account. Keep using its current password to sign in.
                    </p>
                  )}
                </section>
              )}
              <section className={card}>
                <h2 className="text-sm font-semibold mb-3">iPad clock-in PIN{req}</h2>
                <div className="grid gap-3">
                  <PinBoxes id="setup-pin" label="PIN" value={form.pin} disabled={busy} autoFocus={pinOnly}
                    onChange={(v) => set("pin", v)} />
                  <PinBoxes id="setup-pin-confirm" label="Confirm PIN" value={form.pinConfirm} disabled={busy}
                    onChange={(v) => set("pinConfirm", v)} />
                </div>
                <p className="text-xs text-[#999] mt-3">Four digits. Easy PINs like 1234 or 0000 aren't allowed.</p>
              </section>
              {!pinOnly && (
                <section className={card}>
                  <h2 className="text-sm font-semibold mb-3"><label htmlFor="setup-birthdate">Birthday</label>{req}</h2>
                  <input id="setup-birthdate" type="date" className={`${input} [color-scheme:dark]`} max={chicagoYmd()}
                    value={form.birthdate} disabled={busy} onChange={(e) => set("birthdate", e.target.value)} />
                </section>
              )}
              {!pinOnly && (
                <section className={card}>
                  <h2 className="text-sm font-semibold mb-3">Private photo{req}</h2>
                  <PhotoPicker file={photo} onFile={setPhoto} disabled={busy} />
                </section>
              )}
            </div>
            {error && <p className="text-sm text-red-300 mt-4" role="alert">{error}</p>}
            <button type="submit" disabled={busy}
              className="mt-5 rounded-[8px] bg-white text-black px-6 py-3 font-semibold disabled:opacity-50">
              {busy ? "Saving…" : pinOnly ? "Save PIN" : "Finish setup"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
