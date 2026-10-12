import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';

const url = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:4179/tracescope-wasm/';
const browser = await chromium.launch();
try {
  const page = await browser.newPage({viewport:{width:1440,height:1000}});
  await page.addInitScript(() => {
    window.__measurement = {active:false, frames:[], longTasks:[], last:0};
    const sample = time => {
      const m = window.__measurement;
      if (m.active) {if(m.last) m.frames.push(time-m.last); m.last=time;}
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
      new PerformanceObserver(list => {
        if(window.__measurement.active) window.__measurement.longTasks.push(...list.getEntries().map(e=>e.duration));
      }).observe({type:'longtask', buffered:false});
    }
  });
  await page.goto(url);
  await page.getByTestId('play-pause').waitFor();
  const results = [];
  for(const scenario of ['normal','burst']) {
    await page.getByTestId('scenario-select').selectOption(scenario);
    await page.getByTestId('reset').click();
    if (scenario === 'burst') for(let i=0;i<15;i++) await page.getByTestId('step-forward').click();
    const virtual_start = await page.getByTestId('virtual-clock').textContent();
    await page.evaluate(() => {window.__measurement={active:true,frames:[],longTasks:[],last:0};});
    await page.getByTestId('play-pause').click();
    await page.waitForTimeout(10_000);
    await page.getByTestId('play-pause').click();
    const measurement = await page.evaluate(() => {window.__measurement.active=false;return window.__measurement;});
    const values = measurement.frames.sort((a,b)=>a-b);
    const p = q => values[Math.ceil(values.length*q)-1] ?? null;
    results.push({scenario,virtual_start,virtual_end:await page.getByTestId('virtual-clock').textContent(),
      observed_frames:values.length,frame_interval_p50_ms:p(.5),frame_interval_p95_ms:p(.95),frame_interval_p99_ms:p(.99),
      frame_interval_max_ms:values.at(-1),long_tasks_over_50ms:measurement.longTasks.length,
      longest_task_ms:Math.max(0,...measurement.longTasks)});
  }
  const report={measured_at:new Date().toISOString(),browser:browser.version(),runtime:process.version,
    platform:`${process.platform} ${os.release()}`,viewport:'1440×1000',
    method:'Headless Chromium, production build, Live Overview, 실제 wall time 각10초, 속도1×, Seed42, 상세진단ON. Burst는 버튼으로 가상15초까지 진행 후 측정. RAF 간격과 PerformanceObserver longtask, CPU/GPU throttling 없음. 프레임 간격은 호스트 부하와 브라우저 스케줄링을 포함.',results};
  await mkdir('docs/results',{recursive:true});
  await writeFile('docs/results/browser-benchmark.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
} finally {await browser.close();}
