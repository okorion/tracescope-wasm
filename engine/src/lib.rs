pub mod arena;
pub mod diagnostics;
pub mod model;
pub mod scenario;
pub mod simulation;
pub mod store;

use arena::Handle;
use diagnostics::LIFECYCLE_CAPACITY;
use model::{parse_trace_id, Span, Status, SERVICES};
use serde_json::json;
use simulation::Simulation;
use wasm_bindgen::prelude::*;

/// One instance owns the entire synthetic workload and every developer tool.
#[wasm_bindgen]
pub struct Engine {
    sim: Simulation,
}

#[wasm_bindgen]
impl Engine {
    #[wasm_bindgen(constructor)]
    pub fn new(seed: u32) -> Self {
        Self {
            sim: Simulation::new(seed),
        }
    }

    pub fn select_scenario(&mut self, id: &str) {
        self.sim.reset(scenario::Scenario::parse(id));
    }
    pub fn play(&mut self) {
        self.sim.running = true;
    }
    pub fn pause(&mut self) {
        self.sim.running = false;
    }
    pub fn reset(&mut self) {
        self.sim.reset(self.sim.scenario);
    }
    pub fn set_speed(&mut self, multiplier: f64) {
        if [0.25, 1.0, 4.0].contains(&multiplier) {
            self.sim.speed = multiplier;
        }
    }
    pub fn tick(&mut self, real_delta_ms: f64) {
        if self.sim.running {
            self.sim.advance(real_delta_ms * self.sim.speed);
        }
    }
    pub fn step(&mut self, virtual_delta_ms: f64) {
        if !self.sim.running {
            self.sim.advance(virtual_delta_ms);
        }
    }
    pub fn set_retention(&mut self, seconds: f64) {
        if seconds.is_finite() {
            self.sim.retention_ms = (seconds.clamp(5.0, 120.0) * 1_000.0).round() as u64;
            self.sim.reap_current();
        }
    }
    pub fn set_diagnostics(&mut self, enabled: bool) {
        self.sim.store.diagnostics.enabled = enabled;
    }

    pub fn overview(&self) -> String {
        let p = self.sim.metrics();
        let recent: Vec<_> = self
            .sim
            .store
            .traces
            .values()
            .rev()
            .take(20)
            .map(|t| t.summary(self.sim.now))
            .collect();
        json!({
            "scenario": self.sim.scenario.id(), "now_ms": self.sim.now, "target_ms": self.sim.target,
            "running": self.sim.running, "speed": self.sim.speed, "retention_seconds": self.sim.retention_ms as f64 / 1_000.0,
            "rps": p.rps, "p50_ms": p.p50_ms, "p95_ms": p.p95_ms, "p99_ms": p.p99_ms, "error_rate": p.error_rate,
            "active_requests": self.sim.store.active_requests, "completed_requests": self.sim.store.completed_requests,
            "services": self.sim.store.services, "recent": recent, "history": self.sim.history,
        }).to_string()
    }

    pub fn query_traces(
        &self,
        search: &str,
        service: &str,
        status: &str,
        sort: &str,
        page: u32,
        page_size: u32,
    ) -> String {
        let search = search.chars().take(128).collect::<String>().to_lowercase();
        let service_index = if service.is_empty() {
            None
        } else {
            SERVICES.iter().position(|&s| s == service)
        };
        let valid_service = service.is_empty() || service_index.is_some();
        let mut items: Vec<_> = self
            .sim
            .store
            .traces
            .values()
            .filter(|trace| {
                valid_service
                    && service_index
                        .is_none_or(|i| self.sim.store.service_index[i].contains(&trace.id))
                    && match status {
                        "active" => trace.status == Status::Active,
                        "completed" => trace.end_ms.is_some(),
                        "error" => matches!(trace.status, Status::Error | Status::Timeout),
                        "pinned" => trace.pinned,
                        _ => true,
                    }
            })
            .map(|trace| trace.summary(self.sim.now))
            .filter(|t| {
                search.is_empty()
                    || t.id.contains(&search)
                    || t.operation.to_lowercase().contains(&search)
                    || self
                        .sim
                        .store
                        .traces
                        .get(&parse_trace_id(&t.id).unwrap())
                        .is_some_and(|trace| {
                            trace.spans.iter().flatten().any(|&h| {
                                self.sim.store.arena.get(h).is_some_and(|s| {
                                    SERVICES[s.service].contains(&search)
                                        || model::OPERATIONS[s.service]
                                            .to_lowercase()
                                            .contains(&search)
                                })
                            })
                        })
            })
            .collect();
        if sort == "duration" {
            items.sort_unstable_by(|a, b| {
                b.duration_ms
                    .cmp(&a.duration_ms)
                    .then(b.start_ms.cmp(&a.start_ms))
                    .then(b.id.cmp(&a.id))
            });
        } else {
            items.sort_unstable_by(|a, b| b.start_ms.cmp(&a.start_ms).then(b.id.cmp(&a.id)));
        }
        let total = items.len();
        let size = page_size.clamp(1, 50) as usize;
        let start = (page as usize).saturating_mul(size).min(total);
        let end = start.saturating_add(size).min(total);
        json!({"items": &items[start..end], "total": total, "page": page, "page_size": size})
            .to_string()
    }

    pub fn trace_detail(&self, trace_id: &str) -> String {
        serde_json::to_string(
            &parse_trace_id(trace_id).and_then(|id| self.sim.store.detail(id, self.sim.now)),
        )
        .unwrap()
    }
    pub fn pin_trace(&mut self, trace_id: &str, pinned: bool) -> bool {
        parse_trace_id(trace_id).is_some_and(|id| self.sim.store.pin(id, pinned, self.sim.now))
    }
    pub fn memory_stats(&self) -> String {
        let store = &self.sim.store;
        let arena = &store.arena;
        json!({
            "active_spans": arena.occupied, "active_traces": store.traces.len(),
            "arena_capacity": arena.slots.len(), "arena_reserved_slots": arena.slots.capacity(),
            "occupied_slots": arena.occupied, "free_slots": arena.free_len(), "retired_slots": arena.retired,
            "cumulative_allocations": arena.allocations, "cumulative_releases": arena.releases, "reused_slots": arena.reused,
            "reuse_ratio": if arena.allocations == 0 { 0.0 } else { arena.reused as f64 * 100.0 / arena.allocations as f64 },
            "pending_events": self.sim.pending_events(), "due_events": self.sim.due_events(),
            "backlog_ms": (self.sim.target - self.sim.now as f64).max(0.0),
            "retained_traces": store.traces.len() - store.active_requests, "pinned_traces": store.pinned,
            "trace_index_entries": store.traces.len(), "service_index_entries": store.service_index.iter().map(|s| s.len()).sum::<usize>(),
            "retention_index_entries": store.retention_index.len(),
            "lifecycle_len": store.diagnostics.events.len(), "lifecycle_capacity": LIFECYCLE_CAPACITY,
            "history_len": self.sim.history.len(), "diagnostics_enabled": store.diagnostics.enabled,
            "processed_events": self.sim.processed, "tick_event_budget": simulation::EVENT_BUDGET,
            "rolling_arrivals": self.sim.arrivals.len(), "rolling_completions": self.sim.completions.len(),
        }).to_string()
    }

    pub fn lifecycle(&self, cursor: f64, limit: u32) -> String {
        let d = &self.sim.store.diagnostics;
        let cursor = if cursor.is_finite() && cursor > 0.0 {
            cursor as u64
        } else {
            0
        };
        let limit = limit.clamp(1, 200) as usize;
        let events: Vec<_> = if cursor == 0 {
            d.events
                .iter()
                .skip(d.events.len().saturating_sub(limit))
                .collect()
        } else {
            d.events
                .iter()
                .filter(|e| e.cursor > cursor)
                .take(limit)
                .collect()
        };
        let next = events.last().map(|e| e.cursor).unwrap_or(cursor);
        json!({"events": events, "next_cursor": next, "oldest_cursor": d.events.front().map(|e| e.cursor).unwrap_or(d.next_cursor), "dropped": d.dropped}).to_string()
    }
    pub fn arena_snapshot(&self, start: u32, limit: u32) -> String {
        let total = self.sim.store.arena.slots.len();
        let start = (start as usize).min(total);
        let end = start
            .saturating_add(limit.clamp(1, 512) as usize)
            .min(total);
        let slots: Vec<_> = (start..end)
            .filter_map(|i| self.sim.store.slot_view(i as u32))
            .collect();
        json!({"slots": slots, "total": total, "start": start}).to_string()
    }
    pub fn inspect_handle(&mut self, index: u32, generation: u32) -> String {
        let handle = Handle { index, generation };
        let valid = self.sim.store.arena.get(handle).is_some();
        let slot = self.sim.store.slot_view(index);
        let reason = if valid {
            "Handle resolves to a live span"
        } else if slot.is_none() {
            "Index is outside the arena"
        } else if slot.as_ref().is_some_and(|s| s.state == "retired") {
            "Slot is permanently retired"
        } else if slot.as_ref().is_some_and(|s| s.generation != generation) {
            "Generation mismatch: stale handle rejected"
        } else {
            "Slot has no live value"
        };
        if !valid {
            self.sim.store.diagnostics.record(
                self.sim.now,
                "Invalid Handle Access",
                None,
                None,
                Some(handle),
                reason,
            );
        }
        json!({"valid": valid, "handle": handle, "slot": slot, "reason": reason}).to_string()
    }
    pub fn test_stale_handle(&mut self) -> String {
        let now = self.sim.now;
        let scratch = || Span {
            id: 0,
            trace_id: 0,
            service: 0,
            parent: None,
            start_ms: now,
            end_ms: Some(now),
            status: Status::Ok,
        };
        let store = &mut self.sim.store;
        let old = store.arena.allocate(scratch(), now);
        store.diagnostics.record(
            now,
            "Allocated",
            None,
            None,
            Some(old),
            "Safe probe allocated an isolated scratch span in the shared arena",
        );
        let _ = store.arena.remove(old, now);
        store.diagnostics.record(
            now,
            "Released",
            None,
            None,
            Some(old),
            "Safe probe released its scratch span",
        );
        let reused = store.arena.allocate(scratch(), now);
        store.diagnostics.record(
            now,
            if store.arena.slots[reused.index as usize].allocations > 1 {
                "Slot Reused"
            } else {
                "Allocated"
            },
            None,
            None,
            Some(reused),
            "Safe probe allocated a replacement from the free list",
        );
        let valid = store.arena.get(old).is_some();
        store.diagnostics.record(
            now,
            "Invalid Handle Access",
            None,
            None,
            Some(old),
            "Safe probe confirmed the old generation is rejected",
        );
        let _ = store.arena.remove(reused, now);
        store.diagnostics.record(
            now,
            "Released",
            None,
            None,
            Some(reused),
            "Safe probe released its replacement span; product traces were preserved",
        );
        json!({"valid": valid, "handle": old, "reused_handle": reused, "message": "Old handle rejected; both scratch values released, existing traces unchanged"}).to_string()
    }
}

// Native-only verification helpers are not exported through wasm-bindgen.
impl Engine {
    pub fn with_span_rate(seed: u32, spans_per_second: u32) -> Self {
        let mut engine = Self::new(seed);
        engine.sim.rate_override = Some(spans_per_second.clamp(100, 10_000));
        engine
    }
    pub fn simulation(&self) -> &Simulation {
        &self.sim
    }
    pub fn drain(&mut self) {
        while !self.sim.is_caught_up() {
            self.sim.advance(0.0);
        }
    }
}
