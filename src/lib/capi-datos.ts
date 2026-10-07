import { createHash } from "node:crypto";
import { normalizarPais, SIN_PAIS, OTRO_PAIS } from "./paises";

/* ==================================================================
   Los datos de la persona para la Conversions API de Meta: cómo se
   normalizan y se hashean. Es lógica pura (sin variables de entorno ni
   red), así se prueba sola (pruebas/capi-meta.test.ts).

   Meta pide que mail, teléfono, nombre, apellido, país y el id propio
   viajen hasheados con SHA-256 y NORMALIZADOS ANTES de hashear: la misma
   persona tiene que dar el mismo hash que en el lado de Meta, o el evento
   no se asocia a nadie.

   - Mail: sin espacios y en minúsculas.
   - Teléfono: sólo dígitos, con el código del país y sin ceros de más
     (ni el «+» ni el «00»).
   - Nombre y apellido: minúsculas, sin tildes ni signos.
   - País: el código ISO de dos letras, en minúsculas.
   La IP, el user agent y las cookies _fbp y _fbc van SIN hashear.
   ================================================================== */

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** El mail normalizado; vacío si no parece un mail. */
export function normalizarEmail(s?: string | null): string {
  const e = (s ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) ? e : "";
}

/* El código de llamada de los países donde hay gente: cuando el teléfono se
   cargó sin él (un número nacional) se le agrega según el país de la persona. */
const CODIGO_DE_PAIS: Record<string, string> = {
  AR: "54", UY: "598", PY: "595", BO: "591", CL: "56", PE: "51", EC: "593", CO: "57", VE: "58",
  MX: "52", BR: "55", CR: "506", PA: "507", GT: "502", HN: "504", SV: "503", NI: "505",
  ES: "34", US: "1", CA: "1", DO: "1", PR: "1",
};

/** El teléfono como lo pide Meta: sólo dígitos y con el código de país. Sin
 *  el código (un número nacional), se lo pone según `pais` si se sabe.
 *  Vacío si no parece un teléfono (menos de 8 o más de 15 dígitos). */
export function normalizarTelefono(s?: string | null, pais?: string | null): string {
  const crudo = (s ?? "").trim();
  if (!crudo) return "";
  const internacional = /^(\+|00)/.test(crudo);
  let d = crudo.replace(/\D+/g, "");
  if (crudo.startsWith("00")) d = d.replace(/^00/, "");
  /* El cero de marcar una llamada nacional («011 …») no es parte del número. */
  d = d.replace(/^0+/, "");
  if (!internacional) {
    const iso = normalizarPais(pais ?? "");
    const codigo = iso !== SIN_PAIS && iso !== OTRO_PAIS ? CODIGO_DE_PAIS[iso] : undefined;
    /* Un número nacional ronda los 10 dígitos o menos: más largo, ya trae el código. */
    if (codigo && d.length <= 10 && !d.startsWith(codigo)) d = codigo + d;
  }
  return d.length >= 8 && d.length <= 15 ? d : "";
}

/** Nombre y apellido normalizados: el primer nombre y el último apellido. */
export function normalizarNombre(s?: string | null): { nombre: string; apellido: string } {
  const partes = (s ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z\s'-]/g, " ").split(/\s+/).filter(Boolean);
  const [nombre = "", ...resto] = partes;
  return { nombre, apellido: resto.length ? resto[resto.length - 1] : "" };
}

/** El país como código ISO de dos letras en minúsculas; vacío si no se reconoce. */
export function paisParaMeta(s?: string | null): string {
  const iso = normalizarPais(s ?? "");
  return iso === SIN_PAIS || iso === OTRO_PAIS ? "" : iso.toLowerCase();
}

export interface PersonaCapi {
  email?: string;
  telefono?: string;
  nombre?: string;
  pais?: string;       // el país como se cargó (nombre o código)
  externalId?: string; // el id del contacto en Apicanta
  ip?: string;
  userAgent?: string;
  fbp?: string;        // cookie _fbp de la landing
  fbc?: string;        // cookie _fbc (o armada con el fbclid)
}

/** El `user_data` del evento: lo personal hasheado y lo técnico tal cual.
 *  Sólo lleva lo que se pudo armar: un teléfono inválido no va. */
export function datosDeLaPersona(p: PersonaCapi): Record<string, unknown> {
  const { nombre, apellido } = normalizarNombre(p.nombre);
  const email = normalizarEmail(p.email);
  const telefono = normalizarTelefono(p.telefono, p.pais);
  const pais = paisParaMeta(p.pais);
  const d: Record<string, unknown> = {};
  if (email) d.em = [sha256(email)];
  if (telefono) d.ph = [sha256(telefono)];
  if (nombre) d.fn = [sha256(nombre)];
  if (apellido) d.ln = [sha256(apellido)];
  if (pais) d.country = [sha256(pais)];
  if (p.externalId?.trim()) d.external_id = [sha256(p.externalId.trim())];
  if (p.ip?.trim()) d.client_ip_address = p.ip.trim();
  if (p.userAgent?.trim()) d.client_user_agent = p.userAgent.trim();
  if (p.fbp?.trim()) d.fbp = p.fbp.trim();
  if (p.fbc?.trim()) d.fbc = p.fbc.trim();
  return d;
}
