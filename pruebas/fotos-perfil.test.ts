import test from "node:test";
import assert from "node:assert/strict";
import { fotoDe, mapaDeFotos } from "@/lib/fotos-perfil";
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
