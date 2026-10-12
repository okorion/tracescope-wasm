import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const scenario = process.argv[2];
if (!scenario) {
  const results = [];
  for (const name of ['normal', 'burst']) {
    const run = spawnSync(process.execPath, [fileURLToPath(import.meta.url), name], {encoding: 'utf8'});
    if (run.status !== 0) throw new Error(run.stderr || run.stdout);
    results.push(JSON.parse(run.stdout));
  }
  const report = {
    measured_at: new Date().toISOString(),
    environment: {runtime: process.version, platform: `${process.platform} ${os.release()} ${process.arch}`, cpu: os.cpus()[0]?.model},
    method: '실제 release WASM, 각 시나리오는 독립 Node 프로세스. Seed42, Retention60초, 상세 진단 켜짐. 100ms 가상 Step과 backlog drain. Tick 시간은 JS→WASM 호출, Query는 최대25건 직렬화+JSON 파싱 포함. 브라우저 UI 프레임은 별도 E2E/브라우저 측정.',
    results,
  };
  await mkdir('docs/results', {recursive:true});
  await writeFile('docs/results/wasm-benchmark.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({path:'docs/results/wasm-benchmark.json', environment:report.environment,
    results:results.map(({scenario,virtual_seconds,wall_ms,tick_p95_ms,tick_max_ms,query_p95_ms,final}) => ({scenario,virtual_seconds,wall_ms,tick_p95_ms,tick_max_ms,query_p95_ms,final}))}, null, 2));
} else {
  const {default: init, Engine} = await import('../web/pkg/tracescope_engine.js');
  const wasm = await init({module_or_path: await readFile(new URL('../web/pkg/tracescope_engine_bg.wasm', import.meta.url))});
  const e = new Engine(42);
  e.select_scenario(scenario);
  const seconds = scenario === 'normal' ? 600 : 180;
  const ticks = [], queries = [], checkpoints = [];
  const start = performance.now();
  for (let i = 1; i <= seconds * 10; i++) {
    let begin = performance.now(); e.step(100); ticks.push(performance.now() - begin);
    while (JSON.parse(e.memory_stats()).due_events > 0) {
      begin = performance.now(); e.step(0); ticks.push(performance.now() - begin);
    }
    if (i % 10 === 0) {
      begin = performance.now(); JSON.parse(e.query_traces('', '', '', 'newest', 0, 25)); queries.push(performance.now() - begin);
    }
    if (i % 100 === 0 || i === 150 || i === 250) {
      const stats = JSON.parse(e.memory_stats());
      const overview = JSON.parse(e.overview());
      checkpoints.push({virtual_seconds:i / 10, live_spans:stats.active_spans, active_traces:stats.active_traces,
        arena_capacity:stats.arena_capacity, free_slots:stats.free_slots, reused_slots:stats.reused_slots,
        linear_memory_bytes:wasm.memory.buffer.byteLength, trace_index_entries:stats.trace_index_entries,
        service_index_entries:stats.service_index_entries, lifecycle_len:stats.lifecycle_len,
        history_len:stats.history_len, rps:overview.rps});
    }
  }
  const elapsed = performance.now() - start;
  const s = JSON.parse(e.memory_stats());
  const quantile = (values, p) => [...values].sort((a,b)=>a-b)[Math.ceil(values.length*p)-1];
  console.log(JSON.stringify({scenario,virtual_seconds:seconds,wall_ms:elapsed,processed_events:s.processed_events,
    events_per_wall_second:s.processed_events / (elapsed / 1000),
    tick_p50_ms:quantile(ticks,.5),tick_p95_ms:quantile(ticks,.95),tick_max_ms:Math.max(...ticks),
    query_p50_ms:quantile(queries,.5),query_p95_ms:quantile(queries,.95),query_max_ms:Math.max(...queries),
    final:s, checkpoints}));
  e.free();
}
