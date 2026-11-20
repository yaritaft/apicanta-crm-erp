import { claveInternacional, clavePropiaDeTelefono, colaDeClave, colasDeTelefono } from "./telefonos-wpp";

/* ==================================================================
   Quién es quién en Telegram (Manu, 20/11): cómo se sabe que una cuenta
   de Telegram es de tal alumno, para poder sacarla de los grupos cuando
   termina su programa.

   Telegram no deja buscar a nadie por su teléfono y mucha gente se pone
   otro nombre. El bot lo resuelve de tres maneras (lib/telegram-identidades-
   servidor.ts): lo ve en los grupos, se lo dice la propia persona (entra con
   su link personal, o toca el link del bot y comparte su número, que
   Telegram verifica) o lo ata alguien del equipo con las sugerencias de
   este archivo.

   Puro (sin red ni base): lo usan el servidor, la pantalla y las pruebas.
   ================================================================== */

export type VinculoTelegram = "link" | "codigo" | "telefono" | "manual";
export type EntroPor = "link" | "otro" | "mensaje" | "bot";
export interface PosibleTelegram { alumnoId: string; motivo: "varios" | "ultimos-digitos" }

/** Una cuenta de Telegram vista por el bot (la fila de `telegram_personas`). */
export interface PersonaTelegram {
  id: string;
  usuario: string | null;
  nombre: string;
  telefono: string | null;
  alumnoId: string | null;
  vinculo: VinculoTelegram | null;
  posibles: PosibleTelegram[];
  /** Los grupos donde se la vio adentro: chatId → cuándo. */
  grupos: Record<string, string>;
  entroPor: EntroPor | null;
  equipo: boolean;
  primerVisto: string;
  ultimoVisto: string;
  vinculadoEn: string | null;
  vinculadoPor: string | null;
}

export const VINCULO_TEXTO: Record<VinculoTelegram, string> = {
  link: "entró con su link personal",
  codigo: "tocó su link del bot",
  telefono: "compartió su número",
  manual: "lo ató una persona del equipo",
};

/* ---------- Nombres ---------- */

/** El nombre y apellido tal como los muestra Telegram. */
export function nombreEnTelegram(u: { first_name?: string; last_name?: string } | null | undefined): string {
  return [u?.first_name, u?.last_name].map((x) => (x ?? "").trim()).filter(Boolean).join(" ");
}

/** Cómo se muestra una cuenta: «Nombre (@usuario)», o lo que haya. */
export function etiquetaDePersona(p: Pick<PersonaTelegram, "nombre" | "usuario" | "id">): string {
  const nombre = p.nombre.trim();
  return nombre && p.usuario ? `${nombre} (@${p.usuario})` : nombre || (p.usuario ? `@${p.usuario}` : `Cuenta ${p.id}`);
}

const MUDAS = new Set(["de", "del", "la", "las", "los", "el", "y", "e", "da", "do", "dos", "van", "von", "di", "san"]);

/** Sin mayúsculas, tildes, emojis ni signos. */
export function sinAdornos(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9ñ\s]/g, " ").replace(/\s+/g, " ").trim();
}

/** Las palabras que sirven para comparar un nombre. */
export function palabrasDeNombre(s: string | null | undefined): string[] {
  return sinAdornos(s ?? "").split(" ").filter((p) => p.length >= 2 && !MUDAS.has(p));
}

/** Qué tan parecido es lo que muestra Telegram al nombre de un alumno (0 a 1). Mira cada palabra del alumno contra las
    del nombre de Telegram y su @usuario: igual vale 1, empezar igual («Juan» y «Juancho») vale 0,7, y estar adentro del
    @usuario («juanperez88») vale 0,8. El apellido pesa igual que el nombre: coincidir sólo en «Juan» no alcanza. */
export function parecidoDeNombres(telegram: { nombre: string; usuario?: string | null }, alumno: string): number {
  const suyas = palabrasDeNombre(alumno);
  if (suyas.length === 0) return 0;
  const lasDeTelegram = palabrasDeNombre(telegram.nombre);
  const usuario = sinAdornos(telegram.usuario ?? "").replace(/\s/g, "");
  let suma = 0;
  for (const p of suyas) {
    let mejor = 0;
    for (const t of lasDeTelegram) {
      if (t === p) mejor = Math.max(mejor, 1);
      else if (Math.min(t.length, p.length) >= 3 && (t.startsWith(p) || p.startsWith(t))) mejor = Math.max(mejor, 0.7);
    }
    if (mejor < 0.8 && usuario && p.length >= 4 && usuario.includes(p)) mejor = Math.max(mejor, 0.8);
    suma += mejor;
  }
  return Math.round((suma / suyas.length) * 100) / 100;
}

/** El mínimo para sugerirlo. */
export const PARECIDO_MINIMO = 0.5;

/** Los alumnos que más se parecen a una cuenta de Telegram, de mayor a menor parecido. */
export function sugerirAlumnos<T extends { nombre: string }>(
  telegram: { nombre: string; usuario?: string | null }, alumnos: readonly T[], cuantos = 5,
): { alumno: T; parecido: number }[] {
  return alumnos
    .map((alumno) => ({ alumno, parecido: parecidoDeNombres(telegram, alumno.nombre) }))
    .filter((x) => x.parecido >= PARECIDO_MINIMO)
    .sort((a, b) => b.parecido - a.parecido || a.alumno.nombre.localeCompare(b.alumno.nombre))
    .slice(0, cuantos);
}

/** Las cuentas que más se parecen a un alumno: las sueltas (sin alumno), de mayor a menor parecido. */
export function sugerirCuentas(alumno: string, cuentas: readonly PersonaTelegram[], cuantas = 8): { persona: PersonaTelegram; parecido: number }[] {
  return cuentas
    .map((persona) => ({ persona, parecido: parecidoDeNombres(persona, alumno) }))
    .filter((x) => x.parecido >= PARECIDO_MINIMO)
    .sort((a, b) => b.parecido - a.parecido || a.persona.nombre.localeCompare(b.persona.nombre))
    .slice(0, cuantas);
}

/* ---------- Teléfonos ---------- */

/** Un alumno con sus teléfonos ya normalizados, para cruzarlos con el número que comparte alguien en el bot. */
export interface TelefonosDeAlumno { alumnoId: string; nombre: string; estado: string; claves: string[]; colas: string[] }

/** La fila de `telefonos_de_alumnos()`. */
export interface FilaDeTelefonos { alumnoId: string; nombre: string; estado: string; pais: string; telefonos: string[] }

/** Las claves de un teléfono escrito en una ficha, para atar SOLA a una cuenta: una por número, la del país de la ficha (o la del «+»). Las
    otras que podría ser («11 5555 6666» sin país también es un número mexicano) no entran: sacar del grupo a la persona equivocada es peor
    que pedirle a alguien del equipo que lo mire; esas coincidencias llegan como «aproximadas». */
export function telefonosDeFila(f: FilaDeTelefonos): TelefonosDeAlumno {
  const claves: string[] = [];
  const colas: string[] = [];
  const sumar = (lista: string[], x: string | null | undefined) => { if (x && !lista.includes(x)) lista.push(x); };
  for (const t of f.telefonos ?? []) {
    for (const parte of String(t ?? "").split(/[\n/;,|]|\s+y\s+|\s+o\s+/i).map((x) => x.trim()).filter(Boolean)) {
      const clave = clavePropiaDeTelefono(parte, f.pais);
      sumar(claves, clave);
      if (clave) sumar(colas, colaDeClave(clave));
    }
    for (const c of colasDeTelefono(t)) sumar(colas, c);
  }
  return { alumnoId: f.alumnoId, nombre: f.nombre, estado: f.estado, claves, colas };
}

/** La clave de un número que Telegram entrega («5491155551234», con o sin +). null si no es un teléfono. */
export function claveDeContacto(telefono: string | null | undefined): string | null {
  const d = String(telefono ?? "").replace(/\D/g, "");
  return d ? claveInternacional(`+${d}`) : null;
}

/** Quiénes tienen ese número. `exactos`: es el mismo número (el que se ata solo). `aproximados`: coinciden sólo los
    últimos 8 dígitos (un código de país mal escrito, un dígito de menos): no se ata solo, lo decide una persona. */
export function buscarPorTelefono(telefono: string, alumnos: readonly TelefonosDeAlumno[]): { exactos: TelefonosDeAlumno[]; aproximados: TelefonosDeAlumno[] } {
  const clave = claveDeContacto(telefono);
  const cola = clave ? colaDeClave(clave) : String(telefono ?? "").replace(/\D/g, "").slice(-8);
  const exactos = clave ? alumnos.filter((a) => a.claves.includes(clave)) : [];
  const aproximados = cola.length === 8 ? alumnos.filter((a) => !exactos.includes(a) && a.colas.includes(cola)) : [];
  return { exactos, aproximados };
}

/** De varios alumnos con el mismo número (una persona cargada dos veces, o un teléfono compartido), el único que cursa hoy; si no, ninguno. */
export function elUnicoActivo(alumnos: readonly TelefonosDeAlumno[]): TelefonosDeAlumno | null {
  const activos = alumnos.filter((a) => a.estado === "activo");
  return activos.length === 1 ? activos[0] : null;
}

/* ---------- Los links del bot y lo que dice ---------- */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const PREFIJO_DE_CODIGO = "c_";

/** El link del bot. Con el código del alumno (el mismo del reporte semanal) lo reconoce con un solo toque; sin código, le pide el número. */
export function enlaceDelBot(usuarioDelBot: string, codigo?: string | null): string {
  const bot = usuarioDelBot.replace(/^@/, "");
  return `https://t.me/${bot}?start=${codigo && UUID.test(codigo) ? `${PREFIJO_DE_CODIGO}${codigo}` : "identificar"}`;
}

/** Lo que llega al bot cuando alguien le escribe «/start …». */
export function leerInicio(texto: string | null | undefined): { esInicio: boolean; codigo: string | null } {
  const m = /^\/start(?:@\w+)?(?:\s+(\S+))?\s*$/i.exec((texto ?? "").trim());
  if (!m) return { esInicio: false, codigo: null };
  const carga = m[1] ?? "";
  const codigo = carga.startsWith(PREFIJO_DE_CODIGO) ? carga.slice(PREFIJO_DE_CODIGO.length) : "";
  return { esInicio: true, codigo: UUID.test(codigo) ? codigo.toLowerCase() : null };
}

const primerNombre = (nombre: string | null | undefined) => {
  const n = (nombre ?? "").trim().split(/\s+/)[0] ?? "";
  return n ? `${n[0].toUpperCase()}${n.slice(1).toLowerCase()}` : "";
};

export const BOTON_COMPARTIR = "Compartir mi número";

export const TEXTOS_DEL_BOT = {
  pedirNumero: `Hola! Soy el bot de Apicanta. Para dejar tu acceso a los grupos al día, tocá el botón «${BOTON_COMPARTIR}» acá abajo. Lo usamos sólo para reconocerte entre los alumnos.`,
  yaEstaba: (nombre: string) => `${primerNombre(nombre) ? `${primerNombre(nombre)}, ` : ""}tu cuenta ya estaba verificada. No tenés que hacer nada más.`,
  listo: (nombre: string) => `Listo${primerNombre(nombre) ? `, ${primerNombre(nombre)}` : ""}! Tu cuenta de Telegram quedó verificada. No tenés que hacer nada más.`,
  codigoMalo: `Ese link no es válido. Pedile uno nuevo al equipo, o tocá el botón «${BOTON_COMPARTIR}» y te reconocemos con tu número.`,
  revisar: "Gracias! Recibí tu número, pero no pude asegurarme de a qué alumno corresponde. Lo revisa el equipo; no tenés que hacer nada más.",
  noEncontrado: "Gracias! Recibí tu número, pero no lo encuentro entre los alumnos. Si comprás con otro número o mail, avisale al equipo de soporte y lo dejamos al día.",
  contactoAjeno: `Ese contacto no es el tuyo. Tocá el botón «${BOTON_COMPARTIR}» para mandar el número de esta cuenta.`,
  sinTeclado: "Para verificar tu cuenta, tocá el botón «Compartir mi número» (si no lo ves, escribí /start).",
} as const;

export const TEXTO_DEL_ANUNCIO = "Para dejar tu acceso a Telegram al día, tocá el botón de abajo, abrí el bot y compartí tu número. Es un solo paso y tarda 10 segundos. Lo usamos sólo para reconocerte entre los alumnos.";
export const BOTON_DEL_ANUNCIO = "Verificar mi cuenta";

/** El mensaje para pegarle al alumno por WhatsApp: su link personal del bot. */
export function mensajeParaVerificar(a: { nombre?: string | null; enlace: string }): string {
  const n = primerNombre(a.nombre);
  return [
    `Hola${n ? ` ${n}` : ""}! Para dejar tu acceso a los grupos de Telegram al día, tocá este link y después «Iniciar»:`,
    a.enlace,
    "",
    "Es un solo toque y nos sirve para reconocerte en los grupos.",
  ].join("\n");
}
