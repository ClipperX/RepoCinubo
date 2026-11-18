# Cinubo España — versión inicial 0.1.0

## Instalación
Copia `manifest.json` en la raíz del plugin y `providers/cinubo.js` en la carpeta `providers/` de tu instalación Nuvio.

## Estado de esta versión
- Conserva la interfaz de proveedor `getStreams(tmdbId, mediaType, season, episode)` usada por el HDFull de referencia.
- Reconoce los tipos `movie` y `tv`.
- Lee metadatos de reproducción `server`, `quality` y `language` desde `data-link-playback`.
- Solo devuelve entradas en español y conserva sin modificar la URL firmada de Cinubo (`/t/...`).
- No descifra tokens, no resuelve reproductores de terceros y no automatiza CAPTCHA ni autenticación.

## Limitación conocida
La búsqueda exacta de Cinubo todavía está en fase de adaptación. La muestra confirma las rutas `/peliculas`, `/series`, `/p/{slug}` y `/s/{slug}/{temporada}x{episodio}`, pero no confirma la respuesta de búsqueda dinámica de Livewire ni la paginación del catálogo. Por eso, esta versión necesita una clave propia de TMDB en `TMDB_KEY` y que la ficha aparezca en la primera página del catálogo. La siguiente iteración debe implementar la búsqueda/paginación Livewire observada, tras validar su petición real.

## Configuración TMDB
En `providers/cinubo.js`, asigna tu clave propia a `TMDB_KEY`. No uses claves privadas de otros proveedores.
