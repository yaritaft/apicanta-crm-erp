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
| **Ventas** | Un asistente paso a paso arma la venta, su plan de cuotas y los cobros que ya entraron |
| **Conciliación** | Los cobros de Stripe, PayPal, Hotmart, Whop y Mercado Pago, imputados a la cuota que les corresponde |
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
   entiende las columnas de Stripe, PayPal, Hotmart, Whop y Mercado Pago aunque cada una
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
