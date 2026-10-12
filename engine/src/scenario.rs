use crate::model::Status;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Scenario {
    Normal,
    Burst,
    SlowDatabase,
    ErrorStorm,
    Pinned,
}

impl Scenario {
    pub fn parse(id: &str) -> Self {
        match id {
            "burst" => Self::Burst,
            "slow_database" => Self::SlowDatabase,
            "error_storm" => Self::ErrorStorm,
            "pinned" => Self::Pinned,
            _ => Self::Normal,
        }
    }
    pub fn id(self) -> &'static str {
        match self {
            Self::Normal => "normal",
            Self::Burst => "burst",
            Self::SlowDatabase => "slow_database",
            Self::ErrorStorm => "error_storm",
            Self::Pinned => "pinned",
        }
    }
    pub fn arrival_interval_ms(self, now: u64) -> u64 {
        if self == Self::Burst && (15_000..25_000).contains(&now) {
            5
        } else {
            50
        }
    }
}

/// Small deterministic xorshift PRNG, not a security primitive.
pub struct Random(u64);
impl Random {
    pub fn new(seed: u32) -> Self {
        Self(u64::from(seed) + 0x9e3779b97f4a7c15)
    }
    pub fn next_u32(&mut self) -> u32 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        (x >> 32) as u32
    }
}

pub struct Plan {
    pub end_offsets: [u64; 5],
    pub statuses: [Status; 5],
}

pub const START_OFFSETS: [u64; 5] = [0, 2, 10, 30, 18];
pub const PARENTS: [Option<usize>; 5] = [None, Some(0), Some(0), Some(2), Some(2)];
pub const REQUEST_TIMEOUT_MS: u64 = 8_000;

pub fn plan(scenario: Scenario, now: u64, random: &mut Random) -> Plan {
    let latency = random.next_u32();
    let fate = random.next_u32() % 100;
    let mut database = 30 + u64::from(latency % 160);
    let mut status = Status::Ok;
    if scenario == Scenario::SlowDatabase && (10_000..30_000).contains(&now) {
        database = 2_000 + u64::from(latency % 3_001);
    }
    if fate < 2 {
        status = Status::Error;
    }
    if scenario == Scenario::ErrorStorm && (10_000..25_000).contains(&now) {
        status = match fate {
            0..=19 => Status::Timeout,
            20..=74 => Status::Error,
            _ => Status::Ok,
        };
        if status == Status::Timeout {
            database = REQUEST_TIMEOUT_MS;
        }
        if status == Status::Error {
            database = 8 + u64::from(latency % 20);
        }
    }
    let root_end = (database + 55).min(REQUEST_TIMEOUT_MS);
    let database_end = (database + 30).min(root_end);
    let order_end = if status == Status::Timeout {
        root_end
    } else {
        root_end - 5
    };
    Plan {
        end_offsets: [root_end, 9, order_end, database_end, 33],
        statuses: [status, Status::Ok, status, status, Status::Ok],
    }
}
