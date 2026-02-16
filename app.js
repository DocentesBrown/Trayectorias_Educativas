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



const $ = (id) => document.getElementById(id);

function situacionLabel(value) {
  const v = String(value || '').trim();
  const o = SITUACIONES.find(x => x.value === v);
  return o ? o.label : (v || '—');
}

function normalizeResultadoCierre(value) {
  const t = String(value || '').trim().toLowerCase();
  if (!t) return '';
  if (t === 'aprobada' || t === 'aprobo' || t === 'aprobó' || t === 'si' || t === 'sí') return 'aprobada';
  if (t === 'no_aprobada' || t === 'no aprobada' || t === 'no_aprobo' || t === 'no aprobó' || t === 'no') return 'no_aprobada';
  return '';
}

let state = {
  apiKey: null,
  ciclo: '2026',
  students: [],
  selectedStudentId: null,
  studentData: null,
  originalByMateria: new Map(), // id_materia -> snapshot
  dirtyByMateria: new Map(),    // id_materia -> fields changed

  // Modal de cierre por estudiante (resultado por materia)
  cierre: {
    studentId: null,
    studentName: '',
    materias: [],   // {id_materia,nombre,anio,situacion_actual,resultado_cierre}
    results: {}     // id_materia -> 'aprobada' | 'no_aprobada' | ''
  },
  closeStudentId: null,
  closeStudentStatus: null,
  closeMaterias: [],
  closeChoices: {}
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
  const filtered = (list || []).filter(s => {
    const t = `${s.id_estudiante} ${s.apellido} ${s.nombre} ${s.division} ${s.anio_actual} ${s.turno}`.toLowerCase();
    return t.includes(q);
  });

  const el = $('studentsList');
  el.innerHTML = '';

  filtered.forEach(s => {
    const div = document.createElement('div');

    const cls = ['item'];
    if (state.selectedStudentId === s.id_estudiante) cls.push('active');
    if (s.ciclo_cerrado) cls.push('closed');
    if (s.rosado) cls.push('review');

    div.className = cls.join(' ');

    div.innerHTML = `
      <div class="row between">
        <div class="title">${escapeHtml(`${s.apellido}, ${s.nombre}`)}</div>
        <button class="btn mini" data-action="close">Cierre</button>
      </div>
      <div class="sub">${escapeHtml(`${s.division || ''} · ${s.turno || ''} · Año: ${s.anio_actual || '—'} · ID: ${s.id_estudiante}`)}</div>
    `;

    div.onclick = () => selectStudent(s.id_estudiante);

    // botón cierre
    const btn = div.querySelector('button[data-action="close"]');
    btn.onclick = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      openCloseModalForStudent(s.id_estudiante);
    };

    // si ya está cerrado, el botón sigue disponible (por si hay que revisar), pero visualmente en gris
    if (s.ciclo_cerrado) btn.classList.add('ghost');

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

  const anioActual = Number(((state.studentData || {}).estudiante || {}).anio_actual || '');

  if (regular > 12) {
    const regla = (anioActual === 6)
      ? 'En 6to se prioriza cursa 1ra vez (materias del año) y se recortan recursas.'
      : 'En 1° a 5° se prioriza recursa y se recortan primero las materias del año.';
    alerts.push(`Te pasaste del tope: cursada regular = ${regular}/12. ${regla}`);
    alerts.push('Sugerencia: usá “Ajuste automático” para aplicar la prioridad.');
  }

  if (intens > 4) {
    alerts.push(`Te pasaste del tope: intensificación = ${intens}/4.`);
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

  const sorted = (materias || []).slice().sort((a,b) => (a.anio||0)-(b.anio||0) || String(a.nombre).localeCompare(String(b.nombre)));

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
      <td>${escapeHtml(m.nombre || m.id_materia)} <div class="muted">${escapeHtml(m.id_materia)}</div></td>
      <td>${escapeHtml(m.anio || '')}</td>
      <td>${condicion}</td>
      <td>${nunca}</td>
      <td></td>
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
  const anioActual = Number((state.studentData.estudiante || {}).anio_actual || '');

  // Regular list
  const regular = materias.filter(m => m.situacion_actual === 'cursa_primera_vez' || m.situacion_actual === 'recursa');
  if (regular.length <= 12) {
    setMessage('saveMsg', 'No hizo falta ajustar.', '');
    return;
  }

  const primera = regular.filter(m => m.situacion_actual === 'cursa_primera_vez');
  const recursa = regular.filter(m => m.situacion_actual === 'recursa');

  // Ordenes para decidir qué mover a tope
  const byAnioDesc = (a,b) => (Number(b.anio||0) - Number(a.anio||0)) || String(a.nombre||'').localeCompare(String(b.nombre||''));
  const byAnioAsc = (a,b) => (Number(a.anio||0) - Number(b.anio||0)) || String(a.nombre||'').localeCompare(String(b.nombre||''));

  let total = primera.length + recursa.length;
  let moved = 0;

  // Regla pedida:
  // - Si el estudiante está en 6to: priorizar materias del año (cursa 1ra vez) y recortar recursas.
  // - Si está en otros años: priorizar recursas y recortar primero las del año (cursa 1ra vez).
  const isSeis = (anioActual === 6);

  if (isSeis) {
    // Mover recursas a tope primero
    const recSorted = recursa.slice().sort(byAnioDesc);
    while (total > 12 && recSorted.length) {
      const m = recSorted.shift();
      setMateriaField(m.id_materia, 'situacion_actual', 'no_cursa_por_tope');
      total--; moved++;
    }

    // Si todavía sobra (caso raro), mover también algunas de primera vez
    if (total > 12) {
      const priSorted = primera.slice().sort(byAnioAsc);
      while (total > 12 && priSorted.length) {
        const m = priSorted.shift();
        setMateriaField(m.id_materia, 'situacion_actual', 'no_cursa_por_tope');
        total--; moved++;
      }
    }
  } else {
    // Mover primeras veces a tope primero (para priorizar recursa)
    const priSorted = primera.slice().sort(byAnioAsc);
    while (total > 12 && priSorted.length) {
      const m = priSorted.shift();
      setMateriaField(m.id_materia, 'situacion_actual', 'no_cursa_por_tope');
      total--; moved++;
    }

    // Si todavía sobra (muchísimas adeudadas), mover recursas
    if (total > 12) {
      const recSorted = recursa.slice().sort(byAnioDesc);
      while (total > 12 && recSorted.length) {
        const m = recSorted.pop(); // sacar las menos prioritarias (años más bajos)
        setMateriaField(m.id_materia, 'situacion_actual', 'no_cursa_por_tope');
        total--; moved++;
      }
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

async async function openCloseModalForStudent(idEstudiante) {
  if (!idEstudiante) return;
  // Cargar estado del estudiante (sin depender de la selección actual)
  setMessage('closeModalMsg', 'Cargando materias…', '');
  $('btnApplyCloseModal').disabled = true;

  try {
    const data = await apiCall('getStudentStatus', { ciclo_lectivo: state.ciclo, id_estudiante: idEstudiante });
    const status = data.data || {};
    const est = status.estudiante || {};

    state.closeStudentId = idEstudiante;
    state.closeStudentStatus = status;

    $('closeModalTitle').textContent = `Cierre de ciclo · ${est.apellido ? `${est.apellido}, ${est.nombre}` : (est.nombre || idEstudiante)}`;

    // Materias a cerrar: cursa 1ra vez / recursa / intensifica (y no aprobadas)
    const materias = (status.materias || []).filter(m => {
      const cond = String(m.condicion_academica || '').trim().toLowerCase();
      if (cond === 'aprobada') return false;
      const sit = String(m.situacion_actual || '').trim();
      return sit === 'cursa_primera_vez' || sit === 'recursa' || sit === 'intensifica';
    });

    state.closeMaterias = materias;
    state.closeChoices = {}; // id_materia -> 'aprobada' | 'no_aprobada'
    materias.forEach(m => {
      const rc = String(m.resultado_cierre || '').trim().toLowerCase();
      if (rc === 'aprobada' || rc === 'aprobo' || rc === 'aprobó' || rc === 'si' || rc === 'sí') state.closeChoices[m.id_materia] = 'aprobada';
      if (rc === 'no_aprobada' || rc === 'no aprobada' || rc === 'no_aprobo' || rc === 'no aprobó' || rc === 'no') state.closeChoices[m.id_materia] = 'no_aprobada';
    });

    renderCloseTable();
    setModalVisible('modalClose', true);
    setMessage('closeModalMsg', '', '');
    validateCloseReady();
  } catch (err) {
    setMessage('closeModalMsg', 'Error: ' + err.message, 'err');
    setModalVisible('modalClose', true);
  }
}

function situacionLabel_(sit) {
  const found = SITUACIONES.find(x => x.value === sit);
  return found ? found.label : (sit || '—');
}

function renderCloseTable() {
  const tbody = $('closeTbody');
  tbody.innerHTML = '';

  const materias = (state.closeMaterias || []).slice().sort((a,b) => (a.anio||0)-(b.anio||0) || String(a.nombre).localeCompare(String(b.nombre)));

  if (!materias.length) {
    tbody.innerHTML = `<tr><td colspan="3" class="muted">No hay materias para cerrar (no cursó/recursó/intensificó).</td></tr>`;
    validateCloseReady();
    return;
  }

  materias.forEach(m => {
    const tr = document.createElement('tr');
    const choice = state.closeChoices[m.id_materia] || '';

    tr.innerHTML = `
      <td>${escapeHtml(m.nombre || m.id_materia)}
        <div class="muted">Año ${escapeHtml(m.anio || '—')} · ${escapeHtml(m.id_materia)}</div>
      </td>
      <td>${escapeHtml(situacionLabel_(m.situacion_actual))}</td>
      <td></td>
    `;

    const box = document.createElement('div');
    box.className = 'choicebox';

    const btnA = document.createElement('button');
    btnA.className = 'choice' + (choice === 'aprobada' ? ' on' : '');
    btnA.type = 'button';
    btnA.textContent = 'Aprobó';
    btnA.onclick = () => { state.closeChoices[m.id_materia] = 'aprobada'; renderCloseTable(); };

    const btnN = document.createElement('button');
    btnN.className = 'choice' + (choice === 'no_aprobada' ? ' on' : '');
    btnN.type = 'button';
    btnN.textContent = 'No aprobó';
    btnN.onclick = () => { state.closeChoices[m.id_materia] = 'no_aprobada'; renderCloseTable(); };

    box.appendChild(btnA);
    box.appendChild(btnN);
    tr.children[2].appendChild(box);

    tbody.appendChild(tr);
  });

  validateCloseReady();
}

function validateCloseReady() {
  const materias = state.closeMaterias || [];
  if (!materias.length) {
    $('btnApplyCloseModal').disabled = true;
    return;
  }
  const allDone = materias.every(m => !!state.closeChoices[m.id_materia]);
  $('btnApplyCloseModal').disabled = !allDone;
}

async function applyCloseModal() {
  const sid = state.closeStudentId;
  if (!sid) return;

  const materias = state.closeMaterias || [];
  if (!materias.length) return;

  const allDone = materias.every(m => !!state.closeChoices[m.id_materia]);
  if (!allDone) return;

  $('btnApplyCloseModal').disabled = true;
  setMessage('closeModalMsg', 'Guardando cierre…', '');

  try {
    // 1) Guardar resultados de cierre en EstadoPorCiclo
    const updates = materias.map(m => ({
      id_materia: m.id_materia,
      fields: { resultado_cierre: state.closeChoices[m.id_materia] }
    }));

    await apiCall('saveStudentStatus', {
      ciclo_lectivo: state.ciclo,
      id_estudiante: sid,
      usuario: 'web',
      updates
    });

    // 2) Aplicar cierre (actualiza condición académica y marca ciclo_cerrado)
    const res = await apiCall('closeCycle', {
      ciclo_lectivo: state.ciclo,
      id_estudiante: sid,
      usuario: 'web',
      marcar_cerrado: true
    });

    // refrescar panel si corresponde
    if (state.selectedStudentId === sid && res.data && res.data.status) {
      renderStudent(res.data.status);
    }

    // refrescar lista para poner en gris / rosado
    await loadStudents();

    setMessage('closeModalMsg', 'Cierre aplicado ✅', 'ok');
    setTimeout(() => {
      setModalVisible('modalClose', false);
      setMessage('closeModalMsg', '', '');
    }, 700);

  } catch (err) {
    setMessage('closeModalMsg', 'Error al cerrar: ' + err.message, 'err');
    $('btnApplyCloseModal').disabled = false;
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

$('btnCloseCloseModal').onclick = () => setModalVisible('modalClose', false);
$('modalCloseBackdrop').onclick = () => setModalVisible('modalClose', false);
$('btnApplyCloseModal').onclick = applyCloseModal;

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
    `Esto crea/actualiza el ciclo ${destino} con promoción automática:\n\n` +
    `• Estudiantes: anio_actual +1 (y ajusta división si se puede)\n` +
    `• Nuevo año: “Cursa por 1ra vez”\n` +
    `• Adeudadas: hasta 4 → “Intensifica”\n` +
    `• Si el total regular supera 12:\n` +
    `  - Si pasa a 6to: prioriza materias de 6to y completa con recursa\n` +
    `  - En otros años: prioriza recursa y deja sin cursar por tope materias del año\n\n` +
    `No borra ni modifica ciclos anteriores.\n\n¿Continuar?`
  );
  if (!ok) return;

  try {
    const res = await apiCall('rolloverCycle', {
      ciclo_origen: origen,
      ciclo_destino: destino,
      usuario: 'web',
      update_students: true,
      update_division: true
    });

    alert(
      `Rollover listo ✅\n\n` +
      `Origen: ${res.data.ciclo_origen} (existe: ${res.data.origen_existe})\n` +
      `Destino: ${res.data.ciclo_destino}\n` +
      `Filas creadas: ${res.data.filas_creadas}\n` +
      `Filas actualizadas (destino): ${res.data.filas_actualizadas_destino || 0}\n` +
      `Omitidas (destino en uso): ${res.data.filas_omitidas_destino_en_uso || 0}\n` +
      `Estudiantes promovidos: ${res.data.estudiantes_promovidos || 0}` +
      (res.data.estudiantes_rosado ? `\nEstudiantes en rosado (tope 12): ${res.data.estudiantes_rosado}` : '')
    );

    await loadCycles();
    $('cicloSelect').value = destino;
    state.ciclo = destino;

    await loadStudents();
    if (state.selectedStudentId) await selectStudent(state.selectedStudentId);
  } catch (err) {
    alert('Error: ' + err.message);
  }
};

$('studentSearch').oninput = () => renderStudents(state.students);

  $('cicloSelect').onchange = async () => {
    state.ciclo = $('cicloSelect').value;
    await loadStudents();
    if (state.selectedStudentId) await selectStudent(state.selectedStudentId);
  };

  $('btnSave').onclick = saveChanges;
  $('btnSync').onclick = syncCatalogRows;

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
