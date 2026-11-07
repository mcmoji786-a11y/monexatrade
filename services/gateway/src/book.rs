//! Per-token trade book built from our own pump.fun decoder: recent trades, candles,
//! and per-wallet positions (which give holders, top traders, dev and snipers).
//! Everything is in memory and dropped when the token leaves the board.

use monexa_ingest::pumpfun::{NewToken, Trade};
use serde::Serialize;
use std::collections::{HashMap, VecDeque};

const LAMPORTS_PER_SOL: f64 = 1_000_000_000.0;
const TOKEN_DECIMALS: f64 = 1_000_000.0;
const DEFAULT_SUPPLY: u64 = 1_000_000_000_000_000;
/// Same thresholds as the market engine.
const WHALE_LAMPORTS: u64 = 5_000_000_000;
const MAX_WHALES: usize = 100;
const SNIPE_WINDOW_SECS: i64 = 3;
/// Trades below this (0.0001 SOL) are priced from reserves instead of their fill.
const MIN_PRICED_LAMPORTS: u64 = 100_000;

const MAX_TRADES: usize = 1_000;
/// Base candle size. The browser aggregates to larger intervals.
pub const CANDLE_SECS: i64 = 5;
/// 5 s candles for 6 hours.
const MAX_CANDLES: usize = 4_320;
/// Copy simulation: a follower sees a trade and lands the same order this many seconds
/// later, paying this share in fees and slippage on each side.
pub const COPY_DELAY_SECS: i64 = 3;
const COPY_COST: f64 = 0.01;
/// Copy orders waiting for their delay, per coin.
const MAX_PENDING: usize = 2_000;

#[derive(Debug, Clone, Serialize)]
pub struct TradeRow {
    pub signature: String,
    pub ts: i64,
    pub wallet: String,
    pub is_buy: bool,
    pub sol: f64,
    pub tokens: f64,
    /// Price in SOL after the trade.
    pub price_sol: f64,
    pub mc_sol: f64,
    pub whale: bool,
    pub dev: bool,
    pub sniper: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct Candle {
    pub t: i64,
    /// OHLC of market cap in SOL (price x supply), so the chart never needs tiny decimals.
    pub o: f64,
    pub h: f64,
    pub l: f64,
    pub c: f64,
    /// Volume in SOL.
    pub v: f64,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct Position {
    pub wallet: String,
    pub buys: u32,
    pub sells: u32,
    pub bought_sol: f64,
    pub sold_sol: f64,
    pub bought_tokens: f64,
    pub sold_tokens: f64,
    /// Tokens held, as observed from trades (transfers are not seen).
    pub balance: f64,
    pub pct: f64,
    /// Realised profit in SOL: sell proceeds minus the average cost of what was sold.
    pub realized_sol: f64,
    /// Value of the remaining balance at the current price, in SOL.
    pub value_sol: f64,
    pub first_ts: i64,
    pub last_ts: i64,
    pub dev: bool,
    pub sniper: bool,
    /// A follower copying this wallet COPY_DELAY_SECS late: tokens held, cost of what
    /// is held, and realised profit and cost of what was sold (SOL).
    #[serde(skip)]
    pub copy_tokens: f64,
    #[serde(skip)]
    pub copy_basis: f64,
    #[serde(skip)]
    pub copy_realized_sol: f64,
    #[serde(skip)]
    pub copy_sold_cost: f64,
}

/// A follower's order, filled at the market once its delay has passed.
struct Pending {
    wallet: String,
    due: i64,
    /// Buy: SOL to spend. Sell: share of the follower's tokens to sell.
    buy_sol: Option<f64>,
    sell_frac: f64,
}

struct Book {
    /// "curve" (pump.fun bonding curve) or the DEX of the watched pool
    /// ("pumpswap", "raydium", "orca", "meteora").
    source: String,
    /// Pool name, e.g. "MrBeast / SOL", for pool-backed books.
    pool: Option<String>,
    creator: String,
    created: i64,
    supply: f64,
    /// 10^decimals of the coin: 1e6 for pump.fun coins, read from chain for others.
    unit: f64,
    price_sol: f64,
    trades: VecDeque<TradeRow>,
    /// Trades of 5 SOL or more, kept apart: on a busy coin they fall out of the latest
    /// trades long before the hour the radar counts them over.
    whales: VecDeque<TradeRow>,
    candles: VecDeque<Candle>,
    wallets: HashMap<String, Position>,
    pending: VecDeque<Pending>,
}

impl Book {
    fn new(token: &NewToken) -> Self {
        let supply = token
            .reserves
            .as_ref()
            .map_or(DEFAULT_SUPPLY, |r| r.total_supply)
            .max(1) as f64
            / TOKEN_DECIMALS;
        let price_sol = token
            .reserves
            .as_ref()
            .filter(|r| r.virtual_token > 0)
            .map_or(0.0, |r| {
                (r.virtual_sol as f64 / LAMPORTS_PER_SOL)
                    / (r.virtual_token as f64 / TOKEN_DECIMALS)
            });
        Self {
            source: "curve".to_string(),
            pool: None,
            creator: token.creator.clone(),
            created: token.timestamp,
            supply,
            unit: TOKEN_DECIMALS,
            price_sol,
            trades: VecDeque::new(),
            whales: VecDeque::new(),
            candles: VecDeque::new(),
            wallets: HashMap::new(),
            pending: VecDeque::new(),
        }
    }

    /// Fills follower orders whose delay has passed at the latest market price.
    fn fill_copies(&mut self, now: i64) {
        let px = self.price_sol;
        while self.pending.front().is_some_and(|o| o.due <= now) {
            let o = self.pending.pop_front().expect("front");
            if px <= 0.0 {
                continue;
            }
            let Some(p) = self.wallets.get_mut(&o.wallet) else { continue };
            match o.buy_sol {
                Some(sol) => {
                    p.copy_tokens += sol * (1.0 - COPY_COST) / px;
                    p.copy_basis += sol;
                }
                None if p.copy_tokens > 0.0 => {
                    let tokens = p.copy_tokens * o.sell_frac;
                    let cost = p.copy_basis * o.sell_frac;
                    p.copy_realized_sol += tokens * px * (1.0 - COPY_COST) - cost;
                    p.copy_sold_cost += cost;
                    p.copy_tokens -= tokens;
                    p.copy_basis -= cost;
                }
                None => {}
            }
        }
    }

    fn apply(&mut self, signature: &str, t: &Trade) -> TradeRow {
        self.fill_copies(t.timestamp);
        // The price a trade actually executed at (SOL paid / tokens moved), as large
        // screeners report it. The pool's post-trade spot price can differ a lot on thin
        // liquidity (verified: a drained PumpSwap pool, spot 38x below the fill price).
        // Dust trades round badly, so they fall back to the reserves. On a bonding curve
        // the virtual reserves are the price pump.fun itself quotes, so curves keep them.
        let price_sol = if self.source != "curve"
            && t.sol_amount >= MIN_PRICED_LAMPORTS
            && t.token_amount > 0
        {
            (t.sol_amount as f64 / LAMPORTS_PER_SOL) / (t.token_amount as f64 / self.unit)
        } else if t.virtual_token_reserves > 0 {
            (t.virtual_sol_reserves as f64 / LAMPORTS_PER_SOL)
                / (t.virtual_token_reserves as f64 / self.unit)
        } else {
            self.price_sol
        };
        self.price_sol = price_sol;
        let sol = t.sol_amount as f64 / LAMPORTS_PER_SOL;
        let tokens = t.token_amount as f64 / self.unit;
        let mc = price_sol * self.supply;
        let dev = !t.user.is_empty() && t.user == self.creator;
        // Some curves (Raydium LaunchLab) do not log the trader: price, volume and
        // candles still count, positions do not.
        let mut anon = Position::default();
        let p = if t.user.is_empty() {
            &mut anon
        } else {
            self.wallets
                .entry(t.user.clone())
                .or_insert_with(|| Position {
                    wallet: t.user.clone(),
                    first_ts: t.timestamp,
                    dev,
                    ..Default::default()
                })
        };
        if t.is_buy && !dev && t.timestamp - self.created <= SNIPE_WINDOW_SECS {
            p.sniper = true;
        }
        let copy = if t.user.is_empty() || dev {
            None
        } else if t.is_buy {
            Some((Some(sol), 0.0))
        } else {
            Some((None, if p.balance > 0.0 { (tokens / p.balance).min(1.0) } else { 1.0 }))
        };
        if t.is_buy {
            p.buys += 1;
            p.bought_sol += sol;
            p.bought_tokens += tokens;
            p.balance += tokens;
        } else {
            let avg_cost = if p.bought_tokens > 0.0 {
                p.bought_sol / p.bought_tokens
            } else {
                0.0
            };
            p.sells += 1;
            p.sold_sol += sol;
            p.sold_tokens += tokens;
            p.realized_sol += sol - avg_cost * tokens.min(p.balance.max(0.0));
            p.balance = (p.balance - tokens).max(0.0);
        }
        p.last_ts = p.last_ts.max(t.timestamp);
        let sniper = p.sniper;
        if let Some((buy_sol, sell_frac)) = copy {
            if self.pending.len() >= MAX_PENDING {
                self.pending.pop_front();
            }
            self.pending.push_back(Pending { wallet: t.user.clone(), due: t.timestamp + COPY_DELAY_SECS, buy_sol, sell_frac });
        }

        let row = TradeRow {
            signature: signature.to_string(),
            ts: t.timestamp,
            wallet: t.user.clone(),
            is_buy: t.is_buy,
            sol,
            tokens,
            price_sol,
            mc_sol: mc,
            whale: t.sol_amount >= WHALE_LAMPORTS,
            dev,
            sniper,
        };
        self.trades.push_front(row.clone());
        if row.whale {
            self.whales.push_front(row.clone());
            self.whales.truncate(MAX_WHALES);
        }
        self.trades.truncate(MAX_TRADES);
        self.add_candle(t.timestamp, mc, sol);
        row
    }

    fn add_candle(&mut self, ts: i64, mc: f64, vol: f64) {
        let t = ts - ts.rem_euclid(CANDLE_SECS);
        match self.candles.back_mut() {
            Some(c) if c.t == t => {
                c.h = c.h.max(mc);
                c.l = c.l.min(mc);
                c.c = mc;
                c.v += vol;
            }
            // Out-of-order trade for an older bucket: fold it into the latest one.
            Some(c) if t < c.t => {
                c.v += vol;
            }
            last => {
                let o = last.map_or(mc, |c| c.c);
                self.candles.push_back(Candle {
                    t,
                    o,
                    h: o.max(mc),
                    l: o.min(mc),
                    c: mc,
                    v: vol,
                });
                if self.candles.len() > MAX_CANDLES {
                    self.candles.pop_front();
                }
            }
        }
    }

    fn positions(&self) -> Vec<Position> {
        self.wallets
            .values()
            .map(|p| Position {
                pct: p.balance / self.supply * 100.0,
                value_sol: p.balance * self.price_sol,
                ..p.clone()
            })
            .collect()
    }
}

#[derive(Default)]
pub struct Books {
    books: HashMap<String, Book>,
}

/// What the trade page receives when it opens.
#[derive(Debug, Clone, Serialize)]
pub struct BookSnapshot {
    pub source: String,
    pub pool: Option<String>,
    pub trades: Vec<TradeRow>,
    pub candles: Vec<Candle>,
    pub candle_secs: i64,
    pub supply: f64,
    /// Trades of 5 SOL or more, newest first (up to MAX_WHALES), however old.
    pub whales: Vec<TradeRow>,
}

/// Holders, top traders and the dev wallet, sorted for the trade page tabs.
#[derive(Debug, Clone, Serialize)]
pub struct Wallets {
    pub holders: Vec<Position>,
    pub top_traders: Vec<Position>,
    pub dev: Option<Position>,
    pub snipers: Vec<Position>,
    pub holder_count: usize,
    /// The wallet asked for with `?wallet=`, if it traded this token.
    pub focus: Option<Position>,
}

const LIST_LIMIT: usize = 100;

impl Books {
    pub fn add(&mut self, token: &NewToken) {
        self.books
            .entry(token.mint.clone())
            .or_insert_with(|| Book::new(token));
    }

    pub fn contains(&self, mint: &str) -> bool {
        self.books.contains_key(mint)
    }

    /// A graduated coin trading in a PumpSwap pool. Earlier history comes from the DEX
    /// indexer (prices in SOL market cap); live trades then append as usual. Wallet
    /// stats only cover trades seen live. An existing curve book is kept and continued.
    pub fn add_pool(
        &mut self,
        mint: &str,
        pool: &str,
        dex: &str,
        supply: Option<(f64, u32)>,
        seed_candles: Vec<Candle>,
        seed_trades: Vec<TradeRow>,
    ) {
        let book = self.books.entry(mint.to_string()).or_insert_with(|| Book {
            source: dex.to_string(),
            pool: None,
            creator: String::new(),
            created: 0,
            supply: supply.map_or(DEFAULT_SUPPLY as f64 / TOKEN_DECIMALS, |s| s.0),
            unit: supply.map_or(TOKEN_DECIMALS, |s| 10f64.powi(s.1 as i32)),
            price_sol: seed_trades.first().map_or(0.0, |t| t.price_sol),
            whales: seed_trades.iter().filter(|t| t.whale).take(MAX_WHALES).cloned().collect(),
            trades: seed_trades.into_iter().take(MAX_TRADES).collect(),
            candles: seed_candles.into_iter().collect(),
            wallets: HashMap::new(),
            pending: VecDeque::new(),
        });
        book.source = dex.to_string();
        book.pool = Some(pool.to_string());
        // The real on-chain supply (after burns) replaces any assumed one.
        if let Some((s, decimals)) = supply.filter(|s| s.0 > 0.0) {
            book.supply = s;
            book.unit = 10f64.powi(decimals as i32);
        }
    }

    /// Older trades fetched after the book went live (newest first): rows go after the
    /// live ones, wallets are updated, and their candles fill in before the first one.
    pub fn backfill_trades(&mut self, mint: &str, older: Vec<(String, Trade)>) {
        let Some(b) = self.books.get_mut(mint) else {
            return;
        };
        let known: std::collections::HashSet<String> =
            b.trades.iter().map(|t| t.signature.clone()).collect();
        let had_live = !b.trades.is_empty();
        let live_price = b.price_sol;
        // Replay the older trades into empty series, oldest first, so candles and
        // average costs build in order; wallets accumulate into the shared map.
        let mut live_trades = std::mem::take(&mut b.trades);
        let mut live_candles = std::mem::take(&mut b.candles);
        for (sig, t) in older.iter().rev().filter(|(s, _)| !known.contains(s)) {
            b.apply(sig, t);
        }
        let old_trades = std::mem::replace(&mut b.trades, std::mem::take(&mut live_trades));
        let old_candles = std::mem::replace(&mut b.candles, std::mem::take(&mut live_candles));
        if had_live {
            b.price_sol = live_price;
        }
        for r in old_trades {
            if b.trades.len() >= MAX_TRADES {
                break;
            }
            b.trades.push_back(r);
        }
        let first = b.candles.front().map_or(i64::MAX, |c| c.t);
        for c in old_candles.into_iter().rev().filter(|c| c.t < first) {
            b.candles.push_front(c);
        }        // Replayed whales went in front of the live ones: put them back in time order.
        let mut whales: Vec<TradeRow> = b.whales.drain(..).collect();
        whales.sort_by(|x, y| y.ts.cmp(&x.ts));
        let mut seen = std::collections::HashSet::new();
        whales.retain(|w| seen.insert(w.signature.clone()));
        whales.truncate(MAX_WHALES);
        b.whales = whales.into();
    }

    /// Adds indexed history that arrived late (the indexer was rate limited when the
    /// pool was first watched): candles older than the book's first one go in front.
    pub fn backfill_candles(&mut self, mint: &str, older: Vec<Candle>) {
        let Some(b) = self.books.get_mut(mint) else {
            return;
        };
        let first = b.candles.front().map_or(i64::MAX, |c| c.t);
        for c in older.into_iter().rev().filter(|c| c.t < first) {
            if b.candles.len() >= MAX_CANDLES {
                break;
            }
            b.candles.push_front(c);
        }
    }

    pub fn supply(&self, mint: &str) -> Option<f64> {
        self.books.get(mint).map(|b| b.supply)
    }

    /// Price of the latest decoded pool trade (not a bonding curve) and when it happened.
    pub fn last_pool_price(&self, mint: &str) -> Option<(f64, i64)> {
        let b = self.books.get(mint).filter(|b| b.source != "curve")?;
        let t = b.trades.front()?;
        (t.price_sol > 0.0).then_some((t.price_sol, t.ts))
    }

    /// Recent trades by any of `wallets` across live books, newest first.
    pub fn trades_by(&self, wallets: &std::collections::HashSet<String>, limit: usize) -> Vec<(String, TradeRow)> {
        let mut out: Vec<(String, TradeRow)> = self
            .books
            .iter()
            .flat_map(|(m, b)| b.trades.iter().filter(|t| wallets.contains(&t.wallet)).map(move |t| (m.clone(), t.clone())))
            .collect();
        out.sort_by(|a, b| b.1.ts.cmp(&a.1.ts));
        out.truncate(limit);
        out
    }

    /// Every live book's positions, for smart-money counts.
    pub fn all_positions(&self) -> impl Iterator<Item = (&str, Vec<&Position>)> {
        self.books.iter().map(|(m, b)| (m.as_str(), b.wallets.values().collect()))
    }

    /// One book's positions, read before the book is dropped.
    pub fn positions_of(&self, mint: &str) -> Vec<Position> {
        self.books.get(mint).map(|b| b.wallets.values().cloned().collect()).unwrap_or_default()
    }

    pub fn remove(&mut self, mint: &str) {
        self.books.remove(mint);
    }

    /// None when the token is not tracked.
    pub fn apply(&mut self, signature: &str, t: &Trade) -> Option<TradeRow> {
        Some(self.books.get_mut(&t.mint)?.apply(signature, t))
    }

    pub fn snapshot(&self, mint: &str) -> Option<BookSnapshot> {
        let b = self.books.get(mint)?;
        Some(BookSnapshot {
            source: b.source.clone(),
            pool: b.pool.clone(),
            trades: b.trades.iter().take(200).cloned().collect(),
            whales: b.whales.iter().cloned().collect(),
            candles: b.candles.iter().cloned().collect(),
            candle_secs: CANDLE_SECS,
            supply: b.supply,
        })
    }

    pub fn wallets(&self, mint: &str, focus: Option<&str>) -> Option<Wallets> {
        let b = self.books.get(mint)?;
        let all = b.positions();
        let mut holders: Vec<Position> = all.iter().filter(|p| p.balance > 0.0).cloned().collect();
        let holder_count = holders.len();
        holders.sort_by(|a, b| b.balance.total_cmp(&a.balance));
        holders.truncate(LIST_LIMIT);

        let pnl = |p: &Position| p.realized_sol + p.value_sol - (p.bought_sol - cost_of_sold(p));
        let mut top_traders = all.clone();
        top_traders.sort_by(|a, b| pnl(b).total_cmp(&pnl(a)));
        top_traders.truncate(LIST_LIMIT);

        let mut snipers: Vec<Position> = all.iter().filter(|p| p.sniper).cloned().collect();
        snipers.sort_by(|a, b| b.bought_sol.total_cmp(&a.bought_sol));

        Some(Wallets {
            dev: all.iter().find(|p| p.dev).cloned(),
            holders,
            top_traders,
            snipers,
            holder_count,
            focus: focus.and_then(|w| all.iter().find(|p| p.wallet == w).cloned()),
        })
    }
}

/// Average cost of the tokens a wallet already sold, in SOL.
fn cost_of_sold(p: &Position) -> f64 {
    if p.bought_tokens > 0.0 {
        p.bought_sol / p.bought_tokens * p.sold_tokens.min(p.bought_tokens)
    } else {
        0.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use monexa_ingest::pumpfun::TokenStandard;

    fn token() -> NewToken {
        NewToken {
            signature: "s".into(),
            name: "T".into(),
            symbol: "T".into(),
            uri: String::new(),
            mint: "M".into(),
            bonding_curve: "B".into(),
            creator: "DEV".into(),
            timestamp: 100,
            reserves: None,
            standard: TokenStandard::Spl,
            quote_mint: None,
            launchpad: "pump.fun".to_string(),
        }
    }

    fn trade(user: &str, buy: bool, sol: u64, tokens: u64, ts: i64) -> Trade {
        Trade {
            mint: "M".into(),
            sol_amount: sol,
            token_amount: tokens,
            is_buy: buy,
            user: user.into(),
            timestamp: ts,
            virtual_sol_reserves: 30_000_000_000,
            virtual_token_reserves: 1_000_000_000_000_000,
            real_token_reserves: 0,
        }
    }

    #[test]
    fn tracks_positions_dev_snipers_and_candles() {
        let mut books = Books::default();
        books.add(&token());
        books
            .apply("a", &trade("DEV", true, 1_000_000_000, 10_000_000_000, 100))
            .unwrap();
        let s = books
            .apply(
                "b",
                &trade("SNIPE", true, 6_000_000_000, 50_000_000_000, 102),
            )
            .unwrap();
        assert!(s.sniper && s.whale && !s.dev);
        books
            .apply(
                "c",
                &trade("LATE", true, 1_000_000_000, 10_000_000_000, 200),
            )
            .unwrap();
        // Sniper sells half for more than it paid for that half.
        books
            .apply(
                "d",
                &trade("SNIPE", false, 4_000_000_000, 25_000_000_000, 210),
            )
            .unwrap();

        let w = books.wallets("M", Some("LATE")).unwrap();
        assert_eq!(w.focus.as_ref().unwrap().wallet, "LATE");
        assert_eq!(w.holder_count, 3);
        assert!(w.dev.as_ref().unwrap().dev);
        assert_eq!(w.snipers.len(), 1);
        let sniper = &w.snipers[0];
        assert!((sniper.balance - 25_000.0).abs() < 1e-6);
        assert!(
            (sniper.realized_sol - 1.0).abs() < 1e-9,
            "sold 4 SOL, half cost 3 SOL"
        );

        let snap = books.snapshot("M").unwrap();
        assert_eq!(snap.trades.len(), 4);
        assert_eq!(snap.trades[0].signature, "d", "newest first");
        assert_eq!(snap.candles.len(), 3, "100 and 102 share the 100 bucket");
        assert!(books
            .apply(
                "e",
                &Trade {
                    mint: "X".into(),
                    ..trade("A", true, 1, 1, 1)
                }
            )
            .is_none());

        // Older history arriving later lands behind the live rows and before the candles.
        books.backfill_trades(
            "M",
            vec![
                ("old2".into(), trade("OLD", false, 1, 1, 90)),
                ("old1".into(), trade("OLD", true, 2, 2, 85)),
            ],
        );
        let snap = books.snapshot("M").unwrap();
        assert_eq!(snap.trades[0].signature, "d", "live rows stay first");
        assert_eq!(snap.trades.last().unwrap().signature, "old1");
        assert_eq!(snap.candles[0].t, 85);
        assert_eq!(snap.candles[1].t, 90);
    }

    /// A trade that leaves the curve at `mult` times the starting price.
    fn at(user: &str, buy: bool, sol: u64, ts: i64, mult: f64) -> Trade {
        Trade { virtual_sol_reserves: (30_000_000_000.0 * mult) as u64, ..trade(user, buy, sol, 1_000_000, ts) }
    }

    #[test]
    fn simulates_a_late_follower() {
        let mut books = Books::default();
        books.add(&token());
        books.apply("a", &at("LEAD", true, 1_000_000_000, 100, 1.0)).unwrap();
        // The price doubles before the follower's order lands three seconds later.
        books.apply("b", &at("X", true, 1_000_000, 101, 2.0)).unwrap();
        books.apply("c", &at("Y", true, 1_000_000, 103, 2.5)).unwrap();
        books.apply("d", &at("LEAD", false, 1_000_000_000, 104, 3.0)).unwrap();
        books.apply("e", &at("Z", true, 1_000_000, 107, 1.0)).unwrap();
        let p = books.positions_of("M").into_iter().find(|p| p.wallet == "LEAD").unwrap();
        // Bought 0.99 SOL of tokens at 2x, sold them at 3x less 1%: 1.0 SOL cost, 1.470 back.
        assert!((p.copy_sold_cost - 1.0).abs() < 1e-9, "{}", p.copy_sold_cost);
        assert!((p.copy_realized_sol - (0.99 * 0.99 * 1.5 - 1.0)).abs() < 1e-9, "{}", p.copy_realized_sol);
        assert!(p.copy_tokens.abs() < 1e-9);
    }

}
