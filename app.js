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
const CALENDAR_START_DATE = "2025-12-01"; 

document.getElementById('detail-progress').oninput = function() {
    document.getElementById('prog-val').innerText = this.value;
};

function renderGanttTimeline(startDateStr) {
    const header = document.getElementById('gantt-header');
    if (!header) return;
    header.innerHTML = '';
    let current = new Date(startDateStr + "T00:00:00");
    const days = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
    
    for (let i = 0; i < 90; i++) {
        const dayDiv = document.createElement('div');
        dayDiv.className = 'header-day';
        const dayName = days[current.getDay()];
        const dayNum = current.getDate();
        const monthName = current.toLocaleDateString('es-ES', { month: 'short' });

        dayDiv.innerHTML = `
            <span class="month-label">${monthName}</span>
            <span class="day-letter">${dayName}</span>
            <b class="day-number">${dayNum}</b>
        `;
        header.appendChild(dayDiv);
        current.setDate(current.getDate() + 1);
    }
}

async function renderAll() {
    const barsContainer = document.getElementById('gantt-bars-container');
    const predSelectNew = document.getElementById('predecessor-select'); 
    const predSelectDetail = document.getElementById('detail-predecessor'); 
    const kpiProg = document.getElementById('kpi-prog');

    if (!barsContainer) return;

    // 1. LIMPIEZA INICIAL
    barsContainer.innerHTML = '';
    const emptyOpt = '<option value="">Sin predecesor</option>';
    if (predSelectNew) predSelectNew.innerHTML = emptyOpt;
    if (predSelectDetail) predSelectDetail.innerHTML = emptyOpt;

    try {
        renderGanttTimeline(CALENDAR_START_DATE);
        const globalStart = new Date(CALENDAR_START_DATE + "T00:00:00");

        const q = query(collection(db, "activities"), orderBy("start"));
        const snap = await getDocs(q);
        
        let activities = [];
        let totalProg = 0;
        let done = 0, inprog = 0, todo = 0;

        snap.forEach(d => {
            const task = { id: d.id, ...d.data() };
            if (task.start) {
                activities.push(task);
                const p = Number(task.progress) || 0;
                totalProg += p;
                if (p >= 100) done++; 
                else if (p > 0) inprog++; 
                else todo++;
                
                // POBLAR SELECTORES (Correctamente dentro del bucle)
                const optHtml = `<option value="${task.id}">${task.name}</option>`;
                if (predSelectNew) predSelectNew.innerHTML += optHtml;
                if (predSelectDetail) predSelectDetail.innerHTML += optHtml;
            }
        });

        activities.forEach((task, i) => {
            const taskStart = new Date(task.start + "T00:00:00");
            const diffDays = Math.floor((taskStart - globalStart) / (1000 * 60 * 60 * 24));
            const dateEnd = calculateEndDate(task.start, task.duration);
            
            const bar = document.createElement('div');
            bar.className = 'gantt-bar';
            bar.style.left = `${diffDays * 40}px`; 
            bar.style.width = `${(Number(task.duration) || 1) * 40}px`;
            bar.style.top = `${i * 45 + 10}px`; 
            bar.innerText = `${task.name} [${task.start} al ${dateEnd}] (${task.progress || 0}%)`;
            bar.onclick = () => window.openDetails(task);
            barsContainer.appendChild(bar);
        });

        if (activities.length > 0) {
            const avgProg = (totalProg / activities.length).toFixed(1);
            if (kpiProg) kpiProg.innerText = `${avgProg}%`;
        }
        renderStatusChart(todo, inprog, done);
        await loadResources(); 
        await updateProjectCost();
    } catch (e) { console.error("Error crítico en renderAll:", e); }
    await renderResourceSummary();

}

window.openDetails = (task) => {
    currentTaskId = task.id;
    
    // Cargar el nombre en el nuevo input
    document.getElementById('detail-name').value = task.name || "";
    
    // (Resto de los campos que ya tenías...)
    document.getElementById('detail-title').innerText = task.name;
    document.getElementById('detail-start').value = task.start || "";
    document.getElementById('detail-duration').value = task.duration || 1;
    document.getElementById('prog-val').innerText = task.progress || 0;
    document.getElementById('detail-progress').value = task.progress || 0;

    document.getElementById('detail-start').value = task.start || "";
    document.getElementById('detail-duration').value = task.duration || 1;

    const dateEnd = calculateEndDate(task.start, task.duration);
    document.getElementById('detail-end').value = dateEnd;
    
    const detailPredSelect = document.getElementById('detail-predecessor');
    if (detailPredSelect) {
        detailPredSelect.value = task.predecessorId || "";
    }

    document.getElementById('res-select').value = task.assignedResource || "";
    document.getElementById('res-hours').value = task.estimatedHours || 0;
    document.getElementById('details-panel').classList.add('active');
};

document.getElementById('btn-update-task').onclick = async () => {
    if (!currentTaskId) return;

    // Capturar el nuevo nombre
    const newName = document.getElementById('detail-name').value;
    const newStart = document.getElementById('detail-start').value;
    const newDuration = Number(document.getElementById('detail-duration').value);
    const newPredecessor = document.getElementById('detail-predecessor').value;

    try {
        const taskRef = doc(db, "activities", currentTaskId);
        const snap = await getDocs(collection(db, "activities"));
        const oldTask = snap.docs.find(d => d.id === currentTaskId).data();
        const dayOffset = getDayDiff(oldTask.start, newStart);

        await updateDoc(taskRef, {
            name: newName, // ACTUALIZACIÓN DEL NOMBRE
            start: newStart,
            duration: newDuration,
            progress: Number(document.getElementById('detail-progress').value),
            assignedResource: document.getElementById('res-select').value,
            estimatedHours: Number(document.getElementById('res-hours').value),
            predecessorId: newPredecessor
        });

        if (dayOffset !== 0) {
            await updateDependenciesCascade(currentTaskId, dayOffset);
        }
        
        alert("¡Datos actualizados correctamente!");
        window.togglePanel(false);
        renderAll(); // Esto refrescará el texto en la barra del Gantt
    } catch (e) { 
        console.error("Error al actualizar nombre:", e); 
    }
};


document.getElementById('btn-save-task').onclick = async () => {
    const name = document.getElementById('task-name').value;
    const start = document.getElementById('task-start').value;
    const duration = document.getElementById('task-duration').value;
    const predecessorId = document.getElementById('predecessor-select').value;

    if(!name || !start || !duration) return alert("Faltan datos");
    try {
        await addDoc(collection(db, "activities"), { 
            name, start, duration: Number(duration), progress: 0, predecessorId: predecessorId || ""
        });
        document.getElementById('task-name').value = ""; // Limpiar campo
        renderAll();
    } catch (e) { alert("Error al guardar"); }
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
    let totalCost = 0;
    snap.forEach(d => {
        const task = d.data();
        if (task.assignedResource && task.estimatedHours) {
            totalCost += (task.estimatedHours * (rates[task.assignedResource] || 0));
        }
    });
    const kpiCost = document.getElementById('kpi-cost');
    if (kpiCost) kpiCost.innerText = totalCost.toLocaleString('es-PE', { minimumFractionDigits: 2 });
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
    const q = query(collection(db, "activities"), where("predecessorId", "==", parentTaskId));
    const snap = await getDocs(q);
    const updates = snap.docs.map(async (d) => {
        const childData = d.data();
        const newChildStart = addDays(childData.start, dayOffset);
        await updateDoc(doc(db, "activities", d.id), { start: newChildStart });
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
window.toggleSection = (className) => {
    const element = document.querySelector(`.${className}`);
    if (element) element.classList.toggle('hidden');
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
    sidebar.classList.toggle('collapsed');
};


renderAll();