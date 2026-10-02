import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { crearApp } from "../server/app.js";
import { estadoFondo, validarProyecto, aCSV, filtrarFondos } from "../public/js/core.js";

const publicDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
let server, base, dir;
const TOKEN = "secreto-de-prueba";

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "fondos-"));
  const app = await crearApp({ publicDir, storeFile: join(dir, "p.json"), adminToken: TOKEN, rateLimit: { max: 100, ventanaMs: 60000 } });
  server = app.listen(0);
  await new Promise(r => server.once("listening", r));
  base = "http://127.0.0.1:" + server.address().port;
});
after(async () => { server.close(); await rm(dir, { recursive: true, force: true }); });

const req = (path, opts = {}) => fetch(base + path, { ...opts, headers: { "Content-Type": "application/json", ...(opts.headers || {}) } });
const PROY = { nombre: "Taller de lectura fácil", organizacion: "Junta de vecinos", region: "06", fondoId: "fndr8", estado: "postulado", lat: -34.17, lng: -70.74, monto: 5000000 };

test("health y meta", async () => {
  const h = await (await req("/api/health")).json();
  assert.equal(h.ok, true); assert.equal(h.regiones, 16); assert.ok(h.fondos > 10); assert.equal(h.escritura_protegida, true);
  const m = await (await req("/api/meta")).json();
  assert.ok(m.temas.cultura && m.tipos.ong);
});

test("filtra fondos por tema y tipo", async () => {
  const fs = await (await req("/api/fondos?tema=discapacidad&tipo=municipio")).json();
  assert.ok(fs.length >= 1);
  assert.ok(fs.every(f => f.temas.includes("discapacidad") && f.beneficiarios.includes("municipio")));
  assert.ok(fs[0].estado_estimado.estado);
});

test("fondo inexistente y región inexistente dan 404", async () => {
  assert.equal((await req("/api/fondos/no-existe")).status, 404);
  assert.equal((await req("/api/regiones/99/fondos")).status, 404);
  assert.equal((await req("/api/nada")).status, 404);
});

test("regiones como GeoJSON", async () => {
  const g = await (await req("/api/regiones")).json();
  assert.equal(g.type, "FeatureCollection"); assert.equal(g.features.length, 16);
  assert.equal(g.features[0].geometry.type, "Point");
});

test("CSV de fondos con BOM y encabezados", async () => {
  const r = await req("/api/fondos.csv");
  assert.match(r.headers.get("content-type"), /text\/csv/);
  const bytes = new Uint8Array(await r.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]); // BOM para que Excel lea UTF-8
  assert.ok(new TextDecoder().decode(bytes).startsWith("ID,Fondo"));
});

test("ciclo de vida de un proyecto con token", async () => {
  const c = await req("/api/proyectos", { method: "POST", body: JSON.stringify(PROY) });
  assert.equal(c.status, 201);
  const p = await c.json(); assert.ok(p.id); assert.equal(p.monto, 5000000);

  const lista = await (await req("/api/proyectos?region=06")).json();
  assert.ok(lista.features.some(f => f.properties.id === p.id));
  const ind = await (await req("/api/indicadores")).json();
  assert.equal(ind.find(x => x.codigo === "06").proyectos, 1);

  assert.equal((await req("/api/proyectos/" + p.id, { method: "PUT", body: JSON.stringify({ ...PROY, estado: "adjudicado" }) })).status, 401);
  const u = await req("/api/proyectos/" + p.id, { method: "PUT", body: JSON.stringify({ ...PROY, estado: "adjudicado" }), headers: { Authorization: "Bearer " + TOKEN } });
  assert.equal(u.status, 200); assert.equal((await u.json()).estado, "adjudicado");

  const guardado = JSON.parse(await readFile(join(dir, "p.json"), "utf8"));
  assert.equal(guardado[0].estado, "adjudicado");

  assert.equal((await req("/api/proyectos/" + p.id, { method: "DELETE" })).status, 401);
  assert.equal((await req("/api/proyectos/" + p.id, { method: "DELETE", headers: { Authorization: "Bearer " + TOKEN } })).status, 200);
  assert.equal((await req("/api/proyectos/" + p.id, { method: "DELETE", headers: { Authorization: "Bearer " + TOKEN } })).status, 404);
});

test("rechaza proyectos inválidos y JSON mal formado", async () => {
  const r = await req("/api/proyectos", { method: "POST", body: JSON.stringify({ ...PROY, lat: 10, region: "99", fondoId: "x" }) });
  assert.equal(r.status, 400);
  const d = await r.json(); assert.equal(d.detalles.length, 3);
  assert.equal((await req("/api/proyectos", { method: "POST", body: "{malo" })).status, 400);
});

test("cabeceras de seguridad", async () => {
  const r = await req("/");
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.match(r.headers.get("content-security-policy"), /default-src 'self'/);
});

test("core: estado estimado según la ventana de meses", () => {
  const f = { ventana: { desde: 3, hasta: 4 } };
  assert.equal(estadoFondo(f, new Date(2027, 2, 15)).estado, "abierto");
  assert.equal(estadoFondo(f, new Date(2027, 0, 15)).estado, "proximo");
  assert.equal(estadoFondo(f, new Date(2026, 9, 2)).estado, "cerrado");
  assert.equal(estadoFondo({ ventana: { desde: 11, hasta: 1 } }, new Date(2027, 0, 5)).estado, "abierto");
  assert.equal(estadoFondo({ ventana: null }).estado, "sin_fecha");
});

test("core: CSV neutraliza fórmulas", () => {
  const csv = aCSV([{ a: "=HYPERLINK(1)" }], [{ titulo: "A", valor: "a" }]);
  assert.ok(csv.includes("'=HYPERLINK(1)"));
});

test("core: búsqueda sin tildes", () => {
  const fs = [{ nombre: "Fondo del Patrimonio", institucion: "", resumen: "", notas: "", temas: [], beneficiarios: [], cobertura: "nacional" }];
  assert.equal(filtrarFondos(fs, { q: "patrimonio" }).length, 1);
  assert.equal(filtrarFondos([{ ...fs[0], nombre: "Educación" }], { q: "educacion" }).length, 1);
});

test("core: validación recorta y redondea", () => {
  const v = validarProyecto({ ...PROY, nombre: "  Hola mundo  ", monto: "1234.6" }, { regiones: [{ codigo: "06" }], fondos: [{ id: "fndr8" }] });
  assert.equal(v.ok, true); assert.equal(v.valor.nombre, "Hola mundo"); assert.equal(v.valor.monto, 1235);
});
