import test from "node:test";
import assert from "node:assert/strict";
import { cobradoEnWhop, reembolsosDeWhop, resumenDeWhop, whop } from "@/lib/pasarelas-api";

/* ==================================================================
   Whop lista como «paid» también los intentos que nunca cobraron. El 16/10/2026,
   147 de los 166 cobros de Whop sin conciliar eran intentos (open/failed,
   blocked, incomplete, void/canceled). Sólo el pago con status paid es plata.
   ================================================================== */

test("cobradoEnWhop: sólo paid con un substatus que no sea de intento", () => {
  assert.equal(cobradoEnWhop({ status: "paid", substatus: "succeeded" }), true);
  assert.equal(cobradoEnWhop({ status: "paid", substatus: "refunded" }), true, "un reembolso fue un cobro: la devolución la maneja su propio flujo");
  assert.equal(cobradoEnWhop({ status: "paid", substatus: "partially_refunded" }), true);
  assert.equal(cobradoEnWhop({ status: "open", substatus: "failed" }), false);
  assert.equal(cobradoEnWhop({ status: "open", substatus: "blocked" }), false);
  assert.equal(cobradoEnWhop({ status: "open", substatus: "incomplete" }), false);
  assert.equal(cobradoEnWhop({ status: "void", substatus: "canceled" }), false);
  assert.equal(cobradoEnWhop({ status: "void", substatus: "failed" }), false);
  assert.equal(cobradoEnWhop({ status: "paid", substatus: "failed" }), false, "por el substatus aunque diga paid");
  assert.equal(cobradoEnWhop({}), undefined, "sin datos no se sabe: lo decide el detalle");
});

const AHORA = Math.floor(Date.now() / 1000);
const item = (id: string, extra: Record<string, unknown> = {}) => ({ id, final_amount: 900, currency: "usd", paid_at: AHORA - 3600, ...extra });

function conWhop(lista: unknown[], detalle: Record<string, Record<string, unknown>>, fn: () => Promise<void>) {
  const anterior = process.env.WHOP_API_KEY;
  const fetchAnterior = globalThis.fetch;
  process.env.WHOP_API_KEY = "whop_prueba";
  globalThis.fetch = (async (url: string | URL) => {
    const u = String(url);
    if (u.includes("/api/v5/company/payments")) return new Response(JSON.stringify({ data: lista, pagination: { total_pages: 1 } }), { status: 200 });
    const id = decodeURIComponent(u.split("/payments/")[1]);
    return new Response(JSON.stringify({ id, user: { name: "Cami", email: "cami@mail.com" }, payment_method_type: "card", ...detalle[id] }), { status: 200 });
  }) as typeof fetch;
  return fn().finally(() => {
    globalThis.fetch = fetchAnterior;
    if (anterior === undefined) delete process.env.WHOP_API_KEY; else process.env.WHOP_API_KEY = anterior;
  });
}

test("whop(): si la lista ya dice que fue un intento, no entra", async () => {
  await conWhop(
    [item("pay_ok", { status: "paid", substatus: "succeeded" }), item("pay_falla", { status: "open", substatus: "failed" }), item("pay_void", { status: "void", substatus: "canceled" })],
    { pay_ok: { status: "paid", substatus: "succeeded" } },
    async () => {
      const r = await whop(new Date(Date.now() - 86400_000));
      assert.deepEqual(r.map((m) => m.referencia), ["pay_ok"]);
    },
  );
});

test("whop(): si la lista no trae el estado, el detalle de cada cobro nuevo decide", async () => {
  await conWhop(
    [item("pay_bueno"), item("pay_banco"), item("pay_bloqueado")],
    {
      pay_bueno: { status: "paid", substatus: "succeeded" },
      pay_banco: { status: "open", substatus: "failed" },
      pay_bloqueado: { status: "open", substatus: "blocked" },
    },
    async () => {
      const r = await whop(new Date(Date.now() - 86400_000));
      assert.deepEqual(r.map((m) => m.referencia), ["pay_bueno"]);
    },
  );
});

test("whop(): sin estado en ningún lado (la forma de antes) el cobro sigue entrando", async () => {
  await conWhop([item("pay_viejo")], {}, async () => {
    const r = await whop(new Date(Date.now() - 86400_000));
    assert.deepEqual(r.map((m) => m.referencia), ["pay_viejo"]);
  });
});

/* ---------- Whop dejó de traer cobros sin dar error (14 al 19/11/2026) ---------- */

test("whop(): si no trae nada de las últimas 48 horas, avisa con cifras y no calla", async () => {
  const viejo = Math.floor(Date.now() / 1000) - 5 * 86400;
  await conWhop([item("pay_viejo", { paid_at: viejo, status: "paid", substatus: "succeeded" })], {}, async () => {
    const avisos: string[] = [];
    const diagnosticos: string[] = [];
    const r = await whop(new Date(Date.now() - 30 * 86400_000), { avisos, diagnosticos });
    assert.equal(r.length, 1, "el cobro viejo sigue entrando");
    assert.deepEqual(avisos, [], "no es un error de la sincronización");
    assert.equal(diagnosticos.length, 1);
    assert.match(diagnosticos[0], /^Whop no trajo cobros desde el \d\d\/\d\d\. Whop devolvió 1 pagos en 1 de 1 páginas/);
    assert.match(diagnosticos[0], /paid\/succeeded 1/);
    assert.doesNotMatch(diagnosticos[0], /cami@mail\.com|Cami/, "sin nombres ni correos");
  });
});

test("whop(): si Whop devuelve la lista vacía, el aviso lo dice", async () => {
  await conWhop([], {}, async () => {
    const diagnosticos: string[] = [];
    const r = await whop(new Date(Date.now() - 30 * 86400_000), { diagnosticos });
    assert.deepEqual(r, []);
    assert.deepEqual(diagnosticos, ["Whop no trajo cobros en la ventana pedida. Whop devolvió 0 pagos (páginas pedidas: 1 de 1)."]);
  });
});

test("whop(): con cobros de hoy no avisa nada", async () => {
  await conWhop([item("pay_hoy", { status: "paid", substatus: "succeeded" })], {}, async () => {
    const diagnosticos: string[] = [];
    await whop(new Date(Date.now() - 86400_000), { diagnosticos });
    assert.deepEqual(diagnosticos, []);
  });
});

test("resumenDeWhop: cuenta estados, fechas y orden sin mostrar datos de nadie", () => {
  const dia = (n: number) => Date.parse(`2026-11-${n}T15:00:00Z`) / 1000;
  const texto = resumenDeWhop([
    { id: "a", paid_at: dia(14), status: "paid", substatus: "succeeded", user: { email: "x@y.com" } },
    { id: "b", paid_at: dia(10), status: "open", substatus: "failed" },
    { id: "c", created_at: "2026-11-02T10:00:00Z", status: "paid", substatus: "succeeded" },
    { id: "d", status: "paid" },
  ], { paginas: 2, totalPaginas: 7 });
  assert.match(texto, /^Whop devolvió 4 pagos en 2 de 7 páginas \(/);
  assert.match(texto, /de la más nueva a la más vieja/);
  assert.match(texto, /del 02\/11 al 14\/11, 1 sin fecha/);
  assert.match(texto, /paid\/succeeded 2/);
  assert.match(texto, /open\/failed 1/);
  assert.doesNotMatch(texto, /x@y\.com/);
  assert.match(resumenDeWhop([{ id: "a", paid_at: dia(14) }, { id: "b", paid_at: dia(10) }]), /más nueva a la más vieja/);
  assert.match(resumenDeWhop([{ id: "a", paid_at: dia(10) }, { id: "b", paid_at: dia(14) }]), /más vieja a la más nueva/);
});

/* ---------- El orden de Whop: de la más vieja a la más nueva (la causa del 14 al 19/11/2026) ---------- */

const DIA = 86400;
/* Un Whop con `n` pagos, uno cada `cadaMin` minutos hasta ahora, servido de a 50 por página en el orden pedido. Devuelve qué páginas se pidieron. */
function conWhopPaginado(n: number, orden: "viejo-primero" | "nuevo-primero", fn: (pedidas: number[]) => Promise<void>, cadaMin = 360) {
  const anterior = process.env.WHOP_API_KEY;
  const fetchAnterior = globalThis.fetch;
  process.env.WHOP_API_KEY = "whop_prueba";
  const ahora = Math.floor(Date.now() / 1000);
  const todos = Array.from({ length: n }, (_, k) => {
    const t = ahora - (n - 1 - k) * cadaMin * 60;
    return { id: `pay_${k}`, final_amount: 900, currency: "usd", created_at: t, paid_at: t, status: "paid", payment_processing_fee: 10, whop_fee: 5, user: { name: "Cami", email: "cami@mail.com" }, payment_method_type: "card" };
  });
  const serie = orden === "viejo-primero" ? todos : [...todos].reverse();
  const pedidas: number[] = [];
  globalThis.fetch = (async (url: string | URL) => {
    const pagina = Number(new URL(String(url)).searchParams.get("page") ?? 1);
    pedidas.push(pagina);
    return new Response(JSON.stringify({ data: serie.slice((pagina - 1) * 50, pagina * 50), pagination: { total_pages: Math.ceil(n / 50) } }), { status: 200 });
  }) as typeof fetch;
  return fn(pedidas).finally(() => {
    globalThis.fetch = fetchAnterior;
    if (anterior === undefined) delete process.env.WHOP_API_KEY; else process.env.WHOP_API_KEY = anterior;
  });
}

test("whop(): si Whop manda de la más vieja a la más nueva y la primera página ya es anterior a la ventana, igual trae lo nuevo (el caso del 15/11)", async () => {
  /* 450 pagos en 112 días (uno cada 6 horas): la primera página es de hace 112 a 100 días, fuera de los 60 de la ventana. */
  await conWhopPaginado(450, "viejo-primero", async (pedidas) => {
    const avisos: string[] = [];
    const diagnosticos: string[] = [];
    const r = await whop(new Date(Date.now() - 60 * DIA * 1000), { avisos, diagnosticos, necesitaDetalle: () => false });
    assert.equal(r.length, 240, "los 60 días de la ventana, ni uno menos (con el defecto eran 0)");
    assert.ok(r.some((m) => m.referencia === "pay_449"), "el más nuevo está");
    assert.ok(r.every((m) => Date.parse(m.fecha) >= Date.now() - 60 * DIA * 1000), "ninguno anterior a la ventana");
    assert.deepEqual([avisos, diagnosticos], [[], []], "y ya no hace falta avisar nada");
    assert.equal(pedidas[0], 1, "la primera página sirve para ver el orden");
    assert.deepEqual(pedidas.slice(1), [9, 8, 7, 6, 5, 4], "después va de la última hacia atrás y para cuando una página ya es vieja (con 7 días de margen), sin leer las 9");
  });
});

test("whop(): de la más nueva a la más vieja también anda, y no pide de más", async () => {
  await conWhopPaginado(450, "nuevo-primero", async (pedidas) => {
    const r = await whop(new Date(Date.now() - 60 * DIA * 1000), { necesitaDetalle: () => false });
    assert.equal(r.length, 240);
    assert.ok(r.some((m) => m.referencia === "pay_449"));
    assert.deepEqual(pedidas, [1, 2, 3, 4, 5, 6], "6 páginas (con el margen de 7 días), no las 9");
  });
});

test("whop(): con pocos pagos (una sola página) no pide nada más, venga en el orden que venga", async () => {
  for (const orden of ["viejo-primero", "nuevo-primero"] as const) {
    await conWhopPaginado(30, orden, async (pedidas) => {
      const r = await whop(new Date(Date.now() - 60 * DIA * 1000), { necesitaDetalle: () => false });
      assert.equal(r.length, 30);
      assert.deepEqual(pedidas, [1]);
    });
  }
});

test("whop(): nunca pide más de 20 páginas, aunque todo caiga dentro de la ventana", async () => {
  await conWhopPaginado(1500, "viejo-primero", async (pedidas) => {
    await whop(new Date(Date.now() - 365 * DIA * 1000), { necesitaDetalle: () => false, diagnosticos: [] });
    assert.ok(pedidas.length <= 20, `pidió ${pedidas.length}`);
    assert.equal(pedidas[1], 30, "empieza por lo más nuevo");
  }, 10);
});

test("reembolsosDeWhop: también lee desde el lado de lo nuevo (con 450 pagos de la más vieja a la más nueva, ve el reembolso de ayer)", async () => {
  const anterior = process.env.WHOP_API_KEY;
  const fetchAnterior = globalThis.fetch;
  process.env.WHOP_API_KEY = "whop_prueba";
  const ahora = Math.floor(Date.now() / 1000);
  const todos = Array.from({ length: 450 }, (_, k) => {
    const t = ahora - (449 - k) * 6 * 3600;
    const reembolsado = k === 449 || k === 100;
    return { id: `pay_${k}`, final_amount: 900, currency: "usd", created_at: t, paid_at: t, status: "paid", substatus: reembolsado ? "refunded" : "succeeded", ...(reembolsado ? { refunded_amount: 900, refunded_at: t + 3600 } : {}) };
  });
  const pedidas: string[] = [];
  globalThis.fetch = (async (url: string | URL) => {
    const u = new URL(String(url));
    pedidas.push(`${u.searchParams.get("status")}:${u.searchParams.get("page")}`);
    if (u.searchParams.get("status") !== "paid") return new Response(JSON.stringify({ data: [], pagination: { total_pages: 1 } }), { status: 200 });
    const pagina = Number(u.searchParams.get("page") ?? 1);
    return new Response(JSON.stringify({ data: todos.slice((pagina - 1) * 50, pagina * 50), pagination: { total_pages: 9 } }), { status: 200 });
  }) as typeof fetch;
  try {
    const r = await reembolsosDeWhop(new Date(Date.now() - 5 * 86400_000));
    assert.deepEqual(r.map((x) => x.referencia), ["reembolso:pay_449"], "el de ayer sí; el de hace 75 días no (es anterior a la ventana)");
    assert.deepEqual(pedidas.slice(0, 3), ["refunded:1", "paid:1", "paid:9"], "después de ver el orden con la primera página, va por la última (la más nueva)");
  } finally {
    globalThis.fetch = fetchAnterior;
    if (anterior === undefined) delete process.env.WHOP_API_KEY; else process.env.WHOP_API_KEY = anterior;
  }
});
