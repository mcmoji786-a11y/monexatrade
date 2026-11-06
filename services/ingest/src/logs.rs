//! Reading program logs: which program emitted each `Program data:` line.
//!
//! Anchor programs share event names, so two launchpads can log a `TradeEvent` with the
//! same discriminator (pump.fun and Raydium LaunchLab do). Decoders must only read
//! events emitted by their own program, so we follow the invoke stack.

use base64::{engine::general_purpose::STANDARD, Engine};

/// Decoded `Program data:` payloads emitted while `program` was executing.
pub fn program_data(logs: &[String], program: &str) -> Vec<Vec<u8>> {
    let mut stack: Vec<&str> = Vec::new();
    let mut out = Vec::new();
    for l in logs {
        if let Some(rest) = l.strip_prefix("Program ") {
            if let Some((id, tail)) = rest.split_once(' ') {
                if tail.starts_with("invoke [") {
                    stack.push(id);
                    continue;
                }
                if tail == "success" || tail.starts_with("failed") {
                    stack.pop();
                    continue;
                }
            }
        }
        if let Some(b64) = l.strip_prefix("Program data: ") {
            // An event logged by a self-CPI belongs to the same program as its caller.
            if stack.last() == Some(&program) {
                if let Ok(bytes) = STANDARD.decode(b64) {
                    out.push(bytes);
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn follows_the_invoke_stack() {
        let logs: Vec<String> = [
            "Program A invoke [1]",
            "Program data: AQ==",
            "Program B invoke [2]",
            "Program data: Ag==",
            "Program B success",
            "Program data: Aw==",
            "Program A success",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        assert_eq!(program_data(&logs, "A"), vec![vec![1], vec![3]]);
        assert_eq!(program_data(&logs, "B"), vec![vec![2]]);
    }
}
