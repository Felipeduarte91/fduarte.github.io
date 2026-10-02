// Lógica de dominio sin DOM: la usan el servidor (Node) y el navegador (modo estático).

export const TEMAS = {
  social: "Desarrollo social", cultura: "Cultura y artes", patrimonio: "Patrimonio",
  deporte: "Deporte", seguridad: "Seguridad comunitaria", ambiente: "Medio ambiente",
  adultos_mayores: "Personas mayores", discapacidad: "Discapacidad e inclusión",
  juventud: "Juventudes", indigena: "Pueblos indígenas", fortalecimiento: "Fortalecimiento organizacional",
  equipamiento: "Equipamiento comunitario", comunicaciones: "Medios de comunicación",
  emprendimiento: "Emprendimiento", innovacion: "Innovación", investigacion: "Investigación"
};

export const TIPOS_ORG = {
  comunitaria: "Organización comunitaria / junta de vecinos", ong: "ONG, fundación o corporación",
  municipio: "Municipalidad", universidad: "Universidad o centro de investigación",
  indigena: "Comunidad o asociación indígena", medio: "Medio de comunicación",
  persona: "Persona natural", empresa: "Empresa"
};

export const ESTADOS_FONDO = { abierto: "Abierto", proximo: "Próximo", cerrado: "Cerrado", sin_fecha: "Sin fecha" };

export const ESTADOS_PROYECTO = { idea: "Idea", postulado: "Postulado", adjudicado: "Adjudicado", rechazado: "No adjudicado" };

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

const fechaLarga = iso => { const [y, m, d] = iso.split("-").map(Number); return d + " de " + MESES[m - 1] + " de " + y; };
const isoLocal = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");

// Estado del fondo. Si hay una convocatoria con fechas publicadas, manda; si ya pasó o no hay,
// se estima con la ventana típica de meses (1-12), que no es una fecha oficial.
export function estadoFondo(fondo, hoy = new Date()) {
  const c = fondo.convocatoria, h = isoLocal(hoy);
  if (c && c.cierra) {
    if ((!c.abre || c.abre <= h) && h <= c.cierra) return { estado: "abierto", exacto: true, texto: c.nombre + ": abierta hasta el " + fechaLarga(c.cierra) + "." };
    if (c.abre && h < c.abre) return { estado: "proximo", exacto: true, texto: c.nombre + ": abre el " + fechaLarga(c.abre) + "." };
  }
  const previa = c && c.cierra && h > c.cierra ? c.nombre + " cerró el " + fechaLarga(c.cierra) + ". " : "";
  const v = fondo.ventana;
  if ((!v || !v.desde || !v.hasta) && previa) return { estado: "cerrado", texto: previa + "Sin fecha estimada para la próxima." };
  if (!v || !v.desde || !v.hasta) return { estado: "sin_fecha", texto: "Sin fecha estimada: revise la institución." };
  const m = hoy.getMonth() + 1;
  const rango = MESES[v.desde - 1] + (v.desde === v.hasta ? "" : "–" + MESES[v.hasta - 1]);
  const dentro = v.desde <= v.hasta ? m >= v.desde && m <= v.hasta : m >= v.desde || m <= v.hasta;
  const est = previa ? "Estimado: la próxima suele abrir en " + rango + "." : "Estimado: suele abrir en " + rango + ".";
  if (dentro && !previa) return { estado: "abierto", texto: est + " Confirme que la convocatoria esté abierta." };
  const faltan = (v.desde - m + 12) % 12;
  if (faltan >= 1 && faltan <= 3) return { estado: "proximo", texto: previa + est + " (en ~" + faltan + (faltan === 1 ? " mes)." : " meses).") };
  return { estado: "cerrado", texto: previa + est };
}

// Fondos disponibles en una región: los nacionales y la versión regional de los fondos regionales.
export function fondosDeRegion(fondos, codigo) {
  return fondos.filter(f => f.cobertura === "nacional" || !f.regiones || f.regiones.includes(codigo));
}

const norm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function filtrarFondos(fondos, filtros = {}, hoy = new Date()) {
  const { q, tema, tipo, region, estado, cobertura } = filtros;
  const nq = norm(q).trim();
  let out = region ? fondosDeRegion(fondos, region) : fondos.slice();
  return out.filter(f =>
    (!tema || f.temas.includes(tema)) &&
    (!tipo || f.beneficiarios.includes(tipo)) &&
    (!cobertura || f.cobertura === cobertura) &&
    (!estado || estadoFondo(f, hoy).estado === estado) &&
    (!nq || norm([f.nombre, f.institucion, f.resumen, f.notas, ...f.temas.map(t => TEMAS[t])].join(" ")).includes(nq)));
}

// Indicadores por región para la capa temática.
export function indicadoresRegion(regiones, fondos, proyectos, filtros = {}, hoy = new Date()) {
  return regiones.map(r => {
    const fs = filtrarFondos(fondos, { ...filtros, region: r.codigo }, hoy);
    const ps = proyectos.filter(p => p.region === r.codigo);
    return {
      codigo: r.codigo,
      fondos: fs.length,
      fondos_regionales: fs.filter(f => f.cobertura === "regional").length,
      proyectos: ps.length,
      adjudicados: ps.filter(p => p.estado === "adjudicado").length,
      monto_adjudicado: ps.filter(p => p.estado === "adjudicado").reduce((a, p) => a + (p.monto || 0), 0),
      poblacion: r.poblacion,
      hab_por_proyecto: ps.length ? Math.round(r.poblacion / ps.length) : null
    };
  });
}

// Región más cercana a un punto, usando las capitales. Es una sugerencia que el usuario puede corregir.
export function regionSugerida(regiones, lat, lng) {
  let best = null, dmin = Infinity;
  for (const r of regiones) {
    const d = (r.lat - lat) ** 2 + ((r.lng - lng) * Math.cos(lat * Math.PI / 180)) ** 2;
    if (d < dmin) { dmin = d; best = r; }
  }
  return best;
}

// Validación de un proyecto registrado por el usuario. Devuelve el objeto limpio o la lista de errores.
export function validarProyecto(input, { regiones, fondos }) {
  const e = [], o = input && typeof input === "object" ? input : {};
  const str = (k, min, max) => {
    const v = typeof o[k] === "string" ? o[k].trim() : "";
    if (v.length < min) e.push(k + ": mínimo " + min + " caracteres.");
    if (v.length > max) e.push(k + ": máximo " + max + " caracteres.");
    return v.slice(0, max);
  };
  const p = {
    nombre: str("nombre", 3, 120),
    organizacion: str("organizacion", 0, 120),
    descripcion: str("descripcion", 0, 1000),
    region: String(o.region || ""),
    fondoId: String(o.fondoId || ""),
    estado: String(o.estado || "idea"),
    lat: Number(o.lat), lng: Number(o.lng),
    monto: o.monto === "" || o.monto == null ? null : Number(o.monto)
  };
  if (!regiones.some(r => r.codigo === p.region)) e.push("region: código de región inválido.");
  if (p.fondoId && !fondos.some(f => f.id === p.fondoId)) e.push("fondoId: fondo inexistente.");
  if (!ESTADOS_PROYECTO[p.estado]) e.push("estado: valor inválido.");
  // Caja de Chile continental, insular y Rapa Nui.
  if (!Number.isFinite(p.lat) || p.lat < -56.5 || p.lat > -17) e.push("lat: fuera de Chile.");
  if (!Number.isFinite(p.lng) || p.lng < -110 || p.lng > -66) e.push("lng: fuera de Chile.");
  if (p.monto !== null && (!Number.isFinite(p.monto) || p.monto < 0 || p.monto > 1e11)) e.push("monto: valor inválido.");
  if (p.monto !== null) p.monto = Math.round(p.monto);
  p.lat = Math.round(p.lat * 1e6) / 1e6; p.lng = Math.round(p.lng * 1e6) / 1e6;
  return e.length ? { ok: false, errores: e } : { ok: true, valor: p };
}

export function aGeoJSON(items, props = x => x) {
  return { type: "FeatureCollection", features: items.map(x => ({ type: "Feature", geometry: { type: "Point", coordinates: [x.lng, x.lat] }, properties: props(x) })) };
}

export function aCSV(filas, columnas) {
  const esc = v => {
    let s = v == null ? "" : Array.isArray(v) ? v.join("; ") : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // evita inyección de fórmulas en planillas
    return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return "﻿" + [columnas.map(c => esc(c.titulo)).join(","), ...filas.map(f => columnas.map(c => esc(typeof c.valor === "function" ? c.valor(f) : f[c.valor])).join(","))].join("\r\n");
}

export const COLUMNAS_FONDOS = [
  { titulo: "ID", valor: "id" }, { titulo: "Fondo", valor: "nombre" }, { titulo: "Institución", valor: "institucion" },
  { titulo: "Cobertura", valor: "cobertura" }, { titulo: "Temas", valor: f => f.temas.map(t => TEMAS[t] || t) },
  { titulo: "Beneficiarios", valor: f => f.beneficiarios.map(t => TIPOS_ORG[t] || t) },
  { titulo: "Monto máximo (CLP)", valor: "monto_max" }, { titulo: "Estado estimado", valor: f => ESTADOS_FONDO[estadoFondo(f).estado] },
  { titulo: "Sitio", valor: "url" }
];
