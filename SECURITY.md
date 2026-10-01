# Seguridad y uso responsable

## Alcance del producto

WORLDVIEW ESPAÑA muestra **exclusivamente cámaras públicas publicadas por organismos
oficiales** a través de sus catálogos. No implementa, ni aceptará contribuciones que añadan:
acceso a cámaras privadas o domésticas, descubrimiento de dispositivos, elusión de
autenticación o de controles de acceso, reconocimiento facial o de matrículas,
identificación o seguimiento de personas, ni grabación o archivo de imágenes.

## API (Vercel Functions)

| Endpoint | Entrada aceptada | Protección |
|---|---|---|
| `GET /api/cameras?source=` | id de un proveedor registrado | Lista cerrada (`server/sources/registry.js`); 400 para cualquier otro valor |
| `GET /api/frame?id=` | `dgt:<1-7 dígitos>` o `madrid:Camara[A-Za-z0-9_-]{1,40}` | **No es un proxy abierto**: la URL se construye en el servidor a partir de una plantilla fija; el cliente nunca aporta URL ni host |
| `GET /api/health` | — | No contacta con terceros |

Medidas en `server/http/safeFetch.js` y `server/api/handlers.js`:

- **SSRF:** *allowlist* exacta de hostnames por proveedor; se rechazan credenciales en la URL,
  puertos no estándar y esquemas distintos de http/https. Las redirecciones se siguen como
  máximo 2 veces y **solo** hacia hosts permitidos.
- **Límites:** *timeout* (12 s catálogos, 8 s imágenes) y tope de tamaño (15 MB / 3 MB)
  aplicado en *streaming*.
- **Validación de contenido:** las imágenes se validan por firma (JPEG/PNG/GIF/WebP), no por
  `Content-Type`; se sirven con `nosniff` y `Content-Security-Policy: default-src 'none'`.
- **Abuso:** caché CDN (`s-maxage`) como defensa principal, más un limitador por cliente y
  por instancia (*best-effort*: las instancias *serverless* no comparten memoria). Para
  límites estrictos, configurar reglas del Firewall de Vercel sobre `/api/frame`.
- Los registros de proveedor se revalidan en el servidor y de nuevo en el cliente
  (`createCamera`): ids con formato estricto, coordenadas válidas y medios solo `https:` o
  `/api/frame`.

## Cliente

- Sin `innerHTML`: todo el texto procedente de proveedores se inserta con `textContent`.
- CSP estricta en `vercel.json` (`script-src 'self'`, sin *scripts* en línea; el tema se
  aplica desde `/theme-init.js`). Enlaces externos con `rel="noopener noreferrer"`;
  imágenes con `referrerpolicy="no-referrer"`.
- `localStorage` guarda solo: preferencia de tema, ids de cámaras favoritas/recientes y el
  tamaño del historial. Ningún dato personal.

## Secretos

- Ninguna variable `VITE_*` debe contener secretos: Vite las incrusta en el JavaScript público.
- `TFL_APP_KEY` es solo de servidor. `.env*` está en `.gitignore`; solo se versiona `.env.example`.

## Informar de una vulnerabilidad

Usa el [aviso privado de vulnerabilidades de GitHub](https://github.com/byronAdrian/ojodedios/security/advisories/new)
del repositorio. No abras *issues* públicas con detalles explotables.

## Excepciones de la CSP (verificadas)

- `style-src 'unsafe-inline'`: CesiumJS crea atributos `style` y elementos `<style>` en tiempo
  de ejecución (35 violaciones medidas con `style-src 'self'` en el E2E). Sin esta excepción
  el globo se maquetaría mal. Los *scripts* siguen limitados a `'self'`.
- `'wasm-unsafe-eval'`: permite compilar WebAssembly (decodificadores de Cesium), no `eval` de JS.
- No se usa `'unsafe-eval'`: por eso se importa `@cesium/engine` (CesiumWidget) en lugar del
  `Viewer` de `cesium`, cuyo Knockout.js ejecuta `eval("this")`.
