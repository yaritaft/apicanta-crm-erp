import { claveDe } from "./chat-equipo";
import type { FotoPerfil, MiembroEquipo } from "./types";

/* ==================================================================
   La foto de perfil de cada uno del equipo (pedido de Juan Cruz, 20/10:
   «que todos cuando entren tengan que ponerse foto, así en el chat se ve
   cheto y no random con letras»).

   Se guarda CHICA y ya recortada: un cuadrado de 192 px en JPEG (unos
   15–25 KB) como data URL en la tabla `fotos_perfil`. Así viene con el
   resto de los datos y se dibuja al toque en cualquier lado (el chat, las
   caras de un hilo, quién leyó), sin bucket ni URLs firmadas que vencen.
   ================================================================== */

export const LADO_FOTO = 192;
/** Lo más que puede pesar la data URL (la base lo frena igual: supabase/fotos-perfil.sql). */
export const TOPE_FOTO = 400_000;

/* «Cargarla después» (21/10): el cartel obligatorio deja seguir usando la app y vuelve al otro día. Se acuerda en el navegador
   (por persona, con el día en que se pospuso): sin nube ni tabla, y si el navegador no deja guardar, el cartel simplemente vuelve. */
const claveAplazada = (quien: string) => `apicanta:foto-despues:${quien}`;
function almacenLocal(): Pick<Storage, "getItem" | "setItem"> | null {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

/** ¿Ya dijo «después» hoy? `hoy` es el día del negocio (aaaa-mm-dd). */
export function fotoAplazadaHoy(quien: string, hoy: string, almacen: Pick<Storage, "getItem"> | null = almacenLocal()): boolean {
  if (!quien || !almacen) return false;
  try { return almacen.getItem(claveAplazada(quien)) === hoy; } catch { return false; }
}

export function aplazarFoto(quien: string, hoy: string, almacen: Pick<Storage, "setItem"> | null = almacenLocal()): void {
  if (!quien || !almacen) return;
  try { almacen.setItem(claveAplazada(quien), hoy); } catch { /* modo privado: el cartel vuelve en la próxima carga */ }
}

/** El mapa para buscar fotos: por clave (el mail o, sin nube, el nombre) y por nombre. */
export interface Fotos { porClave: Map<string, string>; porNombre: Map<string, string> }

export function mapaDeFotos(fotos: FotoPerfil[] | undefined, equipo: Pick<MiembroEquipo, "nombre" | "email">[] = []): Fotos {
  const porClave = new Map<string, string>();
  const porNombre = new Map<string, string>();
  for (const f of fotos ?? []) {
    if (!f.foto) continue;
    porClave.set(f.id.toLowerCase(), f.foto);
    if (f.nombre) porNombre.set(f.nombre.trim().toLowerCase(), f.foto);
  }
  /* Un mensaje viejo sin mail: su nombre, por el mail que tiene en Equipo. */
  for (const m of equipo) {
    const foto = m.email ? porClave.get(m.email.toLowerCase()) : undefined;
    if (foto && m.nombre && !porNombre.has(m.nombre.trim().toLowerCase())) porNombre.set(m.nombre.trim().toLowerCase(), foto);
  }
  return { porClave, porNombre };
}

/** La foto de alguien: por su mail (o su clave) y, si no, por su nombre. undefined = va con sus iniciales. */
export function fotoDe(f: Fotos, email: string | null | undefined, nombre: string): string | undefined {
  return f.porClave.get(claveDe(email, nombre)) ?? (email ? f.porClave.get(email.toLowerCase()) : undefined) ?? f.porNombre.get(nombre.trim().toLowerCase());
}

/**
 * Recorta la foto al cuadrado del medio y la achica a `lado` px, en JPEG. Si el navegador no la puede leer (un .heic del
 * iPhone en Chrome, por ejemplo) dice qué hacer.
 */
export async function fotoCuadrada(archivo: Blob, lado = LADO_FOTO): Promise<string> {
  if (archivo.type && !archivo.type.startsWith("image/")) throw new Error("Eso no es una foto: elegí una imagen (JPG o PNG).");
  const url = URL.createObjectURL(archivo);
  try {
    const img = await new Promise<HTMLImageElement>((ok, mal) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => mal(new Error("Esa foto no se puede leer en este navegador. Probá con una JPG o PNG (en el iPhone, una captura de pantalla de la foto sirve)."));
      i.src = url;
    });
    const s = Math.min(img.naturalWidth, img.naturalHeight);
    if (!s) throw new Error("La foto está vacía.");
    const c = document.createElement("canvas");
    c.width = lado; c.height = lado;
    const g = c.getContext("2d");
    if (!g) throw new Error("Este navegador no puede preparar la foto.");
    g.imageSmoothingQuality = "high";
    g.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, lado, lado);
    let calidad = 0.86, datos = c.toDataURL("image/jpeg", calidad);
    while (datos.length > TOPE_FOTO && calidad > 0.4) { calidad -= 0.12; datos = c.toDataURL("image/jpeg", calidad); }
    return datos;
  } finally {
    URL.revokeObjectURL(url);
  }
}
