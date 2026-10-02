// Almacenamiento de proyectos en un archivo JSON. Las escrituras se serializan y son atómicas (tmp + rename).
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export async function crearStore(archivo) {
  let items = [];
  if (archivo) {
    try { const d = JSON.parse(await readFile(archivo, "utf8")); if (Array.isArray(d)) items = d; }
    catch (e) { if (e.code !== "ENOENT") throw e; }
  }
  let cola = Promise.resolve();
  const persistir = () => {
    if (!archivo) return Promise.resolve();
    const datos = JSON.stringify(items, null, 1);
    cola = cola.then(async () => {
      await mkdir(dirname(archivo), { recursive: true });
      const tmp = archivo + "." + process.pid + ".tmp";
      await writeFile(tmp, datos);
      await rename(tmp, archivo);
    });
    return cola;
  };
  return {
    listar: () => items.slice(),
    obtener: id => items.find(p => p.id === id) || null,
    async crear(valor) {
      const ahora = new Date().toISOString();
      const p = { id: randomUUID(), ...valor, creado: ahora, actualizado: ahora };
      items.push(p); await persistir(); return p;
    },
    async actualizar(id, valor) {
      const i = items.findIndex(p => p.id === id); if (i < 0) return null;
      items[i] = { ...items[i], ...valor, id, actualizado: new Date().toISOString() };
      await persistir(); return items[i];
    },
    async eliminar(id) {
      const i = items.findIndex(p => p.id === id); if (i < 0) return false;
      items.splice(i, 1); await persistir(); return true;
    }
  };
}
