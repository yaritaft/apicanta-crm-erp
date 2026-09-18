# Apicanta — ERP de Hackear IT

Un solo lugar para llevar el negocio: la gente interesada, las llamadas, los webinars,
los alumnos, la publicidad y la plata. Todo lo que se carga queda registrado y todo
lo que se muestra se calcula solo.

> **Hackear IT** es el programa de Yari Taft donde devs de LATAM aprenden a pasar el
> sistema de entrevistas y trabajar en remoto para empresas de USA. **Apicanta** es el
> software que lleva ese negocio.

## Qué resuelve

| Área | Qué podés hacer |
|---|---|
| **Panel** | Ver cómo viene el mes: ingresos, resultado, leads, inscriptos, MRR, pipeline, qué requiere atención hoy |
| **Metas** | Poner objetivos del mes y verlos avanzar solos con los datos reales |
| **Leads** | Cargar, buscar, filtrar, importar por CSV, exportar, y convertir en alumno |
| **Pipeline** | Tablero kanban: arrastrar leads entre etapas (también con el teclado) |
| **Agenda** | Sesiones por día, marcar si la persona vino o no, medir la asistencia real |
| **Webinars** | Registrados, asistencia, leads que trajo, conversión, ingresos y retorno |
| **Marketing** | Campañas de Meta con costo por lead, costo por alumno, CTR, CPC, CPM y ROAS |
| **Alumnos** | Quién cursa, con qué plan, cómo viene el progreso y si manda su reporte |
| **Reportes** | El reporte semanal de cada alumno, semana por semana, marcable en un clic |
| **Finanzas** | Ingresos y egresos, por cobrar, MRR, en qué se va la plata |
| **Actividad** | Todo lo que se creó, editó, movió o borró, con autor y fecha |
| **Ajustes** | Etapas, listas, campos propios, integraciones y respaldos |

## Todo es modificable

No hay nada cableado en el código que el usuario no pueda cambiar desde **Ajustes**:

- **Etapas del pipeline** — nombre, color, probabilidad de cierre, orden, cuál es «ganada» y cuál «perdida».
- **Listas** — fuentes de leads, planes, tipos de sesión, categorías de ingreso y egreso, métodos de pago.
- **Campos propios** — agregar campos a leads, alumnos, sesiones, webinars, campañas o movimientos.
  Aparecen solos en el formulario y en la ficha, con el tipo de dato que elijas.
- **Integraciones** — claves de Meta y de Calendly.
- **Datos** — exportar un respaldo, restaurarlo, volver al ejemplo o vaciar todo.

## Diseño

Sigue el design system de Apicanta al pie de la letra: violeta como ambiente, naranja como
única acción, Geist en todo, elevación por capas y no por brillo, cifras tabulares y una
sola cosa naranja por pantalla. Los tokens de `tokens.css` y los componentes de `bundle.css`
están incluidos sin modificar en `src/app/globals.css`; encima va la capa de aplicación.

Tema oscuro por defecto (es el de la marca) y tema claro completo para sesiones largas.

## Pensado para que no haya que explicarlo

- Guía de bienvenida de 5 pasos la primera vez.
- Cada pantalla dice en una línea para qué sirve, y tiene una sola acción principal.
- Los estados vacíos dicen qué hacer, no sólo que no hay nada.
- Buscador global con `⌘K` y botón **Crear** que te lleva al formulario ya abierto.
- Los errores nombran el arreglo («Ingresá un email con @»), no la culpa.
- Todo en español rioplatense, sin emoji en el producto.

## Dónde viven los datos

Hoy Apicanta guarda todo en el navegador (`localStorage`). Es privado, anda sin internet
y no depende de ningún servicio — pero no se comparte entre dispositivos.

Toda la app habla con `src/lib/store.ts` y nunca con el almacenamiento directamente.
Enchufar Supabase después es reemplazar `leer()` y `guardar()` en ese archivo: ninguna
pantalla se entera. El modelo de datos de `src/lib/types.ts` ya está pensado como tablas.

Mientras tanto, **Ajustes → Datos** permite bajar un respaldo en JSON y restaurarlo.

## Correr en local

```bash
npm install
npm run dev
```

Queda en `http://localhost:3010`.

```bash
npm run build   # build de producción
```

## Estructura

```
src/
├── app/
│   ├── layout.tsx           # fuentes, tema sin parpadeo, toasts
│   ├── globals.css          # tokens + componentes del design system + capa de app
│   └── (app)/               # las 12 pantallas, dentro del shell
├── components/
│   ├── ui/                  # Button, Input, Badge, Card, StatCard, DataTable, Modal, Drawer, Toast…
│   ├── charts/              # área, barras, embudo y dona en SVG puro, sin dependencias
│   └── shell/               # sidebar, barra superior, paleta ⌘K, guía, crear rápido
└── lib/
    ├── types.ts             # el modelo de dominio completo
    ├── store.ts             # el motor de datos (y el único punto a cambiar por Supabase)
    ├── metricas.ts          # todos los cálculos del negocio, en un solo lugar
    ├── seed.ts              # datos de ejemplo realistas y determinísticos
    └── format.ts            # formato argentino de números, plata y fechas
```

## Stack

Next.js 16 · React 19 · TypeScript · Tailwind v4 · lucide-react.

Sin librería de gráficos, sin librería de tablas, sin librería de estado: menos superficie
para que algo se rompa y nada que actualizar de urgencia.
