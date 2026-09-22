"use client";

import React, { useCallback, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Asistente, Opcion, Pregunta } from "@/components/ui/Asistente";
import { Chip, Input, Select, Textarea } from "@/components/ui/ui";
import { acciones, useEstado } from "@/lib/store";
import { fechaLarga, isoDia, money, num } from "@/lib/format";
import {
  GRUPOS_GASTO, aMonedaBase, categoriasDisponibles, escribirMonto, gastosParecidos, infoGrupo,
  leerMonto, montoOriginal, normalizar, sugerirCategoria,
} from "@/lib/gastos";
import type { CategoriaGasto } from "@/lib/seed";
import type { EstadoApp, Gasto, GrupoGasto, Moneda } from "@/lib/types";

/* ==================================================================
   Cargar un gasto, una pregunta por pantalla.

   Los ingresos entran solos con las ventas; los egresos se cargan acá.
   Cinco pasos: qué, categoría, cuánto, cuándo y un resumen donde van
   los opcionales. Para editar se entra directo al resumen y desde ahí
   se salta al paso que haga falta.

   La categoría decide el renglón del estado de resultados, así que se
   sugiere sola por lo que se escribió (o por el mismo gasto del mes
   pasado) y queda elegida: casi siempre alcanza con apretar Enter.
   ================================================================== */

type PasoId = "concepto" | "categoria" | "monto" | "fecha" | "resumen";

const PASOS: { id: PasoId; titulo: string }[] = [
  { id: "concepto",  titulo: "Qué pagaste" },
  { id: "categoria", titulo: "Categoría" },
  { id: "monto",     titulo: "Monto" },
  { id: "fecha",     titulo: "Fecha" },
  { id: "resumen",   titulo: "Resumen" },
];
const RESUMEN = PASOS.length - 1;

interface Borrador {
  concepto: string;
  categoria: string;
  grupo: GrupoGasto;
  /* Elegida a mano o copiada de un gasto anterior: la sugerencia ya no la pisa. */
  categoriaElegida: boolean;
  /* Categoría que no existía: hay que decir en qué bloque cae. */
  nueva: boolean;
  /* Texto, no número: se escribe como se escribe acá ("145.000", "1.500,50")
     y lo lee leerMonto. Un input numérico leería "145.000" como 145. */
  monto: string;
  moneda: Moneda;
  tipoCambio: string;
  fecha: string;
  recurrente: boolean;
  proveedor: string;
  webinarId: string;
  notas: string;
  /* El gasto anterior del que se copió, para marcarlo en la lista. */
  copiadoDe?: string;
}

const redondear = (n: number) => Math.round(n * 100) / 100;

/* Mediodía y no medianoche: la fecha no se corre de día con el huso. */
const mediodia = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12).toISOString();

/* Al editar, un campo que se vació tiene que viajar como null: la cola de
   escritura saca los undefined y la base se quedaría con el valor viejo. */
const vaciar = (antes: unknown) => (antes ? (null as unknown as undefined) : undefined);

function inicial(e: EstadoApp, gasto?: Gasto | null): Borrador {
  const base = e.ajustes.monedaBase;
  const tc = e.ajustes.tipoCambio > 0 ? escribirMonto(e.ajustes.tipoCambio) : "";
  if (!gasto) {
    return {
      concepto: "", categoria: "", grupo: "operativo", categoriaElegida: false, nueva: false,
      monto: "", moneda: base, tipoCambio: tc, fecha: mediodia(new Date()), recurrente: false,
      proveedor: "", webinarId: "", notas: "",
    };
  }
  const orig = montoOriginal(gasto);
  return {
    concepto: gasto.concepto, categoria: gasto.categoria, grupo: gasto.grupo,
    categoriaElegida: true, nueva: false,
    monto: escribirMonto(orig ? orig.monto : gasto.monto),
    moneda: orig ? orig.moneda : (gasto.moneda ?? base),
    tipoCambio: orig ? escribirMonto(orig.tipoCambio) : tc,
    fecha: gasto.fecha, recurrente: Boolean(gasto.recurrente),
    proveedor: gasto.proveedor ?? "", webinarId: gasto.webinarId ?? "", notas: gasto.notas ?? "",
  };
}

function validar(paso: PasoId, b: Borrador, base: Moneda): string | null {
  switch (paso) {
    case "concepto":
      return b.concepto.trim().length >= 2 ? null : "Contá qué pagaste";
    case "categoria":
      return b.categoria.trim() ? null : "Elegí una categoría";
    case "monto":
      if (!(leerMonto(b.monto) > 0)) return "Escribí cuánto fue";
      if (b.moneda !== base && !(leerMonto(b.tipoCambio) > 0)) return "Falta el tipo de cambio";
      return null;
    case "fecha":
      return Number.isNaN(new Date(b.fecha).getTime()) ? "Elegí la fecha" : null;
    default:
      return null;
  }
}

export function AsistenteGasto({ gasto, onCerrar, onListo }: {
  /* Con un gasto, se edita; sin, se carga uno nuevo. */
  gasto?: Gasto | null;
  onCerrar: () => void;
  onListo: (g: Gasto, editado: boolean) => void;
}) {
  const e = useEstado();
  const base = e.ajustes.monedaBase;
  const M = useCallback((n: number, d = 2) => money(n, base, d), [base]);

  const editando = Boolean(gasto);
  const [i, setI] = useState(editando ? RESUMEN : 0);
  /* Una vez que se vio el resumen, cada paso ofrece volver directo a él. */
  const [vioResumen, setVioResumen] = useState(editando);
  const [b, setB] = useState<Borrador>(() => inicial(e, gasto));
  const set = useCallback((cambios: Partial<Borrador>) => setB((x) => ({ ...x, ...cambios })), []);

  const paso = PASOS[i];
  const problema = validar(paso.id, b, base);

  const montoNum = leerMonto(b.monto) || 0;
  const tc = leerMonto(b.tipoCambio) || 0;
  const convertido = redondear(aMonedaBase(montoNum, b.moneda, base, tc));

  const irA = (k: number) => {
    setI(k);
    if (k === RESUMEN) setVioResumen(true);
  };

  function guardar() {
    const concepto = b.concepto.trim();
    /* Lo pagado en otra moneda queda guardado tal cual, al lado del monto
       convertido que es el que suma el estado de resultados. */
    const { montoOriginal: _m, monedaOriginal: _o, tipoCambio: _t, ...extraLimpio } = gasto?.extra ?? {};
    const extra = b.moneda === base
      ? extraLimpio
      : { ...extraLimpio, montoOriginal: redondear(montoNum), monedaOriginal: b.moneda, tipoCambio: tc };

    const datos: Omit<Gasto, "id"> = {
      categoria: b.categoria.trim(),
      grupo: b.grupo,
      concepto,
      monto: convertido,
      moneda: base,
      fecha: b.fecha,
      recurrente: b.recurrente,
      webinarId: b.webinarId || vaciar(gasto?.webinarId),
      proveedor: b.proveedor.trim() || vaciar(gasto?.proveedor),
      notas: b.notas.trim() || vaciar(gasto?.notas),
      creadoEn: gasto?.creadoEn ?? new Date().toISOString(),
      extra,
    };

    if (gasto) {
      acciones.actualizar<Gasto>("gastos", gasto.id, datos, concepto);
      onListo({ ...gasto, ...datos }, true);
    } else {
      const id = acciones.crear<Gasto>("gastos", datos, concepto);
      onListo({ ...datos, id }, false);
    }
  }

  const volverAlResumen = vioResumen && paso.id !== "resumen" && problema === null
    ? <button type="button" className="link t-sm" style={{ alignSelf: "flex-start" }} onClick={() => irA(RESUMEN)}>Listo, volver al resumen</button>
    : null;

  return (
    <Asistente
      etiqueta={editando ? "Editar gasto" : "Cargar gasto"}
      pasos={PASOS} actual={i} onCambiarPaso={irA}
      problema={problema}
      onCerrar={onCerrar}
      terminarTexto={editando ? "Guardar cambios" : "Cargar gasto"}
      onTerminar={guardar}
    >
      {paso.id === "concepto" && <PasoConcepto b={b} set={set} e={e} M={M} />}
      {paso.id === "categoria" && <PasoCategoria b={b} set={set} e={e} />}
      {paso.id === "monto" && <PasoMonto b={b} set={set} base={base} convertido={convertido} M={M} />}
      {paso.id === "fecha" && <PasoFecha b={b} set={set} />}
      {paso.id === "resumen" && (
        <PasoResumen b={b} set={set} e={e} M={M} base={base} convertido={convertido} editando={editando} irA={irA} />
      )}
      {volverAlResumen}
    </Asistente>
  );
}

type Poner = (c: Partial<Borrador>) => void;
type Fmt = (n: number, d?: number) => string;

/* ---------- 1. Qué pagaste ---------- */

function PasoConcepto({ b, set, e, M }: { b: Borrador; set: Poner; e: EstadoApp; M: Fmt }) {
  const q = b.concepto.trim();
  const parecidos = useMemo(() => gastosParecidos(q, e), [q, e]);

  const escribir = (concepto: string) => {
    if (b.categoriaElegida) { set({ concepto, copiadoDe: undefined }); return; }
    /* Mientras nadie la eligió a mano, la categoría sigue a lo que se escribe. */
    const s = sugerirCategoria(concepto, e);
    set({ concepto, copiadoDe: undefined, categoria: s?.categoria ?? "", grupo: s?.grupo ?? "operativo", nueva: false });
  };

  /* Repetir un gasto de antes: se copia lo que suele repetirse (categoría,
     monto, moneda, proveedor, si es fijo) y no lo que es de esa vez (fecha,
     webinar, notas). Igual se revisa en los pasos que siguen. */
  const repetir = (g: Gasto) => {
    const orig = montoOriginal(g);
    set({
      concepto: g.concepto, categoria: g.categoria, grupo: g.grupo, categoriaElegida: true, nueva: false,
      monto: escribirMonto(orig ? orig.monto : g.monto), moneda: orig ? orig.moneda : g.moneda,
      ...(orig ? { tipoCambio: escribirMonto(orig.tipoCambio) } : {}),
      proveedor: g.proveedor ?? "", recurrente: Boolean(g.recurrente), copiadoDe: g.id,
    });
  };

  return (
    <>
      <Pregunta
        texto="¿Qué pagaste?"
        sub="Escribilo como lo buscarías después: «Contador de septiembre», «Pauta Meta del webinar»."
      />
      <Input value={b.concepto} onChange={(ev) => escribir(ev.target.value)} placeholder="Contador de septiembre" autoFocus />
      {parecidos.length > 0 && (
        <div className="stack-2">
          <span className="t-label">{q.length >= 2 ? "Ya cargaste algo parecido" : "Tus gastos fijos"}</span>
          <div className="opciones opciones--lista">
            {parecidos.map((g) => (
              <Opcion
                key={g.id} nombre={g.concepto}
                sub={`${g.categoria} · ${M(g.monto)} · ${fechaLarga(g.fecha)}`}
                activo={b.copiadoDe === g.id} onClick={() => repetir(g)}
              />
            ))}
          </div>
          <span className="t-sm t-subtle">
            Elegí uno para repetirlo: se copian la categoría, el monto y el proveedor, y los revisás antes de cargar.
          </span>
        </div>
      )}
    </>
  );
}

/* ---------- 2. Categoría ---------- */

function PasoCategoria({ b, set, e }: { b: Borrador; set: Poner; e: EstadoApp }) {
  const [busca, setBusca] = useState("");
  const todas = useMemo(() => categoriasDisponibles(e), [e]);

  const filtrar = (texto: string) => {
    const t = normalizar(texto);
    if (!t) return todas;
    return todas.filter((c) =>
      [c.categoria, c.ayuda ?? "", ...(c.claves ?? [])].some((x) => normalizar(x).includes(t)));
  };
  const visibles = filtrar(busca);

  const elegir = (c: CategoriaGasto) =>
    set({ categoria: c.categoria, grupo: c.grupo, categoriaElegida: true, nueva: false });

  const buscar = (texto: string) => {
    setBusca(texto);
    /* Si lo que se escribió deja una sola, queda elegida: Enter y listo. */
    const quedan = filtrar(texto);
    if (texto.trim() && quedan.length === 1) elegir(quedan[0]);
  };

  const nombreNuevo = busca.trim();
  const existe = todas.some((c) => normalizar(c.categoria) === normalizar(nombreNuevo));
  /* Crear se ofrece cuando lo escrito no encuentra nada: mientras hay
     coincidencias, lo más probable es que la categoría ya exista. */
  const puedeCrear = nombreNuevo.length >= 3 && !existe && visibles.length === 0;

  /* La sugerencia se nombra sólo si vino de lo escrito, no si la eligió alguien. */
  const sugerida = !b.categoriaElegida && b.categoria ? b.categoria : null;

  /* Los números 1 a 9 eligen en el orden en que se ven, a través de los grupos. */
  let n = 0;

  return (
    <>
      <Pregunta
        texto="¿En qué categoría va?"
        sub={sugerida
          ? `Por lo que escribiste, parece «${sugerida}». Si no, elegí otra.`
          : "Define en qué renglón del estado de resultados cae."}
      />
      <Input
        icono={<Search size={16} />} value={busca} onChange={(ev) => buscar(ev.target.value)}
        placeholder="Buscá: meta, contador, sueldos…" aria-label="Buscar categoría"
        onKeyDown={(ev) => {
          /* Flecha abajo baja a las tarjetas, para elegir sin el mouse. */
          if (ev.key === "ArrowDown") {
            const primera = (ev.currentTarget.closest(".asistente__paso") as HTMLElement | null)?.querySelector<HTMLElement>(".opcion");
            if (primera) { ev.preventDefault(); primera.focus(); }
          }
        }}
      />

      {GRUPOS_GASTO.map((g) => {
        const cats = visibles.filter((c) => c.grupo === g.grupo);
        if (cats.length === 0) return null;
        return (
          <div className="stack-2" key={g.grupo}>
            <div className="gasto-grupo">
              <span className="t-label">{g.titulo}</span>
              <span className="t-sm t-subtle">{g.ayuda}</span>
            </div>
            <div className="opciones">
              {cats.map((c) => {
                n++;
                return (
                  <Opcion
                    key={c.categoria} tecla={n <= 9 ? String(n) : undefined}
                    nombre={c.categoria} sub={c.ayuda}
                    activo={!b.nueva && b.categoria === c.categoria} onClick={() => elegir(c)}
                  />
                );
              })}
            </div>
          </div>
        );
      })}

      {visibles.length === 0 && (
        <p className="t-sm t-subtle">Ninguna categoría coincide con «{nombreNuevo}».</p>
      )}

      {puedeCrear && (
        <div className="stack-2">
          <div className="opciones opciones--lista">
            <Opcion
              nombre={`Crear «${nombreNuevo}»`}
              sub="Una categoría nueva. Después elegí en qué bloque del estado de resultados cae."
              activo={b.nueva && b.categoria === nombreNuevo}
              onClick={() => set({ categoria: nombreNuevo, categoriaElegida: true, nueva: true })}
            />
          </div>
        </div>
      )}

      {b.nueva && (
        <div className="stack-2">
          <span className="t-label">¿En qué bloque cae «{b.categoria}»?</span>
          <div className="row-wrap">
            {GRUPOS_GASTO.map((g) => (
              <Chip key={g.grupo} activo={b.grupo === g.grupo} onClick={() => set({ grupo: g.grupo })}>{g.titulo}</Chip>
            ))}
          </div>
          <span className="t-sm t-subtle">{infoGrupo(b.grupo).ayuda}</span>
        </div>
      )}
    </>
  );
}

/* ---------- 3. Monto ---------- */

function PasoMonto({ b, set, base, convertido, M }: {
  b: Borrador; set: Poner; base: Moneda; convertido: number; M: Fmt;
}) {
  const otra = b.moneda !== base;
  return (
    <>
      <Pregunta
        texto="¿Cuánto fue?"
        sub={otra
          ? "Lo pasamos a la moneda del estado de resultados con el tipo de cambio de ese día, como en la planilla."
          : "El total que pagaste."}
      />
      <div className="monto-grande">
        <span className="monto-grande__signo">{b.moneda === "USD" ? "US$" : "$"}</span>
        <input
          type="text" inputMode="decimal" autoComplete="off"
          value={b.monto} onChange={(ev) => set({ monto: ev.target.value })}
          aria-label="Monto" placeholder="0"
        />
      </div>
      <div className="row-wrap">
        <Chip activo={b.moneda === "USD"} onClick={() => set({ moneda: "USD" })}>Dólares (US$)</Chip>
        <Chip activo={b.moneda === "ARS"} onClick={() => set({ moneda: "ARS" })}>Pesos ($)</Chip>
      </div>
      {otra && (
        <div className="form-grid">
          <div className="hk-field">
            <label className="hk-label" htmlFor="gasto-tc">Tipo de cambio</label>
            <Input
              id="gasto-tc" type="text" inputMode="decimal" autoComplete="off"
              value={b.tipoCambio} onChange={(ev) => set({ tipoCambio: ev.target.value })}
            />
            <span className="hk-help">Pesos por dólar. Arranca en el de Ajustes.</span>
          </div>
          <div className="hk-field">
            <span className="hk-label">Suma en el estado de resultados</span>
            <span className="gasto-equivale t-num">{convertido > 0 ? M(convertido) : "—"}</span>
          </div>
        </div>
      )}
    </>
  );
}

/* ---------- 4. Fecha y si se repite ---------- */

function PasoFecha({ b, set }: { b: Borrador; set: Poner }) {
  const hoy = new Date();
  const atajos = [
    { texto: "Hoy", fecha: mediodia(hoy) },
    { texto: "Ayer", fecha: mediodia(new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 1)) },
    { texto: "El 1 de este mes", fecha: mediodia(new Date(hoy.getFullYear(), hoy.getMonth(), 1)) },
  ];
  return (
    <>
      <Pregunta texto="¿Cuándo lo pagaste?" sub="La fecha decide en qué período del estado de resultados cae." />
      <Input
        type="date" value={isoDia(b.fecha)} aria-label="Fecha del gasto"
        onChange={(ev) => { if (ev.target.value) set({ fecha: new Date(`${ev.target.value}T12:00:00`).toISOString() }); }}
      />
      <div className="row-wrap">
        {atajos.map((a) => (
          <Chip key={a.texto} activo={isoDia(b.fecha) === isoDia(a.fecha)} onClick={() => set({ fecha: a.fecha })}>{a.texto}</Chip>
        ))}
      </div>
      <div className="stack-2">
        <span className="t-label">¿Se repite?</span>
        <div className="opciones">
          <Opcion tecla="1" nombre="Fijo" sub="Se paga todos los meses" activo={b.recurrente} onClick={() => set({ recurrente: true })} />
          <Opcion tecla="2" nombre="Variable" sub="Esta vez sola, o cambia mes a mes" activo={!b.recurrente} onClick={() => set({ recurrente: false })} />
        </div>
      </div>
    </>
  );
}

/* ---------- 5. Resumen y opcionales ---------- */

function PasoResumen({ b, set, e, M, base, convertido, editando, irA }: {
  b: Borrador; set: Poner; e: EstadoApp; M: Fmt; base: Moneda; convertido: number;
  editando: boolean; irA: (k: number) => void;
}) {
  const webinars = useMemo(
    () => [...e.webinars].sort((a, c) => +new Date(c.fecha) - +new Date(a.fecha)).slice(0, 24),
    [e.webinars],
  );
  const cambiar = (id: PasoId) => (
    <button type="button" className="link t-sm gasto-cambiar" onClick={() => irA(PASOS.findIndex((x) => x.id === id))}>
      Cambiar
    </button>
  );
  const otra = b.moneda !== base;

  return (
    <>
      <Pregunta
        texto={editando ? "Así está el gasto" : "Así queda el gasto"}
        sub={editando ? "Tocá «Cambiar» en lo que quieras corregir." : "Revisá y cargalo. Lo de abajo es opcional."}
      />

      <dl className="dl">
        <dt>Qué</dt>
        <dd>{b.concepto.trim()} {cambiar("concepto")}</dd>
        <dt>Categoría</dt>
        <dd>{b.categoria} <span className="t-subtle">· {infoGrupo(b.grupo).titulo}</span> {cambiar("categoria")}</dd>
        <dt>Monto</dt>
        <dd>
          <span className="t-num">{M(convertido)}</span>
          {otra && <span className="t-subtle t-num"> · {money(leerMonto(b.monto) || 0, b.moneda, 2)} a {num(leerMonto(b.tipoCambio) || 0, 2)}</span>}
          {" "}{cambiar("monto")}
        </dd>
        <dt>Fecha</dt>
        <dd>{fechaLarga(b.fecha)} <span className="t-subtle">· {b.recurrente ? "fijo" : "variable"}</span> {cambiar("fecha")}</dd>
      </dl>

      <div className="form-grid">
        <div className="hk-field">
          <label className="hk-label" htmlFor="gasto-proveedor">Proveedor</label>
          <Input id="gasto-proveedor" value={b.proveedor} onChange={(ev) => set({ proveedor: ev.target.value })} placeholder="A quién le pagaste" />
        </div>
        {webinars.length > 0 && (
          <div className="hk-field">
            <label className="hk-label" htmlFor="gasto-webinar">Webinar</label>
            <Select
              id="gasto-webinar" value={b.webinarId} placeholder="Sin atribuir"
              onChange={(ev) => set({ webinarId: ev.target.value })}
              opciones={webinars.map((w) => ({ valor: w.id, texto: `${w.titulo} — ${fechaLarga(w.fecha)}` }))}
            />
            <span className="hk-help">Si es de un webinar puntual, entra en su profit.</span>
          </div>
        )}
        <div className="hk-field span-2">
          <label className="hk-label" htmlFor="gasto-notas">Notas</label>
          <Textarea id="gasto-notas" rows={2} value={b.notas} onChange={(ev) => set({ notas: ev.target.value })} placeholder="Lo que haya que recordar de este gasto" />
        </div>
      </div>
    </>
  );
}
