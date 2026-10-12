use crate::{
    diagnostics::{SeriesPoint, HISTORY_CAPACITY},
    model::Status,
    scenario::{self, Random, Scenario},
    store::Store,
};
use std::{
    cmp::Ordering,
    collections::{BinaryHeap, VecDeque},
};

pub const EVENT_BUDGET: usize = 5_000;
pub const ROLLING_WINDOW_MS: u64 = 10_000;
pub const ROLLING_MAX: usize = 50_000;

#[derive(Debug)]
enum EventKind {
    Arrival,
    SpanStart {
        trace: u64,
        service: usize,
    },
    SpanEnd {
        trace: u64,
        service: usize,
        status: Status,
    },
    Sample,
}

#[derive(Debug)]
struct Event {
    at: u64,
    sequence: u64,
    kind: EventKind,
}
impl PartialEq for Event {
    fn eq(&self, other: &Self) -> bool {
        (self.at, self.sequence) == (other.at, other.sequence)
    }
}
impl Eq for Event {}
impl Ord for Event {
    fn cmp(&self, other: &Self) -> Ordering {
        (other.at, other.sequence).cmp(&(self.at, self.sequence))
    }
}
impl PartialOrd for Event {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

pub struct Simulation {
    pub seed: u32,
    pub scenario: Scenario,
    pub now: u64,
    pub target: f64,
    pub running: bool,
    pub speed: f64,
    pub retention_ms: u64,
    pub store: Store,
    pub history: VecDeque<SeriesPoint>,
    pub processed: u64,
    pub arrivals: VecDeque<u64>,
    pub completions: VecDeque<(u64, u64, bool)>,
    random: Random,
    events: BinaryHeap<Event>,
    sequence: u64,
    next_trace: u64,
    /// Native benchmark override only. Product always uses scenario rates.
    pub rate_override: Option<u32>,
    arrival_counter: u64,
    // Keep the unrounded compensated sum separate from the public/scheduler
    // projection. Rounding each individual browser frame would introduce drift.
    clock_total: f64,
    clock_compensation: f64,
}

impl Simulation {
    pub fn new(seed: u32) -> Self {
        let mut s = Self {
            seed,
            scenario: Scenario::Normal,
            now: 0,
            target: 0.0,
            running: false,
            speed: 1.0,
            retention_ms: 60_000,
            store: Store::default(),
            history: VecDeque::with_capacity(HISTORY_CAPACITY),
            processed: 0,
            arrivals: VecDeque::new(),
            completions: VecDeque::new(),
            random: Random::new(seed),
            events: BinaryHeap::new(),
            sequence: 0,
            next_trace: 1,
            rate_override: None,
            arrival_counter: 0,
            clock_total: 0.0,
            clock_compensation: 0.0,
        };
        s.schedule(0, EventKind::Arrival);
        s.schedule(1_000, EventKind::Sample);
        s
    }

    pub fn reset(&mut self, scenario: Scenario) {
        let (seed, speed, retention, enabled, rate) = (
            self.seed,
            self.speed,
            self.retention_ms,
            self.store.diagnostics.enabled,
            self.rate_override,
        );
        *self = Self::new(seed);
        self.scenario = scenario;
        self.speed = speed;
        self.retention_ms = retention;
        self.store.diagnostics.enabled = enabled;
        self.rate_override = rate;
    }

    fn schedule(&mut self, at: u64, kind: EventKind) {
        self.sequence += 1;
        self.events.push(Event {
            at,
            sequence: self.sequence,
            kind,
        });
    }

    pub fn advance(&mut self, delta: f64) {
        if !delta.is_finite() || delta < 0.0 {
            return;
        }
        // Kahan summation preserves small fractional frame deltas. Only project
        // the cumulative target to 1 nanosecond (0.000001 ms), keeping the raw
        // sum untouched; this removes floating noise at integer-ms event edges.
        let corrected = delta - self.clock_compensation;
        let total = self.clock_total + corrected;
        self.clock_compensation = (total - self.clock_total) - corrected;
        self.clock_total = total.min(9_000_000_000_000.0);
        if total >= 9_000_000_000_000.0 {
            self.clock_compensation = 0.0;
        }
        self.target = (self.clock_total * 1_000_000.0).round() / 1_000_000.0;
        let target = self.target.floor() as u64;
        for _ in 0..EVENT_BUDGET {
            let event_time = self.events.peek().map(|e| e.at).unwrap_or(u64::MAX);
            let expiration = self.store.next_expiration(self.retention_ms);
            let expiration_time = expiration.map(|(at, _)| at).unwrap_or(u64::MAX);
            let next = event_time.min(expiration_time);
            if next > target {
                self.now = target;
                break;
            }
            self.now = self.now.max(next);
            self.processed += 1;
            // At equal times expired values are released before new allocations.
            if expiration_time <= event_time {
                self.store.expire(expiration.unwrap().1, self.now);
            } else {
                let event = self.events.pop().unwrap();
                self.process(event.kind);
            }
        }
        if self.is_caught_up() {
            self.now = target;
        }
        self.prune_window();
    }

    /// A policy edit may release values at the current time, but never starts
    /// requests or consumes virtual-time debt while the user has paused.
    pub fn reap_current(&mut self) {
        for _ in 0..EVENT_BUDGET {
            let Some((at, id)) = self.store.next_expiration(self.retention_ms) else {
                break;
            };
            if at > self.now {
                break;
            }
            self.store.expire(id, self.now);
            self.processed += 1;
        }
    }

    fn process(&mut self, event: EventKind) {
        match event {
            EventKind::Arrival => {
                let id = self.next_trace;
                self.next_trace += 1;
                self.arrival_counter += 1;
                self.store.start_trace(id, self.now);
                if self.arrivals.len() == ROLLING_MAX {
                    self.arrivals.pop_front();
                }
                self.arrivals.push_back(self.now);
                let plan = scenario::plan(self.scenario, self.now, &mut self.random);
                for service in 1..5 {
                    self.schedule(
                        self.now + scenario::START_OFFSETS[service],
                        EventKind::SpanStart { trace: id, service },
                    );
                }
                // Children are enqueued before the root for equal-time timeouts.
                for service in [1, 3, 4, 2, 0] {
                    self.schedule(
                        self.now + plan.end_offsets[service],
                        EventKind::SpanEnd {
                            trace: id,
                            service,
                            status: plan.statuses[service],
                        },
                    );
                }
                if self.scenario == Scenario::Pinned && [5, 15, 25].contains(&id) {
                    self.store.pin(id, true, self.now);
                }
                let next = if let Some(rate) = self.rate_override {
                    // Integer rational schedule supports 10,000 spans/s (2 arrivals/ms).
                    self.arrival_counter * 5_000 / u64::from(rate)
                } else {
                    self.now + self.scenario.arrival_interval_ms(self.now)
                };
                self.schedule(next, EventKind::Arrival);
            }
            EventKind::SpanStart { trace, service } => {
                self.store
                    .start_span(trace, service, scenario::PARENTS[service], self.now)
            }
            EventKind::SpanEnd {
                trace,
                service,
                status,
            } => {
                if service == 0 {
                    if let Some(duration) = self.store.complete_trace(trace, self.now, status) {
                        if self.completions.len() == ROLLING_MAX {
                            self.completions.pop_front();
                        }
                        self.completions.push_back((
                            self.now,
                            duration,
                            matches!(status, Status::Error | Status::Timeout),
                        ));
                    }
                } else {
                    self.store.end_span(trace, service, self.now, status);
                }
            }
            EventKind::Sample => {
                self.prune_window();
                let point = self.metrics();
                if self.history.len() == HISTORY_CAPACITY {
                    self.history.pop_front();
                }
                self.history.push_back(point);
                self.schedule(self.now + 1_000, EventKind::Sample);
            }
        }
    }

    fn prune_window(&mut self) {
        if self.now < ROLLING_WINDOW_MS {
            return;
        }
        let cutoff = self.now - ROLLING_WINDOW_MS;
        while self.arrivals.front().is_some_and(|&at| at <= cutoff) {
            self.arrivals.pop_front();
        }
        while self
            .completions
            .front()
            .is_some_and(|&(at, _, _)| at <= cutoff)
        {
            self.completions.pop_front();
        }
    }

    pub fn metrics(&self) -> SeriesPoint {
        let cutoff = self.now.saturating_sub(ROLLING_WINDOW_MS);
        let in_window = |at: u64| self.now < ROLLING_WINDOW_MS || at > cutoff;
        let arrivals = self.arrivals.iter().filter(|&&at| in_window(at)).count();
        let recent: Vec<_> = self
            .completions
            .iter()
            .filter(|&&(at, _, _)| in_window(at))
            .collect();
        let mut durations: Vec<_> = recent.iter().map(|&&(_, duration, _)| duration).collect();
        durations.sort_unstable();
        let percentile = |p: usize| -> u64 {
            if durations.is_empty() {
                0
            } else {
                durations[(durations.len() * p).div_ceil(100).saturating_sub(1)]
            }
        };
        SeriesPoint {
            time_ms: self.now,
            rps: arrivals as f64 / (self.now.clamp(1_000, ROLLING_WINDOW_MS) as f64 / 1_000.0),
            p50_ms: percentile(50),
            p95_ms: percentile(95),
            p99_ms: percentile(99),
            error_rate: if recent.is_empty() {
                0.0
            } else {
                recent.iter().filter(|&&&(_, _, error)| error).count() as f64 * 100.0
                    / recent.len() as f64
            },
            live_spans: self.store.arena.occupied,
            arena_capacity: self.store.arena.slots.len(),
            free_slots: self.store.arena.free_len(),
        }
    }

    pub fn pending_events(&self) -> usize {
        self.events.len() + self.store.retention_index.len()
    }

    pub fn due_events(&self) -> usize {
        let target = self.target.floor() as u64;
        self.events.iter().filter(|e| e.at <= target).count()
            + self
                .store
                .retention_index
                .iter()
                .take_while(|&&(end, _)| end.saturating_add(self.retention_ms) <= target)
                .count()
    }

    pub fn is_caught_up(&self) -> bool {
        let target = self.target.floor() as u64;
        self.events.peek().is_none_or(|e| e.at > target)
            && self
                .store
                .next_expiration(self.retention_ms)
                .is_none_or(|(at, _)| at > target)
    }
}
