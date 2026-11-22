"use client";
/* Phones: a pass button at the bottom of the screen, shown only while the sign-in panel is
   out of view (it would cover it otherwise). */

import { useEffect, useState } from "react";

export function MobileCta() {
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    // The panel itself: #join has no box of its own (display: contents).
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
    <a href="#join" className={`mobile-cta ${hidden ? "hide" : ""}`} aria-hidden={hidden} tabIndex={hidden ? -1 : 0}>
      <span className="live" aria-hidden="true" /> Get your early-access pass
    </a>
  );
}
