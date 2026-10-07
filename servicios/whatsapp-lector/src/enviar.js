import { dormir, esperaCreciente } from './espera.js';

/* ==================================================================
   Lo que se le manda a la app, por HTTP.

   Un cliente chico: manda el JSON con el secreto en «Authorization:
   Bearer …», con tiempo máximo, y reintenta (con espera creciente) lo que
   puede ser pasajero: la app que no contesta, un 5xx, un 429. Un 4xx (un
   token equivocado, un cuerpo mal armado) no se reintenta: no va a mejorar.

   Nunca tira un error y nunca escribe el cuerpo en un registro: lleva
   teléfonos. Contesta { ok, status, respuesta | error, reintentable }.
   ================================================================== */

export function crearCliente({
  appUrl, token, log, fetch: fetchImpl = globalThis.fetch, timeoutMs = 20_000, intentos = 3, esperar = dormir, azar = Math.random,
}) {
  async function intentar(ruta, cuerpo) {
    const control = new AbortController();
    const reloj = setTimeout(() => control.abort(), timeoutMs);
    try {
      const res = await fetchImpl(`${appUrl}${ruta}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'user-agent': 'apicanta-whatsapp-lector/1' },
        body: JSON.stringify(cuerpo),
        signal: control.signal,
      });
      const texto = await res.text().catch(() => '');
      let json = null;
      try { json = JSON.parse(texto); } catch { /* la respuesta no era JSON */ }
      if (res.ok) return { ok: true, status: res.status, respuesta: json };
      const error = typeof json?.error === 'string' ? json.error : `La app contestó ${res.status}.`;
      return { ok: false, status: res.status, error, reintentable: res.status >= 500 || res.status === 429 || res.status === 408 };
    } catch (e) {
      return {
        ok: false, status: 0, reintentable: true,
        error: e?.name === 'AbortError' ? 'La app no contestó a tiempo.' : 'No se pudo conectar con la app.',
      };
    } finally {
      clearTimeout(reloj);
    }
  }

  async function enviar(ruta, cuerpo) {
    let r = null;
    for (let i = 1; i <= intentos; i++) {
      r = await intentar(ruta, cuerpo);
      if (r.ok || !r.reintentable) break;
      if (i < intentos) await esperar(esperaCreciente(i, { baseMs: 1000, topeMs: 15_000, azar }));
    }
    if (!r.ok) {
      if (r.status === 401) log?.error(`La app rechazó el token (401): WHATSAPP_LECTOR_TOKEN no es el mismo que en la app. ${r.error}`);
      else log?.warn(`No se pudo avisar a la app (${r.status || 'sin conexión'}): ${r.error}`);
    } else if (r.respuesta?.aviso) {
      log?.warn(`La app avisa: ${r.respuesta.aviso}`);
    }
    return r;
  }

  return {
    /** POST /api/whatsapp/grupos: la foto de un grupo o un aviso de entró / salió. */
    enviarGrupo: (cuerpo) => enviar('/api/whatsapp/grupos', cuerpo),
    /** POST /api/whatsapp/latido */
    enviarLatido: (cuerpo) => enviar('/api/whatsapp/latido', cuerpo),
  };
}
