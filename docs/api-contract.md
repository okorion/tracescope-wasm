# Engine integration contract

Rust owns all trace/span, scheduler, index, retention and lifecycle state. UI stores only bounded snapshots and selection IDs. JSON uses snake_case. All times are virtual milliseconds, counts are integers. IDs are strings. Missing values are null. API serializes finite JSON values.

`Engine(seed: number)` is one wasm-bindgen class. Methods:

- `select_scenario(id: string)` resets state, pauses. IDs: normal, burst, slow_database, error_storm, pinned.
- `play()`, `pause()`, `reset()` (reset preserves scenario/config, pauses).
- `set_speed(multiplier: number)` allowed 0.25, 1, 4.
- `tick(real_delta_ms: number)` progresses only when playing, scaled virtual target, at most a fixed event budget per call. `tick(0)` drains backlog when playing. Never discards events.
- `step(virtual_delta_ms: number)` progresses when paused, same event budget, no speed scale; `step(0)` drains debt.
- `set_retention(seconds: number)` clamped 5..120, acts from completion time and immediately reevaluates expired unpinned traces.
- `set_diagnostics(enabled: boolean)` controls detailed lifecycle records.
- `overview(): string` JSON `Overview`.
- `query_traces(search: string, service: string, status: string, sort: string, page: number, page_size: number): string`. Empty service/status = all, status active/completed/error/pinned, sort newest/duration. Page zero-based, size max 50. JSON `{items: TraceSummary[], total, page, page_size}`.
- `trace_detail(trace_id: string): string` JSON `TraceDetail | null`.
- `pin_trace(trace_id: string, pinned: boolean): boolean` returns success. Bounded pin count (max 128).
- `memory_stats(): string` JSON `MemoryStats`, WASM bytes measured by JS memory.buffer.byteLength.
- `lifecycle(cursor: number, limit: number): string` JSON `{events: LifecycleEvent[], next_cursor, oldest_cursor, dropped}` (max 200 returned, ring 2048; newest events if cursor 0).
- `arena_snapshot(start: number, limit: number): string` JSON `{slots: SlotView[], total, start}` (limit max 512).
- `inspect_handle(index: number, generation: number): string` JSON `{valid, handle: Handle, slot: SlotView | null, reason: string}`. Invalid inspection records actual rejection.
- `test_stale_handle(): string` safely allocate/remove scratch span in SAME arena, test old handle without mutating existing traces. JSON `{valid: false, handle, reused_handle, message}`.

Handle = `{index, generation}`.
TraceSummary = `{id, operation, service, start_ms, end_ms: number|null, duration_ms, status: 'active'|'ok'|'error'|'timeout', span_count, pinned}`.
TraceDetail = TraceSummary + `{spans: SpanView[]}`.
SpanView = `{id, trace_id, service, operation, handle, parent: Handle|null, start_ms, end_ms: number|null, duration_ms, status: 'active'|'ok'|'error'|'timeout', attributes: Record<string,string>}`.
SeriesPoint = `{time_ms, rps, p50_ms, p95_ms, p99_ms, error_rate, live_spans, arena_capacity, free_slots}`. Rust history max 120, sampled at deterministic virtual 1s boundaries.
Overview = `{scenario, now_ms, target_ms, running, speed, retention_seconds, rps, p50_ms, p95_ms, p99_ms, error_rate, active_requests, completed_requests, services: {name, active_spans, completed_spans, error_count}[], recent: TraceSummary[], history: SeriesPoint[]}`. Rates/percentiles are last 10 virtual seconds, error_rate 0..100. completed_requests cumulative since reset. Services metrics scope documented.
MemoryStats = `{active_spans, active_traces, arena_capacity, occupied_slots, free_slots, retired_slots, cumulative_allocations, cumulative_releases, reused_slots, reuse_ratio, pending_events, due_events, backlog_ms, retained_traces, pinned_traces, trace_index_entries, service_index_entries, lifecycle_len, lifecycle_capacity, history_len, diagnostics_enabled, processed_events}`. active_spans = all live allocated spans (including retained); active_traces = all stored traces; active_requests = only in-flight. reuse_ratio 0..100. arena_capacity = logical slots, separately document Vec capacity if supplied.
LifecycleEvent = `{cursor, time_ms, kind, trace_id: string|null, span_id: string|null, handle: Handle|null, message}`. Kinds: Allocated, Started, Completed, Retained, Pinned, Unpinned, Expired, Released, Slot Reused, Invalid Handle Access.
SlotView = `{index, generation, state: 'occupied'|'free'|'retired', span_id: string|null, trace_id: string|null, parent: Handle|null, reused: boolean, allocations, last_allocated_ms: number|null, last_released_ms: number|null}`.

Normal: 20 requests/s × 5 spans, 100 spans/s. Burst at virtual 15..25s: 200 requests/s (1,000 spans/s). Slow DB at 10..30s: 2–5s DB with request timeout cap 8s. Error storm at 10..25s: high error/early completion/timeout patterns. Pinned scenario auto-pins a small bounded selection (3) during first seconds; manual unpin remains effective. All scenarios return to normal and use one engine. Every request finite timeout, all child ends before or at root end. Scenario planning happens at arrival, PRNG deterministic. Event tie-order uses monotonic sequence. Retention sweeps and metric sampling scheduled on virtual clock, not JS tick boundaries. Pin limit 128; all other diagnostics and rolling metric structures bounded.
