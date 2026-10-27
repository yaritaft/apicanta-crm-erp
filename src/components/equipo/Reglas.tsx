"use client";

import React, { useMemo, useState } from "react";
import { AlertTriangle, Check, Copy, Pencil } from "lucide-react";
import { Badge, Button, Card, CardHead, Empty, Input } from "@/components/ui/ui";
import { useToast } from "@/components/ui/Toast";
import { acciones, useEstado } from "@/lib/store";
import { useUsuarioActual } from "@/lib/usuario";
import { reglasAcordadas, selloDeRegla, textoDeReglas, type ReglaAcordada } from "@/lib/reglas";

/* ==================================================================
   Reglas: lo que se acordó para cada comisión, con sus palabras, y quién lo
   confirmó y cuándo (26/10/2026). La regla escrita sale del esquema; lo
   acordado son sus notas; la confirmación es un sello que los dueños ponen
   (o sacan) acá. Quien liquida (Aldana) lo ve para no tener que preguntar
   cada vez. Si se cambia una regla, el sello se borra solo (lib/reglas.ts).
   ================================================================== */

const hoyIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function ReglasAcordadas({ editable, onEditar }: { editable: boolean; onEditar?: (miembroId: string) => void }) {
  const e = useEstado();
  const toast = useToast();
  const reglas = useMemo(() => reglasAcordadas(e), [e]);
  const sin = reglas.filter((r) => !r.confirmada).length;
  const porPersona = useMemo(() => {
    const m = new Map<string, ReglaAcordada[]>();
    for (const r of reglas) m.set(r.miembro.id, [...(m.get(r.miembro.id) ?? []), r]);
    return [...m.values()];
  }, [reglas]);

  async function copiar() {
    try { await navigator.clipboard.writeText(textoDeReglas(e)); toast("Copiadas las reglas: pegalas en un mensaje para Yari."); }
    catch { toast("No pude copiar. Probá de nuevo.", "err"); }
  }

  if (reglas.length === 0) {
    return (
      <Card>
        <Empty icono={<AlertTriangle size={22} />} titulo="Todavía no hay comisiones cargadas" texto="Cuando cada persona tenga su esquema, sus reglas aparecen acá con lo que se acordó y quién lo confirmó." />
      </Card>
    );
  }

  return (
    <div className="stack-4">
      <Card>
        <CardHead
          titulo="Reglas de comisión acordadas"
          sub="Lo que se acordó para cada comisión, con sus palabras, y quién lo confirmó y cuándo. Lo que no está confirmado se avisa antes de cerrar el mes. Si se cambia una regla, vuelve a quedar sin confirmar."
          acciones={<Button sm variante="ghost" icono={<Copy size={14} />} onClick={copiar}>Copiar para mandárselas a Yari</Button>}
        />
        <div className="row-wrap" style={{ marginTop: "var(--space-3)" }}>
          {sin === 0
            ? <Badge variante="success" icono={<Check size={12} />}>Todas confirmadas</Badge>
            : <Badge variante="warning" icono={<AlertTriangle size={12} />}>{sin === 1 ? "1 regla sin confirmar" : `${sin} reglas sin confirmar`} de {reglas.length}</Badge>}
        </div>
      </Card>

      {porPersona.map((lista) => (
        <Card key={lista[0].miembro.id}>
          <CardHead
            titulo={lista[0].miembro.nombre}
            sub={lista[0].miembro.puesto || undefined}
            acciones={editable && onEditar ? <Button sm variante="ghost" icono={<Pencil size={14} />} onClick={() => onEditar(lista[0].miembro.id)}>Editar sus reglas</Button> : undefined}
          />
          <div className="stack-4" style={{ marginTop: "var(--space-3)" }}>
            {lista.map((r) => <FilaDeRegla key={r.concepto.id} r={r} editable={editable} />)}
          </div>
        </Card>
      ))}
    </div>
  );
}

function FilaDeRegla({ r, editable }: { r: ReglaAcordada; editable: boolean }) {
  const e = useEstado();
  const yo = useUsuarioActual();
  const toast = useToast();
  const [confirmando, setConfirmando] = useState(false);
  const [quien, setQuien] = useState("Yari");

  function guardar(cambios: { confirmadaPor?: string; confirmadaEl?: string }) {
    const esq = e.honorarios.find((h) => h.miembroId === r.miembro.id);
    if (!esq) return;
    const conceptos = esq.conceptos.map((c) => {
      if (c.id !== r.concepto.id) return c;
      const { confirmadaPor: _p, confirmadaEl: _e, ...resto } = c;
      return { ...resto, ...cambios };
    });
    acciones.guardarEsquema({ ...esq, conceptos }, yo.nombre);
  }
  function confirmar() {
    const por = quien.trim();
    if (!por) { toast("Poné quién la confirmó.", "err"); return; }
    guardar({ confirmadaPor: por, confirmadaEl: hoyIso() });
    setConfirmando(false);
    toast("Regla confirmada.");
  }

  return (
    <div className="reglas__fila">
      <div className="row-wrap" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <div className="stack-1" style={{ flex: "1 1 320px" }}>
          <span className="t-label">{r.concepto.nombre}</span>
          <span>{r.regla}</span>
        </div>
        <Badge variante={r.confirmada ? "success" : "warning"} icono={r.confirmada ? <Check size={12} /> : <AlertTriangle size={12} />}>
          {selloDeRegla(r.confirmada)}
        </Badge>
      </div>
      {r.criterio && <p className="t-sm reglas__criterio"><b>Lo acordado:</b> {r.criterio}</p>}
      {r.pendiente && <p className="t-sm reglas__criterio"><b>A definir:</b> {r.pendiente}</p>}
      {editable && (
        confirmando ? (
          <div className="row-wrap" style={{ alignItems: "flex-end" }}>
            <div className="hk-field" style={{ minWidth: 200 }}>
              <label className="hk-label">Quién la confirmó</label>
              <Input value={quien} onChange={(ev) => setQuien(ev.target.value)} aria-label="Quién la confirmó" autoFocus />
            </div>
            <Button sm variante="primary" icono={<Check size={14} />} onClick={confirmar}>Confirmar hoy</Button>
            <Button sm variante="ghost" onClick={() => setConfirmando(false)}>Cancelar</Button>
          </div>
        ) : r.confirmada ? (
          <div><Button sm variante="ghost" onClick={() => { guardar({}); toast("Ya no figura como confirmada."); }}>Quitar la confirmación</Button></div>
        ) : (
          <div><Button sm variante="ghost" icono={<Check size={14} />} onClick={() => setConfirmando(true)}>Confirmar esta regla</Button></div>
        )
      )}
    </div>
  );
}
