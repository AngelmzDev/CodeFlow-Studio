import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import type { Trace } from '../../src/core/types.ts';

const root = resolve(import.meta.dirname, '../..');
const localTrace = async (page: Page): Promise<Trace> => {
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/trace') &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Run trace' }).click();
  const response = await responsePromise;
  if (!response.ok()) throw new Error(await response.text());
  return response.json();
};
const seek = async (page: Page, index: number) =>
  page
    .locator('#seek-slider')
    .evaluate((slider: HTMLInputElement, value: number) => {
      slider.value = String(value);
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    }, index);

test.describe.configure({ mode: 'serial' });
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    localStorage.setItem('codeflow-language', 'en');
    localStorage.setItem('codeflow-mode', 'advanced');
    localStorage.setItem('codeflow-theme', 'light');
  });
});

test('runs the API examples in Python and Java and replays observed state', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');

  const languageOptions = page.locator('#language-select option');
  await expect(languageOptions).toHaveCount(2);
  await expect(languageOptions).toContainText([
    'Python · sys.settrace',
    'Java · JDI',
  ]);
  await expect(page.locator('#event-count')).toHaveText('0 events');
  await expect(page.locator('#timeline-content')).toBeHidden();
  await expect(page.locator('#source-editor')).toHaveValue(
    /numbers = \[4, 7, 9\]/,
  );

  const axe = await new AxeBuilder({ page }).analyze();
  expect(
    axe.violations,
    JSON.stringify(
      axe.violations.map((item) => ({
        id: item.id,
        nodes: item.nodes.map((node) => node.target),
      })),
      null,
      2,
    ),
  ).toEqual([]);
  await page.locator('#theme-toggle').click();
  const darkAxe = await new AxeBuilder({ page }).analyze();
  expect(
    darkAxe.violations,
    JSON.stringify(
      darkAxe.violations.map((item) => ({
        id: item.id,
        nodes: item.nodes.map((node) => node.target),
      })),
      null,
      2,
    ),
  ).toEqual([]);
  await page.locator('#theme-toggle').click();

  await page.locator('#trust-check').check();
  const pythonTrace = await localTrace(page);
  expect(pythonTrace.language).toBe('python');
  expect(
    pythonTrace.events.some(
      (event) => event.provenance === 'observed' && event.frames.length > 0,
    ),
  ).toBeTruthy();
  await expect(page.locator('#timeline-content')).toBeVisible();
  await expect(page.locator('#event-strip .event-button')).not.toHaveCount(0);
  await expect(page.locator('.before-badge')).toHaveText('BEFORE LINE');
  await expect(page.locator('#trace-code')).toContainText(
    'numbers = [4, 7, 9]',
  );
  await expect(page.locator('#trace-code .trace-line.active')).toHaveCount(1);
  await seek(page, pythonTrace.events.length - 1);
  await expect(page.locator('#console-content')).toContainText('20');
  const lastPythonState = await page.locator('#state-content').innerText();
  const lastPythonOutput = await page.locator('#console-content').innerText();
  await page.getByRole('button', { name: 'Previous event' }).click();
  await page.getByRole('button', { name: 'Next event' }).click();
  expect(await page.locator('#state-content').innerText()).toBe(
    lastPythonState,
  );
  expect(await page.locator('#console-content').innerText()).toBe(
    lastPythonOutput,
  );

  const preservedSource = await page.locator('#source-editor').inputValue();
  await page.locator('#language-select').selectOption('java');
  await expect(page.locator('#source-editor')).toHaveValue(preservedSource);
  await expect(page.locator('#timeline-content')).toBeHidden();
  await expect(page.locator('#event-count')).toHaveText('0 events');
  await expect(page.locator('#console-content')).not.toContainText('20');
  await page.locator('#load-example').click();
  await expect(page.locator('#source-editor')).toHaveValue(/public class Main/);
  const javaTrace = await localTrace(page);
  expect(javaTrace.language).toBe('java');
  expect(
    javaTrace.events.some((event) =>
      event.frames.some((frame) => Object.keys(frame.locals).length > 0),
    ),
  ).toBeTruthy();
  await expect(page.locator('#trace-code')).toContainText('public class Main');
  const stateEventIndex = javaTrace.events.findIndex((event) =>
    event.frames.some((frame) => Object.keys(frame.locals).length > 0),
  );
  await seek(page, stateEventIndex);
  await expect(
    page.locator('#state-content .state-section').first(),
  ).toContainText('observed snapshot');
  await expect(page.locator('#state-content .variable-row')).not.toHaveCount(0);
  await expect(page.locator('#trace-code .trace-line.active')).toHaveCount(1);
  const arrayEventIndex = javaTrace.events.findIndex((event) =>
    Object.values(event.heap).some(
      (object) => object.kind === 'array' && (object.elements?.length || 0) > 0,
    ),
  );
  expect(
    arrayEventIndex,
    'Java trace should contain a real observed array snapshot',
  ).toBeGreaterThanOrEqual(0);
  await seek(page, arrayEventIndex);
  await mkdir(resolve(root, 'test-results'), { recursive: true });
  await page.screenshot({
    path: resolve(root, 'test-results/studio.png'),
    fullPage: true,
  });
  await seek(page, javaTrace.events.length - 1);
  await expect(page.locator('#console-content')).toContainText('17');
  const lastJavaState = await page.locator('#state-content').innerText();
  const lastJavaOutput = await page.locator('#console-content').innerText();
  await page.getByRole('button', { name: 'Previous event' }).click();
  await page.getByRole('button', { name: 'Next event' }).click();
  expect(await page.locator('#state-content').innerText()).toBe(lastJavaState);
  expect(await page.locator('#console-content').innerText()).toBe(
    lastJavaOutput,
  );

  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#seek-count')).toContainText(
    `${javaTrace.events.length - 1} /`,
  );
  await page.getByRole('button', { name: 'Edit source' }).click();
  await expect(page.locator('#timeline-content')).toBeHidden();
  await expect(page.locator('#export-json')).toBeDisabled();
  await expect(page.locator('#console-content')).not.toContainText('17');
});

test('preserves spaces in JSON argument arrays during a real Python run', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('#language-select').selectOption('python');
  await page.locator('#source-editor').fill('import sys\nprint(sys.argv[1])\n');
  await page.locator('#args-input').fill('["hello world"]');
  await page.locator('#trust-check').check();
  const trace = await localTrace(page);
  expect(trace.language).toBe('python');
  await seek(page, trace.events.length - 1);
  await expect(page.locator('#console-content')).toContainText('hello world');
});

test('imports and runs a real Java source file using its own entry class', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('#language-select option')).toHaveCount(2);
  await page
    .locator('#source-file')
    .setInputFiles(join(root, 'examples/java/Recursion.java'));
  await expect(page.locator('#language-select')).toHaveValue('java');
  await expect(page.locator('#editor-tab-name')).toHaveText('Recursion.java');
  await expect(page.locator('#entry-input')).toHaveValue('');
  await page.locator('#trust-check').check();
  const trace = await localTrace(page);
  expect(trace.language).toBe('java');
  expect(trace.sources[0]?.name).toBe('Recursion.java');
  await seek(page, trace.events.length - 1);
  await expect(page.locator('#console-content')).toContainText('120');
});

test('imports a real CLI Java trace and exports an offline viewer without network requests', async ({
  page,
  browser,
}) => {
  const directory = await mkdtemp(join(tmpdir(), 'codeflow-studio-e2e-'));
  const tracePath = join(directory, 'main-java-trace.json');
  const htmlPath = join(directory, 'offline-viewer.html');
  try {
    execFileSync(
      process.execPath,
      [
        'src/cli.ts',
        'trace',
        'examples/java/Main.java',
        '--allow-local-execution',
        '--out',
        tracePath,
      ],
      { cwd: root, windowsHide: true, stdio: 'pipe' },
    );
    const cliTrace: Trace = JSON.parse(
      await readFile(tracePath, 'utf8'),
    ) as Trace;
    expect(cliTrace.language).toBe('java');
    expect(
      cliTrace.events.some((event) => event.provenance === 'observed'),
    ).toBeTruthy();

    await page.goto('/');
    await page.locator('#language-select').selectOption('python');
    await page.getByRole('button', { name: 'Import trace' }).click();
    await page.locator('#trace-file').setInputFiles(tracePath);
    await expect(page.locator('#language-select')).toHaveValue('java');
    await expect(page.locator('#trace-code')).toContainText(
      'public class Main',
    );
    await expect(page.locator('#timeline-content')).toBeVisible();
    const actualTrace = cliTrace;
    await seek(page, actualTrace.events.length - 1);
    await expect(page.locator('#console-content')).toContainText('17');

    const downloadPromise = page.waitForEvent('download');
    await page
      .getByRole('button', { name: 'Download offline HTML viewer' })
      .click();
    const download = await downloadPromise;
    await download.saveAs(htmlPath);

    const offline = await browser.newPage();
    await offline.addInitScript(() => {
      localStorage.setItem('codeflow-language', 'en');
      localStorage.setItem('codeflow-mode', 'advanced');
    });
    const requests: string[] = [];
    offline.on('request', (request) => {
      if (request.resourceType() !== 'document') requests.push(request.url());
    });
    await offline.goto(pathToFileURL(htmlPath).href);
    const offlineError = await offline.locator('#alert-message').textContent();
    if (offlineError) {
      const elements = await offline.evaluate(() => ({
        ids: [...document.querySelectorAll('[id]')].map(
          (element) => element.id,
        ),
        settings: Boolean(document.querySelector('.settings-mark')),
      }));
      throw new Error(
        `Offline viewer initialization failed: ${offlineError}; DOM: ${JSON.stringify(elements)}`,
      );
    }
    await expect(offline.locator('#timeline-content')).toBeVisible();
    await expect(offline.locator('#trace-code')).toContainText(
      'public class Main',
    );
    await expect(offline.locator('#adapter-state')).toHaveText(
      'Embedded trace',
    );
    await expect(
      offline.getByRole('button', { name: 'Run trace' }),
    ).toBeHidden();
    await expect(
      offline.getByRole('button', { name: 'Import trace' }),
    ).toBeHidden();
    await expect(offline.locator('#console-content')).toContainText('17');
    expect(requests).toEqual([]);
    await offline.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('keeps controls reachable and prevents horizontal page overflow at 390px', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Run trace' })).toBeVisible();
  await expect(page.locator('#import-trace-button')).toBeVisible();
  await expect(page.locator('#language-select')).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(
    dimensions.scrollWidth,
    `Page scroll width ${dimensions.scrollWidth} exceeded viewport ${dimensions.width}`,
  ).toBeLessThanOrEqual(dimensions.width);
});
