import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApiHandler, createLimiter, type ApiEnv, type Kv } from '../shared/api-core.ts';
import { createSupabaseKv } from '../shared/supabase.ts';
import type { Assignment, Config as AppConfig, Staff } from '../shared/types.ts';
import initialConfig from '../src/data/initialConfig.json';
import initialSchedule from '../src/data/initialSchedule.json';
import initialStaff from '../src/data/initialStaff.json';

/**
 * Vercel Serverless Function (http://<domain>/api/piket)
 * Mendukung runtime Node.js Serverless maupun Edge Runtime di Vercel.
 *
 * Environment variable (Vercel Dashboard > Project Settings > Environment Variables):
 *   ACCESS_CODE        kode akses guru (min. 6 karakter, bawaan: sdn1rejoso)
 *   ADMIN_PIN          PIN admin (min. 6 karakter, bawaan: 123456)
 *   FONNTE_TOKEN       (opsional) token WhatsApp Fonnte
 *   GDRIVE_SCRIPT_URL  (opsional) URL Web App Google Apps Script sekolah
 *   GDRIVE_SECRET      (opsional) kunci rahasia yang sama dengan di skrip
 *
 * Penyimpanan:
 *   - Otomatis mendukung Vercel KV (KV_REST_API_URL & KV_REST_API_TOKEN) jika diaktifkan.
 *   - Jika KV belum diaktifkan, menggunakan memori serverless + data bawaan SDN 1 Rejoso.
 *   - Seluruh foto piket & rekap tetap tersimpan otomatis dan permanen di Google Drive sekolah.
 */

function makeKv(): Kv {
  const memory = new Map<string, unknown>();
  const memoryKv: Kv = {
    async get<T>(key: string) {
      return (memory.get(key) as T) ?? null;
    },
    async set(key: string, value: unknown) {
      memory.set(key, value);
    },
    async delete(key: string) {
      memory.delete(key);
    },
    async list(prefix: string) {
      return [...memory.keys()].filter((k) => k.startsWith(prefix));
    },
  };

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (supabaseUrl && supabaseKey) {
    return createSupabaseKv({ url: supabaseUrl, key: supabaseKey, fallbackKv: memoryKv });
  }

  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;

  // Jika proyek Vercel menghubungkan Vercel KV / Upstash Redis
  if (kvUrl && kvToken) {
    return {
      async get<T>(key: string): Promise<T | null> {
        try {
          const res = await fetch(`${kvUrl}/get/${encodeURIComponent(key)}`, {
            headers: { Authorization: `Bearer ${kvToken}` },
          });
          if (!res.ok) return (memory.get(key) as T) ?? null;
          const json = (await res.json()) as { result?: unknown };
          if (json.result === null || json.result === undefined) return (memory.get(key) as T) ?? null;
          if (typeof json.result === 'string') {
            try {
              return JSON.parse(json.result) as T;
            } catch {
              return json.result as unknown as T;
            }
          }
          return json.result as T;
        } catch {
          return (memory.get(key) as T) ?? null;
        }
      },
      async set(key: string, value: unknown): Promise<void> {
        memory.set(key, value);
        try {
          await fetch(`${kvUrl}/set/${encodeURIComponent(key)}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${kvToken}`, 'content-type': 'application/json' },
            body: JSON.stringify(typeof value === 'string' ? value : JSON.stringify(value)),
          });
        } catch {
          /* abaikan */
        }
      },
      async delete(key: string): Promise<void> {
        memory.delete(key);
        try {
          await fetch(`${kvUrl}/del/${encodeURIComponent(key)}`, {
            headers: { Authorization: `Bearer ${kvToken}` },
          });
        } catch {
          /* abaikan */
        }
      },
      async list(prefix: string): Promise<string[]> {
        const set = new Set<string>();
        for (const k of memory.keys()) {
          if (k.startsWith(prefix)) set.add(k);
        }
        try {
          const res = await fetch(`${kvUrl}/keys/${encodeURIComponent(prefix)}*`, {
            headers: { Authorization: `Bearer ${kvToken}` },
          });
          const json = (await res.json()) as { result?: unknown[] };
          if (Array.isArray(json.result)) {
            for (const k of json.result) set.add(String(k));
          }
        } catch {
          /* abaikan */
        }
        return [...set];
      },
    };
  }

  // Fallback in-process
  return {
    async get<T>(key: string) {
      return (memory.get(key) as T) ?? null;
    },
    async set(key: string, value: unknown) {
      memory.set(key, value);
    },
    async delete(key: string) {
      memory.delete(key);
    },
    async list(prefix: string) {
      return [...memory.keys()].filter((k) => k.startsWith(prefix));
    },
  };
}

const limiter = createLimiter();

const env: ApiEnv = {
  accessCode: process.env.ACCESS_CODE || 'sdn1rejoso',
  adminPin: process.env.ADMIN_PIN || '123456',
  usingDefaults: !process.env.ACCESS_CODE || !process.env.ADMIN_PIN,
  fonnteToken: process.env.FONNTE_TOKEN,
  driveScriptUrl: process.env.GDRIVE_SCRIPT_URL,
  driveSecret: process.env.GDRIVE_SECRET,
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseKey: process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
};

const apiHandler = createApiHandler({
  kv: makeKv(),
  env,
  limiter,
  defaults: {
    config: initialConfig as Partial<AppConfig>,
    staff: initialStaff as Staff[],
    schedule: initialSchedule as Assignment[],
  },
});

async function readNodeBody(req: IncomingMessage): Promise<Uint8Array | undefined> {
  return new Promise((resolve) => {
    const raw = (req as unknown as { body?: unknown }).body;
    if (raw !== undefined && raw !== null) {
      if (typeof raw === 'string') return resolve(new TextEncoder().encode(raw));
      if (Buffer.isBuffer(raw)) return resolve(new Uint8Array(raw));
      return resolve(new TextEncoder().encode(JSON.stringify(raw)));
    }
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', () => resolve(chunks.length ? new Uint8Array(Buffer.concat(chunks)) : undefined));
    req.on('error', () => resolve(undefined));
  });
}

/** Handler Vercel: Kompatibel dengan Web Request (Edge) maupun Node IncomingMessage */
export default async function handler(
  req: Request | IncomingMessage,
  res?: ServerResponse
): Promise<Response | void> {
  // Jika Vercel memanggil dalam format Node.js Serverless (req: IncomingMessage, res: ServerResponse)
  if (res && typeof res.setHeader === 'function' && typeof res.end === 'function') {
    const nodeReq = req as IncomingMessage;
    const host = nodeReq.headers.host || 'localhost';
    const proto = (nodeReq.headers['x-forwarded-proto'] as string) || 'https';
    const url = new URL(nodeReq.url || '/api/piket', `${proto}://${host}`);

    const headers = new Headers();
    for (const [k, v] of Object.entries(nodeReq.headers)) {
      if (typeof v === 'string') headers.set(k, v);
      else if (Array.isArray(v)) headers.set(k, v.join(', '));
    }

    const method = (nodeReq.method || 'GET').toUpperCase();
    const body = ['GET', 'HEAD'].includes(method) ? undefined : await readNodeBody(nodeReq);

    const webReq = new Request(url.toString(), {
      method,
      headers,
      body: body as BodyInit | undefined,
    });

    const webRes = await apiHandler(webReq);
    res.statusCode = webRes.status;
    webRes.headers.forEach((v, k) => res.setHeader(k, v));
    const buf = Buffer.from(await webRes.arrayBuffer());
    res.end(buf);
    return;
  }

  // Jika Vercel memanggil dalam format Web Standard (Edge / Web Serverless)
  return apiHandler(req as Request);
}

