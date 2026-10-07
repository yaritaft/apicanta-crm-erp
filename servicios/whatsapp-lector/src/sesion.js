import { chmodSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';

/* ==================================================================
   La sesión de WhatsApp.

   Es la carpeta `auth/`: las llaves con las que se leen todos los chats del
   número. Tiene que ser sólo del usuario del servicio (modo 700).

   Cuando WhatsApp cierra la sesión (se desvinculó el dispositivo desde el
   teléfono) esas llaves ya no sirven. En vez de pedirle a alguien que entre
   al servidor, el lector las aparta en `auth.vieja` y empieza una vinculación
   nueva: el código QR aparece en la app.
   ================================================================== */

/** La carpeta a la que va la sesión cerrada: `./auth` → `./auth.vieja`. */
export const carpetaVieja = (dir) => `${String(dir).replace(/[\\/]+$/, '')}.vieja`;

/** Crea la carpeta de la sesión (si no está) y la deja sólo para su dueño. Se llama antes de cada conexión, también
    después de apartar la vieja: Baileys la crearía con los permisos por defecto (755 y archivos 644), legibles por
    cualquier usuario del servidor. */
export async function prepararCarpetaDeSesion(dir) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { chmodSync(dir, 0o700); } catch { /* no es nuestra: el UMask=0077 de la unidad cubre lo que se cree adentro */ }
}

/** Aparta la sesión: `auth` pasa a `auth.vieja` (la que hubiera de antes se descarta: estaba cerrada también). */
export async function moverSesionVieja(dir) {
  const vieja = carpetaVieja(dir);
  if (existsSync(vieja)) rmSync(vieja, { recursive: true, force: true });
  if (existsSync(dir)) renameSync(dir, vieja);
  return vieja;
}
