//! Market engine: turns raw pump.fun trades into the numbers Sol Radar shows.
//! Everything is computed from our own decoded on-chain events. No external APIs.
//!
//! Limits (shown to users as such):
//! - Holders are counted from trades we observed since launch. Plain wallet-to-wallet
//!   transfers are not trades, so the count is an approximation.
//! - Top-10 and dev share use the same observed balances.

use crate::pumpfun::{NewToken, Trade};
use serde::Serialize;
use std::collections::{HashMap, HashSet, VecDeque};

const LAMPORTS_PER_SOL: f64 = 1_000_000_000.0;
const TOKEN_DECIMALS: f64 = 1_000_000.0;
/// Defaults from pump.fun's Global account, used when a create event lacks reserves.
const DEFAULT_INITIAL_REAL_TOKENS: u64 = 793_100_000_000_000;
const DEFAULT_SUPPLY: u64 = 1_000_000_000_000_000;
/// A single trade at or above this size counts as a whale trade.
const WHALE_LAMPORTS: u64 = 5_000_000_000;
const WINDOW_5M: i64 = 300;
const WINDOW_1H: i64 = 3_600;
/// Buyers in the first seconds after creation (other than the creator) count as snipers.
const SNIPE_WINDOW_SECS: i64 = 3;
/// Price history is sampled at most this often, enough for 5m and 1h changes.
const PRICE_SAMPLE_SECS: i64 = 5;

/// Tracking limits. These keep Helius usage low and the feed free of dead coins.
pub const MAX_TRACKED: usize = 300;
/// A token with fewer trades than this after the grace period is dropped.
const MIN_TRADES: u64 = 5;
const GRACE_SECS: i64 = 180;
/// A token with no trade for this long is dead and dropped.
const DEAD_AFTER_SECS: i64 = 600;
/// Completed curves stay visible this long (until migration tracking exists).
const KEEP_COMPLETE_SECS: i64 = 600;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct MarketSnapshot {
    pub mint: String,
    /// false when the curve trades against another currency (e.g. USDC). The SOL and
    /// USD figures below are then not meaningful, so USD fields are null.
    pub sol_quoted: bool,
    pub price_sol: f64,
    pub price_usd: Option<f64>,
    pub mc_sol: f64,
    pub mc_usd: Option<f64>,
    /// 0 to 100: share of the curve's sellable tokens already bought.
    pub curve_progress: f64,
    pub complete: bool,
    pub volume_5m_sol: f64,
    pub volume_1h_sol: f64,
    pub volume_1h_usd: Option<f64>,
    pub buys_1h: u32,
    pub sells_1h: u32,
    /// SOL bought minus SOL sold in the last hour.
    pub net_buy_1h_sol: f64,
    pub trades_total: u64,
    /// Approximate: wallets with a positive balance from observed trades.
    pub holders: u32,
    pub top10_pct: f64,
    pub dev_pct: f64,
    pub whale_trades_1h: u32,
    /// Buys of 5 SOL or more in the last hour.
    pub whale_buys_1h: u32,
    /// Price change over the window. Tokens younger than the window compare
    /// against their launch price.
    pub change_5m_pct: Option<f64>,
    pub change_1h_pct: Option<f64>,
    /// Wallets (other than the creator) that bought within 3 s of creation, and the
    /// share of supply they still hold.
    pub snipers: u32,
    pub sniper_pct: f64,
    pub last_trade: i64,
}

fn price_of(virtual_sol: u64, virtual_tokens: u64) -> f64 {
    if virtual_tokens == 0 {
        return 0.0;
    }
    (virtual_sol as f64 / LAMPORTS_PER_SOL) / (virtual_tokens as f64 / TOKEN_DECIMALS)
}

struct WindowTrade {
    ts: i64,
    lamports: u64,
    is_buy: bool,
}

pub struct Tracked {
    pub token: NewToken,
    pub sub_id: Option<u64>,
    initial_real_tokens: u64,
    supply: u64,
    virtual_sol: u64,
    virtual_tokens: u64,
    real_tokens: u64,
    reserves_ts: i64,
    window: VecDeque<WindowTrade>,
    trades_total: u64,
    balances: HashMap<String, u64>,
    last_trade: i64,
    complete_at: Option<i64>,
    /// (timestamp, price in SOL), oldest first, trimmed to one hour.
    prices: VecDeque<(i64, f64)>,
    snipers: HashSet<String>,
    dirty: bool,
}

impl Tracked {
    fn new(token: NewToken) -> Self {
        let r = token.reserves.clone();
        let mut prices = VecDeque::new();
        if let Some(r) = &r {
            prices.push_back((token.timestamp, price_of(r.virtual_sol, r.virtual_token)));
        }
        Self {
            prices,
            snipers: HashSet::new(),
            initial_real_tokens: r.as_ref().map_or(DEFAULT_INITIAL_REAL_TOKENS, |r| r.real_token),
            supply: r.as_ref().map_or(DEFAULT_SUPPLY, |r| r.total_supply).max(1),
            virtual_sol: r.as_ref().map_or(0, |r| r.virtual_sol),
            virtual_tokens: r.as_ref().map_or(0, |r| r.virtual_token),
            real_tokens: r.as_ref().map_or(DEFAULT_INITIAL_REAL_TOKENS, |r| r.real_token),
            reserves_ts: token.timestamp,
            last_trade: token.timestamp,
            sub_id: None,
            window: VecDeque::new(),
            trades_total: 0,
            balances: HashMap::new(),
            complete_at: None,
            dirty: true,
            token,
        }
    }

    fn apply(&mut self, t: &Trade) {
        // Notifications can arrive slightly out of order; keep the newest reserves.
        if t.timestamp >= self.reserves_ts {
            self.virtual_sol = t.virtual_sol_reserves;
            self.virtual_tokens = t.virtual_token_reserves;
            self.real_tokens = t.real_token_reserves;
            self.reserves_ts = t.timestamp;

            // Merge samples closer than PRICE_SAMPLE_SECS, but never overwrite the
            // first sample: it is the launch price that young tokens compare against.
            let p = price_of(t.virtual_sol_reserves, t.virtual_token_reserves);
            let len = self.prices.len();
            match self.prices.back_mut() {
                Some(last) if len > 1 && t.timestamp - last.0 < PRICE_SAMPLE_SECS => last.1 = p,
                _ => self.prices.push_back((t.timestamp, p)),
            }
        }
        if !t.user.is_empty() && t.is_buy && t.user != self.token.creator && t.timestamp - self.token.timestamp <= SNIPE_WINDOW_SECS {
            self.snipers.insert(t.user.clone());
        }
        self.window.push_back(WindowTrade { ts: t.timestamp, lamports: t.sol_amount, is_buy: t.is_buy });
        self.trades_total += 1;
        self.last_trade = self.last_trade.max(t.timestamp);

        // Trades without a trader (LaunchLab logs) move price and volume only.
        if !t.user.is_empty() {
            let bal = self.balances.entry(t.user.clone()).or_insert(0);
            if t.is_buy {
                *bal = bal.saturating_add(t.token_amount);
            } else {
                *bal = bal.saturating_sub(t.token_amount);
            }
            if *bal == 0 {
                self.balances.remove(&t.user);
            }
        }
        self.dirty = true;
    }

    fn snapshot(&mut self, now: i64, sol_usd: Option<f64>) -> MarketSnapshot {
        while self.window.front().is_some_and(|w| now - w.ts > WINDOW_1H) {
            self.window.pop_front();
        }

        // Keep one sample at or before the 1h boundary so the 1h change has a reference.
        while self.prices.len() > 1 && self.prices[1].0 <= now - WINDOW_1H {
            self.prices.pop_front();
        }

        let price_sol = price_of(self.virtual_sol, self.virtual_tokens);
        let change = |window: i64| -> Option<f64> {
            let reference = self
                .prices
                .iter()
                .rev()
                .find(|(ts, _)| *ts <= now - window)
                .or_else(|| self.prices.front())?
                .1;
            (reference > 0.0 && price_sol > 0.0).then(|| ((price_sol / reference - 1.0) * 1000.0).round() / 10.0)
        };
        let mc_sol = price_sol * self.supply as f64 / TOKEN_DECIMALS;

        let sold = self.initial_real_tokens.saturating_sub(self.real_tokens);
        let curve_progress = if self.complete_at.is_some() {
            100.0
        } else {
            (sold as f64 / self.initial_real_tokens.max(1) as f64 * 100.0).clamp(0.0, 100.0)
        };

        let (mut v5, mut v1h, mut buys, mut sells) = (0u64, 0u64, 0u32, 0u32);
        let (mut whales, mut whale_buys) = (0u32, 0u32);
        let mut net: i128 = 0;
        for w in &self.window {
            v1h += w.lamports;
            net += if w.is_buy { w.lamports as i128 } else { -(w.lamports as i128) };
            if now - w.ts <= WINDOW_5M {
                v5 += w.lamports;
            }
            if w.is_buy { buys += 1 } else { sells += 1 }
            if w.lamports >= WHALE_LAMPORTS {
                whales += 1;
                whale_buys += w.is_buy as u32;
            }
        }
        let sniper_held: u64 = self.snipers.iter().filter_map(|s| self.balances.get(s)).sum();

        let mut top: Vec<u64> = self.balances.values().copied().collect();
        top.sort_unstable_by(|a, b| b.cmp(a));
        let top10: u64 = top.iter().take(10).sum();
        let dev = self.balances.get(&self.token.creator).copied().unwrap_or(0);
        let pct = |n: u64| (n as f64 / self.supply as f64 * 100.0 * 100.0).round() / 100.0;

        let v1h_sol = v1h as f64 / LAMPORTS_PER_SOL;
        let sol_quoted = self.token.is_sol_quoted();
        let sol_usd = sol_usd.filter(|_| sol_quoted);
        MarketSnapshot {
            mint: self.token.mint.clone(),
            sol_quoted,
            price_sol,
            price_usd: sol_usd.map(|p| price_sol * p),
            mc_sol,
            mc_usd: sol_usd.map(|p| mc_sol * p),
            curve_progress: (curve_progress * 10.0).round() / 10.0,
            complete: self.complete_at.is_some(),
            volume_5m_sol: v5 as f64 / LAMPORTS_PER_SOL,
            volume_1h_sol: v1h_sol,
            volume_1h_usd: sol_usd.map(|p| v1h_sol * p),
            buys_1h: buys,
            sells_1h: sells,
            net_buy_1h_sol: net as f64 / LAMPORTS_PER_SOL,
            trades_total: self.trades_total,
            holders: self.balances.len() as u32,
            top10_pct: pct(top10),
            dev_pct: pct(dev),
            whale_trades_1h: whales,
            whale_buys_1h: whale_buys,
            change_5m_pct: change(WINDOW_5M),
            change_1h_pct: change(WINDOW_1H),
            snipers: self.snipers.len() as u32,
            sniper_pct: pct(sniper_held),
            last_trade: self.last_trade,
        }
    }
}

#[derive(Default)]
pub struct Tracker {
    tokens: HashMap<String, Tracked>,
}

impl Tracker {
    /// Start tracking a new token. Returns false if it is already tracked or the cap is hit.
    pub fn add(&mut self, token: NewToken) -> bool {
        if self.tokens.len() >= MAX_TRACKED || self.tokens.contains_key(&token.mint) {
            return false;
        }
        self.tokens.insert(token.mint.clone(), Tracked::new(token));
        true
    }

    pub fn apply_trade(&mut self, t: &Trade) {
        if let Some(tr) = self.tokens.get_mut(&t.mint) {
            tr.apply(t);
        }
    }

    pub fn complete(&mut self, mint: &str, now: i64) {
        if let Some(tr) = self.tokens.get_mut(mint) {
            tr.complete_at.get_or_insert(now);
            tr.dirty = true;
        }
    }

    pub fn set_sub(&mut self, mint: &str, id: u64) {
        if let Some(tr) = self.tokens.get_mut(mint) {
            tr.sub_id = Some(id);
        }
    }

    /// After a reconnect every subscription id is invalid.
    pub fn clear_subs(&mut self) {
        for tr in self.tokens.values_mut() {
            tr.sub_id = None;
        }
    }

    /// (mint, bonding curve) for every tracked pump.fun token, to (re)subscribe. Other
    /// curves arrive on their launchpad's program subscription.
    pub fn targets(&self) -> Vec<(String, String)> {
        self.tokens
            .values()
            .filter(|t| t.token.launchpad == "pump.fun")
            .map(|t| (t.token.mint.clone(), t.token.bonding_curve.clone()))
            .collect()
    }

    /// Curves that sell a different amount than pump.fun's (LaunchLab reports its own
    /// total in every trade); sets the base for curve progress.
    pub fn set_curve_total(&mut self, mint: &str, total: u64) {
        if let Some(tr) = self.tokens.get_mut(mint) {
            if total > 0 {
                tr.initial_real_tokens = total;
            }
        }
    }

    pub fn len(&self) -> usize {
        self.tokens.len()
    }

    pub fn is_empty(&self) -> bool {
        self.tokens.is_empty()
    }

    /// Snapshots of tokens that changed since the last call.
    pub fn take_dirty(&mut self, now: i64, sol_usd: Option<f64>) -> Vec<MarketSnapshot> {
        self.tokens
            .values_mut()
            .filter_map(|t| std::mem::take(&mut t.dirty).then(|| t.snapshot(now, sol_usd)))
            .collect()
    }

    /// Drop dead or never-traded tokens. Returns (mint, subscription id) of each one.
    pub fn prune(&mut self, now: i64) -> Vec<(String, Option<u64>)> {
        let dead: Vec<String> = self
            .tokens
            .values()
            .filter(|t| {
                let age = now - t.token.timestamp;
                match t.complete_at {
                    Some(at) => now - at > KEEP_COMPLETE_SECS,
                    None => (age > GRACE_SECS && t.trades_total < MIN_TRADES) || now - t.last_trade > DEAD_AFTER_SECS,
                }
            })
            .map(|t| t.token.mint.clone())
            .collect();
        dead.into_iter()
            .filter_map(|m| self.tokens.remove(&m).map(|t| (m, t.sub_id)))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pumpfun::{Reserves, TokenStandard};

    fn token(ts: i64) -> NewToken {
        NewToken {
            signature: "sig".into(),
            name: "Test".into(),
            symbol: "TST".into(),
            uri: String::new(),
            mint: "mint1".into(),
            bonding_curve: "curve1".into(),
            creator: "dev".into(),
            timestamp: ts,
            reserves: Some(Reserves {
                virtual_token: 1_073_000_000_000_000,
                virtual_sol: 30_000_000_000,
                real_token: 793_100_000_000_000,
                total_supply: 1_000_000_000_000_000,
            }),
            standard: TokenStandard::Spl,
            quote_mint: None,
            launchpad: "pump.fun".to_string(),
        }
    }

    #[test]
    fn non_sol_quoted_tokens_have_no_usd_figures() {
        let mut t = Tracker::default();
        let mut tok = token(1_000);
        tok.quote_mint = Some("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v".into());
        t.add(tok);
        let s = &t.take_dirty(1_001, Some(100.0))[0];
        assert!(!s.sol_quoted);
        assert!(s.mc_usd.is_none() && s.price_usd.is_none() && s.volume_1h_usd.is_none());
    }

    fn trade(user: &str, buy: bool, lamports: u64, tokens: u64, ts: i64, real_tokens: u64) -> Trade {
        Trade {
            mint: "mint1".into(),
            sol_amount: lamports,
            token_amount: tokens,
            is_buy: buy,
            user: user.into(),
            timestamp: ts,
            virtual_sol_reserves: 40_000_000_000,
            virtual_token_reserves: 800_000_000_000_000,
            real_token_reserves: real_tokens,
        }
    }

    #[test]
    fn computes_price_mc_volume_holders_and_progress() {
        let mut t = Tracker::default();
        assert!(t.add(token(1_000)));
        assert!(!t.add(token(1_000)), "duplicate add rejected");
        t.apply_trade(&trade("dev", true, 1_000_000_000, 100_000_000_000_000, 1_001, 693_100_000_000_000));
        t.apply_trade(&trade("whale", true, 6_000_000_000, 50_000_000_000_000, 1_002, 643_100_000_000_000));
        t.apply_trade(&trade("whale", false, 500_000_000, 50_000_000_000_000, 1_003, 693_100_000_000_000));

        let s = &t.take_dirty(1_010, Some(100.0))[0];
        // price = 40 SOL / 800M tokens = 5e-8 SOL; MC = price * 1B = 50 SOL
        assert!((s.price_sol - 5e-8).abs() < 1e-15);
        assert!((s.mc_sol - 50.0).abs() < 1e-9);
        assert_eq!(s.mc_usd.map(|v| v.round()), Some(5_000.0));
        assert_eq!((s.buys_1h, s.sells_1h, s.trades_total), (2, 1, 3));
        assert!((s.volume_1h_sol - 7.5).abs() < 1e-9);
        assert_eq!(s.whale_trades_1h, 1);
        assert_eq!(s.whale_buys_1h, 1);
        // launch price 30 SOL / 1.073B tokens -> 5e-8 now: +78.8% since launch
        assert_eq!(s.change_5m_pct, Some(78.8));
        assert_eq!(s.change_1h_pct, Some(78.8));
        // "whale" bought 2 s after launch (sniper) and sold everything; dev is excluded
        assert_eq!(s.snipers, 1);
        assert_eq!(s.sniper_pct, 0.0);
        assert_eq!(s.holders, 1, "whale sold everything, only dev holds");
        assert!((s.dev_pct - 10.0).abs() < 1e-9);
        // sold 100M of 793.1M curve tokens
        assert!((s.curve_progress - 12.6).abs() < 0.05);
        assert!(t.take_dirty(1_011, None).is_empty(), "nothing changed");
    }

    #[test]
    fn prunes_untraded_and_dead_tokens() {
        let mut t = Tracker::default();
        t.add(token(1_000));
        assert!(t.prune(1_000 + GRACE_SECS).is_empty(), "still in grace period");
        let removed = t.prune(1_000 + GRACE_SECS + 1);
        assert_eq!(removed, vec![("mint1".to_string(), None)]);
        assert!(t.is_empty());
    }
}
