"use client";
/* Every "Get your pass" on the page: signed out, it opens the sign-in popup; signed in, it
   goes to the pass. The hero's Access component listens for the event. */

export const PASS_EVENT = "kixo:pass";

export function openPass() {
  window.dispatchEvent(new Event(PASS_EVENT));
}

export function PassButton({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <button type="button" className={className} onClick={openPass}>
      {children}
    </button>
  );
}
