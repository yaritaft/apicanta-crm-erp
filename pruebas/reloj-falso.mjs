/* Corre las pruebas «a otra hora»: con FAKE_NOW=2026-10-16T22:30:00-03:00 el reloj de las pruebas (Date.now() y
   new Date()) arranca en ese instante y sigue corriendo. Sirve para encontrar lo que sólo falla de noche, a fin de
   mes o con otro huso (TZ=UTC, TZ=Asia/Tokyo…):

     FAKE_NOW=2026-10-31T23:30:00-03:00 TZ=UTC node --import ./pruebas/registrar.mjs --import ./pruebas/reloj-falso.mjs --test "pruebas/**\/*.test.ts"

   Va DESPUÉS de registrar.mjs (que instala la hora de Argentina): alcanza con mover Date.now(), porque el Date de la hora de
   Argentina arma `new Date()` con Date.now(). */
const objetivo = process.env.FAKE_NOW ? Date.parse(process.env.FAKE_NOW) : NaN;
if (Number.isFinite(objetivo)) {
  const real = Date.now.bind(Date);
  const desfase = objetivo - real();
  Date.now = () => real() + desfase;
}
