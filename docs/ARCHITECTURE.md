# Arquitectura — OJO DEL CULO

## ADR-001 · Construir sobre la base técnica de gods-eye-view, no copiar el repositorio completo

**Estado:** aceptada · **Fecha:** 2026-10-01

### Contexto

El repositorio de destino (`byronAdrian/ojodedios`) estaba vacío (solo `LICENSE`).
El proyecto de referencia, [bilawalsidhu/gods-eye-view](https://github.com/bilawalsidhu/gods-eye-view)
(MIT, commit auditado `e7707d9`, ~1.570 archivos), es una consola local de inteligencia
geoespacial: CesiumJS + Vite, con aviones, barcos, satélites, radio SDR, control por voz
(OpenAI Realtime), lectores de matrículas (ALPR), instalaciones militares y CCTV.

Hallazgos de la auditoría que condicionan la decisión:

1. **Plano de datos incompatible con Vercel.** Todas las APIs (`/api/cctv/*`, `/api/opensky`,
   etc.) se sirven como *middleware del servidor de desarrollo de Vite*
   (`server/standalone/vite.config.js` → `localProviderPlugins()`). Un despliegue estático
   en Vercel las pierde: el globo cargaría sin datos y con errores 404.
2. **Sin fuentes españolas.** Ningún adaptador cubre España.
3. **Conflicto con la política de uso responsable** (sección 14 del encargo): ALPR,
   instalaciones militares y la radio SDR no encajan en un producto de cámaras públicas.
4. **Arranque bloqueante.** `vite-plugin-cesium` inyecta `<script src="/cesium/Cesium.js">`
   (~4 MB) bloqueante en `<head>`, lo que retrasa el primer pintado en móvil.
5. Requisitos de Node 24, dependencias nativas de desarrollo (`sharp`, `puppeteer`) y
   ~140 *exports* públicos: un coste de mantenimiento desproporcionado para este alcance.

### Decisión

Construir una aplicación nueva y acotada que **conserva la base técnica** (CesiumJS + Vite,
JavaScript ES modules, sin framework) y **porta los patrones y adaptadores verificados**
del original:

| Reutilizado del original | Dónde |
|---|---|
| CesiumJS + Vite como plataforma | `vite.config.js`, `src/map/*` |
| Adaptadores TfL JamCams y Fintraffic/Digitraffic (filtros, validación de ids, *pin* al origen oficial) | `server/sources/tfl.js`, `server/sources/fintraffic.js` |
| Modelo de seguridad del proxy CCTV: el cliente nunca aporta URLs; el servidor reconstruye la URL a partir de ids validados | `server/api/handlers.js`, `server/sources/*FrameUrl` |
| Polígonos de provincias Natural Earth (dominio público) curados por el original, fijados a un commit | `scripts/build-spain-provinces.mjs` |
| Convenciones de atribución y documentación de fuentes | `DATA_SOURCES.md` |

Las APIs pasan a ser **Vercel Functions** (`/api/*.js`) con manejadores *Web-standard*
(`Request → Response`) que también se montan en `vite dev/preview`, de modo que el
comportamiento local coincide con el de producción.

### Consecuencias

- (+) Despliegue en Vercel funcional de extremo a extremo, sin servidor propio.
- (+) Ruta crítica de ~18 KB gzip de JS; Cesium (~1,1 MB gzip) se carga bajo demanda.
- (−) No se incluyen vuelos, barcos, satélites, voz ni radio. Si se quieren, habría que
  portar cada proveedor a una Function siguiendo `server/sources/registry.js`.
- (−) El código no comparte historial git con el original; se conserva la atribución MIT
  en `THIRD_PARTY_NOTICES.md`.

## Mapa de módulos

```
index.html            Shell estático, sprite de iconos, theme-init (sin parpadeo)
public/theme-init.js  Resuelve tema antes del primer pintado (CSP sin 'unsafe-inline')
src/
  main.js             Punto de entrada: estilos + arranque; Cesium por import() diferido
  app/application.js  Raíz de composición y controlador (store → vistas, URL, acciones)
  domain/             Lógica pura, testeable en Node
    camera.js         Modelo común, categorías, registro de proveedores, validación
    spain.js          Comunidades, provincias (ISO 3166-2), accesos rápidos
    filters.js        Filtros combinables, contadores honestos, orden
    search.js         Índice de búsqueda en memoria (sin red por pulsación)
  state/              store observable, preferencias locales, estado ⇄ URL
  services/           cameraRepository: /api/cameras, revalidación, caché de sesión
  map/                globe.js (Viewer único), cameraLayer.js (clustering, diff)
  ui/                 Vistas sin estado: búsqueda, filtros, resultados, detalle, chrome
  styles/             tokens.css (claro/oscuro), base, layout (mobile-first), componentes
server/
  api/handlers.js     cameras / frame / health (Request → Response)
  sources/            Adaptadores por proveedor + registry.js (único mapa id → URL)
  http/safeFetch.js   Allowlist de hosts, redirecciones limitadas, timeout, tope de bytes
  geo/                Provincia/comunidad por punto-en-polígono
  dev/devApiPlugin.js Monta las APIs en vite dev/preview y aplica cabeceras de vercel.json
api/*.js              Vercel Functions (envoltorios finos)
build/cesiumAssets.js Sirve/copia Workers, Assets, ThirdParty y Widgets de Cesium en /cesium
```

## Flujo de datos

1. `application.js` lee la URL (`parseUrlState`) y crea el *store*.
2. `loadScope('spain' | 'world')` pide cada proveedor a `/api/cameras?source=…` en paralelo.
   Un fallo de un proveedor no bloquea a los demás y se informa en la interfaz.
3. Cada cambio del *store* recalcula los datos derivados (memoizados) y actualiza solo las
   vistas afectadas. El globo recibe un **diff** de marcadores, nunca una reconstrucción.
4. El tema cambia la capa base del globo en caliente (`globe.setTheme`); el Viewer, la
   selección y la cámara se conservan.
5. El estado compartible se escribe con `history.replaceState` (con *debounce*).

## Cómo añadir un proveedor

1. Crear `server/sources/<id>.js` con un `parse…` que devuelva filas del modelo común.
2. Registrar en `server/sources/registry.js` (URL del catálogo, hosts permitidos y, si las
   imágenes son `http://`, un `frameUrl(nativeId)` estricto).
3. Añadir el proveedor a `PROVIDERS` en `src/domain/camera.js` (atribución y licencia).
4. Añadirlo a `SCOPE_SOURCES` en `src/services/cameraRepository.js`, añadir los hosts de
   imagen HTTPS a `img-src` en `vercel.json` y escribir tests con un fixture real.
