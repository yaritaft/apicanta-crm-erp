import test from "node:test";
import assert from "node:assert/strict";
import { aplazarFoto, fotoAplazadaHoy, fotoDe, mapaDeFotos } from "@/lib/fotos-perfil";
import { acciones } from "@/lib/store";
import type { EstadoApp, FotoPerfil } from "@/lib/types";

/* La foto de perfil de cada uno (20/10): se busca por mail y, si un mensaje viejo no lo tiene, por nombre. */

const F = (id: string, nombre: string, foto = `data:image/jpeg;base64,${id}`): FotoPerfil => ({ id, nombre, foto, actualizadoEn: "2026-10-20T00:00:00Z" });

test("la foto se encuentra por mail, sin importar mayúsculas, y si no hay mail por el nombre", () => {
  const f = mapaDeFotos([F("lili@apicanta.com", "Liliana Riveros"), F("yari taft", "Yari Taft")]);
  assert.equal(fotoDe(f, "Lili@Apicanta.com", "Lili"), "data:image/jpeg;base64,lili@apicanta.com");
  assert.equal(fotoDe(f, undefined, "Liliana Riveros"), "data:image/jpeg;base64,lili@apicanta.com", "por el nombre que guardó con la foto");
  assert.equal(fotoDe(f, null, "Yari Taft"), "data:image/jpeg;base64,yari taft", "sin nube, la clave es el nombre");
  assert.equal(fotoDe(f, "otro@x.com", "Alguien Nuevo"), undefined, "sin foto: van sus iniciales");
});

test("un mensaje con el nombre de Equipo encuentra la foto por el mail que tiene en Equipo", () => {
  const f = mapaDeFotos([F("dante@apicanta.com", "")], [{ nombre: "Dante Barbieri", email: "Dante@Apicanta.com" }]);
  assert.equal(fotoDe(f, undefined, "Dante Barbieri"), "data:image/jpeg;base64,dante@apicanta.com");
});

test("ponerFoto guarda una por persona (la nueva reemplaza a la vieja) y no acepta algo que no sea una imagen", () => {
  const fotos = () => (JSON.parse(acciones.exportar()) as EstadoApp).fotosPerfil ?? [];
  acciones.ponerFoto("lili@x.com", "Lili", "data:image/jpeg;base64,AAA");
  acciones.ponerFoto("lili@x.com", "Lili", "data:image/jpeg;base64,BBB");
  assert.deepEqual(fotos().filter((f) => f.id === "lili@x.com").map((f) => f.foto), ["data:image/jpeg;base64,BBB"]);
  acciones.ponerFoto("yari@x.com", "Yari", "https://otro-sitio.com/foto.jpg");
  acciones.ponerFoto("", "Nadie", "data:image/jpeg;base64,CCC");
  assert.equal(fotos().some((f) => f.id === "yari@x.com" || f.nombre === "Nadie"), false);
});

/* «Cargarla después» (21/10): el cartel obligatorio se pospone hasta el otro día, por persona, y sin romper si el navegador no guarda. */
const almacenFalso = () => {
  const datos = new Map<string, string>();
  return { getItem: (k: string) => datos.get(k) ?? null, setItem: (k: string, v: string) => void datos.set(k, v) };
};

test("«Cargarla después» silencia el cartel sólo ese día y sólo para esa persona", () => {
  const a = almacenFalso();
  assert.equal(fotoAplazadaHoy("lili@x.com", "2026-10-21", a), false, "antes de decir «después», el cartel sale");
  aplazarFoto("lili@x.com", "2026-10-21", a);
  assert.equal(fotoAplazadaHoy("lili@x.com", "2026-10-21", a), true, "el mismo día no vuelve a salir");
  assert.equal(fotoAplazadaHoy("lili@x.com", "2026-10-22", a), false, "al otro día se vuelve a pedir");
  assert.equal(fotoAplazadaHoy("yari@x.com", "2026-10-21", a), false, "otra persona en el mismo navegador no hereda el «después»");
});

test("si el navegador no deja guardar (modo privado, sin localStorage) el cartel simplemente sale y no se rompe nada", () => {
  const roto = { getItem: () => { throw new Error("bloqueado"); }, setItem: () => { throw new Error("bloqueado"); } };
  assert.doesNotThrow(() => aplazarFoto("lili@x.com", "2026-10-21", roto));
  assert.equal(fotoAplazadaHoy("lili@x.com", "2026-10-21", roto), false);
  assert.doesNotThrow(() => aplazarFoto("lili@x.com", "2026-10-21", null));
  assert.equal(fotoAplazadaHoy("lili@x.com", "2026-10-21", null), false);
  assert.equal(fotoAplazadaHoy("", "2026-10-21", almacenFalso()), false, "sin identidad no hay nada que recordar");
});
