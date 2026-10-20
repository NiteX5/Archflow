/** Export, import and verification routes. */
import { bundleToJson, bundleToYaml, toBundle } from '../core/interchange.js';
import { viewToDrawio, UnsupportedExportError } from '../core/drawio.js';
import { layoutView } from '../core/layout.js';
import { viewToMermaid } from '../core/mermaid.js';
import { buildScene, sceneToPdf, sceneToSvg } from '../core/render.js';
import { deriveView, listViews } from '../core/views.js';
import type { History } from '../node/history.js';
import { IMPORT_FORMATS, ImportError, planImport, type ImportFormat } from '../node/importer.js';
import { verifyModel } from '../node/verify.js';
import type { Workspace } from '../node/workspace.js';
import { commitFiles, freshValidSnapshot } from '../node/writer.js';
import { HttpError, type Route } from './http.js';

const MAX_IMPORT_CHARS = 4 * 1024 * 1024;

function download(res: import('node:http').ServerResponse, name: string, type: string, body: string | Uint8Array, headers: Record<string, string> = {}) {
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Disposition': `attachment; filename="${name.replace(/[^A-Za-z0-9._-]/g, '_')}"`,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(body);
}

function importRequest(body: unknown): { format: ImportFormat; content: string; fileName: string; baseVersion?: string } {
  const b = body as Record<string, unknown> | null;
  if (!b || !IMPORT_FORMATS.includes(b.format as ImportFormat)) {
    throw new HttpError(400, 'invalid-request', `"format" must be one of: ${IMPORT_FORMATS.join(', ')}`);
  }
  if (typeof b.content !== 'string' || !b.content.trim()) throw new HttpError(400, 'invalid-request', 'The file is empty');
  if (b.content.length > MAX_IMPORT_CHARS) throw new HttpError(413, 'body-too-large', 'The file is too large to import (4 MiB limit)');
  const fileName = typeof b.fileName === 'string' && b.fileName.trim() ? b.fileName.trim().slice(0, 120) : 'import';
  return { format: b.format as ImportFormat, content: b.content, fileName, ...(typeof b.baseVersion === 'string' ? { baseVersion: b.baseVersion } : {}) };
}

export function interopRoutes(workspace: Workspace, history: () => History): Route[] {
  const snapshot = () => {
    const s = workspace.snapshot;
    if (!s) throw new HttpError(409, 'no-model', 'No valid model is loaded');
    return s;
  };
  return [
    {
      method: 'GET',
      path: '/api/export/model',
      raw: true,
      handler: async ({ res, url }) => {
        const format = url.searchParams.get('format') ?? 'json';
        const bundle = toBundle(snapshot().model);
        const base = bundle.manifest.project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'model';
        if (format === 'json') download(res, `${base}.archflow.json`, 'application/json; charset=utf-8', bundleToJson(bundle));
        else if (format === 'yaml') download(res, `${base}.archflow.yaml`, 'application/yaml; charset=utf-8', bundleToYaml(bundle));
        else throw new HttpError(400, 'invalid-request', 'format must be json or yaml');
      },
    },
    {
      method: 'GET',
      path: '/api/export/view',
      raw: true,
      handler: async ({ res, url }) => {
        const model = snapshot().model;
        const id = url.searchParams.get('view') ?? '';
        const entry = listViews(model).find((v) => v.view.id === id);
        if (!entry) throw new HttpError(404, 'not-found', `View "${id}" not found`);
        const derived = deriveView(model, entry.view, entry.builtin);
        const boxes = layoutView(derived);
        const base = entry.view.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'view';
        const format = url.searchParams.get('format');
        try {
          switch (format) {
            case 'svg':
              return download(res, `${base}.svg`, 'image/svg+xml; charset=utf-8', sceneToSvg(buildScene(derived, boxes)));
            case 'pdf': {
              const pdf = sceneToPdf(buildScene(derived, boxes));
              const warning: Record<string, string> = pdf.replacedCharacters.length
                ? { 'X-Archflow-Warning': encodeURIComponent(`Characters not supported by the PDF font were replaced by "?": ${pdf.replacedCharacters.join(' ')}`) }
                : {};
              return download(res, `${base}.pdf`, 'application/pdf', pdf.bytes, warning);
            }
            case 'mermaid':
              return download(res, `${base}.mmd`, 'text/plain; charset=utf-8', viewToMermaid(derived, boxes));
            case 'drawio':
              return download(res, `${base}.drawio`, 'application/xml; charset=utf-8', viewToDrawio(derived, boxes));
            default:
              throw new HttpError(400, 'invalid-request', 'format must be svg, pdf, mermaid or drawio');
          }
        } catch (err) {
          if (err instanceof UnsupportedExportError) throw new HttpError(400, 'unsupported', err.message);
          throw err;
        }
      },
    },
    {
      method: 'POST',
      path: '/api/import/preview',
      handler: async ({ body }) => {
        const req = importRequest(await body());
        return workspace.exclusive(async () => {
          const s = await freshValidSnapshot(workspace);
          try {
            return planImport(s, req.format, req.content, req.fileName).preview;
          } catch (err) {
            if (err instanceof ImportError) throw new HttpError(422, 'import-failed', err.message);
            throw err;
          }
        });
      },
    },
    {
      method: 'POST',
      path: '/api/import/apply',
      handler: async ({ body }) => {
        const req = importRequest(await body());
        return workspace.exclusive(async () => {
          const s = await freshValidSnapshot(workspace);
          if (req.baseVersion !== s.version) {
            throw new HttpError(409, 'changed-since-preview', 'The model changed after the preview. Preview the import again before applying it.');
          }
          let plan;
          try {
            plan = planImport(s, req.format, req.content, req.fileName);
          } catch (err) {
            if (err instanceof ImportError) throw new HttpError(422, 'import-failed', err.message);
            throw err;
          }
          if (!plan.preview.valid) throw new HttpError(422, 'invalid-result', 'The import would make the model invalid; nothing was written.', { issues: plan.preview.issues });
          await commitFiles(workspace, history(), plan.next, 'import', `Imported ${req.fileName} (${req.format}, ${plan.preview.mode})`);
          return workspace.state();
        });
      },
    },
    {
      method: 'POST',
      path: '/api/verify',
      handler: async () => {
        const root = workspace.root;
        if (!root) throw new HttpError(409, 'no-repo', 'No repository is open');
        return verifyModel(root, snapshot().model);
      },
    },
  ];
}
