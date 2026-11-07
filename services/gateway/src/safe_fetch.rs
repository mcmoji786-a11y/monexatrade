//! An HTTP client for addresses that come from outside: token logos and token
//! metadata URIs, which anyone who creates a token controls.
//!
//! Such a URL must never reach our own network or the cloud metadata service, so:
//! - only `https`, a domain name (never an IP literal) and the default port;
//! - every redirect is checked the same way, at most 3 hops;
//! - the domain must resolve to public addresses only, and the connection uses exactly
//!   the addresses that passed the check (so a DNS answer cannot be swapped later).

use reqwest::{
    dns::{Addrs, Name, Resolve, Resolving},
    redirect::Policy,
    Url,
};
use std::{
    net::{IpAddr, Ipv4Addr, SocketAddr},
    sync::Arc,
    time::Duration,
};

/// Whether an address is on the public internet.
pub fn public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => public_v4(v4),
        IpAddr::V6(v6) => {
            if let Some(v4) = v6.to_ipv4_mapped() {
                return public_v4(v4);
            }
            let s = v6.segments();
            !(v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_multicast()
                || s[0] & 0xfe00 == 0xfc00 // unique local fc00::/7
                || s[0] & 0xffc0 == 0xfe80 // link local fe80::/10
                || (s[0] == 0x2001 && s[1] == 0x0db8) // documentation
                || (s[0] == 0x64 && s[1] == 0xff9b)) // NAT64 into IPv4
        }
    }
}

fn public_v4(ip: Ipv4Addr) -> bool {
    let o = ip.octets();
    !(ip.is_private()
        || ip.is_loopback()
        || ip.is_link_local() // 169.254/16, the cloud metadata service
        || ip.is_broadcast()
        || ip.is_documentation()
        || ip.is_unspecified()
        || ip.is_multicast()
        || o[0] == 0
        || (o[0] == 100 && (64..128).contains(&o[1])) // shared / CGNAT 100.64/10
        || (o[0] == 192 && o[1] == 0 && o[2] == 0) // 192.0.0/24
        || (o[0] == 198 && (o[1] == 18 || o[1] == 19)) // benchmarking 198.18/15
        || o[0] >= 240) // reserved
}

/// Whether a URL may be fetched: https, a public-looking domain name, default port.
pub fn allowed(url: &Url) -> bool {
    let Some(domain) = url.domain() else { return false }; // None for IP literals
    let d = domain.trim_end_matches('.').to_ascii_lowercase();
    url.scheme() == "https"
        && url.port().is_none()
        && url.username().is_empty()
        && d.contains('.')
        && !d.ends_with(".local")
        && !d.ends_with(".internal")
        && !d.ends_with(".localhost")
        && d != "localhost"
}

/// Same check for a URL given as text.
pub fn allowed_str(url: &str) -> bool {
    url.len() <= 600 && Url::parse(url).is_ok_and(|u| allowed(&u))
}

/// Resolves names to public addresses only.
struct PublicOnly;

impl Resolve for PublicOnly {
    fn resolve(&self, name: Name) -> Resolving {
        let host = name.as_str().to_string();
        Box::pin(async move {
            let addrs: Vec<SocketAddr> = tokio::net::lookup_host((host.as_str(), 443)).await?.filter(|a| public_ip(a.ip())).collect();
            if addrs.is_empty() {
                return Err(format!("{host} has no public address").into());
            }
            Ok(Box::new(addrs.into_iter()) as Addrs)
        })
    }
}

/// The client for outside URLs.
pub fn client() -> reqwest::Result<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(6))
        .user_agent("kixo-gateway/0.1")
        .redirect(Policy::custom(|a| if a.previous().len() >= 3 || !allowed(a.url()) { a.stop() } else { a.follow() }))
        .dns_resolver(Arc::new(PublicOnly))
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_public_https_domains() {
        assert!(allowed_str("https://ipfs.io/ipfs/Qm123"));
        assert!(allowed_str("https://gmgn.ai/external-res-asia/a.webp"));
        for bad in [
            "http://ipfs.io/a",
            "https://127.0.0.1/a",
            "https://169.254.169.254/latest",
            "https://169.254.169.254./latest", // trailing dot is still an IP
            "https://0x7f.0.0.1/a",            // hex IPv4
            "https://2130706433/a",            // decimal IPv4
            "https://[::1]/a",
            "https://localhost/a",
            "https://api.localhost/a",
            "https://printer.local/a",
            "https://metadata.google.internal/a",
            "https://evil.com:8443/a",
            "https://user@evil.com/a",
            "file:///etc/passwd",
        ] {
            assert!(!allowed_str(bad), "{bad} must be refused");
        }
    }

    #[test]
    fn private_addresses_are_not_public() {
        for ip in ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "64:ff9b::a9fe:a9fe"] {
            assert!(!public_ip(ip.parse().unwrap()), "{ip} must not count as public");
        }
        for ip in ["1.1.1.1", "104.16.0.1", "2606:4700::1111"] {
            assert!(public_ip(ip.parse().unwrap()), "{ip} is public");
        }
    }
}
