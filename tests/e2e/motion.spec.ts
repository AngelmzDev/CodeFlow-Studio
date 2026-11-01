import { expect, test } from '@playwright/test';
import type { Trace } from '../../src/core/types.ts';

test('motion guide follows a real Python trace without replacing the diagram', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('#source-editor')).toBeEnabled();
  await page
    .locator('#source-editor')
    .fill('total = 0\ntotal += 2\nprint(total)\n');
  await page.locator('#diagram-generate').click();
  await expect(page.locator('#diagram-stage svg')).toBeVisible();
  await expect(page.locator('#diagram-follow')).toBeChecked();

  const svg = await page.locator('#diagram-stage svg').elementHandle();
  expect(svg).not.toBeNull();
  const branchPaths = await page
    .locator('#diagram-stage svg > g > path')
    .evaluateAll((paths) =>
      paths.map((path) => getComputedStyle(path).transitionDuration),
    );
  expect(branchPaths.length).toBeGreaterThan(0);
  expect(branchPaths.every((duration) => duration === '0s')).toBeTruthy();

  await page.locator('#execution-options summary').click();
  await page.locator('#trust-check').check();
  const response = page.waitForResponse((r) => r.url().endsWith('/api/trace'));
  await page.locator('#run-button').click();
  const result = await response;
  expect(result.ok(), await result.text()).toBeTruthy();
  const trace = (await result.json()) as Trace;
  const index = trace.events.findIndex(
    (event, i) =>
      event.type === 'line' &&
      event.location?.line === 3 &&
      trace.events[i - 1]?.type === 'line' &&
      trace.events[i - 1]?.location?.line === 2,
  );
  expect(index).toBeGreaterThan(0);

  await page
    .locator('#seek-slider')
    .evaluate((el: HTMLInputElement, i: number) => {
      el.value = String(i);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, index);
  await expect(page.locator('#trace-code .trace-line.active')).toContainText(
    'print(total)',
  );
  await expect(page.locator('#step-guide')).toContainText('print(total)');
  const totalChange = page.locator('#step-guide .step-change').filter({
    has: page.locator('strong', { hasText: 'total' }),
  });
  await expect(totalChange).toContainText('0');
  await expect(totalChange).toContainText('2');
  const guideText = await page.locator('#step-guide').innerText();
  expect(
    await page.evaluate(
      (node) => node === document.querySelector('#diagram-stage svg'),
      svg,
    ),
  ).toBeTruthy();
  await expect(
    page.locator('#diagram-stage .active[data-source-line="3"]'),
  ).toHaveCount(1);

  await page.locator('#previous-button').click();
  await expect(page.locator('#trace-code .trace-line.active')).toContainText(
    'total += 2',
  );
  await expect(
    page.locator('#diagram-stage .active[data-source-line="2"]'),
  ).toHaveCount(1);
  await expect(
    page.locator('#diagram-stage [data-source-line="3"].visited'),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      (node) => node === document.querySelector('#diagram-stage svg'),
      svg,
    ),
  ).toBeTruthy();
  await page.locator('#next-button').click();
  await expect(page.locator('#step-guide')).toHaveText(/print\(total\)/);
  expect(await page.locator('#step-guide').innerText()).toBe(guideText);
  expect(
    await page.evaluate(
      (node) => node === document.querySelector('#diagram-stage svg'),
      svg,
    ),
  ).toBeTruthy();

  const activeRectDuration = await page
    .locator('#diagram-stage .active[data-node-id] rect')
    .evaluate((rect) => getComputedStyle(rect).transitionDuration);
  expect(activeRectDuration).toBe('0s');
  await page.screenshot({
    path: 'test-results/motion-desktop.png',
    fullPage: true,
  });

  await page.locator('#theme-select').selectOption('dark');
  await expect(page.locator('#diagram-stage svg')).toBeVisible();
  await expect(
    page.locator('#diagram-stage .active[data-node-id]'),
  ).toHaveCount(1);
  await page.screenshot({
    path: 'test-results/motion-dark.png',
    fullPage: true,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: 'test-results/motion-mobile.png',
    fullPage: true,
  });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
});
