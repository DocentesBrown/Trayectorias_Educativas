/* Trayectorias · Frontend (GitHub Pages) */

const LS_KEY = 'TRAYECTORIAS_API_KEY';

const SITUACIONES = [
  { value: '', label: '—' },
  { value: 'cursa_primera_vez', label: 'Cursa 1ra vez (regular)' },
  { value: 'recursa', label: 'Recursa (regular)' },
  { value: 'intensifica', label: 'Intensifica' },
  { value: 'no_cursa_por_tope', label: 'No cursa por tope (atraso)' },
  { value: 'no_cursa_otro_motivo', label: 'No cursa (otro)' }
];

const CIERRE_RESULTADOS = [
  { value: '', label: '—' },
  { value: 'aprobada', label: 'Aprobó' },
  { value: 'no_aprobada', label: 'No aprobó' }
];


const $ = (id) => document.getElementById(id);

let state = {
  apiKey: null,
  ciclo: '2026',
  students: [],
  selectedStudentId: null,
  studentData: null,
  originalByMateria: new Map(), // id_materia -> snapshot
  dirtyByMateria: new Map()     // id_materia -> fields changed
};

function backendUrl() {
  const u = window.TRAYECTORIAS_BACKEND_URL;
  if (!u || u.includes('PEGAR_WEB_APP_URL_AQUI')) {
    throw new Error('Falta configurar TRAYECTORIAS_BACKEND_URL en config.js');
  }
  return u;
}

async function apiCall(action, payload) {
  const apiKey = state.apiKey || localStorage.getItem(LS_KEY) || '';
  if (!apiKey) throw new Error('Falta API Key');
  const body = JSON.stringify({ apiKey, action, payload });

  const res = await fetch(backendUrl(), {
    method: 'POST',
    body
    // No ponemos headers para evitar preflight CORS
  });

  const text = await res.text();
  let data;
  try { data = JSON.parse(text); }
  catch { throw new Error('Respuesta no JSON: ' + text.slice(0, 200)); }

  if (!data.ok) throw new Error(data.error || 'Error desconocido');
  return data;
}

function setGateVisible(visible) {
  $('gate').classList.toggle('hidden', !visible);
  $('app').classList.toggle('hidden', visible);
}

function renderStudents(list) {
  const q = ($('studentSearch').value || '').trim().toLowerCase();
  const filtered = list.filter(s => {
    const t = `${s.id_estudiante} ${s.apellido} ${s.nombre} ${s.division} ${s.anio_actual} ${s.turno}`.toLowerCase();
    return t.includes(q);
  });

  const el = $('studentsList');
  el.innerHTML = '';

  filtered.forEach(s => {
    const div = document.createElement('div');
    div.className = 'item' + (state.selectedStudentId === s.id_estudiante ? ' active' : '');
    div.innerHTML = `
      <div class="title">${escapeHtml(`${s.apellido}, ${s.nombre}`)}</div>
      <div class="sub">${escapeHtml(`${s.division || ''} · ${s.turno || ''} · ID: ${s.id_estudiante}`)}</div>
    `;
    div.onclick = () => selectStudent(s.id_estudiante);
    el.appendChild(div);
  });

  if (filtered.length === 0) {
    el.innerHTML = `<div class="muted">No hay resultados.</div>`;
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
}

function setMessage(elId, text, kind) {
  const el = $(elId);
  if (!el) return;
  el.textContent = text || '';
  el.className = 'msg' + (kind ? ' ' + kind : '');
}

function computeBuckets(materias) {
  const buckets = {
    aprobadas: [],
    adeudadas: [],
    primera: [],
    recursa: [],
    intensifica: [],
    atraso: []
  };

  materias.forEach(m => {
    const cond = (m.condicion_academica || '').trim().toLowerCase();
    const sit = (m.situacion_actual || '').trim();

    if (cond === 'aprobada') buckets.aprobadas.push(m);
    if (cond === 'adeuda') buckets.adeudadas.push(m);

    if (sit === 'cursa_primera_vez') buckets.primera.push(m);
    if (sit === 'recursa') buckets.recursa.push(m);
    if (sit === 'intensifica') buckets.intensifica.push(m);
    if (sit === 'no_cursa_por_tope') buckets.atraso.push(m);
  });

  return buckets;
}

function counts(materias) {
  let regular = 0, intens = 0;
  materias.forEach(m => {
    const sit = (m.situacion_actual || '').trim();
    if (sit === 'cursa_primera_vez' || sit === 'recursa') regular++;
    if (sit === 'intensifica') intens++;
  });
  return { regular, intens };
}

function renderPills(containerId, items) {
  const el = $(containerId);
  el.innerHTML = '';
  if (!items || items.length === 0) {
    el.innerHTML = `<span class="muted">—</span>`;
    return;
  }
  items
    .slice()
    .sort((a,b) => (a.anio||0)-(b.anio||0) || String(a.nombre).localeCompare(String(b.nombre)))
    .forEach(m => {
      const pill = document.createElement('div');
      pill.className = 'pill';
      pill.innerHTML = `${escapeHtml(m.nombre || m.id_materia)} <span class="muted">(${escapeHtml(m.id_materia)})</span>`;
      el.appendChild(pill);
    });
}

function renderAlerts(materias) {
  const { regular, intens } = counts(materias);
  const alerts = [];

  if (regular > 12) alerts.push(`Te pasaste del tope: cursada regular = ${regular}/12. La normativa prioriza “nunca cursadas”.`);
  if (intens > 4) alerts.push(`Te pasaste del tope: intensificación = ${intens}/4.`);

  // Regla de prioridad: si regular > 12 y hay recursas mientras hay nunca_cursadas afuera,
  // la app sugiere usar auto-ajuste (sin inventar).
  const neverFirst = materias.filter(m => !!m.nunca_cursada);
  if (regular > 12 && neverFirst.length > 0) {
    alerts.push('Sugerencia: usá “Ajuste automático” para respetar prioridad de materias nunca cursadas.');
  }

  const box = $('ruleAlerts');
  box.innerHTML = '';
  alerts.forEach(t => {
    const d = document.createElement('div');
    d.className = 'alert';
    d.textContent = t;
    box.appendChild(d);
  });
}

function renderStudent(data) {
  state.studentData = data;
  state.originalByMateria.clear();
  state.dirtyByMateria.clear();
  $('btnSave').disabled = true;

  const s = data.estudiante || {};
  $('studentName').textContent = s.apellido ? `${s.apellido}, ${s.nombre}` : (s.nombre || s.id_estudiante || 'Estudiante');
  const cerrado = (data.materias || []).some(x => !!x.ciclo_cerrado);
  $('studentMeta').textContent = `${data.ciclo_lectivo} · ${s.division || ''} · ${s.turno || ''} · Año: ${s.anio_actual || '—'} · ID: ${s.id_estudiante || ''}` + (cerrado ? ' · ✅ Ciclo cerrado' : '');

  const materias = (data.materias || []).slice();

  // snapshot original
  materias.forEach(m => {
    state.originalByMateria.set(m.id_materia, JSON.parse(JSON.stringify(m)));
  });

  // stats & buckets
  const b = computeBuckets(materias);
  const c = counts(materias);

  $('regularCount').textContent = String(c.regular);
  $('intCount').textContent = String(c.intens);
  $('adeudaCount').textContent = String(b.adeudadas.length);
  $('aprobadaCount').textContent = String(b.aprobadas.length);

  renderAlerts(materias);

  renderPills('listAprobadas', b.aprobadas);
  renderPills('listAdeudadas', b.adeudadas);
  renderPills('listPrimera', b.primera);
  renderPills('listRecursa', b.recursa);
  renderPills('listIntensifica', b.intensifica);
  renderPills('listAtraso', b.atraso);

  renderEditorTable(materias);
  renderFamilyText(materias, data);
}

function renderFamilyText(materias, data) {
  const s = data.estudiante || {};
  const { regular, intens } = counts(materias);

  const b = computeBuckets(materias);

  const lines = [];
  lines.push(`Hola, compartimos el plan anual de trayectoria de ${s.apellido ? `${s.apellido}, ${s.nombre}` : (s.nombre || 'el/la estudiante')} (${data.ciclo_lectivo}).`);
  lines.push('');
  lines.push(`• Cursada regular: ${regular}/12`);
  if (b.primera.length) lines.push(`  - Cursa por primera vez: ${b.primera.map(x => x.nombre).join(', ')}`);
  if (b.recursa.length) lines.push(`  - Recursa: ${b.recursa.map(x => x.nombre).join(', ')}`);
  lines.push('');
  lines.push(`• Intensificación: ${intens}/4`);
  if (b.intensifica.length) lines.push(`  - Intensifica: ${b.intensifica.map(x => x.nombre).join(', ')}`);
  else lines.push('  - (A definir por la escuela / equipo de acompañamiento)');
  lines.push('');
  if (b.atraso.length) {
    lines.push('• Materias en atraso por tope (no cursa este ciclo por límite de 12):');
    b.atraso.forEach(x => lines.push(`  - ${x.nombre}`));
    lines.push('');
  }
  lines.push('Cualquier ajuste se comunicará por los canales institucionales. Gracias.');

  $('familyText').value = lines.join('\n');
}

function renderEditorTable(materias) {
  const tbody = $('materiasTbody');
  tbody.innerHTML = '';

  const sorted = materias.slice().sort((a,b) => (a.anio||0)-(b.anio||0) || String(a.nombre).localeCompare(String(b.nombre)));

  sorted.forEach(m => {
    const tr = document.createElement('tr');    const condicion = m.condicion_academica ? `<span class="badge">${escapeHtml(m.condicion_academica.toUpperCase())}</span>` : '<span class="muted">—</span>';
    const nunca = m.nunca_cursada ? '<span class="badge">SÍ</span>' : '<span class="muted">NO</span>';

    const sel = document.createElement('select');
    sel.className = 'select';
    SITUACIONES.forEach(o => {
      const opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      if ((m.situacion_actual || '') === o.value) opt.selected = true;
      sel.appendChild(opt);
    });

    sel.onchange = () => {
      setMateriaField(m.id_materia, 'situacion_actual', sel.value);
    };

    const selCierre = document.createElement('select');
    selCierre.className = 'select';
    CIERRE_RESULTADOS.forEach(o => {
      const opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      if ((m.resultado_cierre || '') === o.value) opt.selected = true;
      selCierre.appendChild(opt);
    });

    selCierre.onchange = () => {
      setMateriaField(m.id_materia, 'resultado_cierre', selCierre.value);
    };

    tr.innerHTML = `
      <td>${escapeHtml(m.nombre || m.id_materia)} <div class="muted">${escapeHtml(m.id_materia)}</div></td>
      <td>${escapeHtml(m.anio || '')}</td>
      <td>${condicion}</td>
      <td>${nunca}</td>
      <td></td>
      <td></td>
    `;
    tr.children[4].appendChild(sel);
    tr.children[5].appendChild(selCierre);
    tbody.appendChild(tr);
  });
}

function setMateriaField(id_materia, field, value) {
  if (!state.studentData) return;
  const materias = state.studentData.materias || [];
  const mat = materias.find(x => x.id_materia === id_materia);
  if (!mat) return;

  mat[field] = value;

  const original = state.originalByMateria.get(id_materia) || {};
  const changed = state.dirtyByMateria.get(id_materia) || {};

  if (String(original[field] || '') !== String(value || '')) {
    changed[field] = value;
    state.dirtyByMateria.set(id_materia, changed);
  } else {
    delete changed[field];
    if (Object.keys(changed).length === 0) state.dirtyByMateria.delete(id_materia);
    else state.dirtyByMateria.set(id_materia, changed);
  }

  $('btnSave').disabled = state.dirtyByMateria.size === 0;

  // Re-render counters & alerts (sin recalcular todo el panel completo para no molestar)
  const c = counts(materias);
  $('regularCount').textContent = String(c.regular);
  $('intCount').textContent = String(c.intens);
  renderAlerts(materias);
  renderFamilyText(materias, state.studentData);
}

function autoAdjustTope() {
  if (!state.studentData) return;
  const materias = state.studentData.materias || [];

  // Regular list
  const regular = materias.filter(m => m.situacion_actual === 'cursa_primera_vez' || m.situacion_actual === 'recursa');
  if (regular.length <= 12) return;

  // Keep all "cursa_primera_vez" (prioridad nunca cursadas)
  // If still > 12 (very rare), then drop from the end by año desc (dejar las más prioritarias).
  const primera = regular.filter(m => m.situacion_actual === 'cursa_primera_vez');
  const recursa = regular.filter(m => m.situacion_actual === 'recursa');

  // Step 1: move recursas to atraso until total <= 12
  let total = primera.length + recursa.length;
  const recursaSorted = recursa.slice().sort((a,b) => (b.anio||0)-(a.anio||0)); // mover primero las de años más altos si hay que recortar
  let moved = 0;

  while (total > 12 && recursaSorted.length > 0) {
    const m = recursaSorted.shift();
    setMateriaField(m.id_materia, 'situacion_actual', 'no_cursa_por_tope');
    total--;
    moved++;
  }

  // Step 2: if still > 12, we must also move some de primera vez (pero avisamos con alerta)
  if (total > 12) {
    const primeraSorted = primera.slice().sort((a,b) => (b.anio||0)-(a.anio||0));
    while (total > 12 && primeraSorted.length > 0) {
      const m = primeraSorted.pop(); // mover las de menor prioridad (años menores) al final
      setMateriaField(m.id_materia, 'situacion_actual', 'no_cursa_por_tope');
      total--;
      moved++;
    }
  }

  setMessage('saveMsg', moved ? `Ajuste aplicado: se movieron ${moved} materias a “No cursa por tope”.` : 'No hizo falta ajustar.', moved ? 'ok' : '');
}



function setModalVisible(modalId, visible) {
  const el = $(modalId);
  if (!el) return;
  el.classList.toggle('hidden', !visible);
  el.setAttribute('aria-hidden', visible ? 'false' : 'true');
}

function renderDivisionSummary(divs) {
  const tbody = $('summaryTbody');
  tbody.innerHTML = '';
  const rows = (divs || []).slice();

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="muted">Sin datos.</td></tr>`;
    return;
  }

  rows.forEach(d => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(d.division || '—')}</td>
      <td>${escapeHtml(d.turno || '')}</td>
      <td>${escapeHtml(d.total_estudiantes || 0)}</td>
      <td><b>${escapeHtml(d.en_riesgo || 0)}</b></td>
    `;
    tbody.appendChild(tr);
  });
}

async function loadDivisionSummary() {
  setMessage('summaryMsg', 'Cargando…', '');
  try {
    const res = await apiCall('getDivisionRiskSummary', { ciclo_lectivo: state.ciclo, umbral: 5 });
    renderDivisionSummary(res.data.divisiones || []);
    setMessage('summaryMsg', '', '');
  } catch (err) {
    setMessage('summaryMsg', 'Error: ' + err.message, 'err');
  }
}

async function closeCycleForStudent() {
  if (!state.selectedStudentId) return alert('Seleccioná un/a estudiante.');
  const ok = confirm('Esto aplicará el “cierre” a la condición académica (APROBADA/ADEUDA) según la columna “Cierre: aprobó”.\n\n¿Continuar?');
  if (!ok) return;

  $('btnCloseStudent').disabled = true;
  setMessage('saveMsg', 'Aplicando cierre…', '');

  try {
    const res = await apiCall('closeCycle', {
      ciclo_lectivo: state.ciclo,
      id_estudiante: state.selectedStudentId,
      usuario: 'web',
      marcar_cerrado: true
    });

    const status = res.data.status;
    if (status) renderStudent(status);
    setMessage('saveMsg', `Cierre aplicado ✅ (filas actualizadas: ${res.data.filas_actualizadas || 0})`, 'ok');
  } catch (err) {
    setMessage('saveMsg', 'Error al cerrar ciclo: ' + err.message, 'err');
  } finally {
    $('btnCloseStudent').disabled = false;
  }
}

function renderCycles(cycles) {
  const sel = $('cicloSelect');
  const current = state.ciclo || sel.value;
  sel.innerHTML = '';
  (cycles || []).forEach(c => {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    sel.appendChild(opt);
  });

  // Mantener selección si existe; si no, usar el primer ciclo disponible
  if (cycles && cycles.includes(current)) {
    sel.value = current;
    state.ciclo = current;
  } else if (cycles && cycles.length) {
    sel.value = cycles[0];
    state.ciclo = cycles[0];
  } else {
    // fallback
    state.ciclo = sel.value || '2026';
  }
}

async function loadCycles() {
  const data = await apiCall('getCycles', {});
  const cycles = data.cycles || [];
  renderCycles(cycles);
  return cycles;
}

async function loadStudents() {
  const data = await apiCall('getStudentList', {});
  state.students = data.students || [];
  renderStudents(state.students);
}

async function selectStudent(id) {
  state.selectedStudentId = id;
  renderStudents(state.students);

  setMessage('saveMsg', '', '');
  $('btnSave').disabled = true;

  const ciclo = state.ciclo;
  const data = await apiCall('getStudentStatus', { ciclo_lectivo: ciclo, id_estudiante: id });
  renderStudent(data.data);
}

async function saveChanges() {
  if (!state.studentData) return;
  if (state.dirtyByMateria.size === 0) return;

  const updates = [];
  for (const [id_materia, fields] of state.dirtyByMateria.entries()) {
    updates.push({ id_materia, fields });
  }

  $('btnSave').disabled = true;
  setMessage('saveMsg', 'Guardando…', '');

  try {
    const payload = {
      ciclo_lectivo: state.ciclo,
      id_estudiante: state.selectedStudentId,
      usuario: 'web',
      updates
    };
    const res = await apiCall('saveStudentStatus', payload);
    setMessage('saveMsg', 'Cambios guardados ✅', 'ok');
    renderStudent(res.data);
  } catch (err) {
    setMessage('saveMsg', 'Error al guardar: ' + err.message, 'err');
    $('btnSave').disabled = false;
  }
}

async function syncCatalogRows() {
  if (!state.selectedStudentId) return;

  $('btnSync').disabled = true;
  try {
    const res = await apiCall('syncCatalogRows', {
      ciclo_lectivo: state.ciclo,
      id_estudiante: state.selectedStudentId,
      usuario: 'web'
    });
    const added = res.data.added || 0;
    renderStudent(res.data.status);
    alert(added ? `Listo: se agregaron ${added} materias faltantes.` : 'No había materias faltantes.');
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    $('btnSync').disabled = false;
  }
}

function wireTabs() {
  const tabs = document.querySelectorAll('.tab');
  tabs.forEach(t => {
    t.onclick = () => {
      tabs.forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      const name = t.dataset.tab;
      ['panel','editor','familia'].forEach(n => {
        $(`tab-${n}`).classList.toggle('hidden', n !== name);
      });
    };
  });
}

function wireEvents() {
  $('btnSaveKey').onclick = async () => {
    const key = $('apiKeyInput').value.trim();
    if (!key) return setMessage('gateMsg', 'Pegá la API Key.', 'err');

    localStorage.setItem(LS_KEY, key);
    state.apiKey = key;

    try {
      await apiCall('ping', {});
      setMessage('gateMsg', '', '');
      setGateVisible(false);
      await loadCycles();
      await loadStudents();
    } catch (err) {
      setMessage('gateMsg', 'Clave inválida o backend mal configurado: ' + err.message, 'err');
    }
  };

  $('btnLogout').onclick = () => {
    localStorage.removeItem(LS_KEY);
    state.apiKey = null;
    $('apiKeyInput').value = '';
    setMessage('gateMsg', '', '');
    setGateVisible(true);
  };

  $('btnDivisionSummary').onclick = async () => {
  if (!state.apiKey && !localStorage.getItem(LS_KEY)) return;
  setModalVisible('modalSummary', true);
  await loadDivisionSummary();
};

$('btnCloseSummary').onclick = () => setModalVisible('modalSummary', false);
$('modalSummaryBackdrop').onclick = () => setModalVisible('modalSummary', false);
$('btnRefreshSummary').onclick = loadDivisionSummary;

$('btnRefresh').onclick = async () => {
  if (!state.apiKey && !localStorage.getItem(LS_KEY)) return;
  await loadCycles();
  await loadStudents();
  if (state.selectedStudentId) await selectStudent(state.selectedStudentId);
};

$('btnRollover').onclick = async () => {
  if (!state.apiKey && !localStorage.getItem(LS_KEY)) return;

  const origen = (prompt('Año origen (ej. 2026):', state.ciclo) || '').trim();
  if (!origen) return;

  let sugerido = '';
  const n = Number(origen);
  if (!isNaN(n)) sugerido = String(n + 1);

  const destino = (prompt('Año destino (ej. 2027):', sugerido) || '').trim();
  if (!destino) return;

  if (destino === origen) return alert('El año destino no puede ser igual al origen.');

  const ok = confirm(
    `Esto va a crear (si no existen) filas en EstadoPorCiclo para el ciclo ${destino}, ` +
    `para TODOS los estudiantes activos y TODAS las materias del catálogo.

` +
    `No borra ni modifica ciclos anteriores.

¿Continuar?`
  );
  if (!ok) return;

  const promo = confirm('¿También querés promocionar automáticamente en la pestaña Estudiantes?\n\nOK = Sí (anio_actual +1 y ajusta división si se puede)\nCancelar = No');

  try {
    const res = await apiCall('rolloverCycle', { ciclo_origen: origen, ciclo_destino: destino, usuario: 'web', update_students: promo, update_division: true });
    alert(
      `Rollover listo ✅

` +
      `Origen: ${res.data.ciclo_origen} (existe: ${res.data.origen_existe})
` +
      `Destino: ${res.data.ciclo_destino}
` +
      `Filas creadas: ${res.data.filas_creadas}
` +
      `Omitidas (ya existían): ${res.data.filas_omitidas_ya_existian}
` +
      (res.data.estudiantes_promovidos ? `Estudiantes promovidos: ${res.data.estudiantes_promovidos}\nDivisiones actualizadas: ${res.data.divisiones_actualizadas}` : 'Estudiantes promovidos: 0')
    );

    await loadCycles();
    $('cicloSelect').value = destino;
    state.ciclo = destino;

    if (state.selectedStudentId) await selectStudent(state.selectedStudentId);
  } catch (err) {
    alert('Error: ' + err.message);
  }
};

$('studentSearch').oninput = () => renderStudents(state.students);

  $('cicloSelect').onchange = async () => {
    state.ciclo = $('cicloSelect').value;
    if (state.selectedStudentId) await selectStudent(state.selectedStudentId);
  };

  $('btnSave').onclick = saveChanges;
  $('btnSync').onclick = syncCatalogRows;

  $('btnAutoAdjust').onclick = autoAdjustTope;
  $('btnCloseStudent').onclick = closeCycleForStudent;

  $('btnCopyFamily').onclick = async () => {
    try {
      await navigator.clipboard.writeText($('familyText').value);
      setMessage('copyMsg', 'Copiado ✅', 'ok');
      setTimeout(() => setMessage('copyMsg', '', ''), 1200);
    } catch (err) {
      setMessage('copyMsg', 'No pude copiar automáticamente. Seleccioná y copiá manual.', 'err');
    }
  };
}

async function init() {
  wireTabs();
  wireEvents();

  // ciclo default
  state.ciclo = $('cicloSelect').value;

  const saved = localStorage.getItem(LS_KEY);
  if (saved) {
    state.apiKey = saved;
    try {
      await apiCall('ping', {});
      setGateVisible(false);
      await loadCycles();
      await loadStudents();
    } catch {
      // clave vieja o backend mal
      setGateVisible(true);
    }
  } else {
    setGateVisible(true);
  }
}

init();
