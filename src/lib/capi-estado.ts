/* ==================================================================
   ¿Está lista la Conversions API de Meta? Lo que le falta al servidor
   para mandar eventos, dicho en claro para Ajustes → Integraciones.

   Es lógica pura sobre un objeto de variables de entorno (la de Vercel
   en producción; en las pruebas, uno armado a mano). Nunca devuelve los
   valores: sólo si están o no, para poder mostrarlo sin filtrar claves.

   Variables:
     META_PIXEL_ID          el píxel (dataset) al que van los eventos      OBLIGATORIA
     META_CAPI_TOKEN        el token de la Conversions API del píxel       OBLIGATORIA
                            (Events Manager → Configuración → Generar
                            token). Si falta, se usa META_SYSTEM_TOKEN,
                            que a veces no tiene el permiso.
     REGISTRO_ORIGENES      los dominios de la landing que pueden mandar   RECOMENDADA
                            registros, separados por coma
     META_CAPI_TEST         el código de «Probar eventos» (los eventos     opcional
                            se ven ahí y no cuentan; sacarlo al terminar)
     META_CAPI_URL          la página de la landing, para los eventos que  opcional
                            no pasaron en una página (agendas y ventas)
     META_CAPI_EVENTO_CALIFICADO  cómo se llama el evento del registro     opcional
                            calificado en Meta (por defecto, RegistroCalificado)
   ================================================================== */

export type Entorno = Record<string, string | undefined>;

export interface EstadoCapi {
  /* Hay píxel y token: la app manda eventos. */
  lista: boolean;
  pixel: boolean;
  /* De dónde sale el token: el propio de la Conversions API, el del sistema
     de Meta Ads (que puede no tener el permiso) o ninguno. */
  token: "capi" | "sistema" | null;
  /* Los eventos van a «Probar eventos» y no cuentan. */
  prueba: boolean;
  /* Los dominios que pueden mandar registros; vacío = cualquiera. */
  origenes: string[];
  /* El nombre del evento del registro calificado. */
  eventoCalificado: string;
  /* Lo que hay que cargar en Vercel, con su motivo. */
  faltan: { variable: string; para: string; obligatoria: boolean }[];
}

const lleno = (v?: string) => Boolean(v?.trim());

/** El nombre del evento en Meta; se puede cambiar con META_CAPI_EVENTO_CALIFICADO. */
export const EVENTO_CALIFICADO = "RegistroCalificado";

export function nombreEventoCalificado(env: Entorno = process.env): string {
  const n = env.META_CAPI_EVENTO_CALIFICADO?.trim() ?? "";
  /* Meta acepta letras, números y guion bajo. */
  return /^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(n) ? n : EVENTO_CALIFICADO;
}

export function origenesPermitidos(env: Entorno): string[] {
  return (env.REGISTRO_ORIGENES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

export function estadoCapi(env: Entorno = process.env): EstadoCapi {
  const pixel = lleno(env.META_PIXEL_ID);
  const token = lleno(env.META_CAPI_TOKEN) ? "capi" : lleno(env.META_SYSTEM_TOKEN) ? "sistema" : null;
  const origenes = origenesPermitidos(env);
  const faltan: EstadoCapi["faltan"] = [];
  if (!pixel) faltan.push({ variable: "META_PIXEL_ID", para: "el número del píxel de la landing (Events Manager → Orígenes de datos)", obligatoria: true });
  if (!lleno(env.META_CAPI_TOKEN)) {
    faltan.push({
      variable: "META_CAPI_TOKEN",
      para: token === "sistema"
        ? "el token de la Conversions API del píxel; mientras tanto se usa el de Meta Ads, que puede no tener el permiso"
        : "el token de la Conversions API (Events Manager → el píxel → Configuración → Generar token de acceso)",
      obligatoria: token === null,
    });
  }
  if (origenes.length === 0) {
    faltan.push({ variable: "REGISTRO_ORIGENES", para: "los dominios de tu landing, para que sólo ellos puedan mandar registros", obligatoria: false });
  }
  return {
    lista: pixel && token !== null,
    pixel, token,
    prueba: lleno(env.META_CAPI_TEST),
    origenes,
    eventoCalificado: nombreEventoCalificado(env),
    faltan,
  };
}
