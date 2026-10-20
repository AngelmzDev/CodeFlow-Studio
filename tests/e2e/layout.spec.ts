import { expect, test } from '@playwright/test';

test('three sections survive old layout preferences and keep drafts on mobile', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('codeflow-mode', 'advanced');
    localStorage.setItem(
      'codeflow-layout-v1',
      JSON.stringify({
        order: [
          'console-panel',
          'state-panel',
          'sequence-panel',
          'explanation-panel',
        ],
        sizes: { 'editor-panel': { width: 1500, height: 1200 } },
      }),
    );
  });
  await page.goto('/');
  await expect(page.locator('#source-editor')).toBeEnabled();
  await expect(page.locator('#layout-board > section')).toHaveCount(3);
  await expect(page.locator('.studio-heading h2')).toHaveText([
    'Código',
    'Diagrama',
    'Paso a paso',
  ]);
  await expect(page.locator('#mode-select')).toHaveCount(0);
  await page.locator('#source-editor').fill('total = 42\nprint(total)');
  await page.reload();
  await expect(page.locator('#source-editor')).toHaveValue(
    'total = 42\nprint(total)',
  );
  for (const width of [1440, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await expect(page.locator('#run-button')).toBeVisible();
  }
});

test('long conditions fit their diamonds and the debugger tracks values in both directions', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#source-editor')).toBeEnabled();
  await page
    .locator('#source-editor')
    .fill(
      'total = 0\nfor numero in [2, 4, 6]:\n    if numero > 2 and total < 100:\n        total += numero\nprint(total)\n',
    );
  await page.locator('#diagram-generate').click();
  await expect(page.locator('#diagram-stage svg')).toBeVisible();
  const fits = await page
    .locator('#diagram-stage .node-decision')
    .evaluateAll((nodes) =>
      nodes.every((node) => {
        const shape = (
          node.querySelector('path') as SVGGraphicsElement
        ).getBBox();
        const text = (
          node.querySelector('text') as SVGGraphicsElement
        ).getBBox();
        const cx = shape.x + shape.width / 2,
          cy = shape.y + shape.height / 2;
        return [text.x, text.x + text.width].every((x) =>
          [text.y, text.y + text.height].every(
            (y) =>
              Math.abs(x - cx) / (shape.width / 2) +
                Math.abs(y - cy) / (shape.height / 2) <
              1,
          ),
        );
      }),
    );
  expect(fits).toBeTruthy();
  await page.locator('#trust-check').check();
  const response = page.waitForResponse((r) => r.url().endsWith('/api/trace'));
  await page.locator('#run-button').click();
  const result = await response;
  expect(result.ok()).toBeTruthy();
  const trace = await result.json();
  const index = trace.events.findIndex(
    (e: { type: string; location?: { line: number } }) =>
      e.type === 'line' && e.location?.line === 5,
  );
  expect(index).toBeGreaterThan(0);
  await page
    .locator('#seek-slider')
    .evaluate((el: HTMLInputElement, i: number) => {
      el.value = String(i);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, index);
  await expect(page.locator('#trace-code .active')).toHaveText('print(total)');
  await expect(page.locator('#state-content')).toContainText('10');
  const state = await page.locator('#state-content').innerText();
  await page.locator('#previous-button').click();
  await page.locator('#next-button').click();
  expect(await page.locator('#state-content').innerText()).toBe(state);
  await page.screenshot({
    path: 'test-results/redesign-desktop.png',
    fullPage: true,
  });
  await page.locator('#theme-select').selectOption('dark');
  await expect(
    page.locator('#diagram-stage .active[data-node-id]'),
  ).not.toHaveCount(0);
  await page.screenshot({
    path: 'test-results/redesign-dark.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: 'test-results/redesign-mobile.png',
    fullPage: true,
  });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  expect(errors).toEqual([]);
});
