# Conectar YouTube Analytics

Con esto, la ficha de cada webinar muestra también para los **vivos pasados**:
los espectadores minuto a minuto, la retención de la grabación, de dónde llegó
la gente, países, edades y dispositivos.

La dirección de la app es **`https://apicanta-erp.vercel.app`**.

> **Antes de empezar:** las partes 1 a 3 se pueden hacer ya. La parte 4
> (conectar el canal) funciona recién cuando esté publicado el código nuevo
> y corrido `supabase/webinars-vivo.sql` en la base del ERP.

---

## Parte 1 · Activar la API en Google Cloud (5 min)

1. Entrá a **https://console.cloud.google.com** con tu cuenta de Google.
2. Arriba a la izquierda, al lado del logo, está el selector de proyecto.
   Elegí **el mismo proyecto donde creaste la clave de YouTube**
   (`YOUTUBE_API_KEY`). Si no sabés cuál es, andá a
   **APIs y servicios → Credenciales** en cada proyecto hasta ver la clave.
3. En el buscador de arriba escribí **YouTube Analytics API**, entrá y tocá
   **Habilitar**.
4. Fijate que **YouTube Data API v3** también diga "Habilitada" (debería,
   porque la clave ya funciona).

## Parte 2 · Pantalla de permisos y credenciales (10 min)

5. En el menú de la izquierda andá a
   **APIs y servicios → Pantalla de consentimiento de OAuth** (en algunas
   cuentas aparece como **Google Auth Platform**). Si te pide empezar, tocá
   **Comenzar**.
6. Completá:
   - **Nombre de la app:** `Apicanta ERP`
   - **Correo de asistencia:** tu mail
   - **Público:** **Externo**
   - **Datos de contacto:** tu mail
   - Aceptá y tocá **Crear**.
7. Andá a **Público** y tocá **Publicar app → Confirmar**, para que quede
   "En producción".
   - **Es importante.** Si queda "En prueba", Google corta el permiso cada
     7 días y hay que volver a conectar el canal.
   - Google va a decir que la app "no está verificada". Está bien: es una
     herramienta interna y no hace falta verificarla.
8. Andá a **Clientes → Crear cliente**:
   - **Tipo de aplicación:** Aplicación web
   - **Nombre:** `Apicanta ERP`
   - **URIs de redireccionamiento autorizados → Agregar URI:** pegá
     exactamente esto, sin espacios ni barra al final:

     ```
     https://apicanta-erp.vercel.app/api/youtube/callback
     ```

   - Tocá **Crear**.
9. Aparece una ventana con el **ID de cliente** y el **Secreto del cliente**.
   **Copiá los dos ahora** (o tocá "Descargar JSON"): el secreto a veces no
   se vuelve a mostrar.

## Parte 3 · Cargar las credenciales en Vercel (3 min)

10. Entrá a
    **https://vercel.com/apicanta/apicanta-erp/settings/environment-variables**.
11. Agregá dos variables, igual que la de YouTube:

    | Key                    | Value                                                  |
    |------------------------|--------------------------------------------------------|
    | `GOOGLE_CLIENT_ID`     | el ID de cliente (termina en `.apps.googleusercontent.com`) |
    | `GOOGLE_CLIENT_SECRET` | el secreto del cliente (empieza con `GOCSPX-`)         |

    En las dos, marcá **Production** y guardá.
12. Hacé un **Redeploy** del último deploy de producción: Vercel no le pasa
    las variables nuevas al deploy que ya está corriendo.

## Parte 4 · Conectar el canal (2 min, una sola vez)

La hace **alguien que sea dueño o administrador del canal de YouTube de
Hackear IT**, con esa cuenta de Google.

13. En el ERP, abrí cualquier webinar que tenga link de YouTube.
14. Bajá hasta **"El vivo, minuto a minuto"** → pestaña **Retención** →
    **Conectar el canal**.
15. Google pide elegir una cuenta: elegí la que maneja el canal. Si el canal
    es una "cuenta de marca", te pide elegir el canal: elegí **Hackear IT**.
16. Va a aparecer "Google no verificó esta app". Tocá
    **Configuración avanzada → Ir a Apicanta ERP (no seguro)**. Es seguro:
    es la app de ustedes, con permiso de solo lectura.
17. Marcá los dos permisos (ver estadísticas y ver la cuenta de YouTube) y
    tocá **Continuar**.
18. Volvés al ERP con el mensaje **"YouTube Analytics quedó conectado"**.
    Listo: sirve para todos los webinars, también los pasados.

---

## Si algo sale mal

| Qué ves | Qué hacer |
|---|---|
| `Error 400: redirect_uri_mismatch` | La dirección del paso 8 no es exacta. Tiene que ser `https://apicanta-erp.vercel.app/api/youtube/callback`, sin barra al final. |
| `Error 403: access_denied` | La app quedó "En prueba". Hacé el paso 7 (Publicar app). |
| "Google no dio el permiso permanente" | Entrá a **myaccount.google.com/permissions**, quitale el acceso a "Apicanta ERP" y volvé a conectar. |
| "Esa cuenta de Google no tiene un canal" | Entraste con otra cuenta. Repetí el paso 15 con la que maneja el canal. |
| "Ese video no es del canal conectado" | El webinar tiene un link de otro canal, o se conectó otra cuenta. |
| "Falta configurar GOOGLE_CLIENT_ID…" | Faltan las variables de la parte 3, o falta el redeploy del paso 12. |
| Conectado pero sin números | YouTube Analytics tarda **2 o 3 días** después del vivo en tener los datos. Volvé a mirar en unos días. |
