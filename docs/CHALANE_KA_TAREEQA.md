# Kixo khud kaise chalayein (bina Claude ke)

Ye file us waqt ke liye hai jab Claude ki limit khatam ho jaye. Sab kaam neeche ke
buttons aur commands se ho jata hai.

## 1. Rozana: kuch karne ki zaroorat nahi
- PC on karein aur Windows mein sign in karein. **30 second baad Kixo khud chal jata hai:**
  gateway (live engine + data collection) aur website.
- PC band karein to sab khud ruk jata hai. Data mehfooz rehta hai (har 5 second mein disk
  par likha jata hai).
- PC ko **sleep se rokein**, warna sleep ke dauran data nahi aata. Ek dafa cmd mein:
  `powercfg /change standby-timeout-ac 0`

## 2. Teen buttons (folder `E:\Moxnexa Trade\scripts`)
| File | Kaam |
|---|---|
| `kixo-start.cmd` | Kixo chalana (double-click) |
| `kixo-stop.cmd` | Kixo band karna |
| `kixo-autostart-remove.cmd` | PC on hone par khud chalna band karna |
| `kixo-autostart-install.cmd` | Khud chalna dobara lagana |

Website: http://localhost:3000 · Gateway: http://localhost:8080/health

## 3. Kaise pata chale sab theek hai
1. `E:\KixoData\status.json` Notepad mein kholein. `live_trades` ka number har 30 second
   mein **barhna chahiye**. Agar 5 minute tak 0 rahe to neeche "Masle" dekhein.
2. Browser mein http://localhost:8080/health kholein:
   - `"status":"ok"` aur `"stream_connected":true` hona chahiye.
   - `"primary":false` ka matlab: Helius band hai, backup node chal raha hai.
3. Logs: `E:\KixoData\logs\gateway.log` (aakhri lines dekhein).

## 4. Keys badalna (`E:\Moxnexa Trade\.env`, Notepad se)
- `HELIUS_API_KEY=` : Helius ki key (app ke liye pehli pasand).
- `FALLBACK_RPC_URLS=` : backup nodes, comma se alag, **public node aakhir mein**.
- `FALLBACK_WS_URLS=` : live stream ke backup, `wss://` wale. **Sirf woh provider daalein jo
  `logsSubscribe` support karta ho** (QuickNode haan, Alchemy **nahi**). Public node aakhir mein:
  `wss://api.mainnet-beta.solana.com`
- Badalne ke baad: `kixo-stop.cmd`, phir `kixo-start.cmd`.
- **`.env` kabhi kisi ko na bhejein**, na chat mein, na GitHub par. Is mein `AUTO_WALLET_KEY`
  bhi hai: iska backup rakhein, ye gum hui to auto wallets ka paisa phans jayega.

## 5. Code badla ho (GitHub se naya code liya ho)
cmd mein, ek ek kar ke:
```
cd "E:\Moxnexa Trade"
scripts\kixo-stop.cmd
set RUSTUP_HOME=E:\DevTools\rustup
set CARGO_HOME=E:\DevTools\cargo
E:\DevTools\cargo\bin\cargo.exe build -j 1 -p monexa-gateway
cd apps\web
pnpm install
pnpm build
cd ..\..
scripts\kixo-start.cmd
```
Build mein 2 se 5 minute lagte hain.

## 6. Masle aur hal
| Masla | Hal |
|---|---|
| `live_trades` 0 rehta hai | Log mein "logsSubscribe not found" ho to `FALLBACK_WS_URLS` se woh node hatayein. "quota used up" ho to Helius ki nayi key ya paid plan. |
| Website nahi khulti | `kixo-stop.cmd` phir `kixo-start.cmd`. Phir bhi na chale to section 5 wala build. |
| "port already in use" | `kixo-stop.cmd` chala kar dobara start. |
| C: drive bhar gayi | Data `E:\KixoData` mein hai, C: par nahi. C: ki safai mein system files na mitayein. |
| Disk E: bhar rahi hai | `E:\KixoData\live\` ke purane din kisi doosri drive par copy kar ke hata sakte hain (pehle backup). |

## 7. Waitlist page
- Local: `cd "E:\Moxnexa Trade\apps\waitlist"` phir `pnpm start`, browser mein http://localhost:3100
- Online (kixo.trade): `docs/WAITLIST_ONLINE.md` dekhein.

## 8. Data ka backup (hafte mein ek dafa)
`E:\KixoData` folder ko kisi doosri drive ya cloud (Google Drive, external disk) par copy karein.
AI ki training isi data par hogi.

## Phone par test (same WiFi)
1. `.env` mein `LAN_TESTING=1` ho (sirf is PC ke liye, server par kabhi nahi).
2. PC ka address dekhein: PowerShell mein `ipconfig` → "IPv4 Address" (jaise `192.168.1.5`).
3. Phone par kholein: `http://<woh address>:3000`. App khud usi PC ke gateway (port 8080) se judti hai.
4. Na khule to Windows Firewall mein Node.js aur `monexa-gateway.exe` ko "Private network" par allow karein.
