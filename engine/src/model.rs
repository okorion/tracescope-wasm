use crate::arena::Handle;
use serde::Serialize;
use std::collections::BTreeMap;

pub const SERVICES: [&str; 5] = ["gateway", "auth", "orders", "database", "cache"];
pub const OPERATIONS: [&str; 5] = [
    "GET /api/orders",
    "validate token",
    "load order",
    "SELECT orders",
    "cache lookup",
];

pub fn trace_id(id: u64) -> String {
    format!("trace-{id:08x}")
}
pub fn span_id(id: u64) -> String {
    format!("span-{id:08x}")
}
pub fn parse_trace_id(id: &str) -> Option<u64> {
    u64::from_str_radix(id.strip_prefix("trace-")?, 16).ok()
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Active,
    Ok,
    Error,
    Timeout,
}

#[derive(Debug)]
pub struct Span {
    pub id: u64,
    pub trace_id: u64,
    pub service: usize,
    pub parent: Option<Handle>,
    pub start_ms: u64,
    pub end_ms: Option<u64>,
    pub status: Status,
}

#[derive(Debug)]
pub struct Trace {
    pub id: u64,
    pub start_ms: u64,
    pub end_ms: Option<u64>,
    pub status: Status,
    pub pinned: bool,
    pub spans: [Option<Handle>; 5],
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct TraceSummary {
    pub id: String,
    pub operation: &'static str,
    pub service: &'static str,
    pub start_ms: u64,
    pub end_ms: Option<u64>,
    pub duration_ms: u64,
    pub status: Status,
    pub span_count: usize,
    pub pinned: bool,
}

impl Trace {
    pub fn summary(&self, now: u64) -> TraceSummary {
        TraceSummary {
            id: trace_id(self.id),
            operation: OPERATIONS[0],
            service: SERVICES[0],
            start_ms: self.start_ms,
            end_ms: self.end_ms,
            duration_ms: self.end_ms.unwrap_or(now).saturating_sub(self.start_ms),
            status: self.status,
            span_count: self.spans.iter().flatten().count(),
            pinned: self.pinned,
        }
    }
}

#[derive(Serialize)]
pub struct SpanView {
    pub id: String,
    pub trace_id: String,
    pub service: &'static str,
    pub operation: &'static str,
    pub handle: Handle,
    pub parent: Option<Handle>,
    pub start_ms: u64,
    pub end_ms: Option<u64>,
    pub duration_ms: u64,
    pub status: Status,
    pub attributes: BTreeMap<&'static str, String>,
}

impl Span {
    pub fn view(&self, handle: Handle, now: u64) -> SpanView {
        let mut attributes = BTreeMap::from([
            ("data.source", "synthetic".to_owned()),
            ("service.name", SERVICES[self.service].to_owned()),
        ]);
        if self.service == 0 {
            attributes.insert("http.method", "GET".into());
            attributes.insert("http.route", "/api/orders".into());
        }
        if self.service == 3 {
            attributes.insert("db.system", "postgresql (simulated)".into());
            attributes.insert("db.operation", "SELECT".into());
        }
        if self.status == Status::Error {
            attributes.insert("error.type", "simulated_failure".into());
        }
        if self.status == Status::Timeout {
            attributes.insert("error.type", "deadline_exceeded".into());
        }
        SpanView {
            id: span_id(self.id),
            trace_id: trace_id(self.trace_id),
            service: SERVICES[self.service],
            operation: OPERATIONS[self.service],
            handle,
            parent: self.parent,
            start_ms: self.start_ms,
            end_ms: self.end_ms,
            duration_ms: self.end_ms.unwrap_or(now).saturating_sub(self.start_ms),
            status: self.status,
            attributes,
        }
    }
}

#[derive(Serialize)]
pub struct TraceDetail {
    #[serde(flatten)]
    pub summary: TraceSummary,
    pub spans: Vec<SpanView>,
}
