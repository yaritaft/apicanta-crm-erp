"use client";

import React, { useMemo, useState } from "react";
import {
  ArrowDownUp, Check, EyeOff, Info, Plus, RefreshCw, Search, Sparkles, Undo2, Upload,
} from "lucide-react";
import { PageHead } from "@/components/shell/PageHead";
import {
  Ayuda, Badge, Button, Card, Chip, Empty, Field, Input, Select, StatCard, Textarea,
} from "@/components/ui/ui";
import { ModalForm } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { AsistenteVenta } from "@/components/ventas/AsistenteVenta";
import { acciones, useEstado } from "@/lib/store";
import { nube } from "@/lib/supabase";
import { fechaLarga, money, pct } from "@/lib/format";
import {
  esAutomatica, propuestas, resumenConciliacion, saldoDeCuota, sugerenciasPara,
  type Sugerencia,
} from "@/lib/conciliacion";
import { importarCSV, PASARELAS, nombrePasarela } from "@/lib/pasarelas";
import type { EstadoMovimiento2, Movimiento, ProveedorPasarela } from "@/lib/types";

/* ==================================================================
   Bandeja de conciliación.

   Todo lo que cobró una pasarela entra acá sin dueño. Conciliar es
   decirle a qué cuota pertenece: recién entonces se convierte en un
   pago y mueve el cash collected. Apicanta propone, la persona firma.
   ================================================================== */

export default function Conciliacion() {
  const e = useEstado();
  const toast = useToast();
  const mon = e.ajustes.monedaBase;
  const M = (n: number, d = 0) => money(n, mon, d);

  const [filtro, setFiltro] = useState<EstadoMovimiento2>("pendiente");
  const [pasarela, setPasarela] = useState<ProveedorPasarela | "todas">("todas");
  const [abierto, setAbierto] = useState<string | null>(null);
  const [importar, setImportar] = useState(false);
  const [nuevaVenta, setNuevaVenta] = useState<Movimiento | null>(null);
  const [sincronizando, setSincronizando] = useState(false);

  const resumen = resumenConciliacion(e);

  const filas = useMemo(() => {
    return e.movimientos
      .filter((m) => m.estado === filtro && (pasarela === "todas" || m.proveedor === pasarela))
      .sort((a, b) => +new Date(b.fecha) - +new Date(a.fecha));
  }, [e.movimientos, filtro, pasarela]);

  function conciliarTodosLosSeguros() {
    const autos = propuestas(e).filter((p) => p.automatica);
    let hechos = 0;
    for (const p of autos) {
      const s = p.sugerencias[0];
      if (acciones.conciliar(p.movimiento.id, [{ cuotaId: s.cuotaId, monto: p.movimiento.monto }])) hechos++;
    }
    toast(hechos === 0 ? "No había cobros con calce seguro." : `Se conciliaron ${hechos} cobros.`);
  }

  async function sincronizar() {
    setSincronizando(true);
    try {
      /* La ruta devuelve datos de clientes: va con la sesión de quien pide. */
      const sesion = nube ? (await nube.auth.getSession()).data.session : null;
      const r = await fetch("/api/pasarelas/sync", {
        headers: sesion ? { Authorization: `Bearer ${sesion.access_token}` } : {},
      });
      const data = (await r.json()) as {
        movimientos?: Parameters<typeof acciones.importarMovimientos>[0];
        conectadas?: ProveedorPasarela[];
        errores?: { proveedor: string; mensaje: string }[];
        error?: string;
      };
      if (!r.ok) throw new Error(data.error ?? "No se pudo sincronizar.");
      if (data.errores?.length) {
        toast(`${nombrePasarela(data.errores[0].proveedor as ProveedorPasarela)}: ${data.errores[0].mensaje}`, "err");
      }
      if (!data.conectadas?.length) {
        toast("Todavía no hay pasarelas conectadas: faltan las claves. Mientras tanto, importá el CSV.", "err");
        return;
      }
      /* El procesador es cosa de Apicanta, no de la pasarela: se ata acá. */
      const conMedio = (data.movimientos ?? []).map((m) => ({
        ...m, procesadorId: e.procesadores.find((p) => p.proveedor === m.proveedor)?.id,
      }));
      const { nuevos, repetidos } = acciones.importarMovimientos(conMedio, "api");
      toast(nuevos === 0
        ? `Sin cobros nuevos (${repetidos} ya estaban).`
        : `Entraron ${nuevos} cobros de ${data.conectadas.map(nombrePasarela).join(", ")}.`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "No se pudo sincronizar.", "err");
    } finally {
      setSincronizando(false);
    }
  }

  return (
    <div className="stack-5">
      <PageHead
        titulo="Conciliación"
        sub="Los cobros que entraron a Stripe, Hotmart, Whop, dLocal, Mercado Pago, Mercury, Binance o Trust, y a qué cuota corresponde cada uno."
        acciones={
          <>
            <Button variante="secondary" icono={<Upload size={16} />} onClick={() => setImportar(true)}>Importar</Button>
            <Button variante="secondary" icono={<RefreshCw size={16} />} cargando={sincronizando} onClick={sincronizar}>
              Sincronizar
            </Button>
          </>
        }
      />

      <div className="grid-stats">
        <StatCard hero etiqueta="Sin conciliar" valor={M(resumen.sinConciliar)} contexto={`${resumen.pendientes} cobros esperando`} />
        <StatCard etiqueta="Calce seguro" valor={String(resumen.automaticos)} contexto={`${M(resumen.montoAutomatico)} listos para imputar`} />
        <StatCard etiqueta="Conciliados" valor={String(resumen.conciliados)} contexto="cobros ya imputados" />
        <StatCard etiqueta="Fee de pasarelas" valor={M(resumen.feeReal)} contexto="lo que se quedaron, real" />
      </div>

      {filtro === "pendiente" && resumen.automaticos > 0 && (
        <div className="help-card">
          <Sparkles size={18} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="help-card__title">
              {resumen.automaticos} {resumen.automaticos === 1 ? "cobro calza" : "cobros calzan"} exacto con una cuota
            </div>
            <div className="help-card__text">
              Mismo monto, mismo cliente y una sola candidata. Podés imputarlos de una y revisar después.
            </div>
          </div>
          <Button variante="primary" icono={<Check size={16} />} onClick={conciliarTodosLosSeguros}>
            Conciliar {resumen.automaticos}
          </Button>
        </div>
      )}

      <Card style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "var(--space-4)" }}>
          <div className="toolbar" style={{ marginBottom: 0 }}>
            {([["pendiente", "Pendientes"], ["conciliado", "Conciliados"], ["ignorado", "Ignorados"]] as const).map(([k, t]) => (
              <Chip key={k} activo={filtro === k} onClick={() => setFiltro(k)}
                count={e.movimientos.filter((m) => m.estado === k).length}>{t}</Chip>
            ))}
            <span className="spacer" />
            <Select
              value={pasarela} onChange={(ev) => setPasarela(ev.target.value as ProveedorPasarela | "todas")}
              opciones={[
                { valor: "todas", texto: "Todas las pasarelas" },
                ...PASARELAS.map((p) => ({ valor: p.id, texto: p.nombre })),
              ]}
            />
          </div>
        </div>

        <div style={{ padding: "0 var(--space-4) var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          {filas.length === 0 ? (
            <Empty
              icono={<ArrowDownUp size={22} />}
              titulo={filtro === "pendiente" ? "No queda nada sin conciliar" : "Nada por acá"}
              texto={filtro === "pendiente"
                ? "Cuando entre plata a una pasarela, el cobro aparece en esta bandeja hasta que se impute a una cuota."
                : "Los cobros que vayas conciliando o ignorando quedan guardados en esta pestaña."}
              accion={filtro === "pendiente"
                ? <Button variante="brand" icono={<Upload size={16} />} onClick={() => setImportar(true)}>Importar cobros</Button>
                : undefined}
            />
          ) : (
            filas.map((m) => (
              <FilaMovimiento
                key={m.id} mov={m} M={M}
                abierto={abierto === m.id}
                onAbrir={() => setAbierto(abierto === m.id ? null : m.id)}
                onNuevaVenta={() => setNuevaVenta(m)}
              />
            ))
          )}
        </div>
      </Card>

      <Ayuda titulo="Por qué la plata no entra sola al P&L" icono={<Info size={18} />}>
        Un cobro de pasarela no es un pago hasta que se sabe de qué cuota es. Mientras está sin conciliar
        se ve acá, pero no cuenta como cash collected ni genera comisión: si contara, el mismo peso podría
        quedar contado dos veces cuando alguien cargue el pago a mano. Al conciliar, el fee que se guarda
        es el que cobró la pasarela de verdad, no el estimado del procesador.
      </Ayuda>

      {importar && <ModalImportar onCerrar={() => setImportar(false)} />}

      {nuevaVenta && (
        <AsistenteVenta
          desdeMovimiento={nuevaVenta}
          onCerrar={() => setNuevaVenta(null)}
          onListo={(_, nombre) => { setNuevaVenta(null); toast(`Venta de ${nombre} cargada con el cobro ya conciliado.`); }}
        />
      )}
    </div>
  );
}

/* ---------- Una fila de la bandeja ---------- */

function FilaMovimiento({ mov, M, abierto, onAbrir, onNuevaVenta }: {
  mov: Movimiento; M: (n: number, d?: number) => string;
  abierto: boolean; onAbrir: () => void; onNuevaVenta: () => void;
}) {
  const e = useEstado();
  const toast = useToast();
  const [busqueda, setBusqueda] = useState("");

  const sugerencias = useMemo(
    () => (mov.estado === "pendiente" ? sugerenciasPara(e, mov) : []),
    [e, mov],
  );
  const automatica = esAutomatica(sugerencias);

  const manuales = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (q.length < 2) return [];
    return e.cuotas
      .filter((c) => c.estado === "pendiente")
      .map((c) => ({ c, venta: e.ventas.find((v) => v.id === c.ventaId) }))
      .filter((x) => x.venta && x.venta.estado === "activa" && x.venta.contactoNombre.toLowerCase().includes(q))
      .slice(0, 6);
  }, [e, busqueda]);

  function conciliar(cuotaId: string, monto: number) {
    if (acciones.conciliar(mov.id, [{ cuotaId, monto }])) toast("Cobro conciliado.");
    else toast("No se pudo conciliar ese cobro.", "err");
  }

  /* En la fila el nombre ya está: el badge dice a qué cuota fue a parar. */
  const cuota = mov.cuotaId ? e.cuotas.find((c) => c.id === mov.cuotaId) : undefined;
  const destino = cuota ? (cuota.esReserva ? "Reserva" : `Cuota ${cuota.numero}`) : "Conciliado";

  return (
    <div className="mov" data-abierto={abierto}>
      <button type="button" className="mov__head" onClick={onAbrir} aria-expanded={abierto}>
        <span className="mov__marca">{nombrePasarela(mov.proveedor).slice(0, 2).toUpperCase()}</span>
        <span style={{ minWidth: 0 }}>
          <span className="mov__cliente truncate" style={{ display: "block" }}>{mov.clienteNombre ?? "Sin nombre"}</span>
          <span className="mov__meta truncate" style={{ display: "block" }}>
            {fechaLarga(mov.fecha)} · {mov.referencia}{mov.descripcion ? ` · ${mov.descripcion}` : ""}
          </span>
        </span>
        <span className="spacer" />
        {mov.estado === "pendiente" && automatica && <Badge variante="success"><Sparkles size={13} />Calce seguro</Badge>}
        {mov.estado === "conciliado" && (
          <Badge variante="neutral"><Check size={13} />{destino}</Badge>
        )}
        {mov.estado === "ignorado" && <Badge variante="neutral">Ignorado</Badge>}
        <span className="mov__monto">{M(mov.monto, 2)}</span>
      </button>

      {abierto && (
        <div className="mov__body">
          <dl className="dl">
            <dt>Pasarela</dt><dd>{nombrePasarela(mov.proveedor)}</dd>
            <dt>Bruto</dt><dd className="t-num">{M(mov.monto, 2)}</dd>
            <dt>Fee</dt><dd className="t-num">{M(mov.fee, 2)} {mov.monto > 0 && <span className="t-subtle">({pct((mov.fee / mov.monto) * 100, 1)})</span>}</dd>
            <dt>Neto</dt><dd className="t-num">{M(mov.neto, 2)}</dd>
            {mov.clienteEmail && <><dt>Correo</dt><dd>{mov.clienteEmail}</dd></>}
          </dl>

          {mov.estado === "pendiente" ? (
            <>
              <div className="t-label">A qué cuota corresponde</div>
              {sugerencias.length === 0 && (
                <p className="t-sm t-muted">
                  Ninguna cuota pendiente se parece a este cobro. Puede ser de una venta que todavía no está cargada.
                </p>
              )}
              {sugerencias.map((s, k) => (
                <SugerenciaFila key={s.cuotaId} s={s} mov={mov} M={M} destacada={k === 0 && automatica}
                  onConciliar={() => conciliar(s.cuotaId, Math.min(mov.monto, s.saldo))} />
              ))}

              <div className="stack-2" style={{ marginTop: 4 }}>
                <div className="t-label">Buscarla a mano</div>
                <Input icono={<Search size={15} />} value={busqueda} placeholder="Nombre del cliente"
                  onChange={(ev) => setBusqueda(ev.target.value)} />
                {manuales.map(({ c, venta: v }) => (
                  <div className="row" key={c.id} style={{ gap: 8 }}>
                    <span className="t-sm t-strong">{v?.contactoNombre}</span>
                    <span className="t-sm t-subtle">{c.esReserva ? "Reserva" : `Cuota ${c.numero}`}</span>
                    <span className="spacer t-sm t-num">falta {M(saldoDeCuota(e, c), 2)}</span>
                    <Button sm variante="secondary" onClick={() => conciliar(c.id, Math.min(mov.monto, saldoDeCuota(e, c)))}>
                      Imputar acá
                    </Button>
                  </div>
                ))}
              </div>

              <div className="row-wrap" style={{ marginTop: 4 }}>
                <Button sm variante="ghost" icono={<Plus size={14} />} onClick={onNuevaVenta}>
                  Cargar la venta de este cobro
                </Button>
                <Button sm variante="ghost" icono={<EyeOff size={14} />}
                  onClick={() => { acciones.marcarMovimiento(mov.id, "ignorado"); toast("Cobro ignorado."); }}>
                  Ignorar
                </Button>
              </div>
            </>
          ) : mov.estado === "conciliado" ? (
            <div className="row-wrap">
              <span className="t-sm t-muted">
                Imputado {mov.conciliadoEn ? `el ${fechaLarga(mov.conciliadoEn)}` : ""}
                {mov.conciliadoPor ? ` por ${mov.conciliadoPor}` : ""}.
              </span>
              <Button sm variante="ghost" icono={<Undo2 size={14} />} className="spacer"
                onClick={() => { acciones.desconciliar(mov.id); toast("Se deshizo la conciliación."); }}>
                Deshacer
              </Button>
            </div>
          ) : (
            <Button sm variante="secondary" onClick={() => { acciones.marcarMovimiento(mov.id, "pendiente"); toast("Vuelve a la bandeja."); }}>
              Volver a pendientes
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function SugerenciaFila({ s, mov, M, destacada, onConciliar }: {
  s: Sugerencia; mov: Movimiento; M: (n: number, d?: number) => string;
  destacada: boolean; onConciliar: () => void;
}) {
  return (
    <div className="sug" data-fuerte={destacada}>
      <span className="sug__puntaje">
        <span className="sug__puntaje-n">{s.puntaje}</span>
        <span className="sug__puntaje-l">calce</span>
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span className="row" style={{ gap: 8 }}>
          <span className="t-strong">{s.contacto}</span>
          <span className="t-sm t-subtle">{s.etiqueta}{s.vence ? ` · vence ${fechaLarga(s.vence)}` : ""}</span>
          <span className="spacer t-sm t-num">falta {M(s.saldo, 2)}</span>
        </span>
        <span className="sug__motivos">
          {s.motivos.map((m) => <span className="motivo" key={m}><Check size={11} />{m}</span>)}
          {s.reparos.map((m) => <span className="motivo motivo--reparo" key={m}>{m}</span>)}
        </span>
        {(s.dejaSaldo > 0.01 || s.sobra > 0.01) && (
          <span className="t-sm t-subtle" style={{ display: "block", marginTop: 6 }}>
            {s.dejaSaldo > 0.01
              ? `Si lo imputás acá, la cuota queda con ${M(s.dejaSaldo, 2)} pendientes.`
              : `Sobran ${M(s.sobra, 2)} de este cobro para imputar a otra cuota.`}
          </span>
        )}
      </span>
      <Button sm variante={destacada ? "brand" : "secondary"} onClick={onConciliar}>
        Conciliar {M(Math.min(mov.monto, s.saldo), 2)}
      </Button>
    </div>
  );
}

/* ---------- Importar un CSV ---------- */

function ModalImportar({ onCerrar }: { onCerrar: () => void }) {
  const e = useEstado();
  const toast = useToast();
  const mon = e.ajustes.monedaBase;
  const [proveedor, setProveedor] = useState<ProveedorPasarela>("stripe");
  const [texto, setTexto] = useState("");

  const ficha = PASARELAS.find((p) => p.id === proveedor);
  const procesador = e.procesadores.find((p) => p.proveedor === proveedor);

  const previo = useMemo(() => {
    if (texto.trim().length < 10) return null;
    return importarCSV(texto, proveedor, procesador?.id, procesador?.feeRate ?? 0);
  }, [texto, proveedor, procesador]);

  return (
    <ModalForm
      abierto onCerrar={onCerrar} ancho
      titulo="Importar cobros"
      sub="Pegá el CSV que exporta la pasarela. Los cobros repetidos se descartan solos por su referencia."
      guardarTexto={previo ? `Importar ${previo.movimientos.length}` : "Importar"}
      puedeGuardar={Boolean(previo && previo.movimientos.length > 0)}
      onGuardar={() => {
        if (!previo) return;
        const { nuevos, repetidos } = acciones.importarMovimientos(previo.movimientos, "csv");
        toast(nuevos === 0
          ? `Ya estaban los ${repetidos} cobros del archivo.`
          : `Entraron ${nuevos} cobros${repetidos > 0 ? ` (${repetidos} ya estaban)` : ""}.`);
        onCerrar();
      }}
    >
      <div className="form-grid">
        <Field label="Pasarela" span2 ayuda={ficha?.comoExportar}>
          <Select value={proveedor} onChange={(ev) => setProveedor(ev.target.value as ProveedorPasarela)}
            opciones={PASARELAS.map((p) => ({ valor: p.id, texto: p.nombre }))} />
        </Field>
        <Field label="Contenido del CSV" span2
          ayuda={procesador ? `Se registran como ${procesador.nombre}.` : "No hay un procesador con esta pasarela: se van a cargar sin medio de pago."}>
          <Textarea rows={8} value={texto} onChange={(ev) => setTexto(ev.target.value)}
            placeholder={'id,Created date (UTC),Amount,Fee,Currency,Customer Email,Customer Name,Description\npi_3Q…,2026-09-12,2500,72.50,usd,ana@mail.com,Ana Ruiz,Mentoría'} />
        </Field>
      </div>

      {previo && (
        <div className="stack-2">
          <div className="row">
            <span className="t-label">Lo que se va a importar</span>
            <span className="spacer t-sm t-num t-strong">
              {money(previo.movimientos.reduce((a, m) => a + m.monto, 0), mon, 2)}
            </span>
          </div>
          {previo.movimientos.slice(0, 5).map((m) => (
            <div className="row t-sm" key={m.referencia} style={{ gap: 8 }}>
              <span className="t-strong truncate">{m.clienteNombre ?? m.referencia}</span>
              <span className="t-subtle">{fechaLarga(m.fecha)}</span>
              <span className="spacer t-num">{money(m.monto, mon, 2)}</span>
              <span className="t-subtle t-num">fee {money(m.fee, mon, 2)}</span>
            </div>
          ))}
          {previo.movimientos.length > 5 && (
            <span className="t-sm t-subtle">y {previo.movimientos.length - 5} más.</span>
          )}
          {previo.descartadas.length > 0 && (
            <span className="t-sm" style={{ color: "var(--warning)" }}>
              {previo.descartadas.length === 1
                ? `Se saltea 1 fila: ${previo.descartadas[0].motivo}`
                : `Se saltean ${previo.descartadas.length} filas. La primera: ${previo.descartadas[0].motivo}`}
            </span>
          )}
        </div>
      )}
    </ModalForm>
  );
}
