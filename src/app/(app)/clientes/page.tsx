"use client";

import React, { useMemo, useState } from "react";
import { Search, UserCheck } from "lucide-react";
import { PageHead } from "@/components/shell/PageHead";
import { Badge, Card, Chip, Empty, Input, Select, StatCard } from "@/components/ui/ui";
import { DataTable, type Columna } from "@/components/ui/DataTable";
import { useAbrirFicha } from "@/components/ficha/abrir";
import { useToast } from "@/components/ui/Toast";
import { useEstado } from "@/lib/store";
import { fechaLarga, money, num } from "@/lib/format";
import { clientes, ESTADOS_CLIENTE, type Cliente, type EstadoCliente } from "@/lib/clientes";

/* ==================================================================
   Clientes: la gente que compró, con qué compró, cuánto pagó y cómo
   viene (lib/clientes.ts). Un clic abre su ficha, con todas sus ventas,
   cuotas, cobros, servicio y el chat del equipo.
   ================================================================== */

type Filtro = "activos" | EstadoCliente | "todos";

export default function Clientes() {
  const e = useEstado();
  const abrirFicha = useAbrirFicha();
  const toast = useToast();
  const mon = e.ajustes.monedaBase;
  const M = (n: number) => money(n, mon);
  const [filtro, setFiltro] = useState<Filtro>("activos");
  const [q, setQ] = useState("");
  const [producto, setProducto] = useState("");

  const todos = useMemo(() => clientes(e), [e]);
  const productos = useMemo(() => [...new Set(todos.flatMap((c) => c.productos))].sort((a, b) => a.localeCompare(b, "es")), [todos]);
  const cuenta = (f: Filtro) => todos.filter((c) => pasa(c, f)).length;
  const filas = useMemo(() => {
    const t = q.trim().toLowerCase();
    return todos.filter((c) => pasa(c, filtro)
      && (!producto || c.productos.includes(producto))
      && (!t || c.nombre.toLowerCase().includes(t) || (c.email ?? "").toLowerCase().includes(t)));
  }, [todos, filtro, producto, q]);
  const activos = todos.filter((c) => c.estado !== "baja");

  const columnas: Columna<Cliente>[] = [
    {
      clave: "nombre", titulo: "Cliente", tipo: "primary", orden: (c) => c.nombre.toLowerCase(),
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
    { clave: "cobrado", titulo: "Pagó", tipo: "num", orden: (c) => c.cobrado, celda: (c) => M(c.cobrado) },
    { clave: "saldo", titulo: "Le falta", tipo: "num", orden: (c) => c.saldo, celda: (c) => (c.saldo > 0.01 ? M(c.saldo) : <span className="t-subtle">—</span>) },
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
        <StatCard hero etiqueta="Clientes activos" valor={num(activos.length)} contexto={`${num(todos.length)} compraron alguna vez`} />
        <StatCard etiqueta="Al día" valor={num(cuenta("al-dia"))} contexto="con cuotas por venir" />
        <StatCard etiqueta="Atrasados" valor={num(cuenta("atrasado"))} direccion={cuenta("atrasado") > 0 ? "down" : "neutral"}
          contexto="con una cuota vencida sin pagar" />
        <StatCard etiqueta="Les falta pagar" valor={M(activos.reduce((a, c) => a + c.saldo, 0))} contexto="entre todos los activos" />
      </div>

      <div className="row-wrap">
        <Chip activo={filtro === "activos"} onClick={() => setFiltro("activos")} count={cuenta("activos")}>Activos</Chip>
        {(Object.keys(ESTADOS_CLIENTE) as EstadoCliente[]).map((k) => (
          <Chip key={k} activo={filtro === k} onClick={() => setFiltro(k)} count={cuenta(k)}>{ESTADOS_CLIENTE[k].texto}</Chip>
        ))}
        <Chip activo={filtro === "todos"} onClick={() => setFiltro("todos")} count={todos.length}>Todos</Chip>
        <span className="spacer" />
        <div style={{ width: 200 }}>
          <Select value={producto} placeholder="Todos los productos" onChange={(ev) => setProducto(ev.target.value)}
            opciones={[{ valor: "", texto: "Todos los productos" }, ...productos.map((p) => ({ valor: p, texto: p }))]} />
        </div>
        <div style={{ width: 240 }}>
          <Input icono={<Search size={15} />} value={q} onChange={(ev) => setQ(ev.target.value)} placeholder="Nombre o correo" aria-label="Buscar cliente" />
        </div>
      </div>

      <Card style={{ padding: 0 }}>
        <DataTable
          filas={filas} columnas={columnas} porPagina={50}
          ordenInicial={{ clave: "ultima", desc: true }}
          onFila={(c) => (c.conFicha ? abrirFicha(c.id) : toast(`La venta de ${c.nombre} no está atada a ninguna persona: editala desde Ventas y vinculala a un lead.`, "err"))}
          etiquetaFila={(c) => `Abrir la ficha de ${c.nombre}`}
          vacio={<Empty icono={<UserCheck size={22} />} titulo="Nadie con este filtro" texto="Cuando alguien compra, aparece acá solo: sale de sus ventas." />}
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
