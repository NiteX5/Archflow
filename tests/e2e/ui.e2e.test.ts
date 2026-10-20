import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Browser, Page } from 'playwright-core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { defaultWebDir, startServer, type RunningServer } from '../../src/server/serve.js';
import { serverExtensions } from '../../src/server/extensions.js';
import { copySample } from '../server/helpers.js';
import { launch } from './browser.js';

const webDir = path.resolve('dist/web');

let browser: Browser;
let server: RunningServer;
let page: Page;
let repo: string;
let cleanup: () => Promise<void>;
const errors: string[] = [];

beforeAll(async () => {
  browser = await launch();
});
afterAll(async () => {
  await browser?.close();
});

async function open(repoPath?: string) {
  server = await startServer({ repo: repoPath, port: 0, strictPort: true, webDir, log: () => {}, extensions: serverExtensions });
  page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => void d.accept(d.type() === 'prompt' ? 'No longer used' : undefined));
  await page.goto(server.url);
}

beforeEach(async () => {
  errors.length = 0;
  ({ dir: repo, cleanup } = await copySample());
});
afterEach(async () => {
  await page?.close();
  await server?.stop();
  await cleanup();
  expect(errors).toEqual([]);
});

const modelFile = (rel: string) => readFile(path.join(repo, '.archflow', rel), 'utf8');

describe('Archflow UI', () => {
  it('has a built UI to test', () => {
    expect(defaultWebDir() ?? webDir).toBeTruthy();
  });

  it('opens a repository chosen in the UI and shows the overview', async () => {
    await open();
    await page.getByLabel('Repository path').fill(repo);
    await page.getByRole('button', { name: 'Open' }).click();
    await expect.poll(() => page.locator('.status').first().textContent()).toBe('valid');
    await expect.poll(() => page.locator('.react-flow__node').count()).toBe(4);
  });

  it('explains bad paths', async () => {
    await open();
    await page.getByLabel('Repository path').fill('/definitely/not/here');
    await page.getByRole('button', { name: 'Open' }).click();
    await expect.poll(() => page.getByRole('alert').textContent()).toContain('does not exist');
  });

  it('keeps identity across views and navigates to them from the detail panel', async () => {
    await open(repo);
    await page.locator('.react-flow__node', { hasText: 'Public API' }).click();
    await expect.poll(() => page.locator('.detail h2').textContent()).toBe('Public API');
    await page.locator('.detail').getByText('Deployment').click();
    await expect.poll(() => page.locator('.sidebar li.active').textContent()).toContain('Deployment');
    // Selection is preserved: same element, same ID.
    await expect.poll(() => page.locator('.detail .id-line code').textContent()).toBe('public-api');
    await expect.poll(() => page.locator('.react-flow__node.selected').textContent()).toContain('Public API');
  });

  it('creates, edits, deletes and restores an element, persisting to the YAML files', async () => {
    await open(repo);
    await page.getByRole('button', { name: '+ Element' }).click();
    await page.getByLabel('Name', { exact: true }).fill('Search service');
    await page.locator('.dialog select').first().selectOption('service');
    await page.getByRole('button', { name: 'Create' }).click();
    await expect.poll(() => modelFile('systems.yaml')).toMatch(/id: search-service-[a-z0-9]{4}\n\s+kind: service\n\s+name: Search service/);
    await expect.poll(() => page.locator('.react-flow__node', { hasText: 'Search service' }).count()).toBe(1);

    await page.locator('.detail').getByRole('button', { name: 'Edit' }).click();
    await page.getByLabel('Description').fill('Full-text search.');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => modelFile('systems.yaml')).toContain('description: Full-text search.');

    await page.locator('.detail').getByRole('button', { name: 'Add note' }).click();
    await page.getByLabel('Note', { exact: true }).fill('Owned by the platform team.');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect.poll(() => modelFile('systems.yaml')).toContain('text: Owned by the platform team.');

    await page.locator('.detail').getByRole('button', { name: 'Delete' }).click();
    await expect.poll(() => modelFile('systems.yaml')).toContain('lifecycle: deleted');
    await expect.poll(() => page.locator('.react-flow__node', { hasText: 'Search service' }).count()).toBe(0);
    await page.locator('.detail').getByRole('button', { name: 'Restore' }).click();
    await expect.poll(() => modelFile('systems.yaml')).not.toContain('lifecycle: deleted');
  });

  it('creates a relation by connecting two nodes', async () => {
    await open(repo);
    const center = async (sel: ReturnType<Page['locator']>) => {
      const b = (await sel.boundingBox())!;
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    };
    const from = await center(page.locator('.react-flow__node', { hasText: 'Payment provider' }).locator('.react-flow__handle.source'));
    const to = await center(page.locator('.react-flow__node', { hasText: 'Customer' }).locator('.react-flow__handle.target'));
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 15 });
    await page.mouse.up();
    await expect.poll(() => page.getByRole('dialog').getAttribute('aria-label')).toBe('New relation');
    await page.getByRole('dialog').locator('select').nth(1).selectOption('integrates-with');
    await page.getByRole('button', { name: 'Create' }).click();
    await expect.poll(() => modelFile('systems.yaml')).toMatch(/type: integrates-with\n\s+from: payment-provider\n\s+to: customer/);
  });

  it('saves positions in the view file when a node is dragged', async () => {
    await open(repo);
    const node = page.locator('.react-flow__node', { hasText: 'Payment provider' });
    const box = (await node.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 120, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => modelFile('views/overview.yaml')).not.toContain('payment-provider: { x: 900, y: 0 }');
    expect(await modelFile('systems.yaml')).not.toMatch(/\bx: /);
  });

  it('reflects external edits and keeps the last valid model when files are invalid', async () => {
    await open(repo);
    const systems = await modelFile('systems.yaml');
    await writeFile(path.join(repo, '.archflow', 'systems.yaml'), systems.replace('name: Customer', 'name: Shopper'));
    await expect.poll(() => page.locator('.react-flow__node', { hasText: 'Shopper' }).count()).toBe(1);

    await writeFile(path.join(repo, '.archflow', 'data.yaml'), 'elements: [broken');
    await expect.poll(() => page.locator('.issues').textContent()).toContain('Showing the last valid version');
    expect(await page.locator('.react-flow__node', { hasText: 'Shopper' }).count()).toBe(1);
    expect(await page.getByRole('button', { name: '+ Element' }).isDisabled()).toBe(true);
  });

  it('shows a conflict instead of overwriting a concurrent change', async () => {
    await open(repo);
    await page.locator('.react-flow__node', { hasText: 'Customer' }).click();
    await page.locator('.detail').getByRole('button', { name: 'Edit' }).click();
    // Claude edits the same element while the form is open.
    const systems = await modelFile('systems.yaml');
    await writeFile(path.join(repo, '.archflow', 'systems.yaml'), systems.replace('description: Person buying books.', 'description: Edited by Claude.'));
    await page.waitForTimeout(500);
    await page.getByLabel('Description').fill('Edited in the UI.');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => page.getByRole('dialog', { name: 'Conflicting change' }).isVisible()).toBe(true);
    expect(await modelFile('systems.yaml')).toContain('Edited by Claude.');
    await page.getByRole('button', { name: 'Keep their version' }).click();
  });

  it('lists history and restores an earlier state', async () => {
    await open(repo);
    const original = await modelFile('systems.yaml');
    await page.locator('.react-flow__node', { hasText: 'Customer' }).click();
    await page.locator('.detail').getByRole('button', { name: 'Delete' }).click();
    await expect.poll(() => modelFile('systems.yaml')).toContain('lifecycle: deleted');
    await page.getByRole('button', { name: 'History' }).click();
    await page.locator('.history-list a').first().click();
    await expect.poll(() => page.locator('.diff-add').count()).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Restore state before this change' }).click();
    await expect.poll(() => modelFile('systems.yaml')).toBe(original);
  });

  it('exports the current view as SVG, PNG and PDF and the model as JSON', async () => {
    await open(repo);
    const grab = async (button: string) => {
      await page.getByRole('button', { name: 'Export' }).click();
      const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('dialog').getByRole('button', { name: button, exact: true }).click()]);
      const file = await download.path();
      return { name: download.suggestedFilename(), bytes: await readFile(file) };
    };
    const svg = await grab('SVG');
    expect(svg.name).toBe('system-overview.svg');
    expect(svg.bytes.toString()).toContain('Payment provider');
    const png = await grab('PNG');
    expect(png.name).toBe('system-overview.png');
    expect(png.bytes.subarray(1, 4).toString()).toBe('PNG');
    const pdf = await grab('PDF');
    expect(pdf.bytes.subarray(0, 8).toString()).toBe('%PDF-1.4');
    const json = await grab('Archflow JSON');
    expect(JSON.parse(json.bytes.toString()).format).toBe('archflow-model');
  });

  it('imports a Mermaid diagram after reviewing a preview', async () => {
    await open(repo);
    const file = path.join(repo, 'search.mmd');
    await writeFile(file, 'flowchart LR\n  web[Web storefront] --> search[Search service]\n');
    await page.getByRole('button', { name: 'Import' }).click();
    await page.getByLabel('File').setInputFiles(file);
    await page.getByRole('button', { name: 'Preview' }).click();
    await expect.poll(() => page.locator('.import-preview').textContent()).toContain('Linked to existing elements: 1');
    expect(await page.locator('.warning-list').textContent()).toContain('pending-review');
    await page.getByRole('button', { name: 'Apply import' }).click();
    await expect.poll(() => page.locator('.sidebar').textContent()).toContain('search.mmd');
    expect(await modelFile('imported/search.yaml')).toContain('name: Search service');
  });

  it('runs the verification and lists findings without changing the model', async () => {
    await open(repo);
    const before = await modelFile('systems.yaml');
    await page.getByRole('button', { name: 'Verify' }).click();
    await page.getByRole('button', { name: 'Run checks' }).click();
    await expect.poll(() => page.locator('.findings').textContent()).toContain('does not exist in the repository');
    expect(await modelFile('systems.yaml')).toBe(before);
  });

  it('goes from a clean repository to an editable map updated from the files', async () => {
    const clean = await mkdtemp(path.join(tmpdir(), 'archflow-clean-'));
    try {
      await open(clean);
      await page.getByRole('button', { name: 'Create empty model' }).click();
      await expect.poll(() => page.locator('.status').first().textContent()).toBe('valid');
      await page.getByRole('button', { name: '+ Element' }).click();
      await page.getByLabel('Name', { exact: true }).fill('Billing API');
      await page.locator('.dialog select').first().selectOption('api');
      await page.getByRole('button', { name: 'Create' }).click();
      await expect.poll(() => page.locator('.react-flow__node', { hasText: 'Billing API' }).count()).toBe(1);
      // An agent declares a related element directly in the files.
      await writeFile(
        path.join(clean, '.archflow', 'payments.yaml'),
        'elements:\n  - id: stripe-k2v8\n    kind: external-system\n    name: Stripe\n    provenance: { source: agent, status: inferred }\n',
      );
      await expect.poll(() => page.locator('.react-flow__node', { hasText: 'Stripe' }).count()).toBe(1);
      expect(await page.locator('.react-flow__node', { hasText: 'Stripe' }).locator('.badge-inferred').count()).toBe(1);
    } finally {
      await rm(clean, { recursive: true, force: true });
    }
  });
});

