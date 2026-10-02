# Brújula de Fondos Chile

Visor geográfico de fondos públicos concursables de Chile por región, con interfaz tipo SIG (similar al Map Viewer de ArcGIS): riel de herramientas, panel de capas con opacidad, filtros, leyenda dinámica, galería de mapas base, tabla de atributos ordenable y exportable a CSV, panel de detalle y edición de puntos sobre el mapa.

> Los datos del catálogo son **referenciales**. Montos, fechas y requisitos cambian cada año: confírmelos en las bases vigentes de cada institución.

## Arquitectura

```
fondos-chile/
├── public/                 Frontend (HTML + CSS + JS módulos, Leaflet desde unpkg)
│   ├── index.html
│   ├── css/app.css
│   ├── js/core.js          Lógica de dominio compartida por navegador y servidor
│   ├── js/api.js           Acceso a datos: API si existe, si no JSON estáticos + localStorage
│   ├── js/app.js           Interfaz: mapa, capas, paneles, tabla, búsqueda, edición
│   └── data/               fondos.json, regiones.json (y opcional regiones.geojson)
├── server/                 Backend Node + Express
│   ├── app.js              API REST, cabeceras de seguridad, límite de escrituras
│   ├── store.js            Persistencia de proyectos en JSON (escritura atómica)
│   └── index.js            Arranque
└── test/api.test.js        Tests con node:test
```

La app funciona en dos modos:

- **Con backend** (`npm start`): la API sirve los datos y guarda los proyectos en `server/storage/proyectos.json`, compartidos entre usuarios.
- **Estático** (GitHub Pages u otro hosting de archivos): si `api/health` no responde, lee `data/*.json` y guarda los proyectos solo en el navegador. Para usar un backend desplegado en otro dominio: `index.html?api=https://mi-backend.example`, con `ALLOW_ORIGIN` configurado en el servidor.

## Uso local

```bash
cd fondos-chile
npm install
npm start            # http://localhost:3000
npm test
```

Variables de entorno:

| Variable | Uso |
|---|---|
| `PORT` | Puerto (por defecto 3000). |
| `ADMIN_TOKEN` | Si se define, editar y eliminar proyectos exige `Authorization: Bearer <token>`. Crear sigue abierto, con límite por IP. Sin token, todo queda abierto (pensado para uso local). |
| `ALLOW_ORIGIN` | Origen permitido para CORS (p. ej. `https://usuario.github.io`). |
| `STORE_FILE` | Ruta del archivo de proyectos. |

## API

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/health` | Estado y conteos. |
| GET | `/api/meta` | Catálogos de temas, tipos de organización y estados. |
| GET | `/api/fondos?q=&tema=&tipo=&region=&estado=&cobertura=` | Fondos filtrados, con estado estimado. |
| GET | `/api/fondos.csv?…` | Lo mismo, en CSV. |
| GET | `/api/fondos/:id` | Un fondo. |
| GET | `/api/regiones` | Regiones como GeoJSON de puntos (capitales). |
| GET | `/api/regiones/:codigo/fondos?…` | Fondos disponibles en una región. |
| GET | `/api/indicadores?…` | Indicadores por región para la capa temática. |
| GET | `/api/proyectos?region=&estado=` | Proyectos como GeoJSON. |
| POST | `/api/proyectos` | Crea un proyecto (validado; límite por IP). |
| PUT | `/api/proyectos/:id` | Actualiza (token si `ADMIN_TOKEN`). |
| DELETE | `/api/proyectos/:id` | Elimina (token si `ADMIN_TOKEN`). |

## Límites regionales (opcional)

Sin polígonos, la capa temática usa símbolos proporcionales en cada capital. Para coropletas reales, agregue `public/data/regiones.geojson` (FeatureCollection de polígonos en WGS84) con la propiedad `codigo` igual al código de región (`"01"`… `"16"`) y declárelo en `public/data/regiones.json` con `"poligonos": "data/regiones.geojson"`. Fuentes posibles: IDE Chile o la Biblioteca del Congreso Nacional (mapas vectoriales). Simplifique la geometría (p. ej. con mapshaper) para que pese poco.

## Ampliar el catálogo

Agregue entradas a `public/data/fondos.json`. Campos: `id`, `nombre`, `institucion`, `cobertura` (`nacional` | `regional`), `temas`, `beneficiarios` (claves de `core.js`), `monto_max` (CLP o `null`), `ventana` (`{"desde": mes, "hasta": mes}` o `null`), `url`, `resumen`, `notas`, `requisitos`. Para limitar un fondo regional a ciertas regiones, agregue `"regiones": ["06", "07"]`.
