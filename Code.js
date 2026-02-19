/**
 * Trayectorias Secundaria - Backend (Google Apps Script)
 * Opción B de seguridad: API key en Script Properties (no usar headers para evitar CORS/preflight).
 *
 * Requisitos en la Google Sheet (nombres exactos de pestañas):
 *  - Estudiantes
 *  - MateriasCatalogo
 *  - EstadoPorCiclo
 *  - (Opcional) Auditoria
 *
 * La primera fila de cada hoja debe ser encabezados.
 */

const SHEETS = {
  ESTUDIANTES: 'Estudiantes',
  CATALOGO: 'MateriasCatalogo',
  ESTADO: 'EstadoPorCiclo',
  AUDITORIA: 'Auditoria'
};

const PROP_API_KEY = 'TRAYECTORIAS_API_KEY';

// ======== Menú (si el script está vinculado a la planilla) ========
function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu('📘 Trayectorias')
      .addItem('🔑 Generar/Mostrar API Key', 'setupApiKey')
      .addItem('🧪 Probar API (ping)', 'testPing')
      .addItem('🗓️ Crear ciclo nuevo (rollover)', 'uiRolloverCycle')
      .addToUi();
  } catch (err) {
    // Si no está vinculado a una planilla, no pasa nada.
  }
}

function setupApiKey() {
  const props = PropertiesService.getScriptProperties();
  let key = props.getProperty(PROP_API_KEY);
  if (!key) {
    key = Utilities.getUuid();
    props.setProperty(PROP_API_KEY, key);
  }
  try {
    SpreadsheetApp.getUi().alert('API Key (guardala):\n\n' + key + '\n\nPodés rotarla borrando la propiedad ' + PROP_API_KEY + ' y ejecutando de nuevo.');
  } catch (err) {
    Logger.log('API Key: ' + key);
  }
  return key;
}

function testPing() {
  const res = handleRequest_({ apiKey: PropertiesService.getScriptProperties().getProperty(PROP_API_KEY), action: 'ping', payload: {} });
  try {
    SpreadsheetApp.getUi().alert(JSON.stringify(res, null, 2));
  } catch (err) {
    Logger.log(JSON.stringify(res));
  }
}


function uiRolloverCycle() {
  const ui = SpreadsheetApp.getUi();
  const origen = ui.prompt('Crear ciclo nuevo', 'Año origen (ej. 2026):', ui.ButtonSet.OK_CANCEL);
  if (origen.getSelectedButton() !== ui.Button.OK) return;
  const destino = ui.prompt('Crear ciclo nuevo', 'Año destino (ej. 2027):', ui.ButtonSet.OK_CANCEL);
  if (destino.getSelectedButton() !== ui.Button.OK) return;

  const payload = {
    ciclo_origen: String(origen.getResponseText() || '').trim(),
    ciclo_destino: String(destino.getResponseText() || '').trim(),
    usuario: 'menu'
  };

  const res = rolloverCycle_(payload);
  ui.alert('Rollover completado:\n\n' + JSON.stringify(res, null, 2));
}

// ======== Web App entrypoint ========
function doPost(e) {
  try {
    const body = (e && e.postData && e.postData.contents) ? e.postData.contents : '';
    const req = body ? JSON.parse(body) : {};
    const result = handleRequest_(req);
    return jsonOut_(result, 200);
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err), stack: (err && err.stack) ? String(err.stack) : null }, 500);
  }
}

// (Opcional) simple GET informativo
function doGet() {
  return jsonOut_({
    ok: true,
    service: 'Trayectorias Backend',
    endpoints: ['POST {apiKey, action, payload}'],
    actions: ['ping','getCycles','getCatalog','getStudentList','getStudentStatus','saveStudentStatus','syncCatalogRows','rolloverCycle','getDivisionRiskSummary','closeCycle']
  }, 200);
}

// ======== Router ========
function handleRequest_(req) {
  const apiKey = (req && req.apiKey) ? String(req.apiKey) : '';
  const action = (req && req.action) ? String(req.action) : '';
  const payload = (req && req.payload) ? req.payload : {};

  assertAuthorized_(apiKey);

  switch (action) {
    case 'ping':
      return { ok: true, now: new Date().toISOString() };

    case 'getCycles':
      return { ok: true, cycles: getCycles_() };

    case 'getCatalog':
      return { ok: true, catalog: getCatalog_() };

    case 'getStudentList':
      return { ok: true, students: getStudentList_(payload) };

    case 'getStudentStatus':
      return { ok: true, data: getStudentStatus_(payload) };

    case 'saveStudentStatus':
      return { ok: true, data: saveStudentStatus_(payload) };

    case 'updateStudentOrientation':
      return { ok: true, data: updateStudentOrientation_(payload) };

    case 'syncCatalogRows':
      return { ok: true, data: syncCatalogRows_(payload) };

    case 'rolloverCycle':
      return { ok: true, data: rolloverCycle_(payload) };

    case 'getDivisionRiskSummary':
      return { ok: true, data: getDivisionRiskSummary_(payload) };

    case 'closeCycle':
      return { ok: true, data: closeCycle_(payload) };

    default:
      return { ok: false, error: 'Acción desconocida: ' + action };
  }
}

// ======== Auth ========
function assertAuthorized_(apiKey) {
  const props = PropertiesService.getScriptProperties();
  const realKey = props.getProperty(PROP_API_KEY);
  if (!realKey) {
    throw new Error('No hay API Key configurada. Ejecutá setupApiKey() en el editor.');
  }
  if (!apiKey || apiKey !== realKey) {
    const err = new Error('No autorizado: API Key inválida.');
    err.code = 403;
    throw err;
  }
}

// ======== Helpers Sheets ========
function ss_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('No se encontró ActiveSpreadsheet. Vinculá este script a la Google Sheet.');
  return ss;
}

function sheet_(name) {
  const sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('No existe la pestaña: ' + name);
  return sh;
}

function getValues_(sh) {
  const range = sh.getDataRange();
  const values = range.getValues();
  if (!values || values.length < 1) return { headers: [], rows: [] };
  const headers = values[0].map(h => String(h).trim());
  const rows = values.slice(1);
  return { headers, rows };
}

function headerMap_(headers) {
  const map = {};
  headers.forEach((h, i) => { map[h] = i; });
  return map;
}

function rowToObj_(headers, row) {
  const o = {};
  headers.forEach((h, i) => { o[h] = row[i]; });
  return o;
}

function toBool_(v) {
  if (v === true || v === false) return v;
  const s = String(v).trim().toLowerCase();
  if (s === 'true' || s === 'verdadero' || s === 'si' || s === 'sí' || s === '1') return true;
  if (s === 'false' || s === 'falso' || s === 'no' || s === '0' || s === '') return false;
  return false;
}

function isoNow_() {
  return new Date().toISOString();
}

// Asegura que exista una columna en EstadoPorCiclo. Si no existe, la crea al final.
function ensureEstadoColumn_(colName) {
  const sh = sheet_(SHEETS.ESTADO);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(h => String(h).trim());
  const idx = headers.indexOf(colName);
  if (idx !== -1) return idx; // 0-based
  const newCol = headers.length + 1;
  sh.getRange(1, newCol).setValue(colName);
  return newCol - 1;
}

function ensureEstadoColumns_(names) {
  (names || []).forEach(n => ensureEstadoColumn_(n));
}


// Asegura que exista una columna en Estudiantes. Si no existe, la crea al final.
function ensureEstudiantesColumn_(colName) {
  const sh = sheet_(SHEETS.ESTUDIANTES);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(h => String(h).trim());
  const idx = headers.indexOf(colName);
  if (idx !== -1) return idx; // 0-based
  const newCol = headers.length + 1;
  sh.getRange(1, newCol).setValue(colName);

  // Inicializar valores en filas existentes (para evitar undefined)
  const lastRow = sh.getLastRow();
  if (lastRow > 1) {
    // Por defecto: egresado FALSE / anio_egreso vacío
    const v = (String(colName) === 'egresado') ? false : '';
    sh.getRange(2, newCol, lastRow - 1, 1).setValues(Array(lastRow - 1).fill([v]));
  }
  return newCol - 1;
}

function ensureEstudiantesColumns_(names) {
  (names || []).forEach(n => ensureEstudiantesColumn_(n));
}

// Helpers para promo de división (ej: 4°A -> 5°A)
function promoDivision_(division) {
  const s = String(division || '').trim();
  if (!s) return { ok: false, value: s };
  // Captura un número inicial y el resto (incluye letra)
  const m = s.match(/^\s*(\d+)\s*(.*)$/);
  if (!m) return { ok: false, value: s };
  const n = Number(m[1]);
  if (isNaN(n)) return { ok: false, value: s };
  const rest = (m[2] || '').trim();
  const next = n + 1;
  // Mantener símbolo de grado si estaba presente
  const hasDegree = /°/.test(s);
  const sep = rest ? '' : '';
  const deg = hasDegree ? '°' : '';
  // Si rest ya empieza con °, no duplicar
  let cleanedRest = rest;
  if (cleanedRest.startsWith('°')) cleanedRest = cleanedRest.slice(1).trim();
  return { ok: true, value: `${next}${deg}${cleanedRest ? cleanedRest : ''}`.replace(/\s+/g,' ').trim() };
}

// ======== Actions ========

function getCycles_() {
  const sh = sheet_(SHEETS.ESTADO);
  let { headers, rows } = getValues_(sh);
  let idx = headerMap_(headers);
  const set = {};
  rows.forEach(r => {
    const c = String(r[idx['ciclo_lectivo']] || '').trim();
    if (c) set[c] = true;
  });
  const cycles = Object.keys(set);
  cycles.sort((a,b) => (Number(b) - Number(a)) || String(b).localeCompare(String(a)));
  return cycles;
}

/**
 * Rollover anual: crea filas del nuevo ciclo lectivo SIN tocar ciclos anteriores.
 * - condicion_academica: si alguna vez estuvo aprobada => aprobada; si no => adeuda.
 * - nunca_cursada: TRUE si nunca tuvo cursada regular (cursa_primera_vez o recursa) y no está aprobada.
 * - situacion_actual: se resetea a 'no_cursa_otro_motivo' (neutral).
 *
 * payload: {ciclo_origen, ciclo_destino, usuario, update_students?:boolean, update_division?:boolean}
 */
function rolloverCycle_(payload) {
  const origen = String(payload.ciclo_origen || '').trim();
  const destino = String(payload.ciclo_destino || '').trim();
  const usuario = String(payload.usuario || 'rollover').trim();

  // Por pedido: por defecto SI promociona estudiantes (anio_actual +1)
  const updateStudents = (payload.update_students !== undefined) ? toBool_(payload.update_students) : true;
  const updateDivision = (payload.update_division !== undefined) ? toBool_(payload.update_division) : true;

  if (!origen) throw new Error('Falta payload.ciclo_origen');
  if (!destino) throw new Error('Falta payload.ciclo_destino');
  if (origen === destino) throw new Error('ciclo_origen y ciclo_destino no pueden ser iguales');

  const cycles = getCycles_();
  const origenExiste = cycles.indexOf(origen) !== -1;

  const students = getStudentList_({}); // activos
  const catalog = getCatalog_();

  const sh = sheet_(SHEETS.ESTADO);

  // --- 1) Crear filas faltantes del ciclo destino (como antes) ---
  let tmp = getValues_(sh);
  let headers = tmp.headers;
  let rows = tmp.rows;
  let idx = headerMap_(headers);

  const destNum = Number(destino);
  const hasDestNum = !isNaN(destNum);

  const approvedMap = {}; // key sid|mid -> true
  const regularMap = {};  // key sid|mid -> true (alguna vez cursó regular)
  const existsDest = {};  // key sid|mid -> true

  // Helpers para egreso: adeudadas en origen (sin contar años futuros)
  const catalogYearByMid0 = {};
  catalog.forEach(m => {
    const mid = String(m.id_materia || '').trim();
    const y = Number(m.anio || '');
    if (mid && !isNaN(y) && y > 0) catalogYearByMid0[mid] = y;
  });

  const oldYearByStudent0 = {};
  students.forEach(s => {
    const y = Number(s.anio_actual || '');
    oldYearByStudent0[s.id_estudiante] = (!isNaN(y) && y > 0) ? Math.min(y, 6) : null;
  });

  const owedInOrigen0 = {}; // sid -> { mid:true }
  if (origenExiste) {
    rows.forEach(r => {
      const c = String(r[idx['ciclo_lectivo']] || '').trim();
      if (c !== origen) return;

      const sid = String(r[idx['id_estudiante']] || '').trim();
      if (!sid) return;

      const cond = String(r[idx['condicion_academica']] || '').trim().toLowerCase();
      if (cond !== 'adeuda') return;

      const mid = String(r[idx['id_materia']] || '').trim();
      if (!mid) return;

      const oy = oldYearByStudent0[sid];
      const my = catalogYearByMid0[mid];

      // Si tenemos año de materia y del/la estudiante, no consideramos futuros como "adeuda"
      if (oy && my && my > oy) return;

      if (!owedInOrigen0[sid]) owedInOrigen0[sid] = {};
      owedInOrigen0[sid][mid] = true;
    });
  }


  rows.forEach(r => {
    const ciclo = String(r[idx['ciclo_lectivo']] || '').trim();
    const sid = String(r[idx['id_estudiante']] || '').trim();
    const mid = String(r[idx['id_materia']] || '').trim();
    if (!ciclo || !sid || !mid) return;

    const key = sid + '|' + mid;

    if (ciclo === destino) {
      existsDest[key] = true;
      return;
    }

    // Considerar solo ciclos anteriores al destino si los ciclos son numéricos.
    if (hasDestNum) {
      const cNum = Number(ciclo);
      if (!isNaN(cNum) && cNum >= destNum) return;
    }

    const cond = String(r[idx['condicion_academica']] || '').trim().toLowerCase();
    const sit = String(r[idx['situacion_actual']] || '').trim();
    const resCierre = (idx['resultado_cierre'] !== undefined) ? String(r[idx['resultado_cierre']] || '').trim().toLowerCase() : '';

    if (cond === 'aprobada') approvedMap[key] = true;
    if (resCierre === 'aprobada' || resCierre === 'aprobo' || resCierre === 'aprobó') approvedMap[key] = true;
    if (sit === 'cursa_primera_vez' || sit === 'recursa') regularMap[key] = true;
  });

  const now = new Date();
  const newRows = [];
  let created = 0;
  let skipped = 0;

  students.forEach(s => {
    const sid = s.id_estudiante;

    // En el ciclo destino, el año puede promocionarse (+1) según updateStudents.
    const oldYear = Number(s.anio_actual || '');
    const targetGrade = (!isNaN(oldYear) && oldYear > 0) ? (updateStudents ? Math.min(oldYear + 1, 6) : Math.min(oldYear, 6)) : null;
    const sDest = Object.assign({}, s, { anio_actual: targetGrade });

    // Catálogo filtrado por orientación (si aplica)
    const allowedCatalogBase = filterCatalogForStudent_(catalog, sDest);

    // Si egresó (venía de 6º en el ciclo origen), en el ciclo destino solo seguimos las materias ADEUDADAS
    // para que pueda cerrar pendientes sin “cargar” materias nuevas.
    let allowedCatalog = allowedCatalogBase;
    if (updateStudents && oldYear === 6 && origenExiste) {
      const owedSet = owedInOrigen0[sid] || null;
      allowedCatalog = owedSet ? allowedCatalogBase.filter(m => !!owedSet[String(m.id_materia || '').trim()]) : [];
    }

    allowedCatalog.forEach(m => {
      const mid = m.id_materia;
      const key = sid + '|' + mid;

      if (existsDest[key]) { skipped++; return; }

      const approved = !!approvedMap[key];
      const everRegular = !!regularMap[key];

      const condicion = approved ? 'aprobada' : 'adeuda';
      const nunca = approved ? false : !everRegular;

      const obj = {};
      headers.forEach(h => obj[h] = '');

      obj['ciclo_lectivo'] = destino;
      obj['id_estudiante'] = sid;
      obj['id_materia'] = mid;

      if (obj.hasOwnProperty('condicion_academica')) obj['condicion_academica'] = condicion;
      if (obj.hasOwnProperty('nunca_cursada')) obj['nunca_cursada'] = nunca;
      if (obj.hasOwnProperty('situacion_actual')) obj['situacion_actual'] = 'no_cursa_otro_motivo';
      if (obj.hasOwnProperty('resultado_cierre')) obj['resultado_cierre'] = '';
      if (obj.hasOwnProperty('ciclo_cerrado')) obj['ciclo_cerrado'] = false;
      if (obj.hasOwnProperty('motivo_no_cursa')) obj['motivo_no_cursa'] = '';
      if (obj.hasOwnProperty('fecha_actualizacion')) obj['fecha_actualizacion'] = now;
      if (obj.hasOwnProperty('usuario')) obj['usuario'] = usuario;

      newRows.push(headers.map(h => obj[h]));
      created++;
    });
  });

  if (newRows.length) {
    sh.getRange(sh.getLastRow() + 1, 1, newRows.length, headers.length).setValues(newRows);
  }

  // --- 2) Promoción de estudiantes (anio_actual +1) ---
  let promoInfo = null;
  if (updateStudents) {
    promoInfo = updateStudentsOnRollover_(usuario, destino);
  }

  // --- 3) Ajuste automático del plan anual en el ciclo destino (12 regular + 4 intensifica) ---
  // Re-leemos EstadoPorCiclo para incluir filas recién creadas
  tmp = getValues_(sh);
  headers = tmp.headers;
  rows = tmp.rows;
  idx = headerMap_(headers);

  // Mapas auxiliares
  const activeSet = {};
  const oldYearByStudent = {};
  const newGradeByStudent = {};
  students.forEach(s => {
    activeSet[s.id_estudiante] = true;
    const oldYear = Number(s.anio_actual || '');
    oldYearByStudent[s.id_estudiante] = (!isNaN(oldYear) && oldYear > 0) ? Math.min(oldYear, 6) : null;
    newGradeByStudent[s.id_estudiante] = (!isNaN(oldYear) && oldYear > 0) ? Math.min(oldYear + 1, 6) : null;
  });

  const catalogByYear = {};
  const catalogYearByMid = {};
  catalog.forEach(m => {
    const y = Number(m.anio || '');
    if (isNaN(y) || y <= 0) return;
    if (!catalogByYear[y]) catalogByYear[y] = [];
    const mid = String(m.id_materia);
    catalogByYear[y].push(mid);
    catalogYearByMid[mid] = y;
  });

  // Adeudadas del ciclo origen (solo si existe)
  // Solo cuentan adeudadas de años que el/la estudiante ya debía haber cursado en el ciclo origen
  // (evita que materias de años futuros se consideren “adeudadas”).
  const owedByStudent = {};
  if (origenExiste) {
    rows.forEach(r => {
      const c = String(r[idx['ciclo_lectivo']] || '').trim();
      if (c !== origen) return;

      const sid = String(r[idx['id_estudiante']] || '').trim();
      if (!activeSet[sid]) return;

      const mid = String(r[idx['id_materia']] || '').trim();
      if (!mid) return;

      const cond = String(r[idx['condicion_academica']] || '').trim().toLowerCase();
      if (cond !== 'adeuda') return;

      const oldYear = oldYearByStudent[sid];
      const matYear = catalogYearByMid[mid] || null;

      // Si no tenemos año de la materia, la dejamos contar (mejor no ocultar adeudas reales)
      const isFutureInOrigen = (oldYear && matYear && matYear > oldYear);
      if (isFutureInOrigen) return;

      if (!owedByStudent[sid]) owedByStudent[sid] = [];
      owedByStudent[sid].push(mid);
    });
  }

// Map row index (destino) for fast updates
  const destRowIndex = {}; // sid|mid -> i
  rows.forEach((r, i) => {
    const c = String(r[idx['ciclo_lectivo']] || '').trim();
    if (c !== destino) return;
    const sid = String(r[idx['id_estudiante']] || '').trim();
    const mid = String(r[idx['id_materia']] || '').trim();
    if (!sid || !mid) return;
    if (!activeSet[sid]) return;
    destRowIndex[sid + '|' + mid] = i;
  });

  // Primero: resetear campos del destino para estudiantes activos (para evitar basura previa)
  // Además: materias de años FUTUROS quedan como "proximos_anos".
  rows.forEach((r, i) => {
    const c = String(r[idx['ciclo_lectivo']] || '').trim();
    if (c !== destino) return;

    const sid = String(r[idx['id_estudiante']] || '').trim();
    if (!activeSet[sid]) return;

    const mid = String(r[idx['id_materia']] || '').trim();
    const newYear = newGradeByStudent[sid];

    const matYear = catalogYearByMid[mid] || null;
    const isFuture = (newYear && matYear && matYear > newYear);

    if (idx['situacion_actual'] !== undefined) r[idx['situacion_actual']] = isFuture ? 'proximos_anos' : 'no_cursa_otro_motivo';
    if (idx['motivo_no_cursa'] !== undefined) r[idx['motivo_no_cursa']] = isFuture ? 'Próximos años (aún no corresponde)' : '';
    if (idx['resultado_cierre'] !== undefined) r[idx['resultado_cierre']] = '';
    if (idx['ciclo_cerrado'] !== undefined) r[idx['ciclo_cerrado']] = false;
    if (idx['fecha_actualizacion'] !== undefined) r[idx['fecha_actualizacion']] = now;
    if (idx['usuario'] !== undefined) r[idx['usuario']] = usuario;
  });


  let revisionManualCount = 0;

  function setDest_(sid, mid, fields) {
    const key = sid + '|' + mid;
    const ri = destRowIndex[key];
    if (ri === undefined) return;
    const r = rows[ri];
    Object.keys(fields).forEach(f => {
      if (idx[f] !== undefined) r[idx[f]] = fields[f];
    });
    if (idx['fecha_actualizacion'] !== undefined) r[idx['fecha_actualizacion']] = now;
    if (idx['usuario'] !== undefined) r[idx['usuario']] = usuario;
  }

  students.forEach(s => {
    const sid = s.id_estudiante;
    const newYear = newGradeByStudent[sid];
    if (!newYear) return;

    const newYearMats = (catalogByYear[newYear] || []).slice();
    const owedAll = (owedByStudent[sid] || []).slice();

    // Tope: intensifica máx 4 adeudadas
    const intensifica = owedAll.slice(0, 4);
    const remainingOwed = owedAll.slice(4);

    let primera = [];
    let recursa = [];
    let droppedNew = [];
    let overflowOwed = [];

    if (newYear === 6) {
      // Regla especial: 6to tiene prioridad
      primera = newYearMats.slice();

      // Tope 12 (raro que 6to supere 12, pero lo respetamos igual)
      if (primera.length > 12) {
        droppedNew = primera.slice(12);
        primera = primera.slice(0, 12);
      }

      const slots = 12 - primera.length;
      if (slots > 0) {
        recursa = remainingOwed.slice(0, slots);
        overflowOwed = remainingOwed.slice(slots);
      } else {
        overflowOwed = remainingOwed.slice();
      }
    } else {
      // Base: cursa todo el año por 1ra vez, pero:
      // si hay muchas adeudadas, las recursa y puede sacar materias de 1ra vez por tope 12.
      const recMax = Math.min(remainingOwed.length, 12);
      recursa = remainingOwed.slice(0, recMax);
      overflowOwed = remainingOwed.slice(recMax);

      const capacityForPrimera = Math.max(0, 12 - recursa.length);
      primera = newYearMats.slice(0, capacityForPrimera);
      droppedNew = newYearMats.slice(capacityForPrimera);
    }

    // Aplicar al destino
    primera.forEach(mid => setDest_(sid, mid, { situacion_actual: 'cursa_primera_vez' }));
    recursa.forEach(mid => setDest_(sid, mid, { situacion_actual: 'recursa' }));
    intensifica.forEach(mid => setDest_(sid, mid, { situacion_actual: 'intensifica' }));

    droppedNew.forEach(mid => setDest_(sid, mid, { situacion_actual: 'no_cursa_por_tope', motivo_no_cursa: 'No cursa por tope 12 (prioriza adeudadas)' }));
    overflowOwed.forEach(mid => setDest_(sid, mid, { situacion_actual: 'no_cursa_por_tope', motivo_no_cursa: 'No cursa por tope 12 (exceso de adeudadas)' }));

    if (droppedNew.length > 0 || overflowOwed.length > 0) revisionManualCount++;
  });

  // Guardar cambios en EstadoPorCiclo (reescribimos todo el rango de datos)
  if (rows.length) {
    sh.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }

  return {
    ciclo_origen: origen,
    ciclo_destino: destino,
    origen_existe: origenExiste,
    estudiantes_procesados: students.length,
    materias_catalogo: catalog.length,
    filas_creadas: created,
    filas_omitidas_ya_existian: skipped,
    estudiantes_promovidos: promoInfo ? promoInfo.estudiantes_actualizados : 0,
    divisiones_actualizadas: promoInfo ? promoInfo.division_actualizada : 0,
    estudiantes_omitidos_promo: promoInfo ? promoInfo.omitidos : 0,
    estudiantes_revision_manual: revisionManualCount
  };
}



function parseYear_(v) {
  // Acepta números o strings tipo "3", "3°", "3ro", "Año 3"
  if (v === null || v === undefined) return NaN;
  const s = String(v).trim();
  if (!s) return NaN;
  const m = s.match(/\d+/);
  if (!m) return NaN;
  const n = Number(m[0]);
  return isNaN(n) ? NaN : n;
}

// ======== Orientaciones (4º a 6º) ========

function normalizeOrient_(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// Devuelve true si una materia del catálogo aplica para un/a estudiante según orientación y año.
// Regla: si la materia NO tiene orientacion -> aplica siempre.
// Si tiene orientacion -> solo aplica si el/la estudiante está en 4º+ y su orientación coincide.
function catalogAplicaAStudent_(catMateria, studentGrade, studentOrient) {
  const matOrient = normalizeOrient_(catMateria && catMateria.orientacion);
  if (!matOrient) return true;

  const g = Number(studentGrade || '');
  if (isNaN(g) || g < 4) return false;

  const so = normalizeOrient_(studentOrient);
  if (!so) return false;

  return matOrient === so;
}

function filterCatalogForStudent_(catalog, student) {
  // Filtra por orientación (si aplica) y por año (no muestra materias de años posteriores).
  // Esto reduce filas y acelera la app: las materias futuras se crean recién cuando corresponden.
  const gradeRaw = student && (student.anio_actual !== undefined ? student.anio_actual : student.anio);
  const grade = Number(gradeRaw || '');
  const orient = student ? student.orientacion : '';
  const hasGrade = !isNaN(grade) && grade > 0;

  return (catalog || []).filter(m => {
    if (!catalogAplicaAStudent_(m, hasGrade ? grade : null, orient)) return false;

    const my = Number(m && m.anio || '');
    if (!hasGrade) return true;              // sin dato: no recortamos
    if (isNaN(my) || my <= 0) return true;   // materias sin año explícito: se mantienen
    return my <= grade;                      // NO incluir años posteriores
  });
}


function getCatalog_() {
  const sh = sheet_(SHEETS.CATALOGO);
  const { headers, rows } = getValues_(sh);
  const idx = headerMap_(headers);

  // Esperados (mínimos):
  // id_materia, nombre, anio, es_troncal
  // Opcional:
  // orientacion (solo aplica típicamente a 4º-6º)
  return rows
    .filter(r => r.some(c => String(c).trim() !== ''))
    .map(r => ({
      id_materia: String(r[idx['id_materia']] || '').trim(),
      nombre: String(r[idx['nombre']] || '').trim(),
      anio: parseYear_(r[idx['anio']]),
      es_troncal: toBool_(r[idx['es_troncal']]),
      orientacion: (idx['orientacion'] !== undefined) ? String(r[idx['orientacion']] || '').trim() : '',
      egresado: (idx['egresado'] !== undefined) ? toBool_(r[idx['egresado']]) : false,
      anio_egreso: (idx['anio_egreso'] !== undefined) ? String(r[idx['anio_egreso']] || '').trim() : ''
    }))
    .filter(m => m.id_materia);
}

function getStudentList_(payload) {
  payload = payload || {};
  const ciclo = String(payload.ciclo_lectivo || '').trim();
  const umbral = (payload.umbral !== undefined) ? Number(payload.umbral) : 5;
  if (isNaN(umbral) || umbral < 0) throw new Error('umbral inválido');

  const sh = sheet_(SHEETS.ESTUDIANTES);
  const { headers, rows } = getValues_(sh);
  const idx = headerMap_(headers);

  // Activos
  const students = rows
    .filter(r => r.some(c => String(c).trim() !== ''))
    .map(r => ({
      id_estudiante: String(r[idx['id_estudiante']] || '').trim(),
      apellido: String(r[idx['apellido']] || '').trim(),
      nombre: String(r[idx['nombre']] || '').trim(),
      anio_actual: Number(r[idx['anio_actual']] || ''),
      division: String(r[idx['division']] || '').trim(),
      turno: String(r[idx['turno']] || '').trim(),
      activo: (idx['activo'] !== undefined) ? toBool_(r[idx['activo']]) : true,
      observaciones: (idx['observaciones'] !== undefined) ? String(r[idx['observaciones']] || '').trim() : '',
      orientacion: (idx['orientacion'] !== undefined) ? String(r[idx['orientacion']] || '').trim() : ''
    }))
    .filter(s => s.id_estudiante)
    .filter(s => s.activo !== false);

  // Si no hay ciclo, devolvemos sin flags
  if (!ciclo) return students;

  // Preparar filtros por orientación (si el catálogo usa la columna orientacion)
  const byStudent = {};
  students.forEach(s => { byStudent[s.id_estudiante] = s; });

  const catalogFull = getCatalog_();
  const catalogMap = {};
  catalogFull.forEach(m => { catalogMap[m.id_materia] = m; });

// Flags por ciclo: cierre completo + revisión manual (rosado)
  const estadoSh = sheet_(SHEETS.ESTADO);
  const est = getValues_(estadoSh);
  const eidx = headerMap_(est.headers);

  const need = {};   // sid -> total materias a cerrar
  const done = {};   // sid -> cerradas
  const needsReview = {}; // sid -> true
  const adeudaCount = {}; // sid -> cantidad adeudadas (condición o cierre)

  est.rows.forEach(r => {
    const c = String(r[eidx['ciclo_lectivo']] || '').trim();
    if (c !== ciclo) return;

    const sid = String(r[eidx['id_estudiante']] || '').trim();
    if (!sid) return;

    const mid = String(r[eidx['id_materia']] || '').trim();
    if (!mid) return;

    const st = byStudent[sid];
    const cat = catalogMap[mid];
    if (st) {
      if (cat && !catalogAplicaAStudent_(cat, st.anio_actual, st.orientacion)) return;
    }

    const sit = String(r[eidx['situacion_actual']] || '').trim();
    const cond = String(r[eidx['condicion_academica']] || '').trim().toLowerCase();
    const res = (eidx['resultado_cierre'] !== undefined) ? String(r[eidx['resultado_cierre']] || '').trim() : '';

    // Conteo de adeudadas para filtro "en riesgo" (impacta aunque aún no se haya ejecutado cierre global)
    const resLc = String(res || '').trim().toLowerCase();
    const isAdeuda = (cond === 'adeuda') || (resLc === 'no_aprobada' || resLc === 'no aprobada' || resLc === 'no_aprobo' || resLc === 'no' );
    if (isAdeuda) {
      // Contar adeudadas SOLO de años anteriores (no año en curso ni futuros)
      const matYear = cat ? Number(cat.anio || '') : NaN;
      const stYear = st ? Number(st.anio_actual || '') : NaN;
      const hasYears = (!isNaN(matYear) && !isNaN(stYear));

      // Con años disponibles: solo anteriores. Sin años: aproximación segura por situación.
      const countsAsAdeuda = hasYears
        ? (matYear < stYear)
        : (sit !== 'proximos_anos' && sit !== 'cursa_primera_vez');

      if (countsAsAdeuda) {
        adeudaCount[sid] = (adeudaCount[sid] || 0) + 1;
      }
    }

    // Materias a cerrar: las que cursó/recursó/intensificó en este ciclo
    if (sit === 'cursa_primera_vez' || sit === 'recursa' || sit === 'intensifica') {
      need[sid] = (need[sid] || 0) + 1;
      if (res === 'aprobada' || res === 'no_aprobada') done[sid] = (done[sid] || 0) + 1;
    }

    // Rosado: si tuvo que dejar "no cursa por tope" alguna materia nunca cursada
    // (señal de ajuste por exceso / prioridad adeudadas)
    if (sit === 'no_cursa_por_tope') {
      const nunca = (eidx['nunca_cursada'] !== undefined) ? toBool_(r[eidx['nunca_cursada']]) : false;
      if (nunca) needsReview[sid] = true;
    }
  });

  return students.map(s => {
    const total = need[s.id_estudiante] || 0;
    const cerradas = done[s.id_estudiante] || 0;
    const cierreCompleto = (total > 0 && cerradas >= total);
    return Object.assign({}, s, {
      cierre_pendiente: Math.max(0, total - cerradas),
      cierre_completo: cierreCompleto,
      needs_review: !!needsReview[s.id_estudiante],
      adeuda_count: adeudaCount[s.id_estudiante] || 0,
      en_riesgo: (adeudaCount[s.id_estudiante] || 0) >= umbral
    });
  });
}


// Actualiza anio_actual (+1) y, si se puede, la división en Estudiantes.
// Se usa opcionalmente en rollover.
function updateStudentsOnRollover_(usuario, cicloDestino) {
  const sh = sheet_(SHEETS.ESTUDIANTES);
  let { headers, rows } = getValues_(sh);
  let idx = headerMap_(headers);
  // Compatibilidad: columnas nuevas para egreso
  ensureEstudiantesColumns_(['egresado','anio_egreso']);
  // Releer porque puede haber cambiado la estructura
  ({ headers, rows } = getValues_(sh));
  idx = headerMap_(headers);


  if (idx['anio_actual'] === undefined) throw new Error('En Estudiantes falta la columna anio_actual');
  if (idx['id_estudiante'] === undefined) throw new Error('En Estudiantes falta la columna id_estudiante');

  let updated = 0;
  let skipped = 0;
  let divUpdated = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const sid = String(row[idx['id_estudiante']] || '').trim();
    if (!sid) continue;

    const activo = (idx['activo'] !== undefined) ? toBool_(row[idx['activo']]) : true;
    if (activo === false) continue;

    const anio = Number(row[idx['anio_actual']] || '');
    if (isNaN(anio) || anio <= 0) { skipped++; continue; }

    // Si ya está en 6º: pasa a EGRESADO en el ciclo nuevo (sin perder trayectoria)
    if (anio >= 6) {
      if (idx['egresado'] !== undefined) {
        const ya = toBool_(row[idx['egresado']]);
        if (!ya) {
          row[idx['egresado']] = true;
        }
      }
      if (idx['anio_egreso'] !== undefined) {
        const prevEg = String(row[idx['anio_egreso']] || '').trim();
        if (!prevEg && cicloDestino) row[idx['anio_egreso']] = cicloDestino;
      }

      if (idx['observaciones'] !== undefined && usuario) {
        const prev = String(row[idx['observaciones']] || '');
        const tag = `[egreso ${cicloDestino || isoNow_().slice(0,4)}]`;
        row[idx['observaciones']] = prev ? `${prev} ${tag}` : tag;
      }

      updated++;
      continue;
    }

    // No promovemos más allá de 6 por defecto (1º a 5º -> +1)
    const nuevoAnio = Math.min(anio + 1, 6);
    row[idx['anio_actual']] = nuevoAnio;

    if (idx['division'] !== undefined) {
      const promo = promoDivision_(row[idx['division']]);
      if (promo.ok) {
        row[idx['division']] = promo.value;
        divUpdated++;
      }
    }

    if (idx['observaciones'] !== undefined && usuario) {
      const prev = String(row[idx['observaciones']] || '');
      const tag = `[auto-rollover ${isoNow_().slice(0,10)}]`;
      row[idx['observaciones']] = prev ? `${prev} ${tag}` : tag;
    }

    updated++;
  }

  // Escribir de vuelta
  if (rows.length) {
    sh.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }

  return { estudiantes_actualizados: updated, division_actualizada: divUpdated, omitidos: skipped, ciclo_destino: cicloDestino || '' };
}


function getStudentStatus_(payload) {
  // Asegurar columnas para cierre
  ensureEstadoColumns_(['resultado_cierre','ciclo_cerrado']);

  const ciclo = String(payload.ciclo_lectivo || '').trim();
  const idEst = String(payload.id_estudiante || '').trim();
  if (!ciclo) throw new Error('Falta payload.ciclo_lectivo');
  if (!idEst) throw new Error('Falta payload.id_estudiante');

  // Datos del estudiante (incluye orientación si existe la columna)
  const students = getStudentList_();
  const student = students.find(s => s.id_estudiante === idEst) || { id_estudiante: idEst };

  // Catálogo filtrado por orientación (si aplica)
  const catalogFull = getCatalog_();
  const catalog = filterCatalogForStudent_(catalogFull, student);

  const catalogMap = {};
  const allowed = {};
  catalog.forEach(m => {
    catalogMap[m.id_materia] = m;
    allowed[m.id_materia] = true;
  });

  const sh = sheet_(SHEETS.ESTADO);
  const { headers, rows } = getValues_(sh);
  const idx = headerMap_(headers);

  // Filtrar por ciclo + estudiante, y además por materias permitidas (orientación)
  const filtered = rows
    .map(r => ({ r, obj: rowToObj_(headers, r) }))
    .filter(x => String(x.obj['ciclo_lectivo']).trim() === ciclo && String(x.obj['id_estudiante']).trim() === idEst)
    .filter(x => {
      const mid = String(x.obj['id_materia'] || '').trim();
      return !!allowed[mid];
    });

  const materias = filtered.map(x => {
    const idMat = String(x.obj['id_materia'] || '').trim();
    const cat = catalogMap[idMat] || {};
    return {
      id_materia: idMat,
      nombre: cat.nombre || String(x.obj['nombre'] || '').trim(),
      anio: cat.anio || Number(x.obj['anio'] || ''),
      es_troncal: (cat.es_troncal !== undefined) ? cat.es_troncal : toBool_(x.obj['es_troncal']),
      orientacion: cat.orientacion || '',
      condicion_academica: String(x.obj['condicion_academica'] || '').trim(),
      nunca_cursada: toBool_(x.obj['nunca_cursada']),
      situacion_actual: String(x.obj['situacion_actual'] || '').trim(),
      motivo_no_cursa: String(x.obj['motivo_no_cursa'] || '').trim(),
      fecha_actualizacion: x.obj['fecha_actualizacion'] ? new Date(x.obj['fecha_actualizacion']).toISOString() : '',
      usuario: String(x.obj['usuario'] || '').trim(),
      resultado_cierre: (idx['resultado_cierre'] !== undefined) ? String(x.obj['resultado_cierre'] || '').trim() : '',
      ciclo_cerrado: (idx['ciclo_cerrado'] !== undefined) ? toBool_(x.obj['ciclo_cerrado']) : false
    };
  });

  return {
    ciclo_lectivo: ciclo,
    estudiante: student,
    materias: materias
  };
}

function saveStudentStatus_(payload) {
  // Asegurar columnas para cierre
  ensureEstadoColumns_(['resultado_cierre','ciclo_cerrado']);

  const ciclo = String(payload.ciclo_lectivo || '').trim();
  const idEst = String(payload.id_estudiante || '').trim();
  const usuario = String(payload.usuario || 'web').trim();
  const updates = payload.updates || [];

  if (!ciclo) throw new Error('Falta payload.ciclo_lectivo');
  if (!idEst) throw new Error('Falta payload.id_estudiante');
  if (!Array.isArray(updates) || updates.length === 0) throw new Error('Falta payload.updates (array)');

  const sh = sheet_(SHEETS.ESTADO);
  const { headers, rows } = getValues_(sh);
  const idx = headerMap_(headers);

  // Map: id_materia -> rowIndex (1-based in sheet)
  const rowIndexByMateria = {};
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rCiclo = String(row[idx['ciclo_lectivo']] || '').trim();
    const rEst = String(row[idx['id_estudiante']] || '').trim();
    const rMat = String(row[idx['id_materia']] || '').trim();
    if (rCiclo === ciclo && rEst === idEst && rMat) {
      rowIndexByMateria[rMat] = i + 2; // +2 because headers row + 1-based
    }
  }

  const auditSh = ss_().getSheetByName(SHEETS.AUDITORIA);
  const now = new Date();

  updates.forEach(u => {
    const idMat = String(u.id_materia || '').trim();
    if (!idMat) return;

    const fields = u.fields || {};
    const targetRowIndex = rowIndexByMateria[idMat];

    if (targetRowIndex) {
      // Update existing row
      const rowRange = sh.getRange(targetRowIndex, 1, 1, headers.length);
      const current = rowRange.getValues()[0];
      const beforeObj = rowToObj_(headers, current);

      const newRow = current.slice();

      Object.keys(fields).forEach(k => {
        if (idx[k] === undefined) return;
        let v = fields[k];
        // Normalize booleans
        if (k === 'nunca_cursada' || k === 'es_troncal' || k === 'ciclo_cerrado') v = !!v;
        newRow[idx[k]] = v;
      });

      if (idx['fecha_actualizacion'] !== undefined) newRow[idx['fecha_actualizacion']] = now;
      if (idx['usuario'] !== undefined) newRow[idx['usuario']] = usuario;

      rowRange.setValues([newRow]);

      // Audit
      if (auditSh) {
        const changedKeys = Object.keys(fields).filter(k => idx[k] !== undefined);
        changedKeys.forEach(k => {
          const beforeVal = beforeObj[k];
          const afterVal = fields[k];
          if (String(beforeVal) !== String(afterVal)) {
            auditSh.appendRow([now, ciclo, idEst, idMat, k, beforeVal, afterVal, usuario]);
          }
        });
      }
    } else {
      // Append new row
      const newObj = {};
      headers.forEach(h => newObj[h] = '');

      newObj['ciclo_lectivo'] = ciclo;
      newObj['id_estudiante'] = idEst;
      newObj['id_materia'] = idMat;

      Object.keys(fields).forEach(k => {
        if (newObj.hasOwnProperty(k)) newObj[k] = fields[k];
      });

      if (newObj.hasOwnProperty('fecha_actualizacion')) newObj['fecha_actualizacion'] = now;
      if (newObj.hasOwnProperty('usuario')) newObj['usuario'] = usuario;

      const row = headers.map(h => newObj[h]);
      sh.appendRow(row);

      if (auditSh) {
        Object.keys(fields).forEach(k => {
          auditSh.appendRow([now, ciclo, idEst, idMat, k, '', fields[k], usuario]);
        });
      }
    }
  });

  // Devolver estado actualizado
  return getStudentStatus_({ ciclo_lectivo: ciclo, id_estudiante: idEst });
}


// Actualiza la orientación del estudiante en la pestaña Estudiantes.
// payload: { id_estudiante, orientacion, usuario?, ciclo_lectivo? }
function updateStudentOrientation_(payload) {
  const idEst = String(payload.id_estudiante || '').trim();
  const orient = String(payload.orientacion || '').trim();
  const usuario = String(payload.usuario || 'web').trim();
  const ciclo = String(payload.ciclo_lectivo || '').trim();

  if (!idEst) throw new Error('Falta payload.id_estudiante');

  const sh = sheet_(SHEETS.ESTUDIANTES);
  const tmp = getValues_(sh);
  let headers = tmp.headers;
  const rows = tmp.rows;
  let idx = headerMap_(headers);

  // Si no existe la columna, la creamos al final
  if (idx['orientacion'] === undefined) {
    sh.getRange(1, headers.length + 1).setValue('orientacion');
    headers = headers.concat(['orientacion']);
    idx = headerMap_(headers);
  }

  if (idx['id_estudiante'] === undefined) throw new Error('En Estudiantes falta la columna id_estudiante');

  let rowIndex = -1; // 0-based en rows
  for (let i = 0; i < rows.length; i++) {
    const sid = String(rows[i][idx['id_estudiante']] || '').trim();
    if (sid === idEst) { rowIndex = i; break; }
  }
  if (rowIndex === -1) throw new Error('No se encontró el estudiante: ' + idEst);

  const before = String(rows[rowIndex][idx['orientacion']] || '').trim();

  // Update cell
  const sheetRow = rowIndex + 2; // +2 por encabezado y 1-based
  sh.getRange(sheetRow, idx['orientacion'] + 1).setValue(orient);

  // Audit (misma estructura que el resto del backend)
  const auditSh = ss_().getSheetByName(SHEETS.AUDITORIA);
  if (auditSh && String(before) !== String(orient)) {
    const now = new Date();
    auditSh.appendRow([now, ciclo || '', idEst, '', 'orientacion', before, orient, usuario]);
  }

  return { id_estudiante: idEst, orientacion: orient };
}

function syncCatalogRows_(payload) {
  // Asegurar columnas para cierre
  ensureEstadoColumns_(['resultado_cierre','ciclo_cerrado']);

  const ciclo = String(payload.ciclo_lectivo || '').trim();
  const idEst = String(payload.id_estudiante || '').trim();
  const usuario = String(payload.usuario || 'web').trim();
  if (!ciclo) throw new Error('Falta payload.ciclo_lectivo');
  if (!idEst) throw new Error('Falta payload.id_estudiante');

  // Estudiante (para filtrar catálogo por orientación)
  const students = getStudentList_();
  const student = students.find(s => s.id_estudiante === idEst) || { id_estudiante: idEst, anio_actual: null, orientacion: '' };
  const isEgresado = !!student.egresado;
  const grade = Number(student.anio_actual || '');

  const catalogFull = getCatalog_();
  const catalog = filterCatalogForStudent_(catalogFull, student);

  const sh = sheet_(SHEETS.ESTADO);
  const { headers, rows } = getValues_(sh);
  const idx = headerMap_(headers);

  // Historial para inferir aprobadas / nunca cursada
  const cycleNum = Number(ciclo);
  const hasCycleNum = !isNaN(cycleNum);

  const approvedMap = {}; // mid -> true
  const regularMap = {};  // mid -> true (alguna vez cursó regular)
  rows.forEach(r => {
    const rCiclo = String(r[idx['ciclo_lectivo']] || '').trim();
    const rEst = String(r[idx['id_estudiante']] || '').trim();
    const rMat = String(r[idx['id_materia']] || '').trim();
    if (rEst !== idEst || !rMat) return;

    // Considerar solo ciclos anteriores si son numéricos
    if (hasCycleNum) {
      const cNum = Number(rCiclo);
      if (!isNaN(cNum) && cNum >= cycleNum) return;
    }

    const cond = String(r[idx['condicion_academica']] || '').trim().toLowerCase();
    const sit = String(r[idx['situacion_actual']] || '').trim();
    const resCierre = (idx['resultado_cierre'] !== undefined) ? String(r[idx['resultado_cierre']] || '').trim().toLowerCase() : '';

    if (cond === 'aprobada') approvedMap[rMat] = true;
    if (resCierre === 'aprobada' || resCierre === 'aprobo' || resCierre === 'aprobó') approvedMap[rMat] = true;
    if (sit === 'cursa_primera_vez' || sit === 'recursa') regularMap[rMat] = true;
  });

  const existing = new Set();
  rows.forEach(r => {
    const rCiclo = String(r[idx['ciclo_lectivo']] || '').trim();
    const rEst = String(r[idx['id_estudiante']] || '').trim();
    const rMat = String(r[idx['id_materia']] || '').trim();
    if (rCiclo === ciclo && rEst === idEst && rMat) existing.add(rMat);
  });

  const now = new Date();
  let added = 0;

  // Si es egresado/a, NO agregamos materias nuevas automáticamente.
  // El rollover ya dejó solo las adeudadas para que pueda cerrar pendientes sin inflar filas.
  if (isEgresado) {
    return { added: 0, status: getStudentStatus_({ ciclo_lectivo: ciclo, id_estudiante: idEst }) };
  }

  const toAppend = [];

  catalog.forEach(m => {
    if (existing.has(m.id_materia)) return;

    const approved = !!approvedMap[m.id_materia];
    const everRegular = !!regularMap[m.id_materia];

    const condicion = approved ? 'aprobada' : 'adeuda';
    const nunca = approved ? false : !everRegular;

    const obj = {};
    headers.forEach(h => obj[h] = '');

    obj['ciclo_lectivo'] = ciclo;
    obj['id_estudiante'] = idEst;
    obj['id_materia'] = m.id_materia;

    if (obj.hasOwnProperty('condicion_academica')) obj['condicion_academica'] = condicion;
    if (obj.hasOwnProperty('nunca_cursada')) obj['nunca_cursada'] = nunca;

    // Situación sugerida (simple): futuros -> próximos años, mismo año -> cursa 1ra vez, anteriores -> recursa
    let sit = 'no_cursa_otro_motivo';
    let motivo = '';
    const matYear = Number(m.anio || '');
    if (!isNaN(matYear) && !isNaN(grade) && grade) {
      if (matYear > grade) { sit = 'proximos_anos'; motivo = 'Próximos años (aún no corresponde)'; }
      else if (!approved && matYear === grade) { sit = 'cursa_primera_vez'; }
      else if (!approved && matYear < grade) { sit = 'recursa'; }
    }

    if (obj.hasOwnProperty('situacion_actual')) obj['situacion_actual'] = sit;
    if (obj.hasOwnProperty('motivo_no_cursa')) obj['motivo_no_cursa'] = motivo;

    if (obj.hasOwnProperty('resultado_cierre')) obj['resultado_cierre'] = '';
    if (obj.hasOwnProperty('ciclo_cerrado')) obj['ciclo_cerrado'] = false;
    if (obj.hasOwnProperty('fecha_actualizacion')) obj['fecha_actualizacion'] = now;
    if (obj.hasOwnProperty('usuario')) obj['usuario'] = usuario;

    toAppend.push(headers.map(h => obj[h]));
    existing.add(m.id_materia);
    added++;
  });

  if (toAppend.length) {
    sh.getRange(sh.getLastRow() + 1, 1, toAppend.length, headers.length).setValues(toAppend);
  }

  return { added, status: getStudentStatus_({ ciclo_lectivo: ciclo, id_estudiante: idEst }) };
}

function getDivisionRiskSummary_(payload) {
  const ciclo = String(payload.ciclo_lectivo || '').trim();
  const umbral = (payload.umbral !== undefined) ? Number(payload.umbral) : 5;
  if (!ciclo) throw new Error('Falta payload.ciclo_lectivo');
  if (isNaN(umbral) || umbral < 0) throw new Error('umbral inválido');

  const students = getStudentList_(); // activos
  const byId = {};
  students.forEach(s => { byId[s.id_estudiante] = s; });

  const catalogFull = getCatalog_();
  const catalogMap = {};
  catalogFull.forEach(m => { catalogMap[m.id_materia] = m; });

  const sh = sheet_(SHEETS.ESTADO);
  const { headers, rows } = getValues_(sh);
  const idx = headerMap_(headers);

  const adeudaCount = {}; // sid -> count
  const hasAny = {}; // sid -> true

  rows.forEach(r => {
    const rCiclo = String(r[idx['ciclo_lectivo']] || '').trim();
    if (rCiclo !== ciclo) return;
    const sid = String(r[idx['id_estudiante']] || '').trim();
    const st = byId[sid];
    if (!st) return;

    const mid = String(r[idx['id_materia']] || '').trim();
    if (!mid) return;
    const cat = catalogMap[mid];
    if (cat && !catalogAplicaAStudent_(cat, st.anio_actual, st.orientacion)) return;

    if (!sid || !byId[sid]) return;
    hasAny[sid] = true;
    const cond = String(r[idx['condicion_academica']] || '').trim().toLowerCase();
    const sit = (idx['situacion_actual'] !== undefined) ? String(r[idx['situacion_actual']] || '').trim() : '';

    // No contar años posteriores que aún no corresponde cursar
    const matYear = cat ? Number(cat.anio || '') : NaN;
    const stYear = st ? Number(st.anio_actual || '') : NaN;
    const futureByYear = (!isNaN(matYear) && !isNaN(stYear) && matYear > stYear);

    if (cond === 'adeuda' && sit !== 'proximos_anos' && !futureByYear) {
      adeudaCount[sid] = (adeudaCount[sid] || 0) + 1;
    }
  });

  // Group by division
  const groups = {}; // key division|turno -> stats
  students.forEach(s => {
    const key = `${s.division || '—'}|${s.turno || ''}`;
    if (!groups[key]) groups[key] = { division: s.division || '—', turno: s.turno || '', total_estudiantes: 0, en_riesgo: 0, sin_datos: 0 };
    groups[key].total_estudiantes++;
    const cnt = adeudaCount[s.id_estudiante] || 0;
    const risk = cnt >= umbral;
    if (risk) groups[key].en_riesgo++;
    if (!hasAny[s.id_estudiante]) groups[key].sin_datos++;
  });

  const result = Object.values(groups).sort((a,b) => String(a.division).localeCompare(String(b.division)) || String(a.turno).localeCompare(String(b.turno)));
  return { ciclo_lectivo: ciclo, umbral, divisiones: result };
}

// Cierre de ciclo: aplica resultado_cierre a condicion_academica (por estudiante o global)
// payload: { ciclo_lectivo, id_estudiante?:string, usuario?:string, marcar_cerrado?:boolean }
function closeCycle_(payload) {
  const ciclo = String(payload.ciclo_lectivo || '').trim();
  const idEst = payload.id_estudiante ? String(payload.id_estudiante).trim() : '';
  const usuario = String(payload.usuario || 'cierre').trim();
  const marcarCerrado = (payload.marcar_cerrado !== undefined) ? toBool_(payload.marcar_cerrado) : true;
  if (!ciclo) throw new Error('Falta payload.ciclo_lectivo');

  // Asegurar columnas nuevas
  ensureEstadoColumns_(['resultado_cierre','ciclo_cerrado']);

  const sh = sheet_(SHEETS.ESTADO);
  const { headers, rows } = getValues_(sh);
  const idx = headerMap_(headers);

  const now = new Date();
  let updated = 0;
  let scanned = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rCiclo = String(row[idx['ciclo_lectivo']] || '').trim();
    if (rCiclo !== ciclo) continue;

    const sid = String(row[idx['id_estudiante']] || '').trim();
    if (!sid) continue;
    if (idEst && sid !== idEst) continue;

    scanned++;

    const rc = String(row[idx['resultado_cierre']] || '').trim().toLowerCase();
    if (!rc) continue;

    // Normalizar
    const aprobo = (rc === 'aprobada' || rc === 'aprobo' || rc === 'aprobó' || rc === 'si' || rc === 'sí');
    const noAprobo = (rc === 'no_aprobada' || rc === 'no aprobada' || rc === 'no_aprobo' || rc === 'no aprobó' || rc === 'no');

    if (aprobo) row[idx['condicion_academica']] = 'aprobada';
    else if (noAprobo) row[idx['condicion_academica']] = 'adeuda';
    else continue; // valor desconocido

    if (marcarCerrado && idx['ciclo_cerrado'] !== undefined) row[idx['ciclo_cerrado']] = true;
    if (idx['fecha_actualizacion'] !== undefined) row[idx['fecha_actualizacion']] = now;
    if (idx['usuario'] !== undefined) row[idx['usuario']] = usuario;

    updated++;
  }

  // Escribir de vuelta una sola vez
  if (rows.length && updated > 0) {
    sh.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }

  // devolver estado si se cerró un estudiante
  const status = idEst ? getStudentStatus_({ ciclo_lectivo: ciclo, id_estudiante: idEst }) : null;

  return { ciclo_lectivo: ciclo, id_estudiante: idEst || null, filas_revisadas: scanned, filas_actualizadas: updated, status };
}
// ======== Output ========
function jsonOut_(obj, statusCode) {
  // Apps Script no permite setear status code real con ContentService,
  // pero lo incluimos en el payload para debugging.
  const payload = Object.assign({ http_status: statusCode }, obj);
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}