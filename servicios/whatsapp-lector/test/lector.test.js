import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { crearLector } from '../src/lector.js';

/* El lector entero, con un WhatsApp de mentira (un socket que se maneja a
   mano), un cliente de la app de mentira y un reloj que se adelanta cuando se
   le pide: se prueba la conexión, los avisos, los latidos y las caídas sin red. */

const vaciar = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)); };

function reloj(inicio = '2026-10-07T18:00:00.000Z') {
  let t = Date.parse(inicio);
  let n = 0;
  const timers = new Map();
  return {
    ahora: () => new Date(t),
    temporizadores: {
      setTimeout: (f, ms) => { const id = ++n; timers.set(id, { f, en: t + ms, cada: 0 }); return id; },
      setInterval: (f, ms) => { const id = ++n; timers.set(id, { f, en: t + ms, cada: ms }); return id; },
      clearTimeout: (id) => { timers.delete(id); },
      clearInterval: (id) => { timers.delete(id); },
    },
    async avanzar(ms) {
      const hasta = t + ms;
      for (;;) {
        const prox = [...timers.entries()].filter(([, x]) => x.en <= hasta).sort((a, b) => a[1].en - b[1].en)[0];
        if (!prox) break;
        const [id, x] = prox;
        t = x.en;
        if (x.cada) x.en += x.cada; else timers.delete(id);
        x.f();
        await vaciar();
      }
      t = hasta;
      await vaciar();
    },
    activos: () => timers.size,
  };
}

function baileysFalso() {
  const sockets = [];
  const hacerSocket = (config) => {
    const sock = {
      config, ev: new EventEmitter(), grupos: {}, llamadas: [], terminado: false, lidMapa: {},
      async groupFetchAllParticipating() { sock.llamadas.push('fetchAll'); return structuredClone(sock.grupos); },
      async groupMetadata(id) {
        sock.llamadas.push(`meta:${id}`);
        if (!sock.grupos[id]) throw new Error('item-not-found');
        return structuredClone(sock.grupos[id]);
      },
      end() { sock.terminado = true; },
      signalRepository: { lidMapping: { getPNForLID: async (lid) => sock.lidMapa[lid] ?? null } },
      sendMessage() { throw new Error('el lector NO debería mandar mensajes'); },
      readMessages() { throw new Error('el lector NO debería marcar nada como leído'); },
      sendPresenceUpdate() { throw new Error('el lector NO debería cambiar su presencia'); },
    };
    /* Un socket nuevo arranca con los grupos del anterior: es el mismo WhatsApp. */
    if (sockets.length) sock.grupos = sockets[0].grupos;
    sockets.push(sock);
    return sock;
  };
  return {
    default: hacerSocket, sockets,
    useMultiFileAuthState: async (dir) => ({ state: { dir }, saveCreds: async () => {} }),
    fetchLatestBaileysVersion: async () => ({ version: [2, 3000, 1] }),
    DisconnectReason: { loggedOut: 401, restartRequired: 515, connectionReplaced: 440, connectionClosed: 428, connectionLost: 408, timedOut: 408 },
  };
}

function clienteFalso() {
  const c = {
    grupos: [], latidos: [], falla: false, fallaLatido: false,
    async enviarGrupo(cuerpo) {
      c.grupos.push(structuredClone(cuerpo));
      return c.falla ? { ok: false, status: 503, error: 'caída', reintentable: true } : { ok: true, status: 200, respuesta: {} };
    },
    async enviarLatido(cuerpo) {
      c.latidos.push(structuredClone(cuerpo));
      return c.fallaLatido ? { ok: false, status: 503, error: 'caída', reintentable: true } : { ok: true, status: 200, respuesta: {} };
    },
  };
  return c;
}

const G1 = '120363000000000001@g.us';
const G2 = '120363000000000002@g.us';
const G3 = '120363000000000003@g.us';
const P = (n) => `54911555500${String(n).padStart(2, '0')}`;
const jid = (n) => `${P(n)}@s.whatsapp.net`;

function armar({ config = {}, grupos } = {}) {
  const r = reloj();
  const b = baileysFalso();
  const cliente = clienteFalso();
  const lineas = [];
  const f = (nivel) => (m) => lineas.push([nivel, String(m)]);
  const log = { info: f('info'), warn: f('warn'), error: f('error'), debug: f('debug') };
  const qrs = [];
  const cfg = {
    authDir: './auth-de-prueba', gruposRegex: /webinar|taller/i, gruposRegexTexto: 'webinar|taller',
    latidoCadaMs: 120_000, fotoCadaMs: 6 * 3_600_000, ...config,
  };
  const datos = grupos ?? {
    [G1]: { id: G1, subject: 'Webinar 08/10 - Grupo 1', participants: [{ id: jid(1) }, { id: '100000000000002@lid', phoneNumber: jid(2) }, { id: '100000000000003@lid' }] },
    [G2]: { id: G2, subject: 'Familia', participants: [{ id: jid(99) }] },
  };
  /* Los grupos de WhatsApp se cargan en cuanto nace el primer socket (y los comparten los que vengan después). */
  const original = b.default;
  b.default = (c) => { const s = original(c); if (b.sockets.length === 1) s.grupos = datos; return s; };
  const lector = crearLector({
    config: cfg, baileys: b, qr: { generate: (codigo, opciones) => qrs.push([codigo, opciones]) }, log, cliente, loggerBaileys: { silencio: true },
    ahora: r.ahora, temporizadores: r.temporizadores, pausar: async () => {}, azar: () => 0.5,
  });
  return { r, b, cliente, lineas, qrs, lector, cfg };
}

const socket = (a) => a.b.sockets.at(-1);
/* Un evento de WhatsApp: se emite y se deja terminar lo que dispara, antes de adelantar el reloj. */
async function emitir(a, evento, carga, sock = socket(a)) { sock.ev.emit(evento, carga); await vaciar(); }
async function abrir(a) {
  await a.lector.iniciar();
  await vaciar();
  socket(a).ev.emit('connection.update', { connection: 'open' });
  await vaciar();
}
const cierre = (codigo) => ({ connection: 'close', lastDisconnect: { error: { output: { statusCode: codigo } }, date: new Date() } });

test('al conectarse manda el latido y la foto de los grupos que coinciden, y nada de los demás', async () => {
  const a = armar();
  await abrir(a);

  assert.deepEqual(a.cliente.latidos.map((l) => [l.conectado, l.grupos]), [[false, 0], [true, 0]], 'primero vivo y sin conexión; después conectado');
  assert.equal(a.cliente.grupos.length, 1, 'sólo el grupo de Webinar: «Familia» no coincide con GRUPOS_REGEX');
  const foto = a.cliente.grupos[0];
  assert.equal(foto.evento, 'foto');
  assert.deepEqual(foto.grupo, { id: G1, nombre: 'Webinar 08/10 - Grupo 1' });
  assert.deepEqual(foto.participantes, [P(1), P(2)], 'el que WhatsApp muestra por LID, sin teléfono, no se manda');
  assert.deepEqual([foto.total, foto.sinTelefono], [3, 1]);
  assert.equal(a.lector.estado().conectado, true);
  assert.deepEqual(a.lector.estado().grupos, [{ id: G1, nombre: 'Webinar 08/10 - Grupo 1' }]);
  assert.ok(a.lineas.some(([, m]) => /1 sin teléfono visible|1 sin teléfono/.test(m) || /sin teléfono visible/.test(m)));
});

test('el socket se arma de sólo lectura: sin aparecer en línea, sin historial, sin QR en la consola de Baileys', async () => {
  const a = armar();
  await a.lector.iniciar();
  await vaciar();
  const c = socket(a).config;
  assert.equal(c.markOnlineOnConnect, false);
  assert.equal(c.syncFullHistory, false);
  assert.equal(c.shouldSyncHistoryMessage(), false);
  assert.equal(c.printQRInTerminal, false);
  assert.equal(c.generateHighQualityLinkPreview, false);
  assert.deepEqual(c.auth, { dir: './auth-de-prueba' });
  assert.deepEqual(c.version, [2, 3000, 1]);
  assert.equal(c.browser[0], 'Apicanta Lector');
  assert.equal(await c.getMessage(), undefined);
  /* Nada en el lector llegó a tocar los métodos de escritura (si lo hubiera hecho, habría explotado). */
  await a.lector.detener();
});

test('la primera vez muestra el QR para escanear', async () => {
  const a = armar();
  await a.lector.iniciar();
  await vaciar();
  socket(a).ev.emit('connection.update', { qr: 'CODIGO-QR-1' });
  socket(a).ev.emit('connection.update', { qr: 'CODIGO-QR-2' });
  await vaciar();
  assert.deepEqual(a.qrs, [['CODIGO-QR-1', { small: true }], ['CODIGO-QR-2', { small: true }]]);
  assert.ok(a.lineas.some(([, m]) => /Dispositivos vinculados/.test(m)));
  assert.equal(a.cliente.latidos.at(-1).conectado, false);
});

test('quién entra y quién sale se avisa en lotes: tres entradas seguidas son un solo pedido', async () => {
  const a = armar();
  await abrir(a);
  const antes = a.cliente.grupos.length;
  await emitir(a, 'group-participants.update', { id: G1, action: 'add', participants: [{ id: jid(11) }] });
  await a.r.avanzar(500);
  await emitir(a, 'group-participants.update', { id: G1, action: 'add', participants: [jid(12), jid(13)] });
  await emitir(a, 'group-participants.update', { id: G1, action: 'remove', participants: [{ id: jid(1) }] });
  await emitir(a, 'group-participants.update', { id: G1, action: 'promote', participants: [{ id: jid(2) }] });
  assert.equal(a.cliente.grupos.length, antes, 'todavía no salió nada: se junta unos segundos');
  await a.r.avanzar(2500);

  const nuevos = a.cliente.grupos.slice(antes);
  assert.equal(nuevos.length, 2, 'uno de los que entraron y uno de los que salieron');
  const entraron = nuevos.find((x) => x.evento === 'entro');
  const salieron = nuevos.find((x) => x.evento === 'salio');
  assert.deepEqual(entraron.participantes.sort(), [P(11), P(12), P(13)]);
  assert.deepEqual(salieron.participantes, [P(1)]);
  assert.deepEqual(entraron.grupo, { id: G1, nombre: 'Webinar 08/10 - Grupo 1' });
  assert.ok(entraron.en <= '2026-10-07T18:00:01.000Z' || entraron.en.startsWith('2026-10-07T18:00'), 'lleva la hora en que pasó');
});

test('con la versión 6.7 los participantes de un aviso son textos', async () => {
  const a = armar();
  await abrir(a);
  const antes = a.cliente.grupos.length;
  await emitir(a, 'group-participants.update', { id: G1, action: 'add', participants: [jid(21), '100000000000077@lid'] });
  await a.r.avanzar(2500);
  assert.deepEqual(a.cliente.grupos.slice(antes).map((x) => [x.evento, x.participantes]), [['entro', [P(21)]]]);
});

test('un participante sin teléfono visible no se avisa; si Baileys puede averiguar su teléfono, sí', async () => {
  const a = armar();
  await abrir(a);
  const antes = a.cliente.grupos.length;
  const s = socket(a);
  await emitir(a, 'group-participants.update', { id: G1, action: 'add', participants: [{ id: '100000000000009@lid' }] });
  await a.r.avanzar(2500);
  assert.equal(a.cliente.grupos.length, antes, 'nada que avisar');
  assert.ok(a.lineas.some(([n, m]) => n === 'warn' && /sin teléfono visible/.test(m)));

  s.lidMapa['100000000000010@lid'] = `${P(30)}:0@s.whatsapp.net`;
  await emitir(a, 'group-participants.update', { id: G1, action: 'add', participants: [{ id: '100000000000010@lid' }] });
  await a.r.avanzar(2500);
  assert.deepEqual(a.cliente.grupos.slice(antes).map((x) => [x.evento, x.participantes]), [['entro', [P(30)]]]);
});

test('un grupo que no interesa se consulta una sola vez y sus avisos se ignoran', async () => {
  const a = armar();
  await abrir(a);
  const s = socket(a);
  const antes = a.cliente.grupos.length;
  /* Tres juntos, sin esperar a que el primero termine de averiguar. */
  for (let i = 0; i < 3; i++) s.ev.emit('group-participants.update', { id: G2, action: 'add', participants: [{ id: jid(40 + i) }] });
  await vaciar();
  await emitir(a, 'group-participants.update', { id: G2, action: 'add', participants: [{ id: jid(45) }] });
  await a.r.avanzar(3000);
  assert.equal(a.cliente.grupos.length, antes);
  assert.equal(s.llamadas.filter((x) => x === `meta:${G2}`).length, 1);
});

test('un aviso de un grupo que todavía no conocía y sí interesa: se mira el grupo entero', async () => {
  const a = armar();
  await abrir(a);
  const s = socket(a);
  s.grupos[G3] = { id: G3, subject: 'Taller 24/09', participants: [{ id: jid(50) }, { id: jid(51) }] };
  const antes = a.cliente.grupos.length;
  await emitir(a, 'group-participants.update', { id: G3, action: 'add', participants: [{ id: jid(51) }] });
  await a.r.avanzar(3000);
  /* La foto del grupo entero y, por las dudas, el aviso (si ya estaba en la foto, no cambia nada). */
  assert.deepEqual(
    a.cliente.grupos.slice(antes).map((x) => [x.evento, x.grupo.nombre, x.participantes]),
    [['foto', 'Taller 24/09', [P(50), P(51)]], ['entro', 'Taller 24/09', [P(51)]]],
  );
  assert.equal(a.lector.estado().grupos.length, 2);
});

test('un grupo nuevo (nos agregaron) que coincide se empieza a vigilar; uno que no, no', async () => {
  const a = armar();
  await abrir(a);
  const antes = a.cliente.grupos.length;
  await emitir(a, 'groups.upsert', [
    { id: G3, subject: 'Webinar 15/10', participants: [{ id: jid(60) }] },
    { id: '120363000000000009@g.us', subject: 'Amigos', participants: [{ id: jid(61) }] },
  ]);
  assert.deepEqual(a.cliente.grupos.slice(antes).map((x) => [x.evento, x.grupo.nombre]), [['foto', 'Webinar 15/10']]);
  assert.equal(a.lector.estado().grupos.length, 2);
});

test('si le cambian el nombre a un grupo y ahora coincide, se empieza a vigilar', async () => {
  const a = armar();
  await abrir(a);
  const s = socket(a);
  const antes = a.cliente.grupos.length;
  s.grupos[G2].subject = 'Webinar 09/10 - Grupo 2';
  await emitir(a, 'groups.update', [{ id: G2, subject: 'Webinar 09/10 - Grupo 2' }, { id: G1, announce: true }]);
  assert.deepEqual(a.cliente.grupos.slice(antes).map((x) => [x.evento, x.grupo.nombre]), [['foto', 'Webinar 09/10 - Grupo 2']]);
});

test('cada dos minutos un latido; cada seis horas la foto de nuevo', async () => {
  const a = armar();
  await abrir(a);
  const latidos = a.cliente.latidos.length;
  const fotos = a.cliente.grupos.length;
  await a.r.avanzar(5 * 60_000);
  assert.equal(a.cliente.latidos.length - latidos, 2, 'a los 2 y a los 4 minutos');
  assert.ok(a.cliente.latidos.slice(latidos).every((l) => l.conectado === true && l.grupos === 1));
  assert.equal(a.cliente.grupos.length, fotos, 'la foto no se repite antes de tiempo');
  await a.r.avanzar(6 * 3_600_000);
  assert.ok(a.cliente.grupos.length > fotos, 'a las 6 horas, otra foto por si se perdió un aviso');
  assert.ok(socket(a).llamadas.filter((x) => x === 'fetchAll').length >= 2);
});

test('con FOTO_CADA_HORAS=0 no hay control periódico', async () => {
  const a = armar({ config: { fotoCadaMs: 0 } });
  await abrir(a);
  const fotos = a.cliente.grupos.length;
  await a.r.avanzar(24 * 3_600_000);
  assert.equal(a.cliente.grupos.length, fotos);
});

test('se corta la conexión: lo avisa enseguida y reintenta con espera creciente, que se reinicia al volver', async () => {
  const a = armar();
  await abrir(a);
  const s1 = socket(a);
  s1.ev.emit('connection.update', cierre(408));
  await vaciar();
  assert.equal(a.lector.estado().conectado, false);
  assert.equal(a.cliente.latidos.at(-1).conectado, false, 'avisa que se cayó sin esperar al próximo latido');

  await a.r.avanzar(1999);
  assert.equal(a.b.sockets.length, 1, 'el primer reintento es a los 2 segundos');
  await a.r.avanzar(1);
  assert.equal(a.b.sockets.length, 2);

  socket(a).ev.emit('connection.update', cierre(408));
  await vaciar();
  await a.r.avanzar(3999);
  assert.equal(a.b.sockets.length, 2, 'el segundo, a los 4');
  await a.r.avanzar(1);
  assert.equal(a.b.sockets.length, 3);

  /* Vuelve: la espera arranca de nuevo. */
  socket(a).ev.emit('connection.update', { connection: 'open' });
  await vaciar();
  assert.equal(a.lector.estado().conectado, true);
  socket(a).ev.emit('connection.update', cierre(428));
  await vaciar();
  await a.r.avanzar(2000);
  assert.equal(a.b.sockets.length, 4);
  /* El socket viejo ya no manda eventos: sólo importa el vigente. */
  const antes = a.cliente.grupos.length;
  a.b.sockets[0].ev.emit('group-participants.update', { id: G1, action: 'add', participants: [{ id: jid(70) }] });
  await a.r.avanzar(3000);
  assert.equal(a.cliente.grupos.length, antes);
});

test('«reiniciar» (515), que pasa después de escanear el QR, reconecta enseguida', async () => {
  const a = armar();
  await a.lector.iniciar();
  await vaciar();
  socket(a).ev.emit('connection.update', cierre(515));
  await vaciar();
  await a.r.avanzar(0);
  assert.equal(a.b.sockets.length, 2);
});

test('si se cierra la sesión (401) no insiste: avisa con el latido y espera el QR', async () => {
  const a = armar();
  await abrir(a);
  socket(a).ev.emit('connection.update', cierre(401));
  await vaciar();
  assert.equal(a.lector.estado().sesionCerrada, true);
  await a.r.avanzar(30 * 60_000);
  assert.equal(a.b.sockets.length, 1, 'no reintenta');
  const latidos = a.cliente.latidos.filter((l) => l.conectado === false);
  assert.ok(latidos.length >= 10, 'sigue avisando que está vivo pero sin WhatsApp');
  assert.ok(a.lineas.some(([n, m]) => n === 'error' && /escanear el QR de nuevo/.test(m)));
  assert.ok(a.lineas.some(([n, m]) => n === 'warn' && /Sigo sin sesión/.test(m)), 'y se acuerda de avisar en los registros');
});

test('si otra copia usa la misma sesión (440) tampoco insiste', async () => {
  const a = armar();
  await abrir(a);
  socket(a).ev.emit('connection.update', cierre(440));
  await vaciar();
  await a.r.avanzar(10 * 60_000);
  assert.equal(a.b.sockets.length, 1);
  assert.ok(a.lineas.some(([n, m]) => n === 'error' && /otra copia/.test(m)));
});

test('una foto que no se pudo mandar se repite en el próximo latido, con la lista de ese momento', async () => {
  const a = armar();
  a.cliente.falla = true;
  await abrir(a);
  assert.deepEqual(a.lector.estado().sucios, [G1]);

  /* La app vuelve y, mientras tanto, entró alguien más al grupo. */
  a.cliente.falla = false;
  socket(a).grupos[G1].participants.push({ id: jid(80) });
  const antes = a.cliente.grupos.length;
  await a.r.avanzar(2 * 60_000);
  const reenviada = a.cliente.grupos.slice(antes);
  assert.equal(reenviada.length, 1);
  assert.deepEqual([reenviada[0].evento, reenviada[0].participantes.includes(P(80))], ['foto', true], 'con el que entró después, no con una lista vieja');
  assert.deepEqual(a.lector.estado().sucios, []);
  assert.ok(socket(a).llamadas.includes(`meta:${G1}`));
});

test('si la app está caída (el latido tampoco pasa), no se le pide la lista a WhatsApp una y otra vez', async () => {
  const a = armar();
  a.cliente.falla = true;
  a.cliente.fallaLatido = true;
  await abrir(a);
  const consultas = socket(a).llamadas.length;
  await a.r.avanzar(10 * 60_000);
  assert.equal(socket(a).llamadas.length, consultas);
  assert.deepEqual(a.lector.estado().sucios, [G1]);
});

test('un aviso que no se pudo mandar deja al grupo para repetir su foto', async () => {
  const a = armar();
  await abrir(a);
  a.cliente.falla = true;
  await emitir(a, 'group-participants.update', { id: G1, action: 'add', participants: [{ id: jid(90) }] });
  await a.r.avanzar(2500);
  assert.deepEqual(a.lector.estado().sucios, [G1]);
});

test('GRUPOS_REGEX que no coincide con nada: lo dice en los registros', async () => {
  const a = armar({ config: { gruposRegex: /nada-que-ver/i, gruposRegexTexto: 'nada-que-ver' } });
  await abrir(a);
  assert.equal(a.cliente.grupos.length, 0);
  assert.ok(a.lineas.some(([n, m]) => n === 'warn' && /GRUPOS_REGEX/.test(m)));
});

test('al detenerlo avisa que se apaga, cierra el socket y no deja nada andando', async () => {
  const a = armar();
  await abrir(a);
  await a.lector.detener();
  assert.equal(a.cliente.latidos.at(-1).conectado, false);
  assert.equal(socket(a).terminado, true);
  assert.equal(a.r.activos(), 0, 'sin temporizadores sueltos');
  const n = a.cliente.latidos.length;
  await a.r.avanzar(60 * 60_000);
  assert.equal(a.cliente.latidos.length, n);
});

test('en los registros no hay teléfonos ni ids de WhatsApp, pase lo que pase', async () => {
  const a = armar();
  await abrir(a);
  const s = socket(a);
  await emitir(a, 'group-participants.update', { id: G1, action: 'add', participants: [{ id: jid(11) }, { id: '100000000000009@lid' }] });
  await emitir(a, 'group-participants.update', { id: G1, action: 'remove', participants: [{ id: jid(1) }] });
  await a.r.avanzar(3000);
  await emitir(a, 'connection.update', cierre(408), s);
  await a.r.avanzar(10_000);
  await emitir(a, 'connection.update', cierre(401));
  await a.r.avanzar(5 * 60_000);
  assert.ok(a.lineas.length > 5);
  for (const [, m] of a.lineas) assert.ok(!/\d{7,}/.test(m), `un registro lleva un número largo: ${m}`);
});
