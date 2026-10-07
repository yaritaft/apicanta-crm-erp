/* Medición con el RELOJ REAL y el Math.random REAL (nada controlado ni sembrado): importarLeads() e
   importarMovimientos() de verdad, contra la base falsa que imita a PostgREST (incluido el 21000).
   Correr: node --import ./pruebas/registrar.mjs pruebas/stress/_medir-importar-reloj-real.ts [N] [tandas] */
import { BaseFalsa, esperarCola, instalar } from "./_nube";
import { storeNuevo } from "./_fresco";
import type { E } from "./_acciones";

const base = new BaseFalsa();
instalar(base);

const N = Number(process.argv[2] ?? 5000);
const TANDAS = Number(process.argv[3] ?? 150);

const repetidos = (ids: string[]) => ids.length - new Set(ids).size;

async function leads() {
  let conRepetidos = 0, colaTrabada = 0, perdidosEnLaBase = 0, contactosMezclados = 0;
  const ejemplos: string[] = [];
  for (let t = 0; t < TANDAS; t++) {
    base.vaciar();
    const S = await storeNuevo();
    await S.acciones.vaciarTodo();
    const etapaId = JSON.parse(S.acciones.exportar()).etapas[0].id;
    const filas = Array.from({ length: N }, (_x, i) => ({ nombre: `P ${i}`, email: `p${i}@ejemplo.test`, fuente: "CSV", etapaId, monto: 0, moneda: "USD", responsable: "x", etiquetas: [], creadoEn: "2026-10-01T00:00:00.000Z", actualizadoEn: "2026-10-01T00:00:00.000Z", extra: {} }));
    S.acciones.importarLeads(filas as never);
    await esperarCola(S.estadoSync);
    const mem = JSON.parse(S.acciones.exportar());
    const ids = (mem.leads as E[]).map((l) => l.id);
    const rep = repetidos(ids);
    if (!rep) continue;
    conRepetidos++;
    if (S.estadoSync() === "error") colaTrabada++;
    else if (base.filas("leads").length < ids.length) perdidosEnLaBase++;
    /* dos personas distintas (otro mail) que quedaron atadas al MISMO contacto por el id repetido */
    const porContacto = new Map<string, Set<string>>();
    for (const l of mem.leads as E[]) {
      const k = String(l.contactoId);
      if (!porContacto.has(k)) porContacto.set(k, new Set());
      porContacto.get(k)!.add(String(l.email));
    }
    if ([...porContacto.values()].some((s) => s.size > 1)) contactosMezclados++;
    if (ejemplos.length < 3) ejemplos.push(`tanda ${t}: ${rep} repetido(s); cola=${S.estadoSync()} ${S.errorSync()}; leads en la base=${base.filas("leads").length}/${N}`);
  }
  console.log(`importarLeads(${N}) x ${TANDAS} tandas, reloj real: con ids repetidos=${conRepetidos} (${(100 * conRepetidos / TANDAS).toFixed(1)}%), cola trabada (21000)=${colaTrabada}, lead pisado en la base sin error=${perdidosEnLaBase}, tandas con dos personas en un mismo contacto=${contactosMezclados}`);
  for (const x of ejemplos) console.log("   ", x);
}

async function movimientos() {
  let conRepetidos = 0, colaTrabada = 0, sinGuardar = 0;
  const ejemplos: string[] = [];
  for (let t = 0; t < TANDAS; t++) {
    base.vaciar();
    const S = await storeNuevo();
    await S.acciones.vaciarTodo();
    const filas = Array.from({ length: N }, (_x, i) => ({ proveedor: "stripe", referencia: `pi_${i}`, monto: 10 + i, moneda: "USD", fee: 1, neto: 9 + i, fecha: "2026-10-01T00:00:00.000Z" }));
    S.acciones.importarMovimientos(filas as never, "csv");
    await esperarCola(S.estadoSync);
    const ids = (JSON.parse(S.acciones.exportar()).movimientos as E[]).map((m) => m.id);
    if (!repetidos(ids)) continue;
    conRepetidos++;
    if (S.estadoSync() === "error") { colaTrabada++; if (base.filas("movimientos").length === 0) sinGuardar++; }
    if (ejemplos.length < 3) ejemplos.push(`tanda ${t}: ${repetidos(ids)} repetido(s); cola=${S.estadoSync()} ${S.errorSync()}; cobros en la base=${base.filas("movimientos").length}/${N}`);
  }
  console.log(`importarMovimientos(${N}) x ${TANDAS} tandas, reloj real: con ids repetidos=${conRepetidos} (${(100 * conRepetidos / TANDAS).toFixed(1)}%), cola trabada (21000)=${colaTrabada}, ninguno llegó a la base=${sinGuardar}`);
  for (const x of ejemplos) console.log("   ", x);
}

const que = process.argv[4] ?? "ambos";
if (que === "ambos" || que === "leads") await leads();
if (que === "ambos" || que === "movimientos") await movimientos();
process.exit(0);
