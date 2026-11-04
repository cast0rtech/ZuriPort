# <img src="logo.png" alt="ZüriPort Logo" width="42" align="center" /> ZüriPort — Transporte Público de Zúrich en Tiempo Real

🌐 **Demo en vivo (GitHub Pages):** [https://cast0rtech.github.io/ZuriPort/](https://cast0rtech.github.io/ZuriPort/)

Aplicación web **Single Page Application (SPA)** 100 % estática para visualizar en tiempo real las estaciones y salidas de **Tren (SBB / S-Bahn), Tranvía (VBZ), Autobús (ZVV) y Barco/Funicular** en Zúrich y sus alrededores.

## 🚀 Características

- **Mapa interactivo a pantalla completa (`100vw × 100vh`)**: Construido con **Leaflet.js** y tiles gratuitos de **OpenStreetMap**.
- **Geolocalización en tiempo real (`watchPosition`)**:
  - Solicita permisos GPS al abrir la aplicación y centra el mapa automáticamente en la posición del usuario.
  - Marcador de usuario con **punto azul parpadeante** y halo de precisión que se desplaza en vivo.
  - **Fallback automático**: Si se deniega el permiso o falla el GPS, centra el mapa en **Zürich HB (`47.3781, 8.5401`)**.
- **Datos en vivo (`transport.opendata.ch`)**:
  - Consulta automática de estaciones cercanas (`?x={lat}&y={lon}&type=station`) al desplazarse el usuario o al arrastrar el mapa (`dragend`).
  - Iconos personalizados por medio de transporte y **Popups** con el nombre de cada estación y sus próximas salidas en vivo (`/v1/stationboard`).
- **Radio de búsqueda configurable**: Ajustable mediante la constante `SEARCH_RADIUS_METERS` en [`index.html`](index.html).

---

## 🌐 Cómo publicar gratis en GitHub Pages (`github.io`)

Este repositorio ya incluye:
- [`index.html`](index.html) autocontenido en la raíz.
- [`.nojekyll`](.nojekyll) para servir archivos estáticos directamente sin procesamiento Jekyll.
- [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml) para despliegue automático con GitHub Actions.

### Opción A — Desde GitHub Desktop (Recomendado ya que estás en `Documents\GitHub\ZüriPort`)
1. Abre **GitHub Desktop** y selecciona **File → Add Local Repository...** eligiendo la carpeta `C:\Users\castor\Documents\GitHub\ZüriPort`.
2. Haz clic en **Publish repository** (desmarca *Keep this code private* para poder usar GitHub Pages gratis en cuentas gratuitas).
3. En tu repositorio en `github.com`, ve a **Settings → Pages**.
4. En **Build and deployment → Source**, elige **GitHub Actions** (o **Deploy from a branch** → rama `main` / carpeta `/ (root)`).
5. En unos segundos tu web estará publicada en:
   `https://cast0rtech.github.io/ZuriPort/`

### Opción B — Desde la terminal con Git
```powershell
git remote add origin https://github.com/cast0rtech/ZuriPort.git
git push -u origin main
```
Luego activa **Settings → Pages** en GitHub seleccionando la rama `main` o **GitHub Actions**.
