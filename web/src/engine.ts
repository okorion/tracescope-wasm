import { useEffect, useSyncExternalStore } from 'react';
import init, { Engine } from '../pkg/tracescope_engine';
import type { ArenaPage, Handle, Inspection, LifecyclePage, MemoryStats, Overview, ProbeResult, TraceDetail, TraceQuery, MemoryPoint } from './types';

type State = {
  ready: boolean; error: string | null; overview: Overview | null; memory: MemoryStats | null;
  wasmBytes: number | null; memoryHistory: MemoryPoint[]; revision: number; notice: string | null;
};
const initial: State = { ready: false, error: null, overview: null, memory: null, wasmBytes: null, memoryHistory: [], revision: 0, notice: null };
let state = initial;
let engine: Engine | null = null;
let memory: WebAssembly.Memory | null = null;
let startup: Promise<void> | null = null;
const listeners = new Set<() => void>();
let lastFrame: number | null = null;
let lastPublish = 0;
let animationId = 0;
const parse = <T,>(value: string): T => JSON.parse(value) as T;

function emit(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach(listener => listener());
}

function publish() {
  if (!engine) return;
  // Read the current buffer each time: memory.grow can detach a previously cached buffer.
  const overview = parse<Overview>(engine.overview());
  const stats = parse<MemoryStats>(engine.memory_stats());
  const bytes = memory?.buffer.byteLength ?? null;
  let history = state.memoryHistory;
  if (bytes !== null && (!history.length || overview.now_ms - history[history.length - 1].time_ms >= 1000)) {
    history = [...history, {time_ms: overview.now_ms, bytes}].slice(-120);
  }
  emit({ready: true, overview, memory: stats, wasmBytes: bytes, memoryHistory: history, revision: state.revision + 1});
}

function fail(error: unknown) {
  try { engine?.pause(); } catch { /* A trapped WASM instance may be unusable. */ }
  cancelAnimationFrame(animationId);
  emit({error: error instanceof Error ? error.message : String(error)});
}

function frame(now: number) {
  try {
    if (engine && !document.hidden) {
      const elapsed = lastFrame === null ? 0 : now - lastFrame;
      // Visible-frame elapsed time is passed in full. Rust bounds work and exposes any debt.
      engine.tick(elapsed);
      if (now - lastPublish >= 250) { publish(); lastPublish = now; }
    }
    lastFrame = now;
    animationId = requestAnimationFrame(frame);
  } catch (error) { fail(error); }
}

function visibility() {
  lastFrame = null;
  if (document.hidden && engine) {
    engine.pause();
    emit({notice: '페이지가 숨겨져 시뮬레이션을 일시정지했습니다. Play로 다시 시작하세요.'});
    publish();
  }
}

async function start() {
  try {
    const wasm = await init();
    memory = wasm.memory instanceof WebAssembly.Memory ? wasm.memory : null;
    engine = new Engine(42);
    if (!document.hidden) engine.play();
    publish();
    document.addEventListener('visibilitychange', visibility);
    animationId = requestAnimationFrame(frame);
  } catch (error) { fail(error); }
}

function action(fn: (engine: Engine) => void) {
  if (!engine || state.error) return;
  try { fn(engine); publish(); } catch (error) { fail(error); }
}

const controls = {
  play: () => { lastFrame = null; emit({notice: null}); action(e => e.play()); },
  pause: () => action(e => e.pause()),
  reset: () => { lastFrame = null; emit({memoryHistory: [], notice: null}); action(e => e.reset()); },
  scenario: (id: string) => {
    lastFrame = null; emit({memoryHistory: [], notice: '시나리오를 변경해 데이터와 진단 이력을 초기화했습니다.'});
    action(e => e.select_scenario(id));
  },
  speed: (value: number) => action(e => e.set_speed(value)),
  retention: (seconds: number) => action(e => e.set_retention(seconds)),
  step: (ms = 1000) => action(e => { e.pause(); e.step(ms); }),
  diagnostics: (enabled: boolean) => action(e => e.set_diagnostics(enabled)),
  query: (search = '', service = '', status = '', sort = 'newest', page = 0): TraceQuery =>
    engine ? parse(engine.query_traces(search.slice(0, 128), service, status, sort, page, 25)) : {items: [], total: 0, page, page_size: 25},
  detail: (id: string): TraceDetail | null => engine ? parse(engine.trace_detail(id)) : null,
  pin: (id: string, value: boolean) => {
    let success = false;
    action(e => { success = e.pin_trace(id, value); });
    if (!success) emit({notice: 'Trace가 만료되었거나 Pin 상한(128개)에 도달했습니다.'});
    return success;
  },
  lifecycle: (cursor = 0, limit = 100): LifecyclePage => engine ? parse(engine.lifecycle(cursor, limit)) : {events: [], next_cursor: 0, oldest_cursor: 0, dropped: 0},
  arena: (start = 0, limit = 512): ArenaPage => engine ? parse(engine.arena_snapshot(start, limit)) : {slots: [], total: 0, start},
  inspect: (handle: Handle): Inspection => engine ? parse(engine.inspect_handle(handle.index, handle.generation)) : {valid: false, handle, slot: null, reason: '엔진 초기화 중'},
  probe: (): ProbeResult => {
    let result: ProbeResult = {valid: false, handle: {index: 0, generation: 0}, reused_handle: {index: 0, generation: 0}, message: '엔진 초기화 중'};
    action(e => { result = parse(e.test_stale_handle()); });
    return result;
  },
};

export function useEngine() {
  const current = useSyncExternalStore(listener => {listeners.add(listener); return () => {listeners.delete(listener);};}, () => state);
  useEffect(() => { startup ??= start(); }, []);
  return { state: current, ...controls };
}

if (import.meta.hot) import.meta.hot.dispose(() => {
  cancelAnimationFrame(animationId);
  document.removeEventListener('visibilitychange', visibility);
  engine?.free();
});
