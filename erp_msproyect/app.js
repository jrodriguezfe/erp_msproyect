import { initializeApp } from "https://www.gstatic.com/firebasejs/9.6.10/firebase-app.js";
import { 
    getFirestore, collection, addDoc, getDocs, updateDoc, 
    deleteDoc, doc, query, where, orderBy 
} from "https://www.gstatic.com/firebasejs/9.6.10/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyBNd1j7cMj4EzlBZDUlZ9XnW3p9OcA_TDs",
    authDomain: "erp-proyect-cttc.firebaseapp.com",
    projectId: "erp-proyect-cttc",
    storageBucket: "erp-proyect-cttc.firebasestorage.app",
    messagingSenderId: "827783903328",
    appId: "1:827783903328:web:4f3b2fd46c77e528552b05"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

let chartInstance = null;
let currentTaskId = null;
let collapsedGroups = new Set(); // Almacena IDs de actividades contraídas
let currentGanttStart = "2025-03-30"; // Fecha inicial por defecto (ajustable)
let cachedActivities = []; // Caché local para evitar parpadeos en el toggle

document.getElementById('detail-progress').oninput = function() {
    document.getElementById('prog-val').innerText = this.value;
};

function renderGanttTimeline(startDateStr) {
    const header = document.getElementById('gantt-header');
    if (!header) return;
    header.innerHTML = '';

    // CORRECCIÓN: Agregar T00:00:00 para evitar desfase de zona horaria
    let current = new Date(startDateStr + "T00:00:00");
    
    const days = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
    
    // Generamos 120 días para cubrir el min-width de 4800px (120 * 40px)
    for (let i = 0; i < 120; i++) {
        const dayDiv = document.createElement('div');
        dayDiv.className = 'header-day';
        
        // Estilo en línea para asegurar sincronización con el ancho de las barras
        dayDiv.style.minWidth = "40px"; 
        dayDiv.style.width = "40px";

        const dayName = days[current.getDay()];
        const dayNum = current.getDate();
        const monthName = current.toLocaleDateString('es-ES', { month: 'short' });

        // Identificar fines de semana visualmente (Opcional, para impacto profesional)
        if (current.getDay() === 0 || current.getDay() === 6) {
            dayDiv.style.background = "#f0f2f5";
            dayDiv.style.color = "#e74c3c"; // Rojo para domingos
        }

        dayDiv.innerHTML = `
            <span class="month-label" style="font-size: 8px; text-transform: uppercase;">${monthName}</span>
            <span class="day-letter" style="color: #666;">${dayName}</span>
            <b class="day-number" style="font-size: 13px;">${dayNum}</b>
        `;
        
        header.appendChild(dayDiv);
        
        // Avanzar un día
        current.setDate(current.getDate() + 1);
    }
}

async function renderAll(useCache = false) {
    const barsContainer = document.getElementById('gantt-bars-container');
    const predSelectNew = document.getElementById('predecessor-select'); 
    const predSelectDetail = document.getElementById('detail-predecessor'); 
    const parentSelectNew = document.getElementById('parent-select');
    const parentSelectDetail = document.getElementById('detail-parent');
    const kpiProg = document.getElementById('kpi-prog');
    if (!barsContainer) return;

    try {
        // 1. OBTENCIÓN DE DATOS (Solo si no usamos caché)
        if (!useCache) {
            const q = query(collection(db, "activities"), orderBy("start"));
            const snap = await getDocs(q);
            cachedActivities = [];
            snap.forEach(d => cachedActivities.push({ id: d.id, ...d.data() }));
        }

        const activities = cachedActivities;
        let totalProg = 0;
        let done = 0, inprog = 0, todo = 0;

        activities.forEach(task => {
            const p = Number(task.progress) || 0;
            totalProg += p;
            
            if (p >= 100) done++; 
            else if (p > 0) inprog++; 
            else todo++;
        });

        // 2. LIMPIEZA E INICIALIZACIÓN DE UI (Justo antes de dibujar para evitar flash)
        barsContainer.innerHTML = '';
        const emptyParentOpt = '<option value="">-- Sin Agrupador (Raíz) --</option>';
        const emptyOpt = '<option value="raiz">🚩 Actividad Inicial (Raíz)</option>';
        
        if (predSelectNew) predSelectNew.innerHTML = emptyOpt;
        if (predSelectDetail) predSelectDetail.innerHTML = emptyOpt;
        if (parentSelectNew) parentSelectNew.innerHTML = emptyParentOpt;
        if (parentSelectDetail) parentSelectDetail.innerHTML = emptyParentOpt;

        activities.forEach(task => {
            const optHtml = `<option value="${task.id}">${task.name}</option>`;
            if (predSelectNew) predSelectNew.innerHTML += optHtml;
            if (predSelectDetail) predSelectDetail.innerHTML += optHtml;
            if (parentSelectNew) parentSelectNew.innerHTML += optHtml;
            if (parentSelectDetail) parentSelectDetail.innerHTML += optHtml;
        });

        // Identificar qué tareas son padres (tienen subactividades)
        const parentIds = new Set(activities.map(t => t.parentId).filter(id => id));

        // --- LÓGICA DE FECHAS DINÁMICAS ---
        const dateInput = document.getElementById('gantt-start-date');
        if (dateInput && dateInput.value) {
            currentGanttStart = dateInput.value;
        } else if (activities.length > 0) {
            currentGanttStart = activities[0].start; // Auto-ajuste a la actividad más antigua
        }

        renderGanttTimeline(currentGanttStart);
        const globalStart = new Date(currentGanttStart + "T00:00:00");

        // --- INTEGRACIÓN KANBAN ---
        await renderKanban(activities);

        // FILTRAR ACTIVIDADES VISIBLES (Lógica de Acoplamiento)
        const visibleActivities = activities.filter(task => {
            let pId = task.parentId;
            while (pId) {
                if (collapsedGroups.has(pId)) return false;
                const parent = activities.find(a => a.id === pId);
                pId = parent ? parent.parentId : null;
            }
            return true;
        });

        // 2. DIBUJAR BARRAS EN EL GANTT CON PRECISIÓN
        visibleActivities.forEach((task, i) => {
            const taskStart = new Date(task.start + "T00:00:00");
            const diffDays = Math.floor((taskStart - globalStart) / (1000 * 60 * 60 * 24));
            const dateEnd = calculateEndDate(task.start, task.duration);
            
            const bar = document.createElement('div');
            bar.className = 'gantt-bar';
            
            // Estilo visual según jerarquía
            if (parentIds.has(task.id)) {
                bar.classList.add('parent-bar');
            } else if (task.parentId) {
                bar.classList.add('sub-task-bar');
            }

            // Indentación visual si es sub-tarea (opcional, 20px de margen izquierdo en el texto)
            const indent = task.parentId ? "padding-left: 20px;" : "";
            
            bar.style.left = `${(diffDays * 40)}px`; 
            bar.style.width = `${(Number(task.duration) || 1) * 40}px`;
            bar.style.top = `${i * 45 + 10}px`; 
            
            // Botón de expansión/contracción si es padre
            let toggleHtml = "";
            if (parentIds.has(task.id)) {
                const isCollapsed = collapsedGroups.has(task.id);
                toggleHtml = `<span class="gantt-toggle" onclick="event.stopPropagation(); window.toggleGroup('${task.id}')">
                    ${isCollapsed ? '▶' : '▼'}
                </span> `;
            }

            bar.innerHTML = `<div style="${indent}">${toggleHtml}${task.name} <small>(${task.progress || 0}%)</small></div>`;
            bar.onclick = () => window.openDetails(task);
            barsContainer.appendChild(bar);
        });

        // 3. ACTUALIZACIÓN DE KPIs
        if (activities.length > 0) {
            const avgProg = (totalProg / activities.length).toFixed(1);
            if (kpiProg) kpiProg.innerText = `${avgProg}%`;
        }
        
        renderStatusChart(todo, inprog, done);
        await loadResources(); 
        await updateProjectCost();
        
    } catch (e) { 
        console.error("Error crítico en renderAll de erp_msproyect:", e); 
    }
    
    await renderResourceSummary();
}

window.toggleGroup = (id) => {
    if (collapsedGroups.has(id)) collapsedGroups.delete(id);
    else collapsedGroups.add(id);
    renderAll(true); // Usar caché para que la expansión sea instantánea
};

window.openDetails = (task) => {
    currentTaskId = task.id;
    document.getElementById('detail-comments').value = task.comments || "";
    // 1. Datos Generales y Títulos
    document.getElementById('detail-name').value = task.name || "";
    document.getElementById('detail-title').innerText = task.name || "Detalles de Tarea";
    document.getElementById('detail-sprint').value = task.sprint || 1;

    // 2. Programación de Fechas
    document.getElementById('detail-start').value = task.start || "";
    document.getElementById('detail-duration').value = task.duration || 1;
    
    // Calcular y mostrar la fecha de fin estimada
    const dateEnd = calculateEndDate(task.start, task.duration);
    document.getElementById('detail-end').value = dateEnd;

    // 3. Progreso
    const progress = task.progress || 0;
    document.getElementById('prog-val').innerText = progress;
    document.getElementById('detail-progress').value = progress;

    // 4. LÓGICA DE PREDECESOR (Actividad Raíz)
    const detailPredSelect = document.getElementById('detail-predecessor');
    if (detailPredSelect) {
        // CORRECCIÓN: Si no tiene predecessorId, seleccionamos la opción "raiz"
        detailPredSelect.value = task.predecessorId || "raiz";
    }

    if (document.getElementById('detail-parent')) {
        document.getElementById('detail-parent').value = task.parentId || "";
    }

    // 5. Gestión de Recursos y Costos
    document.getElementById('res-select').value = task.assignedResource || "";
    document.getElementById('res-hours').value = task.estimatedHours || 0;
    
    // NUEVO: Cargar el costo externo (Bienes y Servicios)
    const externalCostInput = document.getElementById('detail-external-cost');
    if (externalCostInput) {
        externalCostInput.value = task.externalCosts || 0;
    }

    // 6. Activar Panel
    document.getElementById('details-panel').classList.add('active');
};

document.getElementById('btn-update-task').onclick = async () => {
    if (!currentTaskId) return;

    // 1. Capturar nuevos valores de la UI (incluyendo comentarios)
    const newName = document.getElementById('detail-name').value;
    const newStart = document.getElementById('detail-start').value;
    const newProgress = Number(document.getElementById('detail-progress').value);
    const newSprint = Number(document.getElementById('detail-sprint').value);
    const inputDuration = Number(document.getElementById('detail-duration').value);
    const externalCosts = Number(document.getElementById('detail-external-cost').value);
    const newComments = document.getElementById('detail-comments').value; // Nueva Bitácora
    
    const selectedPredecessor = document.getElementById('detail-predecessor').value;
    const newPredecessorId = selectedPredecessor === "raiz" ? "" : selectedPredecessor;
    const newParentId = document.getElementById('detail-parent').value;

    try {
        const taskRef = doc(db, "activities", currentTaskId);
        const snap = await getDocs(collection(db, "activities"));
        const oldTask = snap.docs.find(d => d.id === currentTaskId).data();
        
        // 2. Determinar duración final (Lógica 100% real vs planificada)
        let finalDuration = inputDuration;
        if (newProgress === 100 && oldTask.progress < 100) {
            const today = new Date().toISOString().split('T')[0];
            finalDuration = getDayDiff(oldTask.start, today) + 1;
            await updateDoc(taskRef, { plannedDuration: oldTask.duration });
        } else if (newProgress < 100 && oldTask.progress === 100) {
            finalDuration = oldTask.plannedDuration || oldTask.duration;
        }

        // --- LÓGICA DE EMPUJE (CASCADA) ---
        // Al sumar startOffset y durationChange, cubrimos adelantos y retrasos
        const startOffset = getDayDiff(oldTask.start, newStart);
        const durationChange = finalDuration - oldTask.duration;
        const totalImpactOffset = startOffset + durationChange; 

        // 3. Actualizar en Firebase
        await updateDoc(taskRef, {
            name: newName,
            start: newStart,
            duration: finalDuration,
            progress: newProgress,
            sprint: newSprint,
            assignedResource: document.getElementById('res-select').value,
            estimatedHours: Number(document.getElementById('res-hours').value),
            externalCosts: externalCosts,
            comments: newComments, // Persistencia de la evidencia
            predecessorId: newPredecessorId,
            parentId: newParentId
        });

        // 4. DISPARAR CASCADA
        if (totalImpactOffset !== 0) {
            await updateDependenciesCascade(currentTaskId, totalImpactOffset);
        }

        alert("¡Cronograma de erp_msproyect actualizado con éxito!");
        window.togglePanel(false);
        renderAll(); 
    } catch (e) { 
        console.error("Error al actualizar actividad:", e); 
        alert("Hubo un error al actualizar los datos.");
    }
};


document.getElementById('btn-save-task').onclick = async () => {
    const name = document.getElementById('task-name').value;
    const start = document.getElementById('task-start').value;
    const duration = document.getElementById('task-duration').value;
    const sprint = document.getElementById('task-sprint').value; 
    const priority = document.getElementById('task-priority').value; 
    const predecessorId = document.getElementById('predecessor-select').value;
    const parentId = document.getElementById('parent-select').value;

    // Validación de datos obligatorios
    if(!name || !start || !duration) return alert("Faltan datos");

    try {
        await addDoc(collection(db, "activities"), { 
            name, 
            start, 
            duration: Number(duration), 
            sprint: Number(sprint) || 1, 
            priority: priority || "Media",
            progress: 0, 
            predecessorId: predecessorId === "raiz" ? "" : (predecessorId || ""),
            parentId: parentId || ""
         });

        // Limpieza de campos tras éxito
        document.getElementById('task-name').value = ""; 
        document.getElementById('task-duration').value = "";
        
        // Notificación opcional de éxito
        console.log("Actividad guardada correctamente en erp_msproyect");
        
        renderAll();
    } catch (e) { 
        console.error("Error al guardar en Firebase:", e);
        alert("Error al guardar la actividad"); 
    }
};

async function loadResources() {
    const resSelect = document.getElementById('res-select');
    const snap = await getDocs(collection(db, "resources"));
    let options = '<option value="">-- Seleccionar --</option>';
    snap.forEach(d => {
        const res = d.data();
        options += `<option value="${d.id}">${res.name} (S/. ${res.rate})</option>`;
    });
    if(resSelect) resSelect.innerHTML = options;
}

async function updateProjectCost() {
    const snap = await getDocs(collection(db, "activities"));
    const resSnap = await getDocs(collection(db, "resources"));
    let rates = {};
    resSnap.forEach(d => rates[d.id] = d.data().rate);

    let costLabor = 0;
    let costExternal = 0;

    snap.forEach(d => {
        const task = d.data();
        // Costo Mano de Obra
        if (task.assignedResource && task.estimatedHours) {
            costLabor += (task.estimatedHours * (rates[task.assignedResource] || 0));
        }
        // Costo Bienes/Servicios (Nuevo campo)
        costExternal += Number(task.externalCosts || 0);
    });

    const totalProject = costLabor + costExternal;
    document.getElementById('kpi-cost').innerText = totalProject.toLocaleString('es-PE', { minimumFractionDigits: 2 });
    // Opcional: Mostrar desglose en consola o UI
}

document.getElementById('btn-save-resource').onclick = async () => {
    const name = document.getElementById('res-name-new').value;
    const rate = document.getElementById('res-rate-new').value;
    if(!name || !rate) return alert("Faltan datos");
    await addDoc(collection(db, "resources"), { name, rate: Number(rate) });
    alert("Recurso registrado");
    renderAll();
};

async function updateDependenciesCascade(parentTaskId, dayOffset) {
    // Buscamos tareas donde SU predecesor sea la tarea que acabamos de cambiar
    const q = query(collection(db, "activities"), where("predecessorId", "==", parentTaskId));
    const snap = await getDocs(q);
    
    // Procesamos cada sucesora encontrada
    const updates = snap.docs.map(async (d) => {
        const childData = d.data();
        // Calculamos nueva fecha sumando el desfase recibido
        const newChildStart = addDays(childData.start, dayOffset);
        
        // Actualizamos la sucesora
        await updateDoc(doc(db, "activities", d.id), { start: newChildStart });
        
        // RECURSIVIDAD: Disparamos el cambio hacia los "nietos" de la cadena
        await updateDependenciesCascade(d.id, dayOffset);
    });
    
    await Promise.all(updates);
}

function addDays(dateStr, days) {
    const date = new Date(dateStr + "T00:00:00");
    date.setDate(date.getDate() + days);
    return date.toISOString().split('T')[0];
}

function getDayDiff(oldDateStr, newDateStr) {
    const oldD = new Date(oldDateStr + "T00:00:00");
    const newD = new Date(newDateStr + "T00:00:00");
    return Math.round((newD - oldD) / (1000 * 60 * 60 * 24));
}

function renderStatusChart(todo, inprog, done) {
    const canvas = document.getElementById('statusChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if(chartInstance) chartInstance.destroy();
    chartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Pte', 'Prog', 'Fin'],
            datasets: [{ data: [todo, inprog, done], backgroundColor: ['#e74c3c', '#f1c40f', '#27ae60'] }]
        },
        options: { maintainAspectRatio: false, plugins: { legend: { display: false } } }
    });
}

window.togglePanel = (show) => {
    if(!show) document.getElementById('details-panel').classList.remove('active');
};

window.deleteTask = async () => {
    if (!currentTaskId || !confirm("¿Eliminar actividad?")) return;
    await deleteDoc(doc(db, "activities", currentTaskId));
    window.togglePanel(false);
    renderAll();
};


async function renderResourceSummary() {
    const tableBody = document.getElementById('resource-table-body');
    if (!tableBody) return;

    try {
        // 1. Obtener datos actuales
        const activitiesSnap = await getDocs(collection(db, "activities"));
        const resourcesSnap = await getDocs(collection(db, "resources"));

        // 2. Mapear recursos para tener nombres y tasas a mano
        let resourceMap = {};
        resourcesSnap.forEach(d => {
            resourceMap[d.id] = {
                name: d.data().name,
                rate: d.data().rate,
                tasks: [],
                totalHours: 0,
                totalCost: 0
            };
        });

        // 3. Agrupar actividades por recurso
        activitiesSnap.forEach(d => {
            const task = d.data();
            const resId = task.assignedResource;

            if (resId && resourceMap[resId]) {
                const hours = Number(task.estimatedHours) || 0;
                const cost = hours * (Number(resourceMap[resId].rate) || 0);

                resourceMap[resId].tasks.push(task.name);
                resourceMap[resId].totalHours += hours;
                resourceMap[resId].totalCost += cost;
            }
        });

        // 4. Generar el HTML de la tabla
        tableBody.innerHTML = '';
        Object.entries(resourceMap).forEach(([id, res]) => {
            const row = document.createElement('tr');
            row.style.borderBottom = "1px solid #eee";
            
            // Formateo de datos
            const totalCosto = res.totalCost.toLocaleString('es-PE', {minimumFractionDigits: 2});
            const actividades = res.tasks.length > 0 ? res.tasks.join(', ') : '<span style="color: #ccc;">Ninguna</span>';

            row.innerHTML = `
                <td style="padding: 10px;"><b>${res.name}</b></td>
                <td style="padding: 10px;">S/. ${res.rate}</td>
                <td style="padding: 10px; font-size: 0.85em; color: #7f8c8d;">${actividades}</td>
                <td style="padding: 10px;">${res.totalHours} hrs / S/. ${totalCosto}</td>
                <td style="padding: 10px;">
                    <button onclick="editResource('${id}', '${res.name}', ${res.rate})" style="border:none; background:#f1c40f; color:white; padding:5px 10px; border-radius:3px; cursor:pointer; margin-right:5px;">✎</button>
                    <button onclick="deleteResource('${id}')" style="border:none; background:#e74c3c; color:white; padding:5px 10px; border-radius:3px; cursor:pointer;">&times;</button>
                </td>
            `;
            tableBody.appendChild(row);
        });

    } catch (e) {
        console.error("Error al generar resumen de recursos:", e);
    }
}

// --- ELIMINAR RECURSO ---
window.deleteResource = async (resId) => {
    if (!confirm("¿Eliminar este recurso? Esto no borrará las actividades, pero perderán su costo asociado.")) return;
    try {
        await deleteDoc(doc(db, "resources", resId));
        alert("Recurso eliminado");
        renderAll(); // Recarga todo para actualizar costos y tablas
    } catch (e) { console.error("Error al eliminar recurso:", e); }
};

// --- EDITAR RECURSO ---
window.editResource = async (resId, currentName, currentRate) => {
    const newName = prompt("Nuevo nombre del recurso:", currentName);
    const newRate = prompt("Nueva tasa horaria (S/.):", currentRate);

    if (newName && newRate) {
        try {
            await updateDoc(doc(db, "resources", resId), {
                name: newName,
                rate: Number(newRate)
            });
            alert("Recurso actualizado");
            renderAll();
        } catch (e) { console.error("Error al editar recurso:", e); }
    }
};

function calculateEndDate(startDateStr, durationDays) {
    if (!startDateStr || !durationDays) return "-";
    const date = new Date(startDateStr + "T00:00:00");
    // Restamos 1 porque si empieza el día 1 y dura 1 día, termina el día 1
    date.setDate(date.getDate() + (Number(durationDays) - 1));
    return date.toISOString().split('T')[0];
}

document.getElementById('btn-export-excel').onclick = async () => {
    try {
        // 1. Obtener datos de Firebase
        const activitiesSnap = await getDocs(collection(db, "activities"));
        const resourcesSnap = await getDocs(collection(db, "resources"));

        // 2. Mapear nombres de recursos para el Excel
        let resMap = {};
        resourcesSnap.forEach(d => { resMap[d.id] = d.data().name; });

        // 3. Preparar datos de Actividades
        const activitiesData = [];
        activitiesSnap.forEach(d => {
            const t = d.data();
            activitiesData.push({
                "Actividad": t.name,
                "Inicio": t.start,
                "Duración (Días)": t.duration,
                "Fin": calculateEndDate(t.start, t.duration),
                "Progreso (%)": t.progress,
                "Recurso Asignado": resMap[t.assignedResource] || "Sin asignar",
                "Horas (HH)": t.estimatedHours || 0
            });
        });

        // 4. Crear el Libro de Excel (Workbook)
        const wb = XLSX.utils.book_new();
        
        // Hoja 1: Cronograma
        const wsActivities = XLSX.utils.json_to_sheet(activitiesData);
        XLSX.utils.book_append_sheet(wb, wsActivities, "Cronograma_Gantt");

        // Hoja 2: Resumen de Recursos (Opcional, usando los datos de la tabla)
        const table = document.getElementById("resource-table-body").parentElement;
        const wsResources = XLSX.utils.table_to_sheet(table);
        XLSX.utils.book_append_sheet(wb, wsResources, "Resumen_Costos");

        // 5. Descargar el archivo
        XLSX.writeFile(wb, "Reporte_ERP_CTTC_2026.xlsx");
        alert("¡Excel generado con éxito!");

    } catch (e) {
        console.error("Error al exportar:", e);
        alert("Error al generar el archivo Excel");
    }
};

// --- INTERACTIVIDAD DE LA INTERFAZ ---

// 1. Ocultar/Mostrar secciones (KPIs y Tabla)
window.toggleSection = (className, btnId) => {
    const element = document.querySelector(`.${className}`);
    const btn = document.getElementById(btnId);
    if (element) {
        const isHidden = element.classList.toggle('hidden');
        if (btn) btn.classList.toggle('active', !isHidden);
    }
};

// 2. Desplazamiento por botones
window.scrollGantt = (pixels) => {
    const wrapper = document.querySelector('.gantt-wrapper');
    wrapper.scrollBy({ left: pixels, behavior: 'smooth' });
};

// 3. Arrastre con el mouse (Drag to Scroll)
const slider = document.querySelector('.gantt-wrapper');
let isDown = false;
let startX;
let scrollLeft;

slider.addEventListener('mousedown', (e) => {
    isDown = true;
    slider.classList.add('active');
    startX = e.pageX - slider.offsetLeft;
    scrollLeft = slider.scrollLeft;
});

slider.addEventListener('mouseleave', () => {
    isDown = false;
});

slider.addEventListener('mouseup', () => {
    isDown = false;
});

slider.addEventListener('mousemove', (e) => {
    if (!isDown) return;
    e.preventDefault();
    const x = e.pageX - slider.offsetLeft;
    const walk = (x - startX) * 2; // Velocidad de desplazamiento
    slider.scrollLeft = scrollLeft - walk;
});


window.toggleSidebar = () => {
    const sidebar = document.getElementById('sidebar-left');
    const btn = document.getElementById('btn-menu');
    const isCollapsed = sidebar.classList.toggle('collapsed');
    if (btn) btn.classList.toggle('active', !isCollapsed);
};

// --- LÓGICA KANBAN ---

// Permitir soltar
window.allowDrop = (ev) => ev.preventDefault();

// Al empezar a arrastrar
window.drag = (ev, id) => {
    ev.dataTransfer.setData("taskId", id);
};

// Al soltar en una columna
window.drop = async (ev, newProgress) => {
    ev.preventDefault();
    const id = ev.dataTransfer.getData("taskId");
    
    try {
        const taskRef = doc(db, "activities", id);
        const snap = await getDocs(collection(db, "activities"));
        const task = snap.docs.find(d => d.id === id).data();
        
        let updates = { progress: newProgress };

        // --- LÓGICA DE IMPACTO EN EL CRONOGRAMA ---
        if (newProgress === 100 && task.progress < 100) {
            // 1. Definir fecha de finalización real (Hoy)
            const today = new Date().toISOString().split('T')[0];
            
            // 2. Calcular la nueva duración real
            const realDuration = getDayDiff(task.start, today) + 1;
            const finalDuration = realDuration > 0 ? realDuration : 1;
            
            // 3. CALCULAR EL DESFASE (Impacto para sucesoras)
            // Es la diferencia entre la duración que tenía y la que realmente tomó
            const durationChange = finalDuration - task.duration;

            updates.duration = finalDuration;
            updates.plannedDuration = task.duration; // Guardamos respaldo para revertir

            // 4. DISPARAR CASCADA: Si terminó antes, durationChange será negativo (adelanta sucesoras)
            // Si terminó después, será positivo (retrasa sucesoras)
            if (durationChange !== 0) {
                await updateDependenciesCascade(id, durationChange);
            }
        } 
        else if (newProgress < 100 && task.progress === 100) {
            // Caso MasterScrum revierte: Restauramos duración original y movemos sucesoras de vuelta
            const restoredDuration = task.plannedDuration || task.duration;
            const reverseOffset = restoredDuration - task.duration;
            
            updates.duration = restoredDuration;
            
            if (reverseOffset !== 0) {
                await updateDependenciesCascade(id, reverseOffset);
            }
        }

        await updateDoc(taskRef, updates);
        renderAll(); // Refrescar Gantt y Kanban sincronizados
    } catch (e) { 
        console.error("Error en sincronización Kanban-Gantt:", e); 
    }
};

// Modificar tu función renderAll para incluir el renderizado de tarjetas
async function renderKanban(activities) {
    const todoCont = document.getElementById('cards-todo');
    const inprogCont = document.getElementById('cards-inprogress');
    const doneCont = document.getElementById('cards-done');
    if (!todoCont) return;

    // 1. Obtener nombres de recursos para el mapeo visual
    const resSnap = await getDocs(collection(db, "resources"));
    let resourceNames = {};
    resSnap.forEach(d => { resourceNames[d.id] = d.data().name; });

    // Limpieza de columnas antes de renderizar
    todoCont.innerHTML = ''; 
    inprogCont.innerHTML = ''; 
    doneCont.innerHTML = '';

    activities.forEach(task => {
        const card = document.createElement('div');
        
        // Aplicar clase de prioridad (Alta, Media, Baja) para el borde de color
        const priorityClass = `card-priority-${(task.priority || 'media').toLowerCase()}`;
        card.className = `kanban-card ${priorityClass}`;
        
        card.draggable = true;
        card.ondragstart = (e) => window.drag(e, task.id);
        card.onclick = () => window.openDetails(task);
        
        const nombreRecurso = resourceNames[task.assignedResource] || "Sin asignar";
        const fechaFin = calculateEndDate(task.start, task.duration);

        // NUEVO: Indicador visual de comentarios (Bitácora)
        const commentIcon = task.comments && task.comments.trim() !== "" 
            ? '<span class="comment-indicator" title="Ver bitácora de avances">💬</span>' 
            : '';

        // Renderizado dinámico de la tarjeta
        card.innerHTML = `
            <span class="sprint-badge">Sprint ${task.sprint || 1}</span>
            <h4>${task.name} ${commentIcon}</h4>
            <div class="card-footer">
                <p>📅 Fin: ${fechaFin}</p>
                <p class="resource-tag">👤 ${nombreRecurso}</p>
            </div>
        `;

        // Clasificación lógica por columnas de estado
        const progress = Number(task.progress) || 0;
        if (progress === 0) {
            todoCont.appendChild(card);
        } else if (progress === 100) {
            doneCont.appendChild(card);
        } else {
            inprogCont.appendChild(card);
        }
    });
}

document.getElementById('excel-upload').addEventListener('change', function(e) {
    const file = e.target.files[0];
    const reader = new FileReader();

    reader.onload = async (event) => {
        const data = new Uint8Array(event.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        
        // Leer la primera hoja
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        
        // Convertir a JSON
        const jsonData = XLSX.utils.sheet_to_json(worksheet);

        if (jsonData.length === 0) return alert("El archivo está vacío");

        try {
            const batchPromises = jsonData.map(row => {
                // Validar datos mínimos
                if (!row.name || !row.start || !row.duration) return null;

                return addDoc(collection(db, "activities"), {
                    name: String(row.name),
                    start: String(row.start), // Debe venir como YYYY-MM-DD
                    duration: Number(row.duration),
                    priority: row.priority || "Media",
                    sprint: Number(row.sprint) || 1,
                    progress: Number(row.progress) || 0,
                    predecessorId: "", // Las dependencias se asignan manualmente luego
                    assignedResource: "" // Los recursos se asignan manualmente luego
                });
            });

            await Promise.all(batchPromises.filter(p => p !== null));
            alert(`¡Éxito! Se han importado ${jsonData.length} actividades.`);
            renderAll(); // Refresca Gantt, Kanban y KPIs
        } catch (error) {
            console.error("Error al importar:", error);
            alert("Hubo un error al subir los datos. Revisa el formato.");
        }
    };

    reader.readAsArrayBuffer(file);
});


// Listener para actualizar el Gantt cuando se cambie la fecha manualmente desde la UI
document.getElementById('gantt-start-date')?.addEventListener('change', () => renderAll());

renderAll();