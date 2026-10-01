# Changelog

## 0.1.1 — 2026-10-01

- Mapa base: CARTO exige ahora clave («API KEY REQUIRED» en producción) → Esri Canvas claro/oscuro sin clave, configurable con `VITE_BASEMAP_*`.
- Madrid: acepta cualquier ruta de imagen en los hosts oficiales de Informo (el formato del KML había cambiado y se descartaban todas las cámaras).
- Un catálogo sin cámaras válidas ya no se presenta como «vacío»: la API devuelve `catalog_unusable` con diagnóstico y la interfaz lo muestra como fuente no disponible.

## 0.1.0 — 2026-10-01

Primera versión de WORLDVIEW ESPAÑA.

- Globo CesiumJS (`@cesium/engine`) con mapa 2D/3D, agrupación de marcadores y cambio de tema en caliente.
- Sección «Explorar España» con filtros jerárquicos, 14 accesos rápidos y ciudades autónomas.
- Proveedores: DGT (DATEX II), Ayuntamiento de Madrid (KML), TfL y Fintraffic.
- Vercel Functions `/api/cameras`, `/api/frame` (proxy cerrado y validado) y `/api/health`.
- Tema claro, oscuro y automático sin parpadeo; diseño *mobile-first* con navegación inferior.
- Favoritas, recientes y enlaces compartibles.
- Tests unitarios, de integración y E2E; configuración de Vercel, CSP y documentación.
