/* Cuánto cuesta, para un closer, escribir con los triggers de supabase/solo-lo-suyo-seguro.sql (PGlite, en memoria, con muchos leads).

   No es una prueba (no termina en .test.ts): se corre a mano y imprime milisegundos.

     L=6000 PGLITE_DIR=/ruta/a/node_modules/@electric-sql/pglite node --import ./pruebas/registrar.mjs pruebas/sql/costo-solo-lo-suyo.ensayo.ts

   Para comparar con otra versión del archivo (por ejemplo la primera, que armaba mis_leads() entera por cada fila nueva), juntar los .sql en una
   carpeta con esa versión de solo-lo-suyo-seguro.sql y sumar SQL_DIR_PRUEBA=<carpeta>.

   Se mide como Dante (closer, «sólo lo suyo»), en el orden de la app: la persona, el lead, la venta, las cuotas; y leer los leads, que es lo que
   hace la política de lectura y no cambia con estos triggers (sirve de referencia). Mediana de varias repeticiones. */
import { cargarPglite, montarBanco } from "./arnes-pg";

const Pg = await cargarPglite();
if (!Pg) { console.log("PGlite no está en el disco (ver pruebas/sql/arnes-pg.ts)"); process.exit(0); }

const L = Number(process.env.L ?? 6000);
const REPETICIONES = Number(process.env.REPETICIONES ?? 5);

const b = await montarBanco(Pg, ["solo-lo-suyo-seguro.sql"]);
await b.ejecutar(`
  insert into public.equipo (id, nombre, email) values ('m_dante', 'Dante Closer', 'dante@x.com'), ('m_otro', 'Otro Closer', 'otro@x.com');
  insert into public.usuarios_permitidos (email, rol) values ('dante@x.com', 'closer'), ('otro@x.com', 'closer');
  insert into public.contactos (id, nombre) select 'ct' || i, 'x' from generate_series(1, ${L}) i;
  insert into public.leads (id, responsable, "contactoId", nombre)
    select 'l' || i, case when i % 2 = 0 then 'Dante Closer' else 'Otro Closer' end, 'ct' || i, 'x' from generate_series(1, ${L}) i;
  insert into public.sesiones (id, anfitrion, "leadId", "contactoId")
    select 's' || i, case when i % 2 = 0 then 'Dante Closer' else 'Otro Closer' end, 'l' || i, 'ct' || i from generate_series(1, ${Math.floor(L / 3)}) i;
  insert into public.ventas (id, "closerId", "contactoId", "sesionId")
    select 'v' || i, case when i % 2 = 0 then 'm_dante' else 'm_otro' end, 'l' || i, 's' || i from generate_series(1, ${Math.floor(L / 6)}) i;
  insert into public.cuotas (id, "ventaId") select 'c' || i || '_' || k, 'v' || i from generate_series(1, ${Math.floor(L / 6)}) i, generate_series(1, 2) k;`);

const mediana = (xs: number[]) => [...xs].sort((a, c) => a - c)[Math.floor(xs.length / 2)];
async function medir(que: string, armar: (n: number) => string[]): Promise<number> {
  const tiempos: number[] = [];
  for (let n = 0; n < REPETICIONES; n++) {
    const sqls = armar(n);
    const t0 = performance.now();
    for (const sql of sqls) {
      const r = await b.intentar("dante@x.com", sql);
      if (!r.ok) throw new Error(`${que}: ${r.mensaje}`);
    }
    tiempos.push(performance.now() - t0);
  }
  return mediana(tiempos);
}

const q = (n: number) => `${n}_${Date.now() % 100000}`;
const filas: [string, number][] = [];
filas.push(["crear una persona (contactos)", await medir("persona", (n) => [`insert into public.contactos (id, nombre) values ('ctN${q(n)}', 'Nueva')`])]);
filas.push(["crear un lead con esa persona", await medir("lead", (n) => {
  const id = q(n);
  return [`insert into public.contactos (id, nombre) values ('ctL${id}', 'Nueva')`, `insert into public.leads (id, "contactoId", nombre) values ('lN${id}', 'ctL${id}', 'Nueva')`];
})]);
filas.push(["crear una venta a ese lead, atada a su llamada", await medir("venta", (n) => {
  const id = q(n);
  return [`insert into public.contactos (id, nombre) values ('ctV${id}', 'Nueva')`, `insert into public.leads (id, "contactoId", nombre) values ('lV${id}', 'ctV${id}', 'Nueva')`,
    `insert into public.ventas (id, "closerId", "contactoId", "sesionId") values ('vN${id}', 'm_dante', 'lV${id}', 's2')`];
})]);
filas.push(["crear 12 cuotas en su venta (una sentencia)", await medir("cuotas", (n) => {
  const id = q(n);
  return [`insert into public.ventas (id, "closerId") values ('vC${id}', 'm_dante')`,
    `insert into public.cuotas (id, "ventaId") values ${Array.from({ length: 12 }, (_, k) => `('cC${id}_${k}', 'vC${id}')`).join(", ")}`];
})]);
filas.push(["(referencia) contar los leads que ve", await medir("leer", () => [`select count(*) from public.leads`])]);

console.log(`L = ${L} leads, ${Math.floor(L / 3)} llamadas, ${Math.floor(L / 6)} ventas. Mediana de ${REPETICIONES} repeticiones, en ms (cada fila incluye los pasos previos que arma, como la app).`);
for (const [que, ms] of filas) console.log(`  ${ms.toFixed(0).padStart(7)} ms  ${que}`);
await b.db.close();
