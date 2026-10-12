use crate::{
    arena::Arena,
    diagnostics::{Diagnostics, SlotView},
    model::*,
};
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};

pub const MAX_PINNED: usize = 128;

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct ServiceStats {
    pub name: &'static str,
    pub active_spans: usize,
    pub completed_spans: u64,
    pub error_count: u64,
}

pub struct Store {
    pub arena: Arena<Span>,
    pub traces: BTreeMap<u64, Trace>,
    pub service_index: [BTreeSet<u64>; 5],
    /// Only completed, unpinned traces enter this ordered expiration index.
    /// Retention duration is applied when reading the head, so changing the
    /// policy never duplicates scheduled expiry events.
    pub retention_index: BTreeSet<(u64, u64)>,
    pub services: [ServiceStats; 5],
    pub active_requests: usize,
    pub completed_requests: u64,
    pub pinned: usize,
    pub diagnostics: Diagnostics,
}

impl Default for Store {
    fn default() -> Self {
        Self {
            arena: Arena::default(),
            traces: BTreeMap::new(),
            service_index: std::array::from_fn(|_| BTreeSet::new()),
            retention_index: BTreeSet::new(),
            services: std::array::from_fn(|i| ServiceStats {
                name: SERVICES[i],
                ..ServiceStats::default()
            }),
            active_requests: 0,
            completed_requests: 0,
            pinned: 0,
            diagnostics: Diagnostics::default(),
        }
    }
}

impl Store {
    pub fn start_trace(&mut self, id: u64, now: u64) {
        self.traces.insert(
            id,
            Trace {
                id,
                start_ms: now,
                end_ms: None,
                status: Status::Active,
                pinned: false,
                spans: [None; 5],
            },
        );
        self.active_requests += 1;
        self.start_span(id, 0, None, now);
    }

    pub fn start_span(
        &mut self,
        trace_id: u64,
        service: usize,
        parent_index: Option<usize>,
        now: u64,
    ) {
        let Some(trace) = self.traces.get(&trace_id) else {
            return;
        };
        if trace.end_ms.is_some() || trace.spans[service].is_some() {
            return;
        }
        let parent = parent_index.and_then(|i| trace.spans[i]);
        if parent_index.is_some() && parent.is_none() {
            return;
        }
        let id = trace_id * 5 + service as u64;
        let span = Span {
            id,
            trace_id,
            service,
            parent,
            start_ms: now,
            end_ms: None,
            status: Status::Active,
        };
        let handle = self.arena.allocate(span, now);
        self.traces.get_mut(&trace_id).unwrap().spans[service] = Some(handle);
        self.service_index[service].insert(trace_id);
        self.services[service].active_spans += 1;
        self.diagnostics.record(
            now,
            "Allocated",
            Some(trace_id),
            Some(id),
            Some(handle),
            "Span value allocated in the shared arena",
        );
        if self.arena.slots[handle.index as usize].allocations > 1 {
            self.diagnostics.record(
                now,
                "Slot Reused",
                Some(trace_id),
                Some(id),
                Some(handle),
                "Free-list slot reused with its current generation",
            );
        }
        self.diagnostics.record(
            now,
            "Started",
            Some(trace_id),
            Some(id),
            Some(handle),
            "Scheduled span start processed",
        );
    }

    pub fn end_span(&mut self, trace_id: u64, service: usize, now: u64, status: Status) {
        let handle = self.traces.get(&trace_id).and_then(|t| t.spans[service]);
        let Some(handle) = handle else {
            return;
        };
        let Some(span) = self.arena.get_mut(handle) else {
            return;
        };
        if span.end_ms.is_some() {
            return;
        }
        span.end_ms = Some(now);
        span.status = status;
        self.services[service].active_spans -= 1;
        self.services[service].completed_spans += 1;
        if matches!(status, Status::Error | Status::Timeout) {
            self.services[service].error_count += 1;
        }
        self.diagnostics.record(
            now,
            "Completed",
            Some(trace_id),
            Some(span.id),
            Some(handle),
            "Scheduled span end processed",
        );
    }

    /// A root completion/timeout closes any unfinished children first.
    pub fn complete_trace(&mut self, id: u64, now: u64, status: Status) -> Option<u64> {
        let trace = self.traces.get(&id)?;
        if trace.end_ms.is_some() {
            return None;
        }
        let started = trace.start_ms;
        for service in 1..5 {
            self.end_span(id, service, now, status);
        }
        self.end_span(id, 0, now, status);
        let trace = self.traces.get_mut(&id).unwrap();
        trace.end_ms = Some(now);
        trace.status = status;
        if !trace.pinned {
            self.retention_index.insert((now, id));
        }
        self.active_requests -= 1;
        self.completed_requests += 1;
        self.diagnostics.record(
            now,
            "Retained",
            Some(id),
            None,
            None,
            "Request completed; retention starts at this timestamp",
        );
        Some(now.saturating_sub(started))
    }

    pub fn pin(&mut self, id: u64, pinned: bool, now: u64) -> bool {
        let Some(trace) = self.traces.get_mut(&id) else {
            return false;
        };
        if trace.pinned == pinned {
            return true;
        }
        if pinned && self.pinned >= MAX_PINNED {
            return false;
        }
        trace.pinned = pinned;
        if pinned {
            self.pinned += 1;
            if let Some(end) = trace.end_ms {
                self.retention_index.remove(&(end, id));
            }
        } else {
            self.pinned -= 1;
            if let Some(end) = trace.end_ms {
                self.retention_index.insert((end, id));
            }
        }
        self.diagnostics.record(
            now,
            if pinned { "Pinned" } else { "Unpinned" },
            Some(id),
            None,
            None,
            if pinned {
                "Explicit preservation enabled"
            } else {
                "Preservation disabled; expiration policy applies again"
            },
        );
        true
    }

    pub fn next_expiration(&self, retention_ms: u64) -> Option<(u64, u64)> {
        self.retention_index
            .first()
            .map(|&(end, id)| (end.saturating_add(retention_ms), id))
    }

    pub fn expire(&mut self, id: u64, now: u64) {
        let Some(trace) = self.traces.get(&id) else {
            return;
        };
        if trace.pinned || trace.end_ms.is_none() {
            return;
        }
        let trace = self.traces.remove(&id).unwrap();
        self.retention_index.remove(&(trace.end_ms.unwrap(), id));
        self.diagnostics.record(
            now,
            "Expired",
            Some(id),
            None,
            None,
            "Completed trace exceeded the retention duration",
        );
        for handle in trace.spans.into_iter().flatten() {
            if let Some(span) = self.arena.remove(handle, now) {
                self.diagnostics.record(
                    now,
                    "Released",
                    Some(id),
                    Some(span.id),
                    Some(handle),
                    "Span removed; its owned value is dropped and slot becomes reusable",
                );
            }
        }
        for index in &mut self.service_index {
            index.remove(&id);
        }
    }

    pub fn slot_view(&self, index: u32) -> Option<SlotView> {
        let slot = self.arena.slots.get(index as usize)?;
        Some(SlotView {
            index,
            generation: slot.generation,
            state: if slot.retired {
                "retired"
            } else if slot.value.is_some() {
                "occupied"
            } else {
                "free"
            },
            span_id: slot.value.as_ref().map(|s| span_id(s.id)),
            trace_id: slot.value.as_ref().map(|s| trace_id(s.trace_id)),
            parent: slot.value.as_ref().and_then(|s| s.parent),
            reused: slot.allocations > 1,
            allocations: slot.allocations,
            last_allocated_ms: slot.last_allocated_ms,
            last_released_ms: slot.last_released_ms,
        })
    }

    pub fn detail(&self, id: u64, now: u64) -> Option<TraceDetail> {
        let trace = self.traces.get(&id)?;
        Some(TraceDetail {
            summary: trace.summary(now),
            spans: trace
                .spans
                .iter()
                .flatten()
                .filter_map(|&h| self.arena.get(h).map(|s| s.view(h, now)))
                .collect(),
        })
    }

    /// Exhaustive verification intended for native tests and benchmarks only.
    pub fn check_integrity(&self) -> Result<(), String> {
        let mut count = 0;
        let mut active = 0;
        let mut pinned = 0;
        for (&id, trace) in &self.traces {
            if trace.end_ms.is_none() {
                active += 1;
            }
            if trace.pinned {
                pinned += 1;
            }
            let should_expire = trace.end_ms.is_some() && !trace.pinned;
            if trace
                .end_ms
                .is_some_and(|end| self.retention_index.contains(&(end, id)))
                != should_expire
            {
                return Err("retention index mismatch".into());
            }
            for (service, h) in trace.spans.iter().enumerate() {
                if self.service_index[service].contains(&id) != h.is_some() {
                    return Err("service membership mismatch".into());
                }
                if let Some(h) = h {
                    let span = self.arena.get(*h).ok_or("invalid owned span handle")?;
                    count += 1;
                    if span.trace_id != id {
                        return Err("trace ownership mismatch".into());
                    }
                    if let Some(parent) = span.parent {
                        let p = self.arena.get(parent).ok_or("stale parent")?;
                        if p.trace_id != id
                            || p.start_ms > span.start_ms
                            || p.end_ms.zip(span.end_ms).is_some_and(|(p, c)| c > p)
                        {
                            return Err("parent lifetime mismatch".into());
                        }
                    }
                }
            }
        }
        for index in &self.service_index {
            if index.iter().any(|id| !self.traces.contains_key(id)) {
                return Err("orphan service index".into());
            }
        }
        if self
            .retention_index
            .iter()
            .any(|&(_, id)| !self.traces.contains_key(&id))
        {
            return Err("orphan expiry index".into());
        }
        if count != self.arena.occupied || active != self.active_requests || pinned != self.pinned {
            return Err("aggregate mismatch".into());
        }
        if self.arena.occupied + self.arena.free_len() + self.arena.retired
            != self.arena.slots.len()
        {
            return Err("slot partition mismatch".into());
        }
        Ok(())
    }
}
