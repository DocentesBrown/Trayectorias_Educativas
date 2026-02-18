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
  catalog: [],
  orientaciones: [],
  originalByMateria: new Map(), // id_materia -> snapshot
  dirtyByMateria: new Map(),     // id_materia -> fields changed
  filters: { course: '', onlyPending: false, onlyRisk: false },
  pickerJustOpenedAt: 0

};


const BOOT_LOADER_MIN_MS = 650;
let bootLoaderStartedAt = Date.now();
function startBootLoader_(text){
  bootLoaderStartedAt = Date.now();
  showAppLoader_(text || 'Cargando…');
}
function hideBootLoader_(){
  const elapsed = Date.now() - bootLoaderStartedAt;
  const wait = Math.max(0, BOOT_LOADER_MIN_MS - elapsed);
  setTimeout(() => hideAppLoader_(), wait);
}


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

function showAppLoader_(text){
  const l = $('appLoader');
  if (!l) return;
  const t = $('appLoaderText');
  if (t) t.textContent = text || 'Cargando…';
  l.classList.remove('hidden');
  document.body.classList.add('app-busy');
}
function hideAppLoader_(){
  const l = $('appLoader');
  if (l) l.classList.add('hidden');
  document.body.classList.remove('app-busy');
}
function pulseTopLoader_(){
  const b = $('topLoader');
  if (!b) return;
  b.classList.remove('hidden');
  b.classList.add('run');
  setTimeout(() => {
    b.classList.remove('run');
    b.classList.add('hidden');
  }, 550);
}

async function ensurePaint_(){
  // Force the browser to paint (helps loaders appear before heavy renders / fetch)
  await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
}


// Prevent "open then instantly close" on mobile when the same tap triggers the backdrop.
let pickerOpenedAt_ = 0;
let isPickingStudent_ = false;

function openStudentPicker_(){
  pickerOpenedAt_ = Date.now();
  isPickingStudent_ = true;
  document.body.classList.add('picker-open');
  const bd = $('studentsBackdrop');
  if (bd) bd.classList.remove('hidden');
  const students = $('studentsPanel');
  if (students) students.classList.remove('hidden-mobile');
  setTimeout(() => {
    const inp = $('studentSearch');
    if (inp) {
      inp.value = '';
      inp.focus();
    }
    if (state.students) renderStudents(state.students);
  }, 60);
}
function closeStudentPicker_(){
  isPickingStudent_ = false;
  document.body.classList.remove('picker-open');
  const bd = $('studentsBackdrop');
  if (bd) bd.classList.add('hidden');
}

function setMobilePanel_(which){
  // Desktop keeps the classic layout (students on the left + detail on the right)
  if (!isMobile_()) return;

  if (which === 'students') openStudentPicker_();
  else closeStudentPicker_();
}

function setGateVisible(visible) {
  $('gate').classList.toggle('hidden', !visible);
  $('app').classList.toggle('hidden', visible);

  // Mobile: show/hide bottom bar only when inside the app
  const bb = $('mobileBottomBar');
  if (bb) {
    const show = (!visible) && isMobile_();
    bb.classList.toggle('hidden', !show);
  }
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
          <div class="chips">
            ${done ? `<span class="chip ok">Cierre ✅</span>` : ``}
            ${Number(s.cierre_pendiente||0) > 0 ? `<span class="chip warn">Faltan ${Number(s.cierre_pendiente||0)}</span>` : (!done ? `<span class="chip info">Al día</span>` : ``)}
            ${s.es_egresado ? `<span class="chip info">Egresado</span>` : ``}
            ${risk ? `<span class="chip warn">Riesgo</span>` : ``}
            ${needs ? `<span class="chip warn">Revisar</span>` : ``}
          </div>
        </div>
        <div class="item-actions">
          <button class="btn tiny ghost" data-action="cierre">Cierre</button>
        </div>
      </div>
    `;

    // Click en tarjeta = seleccionar estudiante
    // En mobile, ignoramos el "mismo tap" que abrió el picker (si no, se vuelve a seleccionar el activo y se cierra solo).
    div.onclick = (ev) => {
      if (isMobile_() && (Date.now() - pickerOpenedAt_ < 350)) return;
      selectStudent(s.id_estudiante);
    };

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
  const sels = [$('courseFilter'), $('courseFilterTop')].filter(Boolean);
  if (sels.length === 0) return;

  // prefer state, otherwise read from any existing select
  const current = state.filters.course || (sels[0] ? sels[0].value : '') || '';
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

  sels.forEach(sel => {
    sel.innerHTML = `<option value="">Todos los cursos</option>`;
    entries.forEach(([key,label]) => {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = label;
      sel.appendChild(opt);
    });
  });

  // reponer selección si sigue existiendo (y sincronizar ambos)
  if (current && map.has(current)) {
    state.filters.course = current;
  } else {
    state.filters.course = '';
  }
  sels.forEach(sel => { sel.value = state.filters.course; });
}

function syncFiltersUI_(){
  const cf = $('courseFilter');
  const cft = $('courseFilterTop');
  if (cf) cf.value = state.filters.course || '';
  if (cft) cft.value = state.filters.course || '';

  const op = $('onlyPending');
  const opt = $('onlyPendingTop');
  if (op) op.checked = !!state.filters.onlyPending;
  if (opt) opt.checked = !!state.filters.onlyPending;

  const or = $('onlyRisk');
  const ort = $('onlyRiskTop');
  if (or) or.checked = !!state.filters.onlyRisk;
  if (ort) ort.checked = !!state.filters.onlyRisk;
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


function computeBuckets(materias, studentYear, isEgresado) {
  const buckets = {
    aprobadas: [],
    adeudadas: [],
    primera: [],
    recursa: [],
    intensifica: [],
    atraso: []
  };

  const y = Number(studentYear || '');
  const isEgr = !!isEgresado;

  materias.forEach(m => {
    const cond = (m.condicion_academica || '').trim().toLowerCase();
    const sit = (m.situacion_actual || '').trim();
    const res = String(m.resultado_cierre || '').trim().toLowerCase();
    const matYear = Number(m.anio || '');

    if (cond === 'aprobada') buckets.aprobadas.push(m);

    const isAdeuda = (cond === 'adeuda') || (res === 'no_aprobada' || res === 'no aprobada' || res === 'no_aprobo' || res === 'no');
    const cuentaAdeuda = isAdeuda && sit !== 'proximos_anos' && (isEgr || isNaN(matYear) || isNaN(y) || matYear < y);
    if (cuentaAdeuda) buckets.adeudadas.push(m);

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


function renderOrientacion_(student) {
  const block = $('orientBlock');
  const sel = $('orientSelect');
  const msg = $('orientMsg');

  const grade = Number(student?.anio_actual || '');
  if (isNaN(grade) || grade < 4) {
    block.classList.add('hidden');
    return;
  }

  block.classList.remove('hidden');

  const opts = state.orientaciones || [];
  sel.innerHTML = '';

  const opt0 = document.createElement('option');
  opt0.value = '';
  opt0.textContent = '— Elegí orientación —';
  sel.appendChild(opt0);

  opts.forEach(o => {
    const opt = document.createElement('option');
    opt.value = o;
    opt.textContent = o;
    sel.appendChild(opt);
  });

  sel.value = student?.orientacion || '';

  if (!sel.value) {
    msg.textContent = 'Está en 4º+; elegí una orientación para que aparezcan las materias específicas.';
    msg.className = 'muted';
  } else {
    msg.textContent = '';
    msg.className = 'muted';
  }

  sel.onchange = async () => {
    const orient = sel.value || '';
    sel.disabled = true;
    try {
      await apiCall('updateStudentOrientation', {
        id_estudiante: student.id_estudiante,
        orientacion: orient,
        ciclo_lectivo: state.ciclo,
        usuario: 'web'
      });

      // Agregar filas faltantes del catálogo según la orientación elegida
      await apiCall('syncCatalogRows', { ciclo_lectivo: state.ciclo, id_estudiante: student.id_estudiante, usuario: 'web' });

      toast('Orientación guardada ✅');

      // Refrescar lista + detalle
      await loadStudents();
      const data = await apiCall('getStudentStatus', { ciclo_lectivo: state.ciclo, id_estudiante: student.id_estudiante });
      renderStudent(data.data);
    hideAppLoader_();
    } catch (err) {
      toast('No pude guardar la orientación: ' + (err?.message || err));
    } finally {
      sel.disabled = false;
    }
  };
}

function renderStudent(data) {
  state.studentData = data;
  state.originalByMateria.clear();
  state.dirtyByMateria.clear();
  $('btnSave').disabled = true;

  const s = data.estudiante || {};
  $('studentName').textContent = s.apellido ? `${s.apellido}, ${s.nombre}` : (s.nombre || s.id_estudiante || 'Estudiante');
  const cerrado = (data.materias || []).some(x => !!x.ciclo_cerrado);
  $('studentMeta').textContent = `${data.ciclo_lectivo} · ${s.division || ''} · ${s.turno || ''} · Año: ${s.anio_actual || '—'} · ID: ${s.id_estudiante || ''}` + (s.es_egresado ? ' · 🎓 EGRESADO' : '') + (cerrado ? ' · ✅ Ciclo cerrado' : '');

  renderOrientacion_(s);

  const materias = (data.materias || []).slice();

  // snapshot original
  materias.forEach(m => {
    state.originalByMateria.set(m.id_materia, JSON.parse(JSON.stringify(m)));
  });

  // stats & buckets
  const b = computeBuckets(materias, s.anio_actual, s.es_egresado);
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

  // Accordion counters (Panel)
  const setCount = (id, n) => { const el = $(id); if (el) el.textContent = `(${n})`; };
  setCount('accAprobadasCount', b.aprobadas.length);
  setCount('accAdeudadasCount', b.adeudadas.length);
  setCount('accPrimeraCount', b.primera.length);
  setCount('accRecursaCount', b.recursa.length);
  setCount('accIntensificaCount', b.intensifica.length);
  setCount('accAtrasoCount', b.atraso.length);

  renderEditorTable(materias);
  renderFamilyText(materias, data);

  // Mobile: default to Panel and keep bottom bar in sync
  if (isMobile_()) setTab_('panel');
  updateBottomBarState_();
}

function renderFamilyText(materias, data) {
  const s = data.estudiante || {};
  const { regular, intens } = counts(materias);

  const b = computeBuckets(materias, s.anio_actual, s.es_egresado);

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
  updateBottomBarState_();
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

function createCierreToggle_(id_materia, current){
  const wrap = document.createElement('div');
  wrap.className = 'cierre-toggle';

  const mkBtn = (val, label) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cierre-btn' + ((current||'') === val ? ' active' : '');
    b.textContent = label;
    b.onclick = () => {
      // update local state + dirty tracking
      setMateriaField(id_materia, 'resultado_cierre', val);
      // update visuals
      [...wrap.querySelectorAll('button')].forEach(x => x.classList.remove('active'));
      b.classList.add('active');

      const { faltan } = cierreProgress_();
      if (faltan === 0) setMessage('cierreMsg', 'Listo: ya marcaste todas ✅ (guardá para aplicar)', 'ok');
      else setMessage('cierreMsg', `Te faltan ${faltan} materias por marcar.`, '');
      updateBottomBarState_();
    };
    return b;
  };

  wrap.appendChild(mkBtn('aprobada', 'Aprobó'));
  wrap.appendChild(mkBtn('no_aprobada', 'No aprobó'));

  return wrap;
}

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

    tr.innerHTML = `
      <td data-label="Materia">${escapeHtml(m.nombre || m.id_materia)} <div class="muted">${escapeHtml(m.id_materia)}</div></td>
      <td data-label="Año">${escapeHtml(m.anio || '')}</td>
      <td data-label="Situación">${escapeHtml(cierreLabel(m.situacion_actual))}</td>
      <td data-label="Resultado"></td>
    `;

    tr.children[3].appendChild(createCierreToggle_(m.id_materia, (m.resultado_cierre || '').trim()));
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


function deriveOrientaciones_(catalog) {
  const set = new Set();
  (catalog || []).forEach(m => {
    const o = String(m.orientacion || '').trim();
    if (o) set.add(o);
  });
  return Array.from(set).sort((a,b) => a.localeCompare(b, 'es'));
}

async function loadCatalog() {
  const data = await apiCall('getCatalog', {});
  state.catalog = (data.catalog || []);
  state.orientaciones = deriveOrientaciones_(state.catalog);
}

async function loadStudents() {
  const data = await apiCall('getStudentList', { ciclo_lectivo: state.ciclo });
  state.students = data.students || [];
  rebuildCourseOptions(state.students);
  syncFiltersUI_();
  renderStudents(state.students);

  // Mobile UX: open picker automatically the first time
  if (isMobile_() && !state.selectedStudentId && state.students.length) {
    openStudentPicker_();
  }
}

async function selectStudent(id) {
  // Prevent double taps
  if (state._selectingStudent) return;
  state._selectingStudent = true;

  // Immediate feedback (mobile needs it)
  pulseTopLoader_();
  const mobile = isMobile_();
  if (mobile) showAppLoader_('Cargando estudiante…');

  // Force paint before doing heavier work / network
  await ensurePaint_();

  // If the picker is open, close it now (keyboard resize won't kick us back)
  if (mobile && isPickingStudent_) closeStudentPicker_();

  state.selectedStudentId = id;
  renderStudents(state.students);

  setMessage('saveMsg', '', '');
  $('btnSave').disabled = true;

  try {
    const ciclo = state.ciclo;
    const data = await apiCall('getStudentStatus', { ciclo_lectivo: ciclo, id_estudiante: id });
    renderStudent(data.data);
  } finally {
    if (mobile) hideAppLoader_();
    state._selectingStudent = false;
  }

  // Mobile UX: after selecting, jump to detail panel
  if (mobile) {
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



function setTab_(name){
  const tabs = document.querySelectorAll('.tab');
  tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  ['panel','editor','familia'].forEach(n => {
    const el = $(`tab-${n}`);
    if (el) el.classList.toggle('hidden', n !== name);
  });
}

function syncMobileCicloSelect_(){
  const a = $('cicloSelect');
  const b = $('cicloSelectMobile');
  if (!a || !b) return;
  b.value = a.value;
}

function updateBottomBarState_(){
  const save = $('btnBottomSave');
  const cierre = $('btnBottomCierre');
  const back = $('btnBottomBack');
  if (save) save.disabled = (state.dirtyByMateria.size === 0);
  if (cierre) cierre.disabled = !state.selectedStudentId;
  if (back) back.disabled = false;
}

function setMoreModalVisible_(visible){
  setModalVisible('modalMore', visible);
  if (visible) syncMobileCicloSelect_();
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
  // Micro-animación al tocar cualquier botón (mobile friendly)
  document.addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest('button');
    if (!btn) return;
    btn.classList.remove('tap');
    // reflow
    void btn.offsetWidth;
    btn.classList.add('tap');
    setTimeout(() => btn.classList.remove('tap'), 220);
    pulseTopLoader_();
  }, true);

  $('btnSaveKey').onclick = async () => {
    const key = $('apiKeyInput').value.trim();
    if (!key) return setMessage('gateMsg', 'Pegá la API Key.', 'err');

    localStorage.setItem(LS_KEY, key);
    state.apiKey = key;

    try {
      showAppLoader_('Conectando…');
      await apiCall('ping', {});
      setMessage('gateMsg', '', '');
      setGateVisible(false);
      showAppLoader_('Cargando ciclos y materias…');
      await loadCycles();
      await loadCatalog();
      showAppLoader_('Cargando estudiantes…');
      await loadStudents();
    } catch (err) {
      hideAppLoader_();
      setMessage('gateMsg', 'Clave inválida o backend mal configurado: ' + err.message, 'err');
    }
  };

  $('btnLogout').onclick = () => {
    localStorage.removeItem(LS_KEY);
    state.apiKey = null;
    $('apiKeyInput').value = '';
    setMessage('gateMsg', '', '');
    hideAppLoader_();
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

  const okWarn = confirm(
    "⚠️ IMPORTANTE\n\nSi NO cerraste la nota de TODOS los estudiantes del ciclo actual, NO continúes con 'Crear ciclo nuevo'.\n\n¿Confirmás que ya cerraste todo y querés continuar?"
  );
  if (!okWarn) return;

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

  // filtros estudiantes (mobile dentro del picker + desktop en barra superior)
  const onCourseChange_ = (val) => {
    state.filters.course = val || '';
    syncFiltersUI_();
    renderStudents(state.students);
  };
  const onPendingChange_ = (checked) => {
    state.filters.onlyPending = !!checked;
    syncFiltersUI_();
    renderStudents(state.students);
  };
  const onRiskChange_ = (checked) => {
    state.filters.onlyRisk = !!checked;
    syncFiltersUI_();
    renderStudents(state.students);
  };

  if ($('courseFilter')) $('courseFilter').onchange = () => onCourseChange_($('courseFilter').value);
  if ($('courseFilterTop')) $('courseFilterTop').onchange = () => onCourseChange_($('courseFilterTop').value);
  if ($('onlyPending')) $('onlyPending').onchange = () => onPendingChange_($('onlyPending').checked);
  if ($('onlyPendingTop')) $('onlyPendingTop').onchange = () => onPendingChange_($('onlyPendingTop').checked);
  if ($('onlyRisk')) $('onlyRisk').onchange = () => onRiskChange_($('onlyRisk').checked);
  if ($('onlyRiskTop')) $('onlyRiskTop').onchange = () => onRiskChange_($('onlyRiskTop').checked);

  if ($('btnClearFiltersTop')) $('btnClearFiltersTop').onclick = () => {
    state.filters.course = '';
    state.filters.onlyPending = false;
    state.filters.onlyRisk = false;
    syncFiltersUI_();
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
  // Mobile: student search opens as a modal (PC stays the same)
  if ($('btnShowStudents')) $('btnShowStudents').onclick = () => openStudentPicker_();
  if ($('btnShowDetail')) $('btnShowDetail').onclick = () => closeStudentPicker_();
  if ($('btnBackStudents')) $('btnBackStudents').onclick = () => openStudentPicker_();
  if ($('btnCloseStudents')) $('btnCloseStudents').onclick = () => closeStudentPicker_();
  if ($('studentsBackdrop')) $('studentsBackdrop').onclick = () => {
    // Ignore the "same tap" that just opened the picker
    if (Date.now() - pickerOpenedAt_ < 250) return;
    closeStudentPicker_();
  };
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeStudentPicker_();
  });

  // Mobile: top menu + bottom bar + quick actions
  if ($('btnTopMenu')) $('btnTopMenu').onclick = () => setMoreModalVisible_(true);
  if ($('btnBottomMore')) $('btnBottomMore').onclick = () => setMoreModalVisible_(true);
  if ($('btnCloseMore')) $('btnCloseMore').onclick = () => setMoreModalVisible_(false);
  if ($('modalMoreBackdrop')) $('modalMoreBackdrop').onclick = () => setMoreModalVisible_(false);

  if ($('btnBottomBack')) $('btnBottomBack').onclick = () => openStudentPicker_();
  if ($('btnBottomSave')) $('btnBottomSave').onclick = saveChanges;
  if ($('btnBottomCierre')) $('btnBottomCierre').onclick = async () => {
    if (!state.selectedStudentId) return toast('Elegí un/a estudiante primero.');
    await openCierreModalForStudent(state.selectedStudentId);
  };

  // Quick Panel buttons
  if ($('btnQuickEditor')) $('btnQuickEditor').onclick = () => setTab_('editor');
  if ($('btnQuickFamilia')) $('btnQuickFamilia').onclick = () => setTab_('familia');

  // More modal shortcuts
  if ($('btnMorePanel')) $('btnMorePanel').onclick = () => { setTab_('panel'); setMoreModalVisible_(false); };
  if ($('btnMoreEditor')) $('btnMoreEditor').onclick = () => { setTab_('editor'); setMoreModalVisible_(false); };
  if ($('btnMoreFamilia')) $('btnMoreFamilia').onclick = () => { setTab_('familia'); setMoreModalVisible_(false); };

  // More modal tools (proxy existing buttons)
  if ($('btnMoreRollover')) $('btnMoreRollover').onclick = () => { $('btnRollover').click(); setMoreModalVisible_(false); };
  if ($('btnMoreSummary')) $('btnMoreSummary').onclick = () => { $('btnDivisionSummary').click(); setMoreModalVisible_(false); };
  if ($('btnMoreRefresh')) $('btnMoreRefresh').onclick = () => { $('btnRefresh').click(); setMoreModalVisible_(false); };
  if ($('btnMoreLogout')) $('btnMoreLogout').onclick = () => { $('btnLogout').click(); setMoreModalVisible_(false); };

  // Close picker if switching to desktop layout
  window.addEventListener('resize', () => { if (!isMobile_()) closeStudentPicker_(); });

  // Mobile ciclo select sync
  if ($('cicloSelectMobile')) $('cicloSelectMobile').onchange = () => {
    $('cicloSelect').value = $('cicloSelectMobile').value;
    $('cicloSelect').dispatchEvent(new Event('change'));
    setMoreModalVisible_(false);
  };

  // When resizing, keep a sensible panel visible
  window.addEventListener('resize', () => {
    const bb = $('mobileBottomBar');
    if (bb) bb.classList.toggle('hidden', !isMobile_() || $('app').classList.contains('hidden'));
    updateBottomBarState_();

    if (!isMobile_()){
      // on desktop show both
      const students = $('studentsPanel');
      const detail = $('detailPanel');
      if (students) students.classList.remove('hidden-mobile');
      if (detail) detail.classList.remove('hidden-mobile');
    } else {
      // on mobile: don't open the picker if we're still on the API key gate
      if (!$('app').classList.contains('hidden')) {
        if (!isPickingStudent_) setMobilePanel_(state.selectedStudentId ? 'detail' : 'students');
      }
    }
  }, { passive: true });

}


async function init() {
  // Show the branded loader immediately on first paint
  startBootLoader_('Cargando…');
  await ensurePaint_();

  wireTabs();
  wireEvents();

  // Mobile: picker opens after loading students (avoid opening over the API key gate)
  if (isMobile_() && !$('app').classList.contains('hidden')) setMobilePanel_('students');
  updateBottomBarState_();

  state.ciclo = $('cicloSelect').value;

  const saved = localStorage.getItem(LS_KEY);
  if (saved) {
    state.apiKey = saved;
    try {
      showAppLoader_('Conectando…');
      await apiCall('ping', {});
      setGateVisible(false);

      showAppLoader_('Cargando ciclos y materias…');
      await loadCycles();
      await loadCatalog();

      showAppLoader_('Cargando estudiantes…');
      await loadStudents();

      hideBootLoader_();
    } catch {
      // clave vieja o backend mal
      setGateVisible(true);
      hideBootLoader_();
    }
  } else {
    setGateVisible(true);
    hideBootLoader_();
  }
}

init();

