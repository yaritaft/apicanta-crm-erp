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
| **Dashboard & KPIs** | Todas las métricas del negocio en una tabla maestra, de la publicidad (TOFU) a la plata que queda: día por día o mes por mes con el total al final, comparando contra el período anterior y filtrando por embudo o por webinar. Con **Tabla \| Gráficos** se ven las mismas cifras dibujadas: Revenue vs Cash Collected, tasa de cobro y de mora, ticket promedio, desgloses por plan de pago, país, estrategia, servicio y proyecto, y un mapa |
| **Metas** | Poner objetivos del mes y verlos avanzar solos con los datos reales |
| **Leads** | Cargar, buscar, filtrar, importar por CSV, exportar, y convertir en alumno |
| **CRM** | Las agendas de Calendly como en el Airtable de ventas (Booking Calls y Agendas Resells): cada agenda entra sola, en vivo, con lo que contestó en el formulario; el equipo carga el Pre-Call, cómo salió la llamada, las notas y la grabación en la celda misma. Vistas por closer y por día, del setter y de cada lanzamiento |
| **Agenda** | Sesiones por día, por período (hoy, esta semana, la semana pasada o un rango), filtradas por estado, tipo, anfitrión y canal, de a páginas. Se marca si la persona vino o no; la asistencia se mide en Dashboard & KPIs |
| **Webinars** | Registrados, asistencia, leads que trajo, conversión, ingresos y retorno |
| **Marketing** | Campañas de Meta con costo por lead, costo por alumno, CTR, CPC, CPM y ROAS |
| **Alumnos** | Quién cursa y cómo viene, en lista o en el pipeline de servicio (venta nueva → onboarding → en servicio…). Cada venta registrada crea su alumno sola |
| **Reportes** | Dashboard y tabla de los reportes por rango de fechas: respuesta, horas, postulaciones, entrevistas, bloqueos y quién está en riesgo, marcable en un clic |
| **Ventas** | Un asistente paso a paso arma la venta, su plan de cuotas y los cobros que ya entraron, con los nombres de la planilla de Angelo; el origen sale de la UTM de quien compró. La lista se filtra por período, vendedor, servicio, estrategia, proyecto y cuenta. Importa y exporta la hoja Ventas de esa planilla |
| **Clientes** | La gente que compró: qué compró, cuánto pagó, cuánto le falta y si está al día, atrasada, pagó todo o se dio de baja. Sale de las ventas: no hay nada que cargar |
| **Conciliación** | Los cobros de Stripe, Hotmart, Whop, dLocal, Mercado Pago, Mercury, Binance y Trust, imputados a la cuota que les corresponde |
| **Finanzas** | El estado de resultados sobre lo cobrado y lo facturado y el resultado de cada embudo (CAC, ROAS y profit); en el detalle, las cuotas vencidas (con alarma desde los 7 días de atraso), los gastos y las comisiones. Los KPIs viven en Dashboard & KPIs |
| **Caja** | Los arqueos (cuánto hay de verdad en cada cuenta contra lo que la app esperaba, en total y cuenta por cuenta), los movimientos entre cuentas propias (cargados a mano o detectados en Mercury y Stripe, con la salida conciliada contra la llegada), los meses de vida contra el colchón de 6 meses y los retiros del dueño |
| **Equipo y honorarios** | Sólo para los dueños: quién es quién, con qué entra a la app, qué cobra cada uno (fijo, bonos, comisiones, tramos y piezas, y sobre qué se mide cada variable) y la liquidación de cada mes, que se calcula sola y al cerrarla entra a Finanzas |
| **Actividad** | Todo lo que se creó, editó, movió o borró, con autor y fecha |
| **Ajustes** | Servicios, cuentas recaudadoras, estrategias y proyectos; de qué es cada UTM; etapas, listas, campos propios, integraciones y respaldos |

## Todo es modificable

No hay nada cableado en el código que el usuario no pueda cambiar desde **Ajustes**:

- **Etapas de los leads** — nombre, color, probabilidad de cierre, orden, cuál es «ganada» y cuál «perdida».
  La etapa de cada lead se cambia desde su ficha.
- **CRM** — las opciones de Pre-Call, Estado de Llamada y Estado Pre-Call (nombre, color, orden y qué dice
  de la llamada), desde el encabezado de cada columna; qué tipos de evento de Calendly entran en cada tabla,
  desde el engranaje de la barra de vistas.
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

> **Sobre el acceso:** se entra con correo y clave (o con un enlace por correo), y sólo ve
> datos quien está en `usuarios_permitidos`, con un **tipo de cuenta** (`tipos_cuenta`): Dueño,
> Todo menos honorarios, Director comercial, Closer, Setter, Administración, Marketing, o los que
> agreguen los dueños. Cada tipo dice qué áreas ve y cuáles edita, y si ve sólo lo suyo. Lo
> decide la base: las políticas de RLS preguntan `ve(tabla)`, `edita(tabla)` y, para el closer,
> `mis_ventas()`, `mis_leads()`… (`supabase/tipos-cuenta.sql`); lo que no ve le llega vacío y lo
> que no edita se rechaza. Lo que cobra cada uno vive en `honorarios` y `liquidaciones`, que
> sólo se leen con `es_dueno()`.
> Tampoco quedan en el navegador: la copia que guarda para abrir rápido va sin ellas, y al
> cerrar sesión se borra entera.

Cómo le gusta ver la app a cada uno (qué filas del Dashboard oculta y en qué orden) no es un dato
del negocio: va en `preferencias`, una fila por usuario, que cada uno lee y escribe sólo para sí
(`lib/preferencias.ts`, `supabase/preferencias.sql`). Sin esa tabla queda sólo en el navegador.

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
│   ├── crm/                 # la grilla tipo Airtable, sus vistas, filtros y el registro abierto
│   └── shell/               # sidebar, barra superior, paleta ⌘K, guía, crear rápido
└── lib/
    ├── types.ts             # el modelo de dominio completo
    ├── store.ts             # el motor de datos (y el único punto a cambiar por Supabase)
    ├── crm.ts               # las columnas del CRM, cómo se arma cada fila, vistas y filtros
    ├── etapas-auto.ts       # la etapa de cada oportunidad se mueve sola (llamada, venta, Calendly)
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
cortos. Los nombres de cada parámetro están en `src/lib/useParamsURL.ts` y en cada pantalla. En el Dashboard,
`?modo=graficos` abre los gráficos (y `?dim`, `?met` y `?zona` el desglose, la métrica y la zona del mapa).

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
- La comisión del procesador es la real: la de la pasarela si el cobro se concilia; si no, la de la cuenta
  (Ajustes → Ventas → Cuentas recaudadoras), que se corrige a mano cobro por cobro en Finanzas → Detalle →
  Procesadores. Al cambiar la de una cuenta se elige si los cobros que ya la usaban pasan a la nueva; los
  conciliados y los corregidos a mano no se tocan. La Financiera cobra el 6%, como en la planilla.
- Antes de usarlo contra Supabase hay que correr `supabase/modelo-angelo.sql` (sólo agrega columnas).

## El CRM: una tabla como un Excel, y el cierre del día

Yari (29/09) quería salir de Airtable: "lo fácil le gana a todo". El **CRM** (`/crm`) es una tabla con **una fila
por llamada** y todo lo que se sabe de la persona, sin cargar nada a mano: sus dos estados, la objeción, si hubo
oferta y el cierre estimado; por qué vía y con qué ad llegó; país (del prefijo del teléfono), edad, tecnologías,
inglés, cuánto gana y cuánto puede invertir; la grabación y la venta. No tiene título propio: el de la barra de la
app alcanza, y todo lo demás (vistas, búsqueda, período, «Sin cargar», Tabla | Informe, columnas, copiar el link y
Cerrar el día) va en una sola barra.

**Todo lo de una columna está en su título**, como en Excel (02/10: el problema de Airtable y de la grilla era
"meter un apartado de filtrado, seleccionar de una lista de 90 columnas la que estabas buscando y ponerle un montón
de condiciones"). Un clic en el título abre su panel (`components/crm-tabla/FiltroColumna.tsx`):

- **Ordenar** por ella; y si la tabla ya está ordenada por otra, sumarla como criterio siguiente («después de
  Closer»). Hasta tres, y el título muestra el lugar de cada una.
- **La lista de valores** con cuántas filas tiene cada uno: se destilda lo que no se quiere ver, o «Sólo» deja uno.
  Los estados aparecen con su pastilla y en el orden del Airtable.
- **Filtros de texto y de fecha**: se escribe en el buscador y se elige «las que contienen» o «las que no contienen»
  (en Notas busca en lo que dice la nota); en las columnas de fecha, un desde y un hasta.

El período, la búsqueda, los filtros, el orden y las columnas van en el link
(`?solo-pais=Argentina|México&sin-estadoLlamada=Por venir&con-notas=cuotas&desde-agendo=2026-09-01&orden=closer,-llamada`)
y la pantalla vuelve como se dejó (`lib/crm-tabla.ts`).

**Vistas guardadas**, como en Notion (`components/ui/VistasGuardadas.tsx`, `lib/vistas-guardadas.ts`): lo que se está
viendo se guarda con un nombre, **sólo para uno o para todo el equipo**, y se abre con un clic. Una vista es ese mismo
link. El botón dice qué vista está abierta y marca si se cambió algo desde que se abrió: se guarda el cambio o se
vuelve a como estaba. Las propias van con las preferencias del usuario (`preferencias`); las del equipo, en la tabla
`vistas` (`supabase/vistas.sql`): las ve quien entra a la app y las guarda quien ve todo (no las cuentas «sólo lo
suyo»). Sin esa tabla la app anda igual y sólo ofrece «Sólo para mí».

«**Informe**» (antes «Por qué no se cierra») muestra, con los mismos filtros, cuánto se cierra de lo que se presentó,
las objeciones y todo eso abierto por estado, país, edad, tecnología, plata, ad, vía o closer.

### Los estados de una llamada: una sola fuente

Había un estado distinto en cada pantalla (Agendada / Hecha / No vino en la Agenda, Con cierre / Sin cierre en el
CRM, Compró / No compró en el cierre del día, los del Airtable en la grilla). Ahora (02/10) son **dos, los del
Airtable**, iguales en el CRM, la grilla, la Agenda, la ficha, el cierre del día, el Dashboard y Webinars
(`lib/estados.ts`, `components/estados/EstadoLlamada.tsx`):

- **Estado Pre-Call**: Confirmado, Reagendar, Sin Respuesta.
- **Estado de Llamada**: Compra Full, Compra Cuotas, Reserva, Seguimiento de Pago, Seguimiento Nutrición, Califica
  Downsell, Compra Downsell, Llamada Interrumpida, Dejó de Contestar, Inasistió, Lead descartado, NO Calificado,
  Devolución, 2da Agenda (auto), Canceló (auto).

Las opciones se editan desde la grilla y quedan en Ajustes. Se cambian con un clic en su pastilla desde cualquiera
de esas pantallas y se guardan en la llamada por el mismo camino (`store.editarLlamadas`), así que lo que se cambia
en una aparece en todas. Lo demás **se deduce** del Estado de Llamada y no se carga:

- cómo quedó la agenda (hecha, no vino, cancelada), que es lo que cuenta la asistencia del Dashboard. Vaciar el
  estado la devuelve a agendada (lo que canceló Calendly sigue cancelado);
- si cerró o no, para el Informe (con cierre, sin cierre, no se presentó);
- la etapa de la oportunidad (`lib/etapas-auto.ts`).

Sin estado cargado, la pastilla dice «Por venir» si todavía no fue y «Sin cargar» si ya pasó: no son estados, son el
aviso. Las sesiones que no son de venta (una 1 a 1, un testimonio) no llevan estos estados: en la Agenda sólo se
marca si se hicieron.

El **cierre del día (EOD)** es lo único que carga el closer: al final del día pasa por sus llamadas de a una, como un
Typeform (`components/crm-tabla/Eod.tsx`, `lib/eod.ts`, inspirado en Blue OS). Elige el **Estado de Llamada**, que
viene cargado si ya lo tenía (y el Estado Pre-Call, si hay que corregirlo), y según el estado se le pide lo que
falta: de una compra, la venta, en el asistente de siempre; de una que quedó en seguimiento, por qué no cerró (la
lista de objeciones), si hizo la oferta y para cuándo estima cerrarlo; de una que se perdió, por qué y si hizo la
oferta; de una que no vino o se canceló, nada. Si pidió otra fecha alcanza con «Reagendar». Cada llamada se guarda al
pasar a la siguiente, y cerrar a la mitad deja lo elegido. Suma las que quedaron sin cargar de las últimas dos
semanas. Lo mismo se carga desde la ficha de la persona, que tiene la vista **Llamadas** con su perfil, de dónde vino
y cada llamada con sus dos estados. Antes de usarlo contra Supabase hay que correr `supabase/eod.sql` (seis columnas
en `sesiones`; `resultado` ya no se usa).

**Se corrige en la celda** (02/10: "deberían ser editables y poder corregir ahí mismo, como un Excel"). Un clic
abre la celda, Enter guarda y el aviso trae «Deshacer» (`CeldaEditable`, `escrituraDe` en `lib/crm-tabla.ts`). Lo que
es de la llamada (closer, sus dos estados, objeción, oferta, cierre estimado, grabación, notas) cambia esa llamada.
Lo que es de la persona (nombre, mail, teléfono, país y lo que contestó
al agendar) queda en la persona y cambia en todas sus llamadas: lo que contestó no se pisa, la corrección va en
`extra.corregido` de su contacto y se aplica encima de las respuestas (`lib/perfil.ts`), así la ven igual el CRM, la
ficha, la estrella de calificada, la Agenda y el Dashboard; vaciar la celda vuelve a lo que contestó. Lo que sale solo
(la fecha, la vía, el ad, si califica, la venta) no se edita y lo dice al pasar el mouse. El nombre abre la ficha.
Cada tipo de cuenta corrige lo que edita, y la base lo traba igual.

El cierre del día es todo desplegables. Al elegir cómo terminó, la persona se
corre a la izquierda y lo que sigue aparece a la derecha, sin bajar. El link de la grabación viene cargado si Fathom
la ató; si no, se pega o se busca entre las grabaciones de Fathom del closer de esa llamada y se ata (`api/fathom`:
buscar y atar; sólo quien la atendió o un dueño, porque entre las de un closer puede haber reuniones que no son de
ventas).

La **ficha** tiene cada dato una sola vez: a la izquierda, cómo contactarla, su oportunidad y de dónde vino; en la
vista Llamadas, quién es (`PerfilPersona`, se corrige con un clic) y cada llamada.

La **Agenda** tampoco repite el título: la búsqueda, el período y los filtros van en una fila, y cada llamada de
venta muestra sus dos estados, que se cambian ahí mismo.

La planilla como la de Airtable que había antes sigue en `/crm/grilla`, fuera del menú.

### La grilla de antes (Booking Calls)

Reemplazó al Pipeline: una planilla como la de Airtable con **una fila por agenda de Calendly** (una llamada de
venta, no una persona: si alguien agenda dos veces son dos filas). Las agendas entran solas: el webhook de Calendly
las escribe en la base y Realtime las trae a la pantalla en segundos, sin recargar, con la fila resaltada un momento.
Hay dos tablas, como en el Airtable: **Booking Calls** (las llamadas de asesoramiento: webinar, VSL, setter) y
**Agendas Resells** (las de auditoría). Qué tipo de evento va a cada una se elige en el engranaje.

**Las columnas que se llenan solas** llevan un rayo (⚡) en el encabezado: Nombre Completo, Fecha de llamada,
Closer (el anfitrión en Calendly), WhatsApp, Email, UTM Source, Medium, Campaign y Content, y lo que contestó en el
formulario — Años de trabajo, Nivel de inglés, Lenguajes, Capacidad de Inversión (y, ocultas, Formación, Gana por
mes, Instagram, Agendó el y Tipo de llamada). Se pintan por lo que dicen: verde oscuro lo mejor, rosa lo que no
alcanza. Funnel (del estándar de UTMs o del tipo de evento), Mes, Record ID y Agenda calificada son fórmulas.

**Las que carga el equipo** se editan en la celda, como en Airtable (clic o Enter para abrir, escribir busca la
opción, Supr la vacía, flechas y Tab para moverse, Espacio abre el registro entero): **Pre-Call**, **Estado de
Llamada**, **Notas de llamada**, **Grabación** y **Estado Pre-Call**. A la base va sólo lo que cambió, así no se
pisa con el webhook de Calendly.

- El Estado de Llamada también dice si la llamada se hizo: «Compra Full» es lo mismo que marcar «Se hizo» en la
  Agenda, e «Inasistió», «No vino». Cada opción dice qué marca (se edita con sus opciones).
- Mientras nadie lo cargue, se pone solo: **Inasistió** si la llamada quedó como que no vino, **Canceló (auto)** si
  canceló y no volvió a agendar, y **2da Agenda (auto)** si la persona ya había agendado antes. Una agenda
  reprogramada no es otra fila: la reemplaza la nueva.
- **Vistas**: Todas; cada closer con Ayer, Hoy, Semana, Mes y Todas (por el día de la llamada, en hora de
  Argentina); el setter (sus agendas, Sin Respuesta, Reagendar y No asistió); y un **Lanzamiento** por webinar,
  clase cero o Q&A que trajo agendas. Ocultar campos, filtrar, agrupar, ordenar, colorear filas y el alto de las
  filas funcionan como en Airtable; lo que cada uno cambia de una vista, y las vistas que se crea, quedan en su
  navegador. Tabla, vista y registro abierto van en la URL: el link lleva a lo mismo.

**Todo conectado.** Cada fila del CRM *es* la llamada de la Agenda, y lo que se carga en un lado se ve en los demás:

- **Agenda**: el Estado de Llamada marca la llamada como hecha, que no vino o cancelada (y de ahí la asistencia del
  Dashboard y de cada webinar); lo que avisa Calendly pone solo «Inasistió» o «Canceló (auto)». La Agenda muestra y
  cambia los mismos dos estados, en la lista y en el detalle de la llamada.
- **Ventas**: al elegir un estado de compra («Compra Full», «Compra Cuotas», «Reserva», «Compra Downsell») aparece
  **Cargar la venta**: el asistente de Ventas con la persona y el closer ya elegidos, atado a esa llamada. Si la venta
  se carga por otro lado, la llamada de la que salió toma sola el estado de compra que corresponde (al contado, en
  cuotas, con reserva o de downsell), si nadie le había puesto uno. La celda muestra la bolsa verde con la venta
  cargada, o el botón punteado si compró y falta cargarla. La venta crea su servicio, como siempre.
- **Etapas de la oportunidad** (lo que antes se arrastraba en el Pipeline): se mueven solas. Agendar → Sesión
  agendada; la llamada se hizo → Propuesta; se cargó la venta → Inscripto; «NO Calificado» o «Lead descartado» →
  Perdido (salvo que ya haya comprado); «Devolución» → Perdido aunque haya comprado. Sólo avanzan (una llamada hecha
  no le saca la compra a nadie), volver a agendar reabre al que se había perdido y ⌘Z las devuelve a donde estaban.
  Qué dice cada estado de la llamada y de la oportunidad se elige en sus opciones. Las reglas están en
  `src/lib/etapas-auto.ts` y las usan el CRM, la Agenda, Ventas y la entrada de Calendly.
- **La persona tiene una sola versión**: el nombre, el mail o el teléfono corregidos en Leads, la ficha, la Agenda,
  el servicio o una venta quedan corregidos en todos lados (contacto, oportunidades, llamadas, ventas y servicio), y
  Calendly no los vuelve a pisar. Los comentarios del registro son el chat de su ficha.
- **Reprogramaciones**: la agenda nueva hereda las notas y el Pre-Call de la vieja. El Estado Pre-Call no: la nueva
  se confirma de nuevo.

Las reglas están en `src/lib/crm.ts` y la pantalla en `src/components/crm/`. Antes de usarlo contra Supabase hay
que correr `supabase/crm.sql` (cuatro columnas en `sesiones` y la configuración en `ajustes.crm`).

## De dónde viene cada venta: las UTMs

Los links con UTMs siguen el **estándar de UTMs** de Yari (24/09/2026), que está en `src/lib/utm-estandar.ts`:
todo en minúscula, sin tildes ni espacios; `_` separa campos y `-` separa palabras; fechas `aaaammdd`; y
`utm_campaign` arranca con el funnel (`vsl`, `vsl-yt`, `webinar`, `clase0`, `qa`, `setter`, `referido`). Cada vía de
agenda tiene una sola combinación: por ejemplo, el replay de un webinar es
`utm_source=email&utm_medium=email&utm_campaign=webinar_20260924&utm_content=replay`.

En **Ajustes → UTMs** está el **creador de UTMs**: se elige el caso (pauta de Meta a una VSL, VSL orgánica, VSL de
YouTube, webinar, clase cero, Q&A, setter o referido), se completa lo que cambia y sale el link listo para copiar
(en los eventos, los tres: vivo, replay y seguimiento), con cómo lo va a leer la app.

El origen de una venta no lo elige el closer: sale de los UTMs de quien compró, los de sus agendas de Calendly (last
touch, la más reciente primero) y los de su primer contacto (first touch). Del estándar sale todo solo: la
estrategia (del funnel: `vsl_martin` es VSL Martin), el webinar y su proyecto (de la fecha), el setter (de
`setter_{nombre}`) y el referidor (de `utm_content`). Para los links que no siguen el estándar hay reglas propias, que
mandan (`*` al final es «empieza con»). Los links viejos del webinar (`utm_source=Webinar` + `utm_medium=23-09`) se
siguen leyendo.

La **clase cero** y el **Q&A** son parte del lanzamiento del webinar (Yari, 25/09): el link dice de qué webinar son,
con la fecha del webinar (`clase0_webinar_20260924`, `qa_webinar_20260924`), así nadie tiene que calcular a cuál le
corresponde. Sus ventas van con la estrategia **Webinar** (en la planilla se llamaba «Lanzamiento»; el importador lo
sigue leyendo), su webinar y su proyecto. Los links que traían sólo la fecha de la clase (`clase0_20260929`) se leen
como del último webinar hasta ese día (hasta 21 días antes), y Ajustes → UTMs los marca como fuera del estándar.

**De dónde vinieron las agendas.** Cada webinar cuenta las agendas de todo su lanzamiento, separadas por vía: el vivo,
el replay y el seguimiento del webinar, la clase cero y el Q&A (`lib/agendas-webinar.ts`). La ficha del webinar tiene
la tabla con agendas, calificadas, ventas, cierre, facturado y cobrado de cada vía; una venta es de la vía por la que
agendó esa persona (su última agenda del lanzamiento hasta el día de la venta), y las de quien no agendó por esos
links van aparte (`lib/vias-webinar.ts`). En el Dashboard, «Webinar y agenda» tiene las agendas con el replay, del
seguimiento, de la clase cero y del Q&A, y «Ventas» las ventas de cada vía. «Llamadas después» de la planilla es todo
lo de después del vivo: replay, seguimiento, clase cero y Q&A.

Una agenda sin UTMs queda con `source=direct` y `medium=none`: llegó sola, sin un link nuestro. Las reglas están en
`src/lib/utms.ts`.

## Cobros en pesos y la Financiera

- **Registrar un pago** es un paso a paso (cuánto y por dónde, la prueba, los datos de la transferencia,
  qué hacer si pagó menos, resumen). Desde la ficha va embebido en la columna de la venta.
- En las cuentas en pesos el tipo de cambio arranca con el **promedio entre el dólar blue (venta) y el cripto
  (venta)**, como lo hace Angelo (02/10: «uso el medio»): de DolarHoy / DolarApi si el pago es de hoy, el cierre
  de ese día (ArgentinaDatos) si es de otro (`/api/dolar`, `lib/cambio.ts`). Si no se puede traer el cripto,
  va el blue solo. El closer lo puede cambiar; el cobro guarda el que propuso la app, con de dónde salió.
- **Los pesos son un campo**: arrancan en monto × tipo de cambio y se pueden escribir (el cliente transfirió otro
  número); entonces el tipo de cambio es el que resulta y la base en dólares no cambia. Debajo se ve lo que se
  queda la cuenta (la Financiera, 6%).
- A la Financiera (y a cualquier cuenta en pesos) se le pide el **nombre y el CUIT** de quien transfirió, los
  dos obligatorios. **El CBU/CVU de origen ya no se pide** (Angelo, 02/10: «con nombre y CUIT se rastrea»): sale
  del formulario y del reporte; los cobros viejos conservan el que traían.
- Antes de usarlo contra Supabase hay que correr `supabase/utms-y-financiera.sql` (agrega columnas y
  marca en pesos las cuentas en ARS).

## Equipo y honorarios

Una sección que ven sólo los dueños (Yari y Juan Cruz), con tres solapas:

- **Equipo y lo que cobra.** Cada persona tiene su puesto, su rol en las ventas (closer, setter,
  director, growth, socio o ninguno), el correo con el que entra y lo que cobra, armado con
  conceptos: un **fijo** mensual, un **bono** que se decide al liquidar, una **comisión (%)**, un
  monto **por cada tramo** (US$ 500 cada US$ 100.000, US$ 100 cada 15 llamadas) o una tarifa
  **por pieza** (reels, sesiones, minutos). Cada variable dice sobre qué se mide: cash collected,
  cash collected post pasarelas, lo facturado, el profit, ventas cerradas, llamadas de la Agenda
  (con su utm_source) o una cantidad que se carga a mano; y, si sale de las ventas, de cuáles (las
  que cerró, agendó o dirige, o todas, con filtro de servicio). Cada concepto puede tener vigencia:
  un fijo que empieza o termina a mitad de mes se prorratea.
- **Liquidación del mes.** Se calcula sola con los cobros, las ventas, la Agenda y Finanzas; lo que
  la app no puede saber (cuántos reels, si ganó el bono) se carga en el renglón. Al **cerrarla**
  queda la foto de lo que se paga y los sueldos entran a Finanzas como un gasto por categoría,
  sin nombres (Finanzas la ve todo el equipo). Las comisiones de closers y del director y el
  reparto del profit no se cargan: Finanzas ya las calcula de las ventas, y la tasa con la que
  las calcula (`equipo.comisionRate`) se escribe desde lo que cobra cada uno, así los dos lados
  dan lo mismo. Quien vende y no tiene nada cargado aparece igual con la comisión que le calcula
  Finanzas, también si ya no está en el equipo y entraron cuotas de ventas suyas antes de su fecha de
  salida. Después se marca a quién ya se le pagó; reabrirla saca sus gastos de Finanzas.
- **Las cuotas de un closer que se fue.** En su ficha, «Sus cuotas por cobrar» dice cuántas le quedan y
  «Pasar sus cuotas a…» se las da a otro closer: desde ahí lo que se cobre de ellas comisiona para el
  que las heredó, en Finanzas, en el resultado del webinar y en la liquidación. Lo ya cobrado sigue
  siendo de quien cerró la venta, y en la ficha del que las heredó se pueden devolver.
- **Accesos a la app.** Dar y quitar accesos y elegir el tipo de cuenta (al darle acceso a alguien
  del equipo se propone el de su rol: closer, setter, director, marketing). «Dar acceso y generar clave» crea
  el usuario y muestra la clave una sola vez, lista para mandar; lo hace `/api/accesos` con la
  clave de servicio y sólo si quien pide es dueño. La base no deja quedarse sin ningún dueño.
- **Tipos de cuenta.** Una tabla con un tipo por fila y un área por columna (Dashboard, Leads, CRM
  y Agenda, Ventas y Clientes, Webinars, Marketing, Alumnos, Finanzas, Ajustes): en cada una, no
  la ve, la ve o la edita; y «Sólo lo suyo». Se agregan tipos nuevos partiendo de otro. En la app
  local, «Ver como…» muestra el menú y los permisos de cada tipo.

Las reglas del cálculo están en `src/lib/honorarios.ts`. Antes de usarlo contra Supabase hay que
correr `supabase/honorarios.sql` (tablas, políticas, niveles de acceso y la columna `puesto`).


## Lo que salió de la reunión con Yari (18/09)

- **Gastos reales**: los de enero a septiembre de 2026 vienen de la hoja Gastos_vieja de la planilla de Angelo
  (ids `gas_ef_*`). No se cargan closers, director ni comisiones de procesamiento: la app los calcula de los cobros.
- **Dar de baja una venta** (cancelada o reembolsada, desde la ficha): las cuotas que faltaban cobrar quedan escritas
  como canceladas (borrado lógico), dejan de ser por cobrar y mora, y su servicio pasa a baja. Reactivarla las devuelve.
- **Alarmas de cobranza**: desde los 7 días de atraso, contador rojo al lado de Finanzas y aviso en el Dashboard y en
  Finanzas (cuántos pasaron los 15 y los 20 días y quién es el más atrasado).
- **Webinars**: cada venta se ata a su webinar (por el proyecto WEB-, los UTMs o, en el embudo de webinar, por la fecha:
  el último vivo antes de la venta, hasta 14 días); los proyectos WEB- de la planilla se crean como webinars. La pauta,
  los formularios y los DM Ads salen de Meta (campañas «[WEBINAR dd/mm]» y «DM …») si están en cero, con un rayo.
  Los gastos cargados con un webinar entran en su profit. `lib/atar-webinars.ts`, `lib/webinar.ts`.
- **Por embudo** (`lib/embudos.ts`): CAC, ROAS y profit de cada estrategia; la inversión del webinar es la de sus
  webinars, la de los demás sus campañas de Meta y los gastos cargados con ese embudo.
- **Caja** (`lib/caja.ts`, Finanzas → Caja): arqueo por cuenta (con lo que entró según la app al lado, para la
  Financiera y Trust), caja esperada, meses de vida y retiros del dueño (grupo de gasto «retiro»: sale de la caja, no
  del profit). Tabla `arqueos`: `supabase/arqueos.sql`.
- **Un % general y otro por servicio** (`lib/comisiones.ts`, `components/finanzas/CuadroComisiones.tsx`): quien vende,
  agenda o dirige ventas tiene un % general y puede tener uno propio para algunos servicios; en esas ventas vale el
  propio **en vez** del general («es diferente el % por closer y por servicio vendido», Angelo).
  - El cuadro «Cómo comisiona cada uno» (persona × servicio) se **ve** en Finanzas → Detalle → Comisiones y se
    **cambia** tocando la celda en Equipo y honorarios → Comisiones (dueños). La lista venta por venta muestra el
    servicio y el % aplicado.
  - Cada % es un concepto de lo que cobra la persona: la comisión general, y una «Comisión · Servicio» por cada
    servicio distinto (`conComisionGeneral`, `conComisionDeServicio`). Las dos son hermanas (porcentaje, misma base y
    alcance) y un cobro entra en una sola (`cuenta()` en `lib/honorarios.ts`); si dos nombran el mismo servicio, vale
    la primera.
  - Al guardar, `equipo.comisionRate` y `equipo.comisionServicios` (servicio → fracción) se escriben desde el esquema
    (`tasaParaFinanzas`, `tasasPorServicio`); Finanzas, la caja, el resultado de cada webinar y la planilla usan
    `tasaDeComision(persona, servicio)`. La liquidación llega a lo mismo por su lado y lo marca «Ya está en Finanzas».
  - Columna `equipo."comisionServicios"`: `supabase/comisiones-servicio.sql`. Sin la columna la app anda igual y el %
    por servicio queda sólo en el navegador de quien lo cargó.
- **Movimientos entre cuentas** (`lib/traspasos.ts`, `components/finanzas/PasesEntreCuentas.tsx`, Finanzas → Caja): la
  plata que pasa de una cuenta propia a otra (Stripe deposita en Mercury, de Mercury a la Financiera). No es ingreso ni
  gasto: no toca el P&L ni el total de la caja; lo que cuesta el pase (lo que salió menos lo que llegó, en la misma
  moneda) se carga como gasto en «Comisiones bancarias»; entre pesos y dólares no hay costo, hay un tipo de cambio.
  - Se cargan a mano («Movimiento entre cuentas») o los detecta la sincronización: Mercury ve llegar los depósitos de
    Stripe, Hotmart, Whop, dLocal, Mercado Pago y PayPal (antes se descartaban para no contar la plata dos veces) y
    Stripe dice cuándo mandó cada retiro (`/v1/payouts`). Cada dato de ésos es una **punta** (`salidaRef`,
    `llegadaRef`). Lo dudoso (ARX, Bridge, MassPay, Binance, lo que sale de Mercury hacia una cuenta propia) entra
    «por confirmar».
  - Estados: **conciliado** (se vio salir y llegar), **en camino** (salió y todavía no llegó), **salió y no llegó**
    (más de 7 días), **detectado** (lo vio una sola cuenta: la otra no avisa), **a mano**, **por confirmar** y
    descartado. La llegada se ata a la salida por cuentas, monto (2% o un dólar) y fecha (de un día antes a diez
    después); lo cargado a mano conserva sus montos y recibe las puntas.
  - El cron de cada hora (`/api/pasarelas/sync`) los guarda (`guardarPuntas` en `lib/servidor.ts`); «Buscar en las
    cuentas» pide lo mismo en el momento (`?solo=pases&guardar=1`). La pantalla y el servidor usan las mismas reglas
    (`conciliarPuntas`).
  - Con eso el arqueo muestra, por cuenta, el último arqueo, lo que cobró, los pases y lo que **tendría que haber**
    (`saldosEsperados`). No descuenta gastos ni sueldos (la app no sabe de qué cuenta se pagó cada uno): el control
    que tiene que dar es el total. Lo que está en camino no está en ninguna cuenta: el esperado del arqueo lo
    descuenta, y lo que viajaba cuando se contó el arqueo anterior se suma (`cajaEsperada`: `enCamino`,
    `enCaminoAntes`, `enCuentas`).
  - Tabla `traspasos`: `supabase/traspasos.sql` (la ve quien ve Finanzas y la cambia quien edita Finanzas). Sin la
    tabla la app anda igual: los movimientos quedan en el navegador de quien los carga.
- **Comisión de cada cuenta**: al cambiarla, se elige si los cobros que ya la usaban pasan a la nueva.
- **Conciliación**: los cobros de pasarela que ya estaban cargados como pago se atan a ese pago (no suma plata y le pone
  la comisión real) en vez de imputarse a otra cuota. Columna `movimientos.vinculado`: `supabase/movimientos-vinculado.sql`.
- **Dashboard**: cuántos pagan todo de una y las ventas equivalentes (downsells y reservas pasados a programas).
- **La landing del webinar** manda cada registro a `/api/webinar/registro` (pre-lead) y la **Conversions API de Meta**
  recibe Lead, Schedule y Purchase. Guía: `docs/registro-webinar.md`. Tabla `capi_enviados`: `supabase/capi-enviados.sql`.
- **Fecha de salida del equipo** (`equipo.hasta`, `supabase/equipo-hasta.sql`): un director cobra sólo lo que entró hasta
  que se fue, como pidió Yari («si el director de la venta no es el que está ahora, no comisiona»). Noelia Perelo quedó
  como directora de las ventas de abril a junio de 2026, hasta el 30/06.

## Lo que pidió Yari el 29/09

- **Filas del Dashboard, por usuario**: se ocultan desde la fila misma (el ojo que aparece al pasar por encima, con
  «Deshacer») o desde «Métricas», y quedan guardadas en el usuario, no en el navegador: se ven igual en cualquier
  compu. Abajo de la tabla, «N métricas ocultas · Mostrarlas» las muestra atenuadas para devolverlas. Lo que alguien
  ya tenía oculto en su navegador pasa a su usuario la primera vez. Tabla `preferencias`: `supabase/preferencias.sql`.
- **El pitch, a mano y sin YouTube**: en la tarjeta «Agendas de Calendly» de cada webinar se marca a qué hora arrancó
  («Arranca ahora» durante el vivo, o escribiendo la hora después) y se corrige cuando se quiera. Dice en qué minuto
  del vivo fue y cuántas de las agendas del vivo llegaron desde ahí (`lib/pitch.ts`). Con video, la curva de
  espectadores lo marca además con su línea.
- **Los closers que se fueron no cobran más**: desde su fecha de salida (`equipo.hasta`) no comisiona ni el closer ni
  el director, y sus cuotas por cobrar se pasan a otro closer desde su ficha en Equipo (`cuotas.closerId`,
  `supabase/cuotas-closer.sql`; `lib/cuotas-closer.ts`). Finanzas, el resultado de cada webinar y la liquidación usan
  la misma regla (`closerDeCuota` y `cobraEnFecha` en `lib/finanzas.ts`); el cobro de una cuota heredada aparece como
  «cuotas heredadas de …». La ficha de la venta dice en cada cuota quién la comisiona si no es el closer de la venta.
- **Tipos de cuenta** (`lib/permisos.ts`, `supabase/tipos-cuenta.sql`): cada persona con acceso tiene un tipo, y
  cada tipo ve y edita sólo sus áreas, trabado en la base con RLS (lo que no ve le llega vacío, lo que no edita se
  rechaza, también por la API). El closer ve **sólo lo suyo**: las llamadas donde es el anfitrión de Calendly (por su
  nombre en Equipo), sus ventas (de closer, de setter o con cuotas que heredó) con sus cuotas y cobros, y la gente de
  esas llamadas y ventas. El menú, el inicio (el closer arranca en el CRM), el buscador, las secciones del Dashboard y
  las vistas de la ficha siguen al tipo; una pantalla que el tipo ve y no edita avisa que es para mirar; si algo no se
  puede guardar, se avisa y vuelve a como estaba, sin trabar la cola. Las rutas de `/api` que leen con la clave de
  servicio preguntan `nivel_area()` (`lib/permisos-servidor.ts`); las de Meta, que contestaban sin sesión con el token
  del sistema, ahora piden Marketing. El tema claro/oscuro pasó a ser de cada navegador, y Ajustes → Datos (respaldos,
  vaciar) es sólo de los dueños. `pruebas/permisos.ts` compara las reglas de la app con las de la base.
  Las personas, los leads y la actividad llevan `creadoPor` (el correo de la sesión, lo completa la base): cada uno ve
  lo que creó, así el closer puede cargar a alguien nuevo, y la actividad sabe quién hizo cada cosa. «Lo suyo» se
  calcula una vez por consulta (`mis_*()`, `son_mios()`): el closer carga todo en menos de 100 ms.
- **Fathom** (`lib/fathom.ts`, `lib/fathom-servidor.ts`, `supabase/fathom.sql`): cada llamada con su grabación, el
  resumen, los accionables y la transcripción, sin que el closer pegue nada. En Ajustes → Integraciones, «Conectar»
  crea el webhook en Fathom (con `FATHOM_API_KEY`, que vive en Vercel) y guarda su secreto en `fathom_conexion`, que
  sólo lee el servidor; desde ahí cada reunión llega a `/api/fathom/webhook`, se verifica su firma (Standard Webhooks)
  y se ata a su llamada de Calendly por el correo del invitado y la hora (±4 h; con dos, la del closer que grabó). Sólo
  se guardan las de una llamada de Calendly: una reunión personal o interna se descarta sin guardar nada (Yari, 30/09;
  `decidirGrabacion`). «Traer lo anterior» pide a su API las reuniones desde el día antes de la primera llamada de
  Calendly que hay en la app (lo de antes no tiene con qué atarse); las páginas con transcripción son pedidos «pesados»
  para Fathom (30 por minuto, 5 cuando está cargado): si contesta 429, la pantalla espera su `Retry-After` y sigue. Se
  ven en la ficha de la persona, en Llamadas: el link, el resumen, los accionables y la transcripción con buscador. Las
  transcripciones no se cargan al abrir la app: se piden al abrir la ficha, y el closer ve sólo las de sus llamadas (RLS).
- **El ángulo del ad** (`anguloDe` en `lib/crm-tabla.ts`): en Meta los ads se llaman como su video y se duplican
  («MERCADO SATURADO.mp4 - Copia 2»); el ángulo es ese nombre sin copias ni formato. Es columna del CRM y corte en el «Informe».
- **Los números del Dashboard se abren** (02/10; `lib/kpis.ts`: `detalle`, `lib/kpis-detalle.ts`, `DetalleDeKpi`): un clic
  en una celda muestra los registros que la forman, con la misma lista que cuenta el número: las llamadas (agendadas,
  hechas, canceladas, no vinieron), las ventas, los pagos, los gastos, las cuotas vencidas, los alumnos y, para la
  plata en anuncios, los anuncios de Meta de esos días. Cada fila lleva a la ficha, a su pantalla o al detalle del
  anuncio. Lo que es una cuenta (costo por agenda, tasas, CTR, CPC, ticket, CAC, ROAS) no se abre, ni un número en cero.
- **El detalle de un anuncio** (`components/marketing/DetalleAnuncio.tsx`, `api/meta/preview`,
  `lib/meta-creativo.ts`): se abre como una ventana en el medio de la pantalla (`<Drawer emergente>`: la misma capa
  que el panel de costado, así la ficha de una persona se abre arriba), con el anuncio a la izquierda, a la vista, y
  sus números a la derecha; en una pantalla angosta, uno debajo del otro. El anuncio es el video o la imagen mismos,
  directo y con su forma (vertical, cuadrado u horizontal), no la página que arma Meta. El servidor lee el creativo del anuncio y pide cada archivo: el video (`/{video}?fields=source,
  picture,format`) o la imagen (`/act_x/adimages`); si es un carrusel, sus tarjetas, y si tiene distinto material por
  lugar (`asset_feed_spec`), uno por lugar con su etiqueta («Historias y Reels», «Feed»). Debajo va el texto del anuncio
  y «Ver como lo muestra Meta», que abre la vista previa de Meta en su marco (`lib/meta-preview.ts`). Si Meta no entrega
  ningún archivo (un video del que sólo da la portada), se muestra ese marco y se dice por qué. Los links vencen: se
  pide cada vez que se abre y no se guarda. Sólo links de Meta llegan a la página. El mismo detalle se abre desde
  Marketing y desde el Dashboard. Sin nube, se puede probar guardando la respuesta en `localStorage`
  (`apicanta.previa-de-prueba`).

## Lo que pidieron el 02/10 (lote A)

- **Plata con puntos de miles** (`components/ui/InputMonto.tsx`, `lib/monto.ts`): en todos los campos de plata
  (arqueo, movimientos entre cuentas, ventas, cobros, gastos, honorarios, ajustes) los puntos aparecen solos al
  escribir («1.234.567,50»). La coma es el decimal (el punto del teclado numérico también) y se puede pegar un número
  de cualquier lado. Lo que trae `ev.target.value` es el texto con sus puntos; se lee con `leerMonto` (o `montoDe`,
  que da 0 si está vacío). Un input numérico del navegador no los separa y lee «145.000» como 145.
- **Arqueo con «Otros»** (`enOtros` en `lib/caja.ts`): las cuentas que no se usan seguido (Mercado Pago, Galicia,
  Efectivo USD, Binance) quedan plegadas al final. Cada cuenta lo dice en Ajustes → Ventas → Cuentas recaudadoras
  («Otros»); sin decirlo, valen esos nombres. Para que lo que se cambie a mano quede guardado hay que correr
  `supabase/procesadores-otros.sql` (una columna).
- **Profit con el nombre de Yari**: en el Dashboard, «Profit on cash collected» y «Profit on revenue» (antes
  «Profit neto (cobrado)» y «(facturado)»); en el estado de resultados, «Profit neto», con «Rentabilidad neta» debajo.
- **El CRM usa todo el ancho** de la pantalla.
- **Pruebas** (`npm test`): `pruebas/*.test.ts`, con el corredor de node (`pruebas/registrar.mjs` pasa los `.ts` por
  TypeScript y resuelve `@/`). Van en el repo, no en una carpeta temporal.

## Lo que pidió Angelo el 06/10

- **«Cómo se calcula» en cada métrica** (`components/ui/InfoMetrica.tsx`): un ícono (i) junto al nombre. Al pasar el
  mouse dice qué es en una frase; con un clic abre la cuenta escrita, **los números del período que se está mirando**
  y un ejemplo. En el Dashboard sale de `lib/kpis-formulas.ts`: cada fila tiene su fórmula y las piezas de la cuenta
  son **otras filas de la misma tabla** (por id), evaluadas con el mismo `Contexto` que la celda, así que lo del modal
  no puede dar distinto que el número. El resultado de la última línea es el valor de la columna Total. Si agregás una
  métrica a `catalogo()` sin su explicación, `npm test` falla (`pruebas/kpis-formulas.test.ts`). Fuera del Dashboard
  se usa con la prop `info` de `StatCard` y de las columnas de `DataTable`, y en el estado de resultados
  (`ayudaDeRenglon` en `lib/estadoResultados.ts`).
- **Los nombres de Angelo**: «Cash Collected (CC)», «Revenue (facturado)», «ROAS on CC», «ROAS on Revenue»,
  «Profit on Cash Collected (CC)» y «Profit on Revenue» (y «… on CC / on Revenue» en las filas del webinar y del embudo).
- **Cargar el pago de una cuota con filtros** (`lib/buscar-cliente.ts`): chips de closer y de servicio arriba de la
  lista, con cuánta gente deja cada uno; el closer y el servicio se piden sobre la misma cuota («Downsell de Dante»).
  Cada persona dice qué compró y quién lo cerró.
- **Conciliación explicada** (`components/finanzas/ComoFuncionaConciliacion.tsx`): la plata pasa de pendiente a
  conciliada en tres pasos, con un glosario de cada etiqueta, tres tarjetas con lo que hay en cada estado y
  explicaciones al pasar el mouse. «Calce seguro» pasó a «Coincide exacto».
- **Liquidación: «Ver cómo se calculó» y descuentos con nota** (`lib/desglose.ts`, `lib/honorarios.ts`,
  `components/equipo/DesgloseRenglon.tsx` y `HistorialLiquidado.tsx`): cada renglón (fijo, bono, comisión, tramo,
  pieza) abre la regla en castellano y la cuenta paso a paso, con la lista de los cobros que la forman (los diez
  más grandes y «y N más»). El desglose se arma dentro de `linea()` con las mismas variables con las que se calcula
  el monto, así que no puede dar distinto; al cerrar queda guardado en `liquidaciones.resultado` (jsonb) y un mes
  cerrado muestra lo guardado. Los cerrados antes del cambio dicen que se cerraron sin desglose y se pueden ver
  recalculados con los datos de hoy, marcados como tales. La ventana tiene flechas entre meses y una tabla «Mes a
  mes»; la ficha de la persona lista todos sus meses cerrados. «Sumar o descontar un monto» elige en qué liquidación
  va (la que se mira o las que vienen) y lleva una **nota para quien paga**: se ve en el renglón, en un aviso arriba
  de la lista, en «Copiar para mandarle», en el CSV y al cerrar, y se puede sacar desde la ficha. Sin migración: el
  desglose y los extras con nota van dentro de `liquidaciones.resultado` y `liquidaciones.extras`. Las pruebas
  (`pruebas/liquidacion-desglose*.test.ts`) verifican que la cuenta de cada renglón cierra exacto con su monto, en
  casos a mano y en 200 escenarios al azar.
- **Cargar gasto sin repreguntar y con proveedor** (`components/finanzas/AsistenteGasto.tsx`, `CampoProveedor.tsx`,
  `lib/carga-gasto.ts`): al elegir «ya cargaste algo parecido» se va a un único paso **«Revisá y cargá»**, con
  categoría, monto, proveedor y fecha editables en el lugar; en el camino normal, la categoría sugerida se ve como
  una tarjeta («Va en: Equipo / Salarios · gasto operativo») con «Cambiar categoría», y cada bloque dice en qué
  renglón del estado de resultados cae (una prueba compara esos nombres con los de `armarEstadoResultados`).
  **El proveedor es obligatorio** («¿A quién le pagaste?»): se elige de la lista del equipo (nombre completo y puesto
  o rol, los activos primero) y de los proveedores ya usados, o se escribe uno nuevo. Con Equipo / Salarios,
  Honorarios del CEO, Setters, Edición de contenido o Filmmaker el equipo va primero; en el resto, los proveedores.
  `Gasto.proveedor` sigue siendo texto; quién del equipo es se guarda en `gastos.extra.proveedorEquipoId`. Editar un
  gasto abre la misma revisión, y uno viejo que venía sin proveedor (los de la planilla) pide uno para guardarse.

## El Dashboard en gráficos (Angelo, 06/10)

«En la parte que dice sólo tabla hay que crear gráficos de una… pero la tabla esa déjala, no la saques.» En
Dashboard & KPIs, **Tabla | Gráficos** (`?modo=graficos`) cambia cómo se ven las mismas cifras. La tabla queda
igual y sigue siendo lo primero; los gráficos respetan el período, el filtro de embudo o webinar, las columnas por
día o por mes, «Comparar períodos» y las áreas que ve cada tipo de cuenta (Revenue y ventas salen de Ventas; CC,
tasa de cobro y mora, de Cobranza).

- **No hay fórmulas nuevas.** Cada total sale de los mismos métodos que las filas de la tabla (`facturado()`,
  `cobrado()`, `ventasContables()`, `vencidas()`), y los desgloses sólo *reparten* esos totales entre categorías:
  la suma de todas (el «Sin dato» incluido) da exactamente la celda de la tabla, con cada filtro. Lo prueba
  `pruebas/kpis-graficos.test.ts`; la lógica pura está en `src/lib/kpis-graficos.ts`.
- **Qué se dibuja**: Revenue vs Cash Collected por día o mes (líneas o barras; Revenue en amarillo y CC en verde,
  siempre), tasa de cobro en el tiempo, tasa de mora (una foto de hoy: medidor y repartida por dimensión), ticket
  promedio sobre Revenue y sobre CC, desgloses de unidades, Revenue y CC por plan de pago, país, estrategia,
  servicio y proyecto (barras ordenadas; dona si son pocas) y el mapa, con cada país **pintado** (amarillo por Revenue o verde por CC, a elección; más intenso, más monto) y el nombre y el peso de los más pesados. Cada gráfico tiene
  su ⓘ con la cuenta escrita y los números del período.
- **Interactivos y accesibles**: tooltip al pasar el mouse o con el foco, flechas del teclado en los gráficos,
  clic para fijar un punto (y abrir las ventas o los cobros de esa columna), ocultar una serie desde la leyenda,
  elegir una categoría o un país y abrir sus ventas o cobros, en el mismo panel que la tabla. Cada serie tiene su forma (círculo y rombo) y el CC va rayado:
  nada depende sólo del color. Los números van también en una tabla para lectores de pantalla.
- **País**: `src/lib/paises.ts` entiende el texto libre («México», «Mexico», «MX», «EE.UU.», «Rep. Dominicana»…)
  y lo lleva a su código ISO; lo escrito que no se reconoce va a «Sin identificar» (con lo que decía) y lo vacío, a
  «Sin país»: la plata no se pierde. El país de una venta es el de su contacto, si no el de su lead y si no el de su
  alumno.
- **El mapa** (`src/lib/mapa-mundo.ts`) es Natural Earth 110m en SVG propio, sin librerías. Primero tenía burbujas; se cambió por países pintados («que pinte el país, no esos círculos»). Se genera con
  `scripts/generar-mapa-mundo.mjs` desde el paquete `world-atlas` (bajado a una carpeta temporal fuera del repo; no
  es una dependencia de la app).

## Lo que pidieron el 02/10 (lote C: la cuenta del closer)

**Sin SQL**: nada de esto toca la base. La marca de «pasada a mano» va en `sesiones.extra`, y el menú del closer es sólo
del menú (lo que ve ya lo recorta la base, así que no hay RLS que cambiar).

- **El closer, con tres entradas** (`esCuentaDeCloser` en `lib/permisos.ts`, `NAV_CLOSER` en `components/shell/nav.ts`):
  una cuenta de «sólo lo suyo» ve en el menú **Mis llamadas**, **Cerrar el día** y **Cargar venta**, y arranca en la
  primera. Cada una es una pantalla propia (`app/(app)/mis-llamadas`, `cerrar-el-dia`, `cargar-venta`). Leads, Agenda,
  Clientes y lo demás **sólo se esconden del menú y de ⌘K**: siguen abiertos por link, filtrados a lo suyo por la base
  (Yari, 1:07:25: «leads, CRM, agenda, ventas, clientes, todo filtrado por closer»), y la barra de arriba sigue
  diciendo en qué pantalla está. Si un tipo no edita Ventas, «Cargar venta» no aparece solo.
  - **Mis llamadas** es el CRM de hoy (`<CrmTabla misLlamadas />`) y arriba dice «Hoy tenés N llamadas», cuántas ya
    pasaron y faltan cargar y cuántas quedaron de días anteriores, con «Cerrar el día» como la única acción naranja
    (`components/closers/MisLlamadas.tsx`, `resumenDelDia` en `lib/cuenta-closer.ts`). Siempre abre en hoy (no recuerda
    la última vista: `SIN_RECORDAR` en `lib/recordarVistas.ts`) y el número también está en el menú.
  - **Si entra y no ve nada, lo dice** (`avisoDeCuenta`): «tu correo no está en Equipo» o «todavía no hay llamadas a tu
    nombre: en Calendly tenés que figurar como …». Sólo cuando ya cargaron los datos y hay sesión.
  - La celda **Closer** del CRM no se le ofrece al closer: la base le rechaza reasignar (la llamada deja de ser suya).
- **Equipo → Accesos: ¿van a ver sus llamadas?** (`lib/cuenta-closer.ts: evaluarClosers`,
  `components/closers/EstadoDeClosers.tsx`). Un closer ve lo suyo por su **correo en Equipo** y por su **nombre en
  Calendly** (las dos primeras palabras, sin tildes: la misma `miembroDeCloser` del CRM, el cierre del día y la base).
  Closer por closer se ve si tiene correo, acceso y llamadas en Calendly, y la solapa lleva el número de los que **no
  van a ver nada**. Lo que se arregla con un clic: **poner su correo** (hay un acceso de closer con su nombre, o se
  escribe), **darle acceso** (abre «Dar acceso» ya cargado) y **pasarle las llamadas** que Calendly trae con otro
  nombre («V. Abadia» → «Valentin Abadia»; las que vengan se arreglan cambiando el nombre en Calendly, que lo hace
  quien lo maneja). También muestra los accesos de closer cuyo correo no está en Equipo y los anfitriones sueltos.
  Una prueba (`pruebas/cuenta-closer.test.ts`) lo verifica con los closers del ejemplo y con casos armados.
- **Pasar llamadas de un closer a otro** (`lib/pasar-llamadas.ts`, `components/closers/PasarLlamadas.tsx`): «Pasar a
  otro closer» en el detalle de la Agenda y en cada llamada de la ficha, **«Pasar llamadas»** en la Agenda y en la barra del
  CRM para varias (las que se ven con sus filtros; se elige de quién son y cuáles, y de entrada, las que todavía no
  pasaron) y la celda Closer del CRM, que ahora hace lo mismo. Sólo dueños y director (el closer no lo ve: la base se lo rechaza). Cada closer dice si le falta el correo y
  no va a ver lo que se le pase. Queda en la actividad y el aviso trae «Deshacer».
  - **Calendly no lo pisa**: la llamada lleva `extra.pasada` (quién la atiende, qué dice Calendly, quién la pasó y
    cuándo; `lib/pasada-closer.ts`). Cuando el invitado reingresa —una cancelación o un no-show por el webhook, el
    cron, o una **reprogramación** (agenda nueva que hereda la marca de la que reemplaza)— `ingresarInvitado`
    (`lib/calendly-sync.ts`) deja el anfitrión elegido y sólo anota lo que dice Calendly. Pasarla de vuelta a quien
    figura en Calendly saca la marca.
  - **El nuevo la ve y el viejo deja de verla** porque la base decide por el anfitrión de la llamada. Queda escrito con
    el nombre con el que Calendly ya trae a ese closer (el más usado), así «Mariano» y «Mariano Arias» no son dos
    closers en los filtros. Si el responsable del lead era quien la atendía, **la oportunidad se va con la llamada**.
  - **Quién comisiona la venta: el que atendió la llamada.** Una venta que se carga desde la llamada sale con el closer
    de su anfitrión (ya era así), o sea el nuevo; una venta que ya estaba cargada se queda con quien la atendió, y el
    diálogo lo avisa antes de pasar.
- **Descargar el anuncio** (`app/api/meta/descargar`, `lib/meta-descarga.ts`, `components/marketing/DescargarMedio.tsx`):
  cada video o imagen del detalle del anuncio lleva su botón **Descargar** (o «Descargar portada», si Meta sólo dio la
  portada del video). Los links de Meta son de otro origen y vencen, así que el archivo pasa por el servidor: le
  pide a Meta el anuncio de nuevo, baja el archivo de sus servidores (sólo de ellos, también al seguir redirecciones) y
  se lo pasa al navegador sin cargarlo entero en memoria; lo ve quien ve Marketing, Webinars o Finanzas. Si Meta no lo
  entrega (link vencido, token sin permiso, archivo enorme) sale un mensaje que dice qué pasó y qué hacer, no un archivo
  roto. **Sin un anuncio real no se pudo confirmar con Meta**: está probado con un Meta de mentira
  (`pruebas/meta-descarga*.test.ts`).

## Fathom: que lleguen las llamadas de los closers (F2-04, reunión del 02/10)

Yari ve sus llamadas y faltan las de los closers. Hay tres causas probables: **(a)** Fathom no se une a algunas
reuniones de Zoom («tipo de reunión no soportado»: no hay grabación que traer; lo arregla Manu), **(b)** visibilidad
(las llamadas de cada closer no están compartidas con el equipo de ventas, o la cuenta dueña de la clave no ve lo
compartido) y **(c)** que la app no pidiera las «Team Calls» del equipo de ventas. La regla de Yari sigue igual: sólo se
guardan las grabaciones atadas a una llamada de Calendly.

- **«Traer lo anterior» pide también las llamadas de equipo** (`lib/fathom-equipos.ts`, `api/fathom` acción
  `importar`): primero pasa por todo lo que la clave ve (como antes) y después, una vez por cada equipo de ventas de
  Fathom, por `GET /meetings?teams[]=<equipo>` (las Team Calls). Los equipos salen de `GET /teams`: los que se llaman
  «Sales», «Ventas», «Closers» o «Comercial»; si se llaman distinto, `FATHOM_EQUIPOS` en Vercel (opcional, separados por
  coma) manda. Si Fathom no deja leer los equipos (un plan sin equipos) sigue sin ellos. El cursor que va y viene con la
  pantalla es opaco y recuerda en qué equipo va; la pantalla cuenta por grabación (lo de un equipo repite lo que ya trajo
  la pasada general) y dice cuántas son **nuevas**.
- **El cierre del día («Buscar en Fathom») ya no se corta a las 4 páginas** (ahora 30) y, si por el mail del closer no
  encuentra nada (grabó con otra cuenta de Fathom), mira entre las llamadas de los equipos de ventas y se queda con las
  que grabó alguien que se llama como él (`grabadaPor`).
- **«Diagnosticar»** (Ajustes → Fathom, sólo dueños; `api/fathom` acción `diagnosticar`, `diagnosticarFathom` en
  `lib/fathom-servidor.ts`, lógica pura en `lib/fathom-diagnostico.ts`, pantalla `components/ajustes/FathomDiagnostico.tsx`):
  corre en el servidor con la clave que ya está en Vercel y muestra, sin exponerla ni mostrar títulos ni contenido de
  ninguna reunión: cuántas reuniones devuelve la API sin filtrar y por cada equipo de ventas (y cuántas aparecen **sólo**
  al pedir por equipo), de qué equipos y quién grabó cada una, el tipo de reunión que informa Fathom (con gente de afuera
  o sólo del equipo; la API no dice si es Zoom o Meet), cuántas están atadas a una agenda de Calendly (nuevas o ya
  guardadas) y cuántas no (sin agenda con invitados de afuera, o personales/internas), cuántas llamadas de Calendly tiene
  cada closer y cuántas con grabación, por plataforma (Zoom, Meet… según el enlace de Calendly) y si el closer figura en
  el equipo de Fathom. Con eso arma un **veredicto en castellano**: (a) si las llamadas de Zoom no tienen grabación y las
  de otras plataformas sí; (b) si los closers tienen llamadas y la clave no ve ninguna reunión suya; (c) si aparecen
  grabaciones de closers sólo al pedir por equipo; y una cuarta, **(d) llegan pero no se atan** (el invitado entró con otro
  mail), que se arregla atando a mano en el cierre del día. También avisa si el webhook quedó sin alcance de equipo
  (`paraElEquipo` en falso: Desconectar y Conectar), si falta el mail de un closer en Equipo o si la clave no es aceptada.
  Mira desde el día antes de la primera llamada de Calendly, hasta 45 días atrás; sólo lee, no guarda nada.
- **Variables de entorno:** `FATHOM_API_KEY` (ya está), `FATHOM_EQUIPOS` (opcional, para el nombre del equipo de ventas
  si no se llama Sales/Ventas/Closers). **SQL:** ninguno. Pruebas: `pruebas/fathom-diagnostico.test.ts` (respuestas simuladas
  de la API de Fathom: cada veredicto, las cuentas, las pasadas por equipo).
- **Lo que no está hecho:** guardar «sin atar» las llamadas del equipo de ventas que no se pudieron atar (la checklist lo
  proponía; se mantuvo la regla de descartarlas hasta que lo decidan, y el diagnóstico cuenta cuántas serían). Y no se
  tocó la configuración de Fathom con Zoom (es de Manu).

## Customer Success: seguimiento de alumnos y testimonios (lote G, reunión del 02/10)

Manu pidió llevar en la app lo que Customer Success tiene en planillas y en Airtable: «no sería una ficha por alumno
sino una lista general, un checklist: cuáles faltan contactar, cuáles no contestaron, a quién hablar hoy». Vive
dentro de **Alumnos**, en tres solapas nuevas (`?seccion=hoy|seguimiento|testimonios`) y con dos accesos directos en
el menú («A contactar hoy», con la cuenta de hoy, y «Seguimiento»). Reportes y Pipeline de servicio **no se tocan**
(D12): son del área Alumnos y siguen en el menú hasta hablarlo con Manu y Lili.

- **A contactar hoy**: los alumnos activos a los que ya les toca el contacto, lo más vencido arriba (a igual atraso,
  primero el que lleva más intentos sin respuesta). Dos gestos de un clic: **Lo contacté** (el último contacto pasa a
  hoy y el próximo toca a su cadencia) y **No contestó** (cuenta un intento y se vuelve a probar a los 3 días). Cada
  gesto avisa y ofrece **Deshacer**. Con 3 intentos seguidos sin respuesta aparece «Dejó de contestar» (se sugiere,
  no se marca solo).
- **Seguimiento**: la lista general con país, años de experiencia y tecnologías (salen del contacto: del formulario de
  Calendly), cadencia **cada 7, 15 o 20 días** elegible por alumno, último y próximo contacto, «dejó de contestar»,
  **CV corregido** y **LinkedIn corregido** (sí/no, con un switch) y el estado del testimonio. Filtros por situación
  (vencidos, hoy, al día, dejaron de contestar), CV, LinkedIn, cadencia, país, testimonio y búsqueda; todo viaja en
  el link con «Copiar link» (`?sit=&cv=&li=&cad=&pais=&tes=&sq=&orden-seg=&pag-seg=`, `lib/useParamsURL.ts`).
- **Testimonios**: modelo nuevo por alumno (puede tener más de uno): estado **pedido / grabado / publicado**, link y
  fecha. Se carga desde la solapa o con «Pedir» en la fila del seguimiento.
- **La cuenta** (`src/lib/seguimiento.ts`, pura y con pruebas en `pruebas/seguimiento.test.ts`): el próximo contacto
  es *último contacto (o el día de ingreso, si nunca se lo contactó) + cadencia*; hoy o antes es «a contactar»; los
  pausados, egresados, dados de baja y los que «dejaron de contestar» no entran en la lista de hoy. Los días son del
  día del negocio (Argentina), sin hora. Todo número lleva su ⓘ «cómo se calcula».
- **Configurable** (Lili todavía no contó cómo lo lleva hoy): las cadencias que se pueden elegir, la de arranque
  (15), los días de reintento (3) y los intentos hasta sugerir «dejó de contestar» (3) se ajustan en Alumnos →
  Seguimiento → **Ajustar** (lo ven quienes editan Ajustes) y viven en `ajustes.seguimiento`. Cuando conteste, se
  corrigen ahí o en `CONFIG_POR_DEFECTO`.
- **Datos**: `seguimiento_alumnos` (una fila por alumno, id `seg_<alumnoId>`; en tabla aparte para que un cambio de
  etapa del pipeline, que guarda la fila entera del alumno, no la pise) y `testimonios`. Cada gesto queda anotado en
  la actividad del alumno con quién lo hizo.
- **Tipo de cuenta «Customer Success»** (F2-06): ve **Alumnos** (edita) y **Clientes** (sólo mira), y nada más; entra
  directo a «A contactar hoy». Se crea con un clic en Equipo → Tipos de cuenta → «Crear “Customer Success”» (o lo
  siembra el SQL). **Clientes pasó a ser un permiso propio** (`AREAS`, `/clientes` → área `clientes`), pero
  `nivelDeAreas()` hace que quien ya ve o edita Ventas siga viendo Clientes igual: ningún tipo existente cambia. El
  de Manu (D13) es «Todo menos honorarios», que ya existe.
- **SQL a correr**: `supabase/customer-success.sql` (idempotente; requiere `tipos-cuenta.sql`). Crea las dos
  tablas con sus políticas, `ajustes.seguimiento`, ajusta `areas_que_leen()` y `areas_que_editan()` **sobre su
  definición vigente** (no las pisa con una copia, así se puede correr antes o después de lo de otros lotes) y
  siembra el tipo. Sin correrlo la app anda igual, y el seguimiento queda en el navegador de quien lo carga.
  `pruebas/permisos-clientes.test.ts` comprueba que la app (`LEEN`/`EDITAN`) y la base digan lo mismo.
- **Falta** (cuando llegue lo de Manu y Lili): importar lo que hoy tienen en Airtable (Booking calls, Results y
  Testimonios), sumar las columnas que pidan que no estén acá, y decidir con Lili si usan Reportes y el Pipeline de
  servicio (D12).

## Lote E de la reunión del 02/10: pasarelas y gastos fijos

Tres pedidos de la reunión (F1-06, F1-05 y F1-11). SQL a correr **antes o después** de publicar (la app anda igual
sin él): `supabase/gastos-recurrentes.sql`. Hotmart y Mercury no necesitan SQL.

**Hotmart: la comisión del retiro se carga a mano** (`src/lib/traspasos.ts`, `components/finanzas/PasesEntreCuentas.tsx`).
Hotmart cobra por mandar la plata a Mercury (en el banco entran 1.000 cuando en Hotmart había 1.025). Cada llegada de
Hotmart que detectó la sincronización queda en la Caja → «Movimientos entre cuentas» con el estado **«Falta la
comisión»**, con filtro, contador y un aviso arriba de la lista (y un número rojo en «Caja» del menú), hasta que alguien
aprieta **«Cargar la comisión»**, mira en Hotmart cuánto salió y lo escribe: la diferencia con lo que llegó queda
como gasto «Comisión de retiro Hotmart» (categoría «Comisiones bancarias»). Si no cobró nada, se dice igual (salió =
llegó) y no se vuelve a pedir. **Nada la carga solo ni la atribuye al faltante del arqueo** (decisión D9). El pase
cargado resta de Hotmart lo que salió y suma a Mercury lo que llegó, así que el total baja exactamente la comisión
(`pruebas/hotmart-retiro.test.ts`). Cargar «salió» marca la salida como confirmada a mano (`salidaRef: "a-mano"`),
sin columna nueva. Stripe y Whop (no cobran el envío): si salió ≠ llegó, el pase queda en **«Salió ≠ llegó»** hasta
corregir el monto o cargar la diferencia como gasto. Las cuentas que cobran / no cobran son `COBRAN_RETIRO` y
`SIN_COSTO_DE_ENVIO` en `traspasos.ts`. *Sin hacer:* investigar si la API de Hotmart da los retiros o el detalle de
cargos (no se pudo probar sin las claves), las ventas en pesos mexicanos (hoy todo lo que no es ARS se toma como USD)
y el costo por factura de Stripe; espera lo que elabore Angelo.

**Mercury: reglas de lo interno, pendientes y fechas** (`src/lib/mercury.ts`, usado por `pasarelas-api.ts`).
Cada movimiento del banco es una sola cosa: *anulado* (failed, cancelled, reversed, blocked), *interno* (pago de la
tarjeta de crédito, subcuentas, Treasury, entre cuentas del mismo Mercury: ni ingreso ni gasto ni pase), *pase*
(Stripe, Hotmart… del otro lado), *en proceso* (pending), *cobro* o *gasto* (no se trae: F4-05). Un **pending no
cuenta** hasta asentarse y entra con la fecha de asentado (`postedAt`); si ya había entrado cuando estaba pending y sigue
sin conciliar, **pasa a la fecha de asentado** (`parcheDeCobro`, aunque cambie de mes); uno **anulado** que ya estaba
en la bandeja sin conciliar se **descarta solo** con una nota (nunca se borra ni se toca uno conciliado). Las
cuentas de tarjeta de crédito se saltean enteras. La lista de reglas es de Angelo: lo que falte se suma con la variable
de entorno `MERCURY_REGLAS_INTERNAS` (textos separados por coma que, si aparecen en la contraparte o la descripción,
hacen que sea interno), sin tocar el código. «Sincronizar» (Conciliación) avisa cuántos pending siguen esperando y
cuántos cobros anulados se descartaron. Las pruebas están en `pruebas/mercury-reglas.test.ts`. *Supuestos sin
confirmar con datos reales:* los nombres de `kind` de la tarjeta (se busca «credit card» en el tipo y en el texto) y el
texto de «Mercury Credit autopay»; si un movimiento interno se cuela, se agrega a `MERCURY_REGLAS_INTERNAS`.

**Gastos fijos con aprobación** (`src/lib/gastos-recurrentes.ts`, `components/finanzas/GastosFijos.tsx`, pestaña
**Finanzas → detalle → «Gastos fijos»**, `?seccion=fijos`). «Fathom pagamos más o menos lo mismo: ¿este mes fue 140?»
Cada gasto fijo es una **plantilla** (qué es, categoría, a quién, monto habitual, día del mes 1 a 28 y de qué cuenta
sale; tabla `gastos_recurrentes`). Desde el día en que se paga, el mes aparece **«por aprobar»** con el monto del mes
anterior (el último gasto con ese concepto, o lo habitual si no hay): **Aprobar** (carga el gasto como «Fijo», con id
fijo por plantilla y mes, así que no se duplica), **corregir el monto** en el mismo casillero y aprobar (ese monto pasa a
ser el del mes que viene) o **Este mes no** (saltea ese mes, con «Deshacer»). **Nada se carga sin aprobación.** Si
alguien ya cargó a mano el gasto de ese mes (mismo concepto), no se vuelve a proponer; lo que quedó sin aprobar se sigue
mostrando hasta dos meses atrás. «Armar con los que ya cargué» crea una plantilla por cada gasto «Fijo» de los últimos
seis meses. El menú suma los gastos fijos por aprobar al número rojo de «Finanzas» (los que ya les tocaba pagar).
Pruebas: `pruebas/gastos-recurrentes.test.ts` (propuesta con el mes anterior, aprobar suma exactamente ese monto, saltear,
no duplicar con lo manual, armar desde los gastos). *Falta:* cargar las plantillas con la lista de software del Excel de
Angelo (se arman con «Armar con los que ya cargué» apenas estén los gastos), y decir a qué mes corresponde cuando
entre el gasto con dos fechas (lote B): las plantillas guardan `recurrenteMes` en el `extra` del gasto.

## El informe del webinar y Meta «registro calificado» (reunión del 02/10, lote F, F3-05 y F3-07)

### Informe del webinar: un Excel de tres hojas (F3-05)

Agus arma a mano, una o dos semanas después de cada webinar, el cruce de agendas, anuncios y ventas. Yari: «generale
un Excel con tres hojas… en lugar de descargar tres Excel, uno solo». Ahora hay un botón **«Descargar resumen»** en la
ficha de cada webinar (arriba, junto al estado) y un ícono de descarga en la fila de la **planilla** (aparece al pasar
por encima). Baja `Resumen webinar dd-mm-aaaa Título.xlsx` con:

1. **Personas.** Arriba, el resumen del webinar con **cómo se calcula cada número** (plata, embudo y rendimiento por
   vía de agenda: los mismos de la ficha, `metricasDeWebinar` y `rendimientoPorVia`). Abajo, una fila por persona
   atada al webinar: registro (landing o formulario de Meta, con fecha), anuncio y campaña, lo que contestó (puede
   invertir, inglés, formación), si califica, si agendó, closer, estado de la llamada, si compró, facturado y cobrado.
2. **Agendas.** Una fila por agenda del lanzamiento (el webinar, su clase cero y su Q&A): vía y link, vivo o después,
   closer, estados, objeción, ¿oferta?, venta (con facturado y cobrado), anuncio, ángulo, campaña, UTMs y notas.
3. **Anuncios.** Por nombre de anuncio: lo que gastó Meta en las campañas «[WEBINAR dd/mm]» del webinar (gasto,
   impresiones, clicks, leads, costo por lead) cruzado con lo nuestro (registros, agendas, calificadas, ventas,
   facturado, cobrado, costo por agenda y por venta, ROAS on CC y las objeciones más frecuentes). El nombre de Meta
   («ANGULO UNO.mp4») y el de la UTM («angulo-uno») se unen por su versión normalizada. Lo que no vino de un anuncio
   va a «(Sin anuncio identificado)».

- **Estructura fácil de ajustar** (Agus todavía no pasó el ejemplo de su informe): cada hoja es una lista de columnas
  (`COLUMNAS_PERSONAS`, `COLUMNAS_AGENDAS`, `COLUMNAS_ANUNCIOS` en `src/lib/informe-webinar.ts`: título, ancho,
  formato y de dónde sale el valor). Agregar o sacar una columna es tocar una línea; el dibujo (`src/lib/xlsxTabla.ts`)
  no cambia. Los bloques del resumen están en `informeDelWebinar`.
- **Qué se tocó de lo existente**: `src/lib/webinar.ts` expone la regla de las campañas del webinar
  (`repartirInsights`, `insightsDelWebinar`) y la planilla sigue sacando de ahí sus números (mismo resultado, probado).
  El acceso a los registros de la landing y de Meta está en una sola función (`registroDe`): si pasan a una tabla
  propia (F3-01), sólo cambia ésa.
- Archivos: `src/lib/informe-webinar.ts`, `src/lib/xlsxTabla.ts`, `src/components/webinars/BotonInforme.tsx`,
  `pruebas/informe-webinar.test.ts`. No hay SQL ni variables nuevas.

### Meta: el evento «registro calificado» (F3-07)

Cuando alguien se registra desde la landing (`/api/webinar/registro`), a Meta le llegan desde el servidor **dos eventos**
en el mismo pedido: **Lead** (se registró) y **RegistroCalificado** (se registró y califica), con IP, user agent,
cookies `_fbp`/`_fbc`, UTMs, país y el resultado de cada criterio. Califica con las mismas tres reglas que la agenda
calificada (`lib/calificacion.ts`): puede invertir 1000 USD o más, inglés conversacional o mejor y carrera, leídas de
las respuestas del registro (se reconocen por el texto de la pregunta o por el nombre del campo: `inversion`,
`nivel_ingles`, `formacion`…). **Sin las tres respuestas no califica y el evento no sale** (sin dato no alcanza).
Lo que escribió en crudo **no** viaja a Meta: «cuánto puede invertir» es dato financiero; se manda el «sí / no» de
cada criterio.

- **Datos hasheados como pide Meta** (`src/lib/capi-datos.ts`): mail, teléfono, nombre, apellido, país y el id propio
  salen con SHA-256 de lo **normalizado** (mail en minúsculas; teléfono sólo dígitos con código de país, agregándolo
  según el país si vino nacional; nombre y apellido en minúsculas sin tildes; país ISO en minúsculas). IP, user agent
  y cookies, sin hashear.
- **Sin duplicar**: cada evento lleva un `event_id` estable (`reg_…` el Lead —o el id del píxel de la landing si lo
  manda en `event_id`— y `rcal_…` el calificado, ambos derivados del mail y el webinar). Además queda constancia en
  `capi_enviados` y no se manda dos veces (`enviarEventosUnaVez`), aunque pasen más de las 48 horas en que Meta junta
  repetidos. Sin esa tabla manda igual y confía en el `event_id`. En modo prueba (`META_CAPI_TEST`) no deja constancia.
- **Sin las variables no rompe nada**: no manda y ya. **Ajustes → Integraciones → «Conversions API de Meta»** dice si
  está lista, **qué falta cargar en Vercel y para qué**, si está en modo prueba, desde qué dominios se aceptan los
  registros y cuántos eventos se mandaron de cada tipo. Nunca muestra una clave (`/api/meta/capi`, sólo lee si
  están). La lógica de «qué falta» es `src/lib/capi-estado.ts`.
- Archivos: `src/lib/capi-datos.ts`, `capi-registro.ts`, `capi-estado.ts`, `meta-capi.ts`,
  `src/app/api/meta/capi/route.ts`, `src/components/ajustes/ConversionsApi.tsx`, `pruebas/capi-meta.test.ts`. En
  `app/api/webinar/registro` sólo cambió el bloque que arma y manda los eventos (una llamada).
- **SQL a correr**: ninguno nuevo. Usa `supabase/capi-enviados.sql`, que ya existe: si en producción no se corrió,
  correrlo (Ajustes avisa «falta correr…»).
- **Variables de entorno (Vercel → Production)**: `META_PIXEL_ID` y `META_CAPI_TOKEN` (obligatorias; el token se
  genera en Events Manager → el píxel → Configuración → Generar token de acceso; sin él se usa `META_SYSTEM_TOKEN`,
  que puede no tener el permiso); `REGISTRO_ORIGENES` (recomendada: los dominios de la landing, separados por coma);
  opcionales: `META_CAPI_TEST` (código de «Probar eventos»; sacarlo al terminar), `META_CAPI_URL` (la página de la
  landing, para los eventos que no pasaron en una página, como las agendas) y `META_CAPI_EVENTO_CALIFICADO` (el nombre
  del evento en Meta; por defecto `RegistroCalificado`).
- **Para optimizar en Meta** hay que crear la conversión personalizada sobre el evento `RegistroCalificado` y
  avisarle a Agus. El píxel de la landing, para no contar doble el Lead, tiene que disparar `Lead` con el mismo
  `event_id` que manda el formulario (y no `CompleteRegistration`, que es otro nombre y no se junta con el del servidor).

## Los registros de la landing: tabla propia, Formularios y cruce con la agenda (lote F, primera parte)

De la reunión del 02/10 (F3-01, F3-02, F3-03 y F3-06) y la decisión D15: los formularios del webinar dejan de vivir en
el Google Sheet (una hoja por webinar) y dentro de `contactos.extra`, y pasan a **una tabla propia**.

- **SQL a correr una vez: `supabase/registros-webinar.sql`** (idempotente). Crea `registros_webinar` (una fila por
  persona y por webinar: fecha del webinar, mail, teléfono y teléfono normalizado, país, UTMs, id del anuncio,
  respuestas, `fbp`/`fbc`/IP/user agent para Meta, las tres marcas del equipo y el cruce con la agenda), sus
  políticas (la ve quien ve Webinars, la cambia quien edita Webinars, nunca el closer que sólo ve lo suyo) y la vista
  `registros_webinar_resumen` (una fila por webinar) que arma el selector. **Hasta que se corra, todo sigue andando
  como antes**: la landing guarda el pre-lead en `contactos` y la pantalla avisa que falta crear la tabla.
- **F3-01 · La landing** (`api/webinar/registro/route.ts`): sigue haciendo exactamente lo de antes (pre-lead en
  `contactos`, «Formularios» del webinar, evento Lead a Meta, misma respuesta) y además guarda la fila en
  `registros_webinar`: **fecha del webinar** (la del webinar al que quedó atado), UTMs y **el anuncio** (el id de
  Meta de `utm_content`, o el anuncio de ese nombre). Si se anota dos veces al mismo webinar, es la misma fila: se
  completan los huecos y no se pisan las marcas del equipo. Si la tabla falla o no existe, no tumba el registro. Se
  agregó `registroId` a la respuesta. El id de una fila (`idRegistro`, `lib/registros-webinar.ts`) es un hash del mail
  y la fecha del webinar, igual en el servidor y en el navegador: lo que entra por la landing y lo que entra por el
  Excel se reconocen entre sí.
- **F3-03 · Pantalla Formularios** (`/formularios`, grupo Crecimiento; `components/formularios/VistaFormularios.tsx`):
  la hoja del Excel con las tres marcas, **Unido / No unido / Contactado** (un clic, con quién y cuándo, y se
  desmarcan con otro clic; el campo se pinta verde o ámbar con el dato adentro), el teléfono con **copiar** y **abrir
  WhatsApp** (`lib/telefonos.ts`: el 9 de los celulares argentinos, sin 0 ni 15), filtros por webinar y por estado,
  búsqueda (también en las respuestas) y columnas configurables. **Todo va en el link** (`?webinar`, `?marca`, `?q`,
  `?orden`, `?pag`, `?seccion`, columnas). Cuatro tarjetas con su ⓘ («Cómo se calcula»): registrados, unidos, no
  unidos y sin revisar. Al abrir una fila se ve todo (respuestas, UTMs, anuncio, origen del dato) y se deja una nota.
  A diferencia del resto de las tablas, **ésta no se baja entera al abrir la app**: se pide de a un webinar
  (`lib/registros-nube.ts`), porque con la base histórica pueden ser decenas de miles de filas. Sin la nube (la demo)
  vive en el navegador.
- **F3-02 · Importar del Excel** (botón «Importar del Excel», `ImportarFormularios.tsx`): se sube el .xlsx entero de
  Google Sheets (o una hoja en .csv). Cada hoja es un webinar: la **fecha sale del nombre de la hoja** (acepta
  «Webinar 23/09», «23-09-2026», «14 de octubre», «20261014») y se puede corregir; el **mapeo de columnas** se
  adivina por los encabezados (fecha, nombre, mail, país, código, teléfono, UTMs, id del anuncio, unido, no unido,
  contactado…) y se edita a mano; lo que no se mapea va a las respuestas. **Resumen antes de confirmar**, por hoja:
  filas del Excel, nuevos, ya estaban, sin mail, repetidos y cuántos quedan en la app. No duplica (mail + fecha),
  completa huecos sin pisar las marcas del equipo, no borra nada y **no manda nada a Meta**. Las tres marcas que ya
  vengan en el Excel se traen. Reimportar el mismo archivo da «nuevos: 0».
- **F3-06 · Cruce formulario ↔ agenda** (pestaña «Cruce con la agenda»; `lib/cruce-formularios.ts`, `lib/telefonos.ts`):
  cascada **mail → teléfono → nombre**. Firmes: mismo mail; mismo teléfono (con o sin +54, 9, 0 y 15, en cualquier
  formato); o los últimos 8 dígitos del teléfono más el mismo nombre. Dudosas: sólo los últimos 8 dígitos (sin código
  de área puede ser de otra zona) o sólo el nombre (dos o más palabras en común). Las firmes se unen con un clic
  («Unir las N»); las dudosas se muestran lado a lado con **Unir** y **No es** (lo descartado no se vuelve a
  proponer). Al unir, el registro queda atado a la persona de la agenda (`contactoId`, `cruce`) y ésta **toma lo que
  le faltaba** del formulario: teléfono, país, anuncio, webinar y los UTMs de la pauta (si los de la agenda no son de
  pauta quedan guardados en `contactos.extra.utmAgenda`), así sus ventas se atribuyen al anuncio. Acción nueva del
  store: `acciones.heredarDeFormulario`.
- **Pruebas**: `pruebas/telefonos.test.ts`, `pruebas/registros-webinar.test.ts` y `pruebas/cruce-formularios.test.ts`
  (ocho formas del mismo celular, fechas de las hojas, mapeo de columnas, resumen de la importación y que reimportar
  no duplica, filtros, y la cascada del cruce con homónimos y descartes).
- **Todavía no está** (ver el informe del lote): la base de ~25.000 contactos de los grupos de WhatsApp (el importador
  de «sólo contactos» y la decisión de dónde viven), fusionar dos contactos con mails distintos, cruzar al ingresar
  desde Calendly y Meta, unificar el conteo de «Formularios», y el respaldo descargable antes de importar.

## Lo que pidieron el 02/10 (lote C: el cierre del día)

- **Strikes e interruptor del descuento** (F2-02; `lib/cierre-del-dia.ts`, Ajustes → CRM → «Cierre del día»). Una llamada
  de venta pide cierre si ya empezó y no se canceló; sin estado cargado tampoco si Calendly la dejó como que no vino ni si
  pidió otra fecha («Reagendar»). **Un strike es un día en que alguna llamada de un closer se cargó otro día que el suyo o
  sigue sin cargar** (hora de Argentina). Se cuentan desde la fecha de arranque que se elige en Ajustes (la del CRM para los
  closers: sin fecha todavía no cuentan) y se le muestran al closer en «Tu día», con el ícono de «cómo se calcula» y los días,
  **aunque el interruptor esté apagado**.
  - El interruptor arranca **apagado**. Apagado no cambia ningún número en ningún lado: `pruebas/cierre-del-dia.test.ts` compara
    Finanzas, la liquidación y el resultado del webinar con y sin la configuración. Prendido, **no se comisiona lo de un día
    cuyo cierre no se cargó el mismo día**: la comisión de closer de las ventas que salieron de las llamadas de ese día no se paga.
    La del director, el setter y el referidor no se toca, ni lo que cobra quien heredó las cuotas de ese closer. Rige para las
    llamadas desde el día en que se prendió (se puede cambiar): lo que ya se liquidó no se mueve. Antes de prenderlo, Ajustes dice
    cuánto habría cambiado este mes.
  - Los tres lugares que repiten la comisión por cobro leen la misma regla (`ventasSinCierre` y `descuentaPorCierre`, como
    `cobraEnFecha` en `lib/finanzas.ts`): `comisionesDelMes` (Finanzas, el Dashboard y la caja; cada fila trae `descuentoCierre` y
    Finanzas → Comisiones lo marca), `metricasDeWebinar` y la liquidación. En la liquidación la comisión del closer sale **entera**
    y un renglón aparte, **«Descuento por cierre del día»** (negativo, `tipo: "descuento"`), resta lo que no se paga, con su
    «Ver cómo se calculó»: la cuenta, los cobros de esos días y qué días fueron. La suma da lo mismo que Finanzas (200 escenarios
    al azar lo comprueban) y, como la comisión de un closer, ya está en Finanzas: al cerrar no se carga de nuevo. No lleva
    renglón la comisión corregida a mano ni la medida a mano.
  - Sólo entran las ventas que **saben de qué llamada salieron** (`ventas.sesionId`): las de antes no se pueden probar y no entran.
  - Si la llamada no tiene estado pero sí su venta (la cargó Administración, que no edita las llamadas), cuenta desde cuándo se
    cargó la venta.
- **La venta atada a su llamada** (`ventas."sesionId"`): al registrar una venta se guarda de qué llamada salió: la que dice el cierre
  del día o la tabla del CRM o, si no, la última de esa persona dentro de la ventana de siempre (-1/+60 días), una sola vez. La fila
  del CRM ata la venta a su llamada por ese id; sin él (las de antes) sigue la ventana, que puede dar falsos «sin venta».
- **La primera vez que se cargó cada estado** (`sesiones."estadoLlamadaEn"` y `"estadoPreCallEn"`): `store.editarLlamadas` la escribe
  al pasar el estado de vacío a cargado, venga de donde venga (el cierre del día, la tabla, la Agenda, la ficha o una venta).
  No se corre ni se borra: cambiar el estado, vaciarlo o borrar la opción no la tocan; sólo la saca deshacer la primera carga. Un
  trigger de la base hace lo mismo y la completa con la hora del servidor si una pestaña con la app vieja no la manda. Los estados
  cargados antes de esto no tienen marca: no se pueden juzgar y cuentan como a tiempo.
- **La puerta** (`lib/eod.ts`, `Eod.tsx`): si el estado es de compra, no se pasa a la siguiente llamada ni se termina el día sin la
  venta cargada. La única salida es **«La carga otra persona»**, que queda anotada (`sesiones."ventaPorOtro"`: quién lo avisó y
  cuándo) y se ve en la columna Venta del CRM (también se puede filtrar). En la pantalla final, las compras sin venta se listan con
  «Cargar la venta» y la salida. La ficha, que carga una sola llamada, no la pide. «Idealmente también conciliada» no se hizo:
  es del control cruzado.
- **Menos estados de llamada** (F2-05; `lib/estados.ts`, Ajustes → CRM → «Estados de llamada»): cada lista (Estado de Llamada,
  Estado Pre-Call y Pre-Call) con lo que mueve cada estado (la Agenda, la etapa del lead, lo que pregunta el cierre del día), cuántas
  llamadas lo tienen y un interruptor «a la vista / oculto». Todos arrancan a la vista: Santi marca cuáles usa y el resto se oculta.
  Un estado oculto no se ofrece al cargar (`ofrecidas`), pero no se borra: las llamadas que ya lo tienen lo siguen mostrando con
  su color y lo que pone la app sola sigue andando. Ocultar pide confirmar con lo que cambia (`revisarOcultar`) y no deja ocultar lo
  último que el cierre del día necesita: el último estado de compra, el último de seguimiento y «Reagendar». El editor de nombres,
  colores y orden de la grilla se abre desde ahí. Lo escriben quienes editan Ajustes: el Director comercial no, así que Santi
  marca y lo oculta un dueño (o se le da el área Ajustes).
- **Antes de usarlo contra Supabase** hay que correr `supabase/cierre-del-dia.sql` (idempotente: `ventas."sesionId"`, las dos marcas
  y `ventaPorOtro` en `sesiones`, y el trigger de la marca). El interruptor, la fecha de arranque y los estados ocultos viven en
  `ajustes.crm` (jsonb), sin SQL. Sin las columnas la app anda igual y sólo no guarda ese dato.
- **Pruebas**: `cierre-del-dia.test.ts` (la regla, apagado = igual, prendido = los tres lugares dicen lo mismo, 200 escenarios al
  azar), `primera-carga.test.ts` (con el store: marcas y `sesionId`), `estados-ocultos.test.ts` y `puerta-eod.test.ts`.

## Lo que pidieron el 02/10 (lote D: control cruzado y cobranza)

- **Control cruzado de los cobros** (`lib/control-cobros.ts`, `components/cobros/ControlCobro.tsx`): el closer carga el
  cobro y otra persona confirma que el comprobante coincide con lo cargado. Hay **dos casilleros separados**, el del director
  comercial y el de finanzas; con uno alcanza para que el cobro no quede pendiente. Cada casillero guarda quién lo hizo (el
  correo de su sesión), cuándo y, si rechazó el comprobante, el motivo. Un cobro está *Sin chequear*, *Chequeado* o *Rechazado*
  (un rechazo manda hasta que se arregla: otro comprobante, o quien rechazó lo da por bueno). Lo que ya estaba marcado con el sí/no
  de antes (`pagos.chequeado`: la planilla de Angelo y los cobros conciliados con la pasarela) sigue chequeado —«de antes», sin quién
  ni cuándo—; un cobro que no lo estaba queda pendiente, sin tocar sus números. Chequear o rechazar **no cambia ningún número**
  (una prueba compara el Cash Collected antes y después). El tilde del closer al cargar ya no cuenta.
  - **No es un tilde en la fila:** un clic en la pastilla del estado abre una ventana con el comprobante a un lado y, al otro, lo que
    cargó el closer (cliente, mail, monto, medio, cuota y **todos los cobros de esa cuota**, por si pagó en partes). «Chequeado» se
    confirma de nuevo y «Rechazar» pide el motivo. Quien chequea queda anotado como responsable, también en la Actividad con su
    nombre de Equipo. Si el cobro lo cargó la misma persona que lo chequea, la ventana lo avisa (no lo frena).
  - **Dónde se chequea:** el director comercial no ve Finanzas, así que chequea desde **Ventas → Cobros** (solapa nueva, con los filtros,
    el período y la búsqueda de Ventas): cada cobro con su Comprobante, si está Conciliado, quién lo Cargó y el Chequeo, y los botones
    *Sin chequear / Rechazados / Chequeados / Sin comprobante / Sin conciliar* (quien controla arranca en «Sin chequear»). También desde la
    ficha de la venta, y la lista de Ventas suma la columna «Control de cobros». Finanzas → Detalle → Procesadores tiene las mismas
    columnas. El casillero lo da el tipo de cuenta: el de finanzas lo llena quien edita Finanzas; el del director, quien edita Ventas
    sin ser «sólo lo suyo». El closer no llena ninguno, pero ve el estado y puede subir otro comprobante.
  - **Comprobante después de cargar el cobro:** desde la misma ventana se sube o se cambia (el closer arregla uno rechazado). Cambiar un
    archivo que ya estaba vuelve los chequeos a pendiente —se miraron contra el anterior, que queda guardado—; agregar el primero no.
    «Conciliado» es que el cobro está atado al pago de la pasarela; una cuenta sin pasarela (la Financiera, efectivo) dice «A mano».
  - **SQL:** `supabase/control-cruzado.sql` agrega 9 columnas a `pagos` (`cargadoPor`, `chequeoDirector/Por/En/Nota` y
    `chequeoFinanzas/Por/En/Nota`) y un trigger: el RLS no distingue columnas y el closer puede editar sus cobros, así que el trigger
    deja los casilleros sólo a quien corresponde, sella quién y cuándo con la sesión (nadie chequea a nombre de otro), reinicia el
    control si se reemplaza el comprobante y no deja que el tilde de quien carga cuente. Se ensaya en un Postgres de verdad, con las
    políticas reales de `tipos-cuenta.sql` y como closer, director, administración, dueño y servidor
    (`pruebas/sql/control-cruzado.ensayo.mjs`, a mano: necesita PGlite). Sin el SQL la app anda igual: los chequeos quedan sólo en el
    navegador de quien los hace.
    Al final tiene, comentada, una línea para dar por chequeados «de antes» los cobros viejos si no se quiere arrancar con toda la
    historia pendiente. Los chequeos salen como un UPDATE de sus columnas y las columnas del control **nunca viajan** en el upsert del
    cobro entero (`sinColumnasDelControl`): una copia vieja de la pantalla no pisa lo que otro acaba de chequear.
- **Excel de los cobros** (`lib/excelCobros.ts`): «Descargar Excel» en Ventas → Cobros, Finanzas → Procesadores y en los ingresos de la
  semana baja los cobros que se ven, con los filtros puestos: fecha, nombre de quien transfiere, CUIT, monto (USD y ARS), comprobante
  (link firmado por 30 días), conciliado, quién chequeó y cuándo, quién cargó; y los totales al pie. El «Reporte para la Financiera»
  (`lib/reporteFinanciera.ts`) sigue con su formato, sin la columna Banco (salía del CBU, que ya no se pide) y con «Pago Verificado»
  tomado del control. La planilla exportada también.
- **Ingresos de la semana** (`lib/ingresos-semanales.ts`, `components/finanzas/IngresosSemanales.tsx`, abajo en Finanzas): el Cash
  Collected del rango partido en **cuenta × servicio**, por fecha de cobro, con el rango semanal elegible (flechas que mueven de a su largo
  y calendario; de lunes a domingo por defecto; `?sdesde&shasta`). Los totales de las filas, de las columnas y el general cierran al
  centavo con el Cash Collected del mismo rango (se suma en centavos enteros; hay una prueba con los datos de ejemplo, semana por semana).
  Cada número abre los cobros que lo forman, con su estado de chequeo.
- **Clientes y Cobros, por producto y por closer** (`lib/buscar-cliente.ts`, `lib/clientes.ts`, `lib/mora-filtros.ts`): Clientes suma el
  filtro por closer y sus tarjetas de arriba —«Les falta pagar» incluida— siguen el producto, el closer y la búsqueda: son la deuda de
  *esas cuotas* (la de Mentoría, lo que le falta cobrar a Mariano), no la de todo lo que compró cada cliente; los botones de estado recortan
  sólo la tabla. Finanzas → Cobros filtra las cuotas vencidas por servicio y por closer, y el aviso de arriba, los días de atraso y la
  fila de totales siguen lo que se ve. Todos usan la misma regla que «Cargar el pago de una cuota»: closer y servicio sobre la **misma**
  cuota (`cuotaPasa`, `opcionesSobre`), y el closer es quien comisiona la cuota (el que la heredó, si hubo). Van en el link (`?closer`,
  `?producto`, `?servicio`). Una prueba verifica que las partes suman el todo, con los datos de ejemplo.
- **Filas de totales**: Ventas (valor total y cobrado), Clientes, Finanzas → Cobros y → Procesadores. La del CRM no está.
- **Pruebas**: `pruebas/control-cobros.test.ts`, `store-control.test.ts`, `excel-cobros.test.ts`, `ingresos-semanales.test.ts` y
  `filtros-cobranza.test.ts`.

## Devoluciones de punta a punta y mes cerrado (lote B de la reunión del 02/10: F1-01 y F1-16)

«Si me meto al CRM y pongo devolución, ¿se refleja en finanzas?» Hoy sí. SQL a correr **antes o después** de publicar
(la app anda igual sin ellos y lo avisa): `supabase/devoluciones.sql` (tabla `devoluciones` + sus políticas + un freno
en `ventas`; **toca permisos: hacerle un ensayo de RLS con ROLLBACK antes de correrlo**, hace falta haber corrido
`tipos-cuenta.sql`) y `supabase/gastos-devengo.sql` (una columna, `gastos.fechaPago`). Las dos son idempotentes.

**Qué hace una devolución** (`src/lib/devoluciones.ts`, la misma cuenta para todos los lugares). Es una transacción
aparte: la venta sigue contando en su mes y lo cobrado en el mes en que entró; la devolución **resta en el mes en que se
devuelve la plata** (Cash Collected, estado de resultados, Dashboard, webinars, embudos y la caja de la cuenta de la que
salió). La comisión de la pasarela no vuelve (Stripe se la queda). Al closer y al director se les **revierte exactamente lo
que se les comisionó** por lo cobrado de esa venta (no el % sobre lo devuelto, que daría un poco más), en la parte que se
devolvió, como una línea negativa del mes de la devolución. Con «no descontar al closer» (D7: uno solo por devolución,
por defecto se descuenta) no se revierte nada. Si el cierre del día le dejó sin comisión esa venta, tampoco se le revierte
lo que no se le pagó. El setter no se revierte.

**Quién y cómo** (D6): la cargan Finanzas (asistente) o el director comercial, con **comprobante obligatorio** (salvo que
la pasarela la informe); el closer sólo ve las de sus ventas y no ve «Marcar reembolsada» ni «Cancelar venta» (también
lo frena la base). Se carga desde la **ficha de la venta** («Cargar una devolución») o cuando una llamada pasa a
**«Devolución»** en el CRM, el cierre del día, la Agenda o la ficha (se abre el formulario con esa persona; al cargarla,
la llamada queda en «Devolución» si no lo estaba): una cosa dispara la otra y no depende del cierre del día. El formulario
(`components/devoluciones/CargarDevolucion.tsx`) no deja devolver más de lo cobrado sin devolver y muestra antes de guardar
lo que resta en Finanzas y lo que se les revierte a cada uno, con su «cómo se calcula». **Finanzas → detalle →
Devoluciones** (`?seccion=devoluciones`) lista las del período, la comisión revertida, las **llamadas en «Devolución» sin
cargar** (Finanzas no las ve hasta que alguien las carga) y los reembolsos de las pasarelas por confirmar.

**Liquidación** (`src/lib/honorarios.ts`, `desglose.ts`, `components/equipo/Liquidacion.tsx`): la línea roja «Devolución de …»
y, si el mes queda en negativo, la **deuda que pasa al mes siguiente** («Deuda de …», se descuenta ahí) son renglones del
motor con su «Ver cómo se calculó»; la cuenta cierra al centavo con Finanzas (`pruebas/devoluciones-liquidacion.test.ts`,
`liquidacion-desglose*.test.ts`). **Mes cerrado** (D5): se avisa y no se bloquea; una liquidación cerrada **nunca se
reescribe**: una devolución con fecha de un mes cerrado resta en Finanzas ese mes, pero lo que se le descuenta a la persona
entra en la primera liquidación abierta.

**Reembolsos de las pasarelas** (`src/lib/reembolsos.ts`): Stripe (`/v1/refunds`), Hotmart (REFUNDED y CHARGEBACK) y Whop
informan la plata devuelta. Antes se descartaba ("sin monto positivo"); ahora, o se **ata a la devolución cargada** (una sola
que calza: misma venta o persona, mismo monto, en esos días, por una cuenta de esa pasarela) o entra como **propuesta**
que **no cuenta** hasta confirmarla, atarla o decir «no es una devolución». Con dudas no ata nada. Entra por «Sincronizar»,
por el CSV (los renglones devueltos o en negativo) y por el webhook (`refund.created`, `charge.refunded`, `PURCHASE_REFUNDED`:
**un aviso de reembolso nunca entra como cobro**); el cron los guarda con las mismas reglas. La tarjeta está en
Conciliación y en Finanzas → Devoluciones. *Sin confirmar con una clave real:* la forma de Hotmart (no dice cuándo se
devolvió: se usa la fecha de la compra y se marca) y la de Whop (`status=refunded`, `refunded_amount`, `refunded_at`).

**Gasto con dos fechas** (F1-16, `src/lib/gastos.ts`, `carga-gasto.ts`, `components/finanzas/CampoFechasGasto.tsx`).
Un gasto de septiembre que se paga el 2 de octubre resta en el estado de resultados de **septiembre** y sale de la caja de
**octubre**. `fecha` es el mes al que corresponde (estado de resultados, como siempre); `fechaPago`, el día que se pagó (caja,
arqueo y lo que tendría que haber en cada cuenta). Sin `fechaPago` es la misma fecha: **los gastos ya cargados no cambian
ninguna cuenta**. En el asistente hay una sola fecha; «Es de otro mes o se pagó otro día» abre «Mes al que corresponde» y
«Día que se pagó». Sin `gastos-devengo.sql` el gasto se guarda con una sola fecha. El **aviso de mes cerrado**
(`lib/mes-cerrado.ts`, `components/ui/AvisoMesCerrado.tsx`) sale al cargar o corregir un gasto, una devolución o la fecha de un
cobro en un mes con la liquidación cerrada; en el gasto ofrece pasarlo al mes abierto sin mover la plata.

*Pruebas:* `devoluciones*.test.ts` (incluida la de punta a punta de Yari: venta del 28/09, septiembre cerrado, devolución del
03/10), `devoluciones-cierre-dia.test.ts`, `reembolsos.test.ts`, `gasto-devengo.test.ts`. *Falta:* ensayar `devoluciones.sql`
con RLS real, la forma de los reembolsos de Hotmart y Whop con claves, y un mensaje al director cuando una llamada queda en
«Devolución» y nadie la carga.

## CRM: columnas «Comprobante» y «Conciliado» (F1-03 y F1-04)

La tabla del CRM (`/crm`, `src/components/crm-tabla`) suma, al final y a la vista, lo que dicen los **cobros de la venta de cada
llamada** (la venta que sale de esa llamada, `FilaTabla.cobros`, `lib/crm-tabla.ts`). La cuenta es la misma de Ventas → Cobros
(`cobrosPorVenta`, `lib/control-cobros.ts`, con `pasaControl` y `conciliacionDe`): lo que se ve en una pantalla es lo que se ve
en la otra.

- **Comprobante:** «Sí» (o «Todos · n») si cada cobro tiene su prueba (un archivo, el link de la planilla, o el pago de la
  pasarela); «Falta» (o «Falta k de n») si a alguno le falta; «Sin cobros» si la venta todavía no tiene ninguno.
- **Conciliado:** «Sí» si el cobro está atado al pago de la pasarela; «Sin conciliar» si la cuenta tiene pasarela y todavía no
  se ató; «A mano» si la cuenta no tiene pasarela (la Financiera, efectivo). Con varios cobros dice cuántos.
- Sin venta (o sin los cobros en el estado) la celda es «—». Un clic en la pastilla abre la ficha en la venta, donde está cada
  cobro con su comprobante y su chequeo.
- Se filtran y se ordenan como las demás desde el título, con un solo valor por venta (el peor caso, igual que la celda); en el
  orden de las opciones quedan arriba las que hay que mirar (falta el comprobante, sin conciliar).
- La venta de una llamada es la primera que sigue en pie: una reembolsada no tapa a una activa (`ventaDeAgenda`, `lib/crm.ts`).
  Si de la misma llamada salieron dos ventas (la mentoría y un upsell, las dos con su `sesionId`), las columnas suman los cobros de
  las dos: a una no se le tapa lo que falta con lo que tiene la otra.
- Las ve quien puede leer los cobros (`puedeLeer(acceso, "pagos")`: el closer sobre lo suyo, el director, finanzas, los
  dueños); un setter no las tiene en la lista de columnas. Quien ya tenía elegidas sus columnas las suma con «Columnas».

**Más columnas y el Excel (se suman desde «Columnas»; no vienen de entrada):**

- **Producto** (de la venta de la llamada), **Cobrado (CC)** (lo que entró de esa venta menos lo devuelto; se ordena por monto y se
  filtra por «con cobros»), **Cargó** (quién cargó los cobros, con el nombre del equipo; «Sin dato» para los de la planilla y las
  pasarelas) y **Chequeo** (el control cruzado de los cobros de la venta: «Rechazado», «Sin chequear» o «Chequeado», el peor caso
  primero). Cobrado, Cargó y Chequeo, como Comprobante y Conciliado, sólo las ve quien puede leer los cobros.
- Con «Cobrado» a la vista la tabla suma al pie lo cobrado de las ventas de las llamadas que se ven, y **una venta que sale de dos
  llamadas se cuenta una vez** (`totalCobrado`).
- **«Excel de cobros»** (en la barra, para quien lee los cobros): baja, con el Excel de siempre de Ventas → Cobros
  (`lib/excelCobros.ts`), los cobros de las ventas de las llamadas que se ven, con comprobante, conciliación y chequeo
  (`pagosDeLlamadas`, `lib/crm-tabla.ts`).

*Pruebas:* `pruebas/crm-cobros.test.ts`.
