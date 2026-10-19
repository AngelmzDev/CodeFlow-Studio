import { expect, test, type Page } from '@playwright/test';

async function initializeLayout(page: Page) {
  await page.goto('/');
  await expect(page.locator('#layout-board')).toBeVisible();
  await page.locator('#mode-select').selectOption('advanced');
}

async function persistedOrderFirst(page: Page) {
  return page.evaluate(() => {
    const value = localStorage.getItem('codeflow-layout-v1');
    return value ? JSON.parse(value).order[0] : null;
  });
}

test('basic mode reveals trace panels and stays within a mobile viewport', async ({
  page,
}) => {
  await initializeLayout(page);
  await page.locator('#mode-select').selectOption('basic');
  await page.evaluate(() => {
    document.documentElement.dataset.hasTrace = 'true';
  });
  await expect(page.locator('#sequence-panel')).toBeVisible();
  await expect(page.locator('#explanation-panel')).toBeVisible();

  await page.setViewportSize({ width: 375, height: 812 });
  await expect
    .poll(() =>
      page.evaluate(() =>
        Math.max(
          document.body.scrollWidth,
          document.documentElement.scrollWidth,
        ),
      ),
    )
    .toBeLessThanOrEqual(375);
});

test('panel order and dimensions persist, reset, and preserve live editor state', async ({
  page,
}) => {
  await initializeLayout(page);
  const editor = page.locator('#source-editor');
  await editor.fill('const answer = 42;');

  await page.locator('#console-panel .layout-move[data-move="down"]').click();
  await expect.poll(() => persistedOrderFirst(page)).toBe('state-panel');
  await expect(editor).toHaveValue('const answer = 42;');

  const statePanel = page.locator('#state-panel');
  const before = await statePanel.evaluate(
    (el) => el.getBoundingClientRect().width,
  );
  await statePanel.locator('.layout-resize').focus();
  await page.keyboard.press('ArrowRight');
  await expect
    .poll(() => statePanel.evaluate((el) => el.getBoundingClientRect().width))
    .toBeGreaterThan(before);
  await expect(editor).toHaveValue('const answer = 42;');

  await page.reload();
  await expect(page.locator('#layout-board')).toBeVisible();
  await page.locator('#mode-select').selectOption('advanced');
  await expect.poll(() => persistedOrderFirst(page)).toBe('state-panel');
  await expect(page.locator('#state-panel')).toHaveCSS('width', /px/);
  await page.getByRole('button', { name: 'Restaurar distribución' }).click();
  await expect.poll(() => persistedOrderFirst(page)).toBe('console-panel');
  expect(await page.locator('#state-panel').getAttribute('style')).toBe('');
});
