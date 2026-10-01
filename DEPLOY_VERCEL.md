# Despliegue en Vercel

Guía paso a paso para publicar OJO DE DIOS desde GitHub con despliegues automáticos.
Todos los comandos están comprobados contra `package.json`.

## 1. Requisitos previos

- Cuenta en [Vercel](https://vercel.com) con acceso al equipo `byronadrians-projects`.
- El repositorio `byronAdrian/ojodedios` en GitHub, con la app de Vercel autorizada.
- Para trabajar en local: Node.js **20.19 o superior y menor que 25** (probado con 22.22) y npm 10.

## 2. Comprobación local

```bash
npm ci              # instalación reproducible desde package-lock.json
npm run doctor      # Node, dependencias, versiones de Cesium y archivos
npm test            # tests unitarios y de integración (node:test)
npm run build       # genera dist/ (incluye dist/cesium con Workers y Assets)
npm run preview     # sirve dist/ en http://localhost:4173 con /api y las cabeceras de vercel.json
npm run test:e2e    # E2E con Playwright sobre el build (requiere Chromium; ver TESTING.md)
npm run dev         # desarrollo con recarga en http://localhost:5173 (también monta /api)
```

## 3. Qué configura el repositorio (no hay que tocar nada en el panel)

`vercel.json` ya declara:

| Ajuste | Valor |
|---|---|
| Framework | `vite` |
| Instalación | `npm ci` |
| Build | `npm run build` |
| Directorio de salida | `dist` |
| Functions | `api/cameras.js`, `api/frame.js`, `api/health.js` (Node.js, `maxDuration` 20 s, 512 MB) |
| Cabeceras | CSP, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, COOP, HSTS |
| Caché | `/assets/*` inmutable 1 año (con *hash*); `/cesium/*` 1 día + SWR; catálogos `s-maxage=900`; imágenes `s-maxage=60` |

**No hay reescrituras SPA**: la app tiene una única ruta (`/`) y todo el estado va en la
*query string*, así que recargar cualquier enlace compartido nunca da 404 y no se
interceptan archivos estáticos ni APIs.

## 4. Primer despliegue

1. Sube los cambios a GitHub (rama de trabajo y, cuando se apruebe, `main`).
2. En Vercel: **Add New… → Project → Import Git Repository** → `byronAdrian/ojodedios`.
3. *Framework Preset*: Vite (lo detecta `vercel.json`). No cambies los comandos.
4. *Environment Variables*: no hace falta ninguna para funcionar. Opcionales en el apartado 5.
5. **Deploy**. Al terminar, Vercel muestra la URL HTTPS de producción (`*.vercel.app`).
6. *Settings → Git*: la rama de producción es `main`. Cada *push* a otra rama o PR genera
   una **Preview URL** propia para revisar antes de fusionar.

## 5. Variables de entorno

Configúralas en *Project → Settings → Environment Variables*, por entorno
(Production / Preview / Development). Plantilla completa en `.env.example`.

| Variable | Ámbito | Obligatoria | Uso |
|---|---|---|---|
| `VITE_CESIUM_ION_TOKEN` | **Pública** (se incrusta en el JS) | No | Solo para servicios de Cesium ion. Usa un token `assets:read` restringido por URL a tus dominios. |
| `VITE_BASEMAP_LIGHT_URL`, `VITE_BASEMAP_DARK_URL`, `VITE_BASEMAP_ATTRIBUTION` | **Pública** | No | Mapa base alternativo (plantilla `https://…/{z}/{x}/{y}`). Añade su host a `img-src` y `connect-src` en `vercel.json`. |
| `OPENSKY_CLIENT_ID`, `OPENSKY_CLIENT_SECRET` | Servidor | No (recomendado) | Vuelos de todo el mundo con refresco de unos 90 s en lugar de unos 15 min. Se obtienen gratis en opensky-network.org (Account → API client). |
| `TFL_APP_KEY` | Servidor | No | Sube el límite de la API de TfL. |
| `SOURCE_DGT_ENABLED`, `SOURCE_MADRID_ENABLED`, `SOURCE_TFL_ENABLED`, `SOURCE_FINTRAFFIC_ENABLED` | Servidor | No | `0` desactiva un proveedor sin redesplegar código. |
| `FRAME_RATE_LIMIT_PER_MIN` | Servidor | No | Límite por cliente e instancia de `/api/frame` (por defecto 240). |

> Todo lo que empiece por `VITE_` es visible en el navegador. Nunca pongas secretos ahí.
> Las variables `VITE_*` se leen **en el build**: si las cambias, vuelve a desplegar.

## 6. Dominio personalizado

*Project → Settings → Domains → Add* → introduce el dominio → crea en tu DNS el registro que
indique Vercel (`A` para el dominio raíz o `CNAME` a `cname.vercel-dns.com` para un
subdominio). El certificado HTTPS se emite solo. Si usas `VITE_CESIUM_ION_TOKEN`, añade el
dominio nuevo a las restricciones de URL del token.

## 7. Comprobaciones tras publicar (no verificables desde el entorno de desarrollo)

El entorno donde se desarrolló bloquea la salida a los proveedores, así que **estas
comprobaciones solo pueden hacerse con el despliegue real**:

1. `https://<dominio>/api/health` → `200` con los 4 proveedores.
2. `https://<dominio>/api/cameras?source=dgt` → `200` con `cameras` no vacío. Repite con
   `madrid`, `tfl` y `fintraffic`. Un `502 upstream_unavailable` indica que el proveedor
   rechaza o no responde a la región de Vercel; revisa *Logs* de la Function.
3. Abre una cámara DGT y otra de Madrid: la imagen llega por `/api/frame` (http→https).
4. Abre una cámara de TfL y otra de Fintraffic (carga directa): si no se ve, revisa la
   consola por violaciones de CSP en `img-src`.
5. Consola del navegador sin errores de CSP; el globo se dibuja (Workers en `/cesium/Workers`).
6. Cambia el tema, recarga y comprueba que no hay parpadeo.
7. Prueba en un móvil real (iOS Safari y Android Chrome): áreas seguras, paneles inferiores.
8. Lighthouse en modo móvil sobre la URL de producción.

## 8. Diagnóstico de errores habituales

| Síntoma | Causa probable | Solución |
|---|---|---|
| Globo en blanco, error de Workers en consola | `/cesium/*` no publicado o versiones de `cesium` y `@cesium/engine` desalineadas | `npm run doctor`; confirma que `dist/cesium/Workers` existe tras el build |
| «Fuente no disponible: DGT» | El proveedor falló o bloquea la IP de Vercel | Logs de la Function; desactiva temporalmente con `SOURCE_DGT_ENABLED=0` |
| Imágenes de TfL/Fintraffic no cargan | CSP `img-src` o el proveedor cambió de host | Actualiza `vercel.json` y el adaptador; el host está fijado a propósito |
| 429 en `/api/frame` | Limitador por instancia | Sube `FRAME_RATE_LIMIT_PER_MIN` o usa reglas del Firewall de Vercel |
| El build falla en Vercel por Node | Versión de Node fuera de rango | *Settings → General → Node.js Version*: 22.x |
| Mapa con marca de agua «API KEY REQUIRED» | El proveedor de teselas exige clave | Usa el valor por defecto (Esri) o configura `VITE_BASEMAP_*` con un proveedor con clave |
| `catalog_unusable` en `/api/cameras` | El proveedor cambió el formato | El campo `message` incluye un ejemplo de lo rechazado: abre una incidencia con él |
| Factura de Functions alta | Muchas imágenes vía proxy | La caché CDN (`s-maxage=60`) ya agrupa peticiones; valora reglas de Firewall |

## 9. Rendimiento del build (medido)

- Ruta crítica: `index-*.js` ≈ 18 KB gzip + CSS ≈ 6 KB gzip.
- Motor Cesium (`globe-*.js`) ≈ 790 KB gzip, cargado con `import()` tras pintar la interfaz.
- `dist/cesium` ≈ 8 MB de recursos estáticos (Workers, Assets), descargados bajo demanda.
