use crate::arena::Handle;
use serde::Serialize;
use std::collections::VecDeque;

pub const LIFECYCLE_CAPACITY: usize = 2048;
pub const HISTORY_CAPACITY: usize = 120;

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct LifecycleEvent {
    pub cursor: u64,
    pub time_ms: u64,
    pub kind: &'static str,
    pub trace_id: Option<String>,
    pub span_id: Option<String>,
    pub handle: Option<Handle>,
    pub message: &'static str,
}

pub struct Diagnostics {
    pub enabled: bool,
    pub events: VecDeque<LifecycleEvent>,
    pub next_cursor: u64,
    pub dropped: u64,
}

impl Default for Diagnostics {
    fn default() -> Self {
        Self {
            enabled: true,
            events: VecDeque::with_capacity(LIFECYCLE_CAPACITY),
            next_cursor: 1,
            dropped: 0,
        }
    }
}

impl Diagnostics {
    pub fn record(
        &mut self,
        now: u64,
        kind: &'static str,
        trace: Option<u64>,
        span: Option<u64>,
        handle: Option<Handle>,
        message: &'static str,
    ) {
        if !self.enabled {
            return;
        }
        if self.events.len() == LIFECYCLE_CAPACITY {
            self.events.pop_front();
            self.dropped += 1;
        }
        self.events.push_back(LifecycleEvent {
            cursor: self.next_cursor,
            time_ms: now,
            kind,
            trace_id: trace.map(crate::model::trace_id),
            span_id: span.map(crate::model::span_id),
            handle,
            message,
        });
        self.next_cursor += 1;
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct SeriesPoint {
    pub time_ms: u64,
    pub rps: f64,
    pub p50_ms: u64,
    pub p95_ms: u64,
    pub p99_ms: u64,
    pub error_rate: f64,
    pub live_spans: usize,
    pub arena_capacity: usize,
    pub free_slots: usize,
}

#[derive(Serialize)]
pub struct SlotView {
    pub index: u32,
    pub generation: u32,
    pub state: &'static str,
    pub span_id: Option<String>,
    pub trace_id: Option<String>,
    pub parent: Option<Handle>,
    pub reused: bool,
    pub allocations: u64,
    pub last_allocated_ms: Option<u64>,
    pub last_released_ms: Option<u64>,
}
