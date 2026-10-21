import test from "node:test";
import assert from "node:assert/strict";
import { webinarsSinGrupo, type GrupoWhatsapp } from "@/lib/whatsapp";
import { atarGruposAlCrear, ErrorWhatsapp } from "@/lib/whatsapp-cliente";

/* Hoy es el 21/10/2026. El webinar de hoy no tiene grupo, pero el lector ya detectó dos con su fecha; el del 7/10 ya está atado;
   uno de agosto 2026 (más de 45 días) sin grupo no avisa; y uno de 2025 tampoco. */
const AHORA = Date.parse("2026-10-21T12:00:00-03:00");
const w = (id: string, dia: string, hora = "19:00") => ({ id, titulo: `Taller ${dia}`, fecha: `${dia}T${hora}:00-03:00` });
const webinars = [w("w_1021", "2026-10-21"), w("w_1007", "2026-10-07"), w("w_0812", "2026-08-12"), w("w_2025", "2025-09-17"), w("w_1104", "2026-11-04")];
const g = (id: string, nombre: string, webinarId: string | null = null, miembros = 100): GrupoWhatsapp => ({ id, nombre, webinarId, miembros, sinTelefono: 0, ultimaFoto: null });
const grupos = [
  g("g1", "Taller Online 21/10/26 #1", null, 775), g("g2", "Taller Online 21/10/26 #2", null, 218),
  g("g3", "Taller Online 07/10/26 #1", "w_1007"), g("g4", "Taller online 13/05/26"), g("g5", "Taller Online XX/XX/XX #1"),
];

test("los webinars sin grupo: los próximos y los de los últimos 45 días, con los grupos sueltos que dicen su fecha", () => {
  const r = webinarsSinGrupo(webinars, grupos, AHORA);
  assert.deepEqual(r.map((x) => x.webinar.id), ["w_1021", "w_1104"], "el atado, el de agosto y el de 2025 no avisan; el más próximo primero");
  assert.deepEqual(r[0].sugeridos.map((x) => x.id), ["g1", "g2"], "ordenados por su «#N»");
  assert.deepEqual(r[1].sugeridos, [], "el del 4/11 todavía no tiene grupo detectado");
});

test("un grupo ya atado a otro webinar no se sugiere, y un webinar con al menos un grupo atado ya no falta", () => {
  const conUno = grupos.map((x) => (x.id === "g1" ? { ...x, webinarId: "w_1021" } : x));
  const r = webinarsSinGrupo(webinars, conUno, AHORA);
  assert.deepEqual(r.map((x) => x.webinar.id), ["w_1104"], "con el #1 atado, el webinar de hoy ya no falta (el #2 se ata desde su ficha o Ajustes)");
  assert.deepEqual(webinarsSinGrupo([], grupos, AHORA), []);
});

const esperaNula = async () => undefined;

test("al crear: los grupos se atan; si el webinar todavía no está en la base se reintenta con calma", async () => {
  const llamadas: string[] = [];
  let falla = 2;
  const atar = async (grupoId: string, webinarId: string) => {
    llamadas.push(`${grupoId}>${webinarId}`);
    if (falla-- > 0) throw new ErrorWhatsapp("Ese webinar no existe.", 404);
  };
  const esperas: number[] = [];
  const faltan = await atarGruposAlCrear(["g1", "g2"], "w_nuevo", { atar, esperar: async (ms) => { esperas.push(ms); }, esperas: [1500, 3000, 6000] });
  assert.deepEqual(faltan, []);
  assert.deepEqual(llamadas, ["g1>w_nuevo", "g1>w_nuevo", "g1>w_nuevo", "g2>w_nuevo"], "el primero tardó dos reintentos; el segundo salió de una");
  assert.deepEqual(esperas, [1500, 3000], "las esperas crecen");
});

test("al crear: si el webinar nunca aparece se rinde y avisa cuáles no se ataron; un error que no es «no existe» no se reintenta", async () => {
  const nunca = async () => { throw new ErrorWhatsapp("Ese webinar no existe.", 404); };
  let intentos = 0;
  const contando = async () => { intentos++; return nunca(); };
  assert.deepEqual(await atarGruposAlCrear(["g1"], "w_x", { atar: contando, esperar: esperaNula, esperas: [1, 1, 1] }), ["g1"]);
  assert.equal(intentos, 4, "el primero más tres reintentos");

  let sinPermiso = 0;
  const prohibido = async () => { sinPermiso++; throw new ErrorWhatsapp("Tu tipo de cuenta no puede cambiar esto.", 403); };
  assert.deepEqual(await atarGruposAlCrear(["g1", "g2"], "w_x", { atar: prohibido, esperar: esperaNula }), ["g1", "g2"]);
  assert.equal(sinPermiso, 2, "uno por grupo, sin reintentos");

  let grupoPerdido = 0;
  const sinGrupo = async () => { grupoPerdido++; throw new ErrorWhatsapp("Ese grupo no está entre los que detectó el lector.", 404); };
  assert.deepEqual(await atarGruposAlCrear(["g1"], "w_x", { atar: sinGrupo, esperar: esperaNula }), ["g1"]);
  assert.equal(grupoPerdido, 1, "un 404 que habla del grupo no es «el webinar no existe»");
});
