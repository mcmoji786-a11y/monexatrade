# 0010: Kixo trading wallet, key in the user's browser

Date: 2026-11-08. Decided by the founder.

## Decision

To remove the Phantom popup on every trade, users can have a Kixo trading wallet:

- They deposit SOL from Phantom into it and trade with one click.
- They can still trade directly from Phantom whenever they want.

**The private key is created and kept in the user's browser**, locked with their password or
passkey. Kixo's server stores only the locked copy, which it cannot open. Kixo never holds keys,
so this is not custody (see decision 0008).

## Consequences

- Trades are signed in the browser with no popup, then go through the Fast Path (decision 0009).
- Coins bought with the trading wallet live at its own address, not in Phantom. Users see them
  in three ways:
  - Kixo's portfolio shows both wallets.
  - "Withdraw to Phantom" sends SOL or coins back.
  - Exporting the key lets them add the wallet to Phantom as a second account.
- Sniper and TP/SL on the trading wallet run only while a Kixo tab is open. Running them 24/7
  would need server signing, which is custody.
- A user who forgets their password needs their recovery file, or the funds cannot be recovered.
- Hardening against XSS is part of the security review before real trading opens.

## Update, same day: no Phantom connection from the site

The founder decided that the website never connects to Phantom:
- **Sign-in:** Google or email only.
- **Wallet set-up:** right after sign-up, one screen asks for the wallet password and the wallet
  is created for the account. "Later" is allowed, because demo trading works without a wallet.
- **Deposit:** the wallet address is shown, and the user sends SOL from Phantom or an exchange
  themselves. The address is hidden until the `wallet_deposits` admin switch is on.
- **Withdraw:** to any address. The gateway builds the transfer, the browser signs it with the
  unlocked Kixo wallet, and the gateway checks it is exactly that transfer before sending.
  Withdrawals are never switched off.
- **Real trades:** signed by the Kixo wallet in the browser, with no popup. `tx-check` still
  verifies every transaction before it is signed.
- **Top bar:** the SOL balance sits next to the profile icon, and clicking it opens deposit,
  withdraw, recovery file, 2FA and lock.

## Update 2: Phantom only to move SOL

The founder asked for a Phantom request on deposit, with exactly the amount the user chose.
- **Deposit:** the user picks an amount and clicks Deposit from Phantom. The gateway builds the
  exact transfer, Phantom shows it and the user approves it there, and the gateway checks the
  signed transfer before sending it. This is gated by `wallet_deposits`. The address is still
  shown for exchange deposits.
- **Withdraw:** the user enters an amount or picks Max. The destination is the connected Phantom
  ("Connect Phantom" only reads its address) or any other address.
- Sign-in and trading still never touch Phantom.

## Update 3: fees (founder decision, 2026-11-08)

- **Trade fee:** 0.5% (`FEE_BPS = 50`). It was 1%. The demo account uses the same 0.5%.
- **Deposits and withdrawals:** 1% to the platform fee wallet, taken from the amount, in the same
  transaction. A 1 SOL deposit puts 0.99 SOL in the Kixo wallet and 0.01 SOL with Kixo. A 1 SOL
  withdrawal delivers 0.99 SOL.
- **Deposits need a fee wallet:** they stop until a fee wallet that holds at least 0.001 SOL is
  set. Withdrawals never stop: without a fee wallet, no fee is taken.
- **Browser check:** before Phantom or the Kixo wallet signs a deposit or withdrawal,
  `checkTransfer` verifies that only the chosen amount goes to the chosen address, plus at most a
  1% fee.
- **Advice I gave:** keep deposits and withdrawals free (competitors do), and take legal advice,
  because a cut of user transfers can look like money transmission. The founder chose the 1% fee.
- **Exchange deposits:** SOL sent straight to the address is not charged.
