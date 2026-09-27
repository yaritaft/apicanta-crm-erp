# La landing del webinar y la Conversions API de Meta

## 1. Que el formulario de la landing entre a la app

Cada registro de la landing se manda a:

```
POST https://apicanta-erp.vercel.app/api/webinar/registro
```

Queda como **pre-lead** (se registró, todavía no agendó) atado a su webinar, con sus UTMs y lo que haya
contestado. Cuando después agenda en Calendly es la misma persona (el mismo mail). «Formularios» del
webinar se cuenta solo, y si la Conversions API está configurada, a Meta le llega el evento **Lead**.

### Qué campos lee

| Campo | Para qué |
|---|---|
| `email` | Obligatorio. Es la persona. |
| `nombre` (o `name`) | |
| `telefono` (o `whatsapp`, `phone`) | Con código de país, para el WhatsApp y para Meta. |
| `pais` | |
| `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term` | De qué anuncio vino. Copialos de la URL de la landing. |
| `webinar` | Opcional: la fecha del vivo (`2026-10-07`) o su id. Sin esto, va al próximo webinar. |
| `fbclid`, `_fbp`, `_fbc` | Opcionales: las cookies de Meta, para que la atribución no dependa del navegador. |
| `event_id` | Opcional: el mismo id que manda el píxel de la landing, así Meta no cuenta el Lead dos veces. |
| `sitio` | El campo trampa para bots: tiene que ir **vacío** y oculto. |
| `redirect` | Opcional, con un `<form>` común: a dónde mandar a la persona después (la página de gracias). |

Cualquier otro campo (años programando, nivel de inglés…) se guarda como respuesta.

### Con un `<form>` común

```html
<form action="https://apicanta-erp.vercel.app/api/webinar/registro" method="POST">
  <input name="nombre" required>
  <input name="email" type="email" required>
  <input name="telefono">
  <input name="sitio" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true">
  <input type="hidden" name="redirect" value="https://tu-landing.com/gracias">
  <button>Quiero anotarme</button>
</form>
<script>
  /* Los UTMs y el fbclid de la URL, al formulario. */
  const q = new URLSearchParams(location.search), f = document.currentScript.previousElementSibling;
  for (const k of ["utm_source","utm_medium","utm_campaign","utm_content","utm_term","fbclid"]) {
    if (q.get(k)) f.insertAdjacentHTML("beforeend", `<input type="hidden" name="${k}" value="${q.get(k)}">`);
  }
</script>
```

### Con `fetch` (si el formulario ya manda a otro lado)

```js
fetch("https://apicanta-erp.vercel.app/api/webinar/registro", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ nombre, email, telefono, ...utmsDeLaUrl, _fbp: cookie("_fbp"), _fbc: cookie("_fbc") }),
});
```

Para aceptar sólo los registros de tus dominios, poné en Vercel `REGISTRO_ORIGENES=https://tu-landing.com`.

## 2. La Conversions API de Meta

Con esto Meta recibe, desde el servidor, a quien se registró (Lead), a quien agendó una llamada
(Schedule) y a quien compró (Purchase, con el valor). La pauta se optimiza hacia la gente que compra.

1. Events Manager → el píxel de la landing → **Configuración** → *Conversions API* → **Generar token de acceso**.
2. En Vercel (proyecto `apicanta-erp` → Settings → Environment Variables), para Production:
   - `META_PIXEL_ID` = el id del píxel
   - `META_CAPI_TOKEN` = el token del paso 1
   - (opcional) `META_CAPI_TEST` = el código de *Probar eventos*, para verlos llegar sin que cuenten. Sacalo después.
3. Volver a publicar.

El Lead sale al instante en cada registro. Las agendas y las ventas las manda el cron
`/api/cron/meta-capi` cada media hora (las de las últimas 48 horas, una sola vez cada una: quedan en
la tabla `capi_enviados`).
