"use client";

import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, Download, Link2, Plug, RefreshCw, Unplug } from "lucide-react";
import { Badge, Button, Card, CardHead, Switch } from "@/components/ui/ui";
import { Confirmar } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { relativo } from "@/lib/format";
import { useUsuarioActual } from "@/lib/usuario";
import { cambiarCargaAutomatica, conectarBofa, desconectarBofa, traerEstadoBofa, traerGastosAhora, type EstadoBofa } from "@/lib/bofa-cliente";

/* ==================================================================
   Bank of America, en Ajustes → Integraciones.

   El banco no tiene una API que la app pueda leer, pero Plaid sí: alguien con acceso a la cuenta (Yari o Manu) la conecta UNA vez entrando con su usuario
   del banco en la ventana de Plaid —la clave la ve el banco, no esta app— y desde ahí:
   - cada hora se cargan solos, de a uno y con su categoría, los gastos nuevos de la cuenta (con las mismas reglas que el CSV del banco);
   - el saldo real de la cuenta se compara con lo que la app espera (Finanzas → Saldos);
   - «Ver qué pasó en la cuenta» (Caja) muestra todo lo que movió el banco.
   Bank of America vence el permiso al año: cuando pase, esta tarjeta avisa y se vuelve a autorizar con un botón.
   ================================================================== */

export function BancoIntegracion() {
  const toast = useToast();
  const yo = useUsuarioActual();
  const [estado, setEstado] = useState<{ cargando: true } | { error: string } | { datos: EstadoBofa }>({ cargando: true });
  const [ocupado, setOcupado] = useState<"" | "conectar" | "traer" | "auto">("");
  const [desconectar, setDesconectar] = useState(false);

  const recargar = useCallback(async () => {
    try {
      setEstado({ datos: await traerEstadoBofa() });
    } catch (err) {
      setEstado({ error: err instanceof Error ? err.message : "No pude ver cómo está la conexión." });
    }
  }, []);
  useEffect(() => { void recargar(); }, [recargar]);

  const d = "datos" in estado ? estado.datos : null;
  const c = d?.conexion ?? null;

  async function conectar(volver: boolean) {
    setOcupado("conectar");
    const r = await conectarBofa(volver, yo.nombre || yo.email || undefined);
    setOcupado("");
    if (r.ok) { toast("Bank of America quedó conectado."); await recargar(); }
    else if (!r.cancelado) toast(r.error ?? "No pude conectar el banco.", "err");
  }

  async function traerAhora() {
    setOcupado("traer");
    try {
      const r = await traerGastosAhora();
      if (r.estado === "error") toast(r.mensaje ?? "No pude leer el banco.", "err");
      else if (r.estado === "no-conectada") toast("El banco todavía no está conectado.", "err");
      else if (r.cargados === 0) toast(r.mensaje ?? "No había gastos nuevos para cargar.");
      else toast(`Se ${r.cargados === 1 ? "cargó 1 gasto" : `cargaron ${r.cargados} gastos`}${r.paraRevisar ? `; ${r.paraRevisar === 1 ? "1 quedó" : `${r.paraRevisar} quedaron`} en «Pendiente de revisión»` : ""}. Recargá la página para verlos.`);
      await recargar();
    } catch (err) {
      toast(err instanceof Error ? err.message : "No pude leer el banco.", "err");
    }
    setOcupado("");
  }

  async function cambiarAuto(activa: boolean) {
    setOcupado("auto");
    try {
      await cambiarCargaAutomatica(activa);
      await recargar();
    } catch (err) {
      toast(err instanceof Error ? err.message : "No pude guardar el cambio.", "err");
    }
    setOcupado("");
  }

  const badge = !d
    ? <Badge variante="neutral">{"error" in estado ? "Sin datos" : "Revisando…"}</Badge>
    : c
      ? c.pideReautorizar
        ? <Badge variante="warning" icono={<AlertTriangle size={13} />}>Pide volver a autorizar</Badge>
        : <Badge variante="success" icono={<Check size={13} />}>Conectado</Badge>
      : d.configurado
        ? <Badge variante="warning" icono={<Plug size={13} />}>Sin conectar</Badge>
        : <Badge variante="neutral" icono={<Plug size={13} />}>Sin configurar</Badge>;

  return (
    <Card>
      <CardHead
        titulo="Bank of America"
        sub="Los gastos y el saldo de la cuenta, directo del banco (por Plaid), sin pegar el CSV."
        acciones={badge}
      />

      {"error" in estado && (
        <div className="row-wrap">
          <p className="t-sm t-muted" style={{ flex: 1 }}>{estado.error}</p>
          <Button sm variante="secondary" icono={<RefreshCw size={15} />} onClick={() => void recargar()}>Reintentar</Button>
        </div>
      )}

      {d && (
        <div className="stack-4">
          <div className="wb-filas">
            <div className="wb-fila">
              <span className="wb-fila__texto">
                <span className="wb-fila__nombre">Claves de Plaid</span>
                <span className="wb-fila__detalle">
                  {d.configurado
                    ? d.entorno === "production"
                      ? "Puestas en Vercel (PLAID_CLIENT_ID, PLAID_SECRET): se conecta el banco de verdad."
                      : "Puestas en Vercel, pero PLAID_ENV no dice «production»: se conecta un banco de prueba de Plaid, no el real."
                    : "Faltan PLAID_CLIENT_ID, PLAID_SECRET y PLAID_ENV en Vercel (se sacan del panel de Plaid). Está explicado paso a paso en docs/conectar-bank-of-america.md."}
                </span>
              </span>
              <Badge variante={d.configurado ? (d.entorno === "production" ? "success" : "warning") : "neutral"}>
                {d.configurado ? (d.entorno === "production" ? "Puestas" : "Modo prueba") : "Faltan"}
              </Badge>
            </div>
            <div className="wb-fila">
              <span className="wb-fila__texto">
                <span className="wb-fila__nombre">La cuenta</span>
                <span className="wb-fila__detalle">
                  {c
                    ? `${c.institucion ?? "Bank of America"}${c.cuentas.length ? ` · ${c.cuentas.map((x) => `${x.nombre}${x.mascara ? ` ···${x.mascara}` : ""}`).join(", ")}` : ""}${c.conectadoPor ? ` · la conectó ${c.conectadoPor}` : ""} ${relativo(c.conectadoEn)}.`
                    : !d.hayBase
                      ? "Falta SUPABASE_SERVICE_ROLE_KEY: no hay dónde guardar el permiso del banco."
                      : "Se conecta una vez con el usuario del banco, en la ventana de Plaid. El permiso es de sólo lectura: la app no puede mover plata."}
                </span>
              </span>
              <Badge variante={c ? (c.pideReautorizar ? "warning" : "success") : "neutral"}>{c ? (c.pideReautorizar ? "Pide volver a entrar" : "Conectada") : "Sin conectar"}</Badge>
            </div>
            {c && (
              <div className="wb-fila">
                <span className="wb-fila__texto">
                  <span className="wb-fila__nombre">Cargar los gastos solos</span>
                  <span className="wb-fila__detalle">
                    Cada hora entran los gastos nuevos de la cuenta, de a uno, con su categoría (si no se sabe, en «Pendiente de revisión»). Quedan afuera el pago de la tarjeta,
                    lo que pasa entre cuentas propias y lo que entra. Sólo desde que se conectó: lo anterior se carga con el CSV.
                    {c.ultimaLectura ? ` Última lectura: ${relativo(c.ultimaLectura)}${c.ultimosCargados ? `, cargó ${c.ultimosCargados}` : ""}.` : " Todavía no leyó nada."}
                  </span>
                </span>
                <Switch checked={c.autoCargar} etiqueta="Cargar los gastos de Bank of America solos" onChange={(v) => { if (ocupado === "") void cambiarAuto(v); }} />
              </div>
            )}
          </div>

          {c?.ultimoError && (
            <p className="t-sm" data-alerta role="alert" style={{ display: "flex", gap: 8, alignItems: "flex-start", margin: 0 }}>
              <AlertTriangle size={15} aria-hidden style={{ flex: "none", marginTop: 2 }} />
              <span>{c.ultimoError}</span>
            </p>
          )}

          {d.configurado && d.hayBase && (
            <div className="row-wrap">
              {!c ? (
                <Button variante="primary" icono={<Link2 size={16} />} disabled={ocupado !== ""} onClick={() => void conectar(false)}>
                  {ocupado === "conectar" ? "Abriendo Plaid…" : "Conectar Bank of America"}
                </Button>
              ) : (
                <>
                  {c.pideReautorizar && (
                    <Button variante="primary" icono={<Link2 size={16} />} disabled={ocupado !== ""} onClick={() => void conectar(true)}>
                      {ocupado === "conectar" ? "Abriendo Plaid…" : "Volver a autorizar"}
                    </Button>
                  )}
                  <Button variante="secondary" icono={<Download size={16} />} disabled={ocupado !== ""} onClick={() => void traerAhora()}>
                    {ocupado === "traer" ? "Leyendo el banco…" : "Traer ahora"}
                  </Button>
                  <Button variante="ghost" icono={<Unplug size={16} />} onClick={() => setDesconectar(true)}>Desconectar</Button>
                </>
              )}
            </div>
          )}
          {!c && d.configurado && d.hayBase && (
            <p className="t-sm t-subtle">
              Se abre una ventana de Plaid: buscá «Bank of America», entrá con el usuario del banco y elegí la cuenta. Bank of America tiene su propia pantalla para
              elegir las cuentas que se comparten.
            </p>
          )}
        </div>
      )}

      <Confirmar
        abierto={desconectar} onCerrar={() => setDesconectar(false)}
        titulo="¿Desconectar Bank of America?" confirmarTexto="Desconectar"
        texto="Se anula el permiso del banco: dejan de entrar los gastos solos y de leerse el saldo. Lo que ya se cargó queda. Se puede volver a conectar cuando quieras."
        onConfirmar={async () => {
          try { await desconectarBofa(); toast("Bank of America quedó desconectado."); await recargar(); }
          catch (err) { toast(err instanceof Error ? err.message : "No pude desconectar el banco.", "err"); }
        }}
      />
    </Card>
  );
}
