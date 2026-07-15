# Guía de despliegue — Backend (Apps Script)

Pasos para poner en marcha el backend que alimenta la app del mensajero. Se hace **una sola vez**.

## 1. Crear el proyecto de Apps Script
1. Abre el Google Sheet de la malla: https://docs.google.com/spreadsheets/d/1eN-hVBLrAoTZH3m5c0ZLTyTKjhzS8lbfqDq9FD0X2lE
2. Menú **Extensiones → Apps Script**.
3. Borra el contenido de `Código.gs` y pega todo el contenido de [`apps-script/Codigo.gs`](apps-script/Codigo.gs).
4. Guarda (💾).

> El `SS_ID` ya apunta a tu archivo. Si algún día lo cambias, actualiza esa constante.

## 2. Inicializar las hojas (una vez)
1. En el editor, selecciona la función **`initSheets`** en el menú desplegable.
2. Clic en **Ejecutar** ▶.
3. Autoriza los permisos cuando lo pida (Drive + Hojas + Maps para geocodificar).
   - Crea las hojas: `Ingresos, Maestro_Activos, Lavado_Neveras, Cumplimiento_HSQ, Alertas, Cierres`.
   - Crea la carpeta de fotos `Cafam_Biologicos_Evidencias` en tu Drive.

## 3. Publicar como aplicación web
1. **Implementar → Nueva implementación**.
2. Tipo: **Aplicación web**.
3. Configura:
   - **Ejecutar como:** Yo (tu cuenta).
   - **Quién tiene acceso:** **Cualquier usuario**.
4. **Implementar** y copia la **URL que termina en `/exec`**.

## 4. Conectar la app
1. Abre la app: https://quicklastmile.github.io/Cafam-biologicos-app/app.html
2. En la pantalla de configuración, pega la URL `/exec` y **Guardar**.
   - Solo se hace una vez por dispositivo (queda guardada en el celular).

## 5. Cargar los activos
1. Genera los IDs en el [generador](https://quicklastmile.github.io/Cafam-biologicos-app/generador-ids.html).
2. Botón **Copiar filas para Maestro_Activos** → pega en la hoja `Maestro_Activos` (desde la columna ID).

## Notas
- **Fotos:** se guardan en Drive con enlace de solo lectura; en las hojas queda la URL.
- **Puntualidad:** se compara la hora de marcación contra la hora de inicio del `HORARIO` de la malla, con `GRACE_MIN = 5` minutos de tolerancia (ajustable en el `.gs`).
- **Cambios en el `.gs`:** tras editar, crea una **nueva versión** de la implementación (Implementar → Administrar implementaciones → Editar → Nueva versión).
- **Verificación HSQ:** hoy queda como confirmación manual (+ código opcional). Cuando HSQ comparta las hojas de respuestas, se puede cambiar a cruce automático por cédula + fecha.
