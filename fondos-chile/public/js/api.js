// Acceso a datos. Usa la API Express si responde; si no (p. ej. GitHub Pages), lee los JSON estáticos
// y guarda los proyectos en este navegador. Con ?api=https://servidor se apunta a un backend remoto.
import { aGeoJSON, validarProyecto } from "./core.js";

const LS_KEY = "fondos-chile-proyectos-v1";
const base = (() => {
  try { const u = new URL(location.href).searchParams.get("api"); if (u && /^https?:\/\//.test(u)) return u.replace(/\/$/, "") + "/api/"; } catch (e) {}
  return "api/";
})();

async function json(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { "Content-Type": "application/json", ...(opts.headers || {}) } });
  if (r.status === 204) return null;
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(d.error || "Error " + r.status); e.status = r.status; e.detalles = d.detalles; throw e; }
  return d;
}

const leerLocal = () => { try { const d = JSON.parse(localStorage.getItem(LS_KEY) || "[]"); return Array.isArray(d) ? d : []; } catch (e) { return []; } };
const guardarLocal = ps => { try { localStorage.setItem(LS_KEY, JSON.stringify(ps)); } catch (e) {} };
const nuevoId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

export async function conectar() {
  let modo = "estatico";
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 3000);
    const h = await fetch(base + "health", { signal: ctl.signal }); clearTimeout(t);
    if (h.ok && (h.headers.get("content-type") || "").includes("json")) modo = "api";
  } catch (e) {}

  const [{ regiones }, catalogo] = await Promise.all([
    fetch("data/regiones.json").then(r => r.json()),
    fetch("data/fondos.json").then(r => r.json())
  ]);
  const ctx = { regiones, fondos: catalogo.fondos };

  // Capa opcional de polígonos regionales (GeoJSON con propiedad "codigo"). Ver README.
  let poligonos = null;
  try { const r = await fetch("data/regiones.geojson"); if (r.ok) poligonos = await r.json(); } catch (e) {}

  const api = {
    modo, regiones, fondos: catalogo.fondos, aviso: catalogo.aviso, actualizado: catalogo.actualizado, poligonos,
    async proyectos() {
      if (modo === "api") return (await json(base + "proyectos")).features.map(f => f.properties);
      return leerLocal();
    },
    async crearProyecto(datos) {
      if (modo === "api") return json(base + "proyectos", { method: "POST", body: JSON.stringify(datos) });
      const v = validarProyecto(datos, ctx);
      if (!v.ok) { const e = new Error("Datos inválidos."); e.detalles = v.errores; throw e; }
      const ahora = new Date().toISOString();
      const p = { id: nuevoId(), ...v.valor, creado: ahora, actualizado: ahora };
      const ps = leerLocal(); ps.push(p); guardarLocal(ps); return p;
    },
    async actualizarProyecto(id, datos, token) {
      if (modo === "api") return json(base + "proyectos/" + encodeURIComponent(id), { method: "PUT", body: JSON.stringify(datos), headers: token ? { Authorization: "Bearer " + token } : {} });
      const v = validarProyecto(datos, ctx);
      if (!v.ok) { const e = new Error("Datos inválidos."); e.detalles = v.errores; throw e; }
      const ps = leerLocal(), i = ps.findIndex(p => p.id === id);
      if (i < 0) throw new Error("Proyecto no encontrado.");
      ps[i] = { ...ps[i], ...v.valor, actualizado: new Date().toISOString() }; guardarLocal(ps); return ps[i];
    },
    async eliminarProyecto(id, token) {
      if (modo === "api") return json(base + "proyectos/" + encodeURIComponent(id), { method: "DELETE", headers: token ? { Authorization: "Bearer " + token } : {} });
      guardarLocal(leerLocal().filter(p => p.id !== id));
    },
    geojsonProyectos: ps => aGeoJSON(ps)
  };
  return api;
}
