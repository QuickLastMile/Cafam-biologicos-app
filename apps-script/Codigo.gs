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
  Cierres:          ['FechaHora','Fecha','Cedula','Nombre','Turno','HoraIngreso','HoraSalida','Resultado'],
  Config:           ['Clave','Valor','Descripcion']
};

/* ================= Enrutamiento ================= */
function doGet(e) {
  try {
    const p = (e && e.parameter) || {};
    if (p.action === 'dashboard') {
      if (!validToken_(p.token)) return json_({ ok: false, error: 'Token inválido.' });
      return json_(dashboardData_(p.fecha || today_()));
    }
    return json_({ ok: true, service: 'cafam-biologicos', hora: nowStr_() });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
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
  const cfg = getConfig_();
  return {
    ok: true,
    courier: c,
    config: {
      preoperacional: cfg.HSQ_PREOPERACIONAL_URL || '',
      limpieza_moto:  cfg.HSQ_LIMPIEZA_MOTO_URL || ''
    }
  };
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

  // Prefiere la dirección calculada en el cliente (la misma de la marca de agua).
  const direccion = (req.direccion && String(req.direccion).trim()) || reverseGeocode_(req.lat, req.lng);
  const fotoURL = saveFoto_(req.foto, 'ingreso_' + cedula);

  append_('Ingresos', [
    nowStr_(), today_(), cedula, c.nombre, c.placa, hor ? hor.str : '',
    estado, minDif, req.lat || '', req.lng || '', direccion, fotoURL
  ]);

  // Estado del turno en la hoja Cierres: pasa a "En turno" con hora de ingreso.
  upsertCierre_(cedula, c.nombre, today_(), {
    Turno: c.horario, HoraIngreso: nowHora_(), Resultado: 'En turno'
  });

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
  upsertCierre_(cedula, c.nombre, hoy, { HoraSalida: nowHora_(), Resultado: 'Completo' });
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

// Lee la hoja Config como objeto { Clave: Valor }.
function getConfig_() {
  const sh = ensureSheet_('Config');
  const vals = sh.getDataRange().getValues();
  const o = {};
  for (let r = 1; r < vals.length; r++) {
    const k = String(vals[r][0]).trim();
    if (k) o[k] = String(vals[r][1]).trim();
  }
  return o;
}

// Crea o actualiza la fila de estado de turno (una por cédula + fecha) en Cierres.
// campos: { Turno, HoraIngreso, HoraSalida, Resultado } (solo los que se pasen).
function upsertCierre_(cedula, nombre, fecha, campos) {
  const sh = ensureSheet_('Cierres');
  const idx = { FechaHora:0, Fecha:1, Cedula:2, Nombre:3, Turno:4, HoraIngreso:5, HoraSalida:6, Resultado:7 };
  const vals = sh.getDataRange().getValues();
  const objetivo = normFecha_(fecha);
  let fila = -1;
  for (let r = 1; r < vals.length; r++) {
    if (String(vals[r][2]).trim() === String(cedula).trim() && normFecha_(vals[r][1]) === objetivo) { fila = r; break; }
  }
  if (fila === -1) {
    const base = { FechaHora: nowStr_(), Fecha: fecha, Cedula: cedula, Nombre: nombre,
                   Turno: '', HoraIngreso: '', HoraSalida: '', Resultado: '' };
    Object.keys(campos || {}).forEach(k => { if (k in base) base[k] = campos[k]; });
    sh.appendRow([base.FechaHora, base.Fecha, base.Cedula, base.Nombre,
                  base.Turno, base.HoraIngreso, base.HoraSalida, base.Resultado]);
  } else {
    const rowIdx = fila + 1;
    sh.getRange(rowIdx, idx.FechaHora + 1).setValue(nowStr_());
    Object.keys(campos || {}).forEach(k => {
      if (idx[k] != null) sh.getRange(rowIdx, idx[k] + 1).setValue(campos[k]);
    });
  }
}

// Siembra en Cierres una fila "Pendiente" por cada moto CAFAM de la malla de hoy
// que aún no tenga registro. Correr en la mañana (manual o con activador diario).
function sembrarPendientesHoy() {
  const hoy = today_();
  const m = findMalla_(); const c = m.col;
  const sh = ensureSheet_('Cierres');
  const vals = sh.getDataRange().getValues();
  const yaHay = {};
  for (let r = 1; r < vals.length; r++) {
    if (normFecha_(vals[r][1]) === hoy) yaHay[String(vals[r][2]).trim()] = true;
  }
  let n = 0;
  for (let r = m.headerIdx + 1; r < m.values.length; r++) {
    const row = m.values[r];
    const cedula = String(row[c.cc] || '').trim();
    if (!cedula || yaHay[cedula]) continue;
    const vehiculo = c.vehiculo != null ? String(row[c.vehiculo] || '').toUpperCase() : '';
    const contrato = c.contrato != null ? String(row[c.contrato] || '').toUpperCase() : '';
    if (vehiculo.indexOf('MOTO') < 0 || contrato.indexOf('CAFAM') < 0) continue;
    sh.appendRow([nowStr_(), hoy, cedula, String(row[c.nombre] || '').trim(),
                  String(row[c.horario] || '').trim(), '', '', 'Pendiente']);
    n++;
  }
  SpreadsheetApp.openById(SS_ID).toast('Sembrados ' + n + ' turnos pendientes de hoy.', 'Cafam Biológicos', 5);
}

/* ================= Tablero del cliente (lectura) ================= */

function validToken_(token) {
  const t = (getConfig_().DASHBOARD_TOKEN || '').trim();
  if (!t) return true;                       // sin token: tablero abierto (solo con la URL)
  return String(token || '').trim() === t;
}

function dashboardData_(fecha) {
  const f = normFecha_(fecha);
  return {
    ok: true,
    fecha: f,
    generado: nowStr_(),
    ingresos: leerHoja_('Ingresos', f),
    lavados:  leerHoja_('Lavado_Neveras', f),
    turnos:   leerHoja_('Cierres', f),
    alertas:  leerHoja_('Alertas', f),
    neveras:  estadoNeveras_()
  };
}

// Devuelve las filas de una hoja (opcionalmente filtrando por Fecha en la col B) como objetos.
function leerHoja_(name, fecha) {
  const sh = ensureSheet_(name);
  const vals = sh.getDataRange().getValues();
  if (vals.length < 2) return [];
  const headers = vals[0];
  const out = [];
  for (let r = 1; r < vals.length; r++) {
    if (fecha && normFecha_(vals[r][1]) !== fecha) continue;
    const o = {};
    headers.forEach((h, i) => { o[h] = celda_(vals[r][i]); });
    out.push(o);
  }
  return out;
}

// Convierte celdas Date (fecha/hora que Sheets coacciona) a texto legible.
function celda_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') {
    if (v.getFullYear() === 1899) return Utilities.formatDate(v, ssTz_(), 'HH:mm:ss');
    if (v.getHours() === 0 && v.getMinutes() === 0 && v.getSeconds() === 0)
      return Utilities.formatDate(v, ssTz_(), 'yyyy-MM-dd');
    return Utilities.formatDate(v, ssTz_(), 'yyyy-MM-dd HH:mm:ss');
  }
  return v;
}

// Estado de cada nevera: último lavado con alcohol y último exhaustivo (cada 8 días).
function estadoNeveras_() {
  const activos = ensureSheet_('Maestro_Activos').getDataRange().getValues();
  const lav = ensureSheet_('Lavado_Neveras').getDataRange().getValues();
  const last = {}; // id -> { alcohol, exhaustivo } (fechas 'yyyy-MM-dd')
  for (let r = 1; r < lav.length; r++) {
    const id = String(lav[r][4]).trim(); if (!id) continue;
    const f = normFecha_(lav[r][1]);
    const tipo = String(lav[r][5]).toLowerCase();
    last[id] = last[id] || { alcohol: '', exhaustivo: '' };
    if (tipo.indexOf('exhaust') >= 0) { if (f > last[id].exhaustivo) last[id].exhaustivo = f; }
    else { if (f > last[id].alcohol) last[id].alcohol = f; }
  }
  const hoy = today_();
  const out = [];
  for (let r = 1; r < activos.length; r++) {
    const tipo = String(activos[r][1] || '').toLowerCase();
    if (tipo.indexOf('nevera') < 0) continue;
    const id = String(activos[r][0]).trim(); if (!id) continue;
    const l = last[id] || { alcohol: '', exhaustivo: '' };
    const dSinExh = diasEntre_(l.exhaustivo, hoy);
    out.push({
      id: id,
      ultimoAlcohol: l.alcohol,
      ultimoExhaustivo: l.exhaustivo,
      diasSinAlcohol: diasEntre_(l.alcohol, hoy),
      diasSinExhaustivo: dSinExh,
      exhaustivoVencido: (l.exhaustivo === '') ? true : (dSinExh > 8)
    });
  }
  return out;
}

function diasEntre_(f1, f2) {
  if (!f1) return '';
  const a = new Date(f1 + 'T00:00:00'), b = new Date(f2 + 'T00:00:00');
  return Math.round((b - a) / 86400000);
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

function today_()   { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function nowStr_()  { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss'); }
function nowHora_() { return Utilities.formatDate(new Date(), TZ, 'HH:mm:ss'); }
function nowMinutes_() {
  const h = parseInt(Utilities.formatDate(new Date(), TZ, 'HH'), 10);
  const mi = parseInt(Utilities.formatDate(new Date(), TZ, 'mm'), 10);
  return h * 60 + mi;
}

/* ================= Setup (ejecutar una vez) ================= */
function initSheets() {
  Object.keys(H).forEach(ensureSheet_);
  seedConfig_();
  getFolder_();
  SpreadsheetApp.openById(SS_ID).toast('Hojas, config y carpeta de evidencias listas.', 'Cafam Biológicos', 5);
}

// Siembra los valores por defecto de Config solo si está vacía.
function seedConfig_() {
  const sh = ensureSheet_('Config');
  if (sh.getLastRow() >= 2) return;
  sh.getRange(2, 1, 5, 3).setValues([
    ['HSQ_PREOPERACIONAL_URL', 'https://forms.gle/WkcL2o5uYztN7XxR9', 'Link del formulario PREOPERACIONAL (HSQ). Cámbialo aquí cuando HSQ envíe uno nuevo.'],
    ['HSQ_LIMPIEZA_MOTO_URL',  'https://forms.gle/YeqaDuqV9kNzoEDx5', 'Link del formulario de LIMPIEZA Y DESINFECCIÓN de moto (HSQ). Cámbialo aquí.'],
    ['RESP_PREOPERACIONAL',    '', '(Opcional) URL o ID de la hoja de respuestas del preoperacional, para cruce automático futuro.'],
    ['RESP_LIMPIEZA_MOTO',     '', '(Opcional) URL o ID de la hoja de respuestas de limpieza de moto.'],
    ['DASHBOARD_TOKEN',        '', '(Opcional) Clave para proteger el tablero del cliente. Vacío = abierto (solo con la URL).']
  ]);
  sh.autoResizeColumns(1, 3);
}

// Menú en el Sheet para operar sin abrir el editor.
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Cafam Biológicos')
    .addItem('Inicializar hojas y config', 'initSheets')
    .addItem('Sembrar turnos pendientes (hoy)', 'sembrarPendientesHoy')
    .addToUi();
}
