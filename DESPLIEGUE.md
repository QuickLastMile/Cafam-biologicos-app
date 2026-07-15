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

## Cambiar los links de HSQ (cuando envían uno nuevo)
Los links **no** se tocan en el código. Se cambian en la hoja **`Config`** del mismo Sheet:

| Clave | Valor |
|---|---|
| `HSQ_PREOPERACIONAL_URL` | pega aquí el nuevo link del preoperacional |
| `HSQ_LIMPIEZA_MOTO_URL` | pega aquí el nuevo link de limpieza de moto |
| `RESP_PREOPERACIONAL` | (opcional) hoja de respuestas, para cruce automático futuro |
| `RESP_LIMPIEZA_MOTO` | (opcional) hoja de respuestas de limpieza |

Editas la columna **Valor** y listo — la app toma el link nuevo en el siguiente inicio de sesión. No hay que volver a implementar.

## Estado de turnos (hoja `Cierres`)
Una fila por colaborador y día: `Turno` (horario asignado), `HoraIngreso`, `HoraSalida`, `Resultado`.
- **Pendiente:** aún no marca ingreso.
- **En turno:** ya marcó ingreso.
- **Completo:** cerró turno.

Para que aparezcan los **Pendiente** de las 11 motos CAFAM antes de que marquen, usa el menú
**Cafam Biológicos → Sembrar turnos pendientes (hoy)** cada mañana (o crea un activador diario:
Apps Script → Activadores → `sembrarPendientesHoy`, a diario 5–6 a.m.).

## Tablero del cliente (Cafam)
La misma implementación del Web App sirve el tablero (endpoint `?action=dashboard`).

1. Abre https://quicklastmile.github.io/Cafam-biologicos-app/dashboard.html
2. Pega la URL `/exec` (y un token si lo configuras) → **Entrar**.
3. Para enviarle un **enlace listo** al cliente, arma la URL con parámetros:
   `dashboard.html?api=<URL/exec>&token=<token>` — el cliente entra sin configurar nada.

**Proteger el tablero (opcional):** pon una clave en `Config → DASHBOARD_TOKEN`. Vacío = abierto
(cualquiera con la URL lo ve). Con token, solo entra quien tenga el token.

Muestra: ingresos del día (con foto y estado a tiempo/tarde), estado de cada nevera
(alcohol diario y exhaustivo cada 8 días, con alerta de vencido), turnos y alertas.

## Notas
- **Cámara:** el **ingreso** usa la cámara **delantera** (selfie, para validar quién marca); el **lavado de nevera** y el escaneo QR usan la **trasera**.
- **Fotos:** se guardan en Drive con enlace de solo lectura; en las hojas queda la URL. La foto de **ingreso** lleva marca de agua quemada con dirección, fecha/hora y coordenadas.
- **Puntualidad:** se compara la hora de marcación contra la hora de inicio del `HORARIO` de la malla, con `GRACE_MIN = 5` minutos de tolerancia (ajustable en el `.gs`).
- **Cambios en el `.gs`:** tras editar, crea una **nueva versión** de la implementación (Implementar → Administrar implementaciones → Editar → Nueva versión).
- **Verificación HSQ:** hoy queda como confirmación manual (+ código opcional). Cuando HSQ comparta las hojas de respuestas, se puede cambiar a cruce automático por cédula + fecha.
