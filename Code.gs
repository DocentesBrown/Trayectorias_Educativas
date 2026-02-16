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
    actions: ['ping','getCycles','getCatalog','getStudentList','getStudentStatus','saveStudentStatus','syncCatalogRows','rolloverCycle']
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
      return { ok: true, students: getStudentList_() };

    case 'getStudentStatus':
      return { ok: true, data: getStudentStatus_(payload) };

    case 'saveStudentStatus':
      return { ok: true, data: saveStudentStatus_(payload) };

    case 'syncCatalogRows':
      return { ok: true, data: syncCatalogRows_(payload) };

    case 'rolloverCycle':
      return { ok: true, data: rolloverCycle_(payload) };

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

// ======== Actions ========

function getCycles_() {
  const sh = sheet_(SHEETS.ESTADO);
  const { headers, rows } = getValues_(sh);
  const idx = headerMap_(headers);
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
 * payload: {ciclo_origen, ciclo_destino, usuario}
 */
function rolloverCycle_(payload) {
  const origen = String(payload.ciclo_origen || '').trim();
  const destino = String(payload.ciclo_destino || '').trim();
  const usuario = String(payload.usuario || 'rollover').trim();

  if (!origen) throw new Error('Falta payload.ciclo_origen');
  if (!destino) throw new Error('Falta payload.ciclo_destino');
  if (origen === destino) throw new Error('ciclo_origen y ciclo_destino no pueden ser iguales');

  const cycles = getCycles_();
  const origenExiste = cycles.indexOf(origen) !== -1;

  const students = getStudentList_(); // activos
  const catalog = getCatalog_();

  const sh = sheet_(SHEETS.ESTADO);
  const { headers, rows } = getValues_(sh);
  const idx = headerMap_(headers);

  const destNum = Number(destino);
  const hasDestNum = !isNaN(destNum);

  const approvedMap = {}; // key sid|mid -> true
  const regularMap = {};  // key sid|mid -> true (alguna vez cursó regular)
  const existsDest = {};  // key sid|mid -> true

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

    if (cond === 'aprobada') approvedMap[key] = true;
    if (sit === 'cursa_primera_vez' || sit === 'recursa') regularMap[key] = true;
  });

  const now = new Date();
  const newRows = [];
  let created = 0;
  let skipped = 0;

  students.forEach(s => {
    const sid = s.id_estudiante;
    catalog.forEach(m => {
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

  return {
    ciclo_origen: origen,
    ciclo_destino: destino,
    origen_existe: origenExiste,
    estudiantes_procesados: students.length,
    materias_catalogo: catalog.length,
    filas_creadas: created,
    filas_omitidas_ya_existian: skipped
  };
}


function getCatalog_() {
  const sh = sheet_(SHEETS.CATALOGO);
  const { headers, rows } = getValues_(sh);
  const idx = headerMap_(headers);

  // Esperados
  // id_materia, nombre, anio, es_troncal
  return rows
    .filter(r => r.some(c => String(c).trim() !== ''))
    .map(r => ({
      id_materia: String(r[idx['id_materia']] || '').trim(),
      nombre: String(r[idx['nombre']] || '').trim(),
      anio: Number(r[idx['anio']] || ''),
      es_troncal: toBool_(r[idx['es_troncal']])
    }))
    .filter(m => m.id_materia);
}

function getStudentList_() {
  const sh = sheet_(SHEETS.ESTUDIANTES);
  const { headers, rows } = getValues_(sh);
  const idx = headerMap_(headers);

  // Esperados: id_estudiante, apellido, nombre, anio_actual, division, turno, activo
  return rows
    .filter(r => r.some(c => String(c).trim() !== ''))
    .map(r => ({
      id_estudiante: String(r[idx['id_estudiante']] || '').trim(),
      apellido: String(r[idx['apellido']] || '').trim(),
      nombre: String(r[idx['nombre']] || '').trim(),
      anio_actual: Number(r[idx['anio_actual']] || ''),
      division: String(r[idx['division']] || '').trim(),
      turno: String(r[idx['turno']] || '').trim(),
      activo: (idx['activo'] !== undefined) ? toBool_(r[idx['activo']]) : true,
      observaciones: (idx['observaciones'] !== undefined) ? String(r[idx['observaciones']] || '').trim() : ''
    }))
    .filter(s => s.id_estudiante)
    .filter(s => s.activo !== false);
}

function getStudentStatus_(payload) {
  const ciclo = String(payload.ciclo_lectivo || '').trim();
  const idEst = String(payload.id_estudiante || '').trim();
  if (!ciclo) throw new Error('Falta payload.ciclo_lectivo');
  if (!idEst) throw new Error('Falta payload.id_estudiante');

  const catalog = getCatalog_();
  const catalogMap = {};
  catalog.forEach(m => { catalogMap[m.id_materia] = m; });

  const sh = sheet_(SHEETS.ESTADO);
  const { headers, rows } = getValues_(sh);
  const idx = headerMap_(headers);

  // Esperados:
  // ciclo_lectivo, id_estudiante, id_materia, condicion_academica, nunca_cursada, situacion_actual, motivo_no_cursa, fecha_actualizacion, usuario
  const filtered = rows
    .map(r => ({ r, obj: rowToObj_(headers, r) }))
    .filter(x => String(x.obj['ciclo_lectivo']).trim() === ciclo && String(x.obj['id_estudiante']).trim() === idEst);

  const materias = filtered.map(x => {
    const idMat = String(x.obj['id_materia'] || '').trim();
    const cat = catalogMap[idMat] || {};
    return {
      id_materia: idMat,
      nombre: cat.nombre || String(x.obj['nombre'] || '').trim(),
      anio: cat.anio || Number(x.obj['anio'] || ''),
      es_troncal: (cat.es_troncal !== undefined) ? cat.es_troncal : toBool_(x.obj['es_troncal']),
      condicion_academica: String(x.obj['condicion_academica'] || '').trim(),
      nunca_cursada: toBool_(x.obj['nunca_cursada']),
      situacion_actual: String(x.obj['situacion_actual'] || '').trim(),
      motivo_no_cursa: String(x.obj['motivo_no_cursa'] || '').trim(),
      fecha_actualizacion: x.obj['fecha_actualizacion'] ? new Date(x.obj['fecha_actualizacion']).toISOString() : '',
      usuario: String(x.obj['usuario'] || '').trim()
    };
  });

  // También devolver datos del estudiante
  const students = getStudentList_();
  const student = students.find(s => s.id_estudiante === idEst) || { id_estudiante: idEst };

  return {
    ciclo_lectivo: ciclo,
    estudiante: student,
    materias: materias
  };
}

function saveStudentStatus_(payload) {
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
        if (k === 'nunca_cursada' || k === 'es_troncal') v = !!v;
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

function syncCatalogRows_(payload) {
  const ciclo = String(payload.ciclo_lectivo || '').trim();
  const idEst = String(payload.id_estudiante || '').trim();
  const usuario = String(payload.usuario || 'web').trim();
  if (!ciclo) throw new Error('Falta payload.ciclo_lectivo');
  if (!idEst) throw new Error('Falta payload.id_estudiante');

  const catalog = getCatalog_();
  const sh = sheet_(SHEETS.ESTADO);
  const { headers, rows } = getValues_(sh);
  const idx = headerMap_(headers);

  const existing = new Set();
  rows.forEach(r => {
    const rCiclo = String(r[idx['ciclo_lectivo']] || '').trim();
    const rEst = String(r[idx['id_estudiante']] || '').trim();
    const rMat = String(r[idx['id_materia']] || '').trim();
    if (rCiclo === ciclo && rEst === idEst && rMat) existing.add(rMat);
  });

  const now = new Date();
  let added = 0;

  catalog.forEach(m => {
    if (existing.has(m.id_materia)) return;

    const obj = {};
    headers.forEach(h => obj[h] = '');

    obj['ciclo_lectivo'] = ciclo;
    obj['id_estudiante'] = idEst;
    obj['id_materia'] = m.id_materia;

    if (obj.hasOwnProperty('condicion_academica')) obj['condicion_academica'] = ''; // a completar
    if (obj.hasOwnProperty('nunca_cursada')) obj['nunca_cursada'] = ''; // a completar
    if (obj.hasOwnProperty('situacion_actual')) obj['situacion_actual'] = ''; // a completar

    if (obj.hasOwnProperty('fecha_actualizacion')) obj['fecha_actualizacion'] = now;
    if (obj.hasOwnProperty('usuario')) obj['usuario'] = usuario;

    sh.appendRow(headers.map(h => obj[h]));
    added++;
  });

  return { added, status: getStudentStatus_({ ciclo_lectivo: ciclo, id_estudiante: idEst }) };
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
