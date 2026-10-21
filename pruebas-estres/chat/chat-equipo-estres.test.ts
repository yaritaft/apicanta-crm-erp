import test from "node:test";
import assert from "node:assert/strict";
import {
  claveDe, contextoDeEntrega, entregaCon, entregaDe, lecturaAlLeer, participantes, recibidosAlLlegar, resumenDeMensaje, type Entrega,
} from "@/lib/chat-equipo";
import { acciones } from "@/lib/store";
import type { ChatLectura, Comentario, EstadoApp } from "@/lib/types";

/* ==================================================================
   Stress test del chat del equipo (20/10): volumen, propiedades con
   datos al azar y lo que llega en vivo desordenado. Lo que encontró ya
   está arreglado: los tildes recorrían el chat entero por cada mensaje
   y una ficha enorme tardaba por copiar listas (contextoDeEntrega).
   ================================================================== */

function azar(semilla: number) {
  let s = semilla >>> 0;
  const r = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  return { r, uno: <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)], entero: (a: number, b: number) => a + Math.floor(r() * (b - a + 1)) };
}
const GENTE = Array.from({ length: 12 }, (_, i) => ({ autor: `Persona ${i}`, email: `p${i}@x.com` }));
const BASE = Date.UTC(2026, 9, 1);
const iso = (minutos: number) => new Date(BASE + minutos * 60_000).toISOString();

function chatAlAzar(semilla: number, n: number, fichas = 1): Comentario[] {
  const a = azar(semilla);
  const cs: Comentario[] = [];
  for (let i = 0; i < n; i++) {
    const g = a.uno(GENTE);
    const c: Comentario = { id: `c${semilla}_${i}`, contactoId: `f${i % fichas}`, autor: g.autor, autorEmail: g.email, texto: "x", creadoEn: iso(i * 3 + a.entero(0, 2)) };
    if (a.r() < 0.2) { const q = a.uno(GENTE); c.reacciones = [{ emoji: "👍", quien: q.autor, email: q.email }]; }
    cs.push(c);
  }
  return cs;
}
function lecturasAlAzar(semilla: number, cs: Comentario[], contactoId = "f0"): ChatLectura[] {
  const a = azar(semilla);
  const max = cs.length * 3;
  return GENTE.filter(() => a.r() < 0.8).map((g) => {
    const leido = a.entero(0, max), recibido = leido + a.entero(0, max - leido);
    return { id: `${contactoId}:${g.email}`, contactoId, quien: g.email, nombre: g.autor, leidoHasta: a.r() < 0.9 ? iso(leido) : undefined, recibidoHasta: iso(recibido) };
  });
}
const RANGO: Record<Entrega, number> = { "sin-enviar": 0, enviando: 0, enviado: 1, recibido: 2, leido: 3 };

/* ---------- volumen ---------- */

test("volumen: los tildes de 1000 mensajes propios en un chat de 2000 salen en menos de 150 ms", () => {
  const cs = chatAlAzar(1, 2000).map((c, i) => (i % 2 ? c : { ...c, autor: GENTE[0].autor, autorEmail: GENTE[0].email }));
  const ls = lecturasAlAzar(2, cs);
  const t = performance.now();
  const ctx = contextoDeEntrega(cs, ls);
  for (const c of cs.filter((x) => x.autorEmail === GENTE[0].email)) entregaCon(c, ctx);
  const ms = performance.now() - t;
  assert.ok(ms < 150, `tardó ${Math.round(ms)} ms`);
});

test("volumen: lo recibido en 60.000 mensajes de 3000 fichas, y en una sola ficha de 20.000, sale en menos de 300 ms", () => {
  for (const [n, fichas] of [[60_000, 3000], [20_000, 1]] as const) {
    const cs = chatAlAzar(3, n, fichas);
    const t = performance.now();
    const filas = recibidosAlLlegar(cs, [], GENTE[0].email, GENTE[0].autor);
    const ms = performance.now() - t;
    assert.ok(ms < 300, `${n} mensajes en ${fichas} fichas: ${Math.round(ms)} ms`);
    assert.ok(filas.length > 0 && filas.length <= fichas);
  }
});

/* ---------- propiedades ---------- */

test("propiedad (300 chats al azar): leyeron, recibieron y faltan reparten a los del chat sin el autor, sin repetir", () => {
  for (let s = 1; s <= 300; s++) {
    const cs = chatAlAzar(s, 30 + (s % 50));
    const ls = lecturasAlAzar(s + 7, cs);
    const gente = participantes(cs, ls);
    for (const c of cs.slice(-5)) {
      const d = entregaDe(c, cs, ls);
      const todos = [...d.leyeron, ...d.recibieron, ...d.faltan];
      assert.equal(new Set(todos).size, todos.length, `semilla ${s}: alguien figura dos veces`);
      const esperados = [...gente].filter(([q]) => q !== claveDe(c.autorEmail, c.autor)).map(([, n]) => n).sort();
      assert.deepEqual([...todos].sort(), esperados, `semilla ${s}`);
      const esperado: Entrega = esperados.length === 0 || d.faltan.length > 0 ? "enviado" : d.recibieron.length > 0 ? "recibido" : "leido";
      assert.equal(d.estado, esperado, `semilla ${s}`);
    }
  }
});

test("propiedad: que alguien lea o reciba más NUNCA baja los tildes de un mensaje", () => {
  for (let s = 1; s <= 200; s++) {
    const a = azar(s * 13);
    const cs = chatAlAzar(s, 40);
    let ls = lecturasAlAzar(s + 3, cs);
    const c = cs[a.entero(0, cs.length - 1)];
    let antes = RANGO[entregaDe(c, cs, ls).estado];
    for (let paso = 0; paso < 10; paso++) {
      const g = a.uno(GENTE);
      const hasta = iso(a.entero(0, cs.length * 3));
      const id = `f0:${g.email}`;
      const vieja = ls.find((l) => l.id === id);
      const mayor = (x?: string, y?: string) => (x && (!y || x > y) ? x : y);
      const nueva: ChatLectura = { id, contactoId: "f0", quien: g.email, nombre: g.autor,
        leidoHasta: a.r() < 0.5 ? mayor(hasta, vieja?.leidoHasta) : vieja?.leidoHasta, recibidoHasta: mayor(hasta, vieja?.recibidoHasta) };
      if (vieja?.leidoHasta || nueva.leidoHasta || participantes(cs, ls).has(g.email)) {
        ls = [nueva, ...ls.filter((l) => l.id !== id)];
        const ahora = RANGO[entregaDe(c, cs, ls).estado];
        /* Que se sume alguien nuevo al chat (abrió por primera vez) sí puede bajar el «leído por todos»: no cuenta. */
        if (vieja) assert.ok(ahora >= antes, `semilla ${s}, paso ${paso}: ${antes} → ${ahora}`);
        antes = ahora;
      }
    }
  }
});

test("propiedad: abrir el chat deja leído todo lo de los demás; repetirlo no escribe nada", () => {
  for (let s = 1; s <= 200; s++) {
    const cs = chatAlAzar(s, 25);
    const ls = lecturasAlAzar(s + 1, cs);
    const yo = GENTE[s % 12];
    const fila = lecturaAlLeer("f0", cs, ls, yo.email, yo.autor);
    if (!fila) continue;
    const despues = [fila, ...ls.filter((l) => l.id !== fila.id)];
    assert.equal(lecturaAlLeer("f0", cs, despues, yo.email, yo.autor), null, `semilla ${s}: escribió dos veces`);
    for (const c of cs.filter((x) => x.autorEmail !== yo.email)) {
      assert.ok(entregaDe(c, cs, despues).leyeron.includes(yo.autor), `semilla ${s}: ${c.id} no figura leído por quien abrió el chat`);
    }
  }
});

test("propiedad: lo recibido nunca marca «leído» ni retrocede, y repetirlo no escribe nada", () => {
  for (let s = 1; s <= 200; s++) {
    const cs = chatAlAzar(s, 60, 4);
    const ls = lecturasAlAzar(s + 2, cs, `f${s % 4}`);
    const yo = GENTE[s % 12];
    const filas = recibidosAlLlegar(cs, ls, yo.email, yo.autor);
    for (const f of filas) {
      const vieja = ls.find((l) => l.id === f.id);
      assert.equal(f.leidoHasta, vieja?.leidoHasta, "recibir no cambia lo leído");
      if (vieja?.recibidoHasta) assert.ok(f.recibidoHasta! > vieja.recibidoHasta, "lo recibido sólo avanza");
    }
    const despues = [...filas, ...ls.filter((l) => !filas.some((f) => f.id === l.id))];
    assert.deepEqual(recibidosAlLlegar(cs, despues, yo.email, yo.autor), [], `semilla ${s}`);
  }
});

test("propiedad: la cita de cualquier mensaje es un solo renglón y nunca vacío", () => {
  const a = azar(99);
  const pedazos = ["", " ", "\n", "hola", "👍", "https://x.com/a", "línea\notra", "x".repeat(500), "\t\t"];
  for (let i = 0; i < 2000; i++) {
    const texto = Array.from({ length: a.entero(0, 4) }, () => a.uno(pedazos)).join("");
    const adjuntos = a.r() < 0.5 ? [] : [{ id: "a", tipo: a.uno(["imagen", "video", "audio", "archivo"] as const), nombre: "x.pdf", mime: "", bytes: 1, ruta: "", duracion: a.r() < 0.5 ? 12 : undefined, notaDeVoz: a.r() < 0.5 }];
    const r = resumenDeMensaje({ texto, adjuntos });
    assert.ok(r.length > 0 && !r.includes("\n"), JSON.stringify({ texto, r }));
  }
});

/* ---------- el store: lo que llega en vivo, desordenado ---------- */

test("en vivo (100 rondas al azar): duplicados, desorden y borrados terminan en la lista justa, en orden y sin repetir", () => {
  const estado = () => JSON.parse(acciones.exportar()) as EstadoApp;
  for (let s = 1; s <= 100; s++) {
    const a = azar(s * 31);
    const ficha = `vivo_${s}`;
    const verdad = new Map<string, Comentario>();
    const todos: Comentario[] = Array.from({ length: 30 }, (_, i) => ({ id: `v${s}_${i}`, contactoId: ficha, autor: "Otro", texto: `m${i}`, creadoEn: iso(i) }));
    for (let paso = 0; paso < 80; paso++) {
      const c = a.uno(todos);
      if (a.r() < 0.25) { acciones.recibirComentarios([], [c.id]); verdad.delete(c.id); }
      else {
        const conReaccion = a.r() < 0.3 ? { ...c, reacciones: [{ emoji: "👍", quien: "Otro" }] } : c;
        acciones.recibirComentarios(a.r() < 0.2 ? [conReaccion, conReaccion] : [conReaccion]);
        verdad.set(c.id, { ...(verdad.get(c.id) ?? {}), ...conReaccion });
      }
    }
    const quedo = (estado().comentarios ?? []).filter((c) => c.contactoId === ficha);
    assert.deepEqual(quedo.map((c) => c.id), [...verdad.values()].sort((x, y) => x.creadoEn.localeCompare(y.creadoEn)).map((c) => c.id), `ronda ${s}`);
  }
});

test("en vivo: el chat entero al reconectarse saca lo borrado en la base, pero no lo que todavía está en la cola de acá", () => {
  const ficha = "vivo_completo";
  acciones.recibirComentarios([1, 2, 3].map((i) => ({ id: `vc${i}`, contactoId: ficha, autor: "Otro", texto: "x", creadoEn: iso(i) })));
  acciones.recibirComentarios([{ id: "vc1", contactoId: ficha, autor: "Otro", texto: "x", creadoEn: iso(1) }], [], { completo: true });
  const quedo = ((JSON.parse(acciones.exportar()) as EstadoApp).comentarios ?? []).filter((c) => c.contactoId === ficha).map((c) => c.id);
  assert.deepEqual(quedo, ["vc1"]);
});
