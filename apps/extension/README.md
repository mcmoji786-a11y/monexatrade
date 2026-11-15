# Kixo for X (browser extension)

Adds a **Kixo** button after every `$cashtag` on X, and an **Open on Kixo** button under
posts that contain a Solana coin address. The cashtag opens `kixo.trade/x/$SYMBOL`, which
opens the coin straight away when it is clear, or lists the candidates when many coins share
the name. It only adds links: no posting, no private data, no tracking.

## Try it (Chrome, Edge, Brave)
1. Open `chrome://extensions` and turn on **Developer mode**.
2. **Load unpacked** and pick this folder (`apps/extension`).
3. Click the extension icon and set the Kixo address (for local testing:
   `http://localhost:3000`).
4. Open x.com: cashtags get a green **Kixo** button.

## Publish
Zip this folder and upload it to the Chrome Web Store (one-time $5 developer fee) and
Microsoft Edge Add-ons (free). The store listing needs a short description, screenshots and
the privacy answer "does not collect user data".
