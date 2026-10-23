/* ==================================================================
   La asistencia a las clases de Zoom (Yari, 22/10): «para ver si una persona
   está activa o no en el servicio, a cuántas clases asistió». Con Google Meet
   no se podía medir; con Zoom sí: cada clase es una instancia de una reunión
   y Zoom dice quién entró, cuándo salió y cuántos minutos estuvo.

   Esto es la parte pura (sin red): cómo se leen los participantes de Zoom,
   cómo se juntan por persona y qué se cuenta. Lo que habla con Zoom está en
   lib/zoom-asistencia-servidor.ts.
   ================================================================== */

/** Un participante como lo devuelve Zoom (`/past_meetings/{uuid}/participants`). Quien se va y vuelve aparece varias veces. */
export interface ParticipanteZoom {
  name?: string; user_email?: string; join_time?: string; leave_time?: string;
  /* En segundos. */
  duration?: number;
}

/** Una persona en una clase: todas sus entradas de esa clase juntas. */
export interface AsistenciaZoom {
  id: string;
  reunion: string;
  instancia: string;
  tema: string;
  inicio: string;
  email: string;
  nombre: string;
  entro: string | null;
  salio: string | null;
  minutos: number;
}

/** Una clase ya traída (aunque nadie de los nuestros haya entrado): sirve para decir «asistió a 3 de 8». */
export interface ClaseZoom {
  instancia: string;
  reunion: string;
  tema: string;
  inicio: string;
  participantes: number;
  traidoEn?: string;
}

const clave = (s: string) => s.trim().toLowerCase();

/** El id de una asistencia: la clase y la persona. Traer dos veces la misma clase no la repite. */
export const idDeAsistencia = (instancia: string, email: string) =>
  `zoom_${instancia}_${clave(email)}`.replace(/[^\w@.-]/g, "_").slice(0, 200);

/** El uuid de una clase para ponerlo en la dirección. Zoom pide codificarlo dos veces cuando empieza con «/» o trae «//». */
export function uuidEnLaDireccion(uuid: string): string {
  return uuid.startsWith("/") || uuid.includes("//") ? encodeURIComponent(encodeURIComponent(uuid)) : encodeURIComponent(uuid);
}

/** Los participantes de una clase, una fila por persona (por su mail): los minutos se suman, y entra el primero y sale el último.
 *  Sin mail (alguien que entró sin registrarse) no se puede atar a un alumno: no se guarda, pero cuenta en `participantes` de la clase. */
export function agruparParticipantes(
  clase: { reunion: string; instancia: string; tema: string; inicio: string },
  participantes: readonly ParticipanteZoom[],
): AsistenciaZoom[] {
  const porMail = new Map<string, AsistenciaZoom>();
  for (const p of participantes) {
    const email = clave(p.user_email ?? "");
    if (!email.includes("@")) continue;
    const previo = porMail.get(email);
    const entro = p.join_time ?? null, salio = p.leave_time ?? null;
    const minutos = Math.max(0, Number(p.duration) || 0) / 60;
    if (!previo) {
      porMail.set(email, { id: idDeAsistencia(clase.instancia, email), ...clase, email, nombre: (p.name ?? "").trim(), entro, salio, minutos });
      continue;
    }
    previo.minutos += minutos;
    if (entro && (!previo.entro || entro < previo.entro)) previo.entro = entro;
    if (salio && (!previo.salio || salio > previo.salio)) previo.salio = salio;
    if (!previo.nombre && p.name) previo.nombre = p.name.trim();
  }
  return [...porMail.values()].map((x) => ({ ...x, minutos: Math.round(x.minutos * 10) / 10 }));
}

const HORA = 3_600_000;
const DIA = 24 * HORA;

/** Qué clases hay que (volver a) traer. Una clase recién terminada puede tener la lista incompleta: se vuelve a pedir hasta un día
 *  después, una vez cada tres horas. Una clase vieja se trae una sola vez. Las que todavía están en curso (empezaron hace menos de
 *  dos horas) esperan. */
export function clasesParaTraer(
  instancias: readonly { uuid: string; start_time: string }[],
  yaTraidas: ReadonlyMap<string, { traidoEn?: string }>,
  ahora: number,
  { dias = 30 }: { dias?: number } = {},
): { uuid: string; start_time: string }[] {
  return instancias.filter((i) => {
    const inicio = +new Date(i.start_time);
    if (!Number.isFinite(inicio) || ahora - inicio < 2 * HORA || ahora - inicio > dias * DIA) return false;
    const previa = yaTraidas.get(i.uuid);
    if (!previa) return true;
    const traido = previa.traidoEn ? +new Date(previa.traidoEn) : 0;
    return ahora - inicio < DIA + 2 * HORA && ahora - traido > 3 * HORA;
  });
}

/** Si Zoom dijo que a la app le falta un permiso, qué hay que hacer (en castellano); null si el error es otro. */
export const PERMISOS_DE_ZOOM = ["meeting:read:list_past_instances:admin", "meeting:read:list_past_participants:admin", "meeting:read:past_meeting:admin"];

export function avisoDePermisoZoom(status: number, json: Record<string, unknown> | null): string | null {
  const mensaje = typeof json?.message === "string" ? json.message : "";
  if ((status === 401 || status === 400 || status === 403) && /scope/i.test(mensaje)) {
    return `A la app de Zoom le faltan permisos para ver quién asistió. Agregá en Zoom Marketplace → tu app Server-to-Server → Scopes: ${PERMISOS_DE_ZOOM.join(", ")}; y volvé a activarla.`;
  }
  return null;
}

export interface ResumenAsistencia {
  /* A cuántas clases entró. */
  asistio: number;
  /* De cuántas clases hubo mientras tenía el acceso (o desde que se empezaron a traer). */
  deClases: number;
  minutos: number;
  /* Entró a al menos una en los últimos 14 días. */
  activo: boolean;
  /* Cada clase, con si fue o no (lo más nuevo arriba). */
  lista: { instancia: string; tema: string; inicio: string; fue: boolean; minutos: number }[];
}

/** Lo que se ve de un alumno: a cuántas clases fue de las que hubo desde `desde` (el día que empezó el servicio, si se sabe). */
export function resumirAsistencia(
  clases: readonly ClaseZoom[],
  asistencias: readonly Pick<AsistenciaZoom, "instancia" | "minutos">[],
  { desde, hoy = Date.now() }: { desde?: string; hoy?: number } = {},
): ResumenAsistencia {
  const piso = desde && /^\d{4}-\d{2}-\d{2}/.test(desde) ? desde.slice(0, 10) : "";
  const fue = new Map(asistencias.map((a) => [a.instancia, a.minutos] as const));
  /* Una clase a la que fue cuenta siempre, aunque sea anterior a la fecha de inicio que tenemos. */
  const lista = clases
    .filter((c) => !piso || c.inicio.slice(0, 10) >= piso || fue.has(c.instancia))
    .map((c) => ({ instancia: c.instancia, tema: c.tema, inicio: c.inicio, fue: fue.has(c.instancia), minutos: fue.get(c.instancia) ?? 0 }))
    .sort((a, b) => b.inicio.localeCompare(a.inicio));
  const fueron = lista.filter((x) => x.fue);
  return {
    asistio: fueron.length,
    deClases: lista.length,
    minutos: Math.round(fueron.reduce((a, x) => a + x.minutos, 0)),
    activo: fueron.some((x) => hoy - +new Date(x.inicio) < 14 * DIA),
    lista,
  };
}
