"use client";
/* Phones: a pass button at the bottom of the screen. Shown only to people not signed in
   (html[data-signed-in] set by Access), and only while the sign-in panel is out of view.
   It opens the sign-in popup. */

import { useEffect, useState } from "react";
import { openPass } from "./pass-button";

export function MobileCta() {
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    const target = document.querySelector(".access-act");
    if (!target || !("IntersectionObserver" in window)) {
      setHidden(false);
      return;
    }
    const io = new IntersectionObserver(([e]) => setHidden(e.isIntersecting), { threshold: 0.05 });
    io.observe(target);
    return () => io.disconnect();
  }, []);
  return (
    <button type="button" onClick={openPass} className={`mobile-cta ${hidden ? "hide" : ""}`} aria-hidden={hidden} tabIndex={hidden ? -1 : 0}>
      <span className="live" aria-hidden="true" /> Get your early-access pass
    </button>
  );
}
