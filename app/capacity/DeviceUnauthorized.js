'use client';

// Full-screen "this Jelly2 isn't set up" state. Shown on a door page when no
// valid device token (or team session) is present — e.g. the link was never
// pasted, the token was mistyped, or the admin revoked it. Deliberately gives
// no detail beyond "ask an admin for a fresh setup link", so a stale/guessed
// token reveals nothing about why it failed.
export default function DeviceUnauthorized({ door = 'Door' }) {
  return (
    <main
      className="fixed inset-0 flex flex-col items-center justify-center text-center select-none px-6"
      style={{ background: '#0a0a0a', color: '#f5f5f5' }}
    >
      <div
        className="text-[13px] font-bold tracking-[0.18em] uppercase mb-3"
        style={{ color: '#ff8a8a' }}
      >
        {door} · Not authorized
      </div>
      <div
        className="text-[22px] font-extrabold mb-3"
        style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
      >
        Device not authorized
      </div>
      <p className="text-[14px] max-w-[18rem]" style={{ color: '#8a8a8a' }}>
        This device isn’t set up for the capacity counter yet. Ask an admin to
        open Capacity → Setup, create a {door} device link, and re-open it on
        this phone.
      </p>
    </main>
  );
}
