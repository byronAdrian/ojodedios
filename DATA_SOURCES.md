# Fuentes de datos

Solo se integran **fuentes públicas oficiales**, mediante sus catálogos documentados.
No se hace *scraping*, no se eluden autenticaciones y no se adivinan URLs de cámaras.
Que una URL sea accesible **no** implica permiso de redistribución: el proxy de imágenes
reenvía la imagen del proveedor, sin almacenarla ni modificarla, con atribución visible.

| Proveedor | Cobertura | Catálogo | Imagen | Licencia / atribución | Estado de la verificación |
|---|---|---|---|---|---|
| **DGT** (Dirección General de Tráfico) | Red de carreteras del Estado **salvo País Vasco y Cataluña** (gestionan su propio tráfico) | DATEX II `CCTVSiteTablePublication` — `https://infocar.dgt.es/datex2/dgt/CCTVSiteTablePublication/all/content.xml` (publicado en el [NAP de la DGT](https://nap.dgt.es/dataset/camaras-dgt)) | JPEG `http://infocar.dgt.es/etraffic/data/camaras/{id}.jpg` → vía `/api/frame` | Datos abiertos del NAP (CC BY). Atribución: «Fuente: Dirección General de Tráfico (DGT)» | Esquema verificado con una exportación real de la DGT (fixture). **Disponibilidad en vivo no verificada** desde el entorno de desarrollo (red bloqueada). |
| **Ayuntamiento de Madrid** (Informo) | Ciudad de Madrid | KML `https://datos.madrid.es/egob/catalogo/202088-0-trafico-camaras.kml` ([ficha](https://datos.madrid.es/dataset/202088-0-trafico-camaras)) | JPEG `http://informo.munimadrid.es/informo/Camaras/Camara*.jpg` → vía `/api/frame`; imagen cada ~10 min | Condiciones de datos.madrid.es (reutilización con atribución) | Esquema verificado con un KML real (fixture). Disponibilidad en vivo no verificada. |
| **Transport for London** — JamCams | Londres | `https://api.tfl.gov.uk/Place/Type/JamCam` (sin clave; `TFL_APP_KEY` opcional sube el límite) | JPEG HTTPS en el bucket oficial de TfL (carga directa) | [TfL Open Data](https://tfl.gov.uk/info-for/open-data-users/): «Powered by TfL Open Data» | Adaptador portado de gods-eye-view. Disponibilidad en vivo no verificada. |
| **Fintraffic / Digitraffic** — weathercams | Finlandia | `https://tie.digitraffic.fi/api/weathercam/v1/stations` (cabecera `Digitraffic-User`) | JPEG HTTPS `weathercam.digitraffic.fi` (carga directa) | [CC BY 4.0](https://www.digitraffic.fi/en/terms-of-service/) | Adaptador portado de gods-eye-view. Disponibilidad en vivo no verificada. |
| **CARTO basemaps** (Positron / Dark Matter) | Mapa base | — | Teselas `*.basemaps.cartocdn.com` | © OpenStreetMap contributors, © CARTO. Uso gratuito sujeto a sus [condiciones](https://carto.com/attributions) y límites razonables; para tráfico comercial alto, contratar o usar otro proveedor. | — |
| **Natural Earth** admin-1 | Polígonos de provincias (asignación de provincia/comunidad) | Empaquetado: `server/geo/spainProvinces.data.js` | — | Dominio público | Generado de forma reproducible (`npm run data:spain`). |

## Qué significa cada estado en la interfaz

- **Activa (proveedor):** el catálogo marca la cámara como operativa (TfL `available=true`,
  Fintraffic `GATHERING`).
- **En catálogo:** el proveedor la publica pero no informa de su salud (DGT, Madrid).
- **Imagen recibida / No disponible:** lo que **esta sesión** ha comprobado al cargar la
  imagen. No se guarda ni se comparte.
- **Catálogo en caché:** el proveedor falló y se sirve la última copia válida de la instancia.

## Limitaciones conocidas

- **País Vasco y Cataluña** no están en el catálogo de la DGT. Sus fuentes candidatas
  (Open Data Euskadi — API de tráfico; Servei Català de Trànsit) no se han integrado porque
  no se pudo verificar su esquema ni sus condiciones desde este entorno. Pendiente.
- **Municipio:** la DGT no publica municipio; no se inventa. Solo se asigna provincia y
  comunidad por coordenadas (polígonos simplificados a ~1 km: una cámara a menos de ~1 km
  de un límite provincial puede asignarse a la vecina).
- **Categorías:** las fuentes actuales solo aportan *Tráfico y carreteras* y *Meteorología
  y paisaje*. El resto de categorías aparecen deshabilitadas con contador 0, no se rellenan.
- **Vídeo:** ninguna fuente integrada ofrece vídeo; el modelo admite `hls` y la interfaz
  muestra «formato no soportado» con enlace a la fuente si apareciera.
- Las imágenes contienen la vía pública. La aplicación no analiza, reconoce ni almacena
  su contenido.
