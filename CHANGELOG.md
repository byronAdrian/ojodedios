# Changelog

## 0.4.1 — 2026-10-01

- **Corrección**: los marcadores (terremotos, incendios, cámaras y aviones) del otro lado del planeta se veían a través del globo y parecían moverse al girarlo. Ahora la Tierra los tapa, como debe ser. Hay un test que impide reintroducir el fallo.
- Los terremotos se dibujan como anillos violeta (rosa si M ≥ 4,5) para no confundirlos con los focos de incendio (puntos naranjas) ni con la cámara seleccionada (amarilla).

## 0.4.0 — 2026-10-01

- **Panel de capas** en los controles del mapa: cámaras, vuelos, terremotos e incendios, cada uno con su estado. Accesible con teclado (Esc cierra). Se guarda en la URL (`cams=0`, `eq=0`, `fi=1`).
- **Terremotos en tiempo real** (USGS, últimas 24 h), activos por defecto. El tamaño indica la magnitud y el color más intenso marca M ≥ 4,5. La ficha muestra magnitud, lugar, hora, profundidad, aviso de tsunami si la fuente lo indica y enlace oficial.
- **Incendios** (NASA FIRMS, VIIRS): focos de calor de la zona visible. La clave `FIRMS_MAP_KEY` vive solo en el servidor y nunca aparece en respuestas ni errores (hay test que lo verifica).
- **Nuevas cámaras: Caltrans (California)**, 12 distritos, con proxy de imágenes cerrado.
- Diseño Matrix: el tinte verde se aplica ahora solo al mapa base, para que los colores de los marcadores sean fieles.
- Corrección: una potencia radiativa vacía ya no se muestra como «0 MW».

## 0.3.0 — 2026-10-01

- **Diseño «Matrix»**: verde fósforo sobre negro en el tema oscuro, con tipografía de terminal para títulos y etiquetas, brillo sutil, líneas de barrido y tinte verde sobre el mapa. Las imágenes de las cámaras no se tiñen. El tema claro pasa a una variante verde «sobre papel». Contraste AA verificado.
- **Nueva fuente: Open Data Euskadi**, con cámaras del Gobierno Vasco, las diputaciones y los ayuntamientos de Bilbao, Vitoria-Gasteiz y Donostia. La API es paginada y se descarga con concurrencia limitada; las coordenadas UTM se convierten a grados. Las imágenes se sirven por el proxy cerrado y solo se aceptan dominios oficiales; los hosts rechazados se informan en `notes`.
- **Corrección**: la ficha de una cámara mostraba «No disponible» aunque la imagen hubiera cargado, cuando antes había fallado la miniatura. Ahora el estado se actualiza solo.
- **Eliminado** el enlace «Zombis» de la barra superior.
- **Búsqueda de cualquier municipio** (6.849 localidades de España con ≥ 1.000 habitantes, GeoNames CC BY 4.0). Al elegirlo, el mapa se centra y se filtran las cámaras oficiales a 25 km. El enlace se puede compartir (`city=g<id>`). Si no hay cámaras en ese radio, se indica la más cercana y su distancia.
- El índice de municipios se carga bajo demanda, en un fragmento aparte de unos 116 KB comprimidos, al enfocar el buscador.
- `npm run data:places` lo regenera de forma reproducible (tarball fijado y verificado con sha512, sin dependencias nuevas).

## 0.2.0 — 2026-10-01

- **Vídeo en directo**: nueva fuente de webcams públicas emitidas por YouTube, con una lista revisada a mano en `server/sources/livestreams.data.js`. Se reproducen silenciadas al empezar, con el reproductor sin cookies (`youtube-nocookie.com`). En el listado y en la sala de control aparecen con el distintivo «EN DIRECTO».
- **Sala de control**: cuadrícula paginada de cámaras que se actualizan solas según la frecuencia de cada proveedor, con indicador «Recibida hace X». Se pausa con la pestaña oculta. Se guarda en la URL (`mos=1`).
- CSP: `frame-src https://www.youtube-nocookie.com` y miniaturas de `i.ytimg.com`.

## 0.1.1 — 2026-10-01

- Nombre de la aplicación: **OJO DEL CULO** (antes WORLDVIEW ESPAÑA). Los identificadores técnicos enviados a los proveedores usan `ojodedios`.

- **Vuelos en directo** (adsb.lol, ODbL): aviones orientados según su rumbo en el globo, refresco cada 15 s solo con la pestaña visible, ficha del avión con la trayectoria observada y botón para activarlos o desactivarlos (`fl=0` en la URL).
- DGT: catálogo DATEX II v3.6 del NAP (1.952 cámaras, imágenes en etraffic.dgt.es) con la URL antigua como respaldo.
- Proxy de imágenes: indica el motivo del error.

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
