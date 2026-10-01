# Fuentes de datos

Solo se integran **fuentes públicas oficiales**, mediante sus catálogos documentados.
No se hace *scraping*, no se eluden autenticaciones y no se adivinan URLs de cámaras.
Que una URL sea accesible **no** implica permiso de redistribución: el proxy de imágenes
reenvía la imagen del proveedor, sin almacenarla ni modificarla, con atribución visible.

| Proveedor | Cobertura | Catálogo | Imagen | Licencia / atribución | Estado de la verificación |
|---|---|---|---|---|---|
| **DGT** (Dirección General de Tráfico) | Red de carreteras del Estado **salvo País Vasco y Cataluña** (gestionan su propio tráfico) | DATEX II `CCTVSiteTablePublication` — `https://infocar.dgt.es/datex2/dgt/CCTVSiteTablePublication/all/content.xml` (publicado en el [NAP de la DGT](https://nap.dgt.es/dataset/camaras-dgt)) | JPEG `https://etraffic.dgt.es/camarasEtraffic/{id}.jpg` (feed v3.6; el antiguo `infocar…/camaras/{id}.jpg` se mantiene como respaldo) → vía `/api/frame` | Datos abiertos del NAP (CC BY). Atribución: «Fuente: Dirección General de Tráfico (DGT)» | **Verificado en producción** (2026-10-01): el feed v3.6 del NAP devuelve 1.952 cámaras. La URL antigua de infocar responde 404. |
| **Ayuntamiento de Madrid** (Informo) | Ciudad de Madrid | KML `https://datos.madrid.es/egob/catalogo/202088-0-trafico-camaras.kml` ([ficha](https://datos.madrid.es/dataset/202088-0-trafico-camaras)) | JPEG `http://informo.munimadrid.es/informo/Camaras/Camara*.jpg` → vía `/api/frame`; imagen cada ~10 min | Condiciones de datos.madrid.es (reutilización con atribución) | Esquema verificado con un KML real (fixture). Disponibilidad en vivo no verificada. |
| **Open Data Euskadi** — API de tráfico | País Vasco: Gobierno Vasco, diputaciones forales y ayuntamientos de Bilbao, Vitoria-Gasteiz y Donostia | `https://api.euskadi.eus/traffic/v1.0/cameras?_page=N` (paginada, sin clave; [ficha](https://opendata.euskadi.eus/catalogo/-/camaras-de-trafico-de-las-administraciones-publicas-de-euskadi/)) | JPEG en el host de cada administración → vía `/api/frame`. Solo se aceptan dominios oficiales (`bizkaimove.com`, `bilbao.eus`, `trafikoa.eus`, `trafikoa.net`, `vitoria-gasteiz.org`, `donostia.eus`, `euskadi.eus`, diputaciones…). Las demás imágenes se descartan y se listan, con una URL de ejemplo por host, en `notes.rejectedImageHosts` y `notes.rejectedImageSamples` de `/api/cameras?source=euskadi`. | Open Data Euskadi: reutilización con atribución | Esquema verificado con una respuesta real (fixture `euskadi-cameras-sample.json`; coordenadas en UTM 30N convertidas a WGS84, validadas con pyproj). **Verificado en producción** (2026-10-01): 489 registros, unas 344 cámaras con imagen (incluido el centro de Bilbao y Donostia). Las imágenes de Vitoria-Gasteiz (18) usan un formato de URL aún no admitido. |
| **Webcams en directo (YouTube)** | Selección revisada a mano (`server/sources/livestreams.data.js`): Playa Grande (Puerto del Carmen, Lanzarote) y Benidorm | Lista en el repositorio, sin petición externa | **Vídeo real** con el reproductor oficial de YouTube (`youtube-nocookie.com`), silenciado al empezar | Condiciones de YouTube; solo emisiones públicas con la inserción permitida por su propietario | Encontradas por búsqueda web el 2026-10-01; **sin verificar en vivo** (YouTube está bloqueado en el entorno de desarrollo). El identificador de una emisión cambia si su propietario la reinicia: hay que actualizarlo en la lista. |
| **Transport for London** — JamCams | Londres | `https://api.tfl.gov.uk/Place/Type/JamCam` (sin clave; `TFL_APP_KEY` opcional sube el límite) | JPEG HTTPS en el bucket oficial de TfL (carga directa) | [TfL Open Data](https://tfl.gov.uk/info-for/open-data-users/): «Powered by TfL Open Data» | Adaptador portado de gods-eye-view. Disponibilidad en vivo no verificada. |
| **Fintraffic / Digitraffic** — weathercams | Finlandia | `https://tie.digitraffic.fi/api/weathercam/v1/stations` (cabecera `Digitraffic-User`) | JPEG HTTPS `weathercam.digitraffic.fi` (carga directa) | [CC BY 4.0](https://www.digitraffic.fi/en/terms-of-service/) | Adaptador portado de gods-eye-view. Disponibilidad en vivo no verificada. |
| **Vuelos en directo**: adsb.lol → airplanes.live → adsb.fi | Aviones cerca de la vista (radio ≤ 250 NM) | Mismo formato readsb v2; se prueban en orden vía `/api/flights` (consulta redondeada a 0,5°, caché 10 s, 60 s de espera para una fuente que falla o devuelve 429) | — | adsb.lol: ODbL 1.0. airplanes.live y adsb.fi: uso **no comercial**; un uso comercial requiere acuerdo con ellos. La ficha muestra la fuente usada. | adsb.lol respondió 429 desde Vercel (2026-10-01); las alternativas aún no se han verificado en vivo. |
| **OpenSky Network** — vuelos de todo el mundo | Instantánea mundial cuando la vista abarca más de 1.600 km | `https://opensky-network.org/api/states/all` vía `/api/flights?scope=world`, una única URL compartida por todos los visitantes y cacheada en la CDN | — | **No comercial**; un uso operativo o comercial requiere acuerdo con OpenSky. Sin cuenta, unas 100 consultas/día (refresco ≈ 15 min); con `OPENSKY_CLIENT_ID`/`SECRET`, ≈ 1.000/día (refresco 90 s–10 min según el saldo). | **No accesible desde Vercel** (2026-10-01: «Upstream unreachable», bloqueo de red probable). Con la vista alejada la app cubre la zona visible con hasta 12 consultas regionales (rejilla fija de 6°, 250 NM cada una, espaciadas 0,7 s y compartidas por la CDN). El planeta completo de una vez requiere una fuente de pago o un servidor que OpenSky no bloquee. |
| **Esri Canvas** (World Light/Dark Gray Base) | Mapa base | — | Teselas `services.arcgisonline.com` (sin clave) | Atribución obligatoria «Esri, HERE, Garmin, © OpenStreetMap contributors…» (se muestra en el mapa). Revisa los [términos de Esri](https://www.esri.com/en-us/legal/terms/full-master-agreement) antes de un uso comercial intensivo; se puede cambiar con `VITE_BASEMAP_*`. | Sustituye a CARTO, que ahora responde «API KEY REQUIRED» (detectado en producción). |
| **GeoNames** — localidades de España con ≥ 1.000 habitantes | Búsqueda de municipios («Aspe», «Novelda»…) y filtro «cerca de» (25 km) | Empaquetado: `src/data/spainPlaces.data.js` (6.849 localidades), generado desde `all-the-cities@3.1.0` con integridad sha512 fijada | — | [CC BY 4.0](https://www.geonames.org/about.html): «© GeoNames» (se muestra en el buscador) | Generado de forma reproducible (`npm run data:places`). La provincia sale del código INE del municipio. Es solo navegación: que un municipio aparezca **no** implica que tenga cámaras. |
| **Natural Earth** admin-1 | Polígonos de provincias (asignación de provincia/comunidad) | Empaquetado: `server/geo/spainProvinces.data.js` | — | Dominio público | Generado de forma reproducible (`npm run data:spain`). |

## Qué significa cada estado en la interfaz

- **Activa (proveedor):** el catálogo marca la cámara como operativa (TfL `available=true`,
  Fintraffic `GATHERING`).
- **En catálogo:** el proveedor la publica pero no informa de su salud (DGT, Madrid).
- **Imagen recibida / No disponible:** lo que **esta sesión** ha comprobado al cargar la
  imagen. No se guarda ni se comparte.
- **Catálogo en caché:** el proveedor falló y se sirve la última copia válida de la instancia.

## Limitaciones conocidas

- **Vuelos:** solo se muestran aviones en un radio de hasta 250 NM (unos 460 km) alrededor del centro de la vista; con la vista muy alejada (más de 1.600 km) se pide acercar el mapa. La «ruta» es la **trayectoria observada en esta sesión**. **Origen y destino no se muestran**: la base de rutas de adsbdb (David Taylor / Jim Mason) prohíbe expresamente publicarlas sin permiso. ADS-B puede ser incompleto, tener retraso o datos erróneos.

- **País Vasco** no está en el catálogo de la DGT; lo cubre la API de Open Data Euskadi (arriba).
- **Cataluña** tampoco está en la DGT. El Servei Català de Trànsit publica `cameres.xml` y el dataset `3tzz-6b9y`, pero no se ha podido verificar su esquema desde este entorno. Pendiente.
- **Otras ciudades** (Valencia, Málaga, Vigo) publican la ubicación de sus cámaras. Valencia no incluye la URL de la imagen; Málaga y Vigo no se han podido verificar todavía. No se integran adivinando URLs.
- **Buscar un municipio** centra el mapa y filtra a 25 km; no asigna municipio a las cámaras. Faltan los municipios de menos de 1.000 habitantes y los nombres van en una sola lengua (p. ej. «Elche», no «Elx»).
- **Municipio:** la DGT no publica municipio; no se inventa. Solo se asigna provincia y
  comunidad por coordenadas (polígonos simplificados a ~1 km: una cámara a menos de ~1 km
  de un límite provincial puede asignarse a la vecina).
- **Categorías:** las fuentes actuales solo aportan *Tráfico y carreteras* y *Meteorología
  y paisaje*. El resto de categorías aparecen deshabilitadas con contador 0, no se rellenan.
- **Vídeo:** la DGT y el Ayuntamiento de Madrid solo publican **imágenes periódicas**, no vídeo. El vídeo real procede de la lista de emisiones de YouTube; para añadir una, edita `server/sources/livestreams.data.js`.
- **Madrid:** el formato de ruta de imagen del KML ha cambiado con los años; el adaptador acepta
  cualquier imagen en los hosts oficiales de Informo. Si el catálogo no produce ninguna cámara
  válida, la API responde `catalog_unusable` con un ejemplo de la URL rechazada.
- Las imágenes contienen la vía pública. La aplicación no analiza, reconoce ni almacena
  su contenido.
