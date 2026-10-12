import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import init, { Engine } from '../web/pkg/tracescope_engine.js';

const wasm = await init({module_or_path: await readFile(new URL('../web/pkg/tracescope_engine_bg.wasm', import.meta.url))});
const stats = e => JSON.parse(e.memory_stats());
function advance(e, ms) {
  e.step(ms);
  let drains = 0;
  while (stats(e).due_events > 0) {
    e.step(0);
    assert.ok(++drains < 10000, 'backlog must make progress');
  }
}

test('compiled WASM preserves deterministic results across tick partitions', () => {
  const a = new Engine(42), b = new Engine(42);
  try {
    a.select_scenario('burst'); b.select_scenario('burst');
    advance(a, 90_000);
    for (let i = 0; i < 900; i++) advance(b, 100);
    assert.deepEqual(JSON.parse(a.overview()), JSON.parse(b.overview()));
    assert.deepEqual(stats(a), stats(b));
    assert.deepEqual(JSON.parse(a.query_traces('', '', '', 'newest', 0, 50)), JSON.parse(b.query_traces('', '', '', 'newest', 0, 50)));
  } finally {a.free(); b.free();}
});

test('fractional animation-frame ticks and quarter speed preserve exact event boundaries', () => {
  for (const [delta, count, speed] of [[0.1,100,1], [1000/60,60,1], [1000/60,240,0.25]]) {
    const a = new Engine(42), b = new Engine(42);
    try {
      a.set_speed(speed); b.set_speed(speed); a.play(); b.play();
      for(let i=0;i<count;i++) a.tick(delta);
      b.tick(delta * count);
      assert.deepEqual(JSON.parse(a.overview()), JSON.parse(b.overview()), `${delta} × ${count} at ${speed}`);
      assert.deepEqual(stats(a), stats(b));
    } finally {a.free();b.free();}
  }
});

test('ten virtual minutes have bounded live objects, indices and diagnostic buffers', () => {
  const e = new Engine(42);
  try {
    const checkpoints = [];
    for (let second = 1; second <= 600; second++) {
      advance(e, 1000);
      const s = stats(e);
      assert.equal(s.occupied_slots, s.active_spans);
      assert.equal(s.trace_index_entries, s.active_traces);
      assert.equal(s.service_index_entries, s.active_spans);
      assert.equal(s.retention_index_entries, s.retained_traces);
      assert.equal(s.occupied_slots + s.free_slots + s.retired_slots, s.arena_capacity);
      assert.ok(s.lifecycle_len <= s.lifecycle_capacity);
      assert.ok(s.history_len <= 120);
      if (second >= 180) checkpoints.push(s);
    }
    const live = checkpoints.map(s => s.active_spans);
    assert.ok(Math.max(...live) < 6300 && Math.min(...live) > 5900);
    assert.ok(Math.max(...checkpoints.map(s => s.arena_capacity)) - checkpoints[0].arena_capacity < 25);
    assert.ok(stats(e).reused_slots > 50_000);
    assert.ok(wasm.memory.buffer.byteLength > 0);
  } finally {e.free();}
});

test('pin retains an expired trace, unpin releases its real slots', () => {
  const e = new Engine(42);
  try {
    advance(e, 1000);
    const trace = JSON.parse(e.query_traces('', '', 'completed', 'newest', 0, 1)).items[0];
    assert.ok(trace);
    const detail = JSON.parse(e.trace_detail(trace.id));
    assert.equal(e.pin_trace(trace.id, true), true);
    advance(e, 70_000);
    assert.ok(JSON.parse(e.trace_detail(trace.id)));
    assert.equal(e.pin_trace(trace.id, false), true);
    advance(e, 0);
    assert.equal(JSON.parse(e.trace_detail(trace.id)), null);
    for (const span of detail.spans) {
      const result = JSON.parse(e.inspect_handle(span.handle.index, span.handle.generation));
      assert.equal(result.valid, false);
    }
  } finally {e.free();}
});

test('safe stale probe rejects old generation without changing existing traces', () => {
  const e = new Engine(42);
  try {
    advance(e, 1000);
    const before = JSON.parse(e.query_traces('', '', '', 'newest', 0, 50));
    const probe = JSON.parse(e.test_stale_handle());
    assert.equal(probe.valid, false);
    assert.equal(probe.handle.index, probe.reused_handle.index);
    assert.ok(probe.reused_handle.generation > probe.handle.generation);
    assert.deepEqual(JSON.parse(e.query_traces('', '', '', 'newest', 0, 50)), before);
    assert.ok(JSON.parse(e.lifecycle(0, 200)).events.some(e => e.kind === 'Invalid Handle Access'));
  } finally {e.free();}
});

test('memory growth invalidates old buffer while next snapshots remain readable', () => {
  const e = new Engine(42);
  try {
    advance(e, 1000);
    const old = wasm.memory.buffer;
    const previousBytes = old.byteLength;
    wasm.memory.grow(1);
    assert.equal(old.byteLength, 0);
    assert.equal(wasm.memory.buffer.byteLength, previousBytes + 65536);
    advance(e, 1000);
    assert.ok(JSON.parse(e.overview()).completed_requests > 0);
    assert.ok(stats(e).active_spans > 0);
  } finally {e.free();}
});
