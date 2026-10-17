/* Corre las pruebas «a otra hora»: con FAKE_NOW=2026-10-16T22:30:00-03:00 el reloj de las pruebas (Date.now() y
   new Date()) arranca en ese instante y sigue corriendo. Sirve para encontrar lo que sólo falla de noche, a fin de
   mes o con otro huso (TZ=UTC, TZ=Asia/Tokyo…):

     FAKE_NOW=2026-10-31T23:30:00-03:00 TZ=UTC node --import ./pruebas/registrar.mjs --import ./pruebas/reloj-falso.mjs --test "pruebas/**\/*.test.ts"
*/
const objetivo = process.env.FAKE_NOW ? Date.parse(process.env.FAKE_NOW) : NaN;
if (Number.isFinite(objetivo)) {
  const Real = Date;
  const desfase = objetivo - Real.now();
  const ahora = () => Real.now() + desfase;
  class Falso extends Real {
    constructor(...args) {
      if (args.length === 0) super(ahora());
      else super(...args);
    }
    static now() { return ahora(); }
  }
  globalThis.Date = Falso;
}
