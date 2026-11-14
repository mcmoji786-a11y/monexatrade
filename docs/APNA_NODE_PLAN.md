# Kixo ka apna Solana node: poora plan

Maqsad: Helius, QuickNode ya kisi API company ke plan ke baghair Kixo apne node par chale.
Live data, trades bhejna aur AI, sab apni machine se.

> Seedhi baat: apna node aapke ghar ke PC par nahi chal sakta (16 GB RAM, ghar ka internet).
> Ek **kiraye ka dedicated server (bare metal)** lena hoga. Kisi company ka API plan nahi,
> sirf server ka kiraya. Machine aur data hamara hoga.

---

## 1. Node hamare liye kya karega

| Kaam | Abhi kaun karta hai | Apne node ke baad |
|---|---|---|
| Naye coins aur har trade live (stream) | Helius/QuickNode/public, kabhi band | Apna node, koi quota nahi |
| Coin aur wallet ki maloomat (RPC calls) | Helius plus fallback | Apna node |
| Trade bhejna (buy/sell) | Kixo Sender plus RPC | Apna node plus Kixo Sender, sab se tez |
| Purani history (pichle mahine aur saal) | Helius/QuickNode se backfill | Yeh apna node **nahi** deta (neeche section 7) |

---

## 2. Server kaisa chahiye

Solana node bohat bhaari hota hai. Taaza andaza (2026):

| Cheez | Kam se kam | Behtar |
|---|---|---|
| CPU | 16 cores / 32 threads, tez (AMD EPYC) | 24-32 cores |
| RAM | 384 GB (sirf zaroori index) | 512 GB (agar sab index on) |
| Disk | 2 TB NVMe, accounts aur ledger **alag drives** par | 2 x 2 TB NVMe Gen4 |
| Internet | 1 Gbps, bina limit (unmetered) | 10 Gbps |
| Jagah | Europe (Frankfurt/Amsterdam) ya US East | Jahan Solana validators zyada hain |

**Hamari zaroorat:** Kixo ko poore Solana ke har account ka index nahi chahiye. Sirf pump.fun,
launchpads aur tokens ki zaroorat hai. Is liye **384 GB RAM wala server** kaafi hai, aur
512 GB wala bhi le sakte hain. (Cherry Servers ke mutabiq bina full index 32-core EPYC aur
384 GB RAM theek chalta hai.)

---

## 3. Kahan se lein aur kitna kharcha

Yeh companies Solana ke liye bare metal servers deti hain:

| Company | Note | Andazan mahana |
|---|---|---|
| **Cherry Servers** (Lithuania/EU) | Solana RPC ke tayyar configs, ghante ya mahine ka bill | $800-1,500 |
| **Latitude.sh** | Solana validators mein bohat istemal, 20 TB data muft | $900-1,600 |
| **TeraSwitch** (US) | Solana ka sab se bara host | quote lena hoga |
| **ERPC** | Solana ke liye tayyar bare metal | €298 se shuru (chhote) |
| **OVH / Hetzner** | Saste, lekin kai jagah crypto node par pabandi; shart parh kar | $300-700 |

Bazaar ka andaza: Solana ke liye kiraye ka bare metal **$800-1,900 mahana**. $800 se saste
aksar zaroorat poori nahi karte. Pakki qeemat ke liye 2-3 companies se **quote** lein.

**Kul mahana kharcha (andaza):**
- Server: $800-1,500
- Doosra backup server (baad mein): utna hi
- Domain/TLS/monitoring: taqriban muft

Muqable ke liye: Helius ka developer/business plan $49-499 mahana hai. Matlab **shuru mein
apna node mehenga parta hai**. Yeh tab faida deta hai jab users aur trades bohat zyada hon,
ya speed sab se aham ho (sniper aur 24/7 auto-trading).

---

## 4. Setup ke qadam (server milne ke baad)

Taqriban 1-2 din, jis mein node ka sync kuch ghante leta hai.

1. **Server:** Ubuntu 24.04 LTS. Do NVMe drives, ek `/mnt/ledger` aur doosri `/mnt/accounts`.
2. **System tuning:** Solana ki zaroori settings (file limits, network buffers, swap off).
3. **Agave install** (Solana ka asal software, Anza): taaza stable version.
4. **RPC node ki settings** (vote nahi karta, sirf data deta hai):
   - `--no-voting`, `--full-rpc-api`, `--rpc-port 8899` (WebSocket 8900)
   - `--account-index program-id` aur `spl-token-mint` (sirf zaroori index, RAM bachane ke liye)
   - `--limit-ledger-size` (disk na bhare)
   - `--private-rpc` aur `--rpc-bind-address 127.0.0.1` (bahar se koi seedha na pohanche)
5. **Snapshot se shuru:** naya node chain ki taaza snapshot download karke kuch ghanton mein
   sync ho jata hai.
6. **Hifazat (zaroori):**
   - Firewall: sirf Solana ke gossip ports khule. RPC sirf hamare gateway ke IP ke liye.
   - Node ke aage **nginx plus HTTPS (TLS)** aur ek secret token, taake gateway `https://` aur
     `wss://` se jude aur koi aur istemal na kar sake.
   - SSH sirf key se, password band.
7. **Nigrani:** node ka slot peeche to nahi reh raha, disk aur RAM. Gateway ka `/admin/system`
   pehle se alert deta hai, us mein "own node behind" bhi jor denge.
8. **Systemd service:** server restart ho to node khud chal jaye.

---

## 5. Kixo gateway ko jodna

Gateway **pehle se tayyar hai**: `.env` mein node ke address dalte hi istemal hone lagte hain.

```
FALLBACK_RPC_URLS=https://node.kixo.trade/<secret>,https://api.mainnet-beta.solana.com
FALLBACK_WS_URLS=wss://node.kixo.trade/<secret>,wss://api.mainnet-beta.solana.com
```

**Ek chhota code badlao** (main karunga, approval ke baad): abhi gateway hamesha pehle Helius
ko try karta hai. Nayi settings `OWN_RPC_URL` / `OWN_WS_URL` banengi. Woh lagi hon to **apna
node pehle**, phir backup. Helius ka key khali ho to usay bilkul chhor diya jaye. Fallback router
aur nodes badalne ka system jaisa hai waisa rahega: apna node gira to public node par chala jayega.

**Baad mein (speed):** node par **Yellowstone gRPC (Geyser plugin, open source)** lagayein. Is se
trades WebSocket se bhi pehle, seedha node ke andar se milte hain. Sniper aur AI ke liye sab
se tez. Ingest engine mein iska rasta banana hoga (taqriban 1 stage ka kaam).

---

## 6. Trades bhejna (real trading ke waqt)

- Apna node transaction seedha Solana leaders ko bhejta hai (Kixo Sender pehle se bana hai).
- Sandwich/MEV se bachne ke liye **Jito** ka rasta bhi saath rakhein. Yeh muft hai, sirf tip
  lagti hai.
- Real-money trading on karne se pehle security review zaroori hai (Kixo ka qaida).

---

## 7. Purani history (AI training ke liye)

Apna RPC node sirf **haal ka data** rakhta hai (kuch din). Pichle mahinon aur saalon ke liye:
- **Collector chalta rahe:** hamara collector har din ka data `E:\KixoData` mein jama karta hai.
  Apne node ke baad yeh bina quota ke 24/7 chalega. Aaj se aage ki history hamari apni.
- **Purana data:** Solana ka khula archive (**Old Faithful**, open source, poori history) ya
  ek dafa ka backfill. Yeh alag stage hai.

---

## 8. Marhalay (mera mashwara)

| Marhala | Kab | Kya | Kharcha |
|---|---|---|---|
| **A** | Abhi | Free nodes plus rotation par development aur testing (chal raha hai) | $0 |
| **B** | Launch se 2-3 hafte pehle | Ek bare metal server, apna RPC node, gateway mein `OWN_RPC_URL` | ~$800-1,500/mah |
| **C** | Users barhne par | Yellowstone gRPC, doosra node doosri jagah (backup), Jito | ~2x |

**Aham:** jab tak marhala B mukammal na ho, **real-money trading on nahi hogi**. Free public node
par paise ki trading khatarnak hai.

---

## 9. Aap ke faislay

1. Marhala B kab shuru karna hai (server kab lena hai)?
2. Server Europe mein ya US mein? (Mashwara: Frankfurt/Amsterdam, Solana leaders ke qareeb)
3. 384 GB (sasta) ya 512 GB (aage ke liye mehfooz)?
4. Kis company se quote lein? (Mashwara: Cherry Servers aur Latitude dono se)

Jab aap server le lein: login (SSH) ki maloomat chat mein **na** bhejein. Main setup ki script
bana dunga jo aap server par chalayenge, ya aap mujhe mehfooz tareeqe se access dein.

---

Sources (Nov 2026): Anza Agave requirements (docs.anza.xyz/operations/requirements), Cherry
Servers Solana RPC guides, Chainstack self-hosted node aur infrastructure guides, Alchemy
Solana nodes overview, RPCFast dedicated node, ERPC pricing. Qeematein badalti rehti hain:
khareedne se pehle quote lein.
