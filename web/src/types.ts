export type Handle = { index: number; generation: number };
export type TraceStatus = 'active' | 'ok' | 'error' | 'timeout';
export type TraceSummary = {
  id: string; operation: string; service: string; start_ms: number; end_ms: number | null;
  duration_ms: number; status: TraceStatus; span_count: number; pinned: boolean;
};
export type SpanView = {
  id: string; trace_id: string; service: string; operation: string; handle: Handle;
  parent: Handle | null; start_ms: number; end_ms: number | null; duration_ms: number;
  status: TraceStatus; attributes: Record<string, string>;
};
export type TraceDetail = TraceSummary & { spans: SpanView[] };
export type TraceQuery = { items: TraceSummary[]; total: number; page: number; page_size: number };
export type SeriesPoint = {
  time_ms: number; rps: number; p50_ms: number; p95_ms: number; p99_ms: number;
  error_rate: number; live_spans: number; arena_capacity: number; free_slots: number;
};
export type Overview = {
  scenario: string; now_ms: number; target_ms: number; running: boolean; speed: number;
  retention_seconds: number; rps: number; p50_ms: number; p95_ms: number; p99_ms: number;
  error_rate: number; active_requests: number; completed_requests: number;
  services: { name: string; active_spans: number; completed_spans: number; error_count: number }[];
  recent: TraceSummary[]; history: SeriesPoint[];
};
export type MemoryStats = {
  active_spans: number; active_traces: number; arena_capacity: number; occupied_slots: number;
  free_slots: number; retired_slots: number; cumulative_allocations: number;
  cumulative_releases: number; reused_slots: number; reuse_ratio: number;
  pending_events: number; due_events: number; backlog_ms: number; retained_traces: number;
  pinned_traces: number; trace_index_entries: number; service_index_entries: number;
  lifecycle_len: number; lifecycle_capacity: number; history_len: number;
  diagnostics_enabled: boolean; processed_events: number;
};
export type LifecycleEvent = {
  cursor: number; time_ms: number; kind: string; trace_id: string | null;
  span_id: string | null; handle: Handle | null; message: string;
};
export type LifecyclePage = { events: LifecycleEvent[]; next_cursor: number; oldest_cursor: number; dropped: number };
export type SlotView = {
  index: number; generation: number; state: 'occupied' | 'free' | 'retired';
  span_id: string | null; trace_id: string | null; parent: Handle | null; reused: boolean;
  allocations: number; last_allocated_ms: number | null; last_released_ms: number | null;
};
export type ArenaPage = { slots: SlotView[]; total: number; start: number };
export type Inspection = { valid: boolean; handle: Handle; slot: SlotView | null; reason: string };
export type ProbeResult = { valid: boolean; handle: Handle; reused_handle: Handle; message: string };
export type MemoryPoint = {time_ms: number; bytes: number};
