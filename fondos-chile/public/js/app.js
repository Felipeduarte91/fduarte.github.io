import { conectar } from "./api.js";
import {
  TEMAS, TIPOS_ORG, ESTADOS_FONDO, ESTADOS_PROYECTO, estadoFondo, filtrarFondos, fondosDeRegion,
  indicadoresRegion, regionSugerida, aCSV
} from "./core.js";

/* ---------------- utilidades ---------------- */
const $ = (s, r = document) => r.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(c));
  return n;
};
const put = (n, ...k) => n.append(...k.flat().filter(x => x != null && x !== false));
const clp = n => n == null ? "Según bases" : "$" + Math.round(n).toLocaleString("es-CL");
const num = n => n == null ? "–" : Number(n).toLocaleString("es-CL");
const cssVar = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const opciones = (obj, vacio, sel) => [el("option", { value: "", text: vacio }), ...Object.entries(obj).map(([k, t]) => el("option", { value: k, selected: sel === k, text: t }))];

const PREFS = "fondos-chile-ui-v1";
const DEF = { filtros: { q: "", tema: "", tipo: "", estado: "", cobertura: "" }, indicador: "poblacion", basemap: "topo",
  capas: { regiones: { visible: true, opacidad: 0.7 }, sedes: { visible: true }, proyectos: { visible: true, opacidad: 1 } },
  tablaTab: "fondos", tablaAbierta: true, tema: "" };
const st = (() => {
  let p = {};
  try { p = JSON.parse(localStorage.getItem(PREFS) || "{}") || {}; } catch (e) {}
  const capas = { ...DEF.capas };
  for (const k in capas) capas[k] = { ...capas[k], ...((p.capas || {})[k] || {}) };
  return { ...DEF, ...p, filtros: { ...DEF.filtros, ...(p.filtros || {}) }, capas,
    panel: null, sel: null, sort: {}, proyectos: [], herramienta: null, nuevo: null, editando: false, extension: false };
})();
let saveT;
const guardarPrefs = () => { clearTimeout(saveT); saveT = setTimeout(() => {
  const { filtros, indicador, basemap, capas, tablaTab, tablaAbierta, tema } = st;
  try { localStorage.setItem(PREFS, JSON.stringify({ filtros, indicador, basemap, capas, tablaTab, tablaAbierta, tema })); } catch (e) {}
}, 200); };

const toast = (msg, tipo = "info") => {
  const t = el("div", { class: "msg " + tipo, role: "status", style: "position:fixed;left:50%;bottom:40px;transform:translateX(-50%);z-index:3000;box-shadow:var(--shadow);max-width:90vw", text: msg });
  document.body.append(t); setTimeout(() => t.remove(), 3500);
};

/* ---------------- tema claro/oscuro ---------------- */
let listo = false;
const aplicarTema = () => { if (st.tema) document.documentElement.dataset.theme = st.tema; else delete document.documentElement.dataset.theme; };
aplicarTema();
$("#btn-tema").addEventListener("click", () => {
  const oscuro = st.tema ? st.tema === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  st.tema = oscuro ? "light" : "dark"; aplicarTema(); guardarPrefs(); if (listo) refrescar();
});

/* ---------------- arranque ---------------- */
if (!window.L) {
  $("#map").append(el("div", { class: "msg err", style: "margin:16px", text: "No se pudo cargar la biblioteca de mapas (Leaflet). Revise su conexión y recargue." }));
  throw new Error("Leaflet no disponible");
}
let api;
try { api = await conectar(); }
catch (e) {
  $("#map").append(el("div", { class: "msg err", style: "margin:16px", text: "No se pudieron cargar los datos de fondos y regiones." }));
  throw e;
}
const REG = Object.fromEntries(api.regiones.map(r => [r.codigo, r]));
const FON = Object.fromEntries(api.fondos.map(f => [f.id, f]));
const modo = $("#modo");
modo.textContent = api.modo === "api" ? "API conectada" : "Modo estático";
modo.className = "chip " + api.modo;
modo.title = api.modo === "api" ? "Datos y proyectos servidos por el backend." : "Sin servidor: los proyectos se guardan solo en este navegador.";

/* ---------------- mapa ---------------- */
const CHILE = L.latLngBounds([-56, -76.5], [-17.4, -66.3]);
const map = L.map("map", { zoomControl: false, minZoom: 3, maxZoom: 18 }).fitBounds(CHILE);
L.control.zoom({ position: "topright", zoomInTitle: "Acercar", zoomOutTitle: "Alejar" }).addTo(map);
L.control.scale({ position: "bottomright", imperial: false }).addTo(map);
map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
["regiones", "sedes", "proyectos", "edicion"].forEach((p, i) => { map.createPane(p).style.zIndex = 410 + i * 10; });

const BASEMAPS = {
  topo: { nombre: "Topográfico", url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}", thumb: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/4/9/4", attr: "Tiles © Esri — Esri, HERE, Garmin, FAO, NOAA, USGS, © OpenStreetMap" },
  imagen: { nombre: "Imágenes", url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", thumb: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/4/9/4", attr: "Tiles © Esri — Esri, Maxar, Earthstar Geographics, GIS User Community" },
  gris: { nombre: "Gris claro", url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", thumb: "https://a.basemaps.cartocdn.com/light_all/4/4/9.png", attr: "© OpenStreetMap © CARTO", sub: "abcd" },
  oscuro: { nombre: "Gris oscuro", url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", thumb: "https://a.basemaps.cartocdn.com/dark_all/4/4/9.png", attr: "© OpenStreetMap © CARTO", sub: "abcd" },
  osm: { nombre: "OpenStreetMap", url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", thumb: "https://tile.openstreetmap.org/4/4/9.png", attr: "© OpenStreetMap" }
};
if (!BASEMAPS[st.basemap]) st.basemap = "topo";
let baseLayer = null;
function ponerBasemap(k) {
  if (baseLayer) map.removeLayer(baseLayer);
  const b = BASEMAPS[k];
  baseLayer = L.tileLayer(b.url, { attribution: b.attr, subdomains: b.sub || "abc", maxZoom: 19 }).addTo(map);
  st.basemap = k; guardarPrefs();
}
ponerBasemap(st.basemap);

// Botones de vista inicial y ubicación, junto al zoom.
const Herramientas = L.Control.extend({
  options: { position: "topright" },
  onAdd() {
    const d = L.DomUtil.create("div", "leaflet-bar");
    d.append(
      el("button", { type: "button", title: "Vista inicial", "aria-label": "Vista inicial", onclick: () => map.fitBounds(CHILE) },
        svgIcon("M3 11 12 3l9 8M5 9.5V21h5v-6h4v6h5V9.5")),
      el("button", { type: "button", title: "Mi ubicación", "aria-label": "Mi ubicación", onclick: () => map.locate({ setView: true, maxZoom: 11 }) },
        svgIcon("M12 2v4M12 18v4M2 12h4M18 12h4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z")));
    L.DomEvent.disableClickPropagation(d);
    return d;
  }
});
function svgIcon(d) {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg"); s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("aria-hidden", "true");
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path"); p.setAttribute("d", d); p.setAttribute("fill", "none"); p.setAttribute("stroke", "currentColor"); p.setAttribute("stroke-width", "2"); p.setAttribute("stroke-linejoin", "round");
  s.append(p); return s;
}
new Herramientas().addTo(map);
const ubicacion = L.layerGroup().addTo(map);
map.on("locationfound", e => { ubicacion.clearLayers(); L.circle(e.latlng, { radius: e.accuracy, weight: 1, color: cssVar("--brand"), fillOpacity: .1 }).addTo(ubicacion); });
map.on("locationerror", () => toast("No se pudo obtener su ubicación.", "warn"));
map.on("mousemove", e => { $("#coords").textContent = "Lat " + e.latlng.lat.toFixed(4) + ", Lng " + e.latlng.lng.toFixed(4); });
map.on("moveend", () => { if (st.extension) renderTabla(); });

const capaRegiones = L.layerGroup().addTo(map);
const capaSedes = L.layerGroup().addTo(map);
const capaProyectos = L.layerGroup().addTo(map);
const capaEdicion = L.layerGroup().addTo(map);

/* ---------------- capa temática por región ---------------- */
const INDICADORES = {
  fondos: { nombre: "Fondos disponibles (según filtros)", fmt: num },
  proyectos: { nombre: "Proyectos registrados", fmt: num },
  monto_adjudicado: { nombre: "Monto adjudicado registrado (CLP)", fmt: n => "$" + num(n) },
  poblacion: { nombre: "Población (Censo 2017)", fmt: num },
  hab_por_proyecto: { nombre: "Habitantes por proyecto registrado", fmt: num }
};
if (!INDICADORES[st.indicador]) st.indicador = "poblacion";
let indic = [];

// Cortes de intervalo igual en 5 clases; si todos los valores son iguales, una sola clase.
function clases(valores) {
  const vs = valores.filter(v => v != null);
  if (!vs.length) return [];
  const min = Math.min(...vs), max = Math.max(...vs);
  if (min === max) return [{ desde: min, hasta: max, color: "--seq-3" }];
  // Pocos enteros distintos: una clase por valor, repartidas en la rampa.
  if (vs.every(Number.isInteger) && max - min < 5) {
    const n = max - min + 1, pasos = [[3], [1, 5], [1, 3, 5], [1, 2, 4, 5], [1, 2, 3, 4, 5]][n - 1];
    return pasos.map((s, i) => ({ desde: min + i, hasta: min + i, color: "--seq-" + s }));
  }
  const paso = (max - min) / 5;
  return [1, 2, 3, 4, 5].map(i => ({ desde: min + paso * (i - 1), hasta: i === 5 ? max : min + paso * i, color: "--seq-" + i }));
}
const claseDe = (cs, v) => v == null ? null : cs.find((c, i) => v <= c.hasta || i === cs.length - 1);

const escalaZoom = () => Math.min(1, Math.max(0.4, (map.getZoom() - 2.5) / 4));
map.on("zoomend", () => { if (!api.poligonos) renderRegiones(); });
function renderRegiones() {
  capaRegiones.clearLayers(); capaSedes.clearLayers();
  indic = indicadoresRegion(api.regiones, api.fondos, st.proyectos, st.filtros);
  const porCod = Object.fromEntries(indic.map(x => [x.codigo, x]));
  const cs = clases(indic.map(x => x[st.indicador]));
  const max = Math.max(1, ...indic.map(x => x[st.indicador] || 0));
  const ring = cssVar("--ring"), brand = cssVar("--brand"), sinDato = cssVar("--line-strong");
  const op = st.capas.regiones.opacidad;
  const tip = r => {
    const v = porCod[r.codigo][st.indicador];
    return el("div", {}, el("b", { text: r.nombre }), INDICADORES[st.indicador].nombre + ": " + (v == null ? "sin datos" : INDICADORES[st.indicador].fmt(v)));
  };
  const estilo = r => {
    const c = claseDe(cs, porCod[r.codigo][st.indicador]);
    const sel = st.sel && st.sel.tipo === "region" && st.sel.id === r.codigo;
    return { fillColor: c ? cssVar(c.color) : sinDato, fillOpacity: op, color: sel ? brand : ring, weight: sel ? 3 : 2, opacity: Math.max(op, .6) };
  };
  if (st.capas.regiones.visible) {
    if (api.poligonos) {
      L.geoJSON(api.poligonos, {
        pane: "regiones",
        attribution: 'Límites: <a href="https://www.geoboundaries.org" target="_blank" rel="noopener">geoBoundaries</a> (BCN, OCHA) CC BY 3.0 IGO',
        filter: f => !!REG[String(f.properties.codigo).padStart(2, "0")],
        style: f => { const s = estilo(REG[String(f.properties.codigo).padStart(2, "0")]); return { ...s, weight: s.weight === 3 ? 3 : 1 }; },
        onEachFeature: (f, ly) => { const r = REG[String(f.properties.codigo).padStart(2, "0")]; ly.bindTooltip(tip(r), { sticky: true }); ly.on("click", () => { if (!st.herramienta) seleccionar("region", r.codigo); }); }
      }).addTo(capaRegiones).eachLayer(ly => { if (st.sel && st.sel.tipo === "region" && String(ly.feature.properties.codigo).padStart(2, "0") === st.sel.id) ly.bringToFront(); });
    } else {
      // Sin polígonos: símbolos proporcionales en la capital (área ∝ valor).
      [...api.regiones].sort((a, b) => (porCod[b.codigo][st.indicador] || 0) - (porCod[a.codigo][st.indicador] || 0)).forEach(r => {
        const v = porCod[r.codigo][st.indicador];
        const radio = (v == null ? 5 : 5 + 20 * Math.sqrt(Math.max(0, v) / max)) * escalaZoom();
        L.circleMarker([r.lat, r.lng], { pane: "regiones", radius: radio, ...estilo(r) })
          .bindTooltip(tip(r), { direction: "top", offset: [0, -radio] })
          .on("click", () => { if (!st.herramienta) seleccionar("region", r.codigo); }).addTo(capaRegiones);
      });
    }
  }
  if (st.capas.sedes.visible) api.regiones.forEach(r => {
    L.marker([r.lat, r.lng], { pane: "sedes", keyboard: false, icon: L.divIcon({ className: "sede-icon", iconSize: [10, 10] }) })
      .bindTooltip(el("div", {}, el("b", { text: "Gobierno Regional" }), r.nombre + " · " + r.capital), { direction: "top", offset: [0, -6] })
      .on("click", () => seleccionar("region", r.codigo)).addTo(capaSedes);
  });
  st.clases = cs;
}

function renderProyectos() {
  capaProyectos.clearLayers();
  if (!st.capas.proyectos.visible) return;
  const ring = cssVar("--ring"), brand = cssVar("--brand"), op = st.capas.proyectos.opacidad;
  st.proyectos.forEach(p => {
    const sel = st.sel && st.sel.tipo === "proyecto" && st.sel.id === p.id;
    L.circleMarker([p.lat, p.lng], { pane: "proyectos", radius: sel ? 9 : 7, fillColor: cssVar("--p-" + p.estado), fillOpacity: op, color: sel ? brand : ring, weight: sel ? 3 : 2, opacity: op })
      .bindTooltip(el("div", {}, el("b", { text: p.nombre }), ESTADOS_PROYECTO[p.estado] + (p.fondoId && FON[p.fondoId] ? " · " + FON[p.fondoId].nombre : "")), { direction: "top", offset: [0, -8] })
      .on("click", () => { if (!st.herramienta) seleccionar("proyecto", p.id); }).addTo(capaProyectos);
  });
}

/* ---------------- selección y panel de detalle ---------------- */
function seleccionar(tipo, id, { zoom = false } = {}) {
  st.sel = { tipo, id }; st.editando = false;
  if (zoom) {
    if (tipo === "region") map.flyTo([REG[id].lat, REG[id].lng], 7, { duration: .6 });
    if (tipo === "proyecto") { const p = st.proyectos.find(x => x.id === id); if (p) map.flyTo([p.lat, p.lng], Math.max(map.getZoom(), 10), { duration: .6 }); }
  }
  if (tipo === "fondo" && st.tablaTab !== "fondos") st.tablaTab = "fondos";
  renderRegiones(); renderProyectos(); renderDetalle(); renderTabla();
}
$("#detail-cerrar").addEventListener("click", () => { st.sel = null; st.editando = false; capaEdicion.clearLayers(); renderRegiones(); renderProyectos(); renderDetalle(); renderTabla(); });

const tagEstado = f => { const e = estadoFondo(f); return el("span", { class: "tag " + e.estado, text: ESTADOS_FONDO[e.estado] }); };
const tagCob = f => el("span", { class: "tag" + (f.cobertura === "regional" ? " regional" : ""), text: f.cobertura === "regional" ? "Regional" : "Nacional" });
const kv = pares => el("dl", { class: "kv" }, pares.map(([k, v]) => el("div", {}, el("dt", { text: k }), el("dd", {}, v))));

function renderDetalle() {
  const box = $("#detail"), body = $("#detail-body");
  if (!st.sel) { box.hidden = true; return; }
  if (st.editando) return;
  body.textContent = ""; box.hidden = false;
  const { tipo, id } = st.sel;
  if (tipo === "region") {
    const r = REG[id], ind = indic.find(x => x.codigo === id) || {};
    const fs = filtrarFondos(fondosDeRegion(api.fondos, id), st.filtros);
    const ps = st.proyectos.filter(p => p.region === id);
    $("#detail-titulo").textContent = "Región de " + r.nombre;
    put(body,
      kv([["Capital", r.capital], ["Población (2017)", num(r.poblacion)], ["Fondos (filtros)", num(fs.length)], ["Proyectos", num(ps.length)], ["Adjudicados", num(ind.adjudicados)], ["Monto adjudicado", "$" + num(ind.monto_adjudicado)]]),
      el("div", { class: "row", style: "margin-bottom:14px" },
        el("button", { type: "button", class: "btn small", text: "Acercar a la región", onclick: () => map.flyTo([r.lat, r.lng], 7, { duration: .6 }) }),
        el("button", { type: "button", class: "btn small ghost", text: "Agregar proyecto aquí", onclick: () => iniciarNuevo({ lat: r.lat, lng: r.lng }, r.codigo) })),
      el("p", { class: "msg info", text: "Los fondos regionales (FNDR 8%, FIC-R) los administra el Gobierno Regional de " + r.nombre + ": líneas, montos y fechas propias." }),
      el("div", { class: "block" }, el("h3", { text: "Fondos disponibles" }),
        fs.length ? el("ul", { class: "list" }, fs.map(f => el("li", {}, el("button", { type: "button", onclick: () => seleccionar("fondo", f.id) },
          el("span", {}, f.nombre, el("br"), el("small", { text: f.institucion })), el("span", { class: "row", style: "gap:4px;flex-wrap:nowrap" }, tagCob(f)))))) : el("p", { class: "muted", text: "Ningún fondo coincide con los filtros." })),
      ps.length ? el("div", { class: "block" }, el("h3", { text: "Proyectos registrados" }), listaProyectos(ps)) : null);
  } else if (tipo === "fondo") {
    const f = FON[id]; const e = estadoFondo(f);
    const ps = st.proyectos.filter(p => p.fondoId === id);
    $("#detail-titulo").textContent = f.nombre;
    put(body,
      el("p", { class: "muted", style: "margin-top:0", text: f.institucion }),
      el("div", { class: "row", style: "margin-bottom:10px" }, tagCob(f), tagEstado(f)),
      el("p", { text: f.resumen }),
      kv([[f.monto_min ? "Monto" : "Monto máximo", f.monto_min ? clp(f.monto_min) + " a " + clp(f.monto_max) : clp(f.monto_max)], ["Cobertura", f.cobertura === "regional" ? "Cada región (16 GORE)" : "Todo el país"]]),
      el("p", { class: "msg " + (e.estado === "abierto" ? "ok" : "info") }, el("b", { text: "Calendario: " }), e.texto),
      el("div", { class: "block" }, el("h3", { text: "Quiénes postulan" }), el("div", { class: "pills" }, f.beneficiarios.map(b => el("span", { class: "pill", text: TIPOS_ORG[b] || b })))),
      el("div", { class: "block" }, el("h3", { text: "Temas" }), el("div", { class: "pills" }, f.temas.map(t => el("span", { class: "pill", text: TEMAS[t] || t })))),
      f.requisitos.length ? el("div", { class: "block" }, el("h3", { text: "Requisitos frecuentes" }), el("ul", { class: "req" }, f.requisitos.map(r => el("li", { text: r })))) : null,
      f.notas ? el("p", { class: "msg warn", text: f.notas }) : null,
      f.url ? el("p", {}, el("a", { href: f.url, target: "_blank", rel: "noopener noreferrer", text: "Sitio del fondo o institución ↗" })) : null,
      f.fuentes && f.fuentes.length ? el("div", { class: "block" }, el("h3", { text: "Fuentes" }), el("ul", { class: "req" }, f.fuentes.map(s => el("li", {}, /^https?:\/\//.test(s) ? el("a", { href: s, target: "_blank", rel: "noopener noreferrer", text: new URL(s).hostname.replace(/^www\./, "") }) : s)))) : null,
      ps.length ? el("div", { class: "block" }, el("h3", { text: "Proyectos registrados con este fondo" }), listaProyectos(ps)) : null);
  } else if (tipo === "proyecto") {
    const p = st.proyectos.find(x => x.id === id);
    if (!p) { st.sel = null; box.hidden = true; return; }
    $("#detail-titulo").textContent = p.nombre;
    put(body,
      el("div", { class: "row", style: "margin-bottom:10px" }, el("span", { class: "sw dot", style: "background:var(--p-" + p.estado + ")" }), el("b", { text: ESTADOS_PROYECTO[p.estado] })),
      kv([["Organización", p.organizacion || "–"], ["Región", REG[p.region] ? REG[p.region].nombre : "–"], ["Fondo", p.fondoId && FON[p.fondoId] ? FON[p.fondoId].nombre : "Sin definir"], ["Monto", p.monto == null ? "–" : "$" + num(p.monto)], ["Coordenadas", p.lat.toFixed(4) + ", " + p.lng.toFixed(4)], ["Actualizado", p.actualizado ? new Date(p.actualizado).toLocaleDateString("es-CL") : "–"]]),
      p.descripcion ? el("p", { style: "white-space:pre-wrap", text: p.descripcion }) : null,
      el("div", { class: "row" },
        el("button", { type: "button", class: "btn small", text: "Editar", onclick: () => editarProyecto(p) }),
        el("button", { type: "button", class: "btn small danger", text: "Eliminar", onclick: () => eliminarProyecto(p) }),
        p.fondoId && FON[p.fondoId] ? el("button", { type: "button", class: "btn small ghost", text: "Ver fondo", onclick: () => seleccionar("fondo", p.fondoId) }) : null));
  }
}
const listaProyectos = ps => el("ul", { class: "list" }, ps.map(p => el("li", {}, el("button", { type: "button", onclick: () => seleccionar("proyecto", p.id, { zoom: true }) },
  el("span", {}, p.nombre, el("br"), el("small", { text: p.organizacion || "" })), el("small", { text: ESTADOS_PROYECTO[p.estado] })))));

/* ---------------- proyectos: crear, editar, eliminar ---------------- */
let token = ""; try { token = sessionStorage.getItem("fondos-chile-token") || ""; } catch (e) {}
async function conToken(fn) {
  try { return await fn(token); }
  catch (e) {
    if (e.status !== 401) throw e;
    const t = prompt("Esta acción requiere el token de administrador del servidor:");
    if (!t) throw new Error("Acción cancelada.");
    token = t; try { sessionStorage.setItem("fondos-chile-token", t); } catch (er) {}
    return fn(token);
  }
}
async function recargarProyectos() {
  try { st.proyectos = await api.proyectos(); }
  catch (e) { st.proyectos = []; toast("No se pudieron cargar los proyectos: " + e.message, "err"); }
}

function formProyecto(inicial, { onGuardar, onCancelar, alMoverRegion }) {
  const errores = el("div");
  const sugerida = inicial.region || (regionSugerida(api.regiones, inicial.lat, inicial.lng) || {}).codigo;
  const selRegion = el("select", { name: "region", required: true }, api.regiones.map(r => el("option", { value: r.codigo, selected: r.codigo === sugerida, text: r.nombre })));
  const selFondo = el("select", { name: "fondoId" });
  const llenarFondos = () => {
    const actual = selFondo.value || inicial.fondoId || "";
    selFondo.replaceChildren(el("option", { value: "", text: "Sin definir" }), ...fondosDeRegion(api.fondos, selRegion.value).map(f => el("option", { value: f.id, selected: f.id === actual, text: f.nombre })));
  };
  selRegion.addEventListener("change", () => { llenarFondos(); alMoverRegion && alMoverRegion(selRegion.value); });
  llenarFondos();
  const lat = el("input", { type: "number", name: "lat", step: "any", value: inicial.lat, required: true });
  const lng = el("input", { type: "number", name: "lng", step: "any", value: inicial.lng, required: true });
  const f = el("form", { novalidate: true },
    el("p", { class: "msg warn", text: "No incluya nombres, RUT ni direcciones de personas: este registro puede ser visible para otros usuarios del servidor." }),
    el("label", { class: "field" }, el("span", { text: "Nombre del proyecto" }), el("input", { type: "text", name: "nombre", required: true, maxlength: 120, value: inicial.nombre || "" })),
    el("label", { class: "field" }, el("span", { text: "Organización" }), el("input", { type: "text", name: "organizacion", maxlength: 120, value: inicial.organizacion || "" })),
    el("label", { class: "field" }, el("span", { text: "Región" }), selRegion, el("small", { text: "Sugerida según la ubicación; corríjala si no corresponde." })),
    el("label", { class: "field" }, el("span", { text: "Fondo" }), selFondo),
    el("label", { class: "field" }, el("span", { text: "Estado" }), el("select", { name: "estado" }, Object.entries(ESTADOS_PROYECTO).map(([k, t]) => el("option", { value: k, selected: (inicial.estado || "idea") === k, text: t })))),
    el("label", { class: "field" }, el("span", { text: "Monto (CLP)" }), el("input", { type: "number", name: "monto", min: 0, step: 1000, value: inicial.monto ?? "" })),
    el("label", { class: "field" }, el("span", { text: "Descripción" }), el("textarea", { name: "descripcion", maxlength: 1000 }, inicial.descripcion || "")),
    el("div", { class: "row", style: "margin-bottom:12px" }, el("label", { class: "field", style: "flex:1;margin:0" }, el("span", { text: "Latitud" }), lat), el("label", { class: "field", style: "flex:1;margin:0" }, el("span", { text: "Longitud" }), lng)),
    errores,
    el("div", { class: "row" }, el("button", { type: "submit", class: "btn", text: "Guardar" }), el("button", { type: "button", class: "btn ghost", text: "Cancelar", onclick: onCancelar })));
  f.addEventListener("submit", async ev => {
    ev.preventDefault();
    const d = Object.fromEntries(new FormData(f));
    const btn = f.querySelector("[type=submit]"); btn.disabled = true; errores.textContent = "";
    try { await onGuardar(d); }
    catch (e) { errores.append(el("div", { class: "msg err" }, e.message, e.detalles ? el("ul", { class: "req" }, e.detalles.map(x => el("li", { text: x }))) : null)); }
    finally { btn.disabled = false; }
  });
  f.setCoords = (la, ln) => { lat.value = la.toFixed(6); lng.value = ln.toFixed(6); };
  return f;
}

function marcadorEdicion(latlng, onMover) {
  capaEdicion.clearLayers();
  const m = L.marker(latlng, { pane: "edicion", draggable: true, icon: L.divIcon({ className: "edit-icon", iconSize: [18, 18] }), title: "Arrastre para ajustar" }).addTo(capaEdicion);
  m.on("dragend", () => { const p = m.getLatLng(); onMover(p.lat, p.lng); });
  return m;
}

function activarHerramienta(on) {
  st.herramienta = on ? "agregar" : null;
  document.body.classList.toggle("map-adding", on);
  const h = $("#tool-hint");
  h.hidden = !on; h.textContent = "";
  if (on) h.append("Haga clic en el mapa para ubicar el proyecto", el("button", { type: "button", text: "Cancelar", onclick: () => activarHerramienta(false) }));
}
map.on("click", e => { if (st.herramienta === "agregar") { activarHerramienta(false); iniciarNuevo(e.latlng); } });
document.addEventListener("keydown", e => { if (e.key === "Escape" && st.herramienta) activarHerramienta(false); });

function iniciarNuevo(latlng, region) {
  st.nuevo = { lat: latlng.lat, lng: latlng.lng, region };
  abrirPanel("proyecto", true);
}

function editarProyecto(p) {
  st.editando = true;
  const body = $("#detail-body"); body.textContent = "";
  $("#detail-titulo").textContent = "Editar proyecto";
  let form;
  marcadorEdicion([p.lat, p.lng], (la, ln) => form.setCoords(la, ln));
  form = formProyecto(p, {
    onGuardar: async d => {
      await conToken(t => api.actualizarProyecto(p.id, d, t));
      capaEdicion.clearLayers(); st.editando = false;
      await recargarProyectos(); refrescar(); toast("Proyecto actualizado.", "ok");
    },
    onCancelar: () => { capaEdicion.clearLayers(); st.editando = false; renderDetalle(); }
  });
  body.append(form);
}

async function eliminarProyecto(p) {
  if (!confirm("¿Eliminar el proyecto «" + p.nombre + "»? Esta acción no se puede deshacer.")) return;
  try {
    await conToken(t => api.eliminarProyecto(p.id, t));
    st.sel = null; await recargarProyectos(); refrescar(); toast("Proyecto eliminado.", "ok");
  } catch (e) { toast(e.message, "err"); }
}

/* ---------------- paneles de widgets ---------------- */
const TITULOS = { capas: "Capas", filtros: "Filtros", leyenda: "Leyenda", basemap: "Galería de mapas base", proyecto: "Agregar proyecto", acerca: "Acerca de" };
document.querySelectorAll(".rail button").forEach(b => b.addEventListener("click", () => abrirPanel(b.dataset.panel)));
$("#panel-cerrar").addEventListener("click", () => abrirPanel(null));

function abrirPanel(nombre, forzar = false) {
  if (!forzar && st.panel === nombre) nombre = null;
  if (st.panel === "proyecto" && nombre !== "proyecto") { st.nuevo = null; capaEdicion.clearLayers(); activarHerramienta(false); }
  st.panel = nombre;
  document.querySelectorAll(".rail button").forEach(b => b.setAttribute("aria-pressed", b.dataset.panel === nombre));
  $("#panel").hidden = !nombre;
  renderPanel();
  setTimeout(() => map.invalidateSize(), 0);
}

function renderPanel() {
  const n = st.panel; if (!n) return;
  $("#panel-titulo").textContent = TITULOS[n];
  const body = $("#panel-body"); body.textContent = "";
  ({ capas: panelCapas, filtros: panelFiltros, leyenda: panelLeyenda, basemap: panelBasemap, proyecto: panelProyecto, acerca: panelAcerca })[n](body);
}

function capaItem(clave, titulo, extra) {
  const c = st.capas[clave];
  return el("div", { class: "layer" },
    el("div", { class: "layer-top" }, el("label", {}, el("input", { type: "checkbox", checked: c.visible, onchange: e => { c.visible = e.target.checked; guardarPrefs(); refrescarMapa(); } }), titulo)),
    el("div", { class: "layer-opts" }, extra,
      c.opacidad != null ? el("label", {}, "Opacidad", el("input", { type: "range", min: .1, max: 1, step: .05, value: c.opacidad, oninput: e => { c.opacidad = Number(e.target.value); guardarPrefs(); refrescarMapa(); } })) : null));
}
function panelCapas(body) {
  put(body,
    capaItem("proyectos", "Proyectos registrados", el("span", { class: "note", text: api.modo === "api" ? "Compartidos en el servidor." : "Guardados en este navegador." })),
    capaItem("sedes", "Sedes de Gobiernos Regionales", null),
    capaItem("regiones", api.poligonos ? "Regiones · coropletas" : "Regiones · símbolos proporcionales",
      el("label", {}, "Indicador", el("select", { onchange: e => { st.indicador = e.target.value; guardarPrefs(); refrescar(); } },
        Object.entries(INDICADORES).map(([k, i]) => el("option", { value: k, selected: st.indicador === k, text: i.nombre }))))),
    el("p", { class: "note", text: "Mapa base: " + BASEMAPS[st.basemap].nombre + ". Cámbielo en la galería." }));
}

function panelFiltros(body) {
  const f = st.filtros;
  const upd = k => e => { f[k] = e.target.value; guardarPrefs(); refrescar(); };
  const resumen = el("p", { class: "note", id: "filtro-resumen" });
  put(body,
    el("label", { class: "field" }, el("span", { text: "Palabra clave" }), el("input", { type: "search", value: f.q, placeholder: "p. ej., cuidadoras, agua, radio", oninput: upd("q") })),
    el("label", { class: "field" }, el("span", { text: "Tema" }), el("select", { onchange: upd("tema") }, opciones(TEMAS, "Todos los temas", f.tema))),
    el("label", { class: "field" }, el("span", { text: "Tipo de organización que postula" }), el("select", { onchange: upd("tipo") }, opciones(TIPOS_ORG, "Cualquiera", f.tipo))),
    el("label", { class: "field" }, el("span", { text: "Cobertura" }), el("select", { onchange: upd("cobertura") }, opciones({ nacional: "Nacional", regional: "Regional (GORE)" }, "Todas", f.cobertura))),
    el("label", { class: "field" }, el("span", { text: "Estado estimado" }), el("select", { onchange: upd("estado") }, opciones(ESTADOS_FONDO, "Todos", f.estado))),
    el("div", { class: "row" }, el("button", { type: "button", class: "btn ghost", text: "Limpiar filtros", onclick: () => { st.filtros = { ...DEF.filtros }; guardarPrefs(); refrescar(); renderPanel(); } })),
    resumen,
    el("p", { class: "note", text: "Los filtros actúan sobre la tabla de fondos, el detalle de cada región y el indicador «Fondos disponibles». El estado es una estimación según el calendario típico." }));
  actualizarResumenFiltros();
}
function actualizarResumenFiltros() {
  const n = filtrarFondos(api.fondos, st.filtros).length;
  const r = $("#filtro-resumen"); if (r) r.textContent = n + " de " + api.fondos.length + " fondos coinciden.";
  const act = Object.entries(st.filtros).filter(([, v]) => v).length;
  $("#estado-filtros").textContent = act ? act + (act === 1 ? " filtro activo" : " filtros activos") + " · " + n + " fondos" : "Sin filtros · " + n + " fondos";
}

function panelLeyenda(body) {
  const cs = st.clases || [], ind = INDICADORES[st.indicador];
  if (st.capas.regiones.visible) body.append(el("div", { class: "block" },
    el("p", { class: "legend-title", text: "Regiones · " + ind.nombre }),
    cs.length === 1 ? el("div", { class: "legend-item" }, el("span", { class: "sw", style: "background:var(" + cs[0].color + ")" }), ind.fmt(cs[0].desde) + " en todas las regiones")
      : cs.map(c => el("div", { class: "legend-item" }, el("span", { class: "sw", style: "background:var(" + c.color + ")" }), c.desde === c.hasta ? ind.fmt(c.desde) : ind.fmt(Math.round(c.desde)) + " – " + ind.fmt(Math.round(c.hasta)))),
    indic.some(x => x[st.indicador] == null) ? el("div", { class: "legend-item" }, el("span", { class: "sw", style: "background:var(--line-strong)" }), "Sin datos") : null,
    api.poligonos ? null : el("p", { class: "note", text: "El tamaño del círculo también es proporcional al valor." })));
  if (st.capas.proyectos.visible) body.append(el("div", { class: "block" },
    el("p", { class: "legend-title", text: "Proyectos por estado" }),
    Object.entries(ESTADOS_PROYECTO).map(([k, t]) => el("div", { class: "legend-item" }, el("span", { class: "sw dot", style: "background:var(--p-" + k + ")" }), t + " (" + st.proyectos.filter(p => p.estado === k).length + ")"))));
  if (st.capas.sedes.visible) body.append(el("div", { class: "block" }, el("div", { class: "legend-item" }, el("span", { class: "sw sq" }), "Sede del Gobierno Regional (capital)")));
  if (!body.childElementCount) body.append(el("p", { class: "muted", text: "No hay capas visibles." }));
}

function panelBasemap(body) {
  body.append(el("div", { class: "gallery" }, Object.entries(BASEMAPS).map(([k, b]) =>
    el("button", { type: "button", "aria-pressed": st.basemap === k, onclick: () => { ponerBasemap(k); renderPanel(); } },
      el("img", { src: b.thumb, alt: "", loading: "lazy" }), el("span", { text: b.nombre })))));
}

function panelProyecto(body) {
  if (!st.nuevo) {
    put(body,
      el("p", { text: "Registre la ubicación de un proyecto de su organización para verlo en el mapa junto a los fondos de su región." }),
      el("button", { type: "button", class: "btn", text: "Elegir ubicación en el mapa", onclick: () => activarHerramienta(true) }),
      el("p", { class: "note", style: "margin-top:12px", text: api.modo === "api" ? "Se guarda en el servidor y lo verán otros usuarios." : "Modo estático: se guarda solo en este navegador." }));
    return;
  }
  let form;
  marcadorEdicion([st.nuevo.lat, st.nuevo.lng], (la, ln) => form.setCoords(la, ln));
  map.panTo([st.nuevo.lat, st.nuevo.lng]);
  form = formProyecto(st.nuevo, {
    onGuardar: async d => {
      const p = await api.crearProyecto(d);
      st.nuevo = null; capaEdicion.clearLayers();
      await recargarProyectos(); abrirPanel(null);
      st.capas.proyectos.visible = true; seleccionar("proyecto", p.id); refrescar(); toast("Proyecto guardado.", "ok");
    },
    onCancelar: () => { st.nuevo = null; capaEdicion.clearLayers(); renderPanel(); }
  });
  body.append(el("p", { class: "note", style: "margin-top:0", text: "Arrastre el marcador para ajustar la ubicación." }), form);
}

function panelAcerca(body) {
  put(body,
    el("p", { text: "Visor geográfico de fondos públicos concursables de Chile para organizaciones comunitarias, ONG, municipios y emprendedores." }),
    el("p", { class: "msg warn", text: api.aviso }),
    el("div", { class: "block" }, el("h3", { text: "Datos" }), el("ul", { class: "req" },
      el("li", { text: "Catálogo de fondos: actualizado al " + api.actualizado + "." }),
      el("li", { text: "Población: Censo 2017 (INE)." }),
      el("li", { text: "Mapas base: Esri, CARTO y OpenStreetMap." }),
      el("li", { text: api.poligonos ? "Límites regionales: geoBoundaries CHL ADM1, a partir de BCN y OCHA ROLAC (CC BY 3.0 IGO), simplificados." : "Sin límites regionales cargados: se usan símbolos en las capitales." }))),
    el("div", { class: "block" }, el("h3", { text: "Conexión" }), el("p", { class: "muted", text: api.modo === "api" ? "Conectado a la API (Node + Express)." : "Modo estático: sin servidor, los proyectos quedan en este navegador. Para compartirlos, ejecute el backend (ver README)." })));
}

/* ---------------- tabla de atributos ---------------- */
const enVista = (lat, lng) => map.getBounds().contains([lat, lng]);
const TABLAS = {
  fondos: {
    filas: () => {
      let fs = filtrarFondos(api.fondos, st.filtros);
      if (st.sel && st.sel.tipo === "region") fs = fs.filter(f => fondosDeRegion([f], st.sel.id).length);
      if (st.extension) { const vis = api.regiones.filter(r => enVista(r.lat, r.lng)).map(r => r.codigo); fs = fs.filter(f => vis.some(c => fondosDeRegion([f], c).length)); }
      return fs;
    },
    id: f => f.id, tipo: "fondo",
    cols: [
      { k: "nombre", t: "Fondo" }, { k: "institucion", t: "Institución" },
      { k: "cobertura", t: "Cobertura", r: tagCob },
      { k: "estado", t: "Estado", v: f => ESTADOS_FONDO[estadoFondo(f).estado], r: tagEstado },
      { k: "monto_max", t: "Monto máx.", num: true, f: clp },
      { k: "cierre", t: "Cierre", v: f => f.convocatoria && f.convocatoria.cierra || null, f: () => "", r: f => el("span", { style: "white-space:nowrap", text: f.convocatoria && f.convocatoria.cierra ? f.convocatoria.cierra.split("-").reverse().join("-") : "–" }) },
      { k: "temas", t: "Temas", v: f => f.temas.map(t => TEMAS[t] || t).join(", ") }
    ]
  },
  regiones: {
    filas: () => api.regiones.filter(r => !st.extension || enVista(r.lat, r.lng)).map(r => ({ ...r, ...(indic.find(x => x.codigo === r.codigo) || {}) })),
    id: r => r.codigo, tipo: "region",
    cols: [
      { k: "nombre", t: "Región" }, { k: "capital", t: "Capital" },
      { k: "poblacion", t: "Población (2017)", num: true, f: num },
      { k: "fondos", t: "Fondos (filtros)", num: true, f: num },
      { k: "proyectos", t: "Proyectos", num: true, f: num },
      { k: "monto_adjudicado", t: "Adjudicado (CLP)", num: true, f: n => "$" + num(n) }
    ]
  },
  proyectos: {
    filas: () => st.proyectos.filter(p => (!st.extension || enVista(p.lat, p.lng)) && (!st.sel || st.sel.tipo !== "region" || p.region === st.sel.id)),
    id: p => p.id, tipo: "proyecto",
    cols: [
      { k: "nombre", t: "Proyecto" }, { k: "organizacion", t: "Organización" },
      { k: "region", t: "Región", v: p => REG[p.region] ? REG[p.region].nombre : "" },
      { k: "fondoId", t: "Fondo", v: p => p.fondoId && FON[p.fondoId] ? FON[p.fondoId].nombre : "" },
      { k: "estado", t: "Estado", v: p => ESTADOS_PROYECTO[p.estado] },
      { k: "monto", t: "Monto (CLP)", num: true, f: n => n == null ? "–" : "$" + num(n) }
    ]
  }
};
const valorCol = (c, x) => c.v ? c.v(x) : x[c.k];

document.querySelectorAll(".table-tabs button").forEach(b => b.addEventListener("click", () => { st.tablaTab = b.dataset.tab; if (!st.tablaAbierta) { st.tablaAbierta = true; setTimeout(() => map.invalidateSize(), 0); } guardarPrefs(); renderTabla(); }));
$(".table-tabs").addEventListener("keydown", e => {
  const bs = [...document.querySelectorAll(".table-tabs button")], i = bs.indexOf(document.activeElement);
  const j = { ArrowRight: 1, ArrowLeft: -1 }[e.key]; if (i < 0 || !j) return;
  const b = bs[(i + j + bs.length) % bs.length]; b.click(); b.focus(); e.preventDefault();
});
$("#tabla-toggle").addEventListener("click", () => { st.tablaAbierta = !st.tablaAbierta; guardarPrefs(); renderTabla(); setTimeout(() => map.invalidateSize(), 0); });
$("#filtro-extension").addEventListener("change", e => { st.extension = e.target.checked; renderTabla(); });
$("#exportar").addEventListener("click", () => {
  const T = TABLAS[st.tablaTab];
  const csv = aCSV(ordenar(T, T.filas()), T.cols.map(c => ({ titulo: c.t, valor: x => valorCol(c, x) })));
  const a = el("a", { href: URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })), download: st.tablaTab + ".csv" });
  document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
});

function ordenar(T, filas) {
  const s = st.sort[st.tablaTab]; if (!s) return filas;
  const c = T.cols.find(x => x.k === s.k); if (!c) return filas;
  const d = s.dir === "asc" ? 1 : -1;
  return filas.slice().sort((a, b) => {
    const va = valorCol(c, a), vb = valorCol(c, b);
    if (va == null && vb == null) return 0; if (va == null) return 1; if (vb == null) return -1;
    return (typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb), "es")) * d;
  });
}

function renderTabla() {
  const tabla = $("#tabla");
  tabla.classList.toggle("collapsed", !st.tablaAbierta);
  $("#tabla-toggle").setAttribute("aria-expanded", st.tablaAbierta);
  $("#filtro-extension").checked = st.extension;
  document.querySelectorAll(".table-tabs button").forEach(b => { const on = b.dataset.tab === st.tablaTab; b.setAttribute("aria-selected", on); b.tabIndex = on ? 0 : -1; });
  $("#tabla-body").setAttribute("aria-labelledby", "tt-" + st.tablaTab);
  for (const k in TABLAS) $("#n-" + k).textContent = "(" + TABLAS[k].filas().length + ")";
  if (!st.tablaAbierta) return;
  const T = TABLAS[st.tablaTab], filas = ordenar(T, T.filas()), body = $("#tabla-body");
  body.textContent = "";
  const filtroReg = st.sel && st.sel.tipo === "region" && st.tablaTab !== "regiones";
  if (filtroReg) body.append(el("div", { class: "msg info", style: "margin:8px" }, "Mostrando solo la región de " + REG[st.sel.id].nombre + ". ",
    el("button", { type: "button", class: "btn small ghost", text: "Ver todas", onclick: () => { st.sel = null; refrescar(); } })));
  if (!filas.length) { body.append(el("p", { class: "empty", text: st.tablaTab === "proyectos" ? "No hay proyectos registrados. Use «Agregar» en la barra lateral." : "No hay registros con los filtros actuales." })); return; }
  const s = st.sort[st.tablaTab];
  const thead = el("thead", {}, el("tr", {}, T.cols.map(c => el("th", { class: c.num ? "num" : null, scope: "col", "aria-sort": s && s.k === c.k ? (s.dir === "asc" ? "ascending" : "descending") : null },
    el("button", { type: "button", text: c.t, onclick: () => { st.sort[st.tablaTab] = { k: c.k, dir: s && s.k === c.k && s.dir === "asc" ? "desc" : "asc" }; renderTabla(); } })))));
  let selTr = null;
  const tbody = el("tbody", {}, filas.map(x => {
    const id = T.id(x), sel = st.sel && st.sel.tipo === T.tipo && st.sel.id === id;
    const ir = () => seleccionar(T.tipo, id, { zoom: T.tipo !== "fondo" });
    const tr = el("tr", { class: sel ? "sel" : null, tabindex: 0, onclick: ir, onkeydown: e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ir(); } } },
      T.cols.map(c => el("td", { class: c.num ? "num" : null }, c.r ? c.r(x) : c.f ? c.f(x[c.k]) : (valorCol(c, x) ?? ""))));
    if (sel) selTr = tr;
    return tr;
  }));
  body.append(el("table", { class: "attr" }, thead, tbody));
  if (selTr) selTr.scrollIntoView({ block: "nearest" });
}

/* ---------------- búsqueda ---------------- */
const inp = $("#buscar"), lista = $("#buscar-lista");
let resultados = [], activo = -1;
const norm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
function buscar() {
  const q = norm(inp.value).trim();
  resultados = !q ? [] : [
    ...api.regiones.filter(r => norm(r.nombre + " " + r.capital).includes(q)).map(r => ({ tipo: "region", id: r.codigo, t: r.nombre, s: "Región" })),
    ...api.fondos.filter(f => norm(f.nombre + " " + f.institucion).includes(q)).map(f => ({ tipo: "fondo", id: f.id, t: f.nombre, s: "Fondo" })),
    ...st.proyectos.filter(p => norm(p.nombre + " " + p.organizacion).includes(q)).map(p => ({ tipo: "proyecto", id: p.id, t: p.nombre, s: "Proyecto" }))
  ].slice(0, 8);
  activo = resultados.length ? 0 : -1;
  pintarResultados();
}
function pintarResultados() {
  lista.textContent = "";
  lista.hidden = !resultados.length; inp.setAttribute("aria-expanded", !lista.hidden);
  resultados.forEach((r, i) => lista.append(el("li", { role: "option", id: "res-" + i, "aria-selected": i === activo, onmousedown: e => { e.preventDefault(); elegir(i); } }, el("span", { text: r.t }), el("small", { text: r.s }))));
  if (activo >= 0) inp.setAttribute("aria-activedescendant", "res-" + activo); else inp.removeAttribute("aria-activedescendant");
}
function elegir(i) { const r = resultados[i]; if (!r) return; inp.value = ""; resultados = []; pintarResultados(); inp.blur(); seleccionar(r.tipo, r.id, { zoom: true }); }
inp.addEventListener("input", buscar);
inp.addEventListener("keydown", e => {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") { if (!resultados.length) return; e.preventDefault(); activo = (activo + (e.key === "ArrowDown" ? 1 : -1) + resultados.length) % resultados.length; pintarResultados(); }
  else if (e.key === "Enter") { e.preventDefault(); elegir(activo); }
  else if (e.key === "Escape") { resultados = []; pintarResultados(); }
});
inp.addEventListener("blur", () => setTimeout(() => { resultados = []; pintarResultados(); }, 100));

/* ---------------- ciclo de render ---------------- */
function refrescarMapa() { renderRegiones(); renderProyectos(); if (st.panel === "leyenda") renderPanel(); }
function refrescar() {
  refrescarMapa(); renderTabla(); renderDetalle(); actualizarResumenFiltros();
}

await recargarProyectos();
refrescar();
listo = true;
