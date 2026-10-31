"use client";

import React, { useMemo, useState } from "react";
import { AlertTriangle, Check, Copy, Pencil } from "lucide-react";
import { Avatar, Badge, Button, Card, Empty, Input } from "@/components/ui/ui";
import { InfoMetrica } from "@/components/ui/InfoMetrica";
import { Avance, Plegable } from "@/components/finanzas/visual/visual";
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

  /* Lo que espera a alguien, primero. Quien tiene todo confirmado queda en una línea: se abre si hace falta leerlo. */
  const conPendientes = porPersona.filter((lista) => lista.some((r) => !r.confirmada));
  const todoConfirmado = porPersona.filter((lista) => lista.every((r) => r.confirmada));

  return (
    <div className="stack-4">
      <section className="fz-hero fz-hero--bajo" aria-label="Cuántas reglas están confirmadas">
        <div>
          <span className="fz-hero__etiqueta">
            Reglas confirmadas
            <InfoMetrica titulo="Reglas de comisión" ayuda="Lo que se acordó para cada comisión, con sus palabras, y quién lo confirmó y cuándo. Lo que no está confirmado se avisa antes de cerrar el mes. Si se cambia una regla, vuelve a quedar sin confirmar." />
          </span>
          <span className="fz-semana__valor">{reglas.length - sin} de {reglas.length}</span>
        </div>
        <div className="fz-hero__der">
          <Avance
            hecho={reglas.length - sin} total={reglas.length}
            izquierda={sin === 0 ? <b>Todas confirmadas</b> : <><b>{sin === 1 ? "Falta 1" : `Faltan ${sin}`}</b> para pagar sin dudas</>}
            derecha={<Button sm variante="ghost" icono={<Copy size={14} />} onClick={copiar}>Copiar para Yari</Button>}
          />
        </div>
      </section>

      {conPendientes.map((lista) => (
        <Card key={lista[0].miembro.id} style={{ padding: 0, overflow: "hidden" }}>
          <CabezaDePersona miembro={lista[0].miembro} onEditar={editable ? onEditar : undefined} />
          {[...lista].sort((a, b) => Number(a.confirmada) - Number(b.confirmada)).map((r) => <FilaDeRegla key={r.concepto.id} r={r} editable={editable} />)}
        </Card>
      ))}

      {todoConfirmado.map((lista) => (
        <Plegable
          key={lista[0].miembro.id} pegado
          titulo={<span className="reglas__quien"><Avatar nombre={lista[0].miembro.nombre} size={28} />{lista[0].miembro.nombre}<span className="t-sm t-subtle">{lista[0].miembro.puesto}</span></span>}
          resumen={<span className="reglas__ok"><Check size={14} aria-hidden /> {lista.length === 1 ? "Confirmada" : `${lista.length} confirmadas`}</span>}
        >
          {editable && onEditar && <div className="reglas__editar"><Button sm variante="ghost" icono={<Pencil size={14} />} onClick={() => onEditar(lista[0].miembro.id)}>Editar sus reglas</Button></div>}
          {lista.map((r) => <FilaDeRegla key={r.concepto.id} r={r} editable={editable} />)}
        </Plegable>
      ))}
    </div>
  );
}

function CabezaDePersona({ miembro, onEditar }: { miembro: ReglaAcordada["miembro"]; onEditar?: (id: string) => void }) {
  return (
    <div className="reglas__cab">
      <span className="reglas__quien"><Avatar nombre={miembro.nombre} size={32} /><span className="reglas__nombre">{miembro.nombre}</span><span className="t-sm t-subtle">{miembro.puesto}</span></span>
      {onEditar && <Button sm variante="ghost" icono={<Pencil size={14} />} onClick={() => onEditar(miembro.id)}>Editar sus reglas</Button>}
    </div>
  );
}

function FilaDeRegla({ r, editable }: { r: ReglaAcordada; editable: boolean }) {
  const e = useEstado();
  const yo = useUsuarioActual();
  const toast = useToast();
  const [confirmando, setConfirmando] = useState(false);
  const [quien, setQuien] = useState("Yari");
  const [verAcordado, setVerAcordado] = useState(false);

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
    <div className="reglas__fila" data-confirmada={r.confirmada || undefined}>
      <div className="reglas__principal">
        <div className="reglas__texto">
          <span className="reglas__concepto">{r.concepto.nombre}</span>
          <span className="reglas__regla">{r.regla}</span>
          {r.pendiente && <span className="reglas__adefinir"><b>A definir:</b> {r.pendiente}</span>}
          {r.criterio && (
            verAcordado
              ? <span className="reglas__criterio">{r.criterio} <button type="button" className="link" onClick={() => setVerAcordado(false)}>Ocultar</button></span>
              : <button type="button" className="link t-sm reglas__veracordado" onClick={() => setVerAcordado(true)}>Ver lo acordado</button>
          )}
        </div>
        <div className="reglas__accion">
          {!editable
            ? <Badge variante={r.confirmada ? "success" : "warning"} icono={r.confirmada ? <Check size={12} /> : <AlertTriangle size={12} />}>{selloDeRegla(r.confirmada)}</Badge>
            : r.confirmada
              ? (
                <span className="reglas__sello">
                  <span className="reglas__ok"><Check size={14} aria-hidden /> {selloDeRegla(r.confirmada)}</span>
                  <button type="button" className="link t-sm" onClick={() => { guardar({}); toast("Ya no figura como confirmada."); }}>Quitar</button>
                </span>
              )
              : !confirmando && <Button sm variante="secondary" icono={<Check size={14} />} onClick={() => setConfirmando(true)}>Confirmar</Button>}
        </div>
      </div>
      {editable && confirmando && (
        <div className="row-wrap" style={{ alignItems: "flex-end" }}>
          <div className="hk-field" style={{ minWidth: 200 }}>
            <label className="hk-label">Quién la confirmó</label>
            <Input value={quien} onChange={(ev) => setQuien(ev.target.value)} aria-label="Quién la confirmó" autoFocus />
          </div>
          <Button sm variante="primary" icono={<Check size={14} />} onClick={confirmar}>Confirmar hoy</Button>
          <Button sm variante="ghost" onClick={() => setConfirmando(false)}>Cancelar</Button>
        </div>
      )}
    </div>
  );
}
