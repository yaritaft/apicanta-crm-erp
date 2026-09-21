"use client";

/* Selector de fechas estilo Meta. Portado de Blue OS, donde es el componente
   canonico: TODO filtro de fecha de metricas, KPIs o historial usa este y no
   otro. Boton pill → popover con rail de 12 presets + DOBLE calendario que
   navega de a dos meses, rango pintado, y footer Cancelar/Actualizar con
   estado draft: cerrar sin aplicar descarta lo que tocaste.

   Los presets "Ultimos N dias" EXCLUYEN hoy ([T-n, T-1]), igual que Meta.

   Los dias son fechas calendario, no timestamps: aca no se convierte huso.
   La tz entra en un solo lugar, que es decidir que dia es "hoy". */

import { useEffect, useLayoutEffect, useRef, useState } from "react";

export type RangoFechas = { preset: string; desde: string; hasta: string };

/* Apicanta opera desde Argentina: los presets hablan del calendario del
   negocio, no del de la maquina que abre la pantalla. A las 22hs de alguien
   en Madrid, "Hoy" del negocio sigue siendo el dia de aca. */
export const TZ_NEGOCIO = "America/Argentina/Buenos_Aires";

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const DOWS = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"];

const iso = (d: Date) => {
  const y = d.getFullYear(), m = d.getMonth() + 1, dd = d.getDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
};
const deIso = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const addDias = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const fmtCorta = (s: string) => {
  const d = deIso(s);
  return `${d.getDate()} ${MESES[d.getMonth()]}`;
};

/* "Hoy" como fecha calendario en la tz del negocio. */
function hoyEn(tz?: string | null): Date {
  try {
    return deIso(new Intl.DateTimeFormat("en-CA", {
      ...(tz ? { timeZone: tz } : {}), year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date()));
  } catch {
    const t = new Date(); t.setHours(0, 0, 0, 0); return t;
  }
}

/* Los 12 presets. `minDate` habilita "Maximo" de verdad: sin el, arranca en
   enero de este anio y se come el historico.

   Con `futuro` los presets cambian de naturaleza — lo usa la Agenda, donde el
   dato son sesiones AGENDADAS: "Esta semana" pasa a ser la semana COMPLETA
   (hasta el domingo) y aparecen Manana, La semana que viene, Proximos 7 y 30.

   `maxDate` es el espejo de `minDate`: mueve el final de "Maximo" hasta donde
   hay dato real. Nacio en Finanzas, donde el dato futuro no son agendas sino
   CUOTAS PROGRAMADAS: sin el, "Maximo" termina hoy y deja las cuotas que
   vencen el mes que viene fuera de la pantalla. Es un parametro aparte de
   `futuro` a proposito: una pantalla puede necesitar ver adelante sin que
   "Este mes" deje de significar "hasta hoy", que es de lo que dependen sus KPIs. */
function presets(
  minDate: string | null, futuro = false, tz: string | null = TZ_NEGOCIO, maxDate?: string | null,
): { id: string; label: string; rango: () => [string, string] }[] {
  const T = hoyEn(tz);
  const lunes = addDias(T, -((T.getDay() + 6) % 7));
  const ult = (n: number): [string, string] => [iso(addDias(T, -n)), iso(addDias(T, -1))];
  const finMes = (delta: number) => iso(new Date(T.getFullYear(), T.getMonth() + delta + 1, 0));
  const iniMes = (delta: number) => iso(new Date(T.getFullYear(), T.getMonth() + delta, 1));

  if (futuro) {
    return [
      { id: "hoy", label: "Hoy", rango: () => [iso(T), iso(T)] },
      { id: "manana", label: "Mañana", rango: () => [iso(addDias(T, 1)), iso(addDias(T, 1))] },
      { id: "semana", label: "Esta semana", rango: () => [iso(lunes), iso(addDias(lunes, 6))] },
      { id: "semana_prox", label: "La semana que viene", rango: () => [iso(addDias(lunes, 7)), iso(addDias(lunes, 13))] },
      { id: "prox7", label: "Próximos 7 días", rango: () => [iso(T), iso(addDias(T, 6))] },
      { id: "prox30", label: "Próximos 30 días", rango: () => [iso(T), iso(addDias(T, 29))] },
      { id: "mes", label: "Este mes", rango: () => [iniMes(0), finMes(0)] },
      { id: "mes_prox", label: "El mes que viene", rango: () => [iniMes(1), finMes(1)] },
      { id: "ayer", label: "Ayer", rango: () => [iso(addDias(T, -1)), iso(addDias(T, -1))] },
      { id: "semana_pasada", label: "La semana pasada", rango: () => [iso(addDias(lunes, -7)), iso(addDias(lunes, -1))] },
      { id: "mes_pasado", label: "El mes pasado", rango: () => [iniMes(-1), finMes(-1)] },
      { id: "anio_pasado", label: "Año pasado", rango: () => [iso(new Date(T.getFullYear() - 1, 0, 1)), iso(new Date(T.getFullYear() - 1, 11, 31))] },
      { id: "u30", label: "Últimos 30 días", rango: () => ult(30) },
      { id: "max", label: "Máximo", rango: () => [minDate ?? iso(new Date(T.getFullYear(), 0, 1)), maxDate ?? finMes(1)] },
    ];
  }
  return [
    { id: "hoy", label: "Hoy", rango: () => [iso(T), iso(T)] },
    { id: "ayer", label: "Ayer", rango: () => [iso(addDias(T, -1)), iso(addDias(T, -1))] },
    { id: "hoy_ayer", label: "Hoy y ayer", rango: () => [iso(addDias(T, -1)), iso(T)] },
    { id: "u7", label: "Últimos 7 días", rango: () => ult(7) },
    { id: "u14", label: "Últimos 14 días", rango: () => ult(14) },
    { id: "u28", label: "Últimos 28 días", rango: () => ult(28) },
    { id: "u30", label: "Últimos 30 días", rango: () => ult(30) },
    { id: "semana", label: "Esta semana", rango: () => [iso(lunes), iso(T)] },
    { id: "semana_pasada", label: "La semana pasada", rango: () => [iso(addDias(lunes, -7)), iso(addDias(lunes, -1))] },
    { id: "mes", label: "Este mes", rango: () => [iso(new Date(T.getFullYear(), T.getMonth(), 1)), iso(T)] },
    { id: "mes_pasado", label: "El mes pasado", rango: () => [iso(new Date(T.getFullYear(), T.getMonth() - 1, 1)), iso(new Date(T.getFullYear(), T.getMonth(), 0))] },
    { id: "anio_pasado", label: "Año pasado", rango: () => [iso(new Date(T.getFullYear() - 1, 0, 1)), iso(new Date(T.getFullYear() - 1, 11, 31))] },
    /* Sin `maxDate` termina HOY: una pantalla de metricas no tiene nada que
       mostrar adelante. Con `maxDate`, "Maximo" deja de mentir. */
    { id: "max", label: "Máximo", rango: () => [minDate ?? iso(new Date(T.getFullYear(), 0, 1)), maxDate ?? iso(T)] },
  ];
}

export function presetLabel(id: string): string {
  const p = presets(null).find((x) => x.id === id) ?? presets(null, true).find((x) => x.id === id);
  return p ? p.label : "Personalizado";
}

/* Re-materializa un preset RELATIVO a hoy. Un rango "Esta semana" guardado ayer
   tiene que significar ESTA semana al abrirlo hoy, no la de las fechas viejas. */
export function rangoDePreset(
  id: string, minDate: string | null, futuro = false, tz: string | null = TZ_NEGOCIO, maxDate?: string | null,
): RangoFechas | null {
  const p = presets(minDate, futuro, tz, maxDate).find((x) => x.id === id);
  if (!p) return null;
  const [desde, hasta] = p.rango();
  return { preset: id, desde, hasta };
}

export function rangoInicial(): RangoFechas {
  const [desde, hasta] = presets(null).find((p) => p.id === "u30")!.rango();
  return { preset: "u30", desde, hasta };
}

/* Rango "Maximo". Sirve de default en paneles donde el filtro arranca sin acotar. */
export function rangoMax(minDate: string | null, maxDate?: string | null): RangoFechas {
  const [desde, hasta] = presets(minDate, false, TZ_NEGOCIO, maxDate).find((p) => p.id === "max")!.rango();
  return { preset: "max", desde, hasta };
}

export function rangoStr(r: RangoFechas): string {
  return r.desde === r.hasta ? fmtCorta(r.desde) : `${fmtCorta(r.desde)} – ${fmtCorta(r.hasta)}`;
}

/* Para el sub de los StatCard: "últimos 30 días", o el rango si es a mano. */
export function rangoSub(r: RangoFechas): string {
  const l = presetLabel(r.preset);
  return l === "Personalizado" ? rangoStr(r) : l.toLowerCase();
}

/* Un dia cae en el rango. La comparacion es de strings ISO a proposito:
   ordenan igual que las fechas y no arrastran husos. */
/* El dia del NEGOCIO, no el de UTC.

   `creadoEn` guarda un INSTANTE. A las 22 de Argentina ya es la 01 del dia
   siguiente en UTC, asi que cortar el ISO con slice(0, 10) devolvia manana. Y
   como el rango se arma en hora argentina (TZ_NEGOCIO), todo lo cargado
   despues de las 21 quedaba afuera de "hoy": desaparecia de la lista justo
   cuando alguien lo acababa de cargar, sin ningun error ni aviso.

   Es la misma correccion que hoyEnArgentina() en el sync de Meta: el dia lo
   define el calendario del negocio, no el del servidor.

   Una fecha que ya viene SIN hora se devuelve tal cual. Pasarla por
   `new Date()` la leeria como medianoche UTC y en Argentina eso es el dia
   anterior: el arreglo correria un dia para atras todo lo que hoy anda bien. */
const fmtDiaNegocio = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ_NEGOCIO, year: "numeric", month: "2-digit", day: "2-digit",
});

export function diaDeNegocio(fecha: string | undefined | null): string {
  if (!fecha) return "";
  if (fecha.length <= 10) return fecha.slice(0, 10);
  const d = new Date(fecha);
  if (Number.isNaN(d.getTime())) return fecha.slice(0, 10);
  try {
    return fmtDiaNegocio.format(d);
  } catch {
    return fecha.slice(0, 10);
  }
}

export function enRango(fecha: string, r: RangoFechas): boolean {
  const d = diaDeNegocio(fecha);
  return d >= r.desde && d <= r.hasta;
}

function Calendario({ vista, desde, hasta, onPick, permitirFuturo = false, hoy }: {
  vista: number;
  desde: string | null; hasta: string | null;
  onPick: (isoDay: string) => void;
  permitirFuturo?: boolean;
  hoy: string;
}) {
  const y = Math.floor(vista / 12), m = vista % 12;
  const primero = new Date(y, m, 1);
  const huecos = (primero.getDay() + 6) % 7;
  const dias = new Date(y, m + 1, 0).getDate();
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div className="dp-mes">{MESES[m]} {y}</div>
      <div className="dp-grid">
        {DOWS.map((d) => <span key={d} className="dp-dow">{d}</span>)}
        {Array.from({ length: huecos }, (_, i) => <span key={`h${i}`} />)}
        {Array.from({ length: dias }, (_, i) => {
          const dIso = iso(new Date(y, m, i + 1));
          const edge = dIso === desde || dIso === hasta;
          const dentro = desde && hasta && dIso > desde && dIso < hasta;
          const off = !permitirFuturo && dIso > hoy;
          const cls = `dp-day${edge ? " dp-day--edge" : dentro ? " dp-day--in" : ""}${dIso === hoy ? " dp-day--today" : ""}${off ? " dp-day--off" : ""}`;
          return <span key={dIso} className={cls} onClick={() => onPick(dIso)}>{i + 1}</span>;
        })}
      </div>
    </div>
  );
}

/* Caja donde el popover se recorta de verdad: el ancestro mas cercano que
   clipea, o el viewport. Ojo que `overflow-y:auto` fuerza a `overflow-x` a
   computar `auto` por la spec, asi que un contenedor que "solo scrollea
   vertical" igual corta a los costados. */
function cajaDeRecorte(el: HTMLElement): { left: number; right: number } {
  for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
    const s = getComputedStyle(n);
    if (s.overflowX !== "visible" || s.overflowY !== "visible") {
      const r = n.getBoundingClientRect();
      return { left: Math.max(0, r.left), right: Math.min(window.innerWidth, r.right) };
    }
  }
  return { left: 0, right: window.innerWidth };
}

export function DateRangePicker({
  value, minDate, onApply, footerNota = "Días calendario", placement = "auto",
  futuro = false, tz = TZ_NEGOCIO, etiqueta, maxDate = null,
}: {
  value: RangoFechas;
  minDate: string | null;
  /* Espejo de `minDate`: hasta donde llega "Maximo" y hasta donde se puede
     clickear. Para metricas va null, el futuro no existe. Para una pantalla de
     compromisos — cuotas programadas, sesiones agendadas — es la ultima fecha
     con dato real. */
  maxDate?: string | null;
  onApply: (r: RangoFechas) => void;
  footerNota?: string;
  /* Reemplaza el texto del BOTON, no el del popover. Existe para el rango
     DERIVADO: cuando se compara contra "el periodo anterior automatico", ese
     rango no es ninguno de los 12 presets y `presetLabel` lo rotula
     "Personalizado", que se lee como "lo eligio alguien a mano" — justo lo
     contrario de lo que pasa. */
  etiqueta?: string;
  placement?: "bottom" | "top" | "auto";
  futuro?: boolean;
  tz?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [dPreset, setDPreset] = useState(value.preset);
  const [dDesde, setDDesde] = useState<string | null>(value.desde);
  const [dHasta, setDHasta] = useState<string | null>(value.hasta);
  const [vista, setVista] = useState(0);
  const [up, setUp] = useState(false);
  /* El popover ancla a la derecha del boton; si el boton no esta contra el
     borde derecho, el ancho se sale por la izquierda → se corre lo justo. */
  const [dx, setDx] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);

  /* Si no entra ni arriba ni abajo, scrollea lo minimo para que se vea entero.
     El borde que recorta no siempre es el viewport: con el sidebar, el picker
     puede vivir dentro de una columna con scroll propio, y esa columna clipea
     aunque el popover entre en la pantalla. */
  useLayoutEffect(() => {
    if (!open) return;
    const p = popRef.current;
    if (!p) return;
    const clip = cajaDeRecorte(p);
    const r0 = p.getBoundingClientRect();
    const zoom = p.offsetWidth > 0 ? r0.width / p.offsetWidth : 1;
    const anchoUtil = clip.right - clip.left - 16;
    p.style.maxWidth = anchoUtil > 0 ? `${anchoUtil / zoom}px` : "";
    const r = p.getBoundingClientRect();
    if (r.left < clip.left + 8) setDx((d) => d + (clip.left + 8 - r.left));
    p.scrollIntoView({ block: "nearest" });
    /* El rail entra en 340px pero los presets son 12 o 14: si el activo esta
       abajo, abrir el picker no muestra cual esta puesto. */
    railRef.current?.querySelector(".dp-preset--on")?.scrollIntoView({ block: "nearest" });
  }, [open, up]);

  const abrir = () => {
    setDPreset(value.preset); setDDesde(value.desde); setDHasta(value.hasta);
    const s = deIso(value.desde), e = deIso(value.hasta);
    const sI = s.getFullYear() * 12 + s.getMonth(), eI = e.getFullYear() * 12 + e.getMonth();
    setVista(sI < eI ? sI : eI - 1);
    if (placement === "auto") {
      const r = rootRef.current?.getBoundingClientRect();
      setUp(!!r && r.bottom + 510 > window.innerHeight && r.top > window.innerHeight - r.bottom);
    }
    setDx(0);
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const pick = (d: string) => {
    setDPreset("custom");
    if (dDesde && !dHasta) {
      if (d >= dDesde) setDHasta(d);
      else setDDesde(d);
    } else {
      setDDesde(d); setDHasta(null);
    }
  };

  const elegirPreset = (id: string) => {
    const p = presets(minDate, futuro, tz, maxDate).find((x) => x.id === id)!;
    const [s, e] = p.rango();
    setDPreset(id); setDDesde(s); setDHasta(e);
    const sd = deIso(s), ed = deIso(e);
    const sI = sd.getFullYear() * 12 + sd.getMonth(), eI = ed.getFullYear() * 12 + ed.getMonth();
    setVista(sI < eI ? sI : eI - 1);
  };

  const aplicar = () => {
    if (!dDesde || !dHasta) return;
    onApply({ preset: dPreset, desde: dDesde, hasta: dHasta });
    setOpen(false);
  };

  const completo = !!(dDesde && dHasta);
  const nDias = completo ? Math.round((deIso(dHasta!).getTime() - deIso(dDesde!).getTime()) / 86400000) + 1 : 0;
  const hoyIso = iso(hoyEn(tz));

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <button type="button" className={`dp-pill${open ? " dp-pill--open" : ""}`} onClick={() => (open ? setOpen(false) : abrir())}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
        {etiqueta ?? `${presetLabel(value.preset)} · ${rangoStr(value)}`}
        <span className="dp-caret">▾</span>
      </button>

      {open && (
        <div
          ref={popRef}
          className={`dp-pop${placement === "top" || (placement === "auto" && up) ? " dp-pop--up" : ""}`}
          style={dx ? { right: -dx } : undefined}
        >
          <div className="dp-body">
            <div className="dp-rail" ref={railRef}>
              {presets(minDate, futuro, tz, maxDate).map((p) => (
                <div key={p.id} className={`dp-preset${dPreset === p.id ? " dp-preset--on" : ""}`} onClick={() => elegirPreset(p.id)}>
                  <span className="dp-ring" />{p.label}
                </div>
              ))}
            </div>
            <div className="dp-cals">
              <div className="dp-nav">
                <span className="dp-nav-btn" onClick={() => setVista((v) => v - 1)}>‹</span>
                <span className="dp-nav-btn" onClick={() => setVista((v) => v + 1)}>›</span>
              </div>
              <div style={{ display: "flex", gap: 20 }}>
                {/* `maxDate` tambien abre el calendario: de nada sirve que "Maximo"
                    llegue a noviembre si despues no se puede elegir a mano. */}
                <Calendario vista={vista} desde={dDesde} hasta={dHasta} onPick={pick} permitirFuturo={futuro || !!maxDate} hoy={hoyIso} />
                <Calendario vista={vista + 1} desde={dDesde} hasta={dHasta} onPick={pick} permitirFuturo={futuro || !!maxDate} hoy={hoyIso} />
              </div>
              <div className="dp-resumen">
                {completo
                  ? `${fmtCorta(dDesde!)} – ${fmtCorta(dHasta!)} · ${nDias} día${nDias > 1 ? "s" : ""}`
                  : dDesde ? `${fmtCorta(dDesde)} — elegí la fecha de fin` : "Elegí la fecha de inicio"}
              </div>
            </div>
          </div>
          <div className="dp-foot">
            <span className="dp-nota">{footerNota}</span>
            <button type="button" className="hk-btn hk-btn--ghost hk-btn--sm" onClick={() => setOpen(false)}>Cancelar</button>
            <button
              type="button"
              className="hk-btn hk-btn--primary hk-btn--sm"
              style={!completo ? { opacity: 0.4, pointerEvents: "none" } : undefined}
              onClick={aplicar}
            >
              Actualizar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
