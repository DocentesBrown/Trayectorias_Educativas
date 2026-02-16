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
- es_troncal

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

### Auditoria (opcional)
- timestamp
- ciclo_lectivo
- id_estudiante
- id_materia
- campo
- antes
- despues
- usuario

---

## 4) Acciones API
El frontend usa POST con JSON:
`{ apiKey, action, payload }`

Acciones:
- ping
- getCatalog
- getStudentList
- getStudentStatus  (payload: {ciclo_lectivo, id_estudiante})
- saveStudentStatus (payload: {ciclo_lectivo, id_estudiante, usuario, updates:[{id_materia, fields:{...}}]})
- syncCatalogRows  (payload: {ciclo_lectivo, id_estudiante, usuario})
