use serde_json::json;
use std::{hint::black_box, time::Instant};
use tracescope_engine::{arena::Arena, Engine};

fn percentile(values: &[f64], p: usize) -> f64 {
    let mut sorted = values.to_vec();
    sorted.sort_by(f64::total_cmp);
    sorted[(sorted.len() * p).div_ceil(100).saturating_sub(1)]
}

fn main() {
    let mut results = Vec::new();
    for rate in [100, 1_000, 10_000] {
        let mut engine = Engine::with_span_rate(42, rate);
        let mut ticks = Vec::new();
        let mut live = Vec::new();
        let mut capacity = Vec::new();
        // 120 seconds virtual time; 100 ms caller cadence; bounded 5,000-event steps.
        for sample in 1..=1_200 {
            let start = Instant::now();
            engine.step(100.0);
            ticks.push(start.elapsed().as_secs_f64() * 1_000.0);
            while !engine.simulation().is_caught_up() {
                let start = Instant::now();
                engine.step(0.0);
                ticks.push(start.elapsed().as_secs_f64() * 1_000.0);
            }
            if sample >= 900 {
                live.push(engine.simulation().store.arena.occupied);
                capacity.push(engine.simulation().store.arena.slots.len());
            }
        }
        engine.simulation().store.check_integrity().unwrap();
        let mut query_times = Vec::new();
        for page in 0..20 {
            let start = Instant::now();
            black_box(engine.query_traces("", "database", "", "duration", page, 25));
            query_times.push(start.elapsed().as_secs_f64() * 1_000.0);
        }
        let stats: serde_json::Value = serde_json::from_str(&engine.memory_stats()).unwrap();
        let total_ms: f64 = ticks.iter().sum();
        results.push(json!({
            "spans_per_second": rate,
            "virtual_duration_ms": 120_000,
            "tick_delta_ms": 100,
            "engine_work_ms": total_ms,
            "processed_events_per_wall_second": engine.simulation().processed as f64 / (total_ms / 1_000.0),
            "tick_calls": ticks.len(),
            "tick_mean_ms": total_ms / ticks.len() as f64,
            "tick_p50_ms": percentile(&ticks, 50),
            "tick_p95_ms": percentile(&ticks, 95),
            "tick_max_ms": ticks.iter().copied().fold(0.0, f64::max),
            "query_p50_ms": percentile(&query_times, 50),
            "query_p95_ms": percentile(&query_times, 95),
            "steady_live_min": live.iter().min(),
            "steady_live_max": live.iter().max(),
            "steady_capacity_min": capacity.iter().min(),
            "steady_capacity_max": capacity.iter().max(),
            "memory_stats": stats,
            "wasm_linear_memory_bytes": null,
            "integrity_check": "passed"
        }));
    }

    let mut arena = Arena::default();
    let arena_start = Instant::now();
    for i in 0..100_000 {
        let h = arena.allocate(black_box(i), i);
        black_box(arena.remove(h, i));
    }
    let arena_ns = arena_start.elapsed().as_secs_f64() * 1_000_000_000.0 / 100_000.0;
    println!(
        "{}",
        serde_json::to_string_pretty(&json!({
            "runtime": "native Rust release (not WASM)",
            "seed": 42,
            "retention_seconds": 60,
            "detailed_diagnostics": true,
            "query_condition": "database filter, duration descending, 25 rows; 20 pages",
            "steady_measurement_interval_seconds": [90, 120],
            "arena_allocate_release_ns_per_pair": arena_ns,
            "arena_reused_slots": arena.reused,
            "results": results,
        }))
        .unwrap()
    );
}
