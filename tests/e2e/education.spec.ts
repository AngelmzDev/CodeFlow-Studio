import { test, expect } from '@playwright/test';
import type { Trace } from '../../src/core/types.ts';
import { explainStep } from '../../src/core/explanation.ts';

test('education panels follow a real Python trace backwards and cache optional AI', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('#source-editor')).toBeEnabled();
  await page
    .locator('#source-editor')
    .fill(
      'def sumar(x):\n    return x + 1\ncontador = 3\ncontador = sumar(contador)\nprint(contador)\n',
    );
  await page.locator('#execution-options summary').click();
  await page.locator('#trust-check').check();
  const response = page.waitForResponse((r) => r.url().endsWith('/api/trace'));
  await page.locator('#run-button').click();
  const result = await response;
  expect(result.ok(), await result.text()).toBeTruthy();
  const trace = (await result.json()) as Trace;
  const index = trace.events.findIndex(
    (e) => e.type === 'line' && e.location?.line === 5,
  );
  expect(index).toBeGreaterThan(0);
  await page
    .locator('#seek-slider')
    .evaluate((el: HTMLInputElement, i: number) => {
      el.value = String(i);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, index);
  await expect(page.locator('#explanation-panel')).toBeVisible();
  await expect(page.locator('#sequence-panel')).toBeVisible();
  await expect(page.locator('#explanation-content')).toHaveAttribute(
    'data-index',
    String(index),
  );
  await expect(page.locator('#explanation-content')).toContainText('contador');
  await expect(page.locator('#sequence-content')).toContainText('sumar');
  await page.locator('#previous-button').click();
  await expect(page.locator('#explanation-content')).toHaveAttribute(
    'data-index',
    String(index - 1),
  );
  await page.locator('#next-button').click();
  await expect(page.locator('#explanation-content')).toHaveAttribute(
    'data-index',
    String(index),
  );
  let requests = 0;
  await page.route('**/api/explain', async (route) => {
    requests++;
    const input = route.request().postDataJSON();
    const basic = explainStep(input.trace, input.index, input);
    await route.fulfill({
      json: {
        ...basic,
        ai: {
          status: 'generated',
          label: 'Texto generado por IA',
          text: 'Explicación de prueba <script>sin ejecutar</script>',
        },
      },
    });
  });
  await page.locator('#explanation-ai').check();
  await expect(page.locator('.explanation-generated')).toContainText(
    '<script>sin ejecutar</script>',
  );
  expect(await page.locator('#explanation-content script').count()).toBe(0);
  const count = requests;
  await page.locator('#previous-button').click();
  await page.locator('#next-button').click();
  await expect(page.locator('.explanation-generated')).toBeVisible();
  expect(requests).toBe(count);
  await page.locator('#explanation-detail').selectOption('detailed');
  await expect(page.locator('#explanation-content')).toContainText(
    'Siguiente instantánea',
  );
});
