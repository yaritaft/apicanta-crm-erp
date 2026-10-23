import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { alFirmar, darAccesosAhora, vincular } from "@/lib/contratos-servidor";
import type { Contrato } from "@/lib/contratos";

/* ==================================================================
   Los contratos que el equipo manda a mano desde PandaDoc (Juan Cruz,
   23/10): se atan solos a su persona, su servicio y su venta, y si firmó
   antes de que se cargara la venta los accesos no quedan trabados: se dan
   apenas aparece el servicio (o con «Dar los accesos»).
   Contra una base en memoria (sin red: el programa de prueba tiene un
   curso de Wisboo y en este entorno no hay clave, así que queda «fallo»
   sin llamar a nadie).
   ================================================================== */

type Fila = Record<string, unknown>;

function baseFalsa(tablas: Record<string, Fila[]>) {
  /* ilike como Postgres: «_» y «%» son comodines salvo escapados con «\\». */
  const comoIlike = (patron: string) => new RegExp(`^${patron.replace(/\\(.)|([_%])|([.*+?^${}()|[\]])/g, (_m, esc, com, esp) =>
    esc !== undefined ? esc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : com === "_" ? "." : com === "%" ? ".*" : `\\${esp}`)}$`, "i");
  function consulta(tabla: string) {
    const filas = () => (tablas[tabla] ??= []);
    const filtros: ((f: Fila) => boolean)[] = [];
    let orden: { col: string; asc: boolean } | null = null;
    let tope: number | null = null;
    let cambio: Fila | null = null;
    let alta: Fila | Fila[] | null = null;
    let conSelect = false;
    let contar = false;
    let uno = false;
    const q = {
      select(_c?: string, o?: { count?: string; head?: boolean }) { conSelect = true; contar = Boolean(o?.count); return q; },
      eq(c: string, v: unknown) { filtros.push((f) => f[c] === v); return q; },
      is(c: string, v: unknown) { filtros.push((f) => (f[c] ?? null) === v); return q; },
      gte(c: string, v: string) { filtros.push((f) => String(f[c] ?? "") >= v); return q; },
      ilike(c: string, v: string) { const re = comoIlike(v); filtros.push((f) => re.test(String(f[c] ?? ""))); return q; },
      order(c: string, o?: { ascending?: boolean }) { orden = { col: c, asc: o?.ascending !== false }; return q; },
      limit(n: number) { tope = n; return q; },
      maybeSingle() { uno = true; return q; },
      update(v: Fila) { cambio = v; return q; },
      insert(v: Fila | Fila[]) { alta = v; return q; },
      upsert(v: Fila) { alta = v; return q; },
      then(listo: (r: { data: unknown; error: null; count?: number }) => unknown) {
        if (alta) {
          for (const v of Array.isArray(alta) ? alta : [alta]) {
            const i = filas().findIndex((f) => f.id === v.id);
            if (i >= 0) filas()[i] = { ...filas()[i], ...v }; else filas().push({ ...v });
          }
          return Promise.resolve(listo({ data: null, error: null }));
        }
        let xs = filas().filter((f) => filtros.every((p) => p(f)));
        if (cambio) {
          for (const f of xs) Object.assign(f, cambio);
          return Promise.resolve(listo({ data: conSelect ? xs.map((f) => ({ ...f })) : null, error: null }));
        }
        if (orden) {
          const { col, asc } = orden;
          xs = [...xs].sort((a, b) => (String(a[col] ?? "") < String(b[col] ?? "") ? -1 : 1) * (asc ? 1 : -1));
        }
        if (tope !== null) xs = xs.slice(0, tope);
        const data = uno ? (xs[0] ? { ...xs[0] } : null) : xs.map((f) => ({ ...f }));
        return Promise.resolve(listo({ data, error: null, ...(contar ? { count: xs.length } : {}) }));
      },
    };
    return q;
  }
  const storage = { from: () => ({ upload: async () => ({ error: null }), remove: async () => ({ error: null }) }) };
  return { from: consulta, storage } as unknown as SupabaseClient;
}

const PROGRAMA = {
  id: "hackear-ai", nombre: "Hackear AI", productos: [], plantillaId: "tpl", plantillaNombre: "Contrato de Mentoría - Hackear AI",
  wisboo: ["PRO-curso"], telegram: [], zoom: [], bonos: [], activo: true,
};

function contrato(c: Partial<Contrato> = {}): Contrato {
  return {
    id: "ctr_1", ventaId: null, sesionId: null, leadId: null, alumnoId: null, programa: "hackear-ai", plantillaId: "tpl",
    plantillaNombre: "Contrato de Mentoría - Hackear AI", documentoId: "doc1", modo: "produccion", estado: "firmado",
    destinatario: { nombre: "Diana Olivera", email: "diana@x.com", telefono: "" }, datos: {}, enlace: null, enlaceVence: null,
    pdfPath: "ctr_1.pdf", enviadoEn: null, vistoEn: null, firmadoEn: "2026-10-22T13:05:44Z", rechazadoEn: null, anuladoEn: null,
    accesosEn: null, origen: "pandadoc", error: null, creadoEn: "2026-10-22T12:00:00Z", creadoPor: "PandaDoc",
    actualizadoEn: "2026-10-22T12:00:00Z", sincronizadoEn: null, ...c,
  };
}

function tablasCon(c: Contrato, extra: Record<string, Fila[]> = {}): Record<string, Fila[]> {
  return {
    ajustes: [{ id: 1, programas: [PROGRAMA], contratos: { estado: "duenos" } }],
    contratos: [{ ...c }], contrato_eventos: [], alumnos: [], leads: [], ventas: [], accesos_alumno: [], telegram_grupos: [],
    seguimiento_alumnos: [], ...extra,
  };
}

const eventos = (t: Record<string, Fila[]>, e = "accesos") => t.contrato_eventos.filter((x) => x.evento === e);

test("firmó antes de que se cargara la venta: no se marca como hecho y el aviso de espera queda una sola vez", async () => {
  const t = tablasCon(contrato());
  const db = baseFalsa(t);
  await alFirmar(db, contrato());
  await alFirmar(db, contrato());
  assert.equal(t.contratos[0].accesosEn ?? null, null, "sin servicio no se marca: la pasada de cada hora lo vuelve a probar");
  assert.equal(eventos(t).length, 1, "el aviso del documento y el del destinatario no dejan dos iguales");
  assert.match(String((eventos(t)[0].detalle as Fila).motivo), /Todavía no está cargada su venta/);
});

test("aparece el servicio: se ata a su persona, su servicio y su venta, y se dan los accesos", async () => {
  const c = contrato();
  const t = tablasCon(c, {
    leads: [{ id: "lead_1", email: "Diana@X.com", creadoEn: "2026-10-21T00:00:00Z" }],
    alumnos: [{ id: "alu_1", email: "diana@x.com", leadId: "lead_1", ventaId: "ven_1", creadoEn: "2026-10-22T13:06:37Z" }],
    ventas: [{ id: "ven_1", contactoId: "lead_1", estado: "activa", fecha: "2026-10-21T21:14:46Z" }],
  });
  const db = baseFalsa(t);
  const atado = await vincular(db, c);
  assert.deepEqual([atado.leadId, atado.alumnoId, atado.ventaId], ["lead_1", "alu_1", "ven_1"]);
  await alFirmar(db, atado);
  assert.ok(t.contratos[0].accesosEn, "con servicio, se marca y se dan");
  const fila = t.accesos_alumno.find((x) => x.alumnoId === "alu_1");
  assert.equal(fila?.contratoId, "ctr_1");
  /* Sin clave de Wisboo en este entorno el curso queda «fallo», pero quedó intentado y anotado en el historial. */
  assert.equal(Number((eventos(t).pop()!.detalle as Fila).fallaron), 1);
});

test("atar: una venta vieja de la misma persona es otra compra (más de un mes antes del contrato)", async () => {
  const c = contrato({ creadoEn: "2026-10-22T12:00:00Z" });
  const t = tablasCon(c, {
    leads: [{ id: "lead_1", email: "diana@x.com", creadoEn: "2026-01-01T00:00:00Z" }],
    alumnos: [{ id: "alu_viejo", email: "diana@x.com", leadId: "lead_1", ventaId: "ven_ago", creadoEn: "2026-08-22T00:00:00Z" }],
    ventas: [{ id: "ven_ago", contactoId: "lead_1", estado: "activa", fecha: "2026-08-22T15:00:00Z" }],
  });
  const atado = await vincular(baseFalsa(t), c);
  assert.equal(atado.alumnoId, "alu_viejo", "el servicio es de la misma persona: los accesos van ahí");
  assert.equal(atado.ventaId, null, "pero la venta de agosto no es la de este contrato");
});

test("atar: un mail con «_» no agarra a otra persona (ilike sin comodines)", async () => {
  const c = contrato({ destinatario: { nombre: "A", email: "a_b@x.com", telefono: "" } });
  const t = tablasCon(c, { leads: [{ id: "lead_otro", email: "axb@x.com", creadoEn: "2026-10-01T00:00:00Z" }] });
  const atado = await vincular(baseFalsa(t), c);
  assert.equal(atado.leadId, null);
});

test("«Dar los accesos»: sin servicio avisa qué falta; uno marcado sin dar nada se libera y se dan", async () => {
  const marcado = contrato({ accesosEn: "2026-10-22T13:05:46Z" });
  const sinServicio = tablasCon(marcado);
  await assert.rejects(darAccesosAhora(baseFalsa(sinServicio), marcado, "juan@x.com"), /Todavía no está cargada su venta/);

  const t = tablasCon(marcado, {
    alumnos: [{ id: "alu_1", email: "diana@x.com", leadId: null, ventaId: null, creadoEn: "2026-10-23T03:55:33Z" }],
  });
  t.contrato_eventos.push({ id: "e1", contratoId: "ctr_1", evento: "accesos", cuando: "2026-10-22T13:05:46Z", detalle: { dados: 0, motivo: "El contrato no tiene alumno: los accesos se dan a mano desde su servicio." } });
  const db = baseFalsa(t);
  const r = await darAccesosAhora(db, marcado, "juan@x.com");
  assert.equal(r.fallaron + r.dados, 1);
  assert.ok(t.contratos[0].accesosEn && t.contratos[0].accesosEn !== marcado.accesosEn, "se volvió a marcar al darlos");
  const ultimo = eventos(t).pop()!;
  assert.equal(ultimo.quien, "juan@x.com", "queda quién los dio");
  assert.equal(t.accesos_alumno[0].origen, "manual");

  /* Ya se dieron: no se repiten (para uno puntual está la solapa Accesos). */
  await assert.rejects(darAccesosAhora(db, (t.contratos[0] as unknown) as Contrato, "juan@x.com"), /ya se dieron/);
});

test("«Dar los accesos» no aplica a la reserva ni a uno sin firmar", async () => {
  const t = tablasCon(contrato());
  await assert.rejects(darAccesosAhora(baseFalsa(t), contrato({ datos: { reserva: true } }), "x"), /reserva/);
  await assert.rejects(darAccesosAhora(baseFalsa(t), contrato({ estado: "visto" }), "x"), /firmado/);
});
