import { getStore } from '@netlify/blobs';
import type { Config, Context } from '@netlify/functions';
import { createApiHandler, createLimiter } from '../../shared/api-core.ts';
import type { ApiEnv, Kv, Limiter } from '../../shared/api-core.ts';
import { createSupabaseKv } from '../../shared/supabase.ts';
import type { Assignment, Config as AppConfig, Staff } from '../../shared/types.ts';
import initialConfig from '../../src/data/initialConfig.json';
import initialSchedule from '../../src/data/initialSchedule.json';
import initialStaff from '../../src/data/initialStaff.json';

/**
 * API piket gerbang (Netlify Function v2) - penyimpanan: Netlify Blobs.
 *
 * Environment variable (Netlify UI > Site configuration > Environment variables):
 *   ACCESS_CODE        kode akses guru piket (min. 6 karakter, bawaan: sdn1rejoso)
 *   ADMIN_PIN          PIN admin (min. 6 karakter, bawaan: 123456)
 *   FONNTE_TOKEN       (opsional) token WhatsApp Fonnte
 *   GDRIVE_SCRIPT_URL  (opsional) URL Web App Google Apps Script sekolah
 *   GDRIVE_SECRET      (opsional) kunci rahasia yang sama dengan di skrip
 */

function makeKv(storeName: string): Kv {
  let store: ReturnType<typeof getStore> | null = null;
  const memoryFallback = new Map<string, unknown>();

  try {
    store = getStore({ name: storeName, consistency: 'strong' });
  } catch (err) {
    console.warn('[blobs] initialization error, using memory fallback:', err);
  }

  return {
    async get<T>(key: string) {
      if (store) {
        try {
          const val = await store.get(key, { type: 'json' });
          if (val !== null && val !== undefined) return val as T;
        } catch (err) {
          console.warn(`[blobs] get("${key}") failed:`, err);
        }
      }
      return (memoryFallback.get(key) as T) ?? null;
    },
    async set(key, value) {
      memoryFallback.set(key, value);
      if (store) {
        try {
          await store.setJSON(key, value as object);
        } catch (err) {
          console.warn(`[blobs] setJSON("${key}") failed:`, err);
        }
      }
    },
    async delete(key) {
      memoryFallback.delete(key);
      if (store) {
        try {
          await store.delete(key);
        } catch (err) {
          console.warn(`[blobs] delete("${key}") failed:`, err);
        }
      }
    },
    async list(prefix) {
      const keys = new Set<string>();
      for (const k of memoryFallback.keys()) {
        if (k.startsWith(prefix)) keys.add(k);
      }
      if (store) {
        try {
          const { blobs } = await store.list({ prefix });
          for (const b of blobs) keys.add(b.key);
        } catch (err) {
          console.warn(`[blobs] list("${prefix}") failed:`, err);
        }
      }
      return [...keys];
    },
  };
}

const limiter: Limiter = createLimiter();
const handlers = new Map<string, (req: Request) => Promise<Response>>();

const DEFAULT_ACCESS = 'sdn1rejoso';
const DEFAULT_PIN = '123456';

export default async (req: Request, context: Context): Promise<Response> => {
  // Deploy preview/branch memakai store terpisah agar tidak menyentuh data produksi.
  const deployContext = context?.deploy?.context || 'production';
  const storeName = deployContext === 'production' ? 'piket' : `piket-${deployContext}`;

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  const env: ApiEnv = {
    accessCode: process.env.ACCESS_CODE || DEFAULT_ACCESS,
    adminPin: process.env.ADMIN_PIN || DEFAULT_PIN,
    usingDefaults: !process.env.ACCESS_CODE || !process.env.ADMIN_PIN,
    fonnteToken: process.env.FONNTE_TOKEN,
    driveScriptUrl: process.env.GDRIVE_SCRIPT_URL,
    driveSecret: process.env.GDRIVE_SECRET,
    supabaseUrl,
    supabaseKey,
  };

  const cacheKey = JSON.stringify([storeName, env]);
  let handler = handlers.get(cacheKey);
  if (!handler) {
    const baseKv = makeKv(storeName);
    const effectiveKv = supabaseUrl && supabaseKey
      ? createSupabaseKv({ url: supabaseUrl, key: supabaseKey, fallbackKv: baseKv })
      : baseKv;

    handler = createApiHandler({
      kv: effectiveKv,
      env,
      limiter,
      defaults: {
        config: initialConfig as Partial<AppConfig>,
        staff: initialStaff as Staff[],
        schedule: initialSchedule as Assignment[],
      },
    });
    handlers.clear();
    handlers.set(cacheKey, handler);
  }
  return handler(req);
};

export const config: Config = {
  path: ['/api/piket', '/.netlify/functions/piket'],
  preferStatic: false,
};
