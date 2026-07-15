/**
 * Cafam Biológicos — Backend (Google Apps Script Web App)
 * ------------------------------------------------------------------
 * Escribe en el MISMO archivo de la malla y guarda las fotos en Drive.
 * Endpoints (doPost con campo "action"): login, ingreso, hsq, lavado, cerrar.
 *
 * DESPLIEGUE:
 *   1) Extensiones → Apps Script en el Google Sheet de la malla, o proyecto
 *      independiente con SS_ID apuntando al archivo.
 *   2) Ejecutar una vez initSheets() (crea las hojas y da permisos).
 *   3) Implementar → Nueva implementación → Aplicación web →
 *      Ejecutar como: yo · Acceso: Cualquier usuario.
 *   4) Copiar la URL /exec y pegarla en la app (⚙ Configurar servidor).
 */

const SS_ID      = '1eN-hVBLrAoTZH3m5c0ZLTyTKjhzS8lbfqDq9FD0X2lE';
const TZ         = 'America/Bogota';
const GRACE_MIN  = 5;                              // minutos de tolerancia
const FOLDER_NAME = 'Cafam_Biologicos_Evidencias'; // carpeta de fotos en Drive

/* ================= Encabezados de las hojas ================= */
const H = {
  Ingresos:         ['FechaHora','Fecha','Cedula','Nombre','Placa','HorarioInicio','Estado','MinDiferencia','Lat','Lng','Direccion','FotoURL'],
  Maestro_Activos:  ['ID','Tipo','FechaAlta','Estado','SedeBase','Observaciones'],
  Lavado_Neveras:   ['FechaHora','Fecha','Cedula','Nombre','NeveraID','TipoLavado','FotoURL'],
  Cumplimiento_HSQ: ['FechaHora','Fecha','Cedula','Nombre','Formulario','Metodo','Codigo'],
  Alertas:          ['FechaHora','Fecha','Cedula','Nombre','Tipo','Detalle','Estado'],
  Cierres:          ['FechaHora','Fecha','Cedula','Nombre','Resultado']
};

/* ================= Enrutamiento ================= */
function doGet(e) {
  return json_({ ok: true, service: 'cafam-biologicos', hora: nowStr_() });
}

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);
    switch (req.action) {
      case 'login':   return json_(login_(req));
      case 'ingreso': return json_(ingreso_(req));
      case 'hsq':     return json_(hsq_(req));
      case 'lavado':  return json_(lavado_(req));
      case 'cerrar':  return json_(cerrar_(req));
      default:        return json_({ ok: false, error: 'Acción desconocida: ' + req.action });
    }
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ================= Acciones ================= */

// Login solo con cédula: si está en la malla de hoy, entra. Todo lo demás sale de la malla.
function login_(req) {
  const cedula = String(req.cedula || '').trim();
  if (!cedula) return { ok: false, error: 'Ingresa tu cédula.' };
  const c = lookupCourier_(cedula);
  if (!c) return { ok: false, error: 'Tu cédula no está en la malla de hoy. Avisa al coordinador.' };
  return { ok: true, courier: c };
}

function ingreso_(req) {
  const cedula = String(req.cedula || '').trim();
  const c = lookupCourier_(cedula);
  if (!c) return { ok: false, error: 'Cédula no está en la malla.' };

  const hor = parseHorarioInicio_(c.horario);
  let estado, minDif;
  if (!hor) { estado = 'Sin horario'; minDif = ''; }
  else {
    minDif = nowMinutes_() - hor.min;
    estado = (minDif > GRACE_MIN) ? 'TARDE' : 'A tiempo';
  }

  const direccion = reverseGeocode_(req.lat, req.lng);
  const fotoURL = saveFoto_(req.foto, 'ingreso_' + cedula);

  append_('Ingresos', [
    nowStr_(), today_(), cedula, c.nombre, c.placa, hor ? hor.str : '',
    estado, minDif, req.lat || '', req.lng || '', direccion, fotoURL
  ]);

  if (estado === 'TARDE') {
    append_('Alertas', [
      nowStr_(), today_(), cedula, c.nombre, 'Llegada tarde',
      'Marcó ' + minDif + ' min tarde (horario ' + hor.str + ')', 'Pendiente'
    ]);
  }

  return { ok: true, estado: estado, minutos: minDif, direccion: direccion, fotoURL: fotoURL };
}

function hsq_(req) {
  const cedula = String(req.cedula || '').trim();
  const c = lookupCourier_(cedula) || { nombre: '' };
  const form = String(req.formulario || '').trim(); // 'preoperacional' | 'limpieza_moto'
  append_('Cumplimiento_HSQ', [
    nowStr_(), today_(), cedula, c.nombre, form,
    String(req.metodo || 'confirmacion'), String(req.codigo || '')
  ]);
  return { ok: true };
}

function lavado_(req) {
  const cedula = String(req.cedula || '').trim();
  const c = lookupCourier_(cedula) || { nombre: '' };
  const neveraId = String(req.neveraId || '').trim();
  if (!neveraId) return { ok: false, error: 'Falta el ID de la nevera.' };
  const fotoURL = saveFoto_(req.foto, 'lavado_' + neveraId);
  append_('Lavado_Neveras', [
    nowStr_(), today_(), cedula, c.nombre, neveraId,
    String(req.tipoLavado || ''), fotoURL
  ]);
  return { ok: true, encontrada: activoExiste_(neveraId) };
}

function cerrar_(req) {
  const cedula = String(req.cedula || '').trim();
  const c = lookupCourier_(cedula) || { nombre: '' };
  const hoy = today_();

  const faltantes = [];
  if (!hayRegistro_('Ingresos', cedula, hoy))                              faltantes.push('Marcación de ingreso');
  if (!hayRegistro_('Cumplimiento_HSQ', cedula, hoy, 4, 'preoperacional')) faltantes.push('Preoperacional');
  if (!hayRegistro_('Cumplimiento_HSQ', cedula, hoy, 4, 'limpieza_moto'))  faltantes.push('Limpieza y desinfección moto');
  if (!hayRegistro_('Lavado_Neveras', cedula, hoy))                        faltantes.push('Lavado de nevera');

  if (faltantes.length) {
    append_('Alertas', [
      nowStr_(), hoy, cedula, c.nombre, 'Turno incompleto',
      'Faltó: ' + faltantes.join(', '), 'Pendiente'
    ]);
    return { ok: false, faltantes: faltantes };
  }
  append_('Cierres', [nowStr_(), hoy, cedula, c.nombre, 'Completo']);
  return { ok: true };
}

/* ================= Malla ================= */

// Detecta automáticamente la hoja de la malla buscando encabezados C.C y HORARIO.
function findMalla_() {
  const sheets = SpreadsheetApp.openById(SS_ID).getSheets();
  for (const sh of sheets) {
    const values = sh.getDataRange().getValues();
    for (let r = 0; r < Math.min(values.length, 12); r++) {
      const row = values[r].map(v => String(v).trim().toUpperCase());
      const hasCC = row.indexOf('C.C') >= 0;
      const hasHor = row.some(v => v.indexOf('HORARIO') >= 0);
      if (hasCC && hasHor) {
        const col = {};
        row.forEach((v, i) => {
          if (v === 'C.C') col.cc = i;
          else if (v.indexOf('NOMBRE') >= 0) col.nombre = i;
          else if (v === 'PLACA') col.placa = i;
          else if (v.indexOf('HORARIO') >= 0) col.horario = i;
          else if (v.indexOf('CONTRATO') >= 0) col.contrato = i;
          else if (v === 'VEHICULO') col.vehiculo = i;
          else if (v.indexOf('CELULAR') >= 0 || v.indexOf('CEL') === 0) col.celular = i;
        });
        return { values: values, headerIdx: r, col: col };
      }
    }
  }
  throw new Error('No se encontró la hoja de la malla (columnas C.C y HORARIO).');
}

function lookupCourier_(cedula) {
  const m = findMalla_();
  const c = m.col;
  const target = String(cedula).trim();
  for (let r = m.headerIdx + 1; r < m.values.length; r++) {
    const row = m.values[r];
    if (String(row[c.cc]).trim() === target) {
      return {
        cedula: target,
        nombre: String(row[c.nombre] || '').trim(),
        placa: String(row[c.placa] || '').trim(),
        horario: String(row[c.horario] || '').trim(),
        celular: c.celular != null ? String(row[c.celular] || '').trim() : '',
        contrato: c.contrato != null ? String(row[c.contrato] || '').trim() : '',
        vehiculo: c.vehiculo != null ? String(row[c.vehiculo] || '').trim() : ''
      };
    }
  }
  return null;
}

/* ================= Utilidades de hojas ================= */

function ensureSheet_(name) {
  const ss = SpreadsheetApp.openById(SS_ID);
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    const headers = H[name] || [];
    if (headers.length) {
      sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
      sh.setFrozenRows(1);
      // Columnas A (FechaHora/Cedula/ID) y B (Fecha) como texto: evita que Sheets
      // convierta "2026-07-15" o la cédula a número/fecha y rompa las comparaciones.
      sh.getRange('A:B').setNumberFormat('@');
    }
  }
  return sh;
}

function append_(name, row) {
  ensureSheet_(name).appendRow(row);
}

// ¿Existe una fila para esta cédula y fecha? (opcionalmente filtrando una columna)
// Normaliza la fecha porque Sheets suele convertir "2026-07-15" en un valor Date.
function hayRegistro_(name, cedula, fecha, colIdx, colVal) {
  const sh = ensureSheet_(name);
  const vals = sh.getDataRange().getValues();
  const objetivo = normFecha_(fecha);
  for (let r = 1; r < vals.length; r++) {
    if (String(vals[r][2]).trim() === String(cedula).trim() &&
        normFecha_(vals[r][1]) === objetivo) {
      if (colIdx == null) return true;
      if (String(vals[r][colIdx]).trim() === String(colVal).trim()) return true;
    }
  }
  return false;
}

// Devuelve 'yyyy-MM-dd' tanto si el valor es Date como si es texto.
// Para Date usa la zona horaria de la hoja (con la que Sheets creó el valor).
var _SSTZ = null;
function ssTz_() {
  if (!_SSTZ) _SSTZ = SpreadsheetApp.openById(SS_ID).getSpreadsheetTimeZone() || TZ;
  return _SSTZ;
}
function normFecha_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]')
    return Utilities.formatDate(v, ssTz_(), 'yyyy-MM-dd');
  return String(v).trim().substring(0, 10);
}

function activoExiste_(id) {
  const sh = ensureSheet_('Maestro_Activos');
  const vals = sh.getDataRange().getValues();
  for (let r = 1; r < vals.length; r++) {
    if (String(vals[r][0]).trim() === String(id).trim()) return true;
  }
  return false;
}

/* ================= Fotos / Geo / Tiempo ================= */

function getFolder_() {
  const it = DriveApp.getFoldersByName(FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER_NAME);
}

function saveFoto_(dataUrl, prefix) {
  if (!dataUrl) return '';
  const m = String(dataUrl).match(/^data:(image\/\w+);base64,(.+)$/);
  let contentType = 'image/jpeg', b64 = dataUrl;
  if (m) { contentType = m[1]; b64 = m[2]; }
  const ext = contentType.indexOf('png') >= 0 ? 'png' : 'jpg';
  const name = prefix + '_' + Utilities.formatDate(new Date(), TZ, 'yyyyMMdd_HHmmss') + '.' + ext;
  const blob = Utilities.newBlob(Utilities.base64Decode(b64), contentType, name);
  const file = getFolder_().createFile(blob);
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
  return file.getUrl();
}

function reverseGeocode_(lat, lng) {
  if (lat == null || lng == null || lat === '' || lng === '') return '';
  try {
    const r = Maps.newGeocoder().reverseGeocode(Number(lat), Number(lng));
    if (r && r.results && r.results.length) return r.results[0].formatted_address;
  } catch (e) {}
  return '';
}

// "7:00 - 16:00" -> { min: 420, str: "07:00" }
function parseHorarioInicio_(horario) {
  if (!horario) return null;
  const m = String(horario).match(/(\d{1,2})[:\.](\d{2})/);
  if (!m) return null;
  const h = parseInt(m[1], 10), mi = parseInt(m[2], 10);
  const hh = (h < 10 ? '0' : '') + h;
  return { min: h * 60 + mi, str: hh + ':' + m[2] };
}

function today_()  { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function nowStr_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss'); }
function nowMinutes_() {
  const h = parseInt(Utilities.formatDate(new Date(), TZ, 'HH'), 10);
  const mi = parseInt(Utilities.formatDate(new Date(), TZ, 'mm'), 10);
  return h * 60 + mi;
}

/* ================= Setup (ejecutar una vez) ================= */
function initSheets() {
  Object.keys(H).forEach(ensureSheet_);
  getFolder_();
  SpreadsheetApp.openById(SS_ID).toast('Hojas y carpeta de evidencias listas.', 'Cafam Biológicos', 5);
}
