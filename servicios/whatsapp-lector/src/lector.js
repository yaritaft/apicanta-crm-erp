import { cuerpoAviso, cuerpoFoto, cuerpoLatido, eventoDeAccion } from './cuerpos.js';
import { esperaCreciente } from './espera.js';
import { elegirGrupos } from './grupos.js';
import { aprenderLids, lidsSinResolver, normalizarParticipantes } from './participantes.js';
import { moverSesionVieja } from './sesion.js';
import { soloLectura } from './solo-lectura.js';

/* ==================================================================
   El lector: se conecta a WhatsApp como un dispositivo vinculado y MIRA
   los grupos. No manda mensajes, no marca nada como leído, no cambia su
   presencia (ver solo-lectura.js).

   Qué hace:
   - Al conectarse trae los grupos, se queda con los que coinciden con
     GRUPOS_REGEX y manda una «foto» de cada uno (la lista completa).
   - Escucha quién entra y quién sale y lo avisa (en lotes de unos segundos,
     para que 200 personas entrando juntas no sean 200 pedidos).
   - Cada tanto (FOTO_CADA_HORAS) vuelve a mandar la foto de cada grupo: si se
     perdió un aviso, queda corregido.
   - Manda un latido cada dos minutos y cada vez que cambia algo, con cómo
     está con WhatsApp: conectado, esperando_qr, reconectando o cerrado.
   - Si hay que vincular el número, NO muestra el QR en la terminal: lo
     convierte en una imagen y lo manda a la app en el latido, apenas WhatsApp
     da uno nuevo (cada ~20 segundos). Se escanea desde Ajustes → WhatsApp.
   - Si se cae la conexión, reintenta con espera creciente. Si WhatsApp cierra
     la sesión (se desvinculó el dispositivo), aparta `auth` en `auth.vieja` y
     empieza una vinculación nueva: queda esperando el escaneo, sin que nadie
     tenga que entrar al servidor.

   Baileys, el generador del QR, los temporizadores y la hora se pasan de afuera:
   así se prueba todo con un WhatsApp de mentira (test/lector.test.js).
   Nunca se escribe en un registro un teléfono ni el código QR.
   ================================================================== */

const LOTE_DE_AVISOS_MS = 2000;
const PAUSA_ENTRE_GRUPOS_MS = 400;
const MAX_LIDS_POR_FOTO = 5000;
/* El código que dio WhatsApp sólo sirve unos segundos: pasado esto no se vuelve a mandar. */
const QR_VIGENTE_MS = 45_000;
/* Si la sesión se cierra otra vez apenas empezada la vinculación nueva, no se vuelve a apartar. */
const ENTRE_ROTACIONES_MS = 60_000;

const mensaje = (e) => String(e?.message ?? e ?? 'error').replace(/\d{7,}/g, '…').slice(0, 200);

/**
 * @param {object} p
 * @param {object} p.qr        { imagen(texto) → Promise<data URL>, terminal? { generate } }: cómo se dibuja el código
 * @param {Function} p.moverSesion  (carpeta) → Promise: aparta la sesión cerrada
 */
export function crearLector({
  config, baileys, qr, log, cliente, loggerBaileys,
  ahora = () => new Date(),
  temporizadores = { setTimeout, clearTimeout, setInterval, clearInterval },
  pausar = (ms) => new Promise((listo) => setTimeout(listo, ms)),
  azar = Math.random,
  moverSesion = moverSesionVieja,
}) {
  const t = temporizadores;
  const hacerSocket = baileys.default?.default ?? baileys.default ?? baileys.makeWASocket;
  const motivos = baileys.DisconnectReason ?? {};

  const estado = {
    /* conectado | esperando_qr | reconectando | cerrado */
    conexion: 'reconectando',
    detenido: false, intento: 0, generacion: 0, gruposSeguidos: 0, recordatorios: 0,
    /** El último código QR: { imagen, desde }. */
    qr: null,
    ultimaRotacion: 0,
  };
  const conectado = () => estado.conexion === 'conectado';
  const grupos = new Map();      // id → { id, nombre }: los que interesan
  const ignorados = new Set();   // ids que ya se vio que no interesan
  const sucios = new Set();      // ids cuya foto no se pudo mandar
  const mapaLid = new Map();     // LID → teléfono
  const avisos = new Map();      // `${grupo}|${evento}` → { grupo, evento, telefonos, cuando }
  let sock = null;
  let relojLatido = null;
  let relojFotos = null;
  let relojReconexion = null;
  let relojAvisos = null;

  /* ---------- Latido ---------- */

  const qrVigente = () => (estado.qr && ahora().getTime() - estado.qr.desde < QR_VIGENTE_MS ? estado.qr.imagen : undefined);

  /* Los latidos salen de a uno y en orden, y cada uno arma su cuerpo recién cuando le toca: siempre dice
     cómo está ahora y, esperando, con el último código. El que lleva código no se reintenta: el próximo
     lo reemplaza. */
  let colaDeLatidos = Promise.resolve();
  function latido() {
    const p = colaDeLatidos.then(() => {
      const cuerpo = cuerpoLatido(
        { estado: estado.conexion, grupos: estado.gruposSeguidos, qr: estado.conexion === 'esperando_qr' ? qrVigente() : undefined },
        { ahora: ahora() },
      );
      return cliente.enviarLatido(cuerpo, cuerpo.qr ? { sinReintentos: true } : undefined);
    });
    colaDeLatidos = p.catch(() => {});
    return p;
  }

  /** Cambia cómo está con WhatsApp; si cambió, la app se entera enseguida (sin esperar al latido de los 2 minutos). */
  function cambiarConexion(nueva) {
    if (estado.conexion === nueva) return;
    estado.conexion = nueva;
    if (nueva !== 'esperando_qr') estado.qr = null;
    void latido();
  }

  async function alLatir() {
    const r = await latido();
    if (estado.conexion === 'cerrado' && estado.recordatorios++ % 10 === 0) {
      log.warn('La sesión de WhatsApp sigue cerrada y no pude empezar otra sola: hay que revisar el servidor (ver el README).');
    }
    /* Las fotos que no se pudieron mandar, otra vez, grupo por grupo y con la lista de ahora
       (nunca una vieja: pisaría lo más nuevo). Sólo si la app contestó: si está caída, no tiene
       sentido pedirle a WhatsApp lo mismo cada dos minutos. */
    if (r.ok && conectado()) {
      for (const id of [...sucios]) {
        if (!conectado()) break;
        await conocerGrupo(id);
        await pausar(PAUSA_ENTRE_GRUPOS_MS);
      }
    }
  }

  /* ---------- Fotos ---------- */

  /** Los teléfonos detrás de los LID que se puedan averiguar con Baileys (si la versión lo permite). */
  async function resolverLids(lista) {
    const faltan = lidsSinResolver(lista, mapaLid).slice(0, MAX_LIDS_POR_FOTO);
    if (faltan.length === 0) return;
    const mapeo = sock?.signalRepository?.lidMapping;
    if (typeof mapeo?.getPNForLID !== 'function') return;
    for (const lid of faltan) {
      try {
        const pn = await mapeo.getPNForLID(lid);
        if (pn) mapaLid.set(lid, pn);
      } catch { /* sin dato: queda sin teléfono */ }
    }
  }

  async function mandarFoto(g) {
    aprenderLids(g.participantes, mapaLid);
    await resolverLids(g.participantes);
    const cuerpo = cuerpoFoto(g, g.participantes, { ahora: ahora(), mapaLid });
    const r = await cliente.enviarGrupo(cuerpo);
    if (!r.ok) { sucios.add(g.id); return false; }
    sucios.delete(g.id);
    log.info(`«${g.nombre}»: ${cuerpo.participantes.length} con teléfono${cuerpo.sinTelefono ? ` y ${cuerpo.sinTelefono} sin teléfono visible (se cuentan, no se mandan)` : ''}.`);
    return true;
  }

  async function tomarFotos(motivo, soloIds = null) {
    if (!conectado() || !sock) return;
    let todos;
    try { todos = await sock.groupFetchAllParticipating(); }
    catch (e) { log.warn(`No pude traer los grupos de WhatsApp: ${mensaje(e)}`); return; }

    const elegidos = elegirGrupos(todos, config.gruposRegex);
    grupos.clear();
    ignorados.clear();
    for (const g of elegidos) grupos.set(g.id, { id: g.id, nombre: g.nombre });
    estado.gruposSeguidos = grupos.size;
    log.info(`Vigilo ${grupos.size} grupo(s) (${motivo}).`);
    if (grupos.size === 0) {
      log.warn(config.gruposRegexTexto
        ? `Ningún grupo de este número coincide con GRUPOS_REGEX («${config.gruposRegexTexto}»).`
        : 'Este número no está en ningún grupo.');
    }

    let primero = true;
    for (const g of elegidos) {
      if (soloIds && !soloIds.has(g.id)) continue;
      if (!primero) await pausar(PAUSA_ENTRE_GRUPOS_MS);
      primero = false;
      if (!conectado()) return;
      await mandarFoto(g);
    }
  }

  /** Un grupo que no conocíamos (nos agregaron, o le cambiaron el nombre): si interesa, se mira
      entero y se manda su foto. Si llegan muchos avisos juntos de un grupo desconocido, se pregunta
      una sola vez. */
  const consultas = new Map();
  function conocerGrupo(id) {
    const en_curso = consultas.get(id);
    if (en_curso) return en_curso;
    const p = (async () => {
      if (!sock) return null;
      let meta;
      try { meta = await sock.groupMetadata(id); }
      catch (e) { log.warn(`No pude traer un grupo de WhatsApp: ${mensaje(e)}`); return null; }
      const [g] = elegirGrupos({ [id]: { ...meta, id } }, config.gruposRegex);
      if (!g) { ignorados.add(id); grupos.delete(id); estado.gruposSeguidos = grupos.size; return null; }
      ignorados.delete(id);
      grupos.set(g.id, { id: g.id, nombre: g.nombre });
      estado.gruposSeguidos = grupos.size;
      await mandarFoto(g);
      return g;
    })().finally(() => consultas.delete(id));
    consultas.set(id, p);
    return p;
  }

  /* ---------- Quién entra y quién sale ---------- */

  async function alCambiarParticipantes(u) {
    const evento = eventoDeAccion(u?.action);
    if (!evento || !u?.id) return;
    let grupo = grupos.get(u.id);
    if (!grupo) {
      if (ignorados.has(u.id)) return;
      /* Un grupo que no conocíamos: se mira entero y se manda su foto. El aviso se manda igual,
         por si pasó mientras se pedía la lista: si ya estaba en la foto, no cambia nada. */
      if (!(await conocerGrupo(u.id))) return;
      grupo = grupos.get(u.id);
      if (!grupo) return;
    }
    aprenderLids(u.participants, mapaLid);
    await resolverLids(u.participants);
    const n = normalizarParticipantes(u.participants, mapaLid);
    if (n.telefonos.length === 0) {
      log.warn(`«${grupo.nombre}»: ${evento === 'entro' ? 'entró' : 'salió'} ${n.sinTelefono} participante(s) sin teléfono visible; no se informa.`);
      return;
    }
    agregarAviso(grupo, evento, n.telefonos);
  }

  function agregarAviso(grupo, evento, telefonos) {
    const clave = `${grupo.id}|${evento}`;
    const previo = avisos.get(clave) ?? { grupo, evento, telefonos: new Set(), cuando: ahora() };
    for (const tel of telefonos) previo.telefonos.add(tel);
    avisos.set(clave, previo);
    if (!relojAvisos) relojAvisos = t.setTimeout(() => { relojAvisos = null; void vaciarAvisos(); }, LOTE_DE_AVISOS_MS);
  }

  async function vaciarAvisos() {
    if (relojAvisos) { t.clearTimeout(relojAvisos); relojAvisos = null; }
    const lote = [...avisos.values()];
    avisos.clear();
    for (const a of lote) {
      const cuerpo = cuerpoAviso(a.evento, a.grupo, [...a.telefonos], { ahora: a.cuando });
      if (!cuerpo) continue;
      const r = await cliente.enviarGrupo(cuerpo);
      if (r.ok) log.info(`«${a.grupo.nombre}»: ${a.evento === 'entro' ? 'entraron' : 'salieron'} ${cuerpo.participantes.length}.`);
      else sucios.add(a.grupo.id);
    }
  }

  async function alLlegarGrupos(lista) {
    for (const meta of Array.isArray(lista) ? lista : []) {
      if (!meta?.id || grupos.has(meta.id)) continue;
      const [g] = elegirGrupos({ [meta.id]: meta }, config.gruposRegex);
      if (!g) { ignorados.add(meta.id); continue; }
      grupos.set(g.id, { id: g.id, nombre: g.nombre });
      estado.gruposSeguidos = grupos.size;
      log.info(`Un grupo nuevo para vigilar: «${g.nombre}».`);
      await mandarFoto(g);
    }
  }

  async function alCambiarGrupos(lista) {
    for (const cambio of Array.isArray(lista) ? lista : []) {
      /* Sólo importa el cambio de nombre: puede hacer que un grupo empiece o deje de interesar. */
      if (!cambio?.id || typeof cambio.subject !== 'string') continue;
      await conocerGrupo(cambio.id);
    }
  }

  /* ---------- El código QR ---------- */

  /** WhatsApp da un código nuevo (cada ~20 segundos mientras espera): se convierte en imagen y se manda
      a la app enseguida. Sólo con --qr-terminal también se dibuja en la terminal. */
  async function alLlegarQr(codigo) {
    if (config.qrEnTerminal && qr.terminal) qr.terminal.generate(codigo, { small: true });
    let imagen;
    try { imagen = await qr.imagen(codigo); }
    catch (e) { log.error(`No pude armar la imagen del código QR: ${mensaje(e)}`); return; }
    estado.qr = { imagen, desde: ahora().getTime() };
    const primero = estado.conexion !== 'esperando_qr';
    estado.conexion = 'esperando_qr';
    if (primero) log.info('Hay que vincular el número: el código QR está en Apicanta → Ajustes → WhatsApp.');
    void latido();
  }

  /** WhatsApp cerró la sesión: se aparta la carpeta (`auth` → `auth.vieja`) y se empieza una vinculación nueva. */
  async function reiniciarVinculacion() {
    const hace = ahora().getTime() - estado.ultimaRotacion;
    if (estado.ultimaRotacion && hace < ENTRE_ROTACIONES_MS) {
      /* Se cerró de nuevo apenas empezada la vinculación: apartar otra vez tiraría una a medias. */
      log.error('WhatsApp volvió a cerrar la sesión recién empezada. Espero y vuelvo a intentar.');
      cambiarConexion('reconectando');
      programarReconexion();
      return;
    }
    cambiarConexion('cerrado');
    log.warn('WhatsApp cerró la sesión (se desvinculó el dispositivo). Guardo la anterior en «auth.vieja» y empiezo una vinculación nueva.');
    try {
      await moverSesion(config.authDir);
    } catch (e) {
      log.error(`No pude apartar la sesión vieja (${mensaje(e)}). Sigue cerrada: hay que revisar la carpeta de la sesión en el servidor.`);
      return;
    }
    estado.ultimaRotacion = ahora().getTime();
    cambiarConexion('reconectando');
    programarReconexion(true);
  }

  /* ---------- Conexión ---------- */

  async function alCambiarConexion(u) {
    const { connection, lastDisconnect, qr: codigo } = u ?? {};
    if (codigo) await alLlegarQr(codigo);
    if (connection === 'open') {
      estado.intento = 0;
      cambiarConexion('conectado');
      log.info('Conectado a WhatsApp (sólo lectura).');
      /* Un respiro para que WhatsApp termine de avisar lo pendiente antes de pedirle los grupos. */
      await pausar(1500);
      await tomarFotos('al conectar');
    } else if (connection === 'close') {
      const codigoDeCierre = lastDisconnect?.error?.output?.statusCode;
      if (codigoDeCierre !== undefined && codigoDeCierre === motivos.loggedOut) {
        await reiniciarVinculacion();
        return;
      }
      if (codigoDeCierre !== undefined && codigoDeCierre === motivos.connectionReplaced) {
        cambiarConexion('cerrado');
        log.error('WhatsApp cerró esta conexión porque otra copia del lector está usando la misma sesión. Dejá una sola corriendo.');
        return;
      }
      log.warn(`Se cortó la conexión con WhatsApp${codigoDeCierre ? ` (código ${codigoDeCierre})` : ''}.`);
      cambiarConexion('reconectando');
      programarReconexion(codigoDeCierre !== undefined && codigoDeCierre === motivos.restartRequired);
    }
  }

  function programarReconexion(enseguida = false) {
    if (estado.detenido || relojReconexion) return;
    estado.intento = enseguida ? 0 : estado.intento + 1;
    const espera = enseguida ? 0 : esperaCreciente(estado.intento, { azar });
    if (!enseguida) log.info(`Vuelvo a intentar en ${Math.round(espera / 1000)} s (intento ${estado.intento}).`);
    relojReconexion = t.setTimeout(() => {
      relojReconexion = null;
      conectar().catch((e) => { log.error(`No pude abrir la conexión: ${mensaje(e)}`); programarReconexion(); });
    }, espera);
  }

  async function conectar() {
    if (estado.detenido) return;
    const generacion = ++estado.generacion;
    const { state, saveCreds } = await baileys.useMultiFileAuthState(config.authDir);
    let version;
    if (typeof baileys.fetchLatestBaileysVersion === 'function') {
      try { version = (await baileys.fetchLatestBaileysVersion())?.version; } catch { /* sin red: la de la librería */ }
    }
    const crudo = hacerSocket({
      ...(version ? { version } : {}),
      auth: state,
      logger: loggerBaileys,
      browser: ['Apicanta Lector', 'Chrome', '1.0.0'],
      /* El código QR no se dibuja en la terminal de Baileys: llega por «connection.update» y se manda a la app. */
      printQRInTerminal: false,
      /* Sólo lectura: sin aparecer «en línea», sin bajar el historial de chats. */
      markOnlineOnConnect: false,
      syncFullHistory: false,
      shouldSyncHistoryMessage: () => false,
      generateHighQualityLinkPreview: false,
      emitOwnEvents: false,
      getMessage: async () => undefined,
    });
    sock = soloLectura(crudo);
    /* Sólo importa lo que dice la conexión vigente: un socket viejo (o uno de la sesión que se apartó) no
       puede pisar la carpeta nueva con sus llaves. */
    const vigente = (f) => (...args) => { if (generacion === estado.generacion && !estado.detenido) return f(...args); return undefined; };
    sock.ev.on('creds.update', vigente(saveCreds));
    sock.ev.on('connection.update', vigente((u) => alCambiarConexion(u).catch((e) => log.error(`Falló al cambiar la conexión: ${mensaje(e)}`))));
    sock.ev.on('group-participants.update', vigente((u) => alCambiarParticipantes(u).catch((e) => log.error(`Falló un aviso de grupo: ${mensaje(e)}`))));
    sock.ev.on('groups.upsert', vigente((l) => alLlegarGrupos(l).catch((e) => log.error(`Falló al sumar un grupo: ${mensaje(e)}`))));
    sock.ev.on('groups.update', vigente((l) => alCambiarGrupos(l).catch((e) => log.error(`Falló al actualizar un grupo: ${mensaje(e)}`))));
  }

  /* ---------- Arrancar y parar ---------- */

  async function iniciar() {
    estado.detenido = false;
    relojLatido = t.setInterval(() => { void alLatir(); }, config.latidoCadaMs);
    if (config.fotoCadaMs > 0) relojFotos = t.setInterval(() => { void tomarFotos('control periódico'); }, config.fotoCadaMs);
    /* El primer latido sale ya, todavía sin conexión: la app sabe que el servicio está vivo. */
    void latido();
    try { await conectar(); }
    catch (e) { log.error(`No pude abrir la conexión: ${mensaje(e)}`); programarReconexion(); }
  }

  async function detener() {
    estado.detenido = true;
    for (const r of [relojLatido, relojFotos, relojReconexion]) if (r) { t.clearInterval(r); t.clearTimeout(r); }
    relojLatido = relojFotos = relojReconexion = null;
    try { await vaciarAvisos(); } catch { /* ya está */ }
    /* Se apaga: la app lo ve como «reconectando» y, si no vuelve, como sin señal. */
    estado.conexion = 'reconectando';
    estado.qr = null;
    try { await latido(); } catch { /* ya está */ }
    try { sock?.end(undefined); } catch { /* ya estaba cerrado */ }
  }

  return {
    iniciar, detener,
    /** Para las pruebas y el diagnóstico. Nunca lleva el código QR. */
    estado: () => ({
      conexion: estado.conexion, conectado: conectado(), detenido: estado.detenido, intento: estado.intento,
      gruposSeguidos: estado.gruposSeguidos, hayQr: Boolean(estado.qr),
      grupos: [...grupos.values()], sucios: [...sucios],
    }),
    tomarFotos, vaciarAvisos,
  };
}
