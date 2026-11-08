//! Creator report cards and smart money, from what our own engine has seen.
//!
//! Both live in memory and start empty when the gateway starts: a creator's record
//! covers the coins launched since then. Supabase persistence comes next (needs the
//! founder's approval to add tables).

use crate::book::Position;
use serde::Serialize;
use std::collections::HashMap;

/// A creator's earlier coin, as we saw it.
struct Coin {
    mint: String,
    created: i64,
    peak_mc: f64,
    last_mc: f64,
    graduated: bool,
    dev_sold_all: bool,
    ended: Option<i64>,
}

/// What a creator did with the coins we saw before this one.
#[derive(Debug, Clone, Default, Serialize, PartialEq)]
pub struct DevReport {
    /// Earlier coins by this creator since tracking started.
    pub coins: u32,
    pub graduated: u32,
    /// Dev sold everything and the price fell over 70% from its peak.
    pub rugged: u32,
    /// Dropped from the radar within 15 minutes without graduating.
    pub died_fast: u32,
    pub best_peak_mc_usd: Option<f64>,
}

const RUG_DROP: f64 = 0.3;
const DIED_FAST_SECS: i64 = 15 * 60;
const COINS_PER_CREATOR: usize = 50;
const MAX_CREATORS: usize = 100_000;

#[derive(Default)]
pub struct Creators {
    by_creator: HashMap<String, Vec<Coin>>,
    creator_of: HashMap<String, String>,
}

impl Creators {
    pub fn launched(&mut self, creator: &str, mint: &str, ts: i64) {
        if creator.is_empty() || self.creator_of.contains_key(mint) {
            return;
        }
        if self.by_creator.len() >= MAX_CREATORS && !self.by_creator.contains_key(creator) {
            self.evict_oldest();
        }
        let coins = self.by_creator.entry(creator.to_string()).or_default();
        coins.push(Coin { mint: mint.to_string(), created: ts, peak_mc: 0.0, last_mc: 0.0, graduated: false, dev_sold_all: false, ended: None });
        if coins.len() > COINS_PER_CREATOR {
            let old = coins.remove(0);
            self.creator_of.remove(&old.mint);
        }
        self.creator_of.insert(mint.to_string(), creator.to_string());
    }

    pub fn market(&mut self, mint: &str, mc_usd: Option<f64>, complete: bool, dev_sold_all: bool) {
        let Some(c) = self.coin_mut(mint) else { return };
        if let Some(mc) = mc_usd.filter(|v| v.is_finite()) {
            c.peak_mc = c.peak_mc.max(mc);
            c.last_mc = mc;
        }
        c.graduated |= complete;
        c.dev_sold_all = dev_sold_all;
    }

    pub fn ended(&mut self, mint: &str, ts: i64) {
        if let Some(c) = self.coin_mut(mint) {
            c.ended.get_or_insert(ts);
        }
    }

    /// The record of `creator`, leaving out `mint` (the coin being shown).
    pub fn report(&self, creator: &str, mint: &str) -> DevReport {
        let mut r = DevReport::default();
        for c in self.by_creator.get(creator).into_iter().flatten().filter(|c| c.mint != mint) {
            r.coins += 1;
            r.graduated += c.graduated as u32;
            if c.dev_sold_all && c.peak_mc > 0.0 && c.last_mc < c.peak_mc * RUG_DROP {
                r.rugged += 1;
            }
            if !c.graduated && c.ended.is_some_and(|e| e - c.created <= DIED_FAST_SECS) {
                r.died_fast += 1;
            }
            if c.peak_mc > 0.0 {
                r.best_peak_mc_usd = Some(r.best_peak_mc_usd.map_or(c.peak_mc, |b: f64| b.max(c.peak_mc)));
            }
        }
        r
    }

    fn coin_mut(&mut self, mint: &str) -> Option<&mut Coin> {
        let creator = self.creator_of.get(mint)?;
        self.by_creator.get_mut(creator)?.iter_mut().find(|c| c.mint == mint)
    }

    fn evict_oldest(&mut self) {
        let oldest = self.by_creator.iter().min_by_key(|(_, coins)| coins.last().map_or(0, |c| c.created)).map(|(k, _)| k.clone());
        if let Some(k) = oldest {
            for c in self.by_creator.remove(&k).unwrap_or_default() {
                self.creator_of.remove(&c.mint);
            }
        }
    }
}

/// A wallet's result on one coin.
#[derive(Debug, Default, Clone, Copy, Serialize, serde::Deserialize)]
pub struct CoinResult {
    pub realized_sol: f64,
    pub held_secs: i64,
    pub trades: u32,
    pub first_ts: i64,
    pub last_ts: i64,
    /// What a follower copying this wallet a few seconds late made on the coin, and
    /// the cost of what that follower sold (SOL). Zero for records saved before.
    #[serde(default)]
    pub copy_realized_sol: f64,
    #[serde(default)]
    pub copy_sold_cost: f64,
}

impl CoinResult {
    pub fn of(p: &Position) -> Self {
        Self {
            realized_sol: p.realized_sol,
            held_secs: (p.last_ts - p.first_ts).max(0),
            trades: p.buys + p.sells,
            first_ts: p.first_ts,
            last_ts: p.last_ts,
            copy_realized_sol: p.copy_realized_sol,
            copy_sold_cost: p.copy_sold_cost,
        }
    }
}

/// A wallet's results summed over coins.
#[derive(Default, Clone, Copy)]
struct Stat {
    coins: u32,
    wins: u32,
    realized_sol: f64,
    held_secs: i64,
    trades: u32,
    first_ts: i64,
    last_ts: i64,
    copy_realized_sol: f64,
    copy_sold_cost: f64,
    copy_coins: u32,
}

impl Stat {
    fn add(&mut self, r: &CoinResult) {
        self.coins += 1;
        self.wins += (r.realized_sol > 0.0) as u32;
        self.realized_sol += r.realized_sol;
        self.held_secs += r.held_secs;
        self.trades += r.trades;
        self.first_ts = if self.first_ts == 0 { r.first_ts } else { self.first_ts.min(r.first_ts) };
        self.last_ts = self.last_ts.max(r.last_ts);
        if r.copy_sold_cost > 0.0 {
            self.copy_coins += 1;
            self.copy_realized_sol += r.copy_realized_sol;
            self.copy_sold_cost += r.copy_sold_cost;
        }
    }

    /// Bot patterns: in and out within seconds, many trades per coin, or a new coin
    /// every few minutes around the clock.
    fn looks_automated(&self) -> bool {
        let coins = self.coins.max(1) as f64;
        let avg_hold = self.held_secs as f64 / coins;
        let trades_per_coin = self.trades as f64 / coins;
        let hours = ((self.last_ts - self.first_ts).max(0) as f64 / 3600.0).max(1.0);
        avg_hold < SMART_MIN_AVG_HOLD_SECS || trades_per_coin > SMART_MAX_TRADES_PER_COIN || coins / hours > SMART_MAX_COINS_PER_HOUR
    }
}

/// Smart money: wallets that took profit on at least 3 coins, won most of them and
/// realised at least 3 SOL, at a human pace, and traded in the last day.
const SMART_MIN_COINS: u32 = 3;
const SMART_MIN_WIN_RATE: f64 = 0.6;
const SMART_MIN_REALIZED_SOL: f64 = 3.0;
/// Bots that buy every launch and scalp small profits look "profitable" too. A real
/// trader picks coins: at most this many held at once, and real profit per coin.
const SMART_MAX_LIVE_HOLDINGS: usize = 10;
const SMART_MIN_SOL_PER_COIN: f64 = 0.5;
/// A trader holds a coin for at least a minute on average, trades it a handful of
/// times, and does not touch a new coin every two minutes.
const SMART_MIN_AVG_HOLD_SECS: f64 = 60.0;
const SMART_MAX_TRADES_PER_COIN: f64 = 12.0;
const SMART_MAX_COINS_PER_HOUR: f64 = 30.0;
/// Live coins a wallet has touched (bought, held or sold); bots touch dozens.
const SMART_MAX_LIVE_TOUCHED: usize = 25;
/// Listed only while active: a trade in the last hour.
pub const SMART_ACTIVE_SECS: i64 = 3_600;
/// Records older than this are forgotten.
const SMART_KEEP_SECS: i64 = 7 * 86_400;
const MAX_WALLETS: usize = 300_000;

/// Results per wallet per coin, from coins that left the board and from the top coins
/// we read back from the chain. Saved to disk so a restart keeps the leaderboard.
#[derive(Default, Serialize, serde::Deserialize)]
pub struct SmartMoney {
    closed: HashMap<String, HashMap<String, CoinResult>>,
    /// When the top coins were last read from the chain (unix seconds).
    #[serde(default)]
    pub seeded_at: i64,
}

impl SmartMoney {
    /// Record a coin's positions (sold at least once). Reading a coin again replaces
    /// its earlier result, so nothing is counted twice.
    pub fn fold<'a>(&mut self, mint: &str, positions: impl Iterator<Item = &'a Position>) {
        for p in positions.filter(|p| p.sells > 0 && !p.wallet.is_empty()) {
            if self.closed.len() >= MAX_WALLETS && !self.closed.contains_key(&p.wallet) {
                continue;
            }
            self.closed.entry(p.wallet.clone()).or_default().insert(mint.to_string(), CoinResult::of(p));
        }
    }

    /// Drop results older than a week and wallets left with nothing.
    pub fn prune(&mut self, now: i64) {
        for coins in self.closed.values_mut() {
            coins.retain(|_, r| now - r.last_ts <= SMART_KEEP_SECS);
        }
        self.closed.retain(|_, c| !c.is_empty());
    }

    pub fn wallets(&self) -> usize {
        self.closed.len()
    }

    /// Oldest trade in the records (unix seconds), or None when there are none.
    pub fn oldest(&self) -> Option<i64> {
        self.closed.values().flat_map(|c| c.values()).map(|r| r.first_ts).filter(|t| *t > 0).min()
    }

    /// Smart wallets holding each live coin (mint -> count), and the smart-money
    /// leaderboard. `live` yields every live book's (mint, positions).
    pub fn evaluate<'a>(&self, live: impl Iterator<Item = (&'a str, Vec<&'a Position>)>, now: i64) -> (HashMap<String, u32>, Vec<Leader>) {
        let live: Vec<(&str, Vec<&Position>)> = live.collect();
        // Live results count too (a wallet can be proving itself right now); a live
        // book replaces a stored result for the same coin.
        let mut results: HashMap<&str, HashMap<&str, CoinResult>> = self
            .closed
            .iter()
            .map(|(w, coins)| (w.as_str(), coins.iter().map(|(m, r)| (m.as_str(), *r)).collect()))
            .collect();
        let mut holding: HashMap<&str, Vec<&str>> = HashMap::new();
        let mut touched: HashMap<&str, usize> = HashMap::new();
        for (mint, ps) in &live {
            for p in ps.iter() {
                *touched.entry(p.wallet.as_str()).or_default() += 1;
                if p.sells > 0 {
                    results.entry(p.wallet.as_str()).or_default().insert(mint, CoinResult::of(p));
                }
                if p.balance > 0.0 {
                    holding.entry(p.wallet.as_str()).or_default().push(mint);
                }
            }
        }
        let mut leaders: Vec<Leader> = results
            .iter()
            .filter_map(|(w, coins)| {
                let mut s = Stat::default();
                coins.values().for_each(|r| s.add(r));
                let smart = holding.get(w).map_or(0, Vec::len) <= SMART_MAX_LIVE_HOLDINGS
                    && touched.get(w).copied().unwrap_or(0) <= SMART_MAX_LIVE_TOUCHED
                    && now - s.last_ts <= SMART_ACTIVE_SECS
                    && !s.looks_automated()
                    && s.coins >= SMART_MIN_COINS
                    && s.wins as f64 / s.coins as f64 >= SMART_MIN_WIN_RATE
                    && s.realized_sol >= SMART_MIN_REALIZED_SOL
                    && s.realized_sol / s.coins as f64 >= SMART_MIN_SOL_PER_COIN;
                smart.then(|| Leader {
                    wallet: w.to_string(),
                    coins: s.coins,
                    wins: s.wins,
                    win_rate: (s.wins as f64 / s.coins as f64 * 1000.0).round() / 10.0,
                    realized_sol: (s.realized_sol * 1000.0).round() / 1000.0,
                    avg_hold_secs: s.held_secs / s.coins.max(1) as i64,
                    last_trade: s.last_ts,
                    holding: holding.get(w).map(|v| v.iter().map(|m| m.to_string()).collect()).unwrap_or_default(),
                    copy_coins: s.copy_coins,
                    // A copy score from one or two coins is noise: shown from three.
                    copy_return_pct: (s.copy_coins >= MIN_COPY_COINS && s.copy_sold_cost > 0.0)
                        .then(|| (s.copy_realized_sol / s.copy_sold_cost * 1000.0).round() / 10.0),
                    sol_balance: None,
                })
            })
            .collect();
        leaders.sort_by(|a, b| b.realized_sol.total_cmp(&a.realized_sol));
        leaders.truncate(LEADERS);
        let mut counts: HashMap<String, u32> = HashMap::new();
        for l in &leaders {
            for m in &l.holding {
                *counts.entry(m.clone()).or_default() += 1;
            }
        }
        (counts, leaders)
    }
}

/// A memecoin trader ranked by the profit it took on chain (the competition page shows
/// these while Kixo has few demo traders). Every result is from trades our engine read.
#[derive(Debug, Clone, Serialize)]
pub struct TopTrader {
    pub wallet: String,
    pub coins: u32,
    pub wins: u32,
    pub win_rate: f64,
    pub realized_sol: f64,
    pub trades: u32,
    /// Best single coin, SOL taken.
    pub best_sol: f64,
    pub last_trade: i64,
}

/// At least this many coins sold in the window to be ranked.
const TOP_MIN_COINS: u32 = 3;
/// A person trades a few coins an hour at most over the time they are active; a wallet
/// that sells 270 coins a day is a bot, however calm each trade looks.
const TOP_MAX_COINS_PER_HOUR: f64 = 4.0;
const TOP_MAX_COINS_PER_DAY: f64 = 40.0;

impl SmartMoney {
    /// Wallets ranked by profit taken on coins they traded since `since` (unix seconds).
    /// Bots are left out with the same rules as smart money (scalping speed, too many
    /// trades per coin, a new coin every two minutes, dozens of live coins touched).
    pub fn top_traders<'a>(&self, live: impl Iterator<Item = (&'a str, Vec<&'a Position>)>, since: i64, limit: usize) -> Vec<TopTrader> {
        let mut results: HashMap<&str, HashMap<&str, CoinResult>> = self
            .closed
            .iter()
            .map(|(w, coins)| (w.as_str(), coins.iter().filter(|(_, r)| r.last_ts >= since).map(|(m, r)| (m.as_str(), *r)).collect()))
            .collect();
        let mut touched: HashMap<&str, usize> = HashMap::new();
        let live: Vec<(&str, Vec<&Position>)> = live.collect();
        for (mint, ps) in &live {
            for p in ps.iter() {
                *touched.entry(p.wallet.as_str()).or_default() += 1;
                if p.sells > 0 && p.last_ts >= since {
                    results.entry(p.wallet.as_str()).or_default().insert(mint, CoinResult::of(p));
                }
            }
        }
        let mut out: Vec<TopTrader> = results
            .iter()
            .filter_map(|(w, coins)| {
                let mut s = Stat::default();
                coins.values().for_each(|r| s.add(r));
                let hours = ((s.last_ts - s.first_ts).max(0) as f64 / 3600.0).max(1.0);
                let days = (hours / 24.0).max(1.0);
                let human_pace = s.coins as f64 / hours <= TOP_MAX_COINS_PER_HOUR && s.coins as f64 / days <= TOP_MAX_COINS_PER_DAY;
                let ok = s.coins >= TOP_MIN_COINS && s.realized_sol > 0.0 && human_pace && !s.looks_automated() && touched.get(w).copied().unwrap_or(0) <= SMART_MAX_LIVE_TOUCHED;
                ok.then(|| TopTrader {
                    wallet: w.to_string(),
                    coins: s.coins,
                    wins: s.wins,
                    win_rate: (s.wins as f64 / s.coins as f64 * 1000.0).round() / 10.0,
                    realized_sol: (s.realized_sol * 1000.0).round() / 1000.0,
                    trades: s.trades,
                    best_sol: (coins.values().map(|r| r.realized_sol).fold(0.0, f64::max) * 1000.0).round() / 1000.0,
                    last_trade: s.last_ts,
                })
            })
            .collect();
        out.sort_by(|a, b| b.realized_sol.total_cmp(&a.realized_sol));
        out.truncate(limit);
        out
    }

    /// One wallet's results over the last week on the coins our engine read, closed and
    /// live: the Wallet Tracker's P&L when the on-chain history cannot be read.
    pub fn wallet_result<'a>(&self, wallet: &str, live: impl Iterator<Item = (&'a str, Vec<&'a Position>)>) -> Option<TopTrader> {
        let mut coins: HashMap<String, CoinResult> = self.closed.get(wallet).cloned().unwrap_or_default();
        for (mint, ps) in live {
            if let Some(p) = ps.into_iter().find(|p| p.wallet == wallet && p.sells > 0) {
                coins.insert(mint.to_string(), CoinResult::of(p));
            }
        }
        if coins.is_empty() {
            return None;
        }
        let mut s = Stat::default();
        coins.values().for_each(|r| s.add(r));
        Some(TopTrader {
            wallet: wallet.to_string(),
            coins: s.coins,
            wins: s.wins,
            win_rate: (s.wins as f64 / s.coins as f64 * 1000.0).round() / 10.0,
            realized_sol: (s.realized_sol * 1000.0).round() / 1000.0,
            trades: s.trades,
            best_sol: (coins.values().map(|r| r.realized_sol).fold(0.0, f64::max) * 1000.0).round() / 1000.0,
            last_trade: s.last_ts,
        })
    }
}

/// One smart wallet on the leaderboard.
#[derive(Debug, Clone, Serialize)]
pub struct Leader {
    pub wallet: String,
    /// Coins it has sold (closed or partly closed), wins among them, win rate in %.
    pub coins: u32,
    pub wins: u32,
    pub win_rate: f64,
    pub realized_sol: f64,
    /// Average time from first buy to last trade per coin.
    pub avg_hold_secs: i64,
    /// Unix seconds of its latest trade we saw.
    pub last_trade: i64,
    /// Live coins it holds right now.
    pub holding: Vec<String>,
    /// Coins on which a follower copying it COPY_DELAY_SECS late was simulated, and that
    /// follower's realised return in % (None until a copied coin was sold).
    pub copy_coins: u32,
    pub copy_return_pct: Option<f64>,
    /// SOL in the wallet now, read from chain.
    pub sol_balance: Option<f64>,
}

const LEADERS: usize = 200;
/// Copied coins needed before a copy score is shown.
pub const MIN_COPY_COINS: u32 = 3;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn report_counts_earlier_coins_only() {
        let mut c = Creators::default();
        c.launched("dev", "A", 0);
        c.market("A", Some(50_000.0), false, false);
        c.market("A", Some(5_000.0), false, true); // sold out, down 90%
        c.ended("A", 300); // gone in 5 minutes
        c.launched("dev", "B", 400);
        c.market("B", Some(80_000.0), true, false); // graduated
        c.launched("dev", "C", 900);
        let r = c.report("dev", "C");
        assert_eq!(r, DevReport { coins: 2, graduated: 1, rugged: 1, died_fast: 1, best_peak_mc_usd: Some(80_000.0) });
        assert_eq!(c.report("someone", "X"), DevReport::default());
    }

    /// A human-paced position: held ten minutes, two trades.
    fn pos(wallet: &str, realized: f64, balance: f64) -> Position {
        Position { wallet: wallet.into(), buys: 1, sells: 1, realized_sol: realized, balance, first_ts: 1_000, last_ts: 1_600, ..Default::default() }
    }

    #[test]
    fn a_flipper_is_not_smart() {
        let mut s = SmartMoney::default();
        // Profitable, but in and out within five seconds on every coin.
        let flip = Position { wallet: "flip".into(), buys: 1, sells: 1, realized_sol: 2.0, first_ts: 1_000, last_ts: 1_005, ..Default::default() };
        for i in 0..4 {
            s.fold(&format!("M{i}"), [flip.clone()].iter());
        }
        let (_, leaders) = s.evaluate(std::iter::empty(), 2_000);
        assert!(leaders.is_empty());
    }

    #[test]
    fn smart_wallets_need_a_record() {
        let mut s = SmartMoney::default();
        for i in 0..3 {
            s.fold(&format!("C{i}"), [pos("pro", 2.0, 0.0), pos("lucky", 5.0, 0.0)].iter());
        }
        s.fold("C3", [pos("lucky", -14.0, 0.0)].iter());
        // Reading a coin again replaces it: still three coins for "pro".
        s.fold("C0", [pos("pro", 2.0, 0.0)].iter());
        let live = [pos("pro", 0.0, 100.0), pos("lucky", 0.0, 100.0)];
        let (held, leaders) = s.evaluate([("M", live.iter().collect::<Vec<_>>())].into_iter(), 2_000);
        // A day later with no trade, nobody is listed.
        assert!(s.evaluate(std::iter::empty(), 2_000 + 2 * 86_400).1.is_empty());
        assert_eq!(leaders.len(), 1);
        assert_eq!(leaders[0].wallet, "pro");
        assert_eq!(leaders[0].holding, vec!["M".to_string()]);
        // "lucky" won 3 of 4 but kept only 1 SOL; "pro" qualifies.
        assert_eq!(held.get("M"), Some(&1));
    }

    #[test]
    fn a_bot_holding_every_launch_is_not_smart() {
        let mut s = SmartMoney::default();
        for i in 0..3 {
            s.fold(&format!("B{i}"), [pos("bot", 2.0, 0.0)].iter());
        }
        let books: Vec<(String, Vec<Position>)> = (0..12).map(|i| (format!("M{i}"), vec![pos("bot", 0.0, 1.0)])).collect();
        let (held, _) = s.evaluate(books.iter().map(|(m, ps)| (m.as_str(), ps.iter().collect())), 2_000);
        assert!(held.is_empty(), "{held:?}");
    }

    #[test]
    fn top_traders_rank_people_by_profit_and_skip_bots() {
        let mut s = SmartMoney::default();
        for i in 0..4 {
            s.fold(&format!("C{i}"), [pos("big", 3.0, 0.0), pos("small", 1.0, 0.0)].iter());
        }
        // 300 coins inside one hour: a bot, even with calm trades and big profit.
        for i in 0..300 {
            let p = Position { wallet: "bot".into(), buys: 1, sells: 1, realized_sol: 1.0, first_ts: 1_000 + i, last_ts: 1_600 + i, ..Default::default() };
            s.fold(&format!("B{i}"), [p].iter());
        }
        // Old results fall outside the window.
        let old = Position { wallet: "old".into(), buys: 1, sells: 1, realized_sol: 50.0, first_ts: 10, last_ts: 70, ..Default::default() };
        for i in 0..3 {
            s.fold(&format!("O{i}"), [old.clone()].iter());
        }
        let top = s.top_traders(std::iter::empty(), 500, 10);
        let names: Vec<&str> = top.iter().map(|t| t.wallet.as_str()).collect();
        assert_eq!(names, vec!["big", "small"]);
        assert_eq!(top[0].coins, 4);
        assert!((top[0].realized_sol - 12.0).abs() < 1e-9);
        assert!((top[0].best_sol - 3.0).abs() < 1e-9);
    }
}
