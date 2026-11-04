import { nube } from "./supabase";
import type { EstadoDeLaConexion, ResultadoDeLaCarga } from "./plaid-servidor";

/* ==================================================================
   La conexión con Bank of America desde el navegador: pide a nuestras rutas (/api/bofa/*) con la sesión de quien mira y abre la ventana de Plaid.
   Plaid Link se carga de su CDN (https://cdn.plaid.com/link/v2/stable/link-initialize.js), como pide su documentación. La clave del banco la escribe
   quien conecta DENTRO de esa ventana: no pasa por la app.
   ================================================================== */

export interface EstadoBofa {
  configurado: boolean;
  entorno: "production" | "sandbox";
  hayBase: boolean;
  conexion: EstadoDeLaConexion | null;
}

async function cabeceras(): Promise<Record<string, string>> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (nube) {
    const token = (await nube.auth.getSession()).data.session?.access_token;
    if (token) h.Authorization = `Bearer ${token}`;
  }
  return h;
}

async function pedir<T>(ruta: string, metodo: "GET" | "POST" | "PATCH" | "DELETE", cuerpo?: unknown): Promise<T> {
  let r: Response;
  try {
    r = await fetch(ruta, { method: metodo, headers: await cabeceras(), cache: "no-store", ...(cuerpo !== undefined ? { body: JSON.stringify(cuerpo) } : {}) });
  } catch {
    throw new Error("No hay conexión con el servidor.");
  }
  const datos = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (r.status === 401) throw new Error("Tu sesión venció. Volvé a entrar.");
  if (!r.ok) throw new Error(datos.error ?? "No se pudo completar el pedido.");
  return datos;
}

export const traerEstadoBofa = () => pedir<EstadoBofa>("/api/bofa/conexion", "GET");
export const cambiarCargaAutomatica = (autoCargar: boolean) => pedir<{ ok: true }>("/api/bofa/conexion", "PATCH", { autoCargar });
export const desconectarBofa = () => pedir<{ ok: true }>("/api/bofa/conexion", "DELETE");
export const traerGastosAhora = () => pedir<ResultadoDeLaCarga>("/api/bofa/cargar", "POST", {});

/* ---------- La ventana de Plaid ---------- */

const SCRIPT_DE_PLAID = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";

interface Manejador { open: () => void; exit: (o?: { force?: boolean }) => void; destroy: () => void }
interface PlaidGlobal { create: (c: { token: string; onSuccess: (publicToken: string, metadata: { institution?: { name?: string } | null }) => void; onExit: (error: { display_message?: string; error_message?: string } | null) => void }) => Manejador }

function cargarPlaid(): Promise<PlaidGlobal> {
  const ya = (window as unknown as { Plaid?: PlaidGlobal }).Plaid;
  if (ya) return Promise.resolve(ya);
  return new Promise((resolver, rechazar) => {
    const s = document.createElement("script");
    s.src = SCRIPT_DE_PLAID;
    s.async = true;
    s.onload = () => {
      const p = (window as unknown as { Plaid?: PlaidGlobal }).Plaid;
      if (p) resolver(p); else rechazar(new Error("No se pudo cargar la ventana de Plaid."));
    };
    s.onerror = () => rechazar(new Error("No se pudo cargar la ventana de Plaid: revisá la conexión o si un bloqueador de anuncios la frena."));
    document.head.appendChild(s);
  });
}

export type ResultadoDeConectar = { ok: true; conexion: EstadoDeLaConexion } | { ok: false; cancelado?: boolean; error?: string };

/** Pide el permiso a nuestro servidor, abre la ventana de Plaid y, cuando quien conecta termina, se lo da al servidor para que lo guarde. */
export async function conectarBofa(volver: boolean, quien?: string): Promise<ResultadoDeConectar> {
  try {
    const { linkToken } = await pedir<{ linkToken: string }>("/api/bofa/conectar", "POST", { volver, quien });
    const Plaid = await cargarPlaid();
    return await new Promise<ResultadoDeConectar>((resolver) => {
      const manejador = Plaid.create({
        token: linkToken,
        onSuccess: (publicToken, metadata) => {
          pedir<{ conexion: EstadoDeLaConexion }>("/api/bofa/intercambiar", "POST", { public_token: publicToken, institucion: metadata.institution?.name ?? "" })
            .then((r) => resolver({ ok: true, conexion: r.conexion }))
            .catch((err: unknown) => resolver({ ok: false, error: err instanceof Error ? err.message : "No pude guardar la conexión." }))
            .finally(() => manejador.destroy());
        },
        onExit: (error) => {
          resolver(error ? { ok: false, error: error.display_message || error.error_message || "Plaid no pudo conectar el banco." } : { ok: false, cancelado: true });
          manejador.destroy();
        },
      });
      manejador.open();
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "No pude abrir la conexión con Plaid." };
  }
}
