import { readFile } from 'node:fs/promises';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, relative, resolve, sep } from 'node:path';
import type { DashboardRequest, DashboardResponse } from './http.js';

const DEFAULT_MIME = 'application/octet-stream';
const TEXT_MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.map': 'application/json',
};

const CACHE_IMMUTABLE = 'public, max-age=31536000, immutable';
const CACHE_NO = 'no-cache, no-store, must-revalidate';

export interface StaticServerOptions {
  readonly root: string;
  readonly reservedPaths: readonly string[];
  readonly fallbackToIndex?: boolean;
}

function resolveSafe(root: string, pathname: string): string | null {
  // Reject traversal attempts before normalize strips them
  if (pathname.includes('..')) return null;
  const normalized = normalize(pathname).replace(/^\/+/u, '');
  const candidate = resolve(root, normalized);
  const relativePath = relative(root, candidate);
  if (relativePath.startsWith(`..${sep}`) || relativePath === '..' || (sep !== '/' && relativePath.startsWith('..'))) {
    return null;
  }
  return candidate;
}

function getContentType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  return TEXT_MIME[ext] ?? DEFAULT_MIME;
}

function isCacheImmutable(filePath: string): boolean {
  return /[.-][0-9a-f]{8,}\./.test(filePath);
}

async function serveFile(filePath: string, res: DashboardResponse): Promise<true> {
  const contentType = getContentType(filePath);
  res.header('Content-Type', contentType);

  if (isCacheImmutable(filePath)) {
    res.header('Cache-Control', CACHE_IMMUTABLE);
  } else {
    res.header('Cache-Control', CACHE_NO);
  }

  try {
    const content = await readFile(filePath, 'utf-8');
    res.text(content);
    return true;
  } catch {
    res.status(500).text('Internal Server Error');
    return true;
  }
}

export async function serveStatic(
  req: DashboardRequest,
  res: DashboardResponse,
  options: StaticServerOptions,
): Promise<boolean> {
  const { root, reservedPaths, fallbackToIndex = false } = options;

  if (reservedPaths.some(p => req.path === p || req.path.startsWith(`${p}/`) || req.path.startsWith(`${p}?`))) {
    return false;
  }

  const filePath = resolveSafe(root, req.path);
  if (!filePath) {
    res.status(403).text('Forbidden');
    return true;
  }

  try {
    const details = await stat(filePath);

    if (details.isDirectory()) {
      const indexPath = join(filePath, 'index.html');
      try {
        await stat(indexPath);
        return serveFile(indexPath, res);
      } catch {
        res.status(403).text('Forbidden');
        return true;
      }
    }

    if (details.isFile()) {
      return serveFile(filePath, res);
    }

    res.status(403).text('Forbidden');
    return true;
  } catch {
    if (fallbackToIndex) {
      const indexPath = join(root, 'index.html');
      try {
        await stat(indexPath);
        return serveFile(indexPath, res);
      } catch {
        // no fallback
      }
    }
    return false;
  }
}
