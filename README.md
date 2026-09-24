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
| **Dashboard & KPIs** | Todas las métricas del negocio en una tabla maestra, de la publicidad (TOFU) a la plata que queda: día por día o mes por mes con el total al final, comparando contra el período anterior y filtrando por embudo o por webinar |
| **Metas** | Poner objetivos del mes y verlos avanzar solos con los datos reales |
| **Leads** | Cargar, buscar, filtrar, importar por CSV, exportar, y convertir en alumno |
| **Pipeline** | Tablero kanban: arrastrar leads entre etapas (también con el teclado) |
| **Agenda** | Sesiones por día, por período (hoy, esta semana, la semana pasada o un rango), filtradas por estado, tipo, anfitrión y canal, de a páginas. Se marca si la persona vino o no; la asistencia se mide en Dashboard & KPIs |
| **Webinars** | Registrados, asistencia, leads que trajo, conversión, ingresos y retorno |
| **Marketing** | Campañas de Meta con costo por lead, costo por alumno, CTR, CPC, CPM y ROAS |
| **Alumnos** | Quién cursa y cómo viene, en lista o en el pipeline de servicio (venta nueva → onboarding → en servicio…). Cada venta registrada crea su alumno sola |
| **Reportes** | Dashboard y tabla de los reportes por rango de fechas: respuesta, horas, postulaciones, entrevistas, bloqueos y quién está en riesgo, marcable en un clic |
| **Ventas** | Un asistente paso a paso arma la venta, su plan de cuotas y los cobros que ya entraron, con los nombres de la planilla de Angelo; el origen sale de la UTM de quien compró. La lista se filtra por período, vendedor, servicio, estrategia, proyecto y cuenta. Importa y exporta la hoja Ventas de esa planilla |
| **Conciliación** | Los cobros de Stripe, Hotmart, Whop, dLocal, Mercado Pago, Mercury, Binance y Trust, imputados a la cuota que les corresponde |
| **Finanzas** | El estado de resultados sobre lo cobrado y lo facturado; en el detalle, las cuotas vencidas, los gastos y las comisiones. Los KPIs viven en Dashboard & KPIs |
| **Actividad** | Todo lo que se creó, editó, movió o borró, con autor y fecha |
| **Ajustes** | Servicios, cuentas recaudadoras, estrategias y proyectos; de qué es cada UTM; etapas, listas, campos propios, integraciones y respaldos |

## Todo es modificable

No hay nada cableado en el código que el usuario no pueda cambiar desde **Ajustes**:

- **Etapas del pipeline** — nombre, color, probabilidad de cierre, orden, cuál es «ganada» y cuál «perdida».
- **Ventas** — servicios (precio de lista y tipo), cuentas recaudadoras (con su comisión real), estrategias
  (cuál es el embudo de webinar), proyectos y el porcentaje del referidor. Los nombres son los de la planilla
  de Angelo.
- **Etapas del servicio** — las columnas del pipeline de alumnos: nombre, color y orden. Al borrar una, sus
  alumnos pasan a la que elijas. En Supabase necesitan `supabase/alumnos-servicio.sql`.
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

Apicanta guarda en **Supabase** y muestra desde memoria. El patrón es local-first:

1. Al arrancar trae todo de la nube de una sola vez y lo deja en memoria.
2. Cada cambio se aplica en memoria al instante — la pantalla nunca espera a la red.
3. La escritura sale detrás, en una cola que reintenta. El pie de la barra lateral
   dice en todo momento si está guardado, guardando o si algo falló.

Si las variables de Supabase no están, la app usa `localStorage` y funciona igual.
No hay una versión degradada: son el mismo código con otro destino.

| Variable | Para qué |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Clave publicable |

El schema vive en las migraciones del proyecto de Supabase. Las columnas se llaman igual
que los campos de `src/lib/types.ts` (en camelCase, entre comillas), así que el adaptador
no necesita capa de mapeo: lo que sale de la base es la forma que espera la app.

> **Sobre el acceso:** la app todavía no tiene login, así que las políticas de RLS dejan
> leer y escribir con la clave publicable. Esa clave viaja en el bundle del navegador.
> Mientras siga así, cualquiera con la URL del sitio puede ver y modificar los datos.
> El paso siguiente es Supabase Auth: RLS ya está activo en las 12 tablas, así que es
> cambiar las políticas y agregar la pantalla de login.

En **Ajustes → Datos** se puede bajar un respaldo en JSON y restaurarlo.

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
    ├── finanzas.ts          # el P&L, comisiones y mora, como los mide Yari
    ├── conciliacion.ts      # el motor que propone a qué cuota va cada cobro
    ├── pasarelas.ts         # traduce el CSV de cada pasarela a un solo formato
    ├── seed.ts              # datos de ejemplo realistas y determinísticos
    └── format.ts            # formato argentino de números, plata y fechas
```

## Stack

Next.js 16 · React 19 · TypeScript · Tailwind v4 · lucide-react · Supabase.

Sin librería de gráficos, sin librería de tablas, sin librería de estado: menos superficie
para que algo se rompa y nada que actualizar de urgencia.


## Reportes por link

En Ventas, Agenda y Dashboard & KPIs todo lo que se elige —período, filtros, búsqueda, orden, página,
columnas, comparar— queda en la URL. Un reporte armado se guarda en favoritos o se le pasa a otra persona
con **Copiar link**, y se abre igual. Lo que está en su valor de siempre no se escribe, así los links quedan
cortos. Los nombres de cada parámetro están en `src/lib/useParamsURL.ts` y en cada pantalla.

## Cobros y conciliación

Una venta se cobra en cuotas, y una cuota puede cobrarse con varios medios: mitad por
Stripe, mitad por transferencia. Cada cobro es un **pago** atado a su procesador, así que
las comisiones y el fee salen del número real y no de un promedio.

Lo que entra a una pasarela llega primero a **Conciliación** como un *movimiento*: plata
que existe pero todavía no sabe de quién es. Recién cuando se imputa a una cuota se
convierte en pago y mueve el cash collected. Mientras tanto se ve, pero no cuenta — si
contara, el mismo peso podría terminar sumado dos veces cuando alguien cargue el pago
a mano.

Para cada movimiento pendiente, Apicanta puntúa las cuotas candidatas por monto, nombre,
correo, fecha de vencimiento y medio de pago, y muestra **por qué** propone cada una. Sólo
concilia solo cuando el monto calza exacto, hay un único candidato claro y le gana por
lejos al segundo; con cualquier duda decide una persona. Todo se puede deshacer: al
deshacer, los pagos se borran y las cuotas vuelven a estar pendientes.

**Cómo entran los cobros**

1. **Importando el CSV** que exporta cada pasarela (Importar → pegás el archivo). El lector
   entiende las columnas de Stripe, Hotmart, Whop, dLocal y Mercado Pago —y las de un resumen
   bancario— aunque cada una
   les ponga un nombre distinto, y descarta reembolsos y filas de resumen.
2. **Solo, con las claves puestas.** `GET /api/pasarelas/sync` trae los últimos 60 días de
   cada pasarela que tenga sus variables de entorno (ver `.env.example`). Sin claves, el
   endpoint responde vacío y la app sigue funcionando con el CSV.

En los dos casos la referencia del cobro es la clave: el mismo pago importado dos veces
sigue siendo uno solo.

**Antes de usarlo contra Supabase** hay que correr `sql/conciliacion.sql` una vez en el SQL
Editor. Crea la tabla `movimientos` con su política de RLS y agrega dos columnas. Hasta que
eso pase, la app no se rompe: la tabla que falta se saltea y los cobros viven sólo en el
navegador.


## La planilla de Angelo

Las ventas se cargaban en la hoja Ventas del "Centro de control" (Google Sheets): una fila por cobro, con
los datos de la venta repetidos. La app guarda lo mismo con los mismos nombres —Servicio adquirido,
Proyecto, Estrategia utilizada, Vendedor, Cuenta recaudadora, Característica de pago, Ventas Nuevas vs
Cuotas, tipo de cambio, quién transfirió, CUIT, chequeado, setter, referidor— pero separado en venta,
cuotas y cobros, que es lo que permite los vencimientos y la mora.

- **Importar** (Ventas → Importar planilla): el .xlsx entero o la hoja Ventas en .csv. La fila con valor
  total abre la venta; las siguientes de la misma persona y servicio son sus cobros; lo que falta cobrar
  es valor total menos cobrado, como la hoja Estado_Clientes. Reimportar actualiza, no duplica. Las reglas
  están en `src/lib/angelo.ts`.
- **Exportar** (Ventas → Exportar planilla): la hoja Ventas con sus 36 columnas.
- La comisión del procesador es la real: la de la pasarela si el cobro se concilia; si no, la de la cuenta,
  que se corrige a mano en Finanzas → Detalle → Procesadores.
- Antes de usarlo contra Supabase hay que correr `supabase/modelo-angelo.sql` (sólo agrega columnas).

## De dónde viene cada venta: las UTMs

El origen de una venta (Estrategia utilizada, Proyecto y webinar) no lo elige el closer: sale de los UTMs
con los que llegó quien compró —sus agendas de Calendly, la más reciente primero, y su primer contacto—.
En **Ajustes → UTMs** cada UTM se asigna a una estrategia, un proyecto y un webinar: la del webinar del
23/09 es `utm_source=Webinar` + `utm_medium=23-09`. La pantalla lista las UTMs que llegaron sin asignar,
trae armada la sugerencia para las de webinar y completa de una vez el origen de las ventas que no lo
tenían, sin pisar lo que alguien eligió a mano. Las reglas están en `src/lib/utms.ts`.

## Cobros en pesos y la Financiera

- **Registrar un pago** es un paso a paso (cuánto y por dónde, la prueba, los datos de la transferencia,
  qué hacer si pagó menos, resumen). Desde la ficha va embebido en la columna de la venta.
- En las cuentas en pesos el tipo de cambio arranca con el **blue venta**: el de DolarHoy si el pago es
  de hoy, el cierre de ese día (ArgentinaDatos) si es de otro (`/api/dolar`). El closer lo puede cambiar;
  el cobro guarda los dos, con la fuente y la hora.
- Si pagó a la Financiera, el **CBU/CVU** desde el que transfirió es obligatorio y se valida con sus
  dígitos verificadores. Va al reporte para la Financiera, con el nombre, el CUIT y el comprobante.
- Antes de usarlo contra Supabase hay que correr `supabase/utms-y-financiera.sql` (agrega columnas y
  marca en pesos las cuentas en ARS).
