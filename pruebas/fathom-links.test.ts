import test from "node:test";
import assert from "node:assert/strict";
import { decidirGrabacion, idDeShare, llamadaDeLink } from "@/lib/fathom";
import { decidirBarrido, BARRIDO_VACIO, ENTRE_COMPLETOS, ENTRE_FRESCOS } from "@/lib/fathom-barrido";

/* El link de Fathom que pegan los closers es lo que ata la grabación a su llamada (26/10): 840 llamadas con link y
   la tabla de grabaciones vacía, porque sólo se atendía por el correo y la hora. */

test("el id sale del link compartido, con o sin barra final, parámetros o mayúsculas", () => {
  assert.equal(idDeShare("https://fathom.video/share/AbC_12-x"), "AbC_12-x");
  assert.equal(idDeShare("https://fathom.video/share/AbC_12-x/"), "AbC_12-x");
  assert.equal(idDeShare("  HTTPS://FATHOM.VIDEO/share/AbC_12-x?timestamp=33 "), "AbC_12-x");
  assert.equal(idDeShare("https://fathom.video/calls/610313346"), null);
  assert.equal(idDeShare("https://drive.google.com/file/d/1"), null);
  assert.equal(idDeShare(null), null);
  assert.equal(idDeShare(""), null);
});

test("la llamada que va es la que tiene pegado ese link; si hay varias, la más cercana a la grabación", () => {
  const g = { shareUrl: "https://fathom.video/share/zzz", empieza: "2026-10-20T15:00:00.000Z", grabadaDesde: null, creadoEn: undefined };
  const llamadas = [
    { id: "otra", grabacion: "https://fathom.video/share/yyy", inicia: "2026-10-20T15:00:00.000Z" },
    { id: "lejos", grabacion: "https://fathom.video/share/zzz", inicia: "2026-10-27T15:00:00.000Z" },
    { id: "cerca", grabacion: "https://fathom.video/share/zzz/", inicia: "2026-10-20T14:50:00.000Z" },
    { id: "drive", grabacion: "https://drive.google.com/file/d/zzz", inicia: "2026-10-20T15:00:00.000Z" },
  ];
  assert.equal(llamadaDeLink(g, llamadas), "cerca");
  assert.equal(llamadaDeLink({ ...g, shareUrl: "https://fathom.video/share/nada" }, llamadas), null);
  assert.equal(llamadaDeLink({ ...g, shareUrl: null }, llamadas), null);
});

test("lo atado por link se guarda como «link»; lo atado a mano no se pisa", () => {
  assert.deepEqual(decidirGrabacion(null, "cal_1", "link"), { guardar: true, sesionId: "cal_1", por: "link" });
  assert.deepEqual(decidirGrabacion(null, "cal_1"), { guardar: true, sesionId: "cal_1", por: "email-y-hora" });
  assert.deepEqual(decidirGrabacion({ sesionId: "cal_9", emparejadaPor: "a-mano" }, "cal_1", "link"), { guardar: true, sesionId: "cal_9", por: "a-mano" });
  assert.deepEqual(decidirGrabacion(null, null), { guardar: false, sesionId: null, por: null });
});

const AHORA = Date.parse("2026-10-26T12:00:00.000Z");
const hace = (ms: number) => new Date(AHORA - ms).toISOString();
const DIA = 86_400_000;

test("barrido: con uno en curso, sigue; sin llamadas con link pendientes, no hace nada", () => {
  assert.deepEqual(decidirBarrido({ ...BARRIDO_VACIO, cursor: "x" }, [], AHORA), { accion: "seguir" });
  assert.deepEqual(decidirBarrido(BARRIDO_VACIO, [], AHORA), { accion: "nada", motivo: "sin-pendientes" });
});

test("barrido: la primera vez va por todo, desde el día antes de la llamada más vieja", () => {
  const d = decidirBarrido(BARRIDO_VACIO, [{ inicia: hace(100 * DIA) }, { inicia: hace(1 * DIA) }], AHORA);
  assert.equal(d.accion, "empezar");
  assert.equal(d.accion === "empezar" && d.tipo, "completo");
  assert.equal(d.accion === "empezar" && d.desde, hace(101 * DIA));
});

test("barrido: después de uno completo, lo fresco se mira cada 30 minutos y lo viejo, una vez al día", () => {
  const viejas = [{ inicia: hace(40 * DIA) }];
  const frescas = [{ inicia: hace(1 * DIA) }];
  const tras = (completoHace: number, frescoHace: number) => ({ ...BARRIDO_VACIO, ultimoCompleto: hace(completoHace), ultimoFresco: hace(frescoHace) });
  /* Recién terminó: nada. */
  assert.deepEqual(decidirBarrido(tras(60_000, 60_000), [...viejas, ...frescas], AHORA), { accion: "nada", motivo: "esperando" });
  /* Pasaron 31 minutos: sólo lo fresco, desde el día antes de la fresca más vieja. */
  const f = decidirBarrido(tras(3600_000, ENTRE_FRESCOS + 60_000), [...viejas, ...frescas], AHORA);
  assert.equal(f.accion === "empezar" && f.tipo, "fresco");
  assert.equal(f.accion === "empezar" && f.desde, hace(2 * DIA));
  /* Lo viejo que nunca apareció, si no hay fresco, espera a mañana. */
  assert.deepEqual(decidirBarrido(tras(3600_000, 3600_000), viejas, AHORA), { accion: "nada", motivo: "esperando" });
  const c = decidirBarrido(tras(ENTRE_COMPLETOS + 60_000, 3600_000), viejas, AHORA);
  assert.equal(c.accion === "empezar" && c.tipo, "completo");
});

test("barrido: «forzar» no espera a que toque", () => {
  const e = { ...BARRIDO_VACIO, ultimoCompleto: hace(60_000), ultimoFresco: hace(60_000) };
  assert.equal(decidirBarrido(e, [{ inicia: hace(40 * DIA) }], AHORA).accion, "nada");
  assert.equal(decidirBarrido(e, [{ inicia: hace(40 * DIA) }], AHORA, true).accion, "empezar");
});

test("barrido: nunca pide más de un año atrás", () => {
  const d = decidirBarrido(BARRIDO_VACIO, [{ inicia: hace(900 * DIA) }], AHORA);
  assert.equal(d.accion === "empezar" && d.desde, hace(365 * DIA));
});
