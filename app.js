/* Trayectorias · Frontend (GitHub Pages) */

const LS_KEY = 'TRAYECTORIAS_API_KEY';

const SITUACIONES = [
  { value: '', label: '—' },
  { value: 'cursa_primera_vez', label: 'Cursa 1ra vez (regular)' },
  { value: 'recursa', label: 'Recursa (regular)' },
  { value: 'intensifica', label: 'Intensifica' },
  { value: 'proximos_anos', label: 'Próximos años' },
  { value: 'no_cursa_por_tope', label: 'No cursa por tope (atraso)' },
  { value: 'no_cursa_otro_motivo', label: 'No cursa (otro)' }
];

const CIERRE_RESULTADOS = [
  { value: '', label: '—' },
  { value: 'aprobada', label: 'Aprobó' },
  { value: 'no_aprobada', label: 'No aprobó' }
];


const $ = (id) => document.getElementById(id);

// UI helpers
function setBtnLoading(btn, loading, textLoading) {
  if (!btn) return;
  if (loading) {
    if (!btn.dataset.origText) btn.dataset.origText = btn.textContent;
    btn.disabled = true;
    const t = textLoading || 'Procesando…';
    btn.innerHTML = `<span class="spinner" aria-hidden="true"></span>${t}`;
    btn.classList.add('is-loading');
  } else {
    btn.disabled = false;
    const orig = btn.dataset.origText || btn.textContent;
    btn.textContent = orig;
    btn.classList.remove('is-loading');
  }
}

function toast(msg, type = 'ok') {
  const el = $('toast');
  if (!el) return alert(msg);
  el.textContent = msg;
  el.className = `toast show ${type}`;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.className = 'toast'; el.textContent = ''; }, 2200);
}

let state = {
  apiKey: null,
  ciclo: '2026',
  students: [],
  selectedStudentId: null,
  studentData: null,
  originalByMateria: new Map(), // id_materia -> snapshot
  dirtyByMateria: new Map(),     // id_materia -> fields changed
  filters: { course: '', onlyPending: false, onlyRisk: false }

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


function isMobile_(){
  return window.matchMedia && window.matchMedia('(max-width: 980px)').matches;
}
function setMobilePanel_(which){
  const students = $('studentsPanel');
  const detail = $('detailPanel');
  const nav = $('mobileNav');
  if (!students || !detail || !nav) return;

  const showStudents = which === 'students';
  students.classList.toggle('hidden-mobile', !showStudents);
  detail.classList.toggle('hidden-mobile', showStudents);

  const bS = $('btnShowStudents');
  const bD = $('btnShowDetail');
  if (bS && bD){
    bS.classList.toggle('active', showStudents);
    bD.classList.toggle('active', !showStudents);
  }
}

function setGateVisible(visible) {
  $('gate').classList.toggle('hidden', !visible);
  $('app').classList.toggle('hidden', visible);
}

function renderStudents(list) {
  const q = ($('studentSearch').value || '').trim().toLowerCase();

  let filtered = (list || []).filter(s => {
    const t = `${s.id_estudiante} ${s.apellido} ${s.nombre} ${s.division} ${s.anio_actual} ${s.turno}`.toLowerCase();
    return t.includes(q);
  });

  // Filtro por curso (año|división|turno)
  if (state.filters && state.filters.course) {
    filtered = filtered.filter(s => courseKey_(s) === state.filters.course);
  }

  // Filtro: faltan cargar cierre
  if (state.filters && state.filters.onlyPending) {
    filtered = filtered.filter(s => (Number(s.cierre_pendiente || 0) > 0));
  }

  // Filtro: en riesgo
  if (state.filters && state.filters.onlyRisk) {
    filtered = filtered.filter(s => !!s.en_riesgo);
  }

  const el = $('studentsList');
  el.innerHTML = '';

  filtered.forEach(s => {
    const div = document.createElement('div');

    const done = !!s.cierre_completo;
    const needs = !!s.needs_review;
    const risk = !!s.en_riesgo;

    div.className =
      'item' +
      (state.selectedStudentId === s.id_estudiante ? ' active' : '') +
      (done ? ' done' : '') +
      (needs ? ' needs-review' : '') +
      (risk ? ' risk' : '');

    div.innerHTML = `
      <div class="item-head">
        <div>
          <div class="title">${escapeHtml(`${s.apellido}, ${s.nombre}`)}</div>
          <div class="sub">${escapeHtml(`${s.division || ''} · ${s.turno || ''} · Año: ${s.anio_actual || '—'} · ID: ${s.id_estudiante}`)}</div>
        </div>
        <div class="item-actions">
          <button class="btn tiny ghost" data-action="cierre">Cierre</button>
        </div>
      </div>
    `;

    // Click en tarjeta = seleccionar estudiante
    div.onclick = () => selectStudent(s.id_estudiante);

    // Botón cierre = abrir modal (sin disparar select doble)
    const btn = div.querySelector('button[data-action="cierre"]');
    btn.onclick = async (ev) => {
      ev.stopPropagation();
      await openCierreModalForStudent(s.id_estudiante);
    };

    el.appendChild(div);
  });

  if (filtered.length === 0) {
    el.innerHTML = `<div class="muted">No hay resultados.</div>`;
  }
}


function courseKey_(s){
  return `${s.anio_actual || ''}|${s.division || ''}|${s.turno || ''}`;
}
function courseLabel_(s){
  const a = (s.anio_actual !== undefined && s.anio_actual !== null && s.anio_actual !== '') ? `${s.anio_actual}º` : '';
  const d = (s.division || '—');
  const t = (s.turno || '');
  return `${a} ${d}${t ? ' · ' + t : ''}`.trim();
}

function rebuildCourseOptions(list){
  const sel = $('courseFilter');
  if (!sel) return;

  const current = state.filters.course || sel.value || '';
  const map = new Map();

  (list || []).forEach(s => {
    const key = courseKey_(s);
    const label = courseLabel_(s);
    if (!map.has(key)) map.set(key, label);
  });

  const entries = Array.from(map.entries()).sort((a,b) => {
    // sort by year number then label
    const ya = Number(String(a[0]).split('|')[0] || 0);
    const yb = Number(String(b[0]).split('|')[0] || 0);
    if (ya !== yb) return ya - yb;
    return String(a[1]).localeCompare(String(b[1]));
  });

  sel.innerHTML = `<option value="">Todos los cursos</option>`;
  entries.forEach(([key,label]) => {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = label;
    sel.appendChild(opt);
  });

  // reponer selección si sigue existiendo
  if (current && map.has(current)) {
    sel.value = current;
    state.filters.course = current;
  } else {
    sel.value = '';
    state.filters.course = '';
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
    const tr = document.createElement('tr');
    const isAprobada = String(m.condicion_academica || '').trim().toLowerCase() === 'aprobada';
    if (isAprobada) tr.classList.add('row-approved');

    const condicion = m.condicion_academica ? `<span class="badge">${escapeHtml(m.condicion_academica.toUpperCase())}</span>` : '<span class="muted">—</span>';
    const nunca = m.nunca_cursada ? '<span class="badge">SÍ</span>' : '<span class="muted">NO</span>';

    const sel = document.createElement('select');
    sel.className = 'select';

    if (isAprobada) {
      sel.disabled = true;
      const opt = document.createElement('option');
      opt.value = 'no_cursa_aprobada';
      opt.textContent = 'No cursa (aprobada)';
      opt.selected = true;
      sel.appendChild(opt);
    } else {
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
    }

    tr.innerHTML = `
      <td data-label="Materia">${escapeHtml(m.nombre || m.id_materia)} <div class="muted">${escapeHtml(m.id_materia)}</div></td>
      <td data-label="Año">${escapeHtml(m.anio || '')}</td>
      <td data-label="Condición">${condicion}</td>
      <td data-label="Nunca cursada">${nunca}</td>
      <td data-label="Situación actual"></td>
    `;
    tr.children[4].appendChild(sel);
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
  const btnC = $('btnSaveCierre');
  if (btnC) btnC.disabled = state.dirtyByMateria.size === 0;

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

  // Regular list (tope 12 = cursa 1ra vez + recursa)
  const regular = materias.filter(m => m.situacion_actual === 'cursa_primera_vez' || m.situacion_actual === 'recursa');
  if (regular.length <= 12) return;

  // Regla actual: priorizar ADEUDADAS (recursa). Si hay exceso, sacamos primero las de 1ra vez.
  const primera = regular.filter(m => m.situacion_actual === 'cursa_primera_vez');
  const recursa = regular.filter(m => m.situacion_actual === 'recursa');

  let total = primera.length + recursa.length;
  let moved = 0;

  // Step 1: mover "cursa 1ra vez" a tope hasta quedar en 12
  const primeraSorted = primera.slice().sort((a,b) => (b.anio||0)-(a.anio||0)); // sacar primero las de año más alto (menos prioritarias si hay adeudas)
  while (total > 12 && primeraSorted.length > 0) {
    const m = primeraSorted.shift();
    setMateriaField(m.id_materia, 'situacion_actual', 'no_cursa_por_tope');
    total--;
    moved++;
  }

  // Step 2 (raro): si aún así supera 12, también mover algunas recursas
  if (total > 12) {
    const recursaSorted = recursa.slice().sort((a,b) => (b.anio||0)-(a.anio||0));
    while (total > 12 && recursaSorted.length > 0) {
      const m = recursaSorted.shift();
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

// ======== Cierre por estudiante (modal) ========
async function openCierreModalForStudent(idEstudiante) {
  // Selecciona estudiante (carga datos) y abre modal
  await selectStudent(idEstudiante);
  renderCierreModal();
  setMessage('cierreMsg', '', '');
  $('btnSaveCierre').disabled = state.dirtyByMateria.size === 0;
  setModalVisible('modalCierre', true);
}

function cierreLabel(sit) {
  const found = SITUACIONES.find(x => x.value === sit);
  return found ? found.label : (sit || '—');
}

function renderCierreModal() {
  if (!state.studentData) return;

  const s = state.studentData.estudiante || {};
  $('modalCierreTitle').textContent = `Cierre · ${s.apellido ? `${s.apellido}, ${s.nombre}` : (s.nombre || s.id_estudiante || '')}`;

  const materias = (state.studentData.materias || []).slice();

  // Solo las que efectivamente cursó/recursó/intensificó este ciclo
  const target = materias.filter(m => {
    const sit = (m.situacion_actual || '').trim();
    return sit === 'cursa_primera_vez' || sit === 'recursa' || sit === 'intensifica';
  }).sort((a,b) => (a.anio||0)-(b.anio||0) || String(a.nombre).localeCompare(String(b.nombre)));

  const tbody = $('cierreTbody');
  tbody.innerHTML = '';

  if (!target.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="muted">No hay materias en cursada/recursa/intensifica para cerrar.</td></tr>`;
    return;
  }

  target.forEach(m => {
    const tr = document.createElement('tr');

    const sel = document.createElement('select');
    sel.className = 'select';

    CIERRE_RESULTADOS.forEach(o => {
      const opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      if ((m.resultado_cierre || '') === o.value) opt.selected = true;
      sel.appendChild(opt);
    });

    sel.onchange = () => {
      setMateriaField(m.id_materia, 'resultado_cierre', sel.value);
      // Feedback en el modal: si ya no faltan, avisar
      const { faltan } = cierreProgress_();
      if (faltan === 0) setMessage('cierreMsg', 'Listo: ya marcaste todas ✅ (guardá para aplicar)', 'ok');
      else setMessage('cierreMsg', `Te faltan ${faltan} materias por marcar.`, '');
    };

    tr.innerHTML = `
      <td data-label="Materia">${escapeHtml(m.nombre || m.id_materia)} <div class="muted">${escapeHtml(m.id_materia)}</div></td>
      <td data-label="Año">${escapeHtml(m.anio || '')}</td>
      <td data-label="Situación">${escapeHtml(cierreLabel(m.situacion_actual))}</td>
      <td data-label="Resultado"></td>
    `;
    tr.children[3].appendChild(sel);
    tbody.appendChild(tr);
  });

  const { faltan, total } = cierreProgress_();
  if (total && faltan === 0) setMessage('cierreMsg', 'Todo marcado ✅ (guardá para aplicar)', 'ok');
  else if (total) setMessage('cierreMsg', `Te faltan ${faltan} materias por marcar.`, '');
}

function cierreProgress_() {
  if (!state.studentData) return { total: 0, faltan: 0 };
  const materias = state.studentData.materias || [];
  const target = materias.filter(m => {
    const sit = (m.situacion_actual || '').trim();
    return sit === 'cursa_primera_vez' || sit === 'recursa' || sit === 'intensifica';
  });

  const total = target.length;
  const marcadas = target.filter(m => (m.resultado_cierre || '') === 'aprobada' || (m.resultado_cierre || '') === 'no_aprobada').length;
  return { total, faltan: Math.max(0, total - marcadas) };
}

async function saveChangesFromCierreModal() {
  if (!state.studentData) return;
  if (state.dirtyByMateria.size === 0) return;

  const updates = [];
  for (const [id_materia, fields] of state.dirtyByMateria.entries()) {
    updates.push({ id_materia, fields });
  }

  setBtnLoading($('btnSaveCierre'), true, 'Guardando…');
  setMessage('cierreMsg', 'Guardando…', '');

  try {
    const payload = {
      ciclo_lectivo: state.ciclo,
      id_estudiante: state.selectedStudentId,
      usuario: 'web',
      updates
    };

    // 1) Guardar resultado_cierre (y otros campos)
    const res = await apiCall('saveStudentStatus', payload);

    // 2) Aplicar automáticamente el cierre (resultado_cierre -> condicion_academica)
    await apiCall('closeCycle', {
      ciclo_lectivo: state.ciclo,
      id_estudiante: state.selectedStudentId,
      usuario: 'web',
      marcar_cerrado: true
    });

    // 3) Refrescar panel + lista + resumen sin crear ciclo nuevo
    const fresh = await apiCall('getStudentStatus', { ciclo_lectivo: state.ciclo, id_estudiante: state.selectedStudentId });
    renderStudent(fresh.data);

    await loadStudents();        // actualiza gris/rosado + pendientes + riesgo
    await loadDivisionSummary(); // actualiza panel de riesgo
    renderCierreModal();

    setMessage('cierreMsg', 'Materias actualizadas ✅', 'ok');
    toast('Materias actualizadas ✅', 'ok');
    setTimeout(() => setModalVisible('modalCierre', false), 250);
    setBtnLoading($('btnSaveCierre'), false);
  } catch (err) {
    setMessage('cierreMsg', 'Error al guardar: ' + err.message, 'err');
    setBtnLoading($('btnSaveCierre'), false);
  }
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
      <td data-label="División">${escapeHtml(d.division || '—')}</td>
      <td data-label="Turno">${escapeHtml(d.turno || '')}</td>
      <td data-label="Total">${escapeHtml(d.total_estudiantes || 0)}</td>
      <td data-label="En riesgo"><b>${escapeHtml(d.en_riesgo || 0)}</b></td>
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
  const data = await apiCall('getStudentList', { ciclo_lectivo: state.ciclo });
  state.students = data.students || [];
  rebuildCourseOptions(state.students);
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

  // Mobile UX: after selecting, jump to detail panel
  if (isMobile_()) {
    setMobilePanel_('detail');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
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
  setBtnLoading($('btnDivisionSummary'), true, 'Cargando…');
  try {
    await loadDivisionSummary();
  } finally {
    setBtnLoading($('btnDivisionSummary'), false);
  }
};

$('btnCloseSummary').onclick = () => setModalVisible('modalSummary', false);
$('modalSummaryBackdrop').onclick = () => setModalVisible('modalSummary', false);
$('btnRefreshSummary').onclick = async () => {
  setBtnLoading($('btnRefreshSummary'), true, 'Actualizando…');
  try { await loadDivisionSummary(); } finally { setBtnLoading($('btnRefreshSummary'), false); }
};

// Modal cierre por estudiante
$('btnCloseCierre').onclick = () => setModalVisible('modalCierre', false);
$('modalCierreBackdrop').onclick = () => setModalVisible('modalCierre', false);
$('btnSaveCierre').onclick = saveChangesFromCierreModal;

$('btnRefresh').onclick = async () => {
  if (!state.apiKey && !localStorage.getItem(LS_KEY)) return;
  setBtnLoading($('btnRefresh'), true, 'Actualizando…');
  try {
    await loadCycles();
    await loadStudents();
    if (state.selectedStudentId) await selectStudent(state.selectedStudentId);
  } finally {
    setBtnLoading($('btnRefresh'), false);
  }
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

    try {
    setBtnLoading($('btnRollover'), true, 'Creando ciclo…');
    const res = await apiCall('rolloverCycle', { ciclo_origen: origen, ciclo_destino: destino, usuario: 'web', update_students: true, update_division: true });
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
      (res.data.estudiantes_promovidos ? `Estudiantes promovidos: ${res.data.estudiantes_promovidos}\nDivisiones actualizadas: ${res.data.divisiones_actualizadas}` : 'Estudiantes promovidos: 0') +
      `\nRevisión manual (rosado): ${res.data.estudiantes_revision_manual || 0}`
    );

    await loadCycles();
    $('cicloSelect').value = destino;
    state.ciclo = destino;

    if (state.selectedStudentId) await selectStudent(state.selectedStudentId);
  }
  catch (err) {
    alert('Error: ' + err.message);
  } finally {
    setBtnLoading($('btnRollover'), false);
  }
};

$('studentSearch').oninput = () => renderStudents(state.students);

  // filtros estudiantes
  if ($('courseFilter')) $('courseFilter').onchange = () => {
    state.filters.course = $('courseFilter').value;
    renderStudents(state.students);
  };
  if ($('onlyPending')) $('onlyPending').onchange = () => {
    state.filters.onlyPending = $('onlyPending').checked;
    renderStudents(state.students);
  };
  if ($('onlyRisk')) $('onlyRisk').onchange = () => {
    state.filters.onlyRisk = $('onlyRisk').checked;
    renderStudents(state.students);
  };

$('cicloSelect').onchange = async () => {
    state.ciclo = $('cicloSelect').value;
    await loadStudents();
    if (state.selectedStudentId) await selectStudent(state.selectedStudentId);
  };

  $('btnSave').onclick = saveChanges;
    $('btnAutoAdjust').onclick = autoAdjustTope;
  
  $('btnCopyFamily').onclick = async () => {
    try {
      await navigator.clipboard.writeText($('familyText').value);
      setMessage('copyMsg', 'Copiado ✅', 'ok');
      setTimeout(() => setMessage('copyMsg', '', ''), 1200);
    } catch (err) {
      setMessage('copyMsg', 'No pude copiar automáticamente. Seleccioná y copiá manual.', 'err');
    }
  };
  // Mobile panel navigation
  if ($('btnShowStudents')) $('btnShowStudents').onclick = () => setMobilePanel_('students');
  if ($('btnShowDetail')) $('btnShowDetail').onclick = () => setMobilePanel_('detail');
  if ($('btnBackStudents')) $('btnBackStudents').onclick = () => setMobilePanel_('students');

  // When resizing, keep a sensible panel visible
  window.addEventListener('resize', () => {
    if (!isMobile_()){
      // on desktop show both
      const students = $('studentsPanel');
      const detail = $('detailPanel');
      if (students) students.classList.remove('hidden-mobile');
      if (detail) detail.classList.remove('hidden-mobile');
    } else {
      // on mobile: if no student selected, show students; else keep detail
      setMobilePanel_(state.selectedStudentId ? 'detail' : 'students');
    }
  }, { passive: true });

}

async function init() {
  wireTabs();
  wireEvents();

  // ciclo default

  // Mobile: start on students panel
  if (isMobile_()) setMobilePanel_('students');

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
