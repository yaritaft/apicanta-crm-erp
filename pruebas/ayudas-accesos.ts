import type { SupabaseClient } from "@supabase/supabase-js";

/* Una base en memoria y un Wisboo/Telegram de mentira para probar darAccesos y las pasadas sin red (los usan downsells-y-cortes y upgrade-y-extension). */

export type Fila = Record<string, unknown>;

export function baseEnMemoria(inicial: Record<string, Fila[]> = {}) {
  const tablas: Record<string, Fila[]> = { ...inicial };
  const escritos: { tabla: string; tipo: string; filas: Fila[] }[] = [];
  const from = (tabla: string) => {
    const todas = (tablas[tabla] ??= []);
    let sel = [...todas];
    let cambios: Fila | null = null;
    const q: Record<string, unknown> = {
      select: () => q,
      eq: (c: string, v: unknown) => { sel = sel.filter((f) => f[c] === v); return q; },
      in: (c: string, vs: unknown[]) => { sel = sel.filter((f) => vs.includes(f[c])); return q; },
      not: (c: string, _op: string, v: unknown) => { sel = sel.filter((f) => (v === null ? f[c] !== null && f[c] !== undefined : f[c] !== v)); return q; },
      lte: (c: string, v: string) => { sel = sel.filter((f) => String(f[c]) <= v); return q; },
      or: () => q,
      order: () => q,
      limit: (n: number) => { sel = sel.slice(0, n); return q; },
      update: (c: Fila) => { cambios = c; return q; },
      upsert: async (v: Fila | Fila[]) => {
        const filas = Array.isArray(v) ? v : [v];
        for (const r of filas) {
          const i = todas.findIndex((f) => f.id === r.id);
          if (i >= 0) {
            if (!(r as { ignoreDuplicates?: boolean }).ignoreDuplicates) todas[i] = { ...todas[i], ...r };
          } else todas.push({ ...r });
        }
        escritos.push({ tabla, tipo: "upsert", filas });
        return { error: null };
      },
      insert: async (v: Fila | Fila[]) => { const filas = Array.isArray(v) ? v : [v]; todas.push(...filas.map((f) => ({ ...f }))); escritos.push({ tabla, tipo: "insert", filas }); return { error: null }; },
      maybeSingle: async () => ({ data: sel[0] ?? null, error: null }),
      then: (ok: (r: { data: Fila[]; error: null }) => unknown) => {
        if (cambios) { for (const f of sel) Object.assign(f, cambios); escritos.push({ tabla, tipo: "update", filas: sel.map((f) => ({ ...f })) }); }
        return Promise.resolve(ok({ data: sel, error: null }));
      },
    };
    return q;
  };
  return { db: { from } as unknown as SupabaseClient, tablas, escritos };
}

export async function conServiciosFalsos<T>(correr: () => Promise<T>): Promise<T> {
  const antes = { fetch: globalThis.fetch, w: process.env.WISBOO_API_KEY, s: process.env.WISBOO_STORE_ID, t: process.env.TELEGRAM_BOT_TOKEN };
  process.env.WISBOO_API_KEY = "x"; process.env.WISBOO_STORE_ID = "tienda"; process.env.TELEGRAM_BOT_TOKEN = "bot";
  let n = 0;
  globalThis.fetch = (async (entrada: string | URL, init?: RequestInit) => {
    const url = new URL(String(entrada));
    const json = (status: number, cuerpo: unknown) => new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json" } });
    if (url.hostname === "api.telegram.org") {
      if (url.pathname.endsWith("/createChatInviteLink")) return json(200, { ok: true, result: { invite_link: `https://t.me/+${++n}` } });
      return json(200, { ok: true, result: {} });
    }
    if (url.pathname.endsWith("/users") && init?.method === "POST") return json(201, { id: "usr_1" });
    if (url.pathname.endsWith("/product_accesses") && init?.method === "POST") return json(200, { id: `pa_${++n}` });
    if (url.pathname.endsWith("/magic_links")) return json(200, { link: "https://w/entrar" });
    return json(200, {});
  }) as typeof fetch;
  try { return await correr(); }
  finally {
    globalThis.fetch = antes.fetch;
    for (const [k, v] of [["WISBOO_API_KEY", antes.w], ["WISBOO_STORE_ID", antes.s], ["TELEGRAM_BOT_TOKEN", antes.t]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

