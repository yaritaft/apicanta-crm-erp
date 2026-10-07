import { cuerpoAviso, cuerpoFoto, cuerpoLatido, eventoDeAccion } from './cuerpos.js';
import { esperaCreciente } from './espera.js';
import { elegirGrupos } from './grupos.js';
import { aprenderLids, lidsSinResolver, normalizarParticipantes } from './participantes.js';
import { moverSesionVieja, prepararCarpetaDeSesion } from './sesion.js';
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
   - Si se cae la conexión, reintenta con espera creciente (que sólo vuelve a empezar de cero si la conexión anterior
     aguantó un minuto: una que se cae a los segundos, una y otra vez, no se reintenta a ritmo de segundos; un 403
     —número bloqueado— no se reintenta). Si WhatsApp cierra
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
/* Una conexión que aguanta menos que esto no cuenta como «andaba»: si se corta, la espera sigue creciendo. Una que
   abre y se cae a los pocos segundos, una y otra vez, es justo lo que más expone el número a un bloqueo. */
const ESTABLE_MS = 60_000;
/* «Reiniciá la conexión» (515) pasa una vez después de vincular. Si se repite, las primeras veces se atienden con
   poca espera y después se trata como una falla (con espera creciente). */
const ESPERAS_DE_REINICIO_MS = [0, 1000, 3000];
/* Cierres seguidos por sesión rota (500 o 411) antes de empezar una vinculación nueva. */
const CIERRES_DE_SESION_ROTA = 3;
/* La versión de WhatsApp Web que pide Baileys no cambia a cada rato: se consulta a lo sumo cada tanto. */
const VERSION_VIGENTE_MS = 6 * 3_600_000;
/* Al apagarlo, vaciar los avisos y mandar el último latido tienen tope: systemd mata a los 30 segundos y, a mitad de
   escribir las llaves de la sesión, podría dejarlas truncadas. */
const TOPE_AL_APAGAR_MS = 10_000;

const mensaje = (e) => String(e?.message ?? e ?? 'error').replace(/\d{7,}/g, '…').slice(0, 200);

/* WhatsApp dice que el grupo ya no está para este número (salió, lo sacaron o lo borraron). */
const grupoInexistente = (e) =>
  /item-not-found|forbidden|not-authorized/i.test(String(e?.message ?? e))
  || [403, 404].includes(e?.data) || [403, 404].includes(e?.output?.statusCode);

/**
 * @param {object} p
 * @param {object} p.qr        { imagen(texto) → Promise<data URL>, terminal? { generate } }: cómo se dibuja el código
 * @param {Function} p.moverSesion  (carpeta) → Promise: aparta la sesión cerrada
 * @param {Function} p.prepararSesion  (carpeta) → Promise: crea la carpeta de la sesión sólo para su dueño
 */
export function crearLector({
  config, baileys, qr, log, cliente, loggerBaileys,
  ahora = () => new Date(),
  temporizadores = { setTimeout, clearTimeout, setInterval, clearInterval },
  pausar = (ms) => new Promise((listo) => setTimeout(listo, ms)),
  azar = Math.random,
  moverSesion = moverSesionVieja,
  prepararSesion = prepararCarpetaDeSesion,
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
    /** Desde cuándo (ms) la conexión actual dio señales de vida (abrió o recibió un código); null si todavía no. */
    vivaDesde: null,
    /** Reinicios (515) y cierres por sesión rota (500 / 411) seguidos, sin una conexión estable en el medio. */
    reinicios: 0, cierresDeSesion: 0,
  };
  let versionDeBaileys = null;   // { version, en }: la última que se pidió
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

  /** `instante`: cuándo se le pidió la lista a WhatsApp, NO cuándo se manda. La app ordena los avisos contra esa hora
      (los anteriores ya están en la foto, los posteriores se aplican): entre pedir la lista y mandar la foto de un grupo
      pasan segundos (las pausas y el pedido de cada grupo anterior), y quien entró o salió en esa ventana se perdería
      o quedaría al revés hasta la próxima foto. */
  async function mandarFoto(g, instante) {
    aprenderLids(g.participantes, mapaLid);
    await resolverLids(g.participantes);
    const cuerpo = cuerpoFoto(g, g.participantes, { ahora: instante, mapaLid });
    const r = await cliente.enviarGrupo(cuerpo);
    if (!r.ok) { sucios.add(g.id); return false; }
    sucios.delete(g.id);
    if (r.respuesta?.ignorada) {
      log.info(`«${g.nombre}»: la app no aplicó la foto (${mensaje(r.respuesta.ignorada)})`);
      return true;
    }
    log.info(`«${g.nombre}»: ${cuerpo.participantes.length} con teléfono${cuerpo.sinTelefono ? ` y ${cuerpo.sinTelefono} sin teléfono visible (se cuentan, no se mandan)` : ''}.`);
    return true;
  }

  async function tomarFotos(motivo, soloIds = null) {
    if (!conectado() || !sock) return;
    /* La hora de todas las fotos de esta tanda: la de ANTES de pedir la lista. */
    const instante = ahora();
    let todos;
    try { todos = await sock.groupFetchAllParticipating(); }
    catch (e) { log.warn(`No pude traer los grupos de WhatsApp: ${mensaje(e)}`); return; }

    const elegidos = elegirGrupos(todos, config.gruposRegex);
    grupos.clear();
    ignorados.clear();
    for (const g of elegidos) grupos.set(g.id, { id: g.id, nombre: g.nombre });
    estado.gruposSeguidos = grupos.size;
    /* Un grupo que ya no figura (el número salió, lo borraron, lo renombraron) deja de reintentarse en cada latido. */
    for (const id of [...sucios]) if (!grupos.has(id)) sucios.delete(id);
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
      await mandarFoto(g, instante);
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
      const instante = ahora();
      let meta;
      try { meta = await sock.groupMetadata(id); }
      catch (e) {
        log.warn(`No pude traer un grupo de WhatsApp: ${mensaje(e)}`);
        /* Si ya no existe para este número, no se sigue preguntando en cada latido. */
        if (grupoInexistente(e)) { sucios.delete(id); grupos.delete(id); estado.gruposSeguidos = grupos.size; }
        return null;
      }
      const [g] = elegirGrupos({ [id]: { ...meta, id } }, config.gruposRegex);
      if (!g) { ignorados.add(id); grupos.delete(id); sucios.delete(id); estado.gruposSeguidos = grupos.size; return null; }
      ignorados.delete(id);
      grupos.set(g.id, { id: g.id, nombre: g.nombre });
      estado.gruposSeguidos = grupos.size;
      await mandarFoto(g, instante);
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
      if (!r.ok) sucios.add(a.grupo.id);
      else if (r.respuesta?.ignorada) log.info(`«${a.grupo.nombre}»: la app no aplicó el aviso (${mensaje(r.respuesta.ignorada)})`);
      else log.info(`«${a.grupo.nombre}»: ${a.evento === 'entro' ? 'entraron' : 'salieron'} ${cuerpo.participantes.length}.`);
    }
  }

  async function alLlegarGrupos(lista) {
    /* Los metadatos llegaron con el evento: esa es la hora de la foto. */
    const instante = ahora();
    for (const meta of Array.isArray(lista) ? lista : []) {
      if (!meta?.id || grupos.has(meta.id)) continue;
      const [g] = elegirGrupos({ [meta.id]: meta }, config.gruposRegex);
      if (!g) { ignorados.add(meta.id); continue; }
      grupos.set(g.id, { id: g.id, nombre: g.nombre });
      estado.gruposSeguidos = grupos.size;
      log.info(`Un grupo nuevo para vigilar: «${g.nombre}».`);
      await mandarFoto(g, instante);
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
    /* Que WhatsApp dé un código prueba que la conexión anda; si aguanta (ESTABLE_MS) y después se corta, la espera
       arranca de nuevo. Uno que se corta enseguida, no. */
    estado.vivaDesde ??= ahora().getTime();
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
    /* Una vinculación nueva: la cuenta de fallas vuelve a cero. */
    estado.intento = 0; estado.reinicios = 0; estado.cierresDeSesion = 0;
    cambiarConexion('reconectando');
    programarReconexion({ fijaMs: 0 });
  }

  /* ---------- Conexión ---------- */

  async function alCambiarConexion(u) {
    const { connection, lastDisconnect, qr: codigo } = u ?? {};
    if (codigo) await alLlegarQr(codigo);
    if (connection === 'open') {
      estado.vivaDesde ??= ahora().getTime();
      cambiarConexion('conectado');
      log.info('Conectado a WhatsApp (sólo lectura).');
      /* Un respiro para que WhatsApp termine de avisar lo pendiente antes de pedirle los grupos. */
      await pausar(1500);
      await tomarFotos('al conectar');
    } else if (connection === 'close') {
      /* Si la conexión había aguantado, esta caída es nueva y la espera arranca de cero. Si se cae a los pocos segundos
         de abrir (o de recibir un código), una y otra vez, la espera sigue creciendo hasta el tope. */
      if (estado.vivaDesde !== null && ahora().getTime() - estado.vivaDesde >= ESTABLE_MS) {
        estado.intento = 0; estado.reinicios = 0; estado.cierresDeSesion = 0;
      }
      estado.vivaDesde = null;
      const codigoDeCierre = lastDisconnect?.error?.output?.statusCode;
      const es = (motivo) => codigoDeCierre !== undefined && codigoDeCierre === motivo;
      if (es(motivos.loggedOut)) {
        await reiniciarVinculacion();
        return;
      }
      if (es(motivos.connectionReplaced)) {
        cambiarConexion('cerrado');
        log.error('WhatsApp cerró esta conexión porque otra copia del lector está usando la misma sesión. Dejá una sola corriendo.');
        return;
      }
      if (es(motivos.forbidden)) {
        /* Seguir golpeando a WhatsApp con un número bloqueado sólo lo empeora. */
        cambiarConexion('cerrado');
        log.error('WhatsApp rechazó la conexión (código 403): el número puede estar bloqueado. No sigo intentando para no empeorarlo; hay que mirar el teléfono y reiniciar el servicio (ver el README).');
        return;
      }
      if (es(motivos.badSession) || es(motivos.multideviceMismatch)) {
        /* Las llaves guardadas no sirven: no se arregla esperando. A la tercera seguida, se empieza una vinculación nueva. */
        estado.cierresDeSesion += 1;
        if (estado.cierresDeSesion >= CIERRES_DE_SESION_ROTA) {
          log.warn(`WhatsApp cerró la conexión ${estado.cierresDeSesion} veces seguidas porque la sesión guardada no sirve (código ${codigoDeCierre}).`);
          estado.cierresDeSesion = 0;
          await reiniciarVinculacion();
          return;
        }
      }
      if (es(motivos.restartRequired)) {
        estado.reinicios += 1;
        if (estado.reinicios <= ESPERAS_DE_REINICIO_MS.length) {
          /* Pasa una vez después de vincular el número: se reconecta enseguida. */
          log.info('WhatsApp pidió reiniciar la conexión (es lo normal después de vincular el número).');
          cambiarConexion('reconectando');
          programarReconexion({ fijaMs: ESPERAS_DE_REINICIO_MS[estado.reinicios - 1] });
          return;
        }
        log.warn('WhatsApp sigue pidiendo reiniciar la conexión: lo trato como una falla y espero cada vez más.');
      } else if (estado.conexion === 'esperando_qr' && estado.intento === 0) {
        /* Nadie escaneó los ~6 códigos que da WhatsApp (unos 3 minutos) y cierra la conexión. No es una falla (llegaron
           códigos y la conexión aguantó), así que se pide otra tanda enseguida y se sigue «esperando_qr», sin pasar por
           «reconectando», para que quien abra Ajustes horas después encuentre siempre un código vivo. */
        log.debug('Se vencieron los códigos QR sin que los escanearan. Pido otros.');
        estado.qr = null;
        programarReconexion({ callado: true });
        return;
      }
      log.warn(`Se cortó la conexión con WhatsApp${codigoDeCierre ? ` (código ${codigoDeCierre})` : ''}.`);
      cambiarConexion('reconectando');
      programarReconexion();
    }
  }

  /** `fijaMs`: una espera fija (los reinicios y la vinculación nueva), sin tocar la cuenta de intentos. Sin ella, espera
      creciente (2 s, 4 s, 8 s… hasta 5 minutos). `callado`: sin avisar en los registros (es lo esperable). */
  function programarReconexion({ fijaMs = null, callado = false } = {}) {
    if (estado.detenido || relojReconexion) return;
    let espera = fijaMs;
    if (espera === null) {
      estado.intento += 1;
      espera = esperaCreciente(estado.intento, { azar });
      if (!callado) log.info(`Vuelvo a intentar en ${Math.round(espera / 1000)} s (intento ${estado.intento}).`);
    }
    relojReconexion = t.setTimeout(() => {
      relojReconexion = null;
      conectar().catch((e) => { log.error(`No pude abrir la conexión: ${mensaje(e)}`); programarReconexion(); });
    }, espera);
  }

  /** La versión de WhatsApp Web con la que se conecta Baileys. Se pide a lo sumo cada VERSION_VIGENTE_MS: una racha de
      reconexiones no tiene por qué ser una racha de consultas. Sin red, la última que se supo o la de la librería. */
  async function versionDeLaLibreria() {
    if (typeof baileys.fetchLatestBaileysVersion !== 'function') return undefined;
    const ahoraMs = ahora().getTime();
    if (versionDeBaileys && ahoraMs - versionDeBaileys.en < VERSION_VIGENTE_MS) return versionDeBaileys.version;
    try {
      const version = (await baileys.fetchLatestBaileysVersion())?.version;
      if (version) versionDeBaileys = { version, en: ahoraMs };
    } catch { /* sin red: queda la que había */ }
    return versionDeBaileys?.version;
  }

  async function conectar() {
    if (estado.detenido) return;
    const generacion = ++estado.generacion;
    estado.vivaDesde = null;
    /* La carpeta de la sesión sólo para su dueño: ahí están las llaves con las que se leen todos los chats del número.
       También después de apartar la vieja (Baileys la crearía con los permisos por defecto). */
    await prepararSesion(config.authDir);
    const { state, saveCreds } = await baileys.useMultiFileAuthState(config.authDir);
    const version = await versionDeLaLibreria();
    const crudo = hacerSocket({
      ...(version ? { version } : {}),
      auth: state,
      logger: loggerBaileys,
      browser: ['Apicanta Lector', 'Chrome', '1.0.0'],
      /* El código QR no se dibuja en la terminal de Baileys: llega por «connection.update» y se manda a la app. */
      printQRInTerminal: false,
      /* Sólo lectura: sin aparecer «en línea» y sin pedir el historial completo de chats. NO se toca
         `shouldSyncHistoryMessage`: apagar todo el historial le saca a Baileys los mapeos de LID a teléfono (no
         puede decir quién es quién en un grupo) y él mismo avisa que lleva a «inestabilidad y errores de sesión».
         Su valor por defecto ya descarta el historial completo y conserva lo mínimo; lo que llega se descarta. */
      markOnlineOnConnect: false,
      syncFullHistory: false,
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

  /** Espera a `promesa`, pero no más de `ms` (con los temporizadores del lector, para poder probarlo). */
  const conTope = (promesa, ms) => new Promise((listo) => {
    const id = t.setTimeout(listo, ms);
    Promise.resolve(promesa).catch(() => {}).finally(() => { t.clearTimeout(id); listo(); });
  });

  async function detener() {
    estado.detenido = true;
    for (const r of [relojLatido, relojFotos, relojReconexion]) if (r) { t.clearInterval(r); t.clearTimeout(r); }
    relojLatido = relojFotos = relojReconexion = null;
    /* Con la app sin contestar, cada pedido puede tardar un minuto: con tope, para que cerrar no se quede esperando. */
    await conTope(vaciarAvisos(), TOPE_AL_APAGAR_MS);
    /* Se apaga: la app lo ve como «reconectando» y, si no vuelve, como sin señal. */
    estado.conexion = 'reconectando';
    estado.qr = null;
    await conTope(latido(), TOPE_AL_APAGAR_MS);
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
