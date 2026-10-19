import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import type { Trace } from '../../src/core/types.ts';

const python =
  'total = 0\nfor numero in [2, 4, 6]:\n    if numero > 2:\n        total += numero\nprint(total)\n';
const java = `class Persona {
  protected String nombre;
  public String saludar() { return nombre; }
}
public class Alumno extends Persona {
  private int nota;
  public int evaluar(int puntos) {
    if (puntos >= 5) return puntos;
    return 0;
  }
  public static void main(String[] args) {
    System.out.println(new Alumno().evaluar(7));
  }
}
`;

test('basic Spanish flow creates a static UML diagram without running pasted code', async ({
  page,
}) => {
  const runs: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/api/trace')) runs.push(request.url());
  });
  await page.goto('/');
  await expect(page.locator('#source-editor')).toHaveValue('');
  await expect(page.locator('#mode-select')).toHaveValue('basic');
  await expect(page.locator('#ui-language')).toHaveValue('es');
  await expect(page.locator('.inspector-panel')).toBeHidden();
  await expect(page.locator('#execution-options')).not.toHaveAttribute(
    'open',
    '',
  );
  await page.locator('#source-editor').fill(python);
  const response = page.waitForResponse((r) =>
    r.url().endsWith('/api/analyze'),
  );
  await page.getByRole('button', { name: 'Crear diagrama' }).click();
  expect((await response).ok()).toBeTruthy();
  await expect(page.locator('#diagram-stage svg')).toBeVisible();
  await expect(page.locator('#diagram-stage')).toContainText('numero > 2');
  await expect(page.locator('#diagram-stage')).toContainText('Sí');
  await expect(page.locator('#trust-check')).not.toBeChecked();
  expect(runs).toEqual([]);
  const svg = await page.locator('#diagram-stage svg').getAttribute('viewBox');
  expect(svg).toBeTruthy();
  await expect(page.locator('#diagram-export-svg')).toBeEnabled();
  await expect(page.locator('#diagram-export-jpg')).toBeEnabled();
  await page.locator('#diagram-zoom').selectOption('1');
  await page.locator('#diagram-stage').dispatchEvent('wheel', {
    ctrlKey: true,
    deltaY: -100,
    clientX: 350,
    clientY: 300,
  });
  await expect(page.locator('#diagram-zoom')).toHaveValue('1.25');
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#diagram-export-jpg').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/-diagram\.jpg$/);
  const jpgPath = await download.path();
  expect(jpgPath).toBeTruthy();
  const jpg = await readFile(jpgPath!);
  expect(jpg.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
  await page.locator('#source-editor').fill(python + '# cambio\n');
  await expect(page.locator('#diagram-export-svg')).toBeDisabled();
  await expect(page.locator('#diagram-export-jpg')).toBeDisabled();
});

test('language selection starts with an available runtime and explains disabled options', async ({
  page,
}) => {
  await page.route('**/api/adapters', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.adapters = data.adapters.map(
      (adapter: { language: string; available: boolean }) =>
        adapter.language === 'python'
          ? { ...adapter, available: false }
          : adapter,
    );
    await route.fulfill({ response, json: data });
  });
  await page.goto('/');
  await expect(page.locator('#language-select')).toHaveValue('java');
  await expect(
    page.locator('#language-select option[value="python"]'),
  ).toBeDisabled();
  await expect(
    page.locator('#language-select option[value="python"]'),
  ).not.toHaveText('Python');
  await expect(page.locator('#diagram-generate')).toBeEnabled();
});

test('pasting Java before selecting its language preserves source and displays class UML', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('#language-select option')).toHaveCount(2);
  await expect(
    page.getByLabel('Lenguaje de tu código', { exact: true }),
  ).toBeVisible();
  const selector = await page.locator('#language-select').boundingBox();
  const editor = await page.locator('#source-editor').boundingBox();
  expect(selector!.y + selector!.height).toBeLessThanOrEqual(editor!.y);
  await page.locator('#source-editor').fill(java);
  await page.locator('#language-select').selectOption('java');
  await expect(page.locator('#source-editor')).toHaveValue(java);
  await page.reload();
  await expect(page.locator('#language-select')).toHaveValue('java');
  await expect(page.locator('#source-editor')).toHaveValue(java);
  await page.locator('#diagram-generate').click();
  await expect(page.locator('#diagram-stage svg')).toBeVisible();
  await expect(page.locator('#editor-tab-name')).toHaveText('Alumno.java');
  await expect(page.locator('#diagram-method')).toBeVisible();
  await page.locator('#diagram-type').selectOption('classes');
  await expect(page.locator('#diagram-stage')).toContainText('Alumno');
  await expect(page.locator('#diagram-stage')).toContainText('Persona');
  await expect(page.locator('#diagram-stage')).toContainText('nota');
  await expect(page.locator('#diagram-stage')).toContainText('evaluar');
  await expect(page.locator('#diagram-stage')).not.toContainText(
    'return puntos',
  );
});

test('language and theme persist, basic controls remain accessible on mobile', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('#source-editor')).toBeVisible();
  for (const theme of ['light', 'dark']) {
    await page.locator('#theme-select').selectOption(theme);
    const axe = await new AxeBuilder({ page }).analyze();
    expect(
      axe.violations,
      JSON.stringify(
        axe.violations.map((x) => ({
          id: x.id,
          targets: x.nodes.map((n) => n.target),
        })),
      ),
    ).toEqual([]);
  }
  await page.locator('#ui-language').selectOption('en');
  await expect(
    page.getByRole('button', { name: 'Create diagram' }),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator('#ui-language')).toHaveValue('en');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#diagram-generate')).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width);
});

test('optional real animation highlights observed lines and survives offline export', async ({
  page,
  browser,
}) => {
  await page.goto('/');
  await expect(page.locator('#source-editor')).toBeVisible();
  await page.locator('#source-editor').fill(python);
  await page.locator('#diagram-generate').click();
  await expect(page.locator('#diagram-stage svg')).toBeVisible();
  await page.locator('#execution-options summary').click();
  await page.locator('#trust-check').check();
  const response = page.waitForResponse((r) => r.url().endsWith('/api/trace'));
  await page.locator('#run-button').click();
  const result = await response;
  if (!result.ok()) throw new Error(await result.text());
  const trace = (await result.json()) as Trace;
  const index = trace.events.findIndex((e) => e.location?.line === 4);
  expect(index).toBeGreaterThanOrEqual(0);
  await expect(page.locator('#timeline-content')).toBeVisible();
  await page
    .locator('#seek-slider')
    .evaluate((el: HTMLInputElement, value: number) => {
      el.value = String(value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, index);
  await expect(
    page.locator('#diagram-stage .active[data-node-id]'),
  ).not.toHaveCount(0);
  await expect(page.locator('#diagram-explanation')).toContainText(/línea/i);
  const dir = await mkdtemp(join(tmpdir(), 'codeflow-student-offline-'));
  try {
    const downloadEvent = page.waitForEvent('download');
    await page.locator('#export-html').click();
    const download = await downloadEvent;
    const path = join(dir, 'student.html');
    await download.saveAs(path);
    const offline = await browser.newPage();
    const errors: string[] = [],
      requests: string[] = [];
    offline.on('pageerror', (error) => errors.push(error.message));
    offline.on('request', (req) => {
      if (req.resourceType() !== 'document') requests.push(req.url());
    });
    await offline.goto(pathToFileURL(path).href);
    await expect(offline.locator('#diagram-stage svg')).toBeVisible();
    await expect(offline.locator('#timeline-content')).toBeVisible();
    await offline.locator('#mode-select').selectOption('advanced');
    await offline.locator('#ui-language').selectOption('en');
    await expect(offline.locator('#alert-toast')).toBeHidden();
    expect(errors).toEqual([]);
    expect(requests).toEqual([]);
    await offline.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
