"use client";

import React, { useMemo } from "react";
import { Search, UserCheck } from "lucide-react";
import { PageHead } from "@/components/shell/PageHead";
import { Badge, Button, Card, Chip, Empty, Input, StatCard } from "@/components/ui/ui";
import { DataTable, type Columna } from "@/components/ui/DataTable";
import { CopiarLink, Filtro } from "@/components/ui/Filtros";
import { useAbrirFicha } from "@/components/ficha/abrir";
import { useToast } from "@/components/ui/Toast";
import { useEstado } from "@/lib/store";
import { fechaLarga, money, num } from "@/lib/format";
import { clientes, ESTADOS_CLIENTE, totalesDeClientes, vistaDeCliente, type Cliente, type EstadoCliente } from "@/lib/clientes";
import { opcionesSobre, type FiltroPersonas } from "@/lib/buscar-cliente";
import { ordenAURL, ordenDeURL, paginaDeURL, useBusquedaURL, useParamsURL } from "@/lib/useParamsURL";

/* ==================================================================
   Clientes: la gente que compró, con qué compró, cuánto pagó y cómo
   viene (lib/clientes.ts). Un clic abre su ficha, con todas sus ventas,
   cuotas, cobros, servicio y el chat del equipo.
   ================================================================== */

type Filtro = "activos" | EstadoCliente | "todos";

/* Lo que se está mirando vive en la URL (lib/useParamsURL): se guarda en
   favoritos o se manda el link y se ve tal cual.
   - estado: activos (por defecto), al-dia, atrasado, pago-todo, baja o todos
   - producto: el servicio (su id; un link de antes con el nombre también se entiende)
   - closer: quién comisiona sus cuotas (su id, o «sin-closer»)
   - q: nombre o correo
   - orden: la columna, con "-" adelante si va de mayor a menor
   - pag: la página, desde 1

   Las tarjetas de arriba siguen al producto, al closer y a la búsqueda: son lo de
   esa gente y de esas cuotas (la deuda de Mentoría, lo que le falta cobrar a
   Mariano). Los botones de estado recortan sólo la tabla, y la fila de totales
   de la tabla suma lo que queda a la vista. */
const VISTA_CLIENTES = { estado: "activos", producto: "", closer: "", orden: "-ultima", pag: "1" };
const ORDEN_INICIAL = { clave: "ultima", desc: true };
const COLUMNAS_QUE_ORDENAN = ["nombre", "productos", "estado", "cobrado", "saldo", "proxima", "ultima"];
const FILTROS: Filtro[] = ["activos", "al-dia", "atrasado", "pago-todo", "baja", "todos"];

export default function Clientes() {
  const e = useEstado();
  const abrirFicha = useAbrirFicha();
  const toast = useToast();
  const mon = e.ajustes.monedaBase;
  const M = (n: number) => money(n, mon);
  const [vista, setVista] = useParamsURL(VISTA_CLIENTES);
  const [q, setQ] = useBusquedaURL("q", ["pag"]);
  const filtro: Filtro = FILTROS.includes(vista.estado as Filtro) ? (vista.estado as Filtro) : "activos";
  const setFiltro = (f: Filtro) => setVista({ estado: f, pag: null });

  const todos = useMemo(() => clientes(e), [e]);
  /* El producto del link es su id; los links de antes traían el nombre. */
  const productoId = useMemo(
    () => (vista.producto ? (e.productos.find((p) => p.id === vista.producto) ?? e.productos.find((p) => p.nombre === vista.producto))?.id : undefined),
    [vista.producto, e.productos],
  );
  const closerId = vista.closer || undefined;
  const alcance: FiltroPersonas = useMemo(() => ({ productoId, closerId }), [productoId, closerId]);
  const hayFiltros = Boolean(productoId || closerId || q.trim());

  /* Cada desplegable ofrece lo que hay entre los clientes, con cuánta gente queda si se lo elige
     y con el otro ya puesto (lib/buscar-cliente: la misma regla que «Cargar el pago de una cuota»). */
  const opciones = useMemo(() => {
    const o = opcionesSobre(todos, alcance);
    return {
      productos: o.servicios.map((x) => ({ valor: x.id, texto: x.nombre, cuenta: x.personas })),
      closers: o.closers.map((x) => ({ valor: x.id, texto: x.nombre, cuenta: x.personas })),
    };
  }, [todos, alcance]);

  /* Cada cliente visto sólo por las cuotas del producto y del closer elegidos, y recortado por la búsqueda:
     de acá salen las tarjetas, los botones de estado y la tabla, así no pueden dar distinto. */
  const vistos = useMemo(() => {
    const t = q.trim().toLowerCase();
    return todos
      .map((c) => vistaDeCliente(c, alcance))
      .filter((c): c is Cliente => c !== null && (!t || c.nombre.toLowerCase().includes(t) || (c.email ?? "").toLowerCase().includes(t)));
  }, [todos, alcance, q]);
  const cuenta = (f: Filtro) => vistos.filter((c) => pasa(c, f)).length;
  const filas = useMemo(() => vistos.filter((c) => pasa(c, filtro)), [vistos, filtro]);
  const activos = vistos.filter((c) => c.estado !== "baja");
  const aDeber = totalesDeClientes(activos);
  const enFilas = totalesDeClientes(filas);
  const aDeberDe = (st: EstadoCliente) => totalesDeClientes(activos.filter((c) => c.estado === st)).saldo;

  const columnas: Columna<Cliente>[] = [
    {
      clave: "nombre", titulo: "Cliente", tipo: "primary", orden: (c) => c.nombre.toLowerCase(),
      pie: <strong>Total · {num(filas.length)} {filas.length === 1 ? "cliente" : "clientes"}</strong>,
      celda: (c) => (
        <span style={{ display: "block", minWidth: 0 }}>
          <span className="truncate" style={{ display: "block" }}>{c.nombre}</span>
          {c.email && <span className="t-sm t-subtle truncate" style={{ display: "block" }}>{c.email}</span>}
        </span>
      ),
    },
    { clave: "productos", titulo: "Compró", tipo: "secondary", orden: (c) => c.productos.join(", "), celda: (c) => c.productos.join(" · ") },
    {
      clave: "estado", titulo: "Estado", orden: (c) => ["atrasado", "al-dia", "pago-todo", "baja"].indexOf(c.estado) * 1000 - c.diasAtraso,
      celda: (c) => (
        <Badge variante={ESTADOS_CLIENTE[c.estado].variante}>
          {c.estado === "atrasado" ? `${c.diasAtraso} ${c.diasAtraso === 1 ? "día" : "días"} de atraso` : ESTADOS_CLIENTE[c.estado].texto}
        </Badge>
      ),
    },
    {
      clave: "cobrado", titulo: "Pagó", tipo: "num", orden: (c) => c.cobrado, celda: (c) => M(c.cobrado),
      pie: <strong className="t-num">{M(enFilas.cobrado)}</strong>,
      info: {
        ayuda: "Lo que ya pagó el cliente. Con un producto o un closer elegido, sólo lo de esas cuotas. Abajo, la suma de los clientes que ves, de todas las páginas.",
        formula: "Total = suma de «Pagó» de los clientes de la tabla",
      },
    },
    {
      clave: "saldo", titulo: "Le falta", tipo: "num", orden: (c) => c.saldo, celda: (c) => (c.saldo > 0.01 ? M(c.saldo) : <span className="t-subtle">—</span>),
      pie: <strong className="t-num">{M(enFilas.saldo)}</strong>,
      info: {
        ayuda: "Lo que todavía falta cobrarle al cliente de sus ventas activas. Con un producto o un closer elegido, sólo lo de esas cuotas. Abajo, la suma de los clientes que ves, de todas las páginas.",
        formula: "Le falta = suma de (monto − lo ya pagado) de sus cuotas de ventas activas, sin las canceladas\nTotal = suma de «Le falta» de los clientes de la tabla",
        componentes: () => [
          { concepto: "Clientes en la tabla", valor: num(filas.length) },
          { concepto: "Lo que les falta pagar", valor: M(enFilas.saldo), signo: "=" },
        ],
      },
    },
    {
      clave: "proxima", titulo: "Próxima cuota", tipo: "secondary", orden: (c) => c.proximaCuota?.vence ?? "9",
      celda: (c) => (c.proximaCuota ? `${fechaLarga(c.proximaCuota.vence)} · ${M(c.proximaCuota.monto)}` : "—"),
    },
    { clave: "ultima", titulo: "Última compra", tipo: "secondary", orden: (c) => c.ultimaCompra, celda: (c) => fechaLarga(c.ultimaCompra) },
  ];

  return (
    <div className="stack-5">
      <PageHead
        titulo="Clientes"
        sub="La gente que compró: qué compró, cuánto pagó, cuánto le falta y si está al día. Un clic abre su ficha con todo lo suyo."
      />

      <div className="grid-stats">
        <StatCard
          hero etiqueta="Clientes activos" valor={num(activos.length)}
          contexto={hayFiltros ? `de ${num(vistos.length)} con lo que filtraste` : `${num(vistos.length)} compraron alguna vez`}
          info={{
            ayuda: `La gente que compró y no está dada de baja: la que está al día, la atrasada y la que ya pagó todo.${hayFiltros ? " Sigue el producto, el closer y la búsqueda que elegiste." : ""}`,
            formula: "Clientes con al menos una venta activa (sin las canceladas ni las reembolsadas)\nClientes activos = Al día + Atrasados + Pagaron todo",
            componentes: () => [
              { concepto: "Al día", valor: num(cuenta("al-dia")) },
              { concepto: "Atrasados", valor: num(cuenta("atrasado")), signo: "+" },
              { concepto: "Pagaron todo", valor: num(cuenta("pago-todo")), signo: "+" },
              { concepto: "Clientes activos", valor: num(activos.length), signo: "=" },
            ],
          }}
        />
        <StatCard
          etiqueta="Al día" valor={num(cuenta("al-dia"))} contexto="con cuotas por venir"
          info={{
            ayuda: "Clientes activos sin ninguna cuota vencida, que todavía tienen cuotas por pagar.",
            formula: "Clientes con una venta activa, sin cuotas vencidas sin pagar y con saldo por cobrar",
          }}
        />
        <StatCard
          etiqueta="Atrasados" valor={num(cuenta("atrasado"))} direccion={cuenta("atrasado") > 0 ? "down" : "neutral"}
          contexto="con una cuota vencida sin pagar"
          info={{
            ayuda: "Clientes activos con al menos una cuota cuyo vencimiento ya pasó y no se pagó.",
            formula: "Clientes con una venta activa y al menos una cuota pendiente vencida",
            href: "/finanzas/detalle",
          }}
        />
        <StatCard
          etiqueta="Les falta pagar" valor={M(aDeber.saldo)} contexto={hayFiltros ? "de lo que filtraste" : "entre todos los activos"}
          info={{
            ayuda: `Lo que todavía falta cobrarles a los clientes activos, hayan vencido las cuotas o no.${hayFiltros ? " Con un producto o un closer elegido es la deuda de esas cuotas, no de todo lo que compraron." : ""}`,
            formula: "Suma, por cada venta activa, de lo que falta de cada cuota (monto − lo ya pagado), sin las canceladas\nCon un producto o un closer elegido, sólo las cuotas de ese producto o de ese closer (las dos condiciones sobre la misma cuota)",
            componentes: () => [
              { concepto: "De los que están al día", valor: M(aDeberDe("al-dia")) },
              { concepto: "De los atrasados", valor: M(aDeberDe("atrasado")), signo: "+" },
              { concepto: "Les falta pagar", valor: M(aDeber.saldo), signo: "=", nota: `${num(activos.length)} clientes activos` },
            ],
          }}
        />
      </div>

      {/* Los filtros arriba y los botones de estado abajo, como en Ventas. */}
      <div className="stack-3">
        <div className="row-wrap">
          {opciones.productos.length > 0 && (
            <Filtro
              etiqueta="Filtrar por producto" todos="Todos los productos" valor={productoId ?? ""}
              opciones={opciones.productos} onCambiar={(v) => setVista({ producto: v || null, pag: null })}
            />
          )}
          {opciones.closers.length > 0 && (
            <Filtro
              etiqueta="Filtrar por closer" todos="Todos los closers" valor={closerId ?? ""}
              opciones={opciones.closers} onCambiar={(v) => setVista({ closer: v || null, pag: null })}
            />
          )}
          <div style={{ width: 240 }}>
            <Input icono={<Search size={15} />} value={q} onChange={(ev) => setQ(ev.target.value)} placeholder="Nombre o correo" aria-label="Buscar cliente" />
          </div>
          {hayFiltros && <Button sm variante="ghost" onClick={() => { setQ(""); setVista({ producto: null, closer: null, pag: null }, { q: null }); }}>Limpiar filtros</Button>}
        </div>
        <div className="row-wrap">
          <Chip activo={filtro === "activos"} onClick={() => setFiltro("activos")} count={cuenta("activos")}>Activos</Chip>
          {(Object.keys(ESTADOS_CLIENTE) as EstadoCliente[]).map((k) => (
            <Chip key={k} activo={filtro === k} onClick={() => setFiltro(k)} count={cuenta(k)}>{ESTADOS_CLIENTE[k].texto}</Chip>
          ))}
          <Chip activo={filtro === "todos"} onClick={() => setFiltro("todos")} count={vistos.length}>Todos</Chip>
          <span className="spacer" />
          <CopiarLink />
        </div>
      </div>

      <Card style={{ padding: 0 }}>
        <DataTable
          filas={filas} columnas={columnas} porPagina={50}
          orden={ordenDeURL(vista.orden, COLUMNAS_QUE_ORDENAN, ORDEN_INICIAL)} onOrden={(o) => setVista({ orden: ordenAURL(o), pag: null })}
          pagina={paginaDeURL(vista.pag) - 1} onPagina={(p) => setVista({ pag: String(p + 1) })}
          onFila={(c) => (c.conFicha ? abrirFicha(c.id) : toast(`La venta de ${c.nombre} no está atada a ninguna persona: editala desde Ventas y vinculala a un lead.`, "err"))}
          etiquetaFila={(c) => `Abrir la ficha de ${c.nombre}`}
          vacio={<Empty icono={<UserCheck size={22} />} titulo="Nadie con este filtro" texto={hayFiltros ? "Probá con otro producto o closer, o sacá algún filtro." : "Cuando alguien compra, aparece acá solo: sale de sus ventas."} />}
        />
      </Card>
    </div>
  );
}

function pasa(c: Cliente, f: Filtro): boolean {
  if (f === "todos") return true;
  if (f === "activos") return c.estado !== "baja";
  return c.estado === f;
}
