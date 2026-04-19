use ipnetwork::Ipv6Network;
use std::net::Ipv6Addr;
use std::str::FromStr;
use std::sync::atomic::{AtomicU64, Ordering};

pub struct Ipv6Rotator {
    network: Ipv6Network,
    cursor: AtomicU64,
}

impl Ipv6Rotator {
    pub fn new(cidr: &str) -> anyhow::Result<Self> {
        let network = Ipv6Network::from_str(cidr)?;
        Ok(Self {
            network,
            cursor: AtomicU64::new(1),
        })
    }

    pub fn next_ip(&self) -> Ipv6Addr {
        let host = self.cursor.fetch_add(1, Ordering::Relaxed) as u128;
        let base: u128 = self.network.network().into();
        let prefix_len = self.network.prefix();
        let host_bits = 128 - prefix_len;
        let masked = if host_bits == 0 { 0 } else { host & ((1u128 << host_bits) - 1) };
        Ipv6Addr::from(base | masked)
    }
}
