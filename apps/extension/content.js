// Kixo for X: a small "Kixo" button after every $cashtag, and an "Open on Kixo" button
// under posts that contain a Solana coin address. It only reads the page and adds links;
// it never posts, likes or reads anything private.
(() => {
  const DEFAULT_SITE = "https://kixo.trade";
  let site = DEFAULT_SITE;
  const MINT = /(?:^|[^1-9A-HJ-NP-Za-km-z])([1-9A-HJ-NP-Za-km-z]{32,44})(?![1-9A-HJ-NP-Za-km-z])/g;

  chrome.storage.sync.get({ site: DEFAULT_SITE }, (v) => {
    site = String(v.site || DEFAULT_SITE).replace(/\/+$/, "");
    scan(document.body);
  });
  chrome.storage.onChanged.addListener((c) => {
    if (c.site) site = String(c.site.newValue || DEFAULT_SITE).replace(/\/+$/, "");
  });

  function button(href, label, title) {
    const a = document.createElement("a");
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.className = "kixo-x-btn";
    a.textContent = label;
    a.title = title;
    a.addEventListener("click", (e) => e.stopPropagation());
    return a;
  }

  function cashtags(root) {
    // X renders a cashtag as a link to its search: /search?q=%24BONK
    for (const link of root.querySelectorAll('a[href*="/search?q=%24"]:not([data-kixo])')) {
      link.setAttribute("data-kixo", "1");
      const q = ((link.getAttribute("href") || "").split("q=")[1] || "").split("&")[0];
      const sym = decodeURIComponent(q).replace(/^\$/, "").replace(/[^A-Za-z0-9]/g, "");
      if (!sym || sym.length > 12) continue;
      link.after(button(`${site}/x/${encodeURIComponent(sym)}`, "Kixo", `Trade $${sym} on Kixo`));
    }
  }

  function addresses(root) {
    for (const text of root.querySelectorAll('[data-testid="tweetText"]:not([data-kixo])')) {
      text.setAttribute("data-kixo", "1");
      const found = new Set();
      for (const m of (text.innerText || "").matchAll(MINT)) found.add(m[1]);
      if (!found.size) continue;
      const bar = document.createElement("div");
      bar.className = "kixo-x-bar";
      for (const mint of [...found].slice(0, 3)) {
        bar.append(button(`${site}/token/${mint}`, `Open ${mint.slice(0, 4)}…${mint.slice(-4)} on Kixo`, "Chart, safety score and Kixo AI on Kixo"));
      }
      text.after(bar);
    }
  }

  function scan(root) {
    if (!root || !root.querySelectorAll) return;
    cashtags(root);
    addresses(root);
  }

  let pending = false;
  new MutationObserver(() => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      scan(document.body);
    });
  }).observe(document.body, { childList: true, subtree: true });
})();
