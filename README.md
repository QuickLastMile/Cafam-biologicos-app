# Cafam Biológicos — App de Registro del Mensajero

App web (HTML) para el control operativo del servicio de Quick a **Cafam Biológicos**: marcación de ingreso con foto en vivo y geolocalización, validación de puntualidad contra la malla del coordinador, cumplimiento de formularios HSQ (preoperacional y limpieza de moto) y lavado/desinfección de neveras por QR. Todo queda registrado en Google Sheets con evidencia para auditoría.

## Problema que resuelve
- **Puntualidad:** llegadas tarde que afectan la promesa de recolección (Suba → Floresta → Calle 51).
- **Trazabilidad de protocolos:** preoperacional, limpieza de moto y lavado de neveras (alcohol diario + exhaustivo cada 8 días) — hoy se hacen en papel y no hay soporte para el cliente/auditorías.
- **Control de ingreso:** información real y verificable del ingreso de mensajeros.
- **Activos:** neveras, maletas y kits antiderrames identificados con ID + QR.

## Componentes

| Archivo | Estado | Descripción |
|---|---|---|
| `index.html` | ✅ Listo | Portal de entrada (mensajero / administración). |
| `generador-ids.html` | ✅ Listo | Genera IDs (`CAF-NEV-001`) + QR imprimibles y filas para `Maestro_Activos`. |
| `app.html` | 🚧 En construcción | App del mensajero: login por cédula, ingreso con foto+GPS, forms HSQ, lavado nevera, cierre de turno. |
| `apps-script/Codigo.gs` | 🚧 En construcción | Backend (Web App) que escribe en Google Sheets y valida la malla. |

**Repo:** https://github.com/QuickLastMile/Cafam-biologicos-app · **Pages:** https://quicklastmile.github.io/Cafam-biologicos-app/

## Modelo de datos (mismo archivo de la malla)
Spreadsheet: `1eN-hVBLrAoTZH3m5c0ZLTyTKjhzS8lbfqDq9FD0X2lE`

| Hoja | Uso |
|---|---|
| `Malla` (existe) | Fuente de verdad: cédula, nombre, placa, horario, contrato. |
| `Usuarios` | cédula + usuario + PIN (login liviano). |
| `Ingresos` | Marcación: foto, GPS, hora, a tiempo/TARDE. |
| `Maestro_Activos` | IDs de neveras/maletas/kits. Columnas: `ID · Tipo · FechaAlta · Estado · SedeBase · Observaciones`. |
| `Lavado_Neveras` | Registro por ID: tipo de lavado (alcohol/exhaustivo), foto, hora. |
| `Cumplimiento_HSQ` | Preoperacional + limpieza moto realizados. |
| `Alertas` | Novedades para el coordinador. |

## Esquema de ID de activos
```
CAF - NEV - 001 [-DV]
 │     │     │    └── Dígito verificador (Luhn) opcional
 │     │     └─────── Consecutivo (001, 002…)
 │     └───────────── Tipo: NEV / MAL / KIT
 └─────────────────── Cliente (Cafam)
```
El QR codifica un deep-link `…/?id=CAF-NEV-001` → escanear la nevera abre la app apuntando a ese activo.
**Imprimir en etiqueta de vinilo/poliéster** (resiste alcohol y agua del lavado).

## Verificación de formularios HSQ
Son Google Forms de HSQ:
- Preoperacional: https://forms.gle/WkcL2o5uYztN7XxR9
- Limpieza y desinfección moto: https://forms.gle/YeqaDuqV9kNzoEDx5

Para confirmar que el mensajero **sí** los diligenció (no solo abrió el link):
1. **Automático (ideal):** HSQ comparte la hoja de respuestas con Quick → se cruza por cédula + fecha.
2. **Código de confirmación (respaldo):** el form muestra un código al final que el mensajero copia en la app.

## Despliegue
GitHub Pages. Tras publicar, actualizar el **deep-link base** en `generador-ids.html` y la app con la URL real de Pages.
