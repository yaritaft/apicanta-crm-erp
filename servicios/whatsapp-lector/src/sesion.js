import { existsSync, renameSync, rmSync } from 'node:fs';

/* ==================================================================
   La sesión de WhatsApp vieja.

   Cuando WhatsApp cierra la sesión (se desvinculó el dispositivo desde el
   teléfono) las llaves guardadas en `auth/` ya no sirven. En vez de pedirle
   a alguien que entre al servidor, el lector las aparta en `auth.vieja` y
   empieza una vinculación nueva: el código QR aparece en la app.
   ================================================================== */

/** La carpeta a la que va la sesión cerrada: `./auth` → `./auth.vieja`. */
export const carpetaVieja = (dir) => `${String(dir).replace(/[\\/]+$/, '')}.vieja`;

/** Aparta la sesión: `auth` pasa a `auth.vieja` (la que hubiera de antes se descarta: estaba cerrada también). */
export async function moverSesionVieja(dir) {
  const vieja = carpetaVieja(dir);
  if (existsSync(vieja)) rmSync(vieja, { recursive: true, force: true });
  if (existsSync(dir)) renameSync(dir, vieja);
  return vieja;
}
