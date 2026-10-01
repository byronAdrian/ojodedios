# Pruebas

| Capa | Comando | Qué cubre |
|---|---|---|
| Unitarias | `npm run test:unit` | Modelo de cámara, geografía de España, punto-en-polígono, adaptadores (DGT, Madrid, TfL, Fintraffic), filtros, búsqueda, estado en URL, preferencias, *store* |
| Integración | `npm run test:integration` | Manejadores HTTP reales con un `fetch` falso: caché y coalescencia, catálogo obsoleto ante fallos, SSRF, redirecciones, firma de imagen, *rate limit*, límites de tamaño |
| E2E | `npm run build && npm run test:e2e` | Build de producción en `vite preview` con las cabeceras de `vercel.json` (CSP incluida) y Chromium real con WebGL por software |

## Fixtures

- `tests/fixtures/dgt-cctv-sample.xml`: registros reales de la DGT (exportación de 2018,
  vía esri-es/datex2-geojson-converter) serializados con los nombres de elemento DATEX II.
- `tests/fixtures/madrid-cameras-sample.kml`: *placemarks* reales del KML de datos.madrid.es.
- `tests/fixtures/tfl-sample.json` y `fintraffic-sample.json`: forma documentada por los
  adaptadores originales, con casos negativos (no disponible, host ajeno, id mal formado).

## E2E sin red

Las APIs de los proveedores y las teselas se interceptan en el navegador con catálogos
generados **por los adaptadores reales** a partir de los fixtures. Así la ejecución es
determinista y no depende de terceros.
Escenarios: carga y arranque del globo sin errores de consola ni de CSP; cambio de tema sin
recrear el globo y persistencia sin parpadeo; tema automático; filtros jerárquicos y estado
vacío honesto; ciudad como filtro de radio; selección con imagen, metadatos y URL; error de
imagen con reintento y enlace; enlaces profundos (España y extranjero); búsqueda con
teclado; favoritas y recientes; ámbito Mundo y país; fallo parcial de proveedor; móvil
(390 px y 320 px) y tablet (820 px) sin desbordamiento, con paneles inferiores y objetivos
táctiles; teclado (*skip link*, foco al abrir el detalle).

Chromium: el *runner* usa `CHROMIUM_PATH`, después `/opt/pw-browsers`, y si no encuentra
ninguno, la instalación de Playwright (`npx playwright-core install chromium`).
Las capturas se guardan en `test-results/`.

## Resultado de la última ejecución (2026-10-01)

- Unitarias + integración: **53/53**.
- E2E: **18/18**.
- `npm run build`: correcto. `npm run doctor`: correcto.

## Qué no cubren (limitaciones conocidas)

- Disponibilidad real de los proveedores: el entorno de desarrollo bloquea su red. Hay
  que verificarla tras desplegar (DEPLOY_VERCEL.md §7).
- Safari/iOS y Firefox reales; el E2E usa solo Chromium.
- Lectores de pantalla reales (se validan roles, nombres accesibles y foco, no la locución).
