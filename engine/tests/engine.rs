use serde_json::{json, Value};
use tracescope_engine::{
    arena::Handle,
    diagnostics::LIFECYCLE_CAPACITY,
    model::{self, Status},
    store::Store,
    Engine,
};

fn read(s: String) -> Value {
    serde_json::from_str(&s).unwrap()
}
fn advance(e: &mut Engine, ms: f64) {
    e.step(ms);
    e.drain();
}
fn stats(e: &Engine) -> Value {
    read(e.memory_stats())
}

#[test]
fn trace_and_span_start_then_complete_from_real_events() {
    let mut e = Engine::new(7);
    advance(&mut e, 0.0);
    let trace = read(e.trace_detail("trace-00000001"));
    assert_eq!(trace["status"], "active");
    assert_eq!(trace["spans"].as_array().unwrap().len(), 1);
    advance(&mut e, 40.0);
    let trace = read(e.trace_detail("trace-00000001"));
    assert_eq!(trace["span_count"], 5);
    assert_eq!(trace["spans"][1]["status"], "ok");
    advance(&mut e, 400.0);
    let trace = read(e.trace_detail("trace-00000001"));
    assert!(trace["end_ms"].is_number());
    assert!(trace["spans"]
        .as_array()
        .unwrap()
        .iter()
        .all(|s| s["end_ms"].is_number()));
    e.simulation().store.check_integrity().unwrap();
}

#[test]
fn retention_is_measured_from_completion_not_start() {
    let mut e = Engine::new(7);
    e.set_retention(5.0);
    advance(&mut e, 300.0);
    let end = read(e.trace_detail("trace-00000001"))["end_ms"]
        .as_u64()
        .unwrap();
    advance(&mut e, (end + 4_999 - 300) as f64);
    assert!(!read(e.trace_detail("trace-00000001")).is_null());
    advance(&mut e, 1.0);
    assert!(read(e.trace_detail("trace-00000001")).is_null());
}

#[test]
fn expiration_cleans_trace_service_and_retention_indexes() {
    let mut e = Engine::new(9);
    e.set_retention(5.0);
    advance(&mut e, 20_000.0);
    let s = &e.simulation().store;
    assert!(!s.traces.contains_key(&1));
    assert!(s.service_index.iter().all(|index| !index.contains(&1)));
    assert!(s.retention_index.iter().all(|&(_, id)| id != 1));
    assert_eq!(
        s.service_index
            .iter()
            .map(|index| index.len())
            .sum::<usize>(),
        s.arena.occupied
    );
    s.check_integrity().unwrap();
}

#[test]
fn pin_survives_retention_and_unpin_releases_all_handles() {
    let mut e = Engine::new(7);
    e.set_retention(5.0);
    advance(&mut e, 400.0);
    let handles = e.simulation().store.traces[&1].spans;
    assert!(e.pin_trace("trace-00000001", true));
    advance(&mut e, 10_000.0);
    assert!(e.simulation().store.traces.contains_key(&1));
    assert!(handles
        .iter()
        .flatten()
        .all(|&h| e.simulation().store.arena.get(h).is_some()));
    assert!(e.pin_trace("trace-00000001", false));
    e.step(0.0);
    assert!(!e.simulation().store.traces.contains_key(&1));
    assert!(handles
        .iter()
        .flatten()
        .all(|&h| e.simulation().store.arena.get(h).is_none()));
    e.simulation().store.check_integrity().unwrap();
}

#[test]
fn pinned_scenario_uses_same_store_and_manual_unpin_stays_effective() {
    let mut e = Engine::new(42);
    e.select_scenario("pinned");
    e.set_retention(5.0);
    advance(&mut e, 70_000.0);
    assert_eq!(stats(&e)["pinned_traces"], 3);
    assert!(e.pin_trace(&model::trace_id(5), false));
    advance(&mut e, 10_000.0);
    assert_eq!(stats(&e)["pinned_traces"], 2);
    assert!(!e.simulation().store.traces.contains_key(&5));
}

#[test]
fn pin_limit_prevents_unbounded_user_preservation() {
    let mut e = Engine::new(42);
    advance(&mut e, 10_000.0);
    for id in 1..=128 {
        assert!(e.pin_trace(&model::trace_id(id), true));
    }
    assert!(!e.pin_trace(&model::trace_id(129), true));
    assert!(e.pin_trace(&model::trace_id(1), false));
    assert!(e.pin_trace(&model::trace_id(129), true));
    assert_eq!(stats(&e)["pinned_traces"], 128);
}

#[test]
fn active_request_never_enters_retention_index() {
    let mut store = Store::default();
    store.start_trace(1, 0);
    store.start_span(1, 2, Some(0), 10);
    assert!(store.next_expiration(5_000).is_none());
    store.expire(1, 50_000);
    assert!(store.traces.contains_key(&1));
    store.check_integrity().unwrap();
}

#[test]
fn abnormal_completion_closes_active_children_and_preserves_parent_lifetimes() {
    let mut store = Store::default();
    store.start_trace(1, 0);
    store.start_span(1, 2, Some(0), 10);
    store.start_span(1, 3, Some(2), 30);
    assert_eq!(store.complete_trace(1, 8_000, Status::Timeout), Some(8_000));
    assert_eq!(store.complete_trace(1, 8_010, Status::Timeout), None);
    for h in store.traces[&1].spans.iter().flatten() {
        assert_eq!(store.arena.get(*h).unwrap().end_ms, Some(8_000));
        assert_eq!(store.arena.get(*h).unwrap().status, Status::Timeout);
    }
    store.check_integrity().unwrap();
}

#[test]
fn same_seed_produces_identical_history_queries_and_lifecycle() {
    let mut a = Engine::new(123);
    let mut b = Engine::new(123);
    advance(&mut a, 20_000.0);
    advance(&mut b, 20_000.0);
    assert_eq!(a.overview(), b.overview());
    assert_eq!(
        a.query_traces("", "", "", "duration", 0, 50),
        b.query_traces("", "", "", "duration", 0, 50)
    );
    assert_eq!(a.lifecycle(0.0, 200), b.lifecycle(0.0, 200));
}

#[test]
fn different_seeds_change_latencies() {
    let mut a = Engine::new(123);
    let mut b = Engine::new(456);
    advance(&mut a, 1_000.0);
    advance(&mut b, 1_000.0);
    assert_ne!(
        a.trace_detail("trace-00000001"),
        b.trace_detail("trace-00000001")
    );
}

#[test]
fn arbitrary_tick_partition_and_backlog_drain_are_equivalent() {
    for scenario in ["normal", "burst", "slow_database", "error_storm", "pinned"] {
        let mut whole = Engine::new(999);
        let mut pieces = Engine::new(999);
        whole.select_scenario(scenario);
        pieces.select_scenario(scenario);
        advance(&mut whole, 90_000.0);
        for _ in 0..900 {
            advance(&mut pieces, 100.0);
        }
        assert_eq!(whole.overview(), pieces.overview(), "{scenario}");
        assert_eq!(whole.memory_stats(), pieces.memory_stats(), "{scenario}");
        assert_eq!(
            whole.lifecycle(0.0, 200),
            pieces.lifecycle(0.0, 200),
            "{scenario}"
        );
    }
}

#[test]
fn fractional_ticks_match_single_elapsed_interval_without_boundary_drift() {
    for (delta, count, total) in [
        (0.1, 100, 10.0),
        (1000.0 / 60.0, 60, 1000.0),
        (0.003, 1000, 3.0),
        (1000.0 / 60.0, 4800, 80_000.0),
    ] {
        let mut pieces = Engine::new(42);
        let mut whole = Engine::new(42);
        for _ in 0..count {
            advance(&mut pieces, delta);
        }
        advance(&mut whole, total);
        assert_eq!(pieces.overview(), whole.overview(), "{count} x {delta}");
        assert_eq!(
            pieces.memory_stats(),
            whole.memory_stats(),
            "{count} x {delta}"
        );
        assert_eq!(
            pieces.lifecycle(0.0, 200),
            whole.lifecycle(0.0, 200),
            "{count} x {delta}"
        );
    }
}

#[test]
fn fractional_realtime_ticks_at_quarter_speed_match_virtual_steps() {
    let mut pieces = Engine::new(42);
    pieces.set_speed(0.25);
    pieces.play();
    for _ in 0..2400 {
        pieces.tick(1000.0 / 60.0);
    }
    pieces.pause();
    pieces.set_speed(1.0);
    let mut whole = Engine::new(42);
    advance(&mut whole, 10_000.0);
    assert_eq!(pieces.overview(), whole.overview());
    assert_eq!(pieces.memory_stats(), whole.memory_stats());
}

#[test]
fn sub_millisecond_projection_does_not_round_each_tick_or_lose_residue() {
    let mut e = Engine::new(42);
    for _ in 0..3 {
        advance(&mut e, 1.0 / 3.0);
    }
    assert_eq!(e.simulation().now, 1);
    assert_eq!(e.simulation().target, 1.0);
    let mut pieces = Engine::new(42);
    for _ in 0..7 {
        advance(&mut pieces, 0.000_000_4);
    }
    assert_eq!(pieces.simulation().target, 0.000_003);
    let mut whole = Engine::new(42);
    advance(&mut whole, 0.000_002_8);
    assert_eq!(pieces.overview(), whole.overview());
}

#[test]
fn event_budget_limits_one_tick_without_dropping_pending_work() {
    let mut e = Engine::new(42);
    e.step(600_000.0);
    assert_eq!(stats(&e)["processed_events"], 5_000);
    assert!(stats(&e)["due_events"].as_u64().unwrap() > 0);
    assert!(stats(&e)["backlog_ms"].as_f64().unwrap() > 0.0);
    e.drain();
    assert_eq!(stats(&e)["due_events"], 0);
    assert_eq!(stats(&e)["backlog_ms"], 0.0);
    assert_eq!(read(e.overview())["now_ms"], 600_000);
}

#[test]
fn exact_budget_boundary_advances_clock_when_all_due_work_is_done() {
    // Search a narrow timestamp interval containing the first budget boundary.
    for target in 24_900..25_100 {
        let mut e = Engine::new(42);
        e.step(target as f64);
        if e.simulation().processed == 5_000 && e.simulation().is_caught_up() {
            assert_eq!(e.simulation().now, target);
            return;
        }
    }
    panic!("test window must include an exact-budget completion");
}

#[test]
fn pause_prevents_ticks_and_step_ignores_speed() {
    let mut e = Engine::new(7);
    e.tick(1_000.0);
    assert_eq!(stats(&e)["active_traces"], 0);
    e.play();
    e.tick(1_000.0);
    e.pause();
    let before = e.overview();
    e.tick(10_000.0);
    assert_eq!(e.overview(), before);
    e.set_speed(4.0);
    e.step(100.0);
    assert_eq!(read(e.overview())["now_ms"], 1_100);
}

#[test]
fn speed_scales_virtual_time_without_changing_scenario_rules() {
    let mut a = Engine::new(1);
    let mut b = Engine::new(1);
    a.set_speed(4.0);
    a.play();
    a.tick(1_000.0);
    a.pause();
    a.drain();
    advance(&mut b, 4_000.0);
    a.set_speed(1.0);
    assert_eq!(a.overview(), b.overview());
    assert_eq!(a.memory_stats(), b.memory_stats());
    let mut c = Engine::new(1);
    c.set_speed(0.25);
    c.play();
    for _ in 0..400 {
        c.tick(10.0);
    }
    c.pause();
    c.set_speed(1.0);
    let mut d = Engine::new(1);
    advance(&mut d, 1_000.0);
    assert_eq!(c.overview(), d.overview());
}

#[test]
fn reset_preserves_configuration_and_clears_objects_and_history() {
    let mut e = Engine::new(7);
    e.select_scenario("burst");
    e.set_retention(10.0);
    e.set_speed(4.0);
    advance(&mut e, 30_000.0);
    e.reset();
    let o = read(e.overview());
    assert_eq!(o["scenario"], "burst");
    assert_eq!(o["retention_seconds"], 10.0);
    assert_eq!(o["speed"], 4.0);
    assert_eq!(o["now_ms"], 0);
    assert_eq!(o["running"], false);
    assert_eq!(stats(&e)["cumulative_allocations"], 0);
    assert_eq!(stats(&e)["history_len"], 0);
}

#[test]
fn scenario_change_clears_prior_diagnostics_and_pauses() {
    let mut e = Engine::new(7);
    e.play();
    e.tick(1_000.0);
    e.select_scenario("slow_database");
    assert_eq!(read(e.overview())["scenario"], "slow_database");
    assert_eq!(read(e.overview())["running"], false);
    assert_eq!(stats(&e)["lifecycle_len"], 0);
    assert_eq!(stats(&e)["active_spans"], 0);
}

#[test]
fn slow_database_increases_latency_and_active_requests_then_recovers() {
    let mut normal = Engine::new(7);
    let mut slow = Engine::new(7);
    slow.select_scenario("slow_database");
    advance(&mut normal, 20_000.0);
    advance(&mut slow, 20_000.0);
    let n = read(normal.overview());
    let s = read(slow.overview());
    assert!(s["p95_ms"].as_u64().unwrap() > 2_000);
    assert!(s["active_requests"].as_u64().unwrap() > n["active_requests"].as_u64().unwrap() * 5);
    advance(&mut slow, 30_000.0);
    assert!(read(slow.overview())["p95_ms"].as_u64().unwrap() < 300);
    slow.simulation().store.check_integrity().unwrap();
}

#[test]
fn burst_increases_arrivals_tenfold_then_releases_and_reuses_capacity() {
    let mut e = Engine::new(7);
    e.select_scenario("burst");
    advance(&mut e, 15_000.0);
    let before = e.simulation().store.arena.allocations;
    advance(&mut e, 10_000.0);
    let during = e.simulation().store.arena.allocations - before;
    assert!((9_990..=10_010).contains(&during));
    advance(&mut e, 50_000.0);
    let peak = e.simulation().store.arena.slots.len();
    advance(&mut e, 40_000.0);
    let reused = e.simulation().store.arena.reused;
    assert!(e.simulation().store.arena.occupied < 6_100);
    assert!(e.simulation().store.arena.free_len() > 8_000);
    advance(&mut e, 60_000.0);
    assert_eq!(e.simulation().store.arena.slots.len(), peak);
    assert!(e.simulation().store.arena.reused > reused);
    e.simulation().store.check_integrity().unwrap();
}

#[test]
fn error_storm_has_errors_early_failures_and_finite_timeouts() {
    let mut e = Engine::new(7);
    e.select_scenario("error_storm");
    advance(&mut e, 24_000.0);
    assert!(read(e.overview())["error_rate"].as_f64().unwrap() > 40.0);
    let traces = &e.simulation().store.traces;
    assert!(traces
        .values()
        .any(|t| t.status == Status::Timeout && t.end_ms.unwrap() - t.start_ms == 8_000));
    assert!(traces
        .values()
        .any(|t| t.status == Status::Error && t.end_ms.unwrap() - t.start_ms < 100));
    advance(&mut e, 25_000.0);
    assert!(read(e.overview())["error_rate"].as_f64().unwrap() < 8.0);
    for t in e
        .simulation()
        .store
        .traces
        .values()
        .filter(|t| t.start_ms < 25_000)
    {
        assert!(t.end_ms.is_some());
    }
    e.simulation().store.check_integrity().unwrap();
}

#[test]
fn all_scenarios_preserve_exact_parent_child_time_intervals() {
    for scenario in ["normal", "burst", "slow_database", "error_storm", "pinned"] {
        let mut e = Engine::new(999);
        e.select_scenario(scenario);
        advance(&mut e, 40_000.0);
        e.simulation().store.check_integrity().unwrap();
        for t in e.simulation().store.traces.values() {
            for &h in t.spans.iter().flatten() {
                let child = e.simulation().store.arena.get(h).unwrap();
                if let Some(p) = child.parent {
                    let parent = e.simulation().store.arena.get(p).unwrap();
                    assert!(parent.start_ms <= child.start_ms);
                    if let Some(end) = parent.end_ms {
                        assert!(child.end_ms.unwrap() <= end);
                    }
                }
            }
        }
    }
}

#[test]
fn normal_600_seconds_stabilizes_live_slots_and_cleans_indexes() {
    let mut e = Engine::new(42);
    let mut capacities = vec![];
    let mut counts = vec![];
    for second in 1..=600 {
        advance(&mut e, 1_000.0);
        if second >= 120 {
            counts.push(e.simulation().store.arena.occupied);
            capacities.push(e.simulation().store.arena.slots.len());
        }
        e.simulation().store.check_integrity().unwrap();
    }
    assert!(*counts.iter().min().unwrap() >= 5_990);
    assert!(*counts.iter().max().unwrap() <= 6_100);
    assert!(capacities.last().unwrap() - capacities[0] <= 20);
    assert!(e.simulation().store.arena.reused > 50_000);
    assert_eq!(stats(&e)["history_len"], 120);
    assert_eq!(stats(&e)["lifecycle_len"], LIFECYCLE_CAPACITY);
    assert!(stats(&e)["rolling_arrivals"].as_u64().unwrap() <= 201);
    assert!(stats(&e)["rolling_completions"].as_u64().unwrap() <= 220);
}

#[test]
fn diagnostics_disabled_skips_records_but_keeps_real_memory_counters() {
    let mut e = Engine::new(42);
    e.set_diagnostics(false);
    advance(&mut e, 70_000.0);
    assert_eq!(stats(&e)["lifecycle_len"], 0);
    assert!(stats(&e)["reused_slots"].as_u64().unwrap() > 0);
    e.set_diagnostics(true);
    advance(&mut e, 1_000.0);
    assert!(stats(&e)["lifecycle_len"].as_u64().unwrap() > 0);
}

#[test]
fn lifecycle_cursor_and_capacity_are_bounded() {
    let mut e = Engine::new(42);
    advance(&mut e, 30_000.0);
    let first = read(e.lifecycle(0.0, 10));
    assert_eq!(first["events"].as_array().unwrap().len(), 10);
    assert!(first["dropped"].as_u64().unwrap() > 0);
    let cursor = first["next_cursor"].as_f64().unwrap();
    assert!(read(e.lifecycle(cursor, 200))["events"]
        .as_array()
        .unwrap()
        .is_empty());
    advance(&mut e, 100.0);
    assert!(!read(e.lifecycle(cursor, 200))["events"]
        .as_array()
        .unwrap()
        .is_empty());
    assert_eq!(
        read(e.lifecycle(1.0, 9999))["events"]
            .as_array()
            .unwrap()
            .len(),
        200
    );
}

#[test]
fn safe_stale_probe_reuses_shared_arena_without_changing_product_objects() {
    let mut e = Engine::new(42);
    advance(&mut e, 1_000.0);
    let before = e.query_traces("", "", "", "newest", 0, 50);
    let occupied = e.simulation().store.arena.occupied;
    let probe = read(e.test_stale_handle());
    assert_eq!(probe["valid"], false);
    assert_eq!(probe["handle"]["index"], probe["reused_handle"]["index"]);
    assert_ne!(
        probe["handle"]["generation"],
        probe["reused_handle"]["generation"]
    );
    assert_eq!(e.query_traces("", "", "", "newest", 0, 50), before);
    assert_eq!(e.simulation().store.arena.occupied, occupied);
    e.simulation().store.check_integrity().unwrap();
}

#[test]
fn bounded_query_search_service_error_filter_and_duration_sort() {
    let mut e = Engine::new(42);
    e.select_scenario("error_storm");
    advance(&mut e, 24_000.0);
    let query = read(e.query_traces("SELECT", "database", "error", "duration", 0, 1000));
    let items = query["items"].as_array().unwrap();
    assert_eq!(items.len(), 50);
    assert!(items
        .windows(2)
        .all(|p| p[0]["duration_ms"].as_u64() >= p[1]["duration_ms"].as_u64()));
    assert!(items
        .iter()
        .all(|t| [json!("error"), json!("timeout")].contains(&t["status"])));
    assert_eq!(
        read(e.query_traces("", "unknown", "", "", 0, 50))["total"],
        0
    );
    assert!(read(e.query_traces("", "", "", "", u32::MAX, 50))["items"]
        .as_array()
        .unwrap()
        .is_empty());
}

#[test]
fn arena_snapshot_is_bounded_and_invalid_inspection_records_rejection() {
    let mut e = Engine::new(42);
    advance(&mut e, 10_000.0);
    assert_eq!(
        read(e.arena_snapshot(0, 100_000))["slots"]
            .as_array()
            .unwrap()
            .len(),
        512
    );
    let h = e.simulation().store.traces[&1].spans[0].unwrap();
    assert_eq!(read(e.inspect_handle(h.index, h.generation))["valid"], true);
    assert_eq!(read(e.inspect_handle(u32::MAX, 1))["valid"], false);
    assert_eq!(
        read(e.lifecycle(0.0, 1))["events"][0]["kind"],
        "Invalid Handle Access"
    );
}

#[test]
fn retention_change_reevaluates_existing_completed_traces() {
    let mut e = Engine::new(42);
    advance(&mut e, 30_000.0);
    assert!(e.simulation().store.traces.contains_key(&1));
    e.set_retention(5.0);
    e.drain();
    assert!(!e.simulation().store.traces.contains_key(&1));
    assert!(e.simulation().store.traces.len() <= 110);
    assert_eq!(e.simulation().now, 30_000);
    e.simulation().store.check_integrity().unwrap();
}

#[test]
fn retention_edits_while_paused_do_not_start_requests_or_consume_clock_debt() {
    let mut e = Engine::new(42);
    e.set_retention(5.0);
    assert_eq!(e.simulation().store.arena.allocations, 0);
    e.step(600_000.0);
    let before_time = e.simulation().now;
    let before_allocations = e.simulation().store.arena.allocations;
    let before_completed = e.simulation().store.completed_requests;
    e.set_retention(10.0);
    assert_eq!(e.simulation().now, before_time);
    assert_eq!(e.simulation().store.arena.allocations, before_allocations);
    assert_eq!(e.simulation().store.completed_requests, before_completed);
    assert!(!e.simulation().running);
    assert!(e.simulation().due_events() > 0);
}

#[test]
fn invalid_inputs_cannot_corrupt_clock_configuration_or_store() {
    let mut e = Engine::new(42);
    e.set_speed(f64::NAN);
    e.set_speed(-1.0);
    e.set_retention(f64::INFINITY);
    e.step(f64::NAN);
    e.step(-10.0);
    e.step(f64::INFINITY);
    assert_eq!(e.simulation().now, 0);
    assert_eq!(e.simulation().speed, 1.0);
    e.set_retention(-50.0);
    assert_eq!(e.simulation().retention_ms, 5_000);
    e.set_retention(1_000_000.0);
    assert_eq!(e.simulation().retention_ms, 120_000);
    assert!(!e.pin_trace("invalid", true));
    assert_eq!(read(e.trace_detail("invalid")), Value::Null);
    assert!(e
        .simulation()
        .store
        .arena
        .get(Handle {
            index: 0,
            generation: 0
        })
        .is_none());
    e.simulation().store.check_integrity().unwrap();
}

#[test]
fn native_stress_override_is_bounded_and_supports_multiple_arrivals_per_ms() {
    let mut e = Engine::with_span_rate(42, 10_000);
    advance(&mut e, 1_000.0);
    let first = e.simulation().store.arena.allocations;
    // Children start up to 30 ms after arrival; measure a full warmed-up interval.
    advance(&mut e, 1_000.0);
    assert_eq!(e.simulation().store.arena.allocations - first, 10_000);
    assert_eq!(
        Engine::with_span_rate(42, 0).simulation().rate_override,
        Some(100)
    );
    assert_eq!(
        Engine::with_span_rate(42, u32::MAX)
            .simulation()
            .rate_override,
        Some(10_000)
    );
    e.simulation().store.check_integrity().unwrap();
}
