# Trayectorias Secundaria (GitHub Pages + Google Sheets)

## 1) Backend (Google Apps Script)

### A. Pegá el código
1. Abrí tu Google Sheet.
2. Extensiones → Apps Script.
3. Pegá el contenido de `Code.gs` reemplazando todo.
4. Guardá.

### B. Generá tu API Key (Opción B)
- Volvé a la planilla y recargá.
- Menú: **📘 Trayectorias → 🔑 Generar/Mostrar API Key**
- Copiá esa clave y guardala.

### C. Deploy como Web App
1. En Apps Script: **Implementar → Nueva implementación**
2. Tipo: **Aplicación web**
3. Ejecuta como: **Yo**
4. Quién tiene acceso: **Cualquiera** (sí, porque la seguridad la hace la API Key)
5. Implementar → Copiá la URL del Web App (termina en `/exec`)

> Nota: Si cambiás el código después, tenés que crear una nueva implementación o actualizar la existente.

---

## 2) Frontend (GitHub Pages)

### A. Subí la carpeta `frontend/` a tu repo
Archivos:
- `index.html`
- `styles.css`
- `config.js`
- `app.js`

### B. Configurá el backend URL
Editá `config.js` y pegá tu URL del Web App.

### C. API Key
La API Key **NO está en el repo**: se ingresa en la pantalla de la app y se guarda en `localStorage` del navegador.

---

## 3) Estructura esperada de las pestañas (headers)
Nombres exactos de pestañas:
- Estudiantes
- MateriasCatalogo
- EstadoPorCiclo
- (opcional) Auditoria

Headers mínimos:

### Estudiantes
- id_estudiante
- apellido
- nombre
- anio_actual
- division
- turno
- activo
- observaciones

### MateriasCatalogo
- id_materia
- nombre
- anio
- es_troncal  (opcional / ignorado por la app)

### EstadoPorCiclo
- ciclo_lectivo
- id_estudiante
- id_materia
- condicion_academica
- nunca_cursada
- situacion_actual
- motivo_no_cursa
- fecha_actualizacion
- usuario
- resultado_cierre  (opcional, se crea solo; valores sugeridos: aprobada / no_aprobada)
- ciclo_cerrado     (opcional, se crea solo; TRUE/FALSE)

### Auditoria (opcional)
- timestamp
- ciclo_lectivo
- id_estudiante
- id_materia
- campo
- antes
- despues
- usuario
- resultado_cierre  (opcional, se crea solo; valores sugeridos: aprobada / no_aprobada)
- ciclo_cerrado     (opcional, se crea solo; TRUE/FALSE)

---

## 4) Acciones API
El frontend usa POST con JSON:
`{ apiKey, action, payload }`

Acciones:
- ping
- getCycles
- getCatalog
- getStudentList
- getStudentStatus  (payload: {ciclo_lectivo, id_estudiante})
- saveStudentStatus (payload: {ciclo_lectivo, id_estudiante, usuario, updates:[{id_materia, fields:{...}}]})
- syncCatalogRows  (payload: {ciclo_lectivo, id_estudiante, usuario})
- rolloverCycle   (payload: {ciclo_origen, ciclo_destino, usuario, update_students?:boolean, update_division?:boolean})
- getDivisionRiskSummary (payload: {ciclo_lectivo, umbral?:number})
- closeCycle (payload: {ciclo_lectivo, id_estudiante?:string, usuario?:string, marcar_cerrado?:boolean})


---

## 5) Rollover anual (nuevo ciclo) + Promoción de estudiantes
- En la app: botón **Crear ciclo nuevo**.
- Crea filas en `EstadoPorCiclo` para el ciclo destino, para todos los estudiantes activos y todas las materias del catálogo.
- No modifica ni borra ciclos anteriores.
- La situación inicial del nuevo ciclo queda neutral (`no_cursa_otro_motivo`) para que el equipo cargue el plan anual.


### Promoción automática (opcional)
Durante el rollover, podés elegir actualizar la pestaña **Estudiantes**:
- `anio_actual` suma 1 (máximo 6)
- `division` intenta sumar 1 al número inicial (ej: 4°A → 5°A)

Si alguna división no se puede interpretar, se deja igual.
