"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Search } from "lucide-react";
import { Asistente, Opcion, Pregunta } from "@/components/ui/Asistente";
import { Button, Chip, Input, Select, Textarea } from "@/components/ui/ui";
import { InputMonto } from "@/components/ui/InputMonto";
import { acciones, useEstado } from "@/lib/store";
import { fechaLarga, money } from "@/lib/format";
import {
  GRUPOS_GASTO, aMonedaBase, categoriasDisponibles, gastosParecidos, infoGrupo, leerMonto, normalizar, sugerirCategoria,
} from "@/lib/gastos";
import {
  borradorInicial, cambiosAlRepetir, datosDelGasto, esCategoriaDeEquipo, esProveedorValido, modoDeCarga,
  mostrarGrilla, opcionesProveedor, pasosDeCarga, problemaDelPaso, problemasDelGasto, tipoCambioDeAjustes,
  type BorradorGasto, type ModoCarga, type OpcionProveedor, type PasoId,
} from "@/lib/carga-gasto";
import type { CategoriaGasto } from "@/lib/seed";
import type { EstadoApp, Gasto, Moneda } from "@/lib/types";
import { CampoProveedor } from "./CampoProveedor";
import { CampoFechasGasto } from "./CampoFechasGasto";

/* ==================================================================
   Cargar un gasto, una pregunta por pantalla.

   Los ingresos entran solos con las ventas; los egresos se cargan acá.
   Un gasto nuevo se carga en seis pasos: qué, categoría, a quién, cuánto,
   cuándo y una revisión donde van los opcionales.

   No se vuelve a preguntar lo que ya se sabe:
   - si se elige «ya cargaste algo parecido», se salta directo a la
     revisión, con todo puesto y editable ahí mismo;
   - la categoría se sugiere sola por lo que se escribió (o por el mismo
     gasto del mes pasado) y se muestra ya elegida: casi siempre alcanza con
     apretar Enter. La grilla entera aparece sólo si no hay sugerencia o si
     se pide cambiarla;
   - al editar se abre la revisión.

   El proveedor es obligatorio: sin saber a quién se le pagó no se puede
   cargar. Qué pasos tiene cada camino y qué falta para cargar se decide en
   lib/carga-gasto.ts.
   ================================================================== */

const redondear = (n: number) => Math.round(n * 100) / 100;

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
  const [b, setB] = useState<BorradorGasto>(() => borradorInicial(e.ajustes, gasto));
  const set = useCallback((cambios: Partial<BorradorGasto>) => setB((x) => ({ ...x, ...cambios })), []);

  const modo = modoDeCarga({ editando, copiadoDe: b.copiadoDe });
  const pasos = useMemo(() => pasosDeCarga(modo), [modo]);
  /* El paso se guarda por su nombre y no por su lugar: al repetir un gasto
     la lista de pasos se acorta. */
  const [pasoId, setPasoId] = useState<PasoId>(editando ? "revisar" : "concepto");
  /* Una vez que se vio la revisión, cada paso ofrece volver directo a ella. */
  const [vioRevision, setVioRevision] = useState(editando);

  const actual = Math.max(0, pasos.findIndex((p) => p.id === pasoId));
  const paso = pasos[actual];
  const problema = problemaDelPaso(paso.id, b, base);

  const opciones = useMemo(
    () => opcionesProveedor({ equipo: e.equipo, gastos: e.gastos }, b.categoria, b.grupo),
    [e.equipo, e.gastos, b.categoria, b.grupo],
  );

  const montoNum = leerMonto(b.monto) || 0;
  const tc = leerMonto(b.tipoCambio) || 0;
  const convertido = redondear(aMonedaBase(montoNum, b.moneda, base, tc));

  const irA = (k: number) => {
    const id = pasos[k]?.id;
    if (!id) return;
    setPasoId(id);
    if (id === "revisar") setVioRevision(true);
  };

  /* Repetir un gasto de antes: se copia lo que suele repetirse y se pasa
     directo a revisarlo. */
  const repetir = (g: Gasto) => {
    set(cambiosAlRepetir(g, tipoCambioDeAjustes(e.ajustes)));
    setPasoId("revisar");
    setVioRevision(true);
  };

  function guardar() {
    if (problemaDelPaso("revisar", b, base)) return;
    const datos = datosDelGasto(b, { base, previo: gasto, opciones });
    if (gasto) {
      acciones.actualizar<Gasto>("gastos", gasto.id, datos, datos.concepto);
      onListo({ ...gasto, ...datos }, true);
    } else {
      const id = acciones.crear<Gasto>("gastos", datos, datos.concepto);
      onListo({ ...datos, id }, false);
    }
  }

  /* Si el paso que sigue ya es la revisión, «Continuar» hace lo mismo. */
  const siguienteEsRevision = pasos[actual + 1]?.id === "revisar";
  const volverARevisar = vioRevision && paso.id !== "revisar" && !siguienteEsRevision && problema === null
    ? <button type="button" className="link t-sm" style={{ alignSelf: "flex-start" }} onClick={() => irA(pasos.length - 1)}>Listo, volver a revisar</button>
    : null;

  return (
    <Asistente
      etiqueta={editando ? "Editar gasto" : "Cargar gasto"}
      pasos={pasos} actual={actual} onCambiarPaso={irA}
      problema={problema} problemaEsError={paso.id === "revisar"}
      onCerrar={onCerrar}
      terminarTexto={editando ? "Guardar cambios" : "Cargar gasto"}
      onTerminar={guardar}
    >
      {paso.id === "concepto" && <PasoConcepto b={b} set={set} e={e} M={M} onRepetir={repetir} />}
      {paso.id === "categoria" && <PasoCategoria b={b} set={set} e={e} />}
      {paso.id === "proveedor" && <PasoProveedor b={b} set={set} opciones={opciones} />}
      {paso.id === "monto" && <PasoMonto b={b} set={set} base={base} convertido={convertido} M={M} />}
      {paso.id === "fecha" && <PasoFecha b={b} set={set} />}
      {paso.id === "revisar" && (
        <PasoRevisar b={b} set={set} e={e} M={M} base={base} convertido={convertido} modo={modo} opciones={opciones} />
      )}
      {volverARevisar}
    </Asistente>
  );
}

type Poner = (c: Partial<BorradorGasto>) => void;
type Fmt = (n: number, d?: number) => string;

/* ---------- 1. Qué pagaste ---------- */

function PasoConcepto({ b, set, e, M, onRepetir }: {
  b: BorradorGasto; set: Poner; e: EstadoApp; M: Fmt; onRepetir: (g: Gasto) => void;
}) {
  const q = b.concepto.trim();
  const parecidos = useMemo(() => gastosParecidos(q, e), [q, e]);

  const escribir = (concepto: string) => {
    if (b.categoriaElegida) { set({ concepto, copiadoDe: undefined }); return; }
    /* Mientras nadie la eligió a mano, la categoría sigue a lo que se escribe. */
    const s = sugerirCategoria(concepto, e);
    set({ concepto, copiadoDe: undefined, categoria: s?.categoria ?? "", grupo: s?.grupo ?? "operativo", nueva: false });
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
                sub={[g.categoria, M(g.monto), fechaLarga(g.fecha), g.proveedor].filter(Boolean).join(" · ")}
                activo={b.copiadoDe === g.id} onClick={() => onRepetir(g)}
              />
            ))}
          </div>
          <span className="t-sm t-subtle">
            Si es el mismo gasto de otro mes, elegilo: pasás directo a revisarlo, con la categoría, el monto y el proveedor que tenía.
          </span>
        </div>
      )}
    </>
  );
}

/* ---------- 2. Categoría ---------- */

function PasoCategoria({ b, set, e }: { b: BorradorGasto; set: Poner; e: EstadoApp }) {
  /* La vista se decide al entrar al paso y no se mueve sola: elegir una
     categoría de la grilla (o buscar una y que quede una sola) no puede
     cambiar la pantalla de golpe, y menos mientras se está escribiendo. */
  const [grilla, setGrilla] = useState(() => mostrarGrilla(b.categoria, false));
  /* La sugerencia se nombra sólo si vino de lo escrito, no si la eligió alguien. */
  const sugerida = !b.categoriaElegida && b.categoria ? b.categoria : null;

  if (!grilla) {
    return (
      <>
        <Pregunta
          texto="¿Va en esta categoría?"
          sub={sugerida
            ? "La sugerimos por lo que escribiste. Si no es, cambiala."
            : "Ya la elegiste. Seguí o cambiala."}
        />
        <TarjetaCategoria b={b} textoBoton="Cambiar categoría" onCambiar={() => setGrilla(mostrarGrilla(b.categoria, true))} />
      </>
    );
  }
  return (
    <>
      <Pregunta
        texto="¿En qué categoría va?"
        sub={b.categoria
          ? "Elegí la que corresponda: define en qué renglón del estado de resultados cae."
          : "Define en qué renglón del estado de resultados cae."}
      />
      <SelectorCategoria b={b} set={set} e={e} />
    </>
  );
}

/* La categoría ya elegida, con su bloque y el renglón del estado de
   resultados en el que cae: se confirma de un vistazo. */
function TarjetaCategoria({ b, textoBoton, onCambiar }: { b: BorradorGasto; textoBoton: string; onCambiar: () => void }) {
  const g = infoGrupo(b.grupo);
  return (
    <div className="gasto-cat" role="group" aria-label="Categoría elegida">
      <span className="gasto-cat__tilde"><Check size={16} /></span>
      <div className="gasto-cat__datos">
        <span className="gasto-cat__nombre">Va en: <strong>{b.categoria}</strong> <span className="t-subtle">· {g.tipo}</span></span>
        <span className="t-sm t-subtle">{g.renglon}</span>
      </div>
      <Button sm variante="ghost" onClick={onCambiar}>{textoBoton}</Button>
    </div>
  );
}

/* Todas las categorías, por bloque, para elegir una. */
function SelectorCategoria({ b, set, e, autoElegirUnica = true, enfocar = false, alTerminar }: {
  b: BorradorGasto; set: Poner; e: EstadoApp;
  /* Si lo que se busca deja una sola categoría, queda elegida (Enter y listo). */
  autoElegirUnica?: boolean;
  enfocar?: boolean;
  /* Para cuando la grilla se abre adentro de otra pantalla: se llama al
     elegir una tarjeta y al apretar Esc, para que la cierre. */
  alTerminar?: () => void;
}) {
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
    if (!autoElegirUnica) return;
    const quedan = filtrar(texto);
    if (texto.trim() && quedan.length === 1) elegir(quedan[0]);
  };

  const nombreNuevo = busca.trim();
  const existe = todas.some((c) => normalizar(c.categoria) === normalizar(nombreNuevo));
  /* Crear se ofrece cuando lo escrito no encuentra nada: mientras hay
     coincidencias, lo más probable es que la categoría ya exista. */
  const puedeCrear = nombreNuevo.length >= 3 && !existe && visibles.length === 0;

  /* Los números 1 a 9 eligen en el orden en que se ven, a través de los grupos. */
  let n = 0;

  return (
    <>
      <Input
        icono={<Search size={16} />} value={busca} onChange={(ev) => buscar(ev.target.value)}
        placeholder="Buscá: meta, contador, sueldos…" aria-label="Buscar categoría" autoFocus={enfocar}
        onKeyDown={(ev) => {
          /* Flecha abajo baja a las tarjetas, para elegir sin el mouse. */
          if (ev.key === "ArrowDown") {
            const primera = (ev.currentTarget.closest(".asistente__paso") as HTMLElement | null)?.querySelector<HTMLElement>(".opcion");
            if (primera) { ev.preventDefault(); primera.focus(); }
          }
          /* En la revisión, Enter no puede cargar el gasto con la categoría de
             antes mientras se está eligiendo otra: elige la única que quedó, o no
             hace nada. Y Esc cierra la grilla en vez de sacar de la pantalla. */
          if (ev.key === "Enter" && !autoElegirUnica) {
            ev.preventDefault(); ev.stopPropagation();
            if (visibles.length === 1) { elegir(visibles[0]); alTerminar?.(); }
          } else if (ev.key === "Escape" && alTerminar) {
            ev.preventDefault(); ev.stopPropagation(); alTerminar();
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
              <span className="t-sm t-subtle">{g.renglon}</span>
            </div>
            <div className="opciones">
              {cats.map((c) => {
                n++;
                return (
                  <Opcion
                    key={c.categoria} tecla={n <= 9 ? String(n) : undefined}
                    nombre={c.categoria} sub={c.ayuda}
                    activo={!b.nueva && b.categoria === c.categoria} onClick={() => { elegir(c); alTerminar?.(); }}
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
          <span className="t-sm t-subtle">{infoGrupo(b.grupo).renglon}</span>
        </div>
      )}
    </>
  );
}

/* ---------- 3. A quién le pagaste ---------- */

function PasoProveedor({ b, set, opciones }: { b: BorradorGasto; set: Poner; opciones: OpcionProveedor[] }) {
  /* El casillero se pinta de error cuando se sale sin elegir, no antes. */
  const [salio, setSalio] = useState(false);
  const deEquipo = esCategoriaDeEquipo(b.categoria, b.grupo);
  return (
    <>
      <Pregunta
        texto="¿A quién le pagaste?"
        sub={deEquipo
          ? "Elegí a la persona del equipo. Si no está, escribí su nombre."
          : "Elegí un proveedor que ya usaste o a alguien del equipo. Si es nuevo, escribilo."}
      />
      <CampoProveedor
        id="gasto-proveedor" aria-label="Proveedor" enLinea autoFocus
        value={b.proveedor} onChange={(proveedor) => set({ proveedor })} opciones={opciones}
        error={salio && !esProveedorValido(b.proveedor)} onBlur={() => setSalio(true)}
      />
    </>
  );
}

/* ---------- 4. Monto ---------- */

function PasoMonto({ b, set, base, convertido, M }: {
  b: BorradorGasto; set: Poner; base: Moneda; convertido: number; M: Fmt;
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
        <InputMonto
          crudo value={b.monto} onChange={(ev) => set({ monto: ev.target.value })}
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
            <InputMonto
              id="gasto-tc" decimales={4}
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

/* ---------- 5. Fecha y si se repite ---------- */

function PasoFecha({ b, set }: { b: BorradorGasto; set: Poner }) {
  return (
    <>
      <Pregunta
        texto="¿Cuándo lo pagaste?"
        sub={b.fechaPago
          ? "Un mes decide dónde resta del estado de resultados; el día que se pagó, cuándo sale de la caja."
          : "Decide en qué mes resta del estado de resultados y cuándo sale de la caja. Casi siempre es el mismo día."}
      />
      <CampoFechasGasto b={b} set={set} id="paso" />
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

/* ---------- 6. Revisá y cargá ----------
   Todo junto y editable ahí mismo: es donde cae quien repite un gasto (con
   todo ya puesto), quien edita uno y quien terminó de contestar las
   preguntas. Cada casillero que falta se pinta de error; mientras falte
   algo, el botón de cargar queda trabado. */

function PasoRevisar({ b, set, e, M, base, convertido, modo, opciones }: {
  b: BorradorGasto; set: Poner; e: EstadoApp; M: Fmt; base: Moneda; convertido: number;
  modo: ModoCarga; opciones: OpcionProveedor[];
}) {
  const [cambiando, setCambiando] = useState(false);
  const webinars = useMemo(
    () => [...e.webinars].sort((a, c) => +new Date(c.fecha) - +new Date(a.fecha)).slice(0, 24),
    [e.webinars],
  );
  const embudos = useMemo(() => e.embudos.filter((x) => x.activo || x.id === b.embudoId).sort((a, c) => a.orden - c.orden), [e.embudos, b.embudoId]);
  const problemas = problemasDelGasto(b, base);
  const otra = b.moneda !== base;
  const origen = modo === "repetir" ? e.gastos.find((x) => x.id === b.copiadoDe) : undefined;

  /* Al repetir un gasto lo que casi siempre falta es el proveedor (los de la
     planilla no lo traen): el cursor queda ahí, sin abrir la lista para no
     tapar la revisión. Se espera a que termine la animación del paso y a que
     nadie haya tocado otra cosa. */
  const faltaProveedor = Boolean(problemas.proveedor);
  useEffect(() => {
    if (modo !== "repetir" || !faltaProveedor) return;
    const t = window.setTimeout(() => {
      const activo = document.activeElement;
      if (activo && activo !== document.body && activo.id !== "gasto-concepto") return;
      const campo = document.getElementById("gasto-proveedor");
      if (!campo) return;
      campo.dataset.sinLista = "1";
      campo.focus();
    }, 380);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <Pregunta
        texto={modo === "editar" ? "Así está el gasto" : modo === "repetir" ? "Revisá y cargá" : "Así queda el gasto"}
        sub={modo === "editar"
          ? "Corregí lo que haga falta y guardá."
          : modo === "repetir"
            ? `Salió de «${origen?.concepto ?? b.concepto.trim()}»${origen ? `, del ${fechaLarga(origen.fecha)}` : ""}. Cambiá lo que sea distinto esta vez.`
            : "Revisá y cargalo. Podés corregir lo que haga falta acá mismo."}
      />

      <div className="form-grid">
        <div className="hk-field span-2">
          <label className="hk-label" htmlFor="gasto-concepto">Qué pagaste</label>
          <Input
            id="gasto-concepto" value={b.concepto} onChange={(ev) => set({ concepto: ev.target.value })}
            placeholder="Contador de septiembre" error={Boolean(problemas.concepto)}
          />
        </div>

        <div className="hk-field span-2">
          <span className="hk-label">Categoría</span>
          {b.categoria.trim() && (
            <TarjetaCategoria b={b} textoBoton={cambiando ? "Listo" : "Cambiar"} onCambiar={() => setCambiando((v) => !v)} />
          )}
          {mostrarGrilla(b.categoria, cambiando) && (
            <div className="gasto-selector">
              <SelectorCategoria b={b} set={set} e={e} autoElegirUnica={false} enfocar alTerminar={() => setCambiando(false)} />
            </div>
          )}
        </div>

        <div className="hk-field">
          <label className="hk-label" htmlFor="gasto-monto">Monto</label>
          <InputMonto
            id="gasto-monto" value={b.monto} onChange={(ev) => set({ monto: ev.target.value })}
            icono={<span className="gasto-signo">{b.moneda === "USD" ? "US$" : "$"}</span>}
            placeholder="0" error={Boolean(problemas.monto)}
          />
          <div className="row-wrap">
            <Chip activo={b.moneda === "USD"} onClick={() => set({ moneda: "USD" })}>Dólares (US$)</Chip>
            <Chip activo={b.moneda === "ARS"} onClick={() => set({ moneda: "ARS" })}>Pesos ($)</Chip>
          </div>
        </div>

        <div className={b.fechaPago ? "span-2" : undefined}>
          <CampoFechasGasto b={b} set={set} problemas={problemas} id="gasto" />
        </div>

        {otra && (
          <>
            <div className="hk-field">
              <label className="hk-label" htmlFor="gasto-tc">Tipo de cambio</label>
              <InputMonto
                id="gasto-tc" decimales={4} value={b.tipoCambio} error={Boolean(problemas.tipoCambio)}
                onChange={(ev) => set({ tipoCambio: ev.target.value })}
              />
              <span className="hk-help">{modo === "editar" ? "Pesos por dólar: el que se usó al cargarlo." : "Pesos por dólar. Arranca en el de Ajustes."}</span>
            </div>
            <div className="hk-field">
              <span className="hk-label">Suma en el estado de resultados</span>
              <span className="gasto-equivale t-num">{convertido > 0 ? M(convertido) : "—"}</span>
            </div>
          </>
        )}

        <div className="hk-field span-2">
          <label className="hk-label" htmlFor="gasto-proveedor">Proveedor</label>
          <CampoProveedor
            id="gasto-proveedor" value={b.proveedor} onChange={(proveedor) => set({ proveedor })}
            opciones={opciones} error={Boolean(problemas.proveedor)}
          />
        </div>

        <div className="hk-field span-2">
          <span className="hk-label">¿Se repite?</span>
          <div className="gasto-chips">
            <Chip activo={b.recurrente} onClick={() => set({ recurrente: true })}>Fijo</Chip>
            <Chip activo={!b.recurrente} onClick={() => set({ recurrente: false })}>Variable</Chip>
            <span className="t-sm t-subtle">{b.recurrente ? "Se paga todos los meses." : "Esta vez sola, o cambia mes a mes."}</span>
          </div>
        </div>

        <span className="t-label span-2 gasto-opcional">Opcional</span>

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
        {embudos.length > 0 && (
          <div className="hk-field">
            <label className="hk-label" htmlFor="gasto-embudo">Estrategia (embudo)</label>
            <Select
              id="gasto-embudo" value={b.embudoId} placeholder="De toda la empresa"
              onChange={(ev) => set({ embudoId: ev.target.value })}
              opciones={embudos.map((x) => ({ valor: x.id, texto: x.nombre }))}
            />
            <span className="hk-help">Si es de un embudo (la VSL, el setter), entra en su CAC y su profit. Los fijos, sin embudo.</span>
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
