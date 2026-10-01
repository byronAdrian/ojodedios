# OJO DEL CULO

Explorador de **cámaras públicas oficiales** sobre un globo 3D (CesiumJS) y un mapa 2D,
con una sección prioritaria para España: comunidades autónomas, provincias, ciudades,
Ceuta y Melilla. Modo claro, oscuro y automático; diseño *mobile-first*.

> Basado técnicamente en
> [gods-eye-view](https://github.com/bilawalsidhu/gods-eye-view) (MIT). Véase
> [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) para saber qué se reutiliza y por qué no se
> copió el repositorio completo.

## Funcionalidades

- **Explorar España**: filtros jerárquicos comunidad → provincia, 14 accesos rápidos a
  ciudades (Madrid, Barcelona, Valencia, Alicante, Sevilla, Málaga, Bilbao, Zaragoza,
  Murcia, Palma, Las Palmas de Gran Canaria, Santa Cruz de Tenerife, Ceuta y Melilla) que
  centran el mapa y filtran en un radio de 25 km. Que una ciudad aparezca no implica que
  haya cámaras.
- **Mundo**: añade TfL (Londres) y Fintraffic (Finlandia).
- **Vuelos en directo** (adsb.lol): aviones en el mapa orientados según su rumbo, con ficha (indicativo, matrícula, modelo, altitud, velocidad) y trayectoria observada.
- **Globo 3D / mapa 2D** en el mismo visor, con agrupación dinámica de marcadores según el
  zoom, centrado en España y vista global.
- **Buscador global** (países, comunidades, provincias, ciudades, cámaras y categorías), con
  *debounce*, en memoria y manejable con teclado.
- **Cualquier municipio** de más de 1.000 habitantes (6.849 localidades de GeoNames): al elegirlo, el mapa se centra y
  se muestran las cámaras oficiales a menos de 25 km. Si no hay ninguna, indica la más cercana y a qué distancia.
  El índice se descarga solo al usar el buscador.
- **Vídeo en directo** de webcams públicas emitidas por YouTube (lista ampliable en `server/sources/livestreams.data.js`). La DGT y Madrid publican imágenes periódicas, no vídeo.
- **Sala de control**: cuadrícula de cámaras que se actualizan solas.
- **Panel de capas**: cámaras, vuelos, **terremotos** (USGS, últimas 24 h, tamaño según magnitud) e **incendios** (NASA FIRMS, focos de calor por satélite; requiere `FIRMS_MAP_KEY`). Cada capa indica su estado y se guarda en la URL.
- **Panel de cámara**: imagen con refresco respetuoso, estados de error claros, proveedor,
  licencia, enlace a la fuente original, centrar en el mapa y compartir.
- **Contadores honestos**: total, verificadas por el proveedor, con imagen y no disponibles
  en esta sesión.
- **Favoritas y recientes** guardadas en el dispositivo, sin registro. Historial configurable.
- **Enlaces compartibles**: los filtros, la cámara, la vista y el modo 2D/3D van en la URL.

## Fuentes integradas

DGT (red estatal salvo País Vasco y Cataluña), Open Data Euskadi (País Vasco, con Bilbao, Vitoria-Gasteiz y Donostia), Ayuntamiento de Madrid, TfL, Fintraffic y Caltrans (California).
Las condiciones, la atribución y las limitaciones de cada una están en
[DATA_SOURCES.md](DATA_SOURCES.md). No se inventan cámaras, ubicaciones ni disponibilidad.

## Puesta en marcha

```bash
npm ci
npm run doctor
npm run dev          # http://localhost:5173
```

No se necesita ninguna clave. Las variables opcionales están en `.env.example`.

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo con `/api` |
| `npm run build` | Build de producción en `dist/` |
| `npm run preview` | Sirve `dist/` con `/api` y las cabeceras de `vercel.json` |
| `npm test` | Tests unitarios e integración |
| `npm run test:e2e` | E2E (Playwright) sobre el build |
| `npm run doctor` | Comprobación del entorno |
| `npm run data:spain` | Regenera los polígonos de provincias |
| `npm run data:places` | Regenera el índice de municipios (GeoNames) |

## Despliegue

Preparado para Vercel con despliegues automáticos desde GitHub: [DEPLOY_VERCEL.md](DEPLOY_VERCEL.md).

## Documentación

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): ADR, mapa de módulos y cómo añadir un proveedor.
- [DATA_SOURCES.md](DATA_SOURCES.md): fuentes, licencias y limitaciones.
- [SECURITY.md](SECURITY.md): modelo de seguridad, SSRF, CSP y uso responsable.
- [TESTING.md](TESTING.md): estrategia de pruebas y resultados.

## Uso responsable

Solo fuentes públicas oficiales. Sin reconocimiento facial ni de matrículas, sin
seguimiento de personas y sin acceso a cámaras privadas. Véase [SECURITY.md](SECURITY.md).

## Licencia

Código bajo MIT ([LICENSE](LICENSE)). Los datos de terceros conservan sus licencias
([DATA_SOURCES.md](DATA_SOURCES.md)); avisos de terceros en
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
