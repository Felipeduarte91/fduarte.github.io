import express from "express";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { timingSafeEqual } from "node:crypto";
import {
  filtrarFondos, fondosDeRegion, indicadoresRegion, validarProyecto, estadoFondo,
  aGeoJSON, aCSV, COLUMNAS_FONDOS, TEMAS, TIPOS_ORG, ESTADOS_FONDO, ESTADOS_PROYECTO
} from "../public/js/core.js";
import { crearStore } from "./store.js";

export async function crearApp({ publicDir, storeFile = null, adminToken = "", allowOrigin = "", rateLimit = { max: 30, ventanaMs: 10 * 60 * 1000 } } = {}) {
  const leer = async f => JSON.parse(await readFile(join(publicDir, "data", f), "utf8"));
  const { regiones } = await leer("regiones.json");
  const catalogo = await leer("fondos.json");
  const fondos = catalogo.fondos;
  const store = await crearStore(storeFile);

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use((req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Content-Security-Policy": [
        "default-src 'self'", "script-src 'self' https://unpkg.com", "style-src 'self' 'unsafe-inline' https://unpkg.com",
        "img-src 'self' data: https:", "connect-src 'self'", "frame-ancestors 'none'", "base-uri 'self'"
      ].join("; ")
    });
    if (allowOrigin && req.path.startsWith("/api/")) {
      res.set({ "Access-Control-Allow-Origin": allowOrigin, "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS", "Access-Control-Allow-Headers": "Content-Type,Authorization", "Vary": "Origin" });
      if (req.method === "OPTIONS") return res.sendStatus(204);
    }
    next();
  });
  app.use("/api", express.json({ limit: "16kb" }));

  // Límite simple por IP para escrituras.
  const hits = new Map();
  const limitar = (req, res, next) => {
    const ahora = Date.now(), k = req.ip;
    const h = (hits.get(k) || []).filter(t => ahora - t < rateLimit.ventanaMs);
    if (h.length >= rateLimit.max) return res.status(429).json({ error: "Demasiadas solicitudes. Intente más tarde." });
    h.push(ahora); hits.set(k, h);
    if (hits.size > 5000) for (const [ip, ts] of hits) if (!ts.some(t => ahora - t < rateLimit.ventanaMs)) hits.delete(ip);
    next();
  };
  const esAdmin = req => {
    if (!adminToken) return false;
    const a = Buffer.from(String(req.get("authorization") || "").replace(/^Bearer\s+/i, "")), b = Buffer.from(adminToken);
    return a.length === b.length && timingSafeEqual(a, b);
  };
  // Sin ADMIN_TOKEN, editar y borrar queda abierto (modo local). Con token, solo el administrador.
  const soloAdmin = (req, res, next) => (!adminToken || esAdmin(req)) ? next() : res.status(401).json({ error: "Requiere token de administrador." });

  const filtrosDe = q => ({
    q: typeof q.q === "string" ? q.q.slice(0, 100) : "", tema: q.tema || "", tipo: q.tipo || "",
    region: q.region || "", estado: q.estado || "", cobertura: q.cobertura || ""
  });
  const conEstado = f => ({ ...f, estado_estimado: estadoFondo(f) });

  app.get("/api/health", (req, res) => res.json({ ok: true, fondos: fondos.length, regiones: regiones.length, proyectos: store.listar().length, escritura_protegida: !!adminToken }));

  app.get("/api/meta", (req, res) => res.json({ temas: TEMAS, tipos: TIPOS_ORG, estados_fondo: ESTADOS_FONDO, estados_proyecto: ESTADOS_PROYECTO, aviso: catalogo.aviso, actualizado: catalogo.actualizado }));

  app.get("/api/fondos", (req, res) => res.json(filtrarFondos(fondos, filtrosDe(req.query)).map(conEstado)));
  app.get("/api/fondos.csv", (req, res) => {
    res.type("text/csv; charset=utf-8").attachment("fondos.csv").send(aCSV(filtrarFondos(fondos, filtrosDe(req.query)), COLUMNAS_FONDOS));
  });
  app.get("/api/fondos/:id", (req, res) => {
    const f = fondos.find(x => x.id === req.params.id);
    if (!f) return res.status(404).json({ error: "Fondo no encontrado." });
    res.json(conEstado(f));
  });

  app.get("/api/regiones", (req, res) => res.json(aGeoJSON(regiones)));
  app.get("/api/regiones/:codigo/fondos", (req, res) => {
    if (!regiones.some(r => r.codigo === req.params.codigo)) return res.status(404).json({ error: "Región no encontrada." });
    res.json(filtrarFondos(fondosDeRegion(fondos, req.params.codigo), filtrosDe(req.query)).map(conEstado));
  });
  app.get("/api/indicadores", (req, res) => res.json(indicadoresRegion(regiones, fondos, store.listar(), filtrosDe(req.query))));

  app.get("/api/proyectos", (req, res) => {
    const { region, estado } = req.query;
    const ps = store.listar().filter(p => (!region || p.region === region) && (!estado || p.estado === estado));
    res.json(aGeoJSON(ps));
  });
  app.post("/api/proyectos", limitar, async (req, res, next) => {
    try {
      const v = validarProyecto(req.body, { regiones, fondos });
      if (!v.ok) return res.status(400).json({ error: "Datos inválidos.", detalles: v.errores });
      res.status(201).json(await store.crear(v.valor));
    } catch (e) { next(e); }
  });
  app.put("/api/proyectos/:id", limitar, soloAdmin, async (req, res, next) => {
    try {
      if (!store.obtener(req.params.id)) return res.status(404).json({ error: "Proyecto no encontrado." });
      const v = validarProyecto(req.body, { regiones, fondos });
      if (!v.ok) return res.status(400).json({ error: "Datos inválidos.", detalles: v.errores });
      res.json(await store.actualizar(req.params.id, v.valor));
    } catch (e) { next(e); }
  });
  app.delete("/api/proyectos/:id", limitar, soloAdmin, async (req, res, next) => {
    try { (await store.eliminar(req.params.id)) ? res.sendStatus(204) : res.status(404).json({ error: "Proyecto no encontrado." }); }
    catch (e) { next(e); }
  });

  app.use("/api", (req, res) => res.status(404).json({ error: "Ruta no encontrada." }));
  app.use(express.static(publicDir, { extensions: ["html"], maxAge: "1h" }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === "entity.parse.failed") return res.status(400).json({ error: "JSON inválido." });
    if (err.type === "entity.too.large") return res.status(413).json({ error: "Solicitud demasiado grande." });
    console.error(err);
    res.status(500).json({ error: "Error interno." });
  });
  return app;
}
