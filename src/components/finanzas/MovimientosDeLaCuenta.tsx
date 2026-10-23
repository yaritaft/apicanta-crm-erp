"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Badge, Button, Chip, type VarianteBadge } from "@/components/ui/ui";
import { DataTable, type Columna } from "@/components/ui/DataTable";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { AsistenteGasto } from "@/components/finanzas/AsistenteGasto";
import { useEstado } from "@/lib/store";
import { fechaLarga, money } from "@/lib/format";
import { traerMovimientosDelBanco } from "@/lib/saldos-cliente";
import {
  borradorDesdeElBanco, cruzarConLaApp, resumenDeLoQueFalta, TEXTO_DEL_TIPO, type EstadoEnLaApp, type MovimientoCruzado, type MovimientoDelBanco,
} from "@/lib/movimientos-del-banco";

/* ==================================================================
   «Qué pasó en la cuenta»: lo que movió de verdad Mercury o Stripe desde el último arqueo, cada movimiento con su estado en la app.

   Aldana (22/10): «el saldo de Mercury está bien, pero no encuentro dónde queda lo que consume Yari (un café, el teatro) ni el cashback»;
   «Stripe marca diferencia y sólo hubo un movimiento». Lo que sale del banco y no es un cobro no se guardaba en ningún lado: cuando el
   saldo no daba, no había con qué explicarlo. Acá se ve todo, se marca lo que ya está cargado (o parece estarlo) y lo que falta se carga
   de una, con el monto, el día y la cuenta puestos.
   ================================================================== */

const VARIANTE: Record<EstadoEnLaApp, VarianteBadge> = { cargado: "success", parecido: "info", "no-se-carga": "neutral", falta: "warning" };
const TEXTO: Record<EstadoEnLaApp, string> = { cargado: "Cargado", parecido: "Parece cargado", "no-se-carga": "No se carga", falta: "Falta cargar" };

type Fila = MovimientoCruzado & { id: string };

export function MovimientosDeLaCuenta({ cuentaId, desde, onCerrar }: { cuentaId: string; desde: string; onCerrar: () => void }) {
  const e = useEstado();
  const toast = useToast();
  const cuenta = e.procesadores.find((p) => p.id === cuentaId);
  const [estado, setEstado] = useState<{ cargando: boolean; error?: string; movs: MovimientoDelBanco[]; avisos: string[]; conectada: boolean }>({ cargando: true, movs: [], avisos: [], conectada: true });
  const [filtro, setFiltro] = useState<"falta" | "todos">("falta");
  const [cargando, setCargando] = useState<{ mov: MovimientoDelBanco; comoIngreso: boolean } | null>(null);

  const leer = useCallback(async () => {
    setEstado((x) => ({ ...x, cargando: true, error: undefined }));
    try {
      const r = await traerMovimientosDelBanco(cuentaId, desde);
      setEstado({ cargando: false, movs: r.movimientos, avisos: r.avisos, conectada: r.conectada });
    } catch (err) {
      setEstado((x) => ({ ...x, cargando: false, error: err instanceof Error ? err.message : "No se pudieron leer los movimientos." }));
    }
  }, [cuentaId, desde]);
  useEffect(() => { void leer(); }, [leer]);

  const cruzados: Fila[] = useMemo(() => cruzarConLaApp(e, estado.movs).map((m) => ({ ...m, id: m.ref })), [e, estado.movs]);
  const faltan = useMemo(() => resumenDeLoQueFalta(cruzados), [cruzados]);
  const visibles = filtro === "falta" ? cruzados.filter((m) => m.estadoApp === "falta" || m.estadoApp === "parecido") : cruzados;
  const M = (n: number, d = 2) => money(n, "USD", d);
  const nombre = cuenta?.nombre ?? cuentaId;

  const columnas: Columna<Fila>[] = [
    { clave: "fecha", titulo: "Fecha", tipo: "secondary", orden: (m) => m.fecha, celda: (m) => fechaLarga(m.fecha) },
    {
      clave: "que", titulo: "Qué", tipo: "primary", orden: (m) => m.contraparte,
      celda: (m) => (
        <span style={{ display: "block", minWidth: 0 }}>
          <span className="truncate" style={{ display: "block", maxWidth: 300 }} title={m.contraparte}>{m.contraparte || TEXTO_DEL_TIPO[m.tipo]}</span>
          <span className="t-sm t-subtle truncate" style={{ display: "block", maxWidth: 300 }} title={m.detalle}>{TEXTO_DEL_TIPO[m.tipo]}{m.pendiente ? " · todavía no asentado" : ""}{m.detalle ? ` · ${m.detalle}` : ""}</span>
        </span>
      ),
    },
    {
      clave: "monto", titulo: "Monto", tipo: "num", orden: (m) => m.monto,
      celda: (m) => <span style={{ color: m.monto > 0 ? "var(--success)" : undefined }}>{m.monto > 0 ? "+" : "−"}{M(Math.abs(m.monto))}</span>,
    },
    {
      clave: "estado", titulo: "En la app", orden: (m) => TEXTO[m.estadoApp],
      celda: (m) => <span title={m.donde}><Badge variante={VARIANTE[m.estadoApp]}>{TEXTO[m.estadoApp]}</Badge>{m.donde && (m.estadoApp !== "falta" || m.tipo === "contracargo") && <span className="t-sm t-subtle" style={{ display: "block", maxWidth: 360, whiteSpace: "normal" }}>{m.donde}</span>}</span>,
    },
    {
      clave: "accion", titulo: "",
      celda: (m) => {
        if (m.estadoApp === "cargado" || m.estadoApp === "no-se-carga") return null;
        if (m.tipo === "cobro" || m.tipo === "pase") return <span className="t-sm t-subtle">Entra con «Sincronizar»</span>;
        return (
          <span className="row" style={{ gap: 6 }}>
            <Button sm variante={m.estadoApp === "parecido" ? "ghost" : "secondary"} onClick={() => setCargando({ mov: m, comoIngreso: m.monto > 0 })}>
              {m.monto > 0 ? "Cargar como ingreso" : "Cargar como gasto"}
            </Button>
          </span>
        );
      },
    },
  ];

  return (
    <>
      <Modal
        abierto onCerrar={onCerrar} xl titulo={`Qué pasó en ${nombre}`}
        sub={`Lo que movió la cuenta desde el ${fechaLarga(desde)}, y cuánto de eso ya está en la app. Lo que falta es lo que hace que el saldo no dé.`}
        pie={<><Button variante="ghost" onClick={onCerrar}>Cerrar</Button><Button variante="secondary" icono={<RefreshCw size={15} />} cargando={estado.cargando} onClick={() => void leer()}>Volver a mirar</Button></>}
      >
        {estado.error && <p className="t-sm" style={{ color: "var(--danger)" }} role="status">{estado.error}</p>}
        {!estado.cargando && !estado.error && !estado.conectada && <p className="t-sm t-muted">Esta cuenta no está conectada: sus movimientos no se pueden leer solos.</p>}
        {estado.avisos.map((a) => <p key={a} className="t-sm" style={{ color: "var(--warning)", margin: 0 }}>{a}</p>)}
        {estado.cargando && <p className="t-sm t-muted">Leyendo los movimientos de {nombre}…</p>}
        {!estado.cargando && estado.conectada && !estado.error && (
          <div className="stack-3">
            <p className="t-sm" style={{ margin: 0 }}>
              {faltan.n === 0
                ? <><strong>Todo lo que movió la cuenta ya está en la app.</strong> Si el saldo no da, puede ser plata que el banco todavía no asentó.</>
                : <><strong>{faltan.n} {faltan.n === 1 ? "movimiento falta" : "movimientos faltan"} cargar</strong>
                  {faltan.sale > 0 ? <> · salieron {M(faltan.sale)}</> : null}{faltan.entra > 0 ? <> · entraron {M(faltan.entra)}</> : null}.
                  Cargalos y el saldo vuelve a dar.</>}
            </p>
            <div className="row-wrap" role="group" aria-label="Qué mostrar">
              <Chip activo={filtro === "falta"} onClick={() => setFiltro("falta")} count={cruzados.filter((m) => m.estadoApp === "falta" || m.estadoApp === "parecido").length}>Lo que falta</Chip>
              <Chip activo={filtro === "todos"} onClick={() => setFiltro("todos")} count={cruzados.length}>Todos</Chip>
            </div>
            <DataTable
              filas={visibles} columnas={columnas} porPagina={25} ordenInicial={{ clave: "fecha", desc: true }}
              vacio={<p className="t-sm t-muted" style={{ padding: 16 }}>{filtro === "falta" ? "No falta cargar nada." : "La cuenta no tuvo movimientos en esos días."}</p>}
            />
          </div>
        )}
      </Modal>
      {cargando && (
        <AsistenteGasto
          inicial={borradorDesdeElBanco(cargando.mov, nombre, cargando.comoIngreso)}
          onCerrar={() => setCargando(null)}
          onListo={(g) => { setCargando(null); toast(`${g.monto < 0 ? "Ingreso" : "Gasto"} cargado: ${g.concepto}. Ya figura como cargado en la cuenta.`); }}
        />
      )}
    </>
  );
}
