# Kixo kaise chalayein

## Sab se aasan tareeqa
Project folder (`E:\Moxnexa Trade`) mein **`Kixo.cmd`** par double-click karein. Ek menu khulega:

| Number | Kaam | Kab |
|---|---|---|
| **1** | Start | PC on karne ke baad, ya Kixo band ho |
| **2** | Stop | Kixo band karna ho |
| **3** | Restart | Kuch atak jaye |
| **4** | Update | Code badla ho (Claude ne ya aap ne). Dono build karke chala deta hai |
| **5** | Status | Dekhna ho ke kya chal raha hai |
| **6** | Open website | Browser mein http://localhost:3000 |
| **7** | Open logs | Koi masla ho to logs dekhne ke liye |

Start ke baad lagbhag **30 second** intezar karein, phir http://localhost:3000 kholein.

## Kya kya chalta hai
- **Gateway** (port 8080): live engine aur data collector
- **Website** (port 3000)
- **Kixo AI** (port 8090): naye coins ka AI score
- **Watchdog**: koi hissa band ho jaye to khud dobara chala deta hai
- **AI trainer**: din mein ek dafa AI ko khud train karta hai

## Zaroori baatein
- **AI training ke waqt site band hoti hai.** Trainer memory ke liye Kixo ko ~30 se 60 minute ke liye rokta hai, phir khud chala deta hai. Status mein "paused for AI training" dikhe to bas intezar karein.
- **PC on hote hi Kixo khud chale**, iske liye ek dafa `scripts\kixo-autostart-install.cmd` chala dein.
- **Update fail ho jaye** to purana version khud chal jata hai. Laal lines ka screenshot le lein.
- **Memory kam ho** (Status mein 2 GB se kam) to Chrome ke faltu tabs band karein.

## Terminal se (agar menu na chale)
Terminal (PowerShell) mein:

```
cd "E:\Moxnexa Trade"
.\scripts\kixo-start.cmd
```

Band karne ke liye:

```
.\scripts\kixo-stop.cmd
```

Code badalne ke baad haath se build:

```
.\scripts\kixo-stop.cmd
$env:RUSTUP_HOME="E:\DevTools\rustup"; $env:CARGO_HOME="E:\DevTools\cargo"; $env:PATH="E:\DevTools\cargo\bin;$env:PATH"
cargo build -p monexa-gateway
cd apps\web; pnpm build; cd ..\..
.\scripts\kixo-start.cmd
```

## Data aur logs
- Data: `E:\KixoData`
- Logs: `E:\KixoData\logs` (gateway.log, web.log, ai.log, watchdog.log)
- Secrets: `.env` (kisi ko na bhejein)
