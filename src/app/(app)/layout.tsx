import { Suspense } from "react";
import { Shell } from "@/components/shell/Shell";
import { SoloCliente } from "@/components/shell/SoloCliente";
import { Puerta } from "@/components/shell/Puerta";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SoloCliente esqueleto={<Arranque />}>
      <Puerta>
        <Shell>
          <Suspense fallback={<Cargando />}>{children}</Suspense>
        </Shell>
      </Puerta>
    </SoloCliente>
  );
}

/* Lo que se ve el instante antes de que la app tome el control. */
function Arranque() {
  return (
    <div className="app-shell">
      <div className="hk-sidebar" aria-hidden>
        <div className="hk-sidebar__brand">Apicanta<em>.</em></div>
        <div className="stack-2" style={{ marginTop: 16 }}>
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 40, opacity: 1 - i * 0.08 }} />
          ))}
        </div>
      </div>
      <div className="app-main">
        <div className="app-topbar" />
        <main className="app-content"><Cargando /></main>
      </div>
    </div>
  );
}

function Cargando() {
  return (
    <div className="stack-5" aria-busy="true" aria-label="Cargando">
      <div className="stack-2">
        <div className="skeleton" style={{ height: 36, width: 240 }} />
        <div className="skeleton" style={{ height: 22, width: 420 }} />
      </div>
      <div className="grid-stats">
        {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 116 }} />)}
      </div>
      <div className="grid-2">
        <div className="skeleton" style={{ height: 300 }} />
        <div className="skeleton" style={{ height: 300 }} />
      </div>
    </div>
  );
}
