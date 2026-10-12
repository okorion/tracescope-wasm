import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

async function ready(page: Page) {
  await page.goto('./');
  await expect(page.getByTestId('play-pause')).toBeVisible();
  await page.getByTestId('reset').click();
  await expect(page.getByTestId('virtual-clock')).toHaveText('00:00.000');
}
async function step(page: Page, seconds: number) {
  for (let i = 0; i < seconds; i++) await page.getByTestId('step-forward').click();
}
async function capture(page: Page, name: string, fullPage = true) {
  if (!process.env.CAPTURE_SCREENSHOTS) return;
  await mkdir('docs/screenshots', {recursive: true});
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({path: `docs/screenshots/${name}.png`, fullPage, animations:'disabled'});
}

test('WASM initializes, overview updates, pause/step/reset and speed controls work', async ({page}) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await ready(page);
  await expect(page.getByText('Simulated Live', {exact:true})).toBeVisible();
  await step(page, 12);
  await expect(page.getByTestId('virtual-clock')).toHaveText('00:12.000');
  await expect(page.getByTestId('trace-row')).toHaveCount(6);
  await expect(page.locator('.primary-metrics')).toContainText('20');
  await capture(page, 'overview');
  await page.getByLabel('실행 속도', {exact:true}).selectOption('4');
  await page.getByTestId('play-pause').click();
  await expect.poll(async () => page.getByTestId('virtual-clock').textContent()).not.toBe('00:12.000');
  await page.getByTestId('play-pause').click();
  const paused = await page.getByTestId('virtual-clock').textContent();
  await page.waitForTimeout(400);
  await expect(page.getByTestId('virtual-clock')).toHaveText(paused!);
  await page.getByTestId('reset').click();
  await expect(page.getByTestId('trace-row')).toHaveCount(0);
  await expect(page.getByTestId('virtual-clock')).toHaveText('00:00.000');
  expect(errors).toEqual([]);
});

test('search, service/error filters, sorting, pagination and real waterfall', async ({page}) => {
  await ready(page); await step(page, 5);
  await page.getByTestId('nav-explorer').click();
  await page.getByLabel('상태 필터').selectOption('completed');
  await page.getByLabel('서비스 필터').selectOption('database');
  await page.getByLabel('정렬', {exact:true}).selectOption('duration');
  await expect(page.getByTestId('trace-row')).toHaveCount(25);
  const durations = await page.locator('.request-table tbody tr td:nth-child(4)').allTextContents();
  const milliseconds = durations.map(v => Number.parseFloat(v));
  expect(milliseconds).toEqual([...milliseconds].sort((a,b)=>b-a));
  const first = page.getByTestId('trace-row').first();
  const id = await first.locator('.mono').textContent();
  await first.click();
  await page.getByTestId('trace-search').fill(id!);
  await expect(page.getByTestId('trace-row')).toHaveCount(1);
  await expect(page.getByTestId('span-row')).toHaveCount(5);
  const bars = await page.locator('.waterfall-bar').evaluateAll(elements => elements.map(element => ({left: parseFloat((element as HTMLElement).style.left), width: parseFloat((element as HTMLElement).style.width)})));
  expect(bars[0]).toEqual({left:0, width:100});
  expect(bars.every(b => b.left >= 0 && b.width >= 0 && b.left + b.width <= 100.00001)).toBeTruthy();
  await page.getByTestId('span-row').nth(3).click();
  await expect(page.getByTestId('span-detail')).toContainText('SELECT');
  await capture(page, 'explorer');
  await page.getByTestId('trace-search').fill('does-not-exist');
  await expect(page.getByTestId('trace-row')).toHaveCount(0);
  await page.getByTestId('trace-search').fill('');
  await page.getByRole('button', {name:'다음', exact:true}).click();
  await expect(page.locator('.pagination')).toContainText('2 /');
  await page.getByLabel('상태 필터').selectOption('error');
  await expect(page.locator('.request-table tbody')).not.toContainText('진행 중');
});

test('pin survives retention, unpin expires, selected span keeps same arena handle', async ({page}) => {
  await ready(page); await step(page, 2);
  await page.getByTestId('nav-explorer').click();
  await page.getByLabel('상태 필터').selectOption('completed');
  await page.getByTestId('trace-row').first().click();
  await page.getByTestId('pin-trace').click();
  await expect(page.getByTestId('pin-trace')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('span-row').nth(3).click();
  const handle = await page.getByTestId('span-detail').locator('.detail-facts div').filter({has:page.locator('dt', {hasText:/^Handle$/})}).locator('dd').textContent();
  await page.getByTestId('inspect-span').click();
  await expect(page.getByTestId('slot-inspector')).toContainText(handle!);
  await expect(page.getByTestId('slot-inspector')).toContainText('유효한 Handle');
  const before = await page.getByTestId('virtual-clock').textContent();
  await page.getByTestId('dev-memory').click();
  await page.getByLabel('보존 기간', {exact:true}).selectOption('5');
  await expect(page.getByTestId('virtual-clock')).toHaveText(before!);
  await step(page, 7);
  await page.getByTestId('dev-arena').click();
  await expect(page.getByTestId('slot-inspector')).toContainText('유효한 Handle');
  await capture(page, 'arena');
  await page.getByTestId('nav-explorer').click();
  await expect(page.getByTestId('pin-trace')).toHaveText('Unpin');
  await page.getByTestId('pin-trace').click();
  await step(page, 1);
  await expect(page.getByText('이 Trace의 보존 기간이 끝났습니다')).toBeVisible();
  await page.getByTestId('nav-developer').click();
  await expect(page.getByTestId('slot-inspector')).toContainText('무효화된 Handle');
  await expect(page.getByTestId('slot-inspector')).not.toContainText('Span ID');
});

test('memory diagnostics, real lifecycle, stale probe and bounded slot canvas', async ({page}) => {
  await ready(page); await step(page, 80);
  await page.getByTestId('nav-developer').click();
  await expect(page.getByText('WASM linear memory', {exact:true}).first()).toBeVisible();
  await expect(page.locator('.memory-headline')).toContainText(/MiB|KiB/);
  await capture(page, 'memory');
  await page.getByTestId('diagnostics-toggle').uncheck();
  await page.getByTestId('dev-lifecycle').click();
  const count = await page.locator('.lifecycle-table tbody tr').count();
  await step(page, 1);
  expect(await page.locator('.lifecycle-table tbody tr').count()).toBe(count);
  await page.getByTestId('dev-memory').click();
  await page.getByTestId('diagnostics-toggle').check();
  await page.getByTestId('dev-lifecycle').click();
  await page.getByTestId('stale-probe').click();
  await expect(page.locator('.lifecycle-table')).toContainText('Invalid Handle Access');
  await expect(page.locator('.lifecycle-table')).toContainText('Slot Reused');
  await capture(page, 'lifecycle');
  await page.getByTestId('dev-arena').click();
  await expect(page.getByTestId('arena-canvas')).toBeVisible();
  await page.getByLabel('슬롯 번호로 선택', {exact:true}).fill('0');
  await page.getByRole('button', {name:'조회', exact:true}).click();
  await expect(page.getByTestId('slot-inspector')).toContainText('Generation');
  expect(await page.locator('canvas').count()).toBe(1);
});

test('all five scenarios reset explicitly and produce traffic', async ({page}) => {
  await ready(page);
  for (const scenario of ['burst','slow_database','error_storm','pinned','normal']) {
    await page.getByTestId('scenario-select').selectOption(scenario);
    await expect(page.getByTestId('virtual-clock')).toHaveText('00:00.000');
    await expect(page.getByTestId('play-pause')).toHaveText('Play');
    await step(page, 2);
    await expect(page.getByTestId('trace-row')).toHaveCount(6);
  }
});

test('burst expands the arena and reuses released slots after retention', async ({page}) => {
  await ready(page);
  await page.getByTestId('scenario-select').selectOption('burst');
  await step(page,25);
  await capture(page,'burst');
  await step(page,45);
  await page.getByTestId('nav-developer').click();
  const count = async (label:string) => Number((await page.locator('.counter').filter({has:page.locator('span', {hasText:new RegExp(`^${label}$`)})}).locator('strong').textContent())?.replaceAll(',',''));
  const expanded = await count('Arena Capacity');
  expect(expanded).toBeGreaterThan(14000);
  await step(page,30);
  expect(await count('Arena Capacity')).toBe(expanded);
  expect(await count('Active Span Count')).toBeLessThan(6500);
  expect(await count('Free Slots')).toBeGreaterThan(8000);
  expect(await count('Reused Slot Count')).toBeGreaterThan(3000);
  await capture(page,'burst-recovery');
});

test('background policy pauses without hidden-time accumulation', async ({page}) => {
  await ready(page);
  await page.getByTestId('play-pause').click();
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', {configurable:true, value:true});
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.getByTestId('play-pause')).toHaveText('Play');
  const now = await page.getByTestId('virtual-clock').textContent();
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', {configurable:true, value:false});
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.getByTestId('virtual-clock')).toHaveText(now!);
  await expect(page.getByText('페이지가 숨겨져', {exact:false})).toBeVisible();
});

test('mobile layout keeps navigation and controls reachable without page overflow', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await ready(page); await step(page, 2);
  await expect(page.getByTestId('nav-developer')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  await capture(page, 'mobile');
  await page.getByTestId('nav-developer').click();
  await page.getByTestId('dev-arena').click();
  await expect(page.getByTestId('arena-canvas')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
});

test('WASM load failure shows actionable error instead of perpetual loading', async ({page}) => {
  await page.route('**/*.wasm', route => route.abort('failed'));
  await page.goto('./');
  await expect(page.getByRole('alert')).toContainText('엔진을 시작할 수 없습니다');
  await expect(page.getByRole('button', {name:'다시 불러오기'})).toBeVisible();
});
