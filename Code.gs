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
 * payload: {ciclo_origen, ciclo_destino, usuario, update_students?:boolean, update_division?:boolean}
 */
function rolloverCycle_(payload) {
  // Asegurar columnas para cierre
  ensureEstadoColumns_(['resultado_cierre','ciclo_cerrado']);

  const origen = String(payload.ciclo_origen || '').trim();
  const destino = String(payload.ciclo_destino || '').trim();
  const usuario = String(payload.usuario || 'rollover').trim();
  const updateStudents = (payload.update_students !== undefined) ? toBool_(payload.update_students) : true;

  if (!origen) throw new Error('Falta payload.ciclo_origen');
  if (!destino) throw new Error('Falta payload.ciclo_destino');
  if (origen === destino) throw new Error('ciclo_origen y ciclo_destino no pueden ser iguales');

  const cycles = getCycles_();
  const origenExiste = cycles.indexOf(origen) >= 0;

  const students = getStudentList_(); // activos
  const catalog = getCatalog_();

  const sh = sheet_(SHEETS.ESTADO);
  const { headers, rows } = getValues_(sh);
  const idx = headerMap_(headers);

  const now = new Date();
  const destNum = Number(destino);
  const hasDestNum = !isNaN(destNum);

  // Maps globales (histórico < destino)
  const approvedEver = {}; // key sid|mid
  const regularEver = {};  // key sid|mid
  const destRowIndex = {}; // key sid|mid -> index en rows (0-based)

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const c = String(r[idx['ciclo_lectivo']] || '').trim();
    const sid = String(r[idx['id_estudiante']] || '').trim();
    const mid = String(r[idx['id_materia']] || '').trim();
    if (!c || !sid || !mid) continue;

    const key = sid + '|' + mid;

    if (c === destino) {
      destRowIndex[key] = i;
    }

    // Historial: solo ciclos anteriores al destino (si son numéricos)
    if (hasDestNum) {
      const cNum = Number(c);
      if (!isNaN(cNum) && cNum >= destNum) continue;
    }

    const cond = String(r[idx['condicion_academica']] || '').trim().toLowerCase();
    const rc = String(r[idx['resultado_cierre']] || '').trim().toLowerCase();
    const sit = String(r[idx['situacion_actual']] || '').trim();

    if (cond === 'aprobada' || rc === 'aprobada' || rc === 'aprobo' || rc === 'aprobó' || rc === 'si' || rc === 'sí') {
      approvedEver[key] = true;
    }

    if (sit === 'cursa_primera_vez' || sit === 'recursa') {
      regularEver[key] = true;
    }
  }

  // Helpers
  const byName = (a,b) => String(a.nombre || '').localeCompare(String(b.nombre || ''));
  const byAnioDescName = (a,b) => (Number(b.anio||0) - Number(a.anio||0)) || byName(a,b);

  const newRows = [];
  let created = 0;
  let updated = 0;
  let skippedExisting = 0;
  let skippedInUse = 0;

  const rosadoStudents = new Set();

  // Planificar por estudiante
  students.forEach(st => {
    const sid = st.id_estudiante;
    let anioActual = Number(st.anio_actual || '');
    if (isNaN(anioActual) || anioActual <= 0) anioActual = 1;
    const anioNuevo = Math.min(anioActual + 1, 6);

    const isApproved = (mid) => !!approvedEver[sid + '|' + mid];
    const everRegular = (mid) => !!regularEver[sid + '|' + mid];

    // Materias del nuevo año (1ra vez) — priorizamos hasta 12
    const matsNuevoAnio = catalog.filter(m => Number(m.anio||0) === anioNuevo && !isApproved(m.id_materia)).sort(byName);
    const matsNuevoRegular = matsNuevoAnio.slice(0, 12);
    const matsNuevoOverflow = matsNuevoAnio.slice(12);

    // Adeudadas (años anteriores al nuevo año)
    const adeudadas = catalog.filter(m => Number(m.anio||0) < anioNuevo && !isApproved(m.id_materia)).sort(byAnioDescName);

    let intensifica = [];
    let recursa = [];
    let tope = [];

    if (adeudadas.length <= 4) {
      intensifica = adeudadas.slice();
    } else {
      intensifica = adeudadas.slice(0, 4);
      const rem = adeudadas.slice(4);
      const slots = Math.max(0, 12 - matsNuevoRegular.length); // (cursa 1ra vez + recursa) = 12
      recursa = rem.slice(0, slots);
      tope = rem.slice(slots);
    }

    // Si el propio nuevo año excede 12, lo que no entra va a tope también
    tope = tope.concat(matsNuevoOverflow);

    if (tope.length > 0) rosadoStudents.add(sid);

    const setNuevoRegular = {};
    matsNuevoRegular.forEach(m => setNuevoRegular[m.id_materia] = true);

    const setInt = {};
    intensifica.forEach(m => setInt[m.id_materia] = true);

    const setRec = {};
    recursa.forEach(m => setRec[m.id_materia] = true);

    const setTope = {};
    tope.forEach(m => setTope[m.id_materia] = true);

    // Crear / actualizar fila por cada materia del catálogo
    catalog.forEach(m => {
      const mid = m.id_materia;
      const key = sid + '|' + mid;

      // Armar fields objetivo
      const mAnio = Number(m.anio||0);
      const approved = isApproved(mid);

      let condicion = '';
      let situacion = 'no_cursa_otro_motivo';
      let motivo = '';
      let nunca = false;

      if (approved) {
        condicion = 'aprobada';
        situacion = 'no_cursa_aprobada';
        motivo = '';
        nunca = false;
      } else {
        nunca = !everRegular(mid);

        if (mAnio === anioNuevo) {
          condicion = ''; // todavía no es adeuda: se cursa por 1ra vez
          if (setNuevoRegular[mid]) {
            situacion = 'cursa_primera_vez';
          } else if (setTope[mid]) {
            situacion = 'no_cursa_por_tope';
            motivo = 'tope 12';
          } else {
            situacion = 'no_cursa_otro_motivo';
          }
        } else if (mAnio < anioNuevo) {
          condicion = 'adeuda';
          if (setInt[mid]) {
            situacion = 'intensifica';
          } else if (setRec[mid]) {
            situacion = 'recursa';
          } else if (setTope[mid]) {
            situacion = 'no_cursa_por_tope';
            motivo = 'tope 12';
          } else {
            // fallback
            situacion = 'no_cursa_otro_motivo';
          }
        } else {
          // años futuros
          condicion = '';
          situacion = 'no_cursa_otro_motivo';
        }
      }

      const rowIdx = destRowIndex[key];

      if (rowIdx !== undefined) {
        skippedExisting++;

        const row = rows[rowIdx];

        // Si ya está trabajado, no pisamos
        const inUse =
          (idx['ciclo_cerrado'] !== undefined && toBool_(row[idx['ciclo_cerrado']])) ||
          (String(row[idx['resultado_cierre']] || '').trim() !== '');

        if (inUse) {
          skippedInUse++;
          return;
        }

        // Actualizar en memoria
        if (idx['condicion_academica'] !== undefined) row[idx['condicion_academica']] = condicion;
        if (idx['nunca_cursada'] !== undefined) row[idx['nunca_cursada']] = nunca;
        if (idx['situacion_actual'] !== undefined) row[idx['situacion_actual']] = situacion;
        if (idx['motivo_no_cursa'] !== undefined) row[idx['motivo_no_cursa']] = motivo;

        if (idx['resultado_cierre'] !== undefined) row[idx['resultado_cierre']] = '';
        if (idx['ciclo_cerrado'] !== undefined) row[idx['ciclo_cerrado']] = false;

        if (idx['fecha_actualizacion'] !== undefined) row[idx['fecha_actualizacion']] = now;
        if (idx['usuario'] !== undefined) row[idx['usuario']] = usuario;

        updated++;
      } else {
        const obj = {};
        headers.forEach(h => obj[h] = '');

        obj['ciclo_lectivo'] = destino;
        obj['id_estudiante'] = sid;
        obj['id_materia'] = mid;

        if (obj.hasOwnProperty('condicion_academica')) obj['condicion_academica'] = condicion;
        if (obj.hasOwnProperty('nunca_cursada')) obj['nunca_cursada'] = nunca;
        if (obj.hasOwnProperty('situacion_actual')) obj['situacion_actual'] = situacion;
        if (obj.hasOwnProperty('motivo_no_cursa')) obj['motivo_no_cursa'] = motivo;

        if (obj.hasOwnProperty('resultado_cierre')) obj['resultado_cierre'] = '';
        if (obj.hasOwnProperty('ciclo_cerrado')) obj['ciclo_cerrado'] = false;

        if (obj.hasOwnProperty('fecha_actualizacion')) obj['fecha_actualizacion'] = now;
        if (obj.hasOwnProperty('usuario')) obj['usuario'] = usuario;

        newRows.push(headers.map(h => obj[h]));
        created++;
      }
    });
  });

  // Escribir actualizaciones
  if (rows.length && updated > 0) {
    sh.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }

  if (newRows.length > 0) {
    const startRow = sh.getLastRow() + 1;
    sh.getRange(startRow, 1, newRows.length, headers.length).setValues(newRows);
  }

  // Promoción en Estudiantes (si se pidió)
  const promo = updateStudents ? updateStudentsOnRollover_(usuario) : { estudiantes_actualizados: 0, division_actualizada: 0, omitidos: 0 };

  return {
    ciclo_origen: origen,
    origen_existe: origenExiste,
    ciclo_destino: destino,
    filas_creadas: created,
    filas_actualizadas_destino: updated,
    filas_omitidas_ya_existian: skippedExisting,
    filas_omitidas_destino_en_uso: skippedInUse,
    estudiantes_promovidos: promo.estudiantes_actualizados || 0,
    divisiones_actualizadas: promo.division_actualizada || 0,
    estudiantes_rosado: rosadoStudents.size
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

function getStudentList_(payload) {
  payload = payload || {};
  const ciclo = payload.ciclo_lectivo ? String(payload.ciclo_lectivo).trim() : '';

  const sh = sheet_(SHEETS.ESTUDIANTES);
  const { headers, rows } = getValues_(sh);
  const idx = headerMap_(headers);

  // Esperados: id_estudiante, apellido, nombre, anio_actual, division, turno, activo
  let students = rows
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

  // Si nos pasan un ciclo, devolvemos flags para la UI (gris y rosado)
  if (ciclo) {
    // Asegurar columnas para cierre
    ensureEstadoColumns_(['resultado_cierre','ciclo_cerrado']);

    const shE = sheet_(SHEETS.ESTADO);
    const { headers: hE, rows: rE } = getValues_(shE);
    const idxE = headerMap_(hE);

    const cerradoMap = {};
    const rosadoMap = {};

    for (let i = 0; i < rE.length; i++) {
      const row = rE[i];
      const c = String(row[idxE['ciclo_lectivo']] || '').trim();
      if (c !== ciclo) continue;

      const sid = String(row[idxE['id_estudiante']] || '').trim();
      if (!sid) continue;

      const sit = String(row[idxE['situacion_actual']] || '').trim();
      if (sit === 'no_cursa_por_tope') rosadoMap[sid] = true;

      if (idxE['ciclo_cerrado'] !== undefined && toBool_(row[idxE['ciclo_cerrado']])) {
        cerradoMap[sid] = true;
      }
    }

    students = students.map(s => Object.assign({}, s, {
      ciclo_cerrado: !!cerradoMap[s.id_estudiante],
      rosado: !!rosadoMap[s.id_estudiante]
    }));
  }

  return students;
}



// Actualiza anio_actual (+1) y, si se puede, la división en Estudiantes.
// Se usa opcionalmente en rollover.
function updateStudentsOnRollover_(usuario) {
  const sh = sheet_(SHEETS.ESTUDIANTES);
  const { headers, rows } = getValues_(sh);
  const idx = headerMap_(headers);

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

    // No promovemos más allá de 6 por defecto
    const nuevoAnio = Math.min(anio + 1, 6);
    if (nuevoAnio === anio) { skipped++; continue; }

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

  return { estudiantes_actualizados: updated, division_actualizada: divUpdated, omitidos: skipped };
}


function getStudentStatus_(payload) {
  // Asegurar columnas para cierre
  ensureEstadoColumns_(['resultado_cierre','ciclo_cerrado']);

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
      resultado_cierre: String(x.obj['resultado_cierre'] || '').trim(),
      ciclo_cerrado: toBool_(x.obj['ciclo_cerrado']),
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

function syncCatalogRows_(payload) {
  // Asegurar columnas para cierre
  ensureEstadoColumns_(['resultado_cierre','ciclo_cerrado']);

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




// Devuelve resumen por división: cantidad de estudiantes en riesgo (>= umbral adeudadas)
// payload: { ciclo_lectivo, umbral?:number }
function getDivisionRiskSummary_(payload) {
  const ciclo = String(payload.ciclo_lectivo || '').trim();
  const umbral = (payload.umbral !== undefined) ? Number(payload.umbral) : 5;
  if (!ciclo) throw new Error('Falta payload.ciclo_lectivo');
  if (isNaN(umbral) || umbral < 0) throw new Error('umbral inválido');

  const students = getStudentList_(); // activos
  const byId = {};
  students.forEach(s => { byId[s.id_estudiante] = s; });

  const sh = sheet_(SHEETS.ESTADO);
  const { headers, rows } = getValues_(sh);
  const idx = headerMap_(headers);

  const adeudaCount = {}; // sid -> count
  const hasAny = {}; // sid -> true

  rows.forEach(r => {
    const rCiclo = String(r[idx['ciclo_lectivo']] || '').trim();
    if (rCiclo !== ciclo) return;
    const sid = String(r[idx['id_estudiante']] || '').trim();
    if (!sid || !byId[sid]) return;
    hasAny[sid] = true;
    const cond = String(r[idx['condicion_academica']] || '').trim().toLowerCase();
    if (cond === 'adeuda') adeudaCount[sid] = (adeudaCount[sid] || 0) + 1;
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

    let changed = false;

    // Si estamos cerrando UN estudiante, marcamos todo el ciclo como cerrado (gris en UI)
    if (marcarCerrado && idEst && idx['ciclo_cerrado'] !== undefined) {
      if (!toBool_(row[idx['ciclo_cerrado']])) {
        row[idx['ciclo_cerrado']] = true;
        changed = true;
      }
    }

    const rc = String(row[idx['resultado_cierre']] || '').trim().toLowerCase();
    if (rc) {
      // Normalizar
      const aprobo = (rc === 'aprobada' || rc === 'aprobo' || rc === 'aprobó' || rc === 'si' || rc === 'sí');
      const noAprobo = (rc === 'no_aprobada' || rc === 'no aprobada' || rc === 'no_aprobo' || rc === 'no aprobó' || rc === 'no');

      if (aprobo && row[idx['condicion_academica']] !== 'aprobada') {
        row[idx['condicion_academica']] = 'aprobada';
        changed = true;
      } else if (noAprobo && row[idx['condicion_academica']] !== 'adeuda') {
        row[idx['condicion_academica']] = 'adeuda';
        changed = true;
      }

      // Si se cierra masivo (sin idEst), marcamos cerrado solo donde hay resultado
      if (marcarCerrado && !idEst && idx['ciclo_cerrado'] !== undefined) {
        if (!toBool_(row[idx['ciclo_cerrado']])) {
          row[idx['ciclo_cerrado']] = true;
          changed = true;
        }
      }
    }

    if (changed) {
      if (idx['fecha_actualizacion'] !== undefined) row[idx['fecha_actualizacion']] = now;
      if (idx['usuario'] !== undefined) row[idx['usuario']] = usuario;
      updated++;
    }
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
