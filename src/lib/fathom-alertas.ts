/* ==================================================================
   Que no vuelva a pasar en silencio (26/10): durante semanas la tabla de
   grabaciones estuvo vacía y nadie lo supo hasta que Santi pidió bajar las
   transcripciones. Ahora, cuando algo impide que una llamada con link
   tenga su transcripción, la campanita se lo dice a quien puede arreglarlo:

   - Una grabación en privado (el closer la dejó «sin visibilidad de
     equipo»: ni un administrador de Fathom la ve, sólo quien la grabó):
     le avisa al closer de la llamada, con qué hacer, y al director y a los
     dueños un resumen por closer.
   - La conexión con Fathom que falla (clave vencida, Fathom caído) o un
     barrido que lleva días sin completarse: avisa a los dueños.

   Acá, lo que no toca la red ni la base, para poder probarlo.
   ================================================================== */

export interface LlamadaSinTranscripcion { id: string; inicia: string; anfitrion?: string | null; invitado?: string | null }

/** Cuánto se espera antes de decir que una grabación no llega: Fathom tarda un rato en procesarla y el closer pega el link al día siguiente. */
export const HORAS_PARA_AVISAR = 36;
/** Si el barrido completo lleva más que esto sin terminar, algo anda mal. */
export const HORAS_DE_BARRIDO_PARADO = 72;

export interface AvisoFila {
  id: string; para: string; tipo: "fathom"; titulo: string; cuerpo: string; de: string; contactoId: null; persona: null;
}

const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const corto = (s: string) => sinTildes(s).split(/\s+/).slice(0, 2).join(" ");
const dd = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/** Las que llevan más de 36 horas y siguen sin su transcripción. */
export const queNoLlegan = (pend: LlamadaSinTranscripcion[], ahora: number): LlamadaSinTranscripcion[] =>
  pend.filter((p) => Number.isFinite(Date.parse(p.inicia)) && ahora - Date.parse(p.inicia) >= HORAS_PARA_AVISAR * 3600_000);

/** Por closer (el nombre como figura en la llamada), de la más vieja a la más nueva. */
export function porCloser(pend: LlamadaSinTranscripcion[]): { closer: string; llamadas: LlamadaSinTranscripcion[] }[] {
  /* «Valentín Abadía» y «Valentin Abadia» son la misma persona (Calendly y Equipo no siempre escriben igual). */
  const m = new Map<string, { closer: string; llamadas: LlamadaSinTranscripcion[] }>();
  for (const p of pend) {
    const nombre = (p.anfitrion ?? "").trim() || "Sin closer";
    const k = corto(nombre);
    const g = m.get(k) ?? { closer: nombre, llamadas: [] };
    g.llamadas.push(p);
    m.set(k, g);
  }
  return [...m.values()].map(({ closer, llamadas }) => ({ closer, llamadas: llamadas.sort((a, b) => a.inicia.localeCompare(b.inicia)) }))
    .sort((a, b) => b.llamadas.length - a.llamadas.length);
}

const QUE_HACER = "Abrí el link de la grabación, tocá el menú de visibilidad que está debajo de «Share» y pasala a «Visible to Sales Only» o «All Teams». Y dejá «All Teams» por defecto en tus ajustes de Fathom, así las nuevas ya salen compartidas.";

export interface Destinatarios {
  /* El mail de cada closer por su nombre en Equipo. */
  closers: { nombre: string; email?: string | null }[];
  /* Quien se entera de todo: los dueños y el director. */
  supervisores: string[];
}

/** Los avisos de grabaciones que no llegan: uno por closer (por día) y un resumen para cada supervisor (por semana).
    `dia` es aaaammdd y `semana` identifica la semana (el mismo valor toda la semana). */
export function avisosDeGrabacionesPrivadas(
  pend: LlamadaSinTranscripcion[], d: Destinatarios, dia: string, semana: string, hash: (s: string) => string,
): AvisoFila[] {
  const grupos = porCloser(pend);
  if (grupos.length === 0) return [];
  const filas: AvisoFila[] = [];
  for (const g of grupos) {
    const m = d.closers.find((c) => corto(c.nombre) === corto(g.closer));
    const mail = m?.email?.trim().toLowerCase();
    if (!mail || !/@/.test(mail)) continue;
    const vieja = g.llamadas[0].inicia;
    filas.push({
      id: `av_fathom_closer_${dia}_${hash(mail)}`, para: mail, tipo: "fathom", de: "Fathom", contactoId: null, persona: null,
      titulo: `${plural(g.llamadas.length, "grabación de Fathom que la app no puede ver", "grabaciones de Fathom que la app no puede ver")}`,
      cuerpo: `Tenés ${plural(g.llamadas.length, "llamada", "llamadas")} con el link de Fathom pegado, pero en privado (la más vieja, del ${dd(vieja)}): sin eso no se puede bajar su transcripción para los reportes. ${QUE_HACER}`,
    });
  }
  /* Los 10 con más llamadas: con muchos closers el aviso no puede crecer sin límite (el resto, en Ajustes → Fathom). */
  const resumen = grupos.slice(0, 10).map((g) => `${g.closer.slice(0, 40)} ${g.llamadas.length}`).join(" · ") + (grupos.length > 10 ? ` · y ${grupos.length - 10} más` : "");
  const total = grupos.reduce((n, g) => n + g.llamadas.length, 0);
  for (const mail of [...new Set(d.supervisores.map((x) => x.trim().toLowerCase()).filter((x) => /@/.test(x)))]) {
    filas.push({
      id: `av_fathom_resumen_${semana}_${hash(mail)}`, para: mail, tipo: "fathom", de: "Fathom", contactoId: null, persona: null,
      titulo: `${plural(total, "grabación de Fathom privada", "grabaciones de Fathom privadas")}`,
      cuerpo: `La app no puede traer la transcripción de ${plural(total, "llamada", "llamadas")}: ${resumen}. Son grabaciones en privado: sólo quien las grabó puede compartirlas (los dueños las ven por closer en Ajustes → Integraciones → Fathom). A cada closer le llegó su aviso.`,
    });
  }
  return filas;
}

/** El aviso a los dueños cuando la conexión con Fathom falla, o el barrido lleva días sin completarse. Uno por motivo y por día. */
export function avisosDeConexion(
  motivo: { tipo: "error"; mensaje: string } | { tipo: "parado"; desde: string | null }, dueños: string[], dia: string, hash: (s: string) => string,
): AvisoFila[] {
  const titulo = motivo.tipo === "error" ? "Fathom dejó de traer las transcripciones" : "La búsqueda de transcripciones en Fathom lleva días sin terminar";
  const cuerpo = motivo.tipo === "error"
    ? `El último intento falló: ${motivo.mensaje.slice(0, 200)} Mientras no se arregle no entran grabaciones nuevas. Fijate en Ajustes → Integraciones → Fathom (la clave FATHOM_API_KEY vive en Vercel).`
    : `${motivo.desde ? `El último barrido completo fue el ${dd(motivo.desde)}.` : "Todavía no hay un barrido completo."} Probá «Traer las transcripciones ahora» en Ajustes → Integraciones → Fathom; si no avanza, avisale a quien mantiene la app.`;
  return [...new Set(dueños.map((x) => x.trim().toLowerCase()).filter((x) => /@/.test(x)))].map((mail) => ({
    id: `av_fathom_${motivo.tipo}_${dia}_${hash(mail)}`, para: mail, tipo: "fathom" as const, de: "Fathom", contactoId: null, persona: null, titulo, cuerpo,
  }));
}

/** El error que no se arregla solo: Fathom no acepta la clave (vencida, borrada o del usuario dado de baja). */
export const esErrorDeClave = (mensaje: string): boolean => /no aceptó la clave|FATHOM_API_KEY/i.test(mensaje);

/** Un barrido completo parado: hay llamadas esperando y el último completo es de hace más de 72 horas. Si todavía no hubo ninguno
    (recién instalado: el primero tarda un par de horas) no se avisa. */
export function barridoParado(ultimoCompleto: string | null, pendientes: number, ahora: number): boolean {
  const t = Date.parse(ultimoCompleto ?? "");
  return pendientes > 0 && Number.isFinite(t) && ahora - t > HORAS_DE_BARRIDO_PARADO * 3600_000;
}
