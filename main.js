import { initAuth, saveToCloud } from "./auth-manager.js";
import * as identityService from "./identity-service.js";

let state = {
    canvasX: 0, canvasY: 0, scale: 1,
    isPanning: false, startX: 0, startY: 0, basePanX: 0, basePanY: 0,
    activeTool: 'pan', selectedItemIds: [], items: [], activeRow: null,
    colWidth: 250, rowHeight: 200, monthGap: 150,
    calendarStartX: 45000, calendarStartY: 45000,
    originYear: 0, originMonth: 0, originDate: null,
    activeDayOffset: 0,
    lastTapTime: 0,
    isAtomicMode: false,
    linkingSourceId: null
};

let mdoDraggingContext = null;
let mdoResizingContext = null;
let lastMdoInteractionMoved = false;
let mdoHoldTimer = null;
let mdoHoldStartY = 0;

let pinchContext = null;

function getCoords(e) {
    if (e.touches && e.touches.length > 0) {
        return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
    return { x: e.clientX, y: e.clientY };
}

function getPinchDist(e) {
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
}

function getPinchMid(e) {
    return {
        x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
        y: (e.touches[0].clientY + e.touches[1].clientY) / 2
    };
}

const isMobileMode = () => window.innerWidth <= 768;
const isPortrait = () => window.innerHeight > window.innerWidth;

let settings = {
    dayStartHour: 8,
    dayEndHour: 18,
    snapMinutes: 30,
    timeFormat: '12h',
    defaultEventDurationHours: 2,
    defaultEventDurationDays: 3
};

function initTimeOrigin() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    state.originDate = today;
    state.originYear = today.getFullYear();
    state.originMonth = today.getMonth();
}
initTimeOrigin();

const colors = ['pink', 'orange', 'green', 'blue', 'purple'];
const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const viewport = document.getElementById('viewport');
const canvas = document.getElementById('canvas');
const gridContainer = document.getElementById('calendar-grid');
const itemsContainer = document.getElementById('items-container');
const zoomLevelEl = document.getElementById('zoom-level');

const tools = { pan: document.getElementById('tool-pan'), select: document.getElementById('tool-select'), add: document.getElementById('tool-add') };
function generateId() { return Math.random().toString(36).substring(2, 9); }

function formatTime(hFloat) {
    let h = Math.floor(hFloat);
    let m = Math.round((hFloat - h) * 60);
    if (m >= 60) { h += 1; m -= 60; }
    let mStr = m.toString().padStart(2, '0');
    if (settings.timeFormat === '24h') {
        return `${h.toString().padStart(2, '0')}:${mStr}`;
    } else {
        let ampm = h >= 12 ? 'PM' : 'AM';
        let h12 = h % 12;
        if (h12 === 0) h12 = 12;
        return `${h12}:${mStr} ${ampm}`;
    }
}

function decimalToTimeInput(hFloat) {
    let h = Math.floor(hFloat);
    let m = Math.round((hFloat - h) * 60);
    if (m >= 60) { h += 1; m -= 60; }
    let hStr = Math.max(0, h % 24).toString().padStart(2, '0');
    let mStr = m.toString().padStart(2, '0');
    return `${hStr}:${mStr}`;
}

function init() {
    if (isMobileMode()) {
        state.scale = isPortrait() ? 0.45 : 0.6;
    }
    state.canvasX = window.innerWidth / 2 - (state.calendarStartX + (state.colWidth * 3.5)) * state.scale;
    const vph = viewport.clientHeight || window.innerHeight;
    state.canvasY = vph / 4 - state.calendarStartY * state.scale;

    document.getElementById('doc-2').style.display = 'none';
    document.getElementById('v-resizer').style.display = 'none';
    document.getElementById('btn-close-doc-1').style.display = 'none';
    document.getElementById('h-resizer').style.display = 'none';

    applySettings();
    updateTransform();
    setupDummyData();
    renderItems();
    syncDocWindows();

    setupAuth();
    setupIdentityUI();
    
    const resizeObserver = new ResizeObserver(() => {
        if (state.canvasX !== undefined) {
            renderGrid();
            renderItems();
        }
    });
    resizeObserver.observe(viewport);
}

function applySettings() {
    const totalDayHours = settings.dayEndHour - settings.dayStartHour;
    const segments = totalDayHours * (60 / settings.snapMinutes);
    document.documentElement.style.setProperty('--day-segments', segments);

    document.getElementById('set-def-hours').step = (settings.snapMinutes / 60).toString();

    renderGrid();
    renderItems();
}

viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey || true) {
        const zoomIntensity = 0.05;
        const zoomFactor = Math.exp((e.deltaY < 0 ? 1 : -1) * zoomIntensity);
        zoomAt(e.clientX - viewport.getBoundingClientRect().left, e.clientY - viewport.getBoundingClientRect().top, zoomFactor);
    }
}, { passive: false });

function zoomAt(mouseX, mouseY, zoomFactor) {
    const minScale = 0.1; const maxScale = 5;
    let newScale = state.scale * zoomFactor;
    if (newScale < minScale) newScale = minScale;
    if (newScale > maxScale) newScale = maxScale;

    state.canvasX = mouseX - (mouseX - state.canvasX) * (newScale / state.scale);
    state.canvasY = mouseY - (mouseY - state.canvasY) * (newScale / state.scale);
    state.scale = newScale;
    updateTransform();
}

let currentViewLevel = 'week';
function updateTransform(skipSnap = false) {
    canvas.style.transform = `translate(${state.canvasX}px, ${state.canvasY}px) scale(${state.scale})`;
    zoomLevelEl.textContent = `${Math.round(state.scale * 100)}%`;

    let newLevel = 'month';
    const daySnapThreshold = 1.4;
    const weekSnapThreshold = 0.6;

    if (state.scale >= daySnapThreshold) {
        document.body.className = 'zoom-day'; newLevel = 'day';
        const centerLocalY = (window.innerHeight / 2 - state.canvasY) / state.scale;
        state.activeRow = Math.floor((centerLocalY - state.calendarStartY - 70) / state.rowHeight);
        // On mobile, auto-open the native day view overlay when zoomed in enough
        if (!skipSnap && isMobileMode()) {
             const centerY = (window.innerHeight / 2 - state.canvasY) / state.scale;
             const centerX = (window.innerWidth / 2 - state.canvasX) / state.scale;
             const dOff = getDayOffsetFromCoords(centerX, centerY);
             enterMobileDayView(dOff);
             return; // Don't continue — the overlay takes over
        }
        const idealDayScale = viewport.clientHeight / state.rowHeight;
        if (!skipSnap && !isMobileMode() && Math.abs(state.scale - idealDayScale) < 0.2) {
             state.scale = idealDayScale;
             canvas.style.transform = `translate(${state.canvasX}px, ${state.canvasY}px) scale(${state.scale})`;
        }
    } else if (state.scale >= 0.5) {
        document.body.className = 'zoom-week'; newLevel = 'week'; state.activeRow = null;
    } else {
        document.body.className = 'zoom-month'; newLevel = 'month'; state.activeRow = null;
    }

    if (newLevel !== currentViewLevel) {
        currentViewLevel = newLevel;
        syncDocWindows();
    }

    renderGrid();
    renderItems();
}

function enterMobileDayView(dayOffset) {
    state.activeDayOffset = dayOffset;
    const overlay = document.getElementById('mobile-day-overlay');
    overlay.classList.remove('mdo-closing');
    overlay.style.display = 'flex';

    // Hide normal UI
    document.getElementById('app-wrapper').style.display = 'none';

    renderMobileDayOverlay();
}

function closeMobileDayView(openItemId) {
    const overlay = document.getElementById('mobile-day-overlay');
    overlay.classList.add('mdo-closing');

    // Smoothly wait for the CSS animation to finish before hiding
    setTimeout(() => {
        overlay.style.display = 'none';
        document.getElementById('app-wrapper').style.display = '';
        currentViewLevel = 'week';

        // Sync the main calendar to match the day we were just looking at
        const dDate = new Date(state.originDate);
        dDate.setDate(state.originDate.getDate() + state.activeDayOffset);
        const dayCoords = getDateCoords(dDate);
        state.scale = 0.5; // Back to week scale
        state.canvasX = (window.innerWidth / 2) - (dayCoords.x + state.colWidth / 2) * state.scale;
        state.canvasY = -dayCoords.y * state.scale + 60;
        updateTransform(true);

        // If an item was tapped, select it and open docs pane now that app-wrapper is visible
        if (openItemId) {
            lastPaneHeight = '85vh';
            selectItem(openItemId);
        }
    }, 300);
}

function renderMobileDayOverlay() {
    const dayOffset = state.activeDayOffset;
    const dDate = new Date(state.originDate);
    dDate.setDate(state.originDate.getDate() + dayOffset);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Update header title
    const title = document.getElementById('mdo-date-title');
    title.textContent = dDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

    // Render day strip (7-day window centered on current day)
    const strip = document.getElementById('mdo-day-strip');
    strip.innerHTML = '';
    for (let i = -3; i <= 3; i++) {
        const chipDate = new Date(state.originDate);
        chipDate.setDate(state.originDate.getDate() + dayOffset + i);
        const chip = document.createElement('div');
        chip.className = 'mdo-day-chip';
        if (i === 0) chip.classList.add('active');
        if (chipDate.toDateString() === today.toDateString()) chip.classList.add('today');

        chip.innerHTML = `<span class="mdo-chip-day">${chipDate.toLocaleDateString('en-US', { weekday: 'short' })}</span>
                          <span class="mdo-chip-num">${chipDate.getDate()}</span>`;
        chip.addEventListener('click', () => {
            enterMobileDayView(dayOffset + i);
        });
        strip.appendChild(chip);
    }

    // Render hourly schedule
    const schedule = document.getElementById('mdo-schedule');
    const hourRowHeight = 60; // px per hour
    const totalHours = settings.dayEndHour - settings.dayStartHour;

    let html = '<div class="mdo-schedule-inner" style="position:relative;">';

    // Hour rows
    for (let h = settings.dayStartHour; h <= settings.dayEndHour; h++) {
        html += `<div class="mdo-hour-row" style="height:${hourRowHeight}px;">
                    <div class="mdo-hour-label">${formatTime(h)}</div>
                    <div class="mdo-hour-content"></div>
                 </div>`;
    }

    // Event blocks (positioned absolutely over the hour grid)
    // Events need to be positioned relative to the schedule-inner
    const eventsHTML = [];
    state.items.forEach(item => {
        const occurrences = getOccurrences(item, dayOffset, dayOffset);
        occurrences.forEach(occ => {
            for (let d = 0; d < occ.duration; d++) {
                const off = occ.dayOffset + d;
                if (off !== dayOffset) continue;

                let tBlock = item.dailyTimes && item.dailyTimes[off];
                if (!tBlock && item.repeat && item.repeat !== 'none') {
                    tBlock = item.dailyTimes && item.dailyTimes[item.startDayOffset];
                }
                if (!tBlock) {
                    let slotH = (parseInt(item.id, 36) % 3) * settings.defaultEventDurationHours;
                    if (settings.dayStartHour + slotH + settings.defaultEventDurationHours > settings.dayEndHour) slotH = 0;
                    tBlock = { startHour: settings.dayStartHour + slotH, durationH: settings.defaultEventDurationHours };
                }

                const topPx = (tBlock.startHour - settings.dayStartHour) * hourRowHeight;
                const heightPx = tBlock.durationH * hourRowHeight;
                const sTime = formatTime(tBlock.startHour);
                const eTime = formatTime(tBlock.startHour + tBlock.durationH);

                const isSelected = state.selectedItemIds.includes(item.id);
                eventsHTML.push(`<div class="mdo-event color-${item.color} ${isSelected ? 'selected' : ''}"
                    style="top:${topPx}px; height:${heightPx}px; left: 62px; right: 8px;"
                    data-id="${item.id}" data-dayoff="${off}">
                    <div class="resize-handle top"></div>
                    <div class="mdo-event-title">${item.title}${item.repeat !== 'none' ? ' 🔄' : ''}</div>
                    <div class="mdo-event-time">${sTime} – ${eTime}</div>
                    <div class="resize-handle bottom"></div>
                </div>`);
            }
        });
    });

    html += eventsHTML.join('');
    html += '</div>';
    schedule.innerHTML = html;

    // Add touch and click handlers for events
    schedule.querySelectorAll('.mdo-event').forEach(el => {
        const itemId = el.dataset.id;
        const dayOff = parseInt(el.dataset.dayoff);
        const item = state.items.find(i => i.id === itemId);

        const onStart = (e) => {
            const coords = getCoords(e);
            const handle = e.target.closest('.resize-handle');
            lastMdoInteractionMoved = false;

            if (handle) {
                // Determine current duration and start hour (handling recurrence templates)
                let currentStart = item.dailyTimes?.[dayOff]?.startHour;
                let currentDur = item.dailyTimes?.[dayOff]?.durationH;

                if (currentStart === undefined) {
                    const template = item.dailyTimes?.[item.startDayOffset] || {};
                    currentStart = template.startHour ?? (settings.dayStartHour + (parseInt(item.id, 36) % 3) * settings.defaultEventDurationHours);
                    currentDur = template.durationH ?? settings.defaultEventDurationHours;
                }

                mdoResizingContext = {
                    item, edge: handle.classList.contains('top') ? 'top' : 'bottom',
                    dayOff, startMouseY: coords.y,
                    initialStartHour: currentStart,
                    initialDurationH: currentDur
                };
                selectItem(item.id);
                renderMobileDayOverlay(); // Visual feedback for selection
                e.stopPropagation();
                if (e.type === 'touchstart') e.preventDefault();
            } else {
                mdoHoldStartY = coords.y;
                mdoHoldTimer = setTimeout(() => {
                    let currentStart = item.dailyTimes?.[dayOff]?.startHour;
                    if (currentStart === undefined) {
                        const template = item.dailyTimes?.[item.startDayOffset] || {};
                        currentStart = template.startHour ?? (settings.dayStartHour + (parseInt(item.id, 36) % 3) * settings.defaultEventDurationHours);
                    }

                    mdoDraggingContext = {
                        item, dayOff, startMouseY: coords.y,
                        initialStartHour: currentStart
                    };
                    selectItem(item.id);
                    renderMobileDayOverlay(); // Visual feedback
                    el.style.opacity = '0.7';
                    el.style.zIndex = '100';
                }, 150);
            }
        };

        el.addEventListener('touchstart', onStart, { passive: false });
        el.addEventListener('mousedown', onStart);

        el.addEventListener('click', () => {
            if (lastMdoInteractionMoved) return;
            openMdoDocPanel(itemId);
        });
    });
}

function openMdoDocPanel(itemId) {
    const item = state.items.find(i => i.id === itemId);
    if (!item) return;

    const panel = document.getElementById('mdo-doc-panel');
    const titleEl = document.getElementById('mdo-doc-title');
    const body = document.getElementById('mdo-doc-body');

    titleEl.textContent = item.title;

    const dayOff = state.activeDayOffset;
    let tBlock = item.dailyTimes?.[dayOff] || item.dailyTimes?.[item.startDayOffset] || {};
    const startStr = tBlock.startHour != null ? decimalToTimeInput(tBlock.startHour) : '';
    const endStr = tBlock.startHour != null ? decimalToTimeInput(tBlock.startHour + (tBlock.durationH || 1)) : '';

    body.innerHTML = `
        <div class="doc-field">
            <label>Title</label>
            <input type="text" id="mdo-field-title" value="${item.title.replace(/"/g, '&quot;')}">
        </div>
        <div class="doc-field">
            <label>Time</label>
            <div style="display:flex;gap:8px;align-items:center;">
                <input type="time" id="mdo-field-start" value="${startStr}" style="flex:1;">
                <span style="color:var(--text-muted)">–</span>
                <input type="time" id="mdo-field-end" value="${endStr}" style="flex:1;">
            </div>
        </div>
        <div class="doc-field">
            <label>Notes</label>
            <textarea id="mdo-field-notes">${item.notes?.day || ''}</textarea>
        </div>
        <div class="doc-field">
            <label>People</label>
            <input type="text" id="mdo-field-people" value="${item.people || ''}">
        </div>
    `;

    // Live save on any field change
    body.querySelectorAll('input, textarea').forEach(el => {
        el.addEventListener('change', () => {
            item.title = document.getElementById('mdo-field-title').value || item.title;
            if (!item.notes) item.notes = {};
            item.notes.day = document.getElementById('mdo-field-notes').value;
            item.people = document.getElementById('mdo-field-people').value;

            const startVal = document.getElementById('mdo-field-start').value;
            const endVal = document.getElementById('mdo-field-end').value;
            if (startVal && endVal) {
                const [sh, sm] = startVal.split(':').map(Number);
                const [eh, em] = endVal.split(':').map(Number);
                const newStart = sh + sm / 60;
                const newDur = Math.max(0.5, (eh + em / 60) - newStart);
                if (!item.dailyTimes) item.dailyTimes = {};
                item.dailyTimes[dayOff] = { startHour: newStart, durationH: newDur };
            }

            titleEl.textContent = item.title;
            saveData();
            renderMobileDayOverlay();
        });
    });

    panel.style.display = 'flex';
    selectItem(itemId);
}

// Wire up the doc panel close button (runs once at init)
document.getElementById('mdo-doc-close').addEventListener('click', () => {
    document.getElementById('mdo-doc-panel').style.display = 'none';
    selectItem(null);
});

// Swipe handling for the mobile day overlay
(function setupMobileDayOverlayGestures() {
    const overlay = document.getElementById('mobile-day-overlay');
    if (!overlay) return;
    let startX = 0, startY = 0, initialDistance = 0;

    const getDist = (touches) => {
        return Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
    };

    overlay.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
        } else if (e.touches.length === 2) {
            initialDistance = getDist(e.touches);
        }
    }, { passive: true });

    overlay.addEventListener('touchend', (e) => {
        if (e.touches.length > 0) return; // Keep going if fingers still down

        // Don't swipe days if we were dragging or resizing an event
        if (mdoDraggingContext || mdoResizingContext || lastMdoInteractionMoved) return;

        const dx = e.changedTouches[0].clientX - startX;
        const dy = e.changedTouches[0].clientY - startY;

        // Horizontal Swipe: Change Day
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
            enterMobileDayView(state.activeDayOffset + (dx > 0 ? -1 : 1));
        }
    }, { passive: true });

    overlay.addEventListener('touchmove', (e) => {
        if (e.touches.length === 2 && initialDistance > 0) {
            const currentDist = getDist(e.touches);
            // Pinch In (Zoom Out): Exit View
            if (currentDist < initialDistance * 0.7) {
                initialDistance = 0; // Reset to avoid double triggers
                closeMobileDayView();
            }
        }
    }, { passive: true });
})();

// Mobile FAB & Speed Dial Logic
(function setupMobileDayFab() {
    const fab = document.getElementById('mdo-fab');
    const menu = document.getElementById('mdo-speed-dial');
    const menuItems = document.querySelectorAll('.mdo-menu-item');

    if (!fab || !menu) return;

    fab.addEventListener('click', (e) => {
        e.stopPropagation();
        fab.classList.toggle('active');
        menu.classList.toggle('active');
    });

    // Close menu when clicking anywhere else
    document.addEventListener('click', (e) => {
        if (!fab.contains(e.target) && !menu.contains(e.target)) {
            fab.classList.remove('active');
            menu.classList.remove('active');
        }
    });

    menuItems.forEach(item => {
        item.addEventListener('click', (e) => {
            const type = item.dataset.type;
            const dayOff = state.activeDayOffset;
            
            // Map types to colors
            const typeToColor = {
                project: 'pink',
                meeting: 'orange',
                task: 'blue',
                milestone: 'purple'
            };

            // Create new item
            const newItem = {
                id: generateId(),
                type: type,
                title: `New ${type.charAt(0).toUpperCase() + type.slice(1)}`,
                color: typeToColor[type] || 'pink',
                startDayOffset: dayOff,
                durationDays: 1,
                notes: { day: "", week: "", month: "" },
                dailyTimes: {},
                people: "",
                goals: "",
                repeat: "none"
            };

            // Default time slot (e.g. 10 AM or first available)
            const startHour = 10; 
            newItem.dailyTimes[dayOff] = { 
                startHour: startHour, 
                durationH: settings.defaultEventDurationHours 
            };

            state.items.push(newItem);
            renderMobileDayOverlay();
            saveData();

            // Reset FAB
            fab.classList.remove('active');
            menu.classList.remove('active');
        });
    });
})();

// Wire up overlay buttons
document.getElementById('mdo-back').addEventListener('click', closeMobileDayView);
document.getElementById('mdo-today').addEventListener('click', () => enterMobileDayView(0));

function snapToNearestDay() {
    if (currentViewLevel !== 'day') return;
    
    const centerX = (window.innerWidth / 2 - state.canvasX) / state.scale;
    const centerY = (window.innerHeight / 2 - state.canvasY) / state.scale;
    
    const monthAdvance = 7 * state.colWidth + state.monthGap;
    const mDiff = Math.floor((centerX - state.calendarStartX) / monthAdvance);
    const mStartX = state.calendarStartX + mDiff * monthAdvance;
    
    const col = Math.max(0, Math.min(6, Math.floor((centerX - mStartX) / state.colWidth)));
    const row = Math.max(0, Math.min(5, Math.floor((centerY - (state.calendarStartY + 70)) / state.rowHeight)));
    
    const targetWorldX = mStartX + col * state.colWidth + state.colWidth / 2;
    state.canvasX = window.innerWidth / 2 - targetWorldX * state.scale;
    
    const targetWorldY = state.calendarStartY + 70 + row * state.rowHeight + state.rowHeight / 2;
    state.canvasY = window.innerHeight / 2 - targetWorldY * state.scale;
    
    updateTransform(true);
}

function toggleView() {
    if (currentViewLevel === 'day') {
        if (isMobileMode()) {
            closeMobileDayView();
        } else {
            exitDayView();
        }
    } else {
        const localX = (window.innerWidth / 2 - state.canvasX) / state.scale;
        const localY = (window.innerHeight / 2 - state.canvasY) / state.scale;
        const dOff = getDayOffsetFromCoords(localX, localY);
        if (isMobileMode()) {
            enterMobileDayView(dOff);
        } else {
            const dayScale = viewport.clientHeight / state.rowHeight;
            zoomAt(window.innerWidth / 2, window.innerHeight / 2, dayScale / state.scale);
            snapToNearestDay();
        }
    }
}

function renderGrid() {
    gridContainer.innerHTML = '';
    
    /* 2D Frustum Culling: Only render what's in the current viewport + buffer */
    const buffer = 100 / state.scale;
    const localLeft = (0 - state.canvasX) / state.scale - buffer;
    const localRight = (viewport.clientWidth - state.canvasX) / state.scale + buffer;
    const localTop = (0 - state.canvasY) / state.scale - buffer;
    const localBottom = (viewport.clientHeight - state.canvasY) / state.scale + buffer;

    const monthAdvance = 7 * state.colWidth + state.monthGap;
    const startMonthDiff = Math.floor((localLeft - state.calendarStartX) / monthAdvance);
    const endMonthDiff = Math.ceil((localRight - state.calendarStartX) / monthAdvance);

    for (let md = startMonthDiff; md <= endMonthDiff; md++) {
        drawMonthGrid(md, localTop, localBottom);
    }
}

function drawMonthGrid(md, localTop, localBottom) {
    let m = state.originMonth + md; let y = state.originYear + Math.floor(m / 12); m = ((m % 12) + 12) % 12;

    const monthBlockWidth = 7 * state.colWidth;
    const startX = state.calendarStartX + md * (monthBlockWidth + state.monthGap);
    const startY = state.calendarStartY;

    const title = document.createElement('div'); title.className = 'month-title';
    title.textContent = new Date(y, m, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    title.style.left = `${startX}px`; title.style.top = `${startY}px`; title.style.width = `${monthBlockWidth}px`;
    
    /* Only draw title if visible */
    if (startY + 40 >= localTop && startY <= localBottom) {
        gridContainer.appendChild(title);
    }

    for (let i = 0; i < 7; i++) {
        const h = document.createElement('div'); h.className = 'header-day'; h.textContent = dayNames[i];
        const hX = startX + i * state.colWidth;
        const hY = startY + 40;
        h.style.left = `${hX}px`; h.style.top = `${hY}px`; h.style.width = `${state.colWidth}px`;
        
        /* Only draw header if visible */
        if (hY + 30 >= localTop && hY <= localBottom) {
            gridContainer.appendChild(h);
        }
    }

    const daysInMonth = new Date(y, m + 1, 0).getDate(); const firstDay = new Date(y, m, 1).getDay();
    const today = new Date(); const isThisMonth = (today.getFullYear() === y && today.getMonth() === m);

    /* Draw full 7x6 grid for the month but ONLY the visible rows */
    const totalCells = 42; 
    for (let i = 0; i < totalCells; i++) {
        const d = i - firstDay + 1;
        const col = i % 7; const row = Math.floor(i / 7);

        if (state.activeRow !== null && row !== state.activeRow) continue;

        const cellTop = startY + 70 + row * state.rowHeight;
        const cellBottom = cellTop + state.rowHeight;

        /* VERTICAL CULLING: Skip cells that are not in the vertical viewport */
        if (cellBottom < localTop || cellTop > localBottom) continue;

        const cell = document.createElement('div'); cell.className = 'grid-cell';
        cell.style.left = `${startX + col * state.colWidth}px`; cell.style.top = `${cellTop}px`;
        cell.style.width = `${state.colWidth}px`; cell.style.height = `${state.rowHeight}px`;

        if (d >= 1 && d <= daysInMonth) {
            const dateLabel = document.createElement('div'); dateLabel.className = 'grid-cell-date'; dateLabel.textContent = d;
            if (isThisMonth && today.getDate() === d) {
                dateLabel.style.background = 'var(--accent-primary)'; dateLabel.style.color = 'white';
                dateLabel.style.padding = '2px 6px'; dateLabel.style.borderRadius = '12px';
            }
            cell.appendChild(dateLabel);

            for (let h = settings.dayStartHour; h < settings.dayEndHour; h++) {
                const hLabel = document.createElement('div');
                hLabel.className = 'cell-hour-label';
                hLabel.textContent = formatTime(h);
                const topPx = ((h - settings.dayStartHour) / (settings.dayEndHour - settings.dayStartHour)) * state.rowHeight;
                hLabel.style.top = `${topPx}px`;
                cell.appendChild(hLabel);
            }
        } else {
            cell.classList.add('empty');
        }

        gridContainer.appendChild(cell);
    }
}

function getDateCoords(date) {
    const y = date.getFullYear(), m = date.getMonth(), d = date.getDate();
    const monthDiff = (y - state.originYear) * 12 + (m - state.originMonth);
    const monthBlockWidth = 7 * state.colWidth;
    const startX = state.calendarStartX + monthDiff * (monthBlockWidth + state.monthGap);
    const firstDay = new Date(y, m, 1).getDay(); const indexInMonth = firstDay + (d - 1);

    const col = indexInMonth % 7; const row = Math.floor(indexInMonth / 7);
    const x = startX + col * state.colWidth;
    const yCoord = state.calendarStartY + 70 + row * state.rowHeight;
    return { x, y: yCoord, col, row };
}

function getDayOffsetFromCoords(localX, localY) {
    const monthAdvance = 7 * state.colWidth + state.monthGap;
    const monthDiff = Math.floor((localX - state.calendarStartX) / monthAdvance);
    const monthStartX = state.calendarStartX + monthDiff * monthAdvance;

    let c = Math.floor((localX - monthStartX) / state.colWidth);
    let r = Math.floor((localY - (state.calendarStartY + 70)) / state.rowHeight);

    let m = state.originMonth + monthDiff; let year = state.originYear + Math.floor(m / 12); m = ((m % 12) + 12) % 12;
    const firstDay = new Date(year, m, 1).getDay(); const targetDate = (r * 7 + c) - firstDay + 1;

    const clickedDate = new Date(year, m, targetDate); clickedDate.setHours(0, 0, 0, 0);
    return Math.round((clickedDate - state.originDate) / (1000 * 60 * 60 * 24));
}

let draggingBlock = null;
let creatingBlockContext = null;
let resizingBlockContext = null;
let resizingDailyContext = null;
let movingBlockContext = null;

function handleStart(e) {
    // Double Tap Detection for Mobile Day View entry
    if (e.type === 'touchstart' && e.touches.length === 1) {
        const now = Date.now();
        if (now - state.lastTapTime < 300) {
            // Double Tap detected
            const coords = getCoords(e);
            const localX = (coords.x - viewport.getBoundingClientRect().left - state.canvasX) / state.scale;
            const localY = (coords.y - viewport.getBoundingClientRect().top - state.canvasY) / state.scale;
            const dOff = getDayOffsetFromCoords(localX, localY);
            if (isMobileMode()) {
                enterMobileDayView(dOff);
                state.lastTapTime = 0; // Reset
                return;
            }
        }
        state.lastTapTime = now;
    }

    if (e.touches && e.touches.length === 2) {
        state.isPanning = false;
        pinchContext = {
            startDist: getPinchDist(e),
            startScale: state.scale
        };
        e.preventDefault();
        return;
    }

    const coords = getCoords(e);
    const resizeHandle = e.target.closest('.resize-handle');
    if (resizeHandle && (state.activeTool === 'select' || state.activeTool === 'pan')) {
        const itemEl = resizeHandle.closest('.canvas-item, .mdo-event');
        const id = itemEl.dataset.id;
        let edge = 'right';
        if (resizeHandle.classList.contains('left')) edge = 'left';
        else if (resizeHandle.classList.contains('top')) edge = 'top';
        else if (resizeHandle.classList.contains('bottom')) edge = 'bottom';
        const item = state.items.find(i => i.id === id);
        if (state.activeTool === 'select') selectItem(id);

        if (edge === 'left' || edge === 'right') {
            resizingBlockContext = {
                item: item, edge: edge,
                startXLocal: (coords.x - viewport.getBoundingClientRect().left - state.canvasX) / state.scale,
                initialDuration: item.durationDays,
                initialStartDayOffset: item.startDayOffset
            };
        } else {
            const handleDayOff = parseInt(itemEl.dataset.dayoff);
            if (!item.dailyTimes) item.dailyTimes = {};
            if (!item.dailyTimes[handleDayOff]) {
                let slotOffsetHour = (parseInt(item.id, 36) % 3) * settings.defaultEventDurationHours;
                if (settings.dayStartHour + slotOffsetHour + settings.defaultEventDurationHours > settings.dayEndHour) slotOffsetHour = 0;
                item.dailyTimes[handleDayOff] = { startHour: settings.dayStartHour + slotOffsetHour, durationH: settings.defaultEventDurationHours };
            }

            resizingDailyContext = {
                item: item, edge: edge, dayOff: handleDayOff,
                startMouseY: coords.y,
                initialStartHour: item.dailyTimes[handleDayOff].startHour,
                initialDurationH: item.dailyTimes[handleDayOff].durationH
            };
        }
        if (e.type === 'touchstart') e.preventDefault();
        return;
    }

    const isItem = e.target.closest('.canvas-item');
    const isDayBlock = isItem && isItem.classList.contains('daily-block');

    if (state.activeTool === 'add') {
        const localX = (coords.x - viewport.getBoundingClientRect().left - state.canvasX) / state.scale;
        const localY = (coords.y - viewport.getBoundingClientRect().top - state.canvasY) / state.scale;

        const monthAdvance = 7 * state.colWidth + state.monthGap;
        const monthDiff = Math.floor((localX - state.calendarStartX) / monthAdvance);
        const monthStartX = state.calendarStartX + monthDiff * monthAdvance;

        const c = Math.floor((localX - monthStartX) / state.colWidth);
        const r = Math.floor((localY - (state.calendarStartY + 70)) / state.rowHeight);

        if (c >= 0 && c < 7 && r >= 0 && r < 6) {
            let m = state.originMonth + monthDiff; let year = state.originYear + Math.floor(m / 12); m = ((m % 12) + 12) % 12;
            const firstDay = new Date(year, m, 1).getDay(); const targetDate = (r * 7 + c) - firstDay + 1;
            const daysInMonth = new Date(year, m + 1, 0).getDate();

            if (targetDate >= 1 && targetDate <= daysInMonth) {
                const clickedDate = new Date(year, m, targetDate); clickedDate.setHours(0, 0, 0, 0);
                const diffTime = Math.round((clickedDate - state.originDate) / (1000 * 60 * 60 * 24));

                const typeEl = document.getElementById('new-item-type');
                const selectedType = typeEl ? typeEl.value : 'project';

                const newItem = {
                    id: generateId(), type: selectedType, title: `New ${selectedType.charAt(0).toUpperCase() + selectedType.slice(1)}`,
                    color: colors[Math.floor(Math.random() * colors.length)],
                    startDayOffset: diffTime, durationDays: 1,
                    notes: { day: "", week: "", month: "" }, dailyTimes: {}, people: "", goals: "", repeat: "none"
                };

                const snapHours = settings.snapMinutes / 60;

                if (state.scale >= 1.5) {
                    const cellTopPlane = state.calendarStartY + 70 + r * state.rowHeight;
                    const yInsideCell = localY - cellTopPlane;
                    const totalDayHours = settings.dayEndHour - settings.dayStartHour;

                    let startH = settings.dayStartHour + (yInsideCell / state.rowHeight) * totalDayHours;
                    startH = Math.floor(startH / snapHours) * snapHours;
                    if (startH < settings.dayStartHour) startH = settings.dayStartHour;

                    newItem.dailyTimes[diffTime] = { startHour: startH, durationH: snapHours };

                    creatingBlockContext = {
                        item: newItem, mode: 'day',
                        startMouseYLocal: localY,
                        startDuration: snapHours
                    };
                } else {
                    creatingBlockContext = {
                        item: newItem, mode: 'week',
                        startXLocal: localX
                    };
                }

                state.items.push(newItem);
                selectItem(newItem.id);
                renderItems();
            }
        }
        if (e.type === 'touchstart') e.preventDefault();
        return;
    }

    if ((state.activeTool === 'pan' && !isItem && !resizeHandle) || (e.button === 1) || (!isItem && state.activeTool === 'select')) {
        if (!isItem && state.activeTool === 'select') selectItem(null);
        state.isPanning = true; state.startX = coords.x; state.startY = coords.y;
        state.basePanX = state.canvasX; state.basePanY = state.canvasY;
        viewport.style.cursor = 'grabbing';
        if (e.type === 'touchstart') e.preventDefault();
    }
    else if ((state.activeTool === 'select' || state.activeTool === 'pan') && isItem) {
        if (state.activeTool === 'select') selectItem(isItem.dataset.id);
        const item = state.items.find(i => i.id === isItem.dataset.id);
        const localX = (coords.x - viewport.getBoundingClientRect().left - state.canvasX) / state.scale;
        const localY = (coords.y - viewport.getBoundingClientRect().top - state.canvasY) / state.scale;

        if (state.scale >= 1.5 && isDayBlock) {
            let dDate = new Date(state.originDate);
            dDate.setDate(state.originDate.getDate() + parseInt(isItem.dataset.dayoff));
            const baseCoords = getDateCoords(dDate);

            draggingBlock = {
                itemId: isItem.dataset.id,
                originalClickedDayOff: parseInt(isItem.dataset.dayoff),
                initialStartDayOffset: item.startDayOffset,
                initialMouseDayOffset: getDayOffsetFromCoords(localX, localY),
                startMouseY: coords.y,
                initialTopPx: parseFloat(isItem.style.top) - baseCoords.y
            };
        } else if (state.scale < 1.5) {
            movingBlockContext = {
                item: item,
                initialStartDayOffset: item.startDayOffset,
                initialMouseDayOffset: getDayOffsetFromCoords(localX, localY)
            };
        }
        if (e.type === 'touchstart') e.preventDefault();
    }
}

viewport.addEventListener('mousedown', handleStart);
viewport.addEventListener('touchstart', handleStart, { passive: false });

function exitDayView() {
    const targetScale = isMobileMode() ? 0.45 : 0.6;
    zoomAt(window.innerWidth / 2, window.innerHeight / 2, targetScale / state.scale);
}

function handleMove(e) {
    if (e.touches && e.touches.length === 2 && pinchContext) {
        const currentDist = getPinchDist(e);
        const mid = getPinchMid(e);
        const zoomFactor = currentDist / pinchContext.startDist;
        const targetScale = pinchContext.startScale * zoomFactor;
        const incrementalFactor = targetScale / state.scale;

        zoomAt(mid.x - viewport.getBoundingClientRect().left, mid.y - viewport.getBoundingClientRect().top, incrementalFactor);
        e.preventDefault();
        return;
    }

    const coords = getCoords(e);
    if (state.isPanning) {
        if (currentViewLevel === 'day' && isMobileMode()) {
            const dy = coords.y - state.startY;
            // Detect vertical swipe UP to exit Day View
            if (dy < -100) { 
                exitDayView();
                state.isPanning = false;
                return;
            }
            // Lock vertical movement in Day View: allow only horizontal day swiping
            state.canvasX = state.basePanX + (coords.x - state.startX);
        } else {
            state.canvasX = state.basePanX + (coords.x - state.startX);
            state.canvasY = state.basePanY + (coords.y - state.startY);
        }
        updateTransform();
        if (e.type === 'touchmove') e.preventDefault();
    } else if (draggingBlock) {
        const item = state.items.find(i => i.id === draggingBlock.itemId);
        const localX = (coords.x - viewport.getBoundingClientRect().left - state.canvasX) / state.scale;
        const localY = (coords.y - viewport.getBoundingClientRect().top - state.canvasY) / state.scale;
        const currentMouseDayOffset = getDayOffsetFromCoords(localX, localY);
        const daysDelta = currentMouseDayOffset - draggingBlock.initialMouseDayOffset;
        const newStartOffset = draggingBlock.initialStartDayOffset + daysDelta;
        const currentActiveDayOff = draggingBlock.originalClickedDayOff + daysDelta;
        let needsRender = false;

        if (item.startDayOffset !== newStartOffset) {
            const shiftAmount = newStartOffset - item.startDayOffset;
            const newDailyTimes = {};
            if (item.dailyTimes) {
                for (let key in item.dailyTimes) {
                    newDailyTimes[parseInt(key) + shiftAmount] = item.dailyTimes[key];
                }
            }
            item.dailyTimes = newDailyTimes;
            item.startDayOffset = newStartOffset;
            needsRender = true;
        }

        if (!item.dailyTimes) item.dailyTimes = {};
        let existingDur = settings.defaultEventDurationHours;
        if (item.dailyTimes[currentActiveDayOff]) existingDur = item.dailyTimes[currentActiveDayOff].durationH;

        const dy = (coords.y - draggingBlock.startMouseY) / state.scale;
        let newTopRelative = draggingBlock.initialTopPx + dy;
        if (newTopRelative < 0) newTopRelative = 0;
        if (newTopRelative > state.rowHeight - 10) newTopRelative = state.rowHeight - 10;

        const pxPerHour = state.rowHeight / (settings.dayEndHour - settings.dayStartHour);
        const snapHours = settings.snapMinutes / 60;
        const relativeSnappedHour = Math.round((newTopRelative / pxPerHour) / snapHours) * snapHours;
        const targetStartHour = settings.dayStartHour + relativeSnappedHour;

        if (!item.dailyTimes[currentActiveDayOff] || item.dailyTimes[currentActiveDayOff].startHour !== targetStartHour) {
            item.dailyTimes[currentActiveDayOff] = { startHour: targetStartHour, durationH: existingDur };
            needsRender = true;
        }

        if (needsRender) { renderItems(); syncDocWindows(); }
        if (e.type === 'touchmove') e.preventDefault();
    } else if (resizingBlockContext) {
        const localX = (coords.x - viewport.getBoundingClientRect().left - state.canvasX) / state.scale;
        const dx = localX - resizingBlockContext.startXLocal;
        let dxRatio = dx / state.colWidth;
        let shiftDays = Math.sign(dxRatio) * Math.floor(Math.abs(dxRatio) + 0.75);

        if (resizingBlockContext.edge === 'right') {
            let newDays = resizingBlockContext.initialDuration + shiftDays;
            if (newDays < 1) newDays = 1;
            if (resizingBlockContext.item.durationDays !== newDays) {
                resizingBlockContext.item.durationDays = newDays;
                renderItems(); syncDocWindows();
            }
        } else if (resizingBlockContext.edge === 'left') {
            let newStartOffset = resizingBlockContext.initialStartDayOffset + shiftDays;
            let newDays = resizingBlockContext.initialDuration - shiftDays;
            if (newDays < 1) {
                shiftDays = resizingBlockContext.initialDuration - 1;
                newStartOffset = resizingBlockContext.initialStartDayOffset + shiftDays;
                newDays = 1;
            }
            if (resizingBlockContext.item.durationDays !== newDays || resizingBlockContext.item.startDayOffset !== newStartOffset) {
                resizingBlockContext.item.startDayOffset = newStartOffset;
                resizingBlockContext.item.durationDays = newDays;
                renderItems(); syncDocWindows();
            }
        }
        if (e.type === 'touchmove') e.preventDefault();
    } else if (resizingDailyContext) {
        const item = resizingDailyContext.item;
        const dy = (coords.y - resizingDailyContext.startMouseY) / state.scale;
        const pxPerHour = state.rowHeight / (settings.dayEndHour - settings.dayStartHour);
        const snapHours = settings.snapMinutes / 60;
        let hourShift = Math.round((dy / pxPerHour) / snapHours) * snapHours;
        let needsRender = false;

        if (resizingDailyContext.edge === 'bottom') {
            let newDuration = resizingDailyContext.initialDurationH + hourShift;
            if (newDuration < snapHours) newDuration = snapHours;
            if (resizingDailyContext.initialStartHour + newDuration > settings.dayEndHour) newDuration = settings.dayEndHour - resizingDailyContext.initialStartHour;
            if (item.dailyTimes[resizingDailyContext.dayOff].durationH !== newDuration) {
                item.dailyTimes[resizingDailyContext.dayOff].durationH = newDuration;
                needsRender = true;
            }
        } else if (resizingDailyContext.edge === 'top') {
            let newStart = resizingDailyContext.initialStartHour + hourShift;
            let newDuration = resizingDailyContext.initialDurationH - hourShift;
            if (newDuration < snapHours) {
                const diff = snapHours - newDuration;
                newStart -= diff; newDuration = snapHours;
            }
            if (newStart < settings.dayStartHour) {
                const diff = settings.dayStartHour - newStart;
                newStart = settings.dayStartHour; newDuration -= diff;
            }
            if (item.dailyTimes[resizingDailyContext.dayOff].startHour !== newStart || item.dailyTimes[resizingDailyContext.dayOff].durationH !== newDuration) {
                item.dailyTimes[resizingDailyContext.dayOff].startHour = newStart;
                item.dailyTimes[resizingDailyContext.dayOff].durationH = newDuration;
                needsRender = true;
            }
        }
        if (needsRender) { renderItems(); syncDocWindows(); }
        if (e.type === 'touchmove') e.preventDefault();
    } else if (movingBlockContext) {
        const localX = (coords.x - viewport.getBoundingClientRect().left - state.canvasX) / state.scale;
        const localY = (coords.y - viewport.getBoundingClientRect().top - state.canvasY) / state.scale;
        const currentMouseDayOffset = getDayOffsetFromCoords(localX, localY);
        const daysDelta = currentMouseDayOffset - movingBlockContext.initialMouseDayOffset;
        const newStartOffset = movingBlockContext.initialStartDayOffset + daysDelta;

        if (movingBlockContext.item.startDayOffset !== newStartOffset) {
            const shiftAmount = newStartOffset - movingBlockContext.item.startDayOffset;
            const newDailyTimes = {};
            if (movingBlockContext.item.dailyTimes) {
                for (let key in movingBlockContext.item.dailyTimes) {
                    newDailyTimes[parseInt(key) + shiftAmount] = movingBlockContext.item.dailyTimes[key];
                }
            }
            movingBlockContext.item.dailyTimes = newDailyTimes;
            movingBlockContext.item.startDayOffset = newStartOffset;
            renderItems(); syncDocWindows();
        }
        if (e.type === 'touchmove') e.preventDefault();
    } else if (creatingBlockContext) {
        const localX = (coords.x - viewport.getBoundingClientRect().left - state.canvasX) / state.scale;
        const localY = (coords.y - viewport.getBoundingClientRect().top - state.canvasY) / state.scale;

        if (creatingBlockContext.mode === 'day') {
            const dy = localY - creatingBlockContext.startMouseYLocal;
            const pxPerHour = state.rowHeight / (settings.dayEndHour - settings.dayStartHour);
            let duration = creatingBlockContext.startDuration + (dy / pxPerHour);
            const snapHours = settings.snapMinutes / 60;
            duration = Math.ceil(duration / snapHours) * snapHours;
            if (duration < snapHours) duration = snapHours;
            creatingBlockContext.item.dailyTimes[creatingBlockContext.item.startDayOffset].durationH = duration;
            renderItems(); syncDocWindows();
        } else {
            const dx = localX - creatingBlockContext.startXLocal;
            let days = Math.ceil((dx + 10) / state.colWidth);
            if (days < 1) days = 1;
            creatingBlockContext.item.durationDays = days;
            renderItems(); syncDocWindows();
        }
        if (e.type === 'touchmove') e.preventDefault();
    } else if (mdoHoldTimer) {
        const dy = Math.abs(coords.y - mdoHoldStartY);
        if (dy > 10) {
            clearTimeout(mdoHoldTimer);
            mdoHoldTimer = null;
        }
    } else if (mdoDraggingContext) {
        const { item, dayOff, startMouseY, initialStartHour } = mdoDraggingContext;
        const dy = coords.y - startMouseY;
        const hourDelta = dy / 60; // 60px = 1 hour in MDO
        const snapHours = settings.snapMinutes / 60;
        let newStart = Math.round((initialStartHour + hourDelta) / snapHours) * snapHours;

        if (newStart < settings.dayStartHour) newStart = settings.dayStartHour;

        // Correctly detect duration from instance or template
        let currentDur = item.dailyTimes?.[dayOff]?.durationH;
        if (currentDur === undefined) {
            currentDur = item.dailyTimes?.[item.startDayOffset]?.durationH ?? settings.defaultEventDurationHours;
        }

        if (newStart + currentDur > settings.dayEndHour) newStart = settings.dayEndHour - currentDur;

        if (!item.dailyTimes) item.dailyTimes = {};
        if (!item.dailyTimes[dayOff] || item.dailyTimes[dayOff].startHour !== newStart) {
            item.dailyTimes[dayOff] = { startHour: newStart, durationH: currentDur };
            lastMdoInteractionMoved = true;
            renderMobileDayOverlay();
        }
        if (e.type === 'touchmove') e.preventDefault();
    } else if (mdoResizingContext) {
        const { item, edge, dayOff, startMouseY, initialStartHour, initialDurationH } = mdoResizingContext;
        const dy = coords.y - startMouseY;
        const hourDelta = dy / 60;
        const snapHours = settings.snapMinutes / 60;
        let needsRender = false;

        // Ensure a dailyTimes entry exists for this day (recurring events may not have one)
        if (!item.dailyTimes[dayOff]) {
            item.dailyTimes[dayOff] = { startHour: initialStartHour, durationH: initialDurationH };
        }

        if (edge === 'bottom') {
            let newDur = Math.round((initialDurationH + hourDelta) / snapHours) * snapHours;
            if (newDur < snapHours) newDur = snapHours;
            if (initialStartHour + newDur > settings.dayEndHour) newDur = settings.dayEndHour - initialStartHour;
            if (item.dailyTimes[dayOff].durationH !== newDur) {
                item.dailyTimes[dayOff].durationH = newDur;
                needsRender = true;
            }
        } else { // top
            let hourShift = Math.round(hourDelta / snapHours) * snapHours;
            let newStart = initialStartHour + hourShift;
            let newDur = initialDurationH - hourShift;
            if (newDur < snapHours) { const diff = snapHours - newDur; newStart -= diff; newDur = snapHours; }
            if (newStart < settings.dayStartHour) { const diff = settings.dayStartHour - newStart; newStart = settings.dayStartHour; newDur -= diff; }
            if (item.dailyTimes[dayOff].startHour !== newStart || item.dailyTimes[dayOff].durationH !== newDur) {
                item.dailyTimes[dayOff].startHour = newStart;
                item.dailyTimes[dayOff].durationH = newDur;
                needsRender = true;
            }
        }
        if (needsRender) {
            lastMdoInteractionMoved = true;
            renderMobileDayOverlay();
        }
        if (e.type === 'touchmove') e.preventDefault();
    } else if (isResizingH) {
        const dy = resizeHStartY - coords.y; // positive = dragged up = expand
        let newH = resizeHStartHeight + dy;
        const maxH = (viewport.clientHeight || window.innerHeight) - 60;
        newH = Math.min(newH, maxH);
        if (newH < 80) {
            toggleDocsPane(false); isResizingH = false; document.body.style.userSelect = '';
        } else {
            const pane = document.getElementById('docs-pane');
            pane.style.transition = 'none'; pane.style.height = `${newH}px`;
            isPaneOpen = true; lastPaneHeight = `${newH}px`;
        }
        if (e.type === 'touchmove') e.preventDefault();
    } else if (isResizingV) {
        const docsPane = document.getElementById('docs-pane');
        const flexRatio = (coords.x - docsPane.getBoundingClientRect().left) / docsPane.getBoundingClientRect().width;
        document.getElementById('doc-1').style.flex = flexRatio;
        document.getElementById('doc-2').style.flex = 1 - flexRatio;
        if (e.type === 'touchmove') e.preventDefault();
    }
}

window.addEventListener('mousemove', handleMove);
window.addEventListener('touchmove', handleMove, { passive: false });

function finalizeDrags() {
    if (state.isPanning) { 
        state.isPanning = false; 
        viewport.style.cursor = state.activeTool === 'pan' ? 'grab' : 'default'; 
        if (currentViewLevel === 'day') snapToNearestDay();
    }
    if (pinchContext) {
        pinchContext = null;
        if (currentViewLevel === 'day') snapToNearestDay();
    }
    if (resizingBlockContext) resizingBlockContext = null;
    if (resizingDailyContext) {
        resizingDailyContext = null;
        const mdoOverlay = document.getElementById('mobile-day-overlay');
        if (mdoOverlay && mdoOverlay.style.display !== 'none') {
            renderMobileDayOverlay();
        }
        saveData();
    }
    if (mdoHoldTimer) {
        clearTimeout(mdoHoldTimer);
        mdoHoldTimer = null;
    }
    if (mdoDraggingContext || mdoResizingContext) {
        mdoDraggingContext = null;
        mdoResizingContext = null;
        lastMdoInteractionMoved = false;
        saveData();
    }
    if (movingBlockContext) movingBlockContext = null;
    if (creatingBlockContext) {
        let itemId = creatingBlockContext.item.id;
        creatingBlockContext = null;
        setActiveTool('select');
        renderItems();
        syncDocWindows();
        saveData();
    }
    if (draggingBlock) {
        const item = state.items.find(i => i.id === draggingBlock.itemId);
        const currentActiveDayOff = draggingBlock.originalClickedDayOff + (item.startDayOffset - draggingBlock.initialStartDayOffset);

        if (!item.dailyTimes) item.dailyTimes = {};

        if (!item.dailyTimes[currentActiveDayOff]) {
            let existingDur = settings.defaultEventDurationHours;
            const totalDayHours = settings.dayEndHour - settings.dayStartHour;
            let targetStartHour = settings.dayStartHour + Math.round(draggingBlock.initialTopPx / (state.rowHeight / totalDayHours));
            item.dailyTimes[currentActiveDayOff] = { startHour: targetStartHour, durationH: existingDur };
            renderItems();
            syncDocWindows();
            saveData();
        }
        draggingBlock = null;
    }

    isResizingH = false; isResizingV = false;
    document.body.style.userSelect = '';
}

let isPaneOpen = false;
let lastPaneHeight = '320px';

function toggleDocsPane(forceOpen) {
    const pane = document.getElementById('docs-pane');
    const hResizer = document.getElementById('h-resizer');
    if (forceOpen) {
        if (!lastPaneHeight || lastPaneHeight === '0px' || parseInt(lastPaneHeight) < 60) {
            lastPaneHeight = isMobileMode() ? '60vh' : '320px';
        }
        hResizer.style.display = isMobileMode() ? 'none' : 'flex'; // Disable manual resizing on mobile for simplicity
        pane.style.display = 'flex';

        requestAnimationFrame(() => {
            pane.style.transition = 'height 0.25s cubic-bezier(0.1, 0.9, 0.2, 1)';
            pane.style.height = lastPaneHeight;
            pane.style.borderTop = '1px solid var(--glass-border)';
        });
        isPaneOpen = true;
    } else {
        if (pane.style.height && pane.style.height !== '0px') {
            lastPaneHeight = pane.style.height;
        }
        hResizer.style.display = 'none';
        pane.style.transition = 'none';
        pane.style.height = '0px';
        pane.style.borderTop = 'none';
        pane.style.display = 'none';
        isPaneOpen = false;
    }
}

window.addEventListener('mouseup', finalizeDrags);
window.addEventListener('touchend', finalizeDrags);
window.addEventListener('touchcancel', finalizeDrags);
document.addEventListener('mouseleave', finalizeDrags);
window.addEventListener('blur', finalizeDrags);

viewport.addEventListener('dblclick', (e) => {
    const isItem = e.target.closest('.canvas-item');
    if (isItem) return;

    const localX = (e.clientX - viewport.getBoundingClientRect().left - state.canvasX) / state.scale;
    const localY = (e.clientY - viewport.getBoundingClientRect().top - state.canvasY) / state.scale;

    const monthAdvance = 7 * state.colWidth + state.monthGap;
    const monthDiff = Math.floor((localX - state.calendarStartX) / monthAdvance);
    const monthStartX = state.calendarStartX + monthDiff * monthAdvance;

    const c = Math.floor((localX - monthStartX) / state.colWidth);
    const r = Math.floor((localY - (state.calendarStartY + 70)) / state.rowHeight);

    if (c >= 0 && c < 7 && r >= 0 && r < 6) {
        let m = state.originMonth + monthDiff; let year = state.originYear + Math.floor(m / 12); m = ((m % 12) + 12) % 12;
        const firstDay = new Date(year, m, 1).getDay(); const targetDate = (r * 7 + c) - firstDay + 1;
        const daysInMonth = new Date(year, m + 1, 0).getDate();

        if (targetDate >= 1 && targetDate <= daysInMonth) {
            const clickedDate = new Date(year, m, targetDate); clickedDate.setHours(0, 0, 0, 0);
            const diffTime = Math.round((clickedDate - state.originDate) / (1000 * 60 * 60 * 24));

            const newItem = {
                id: generateId(), title: 'New Event', color: colors[Math.floor(Math.random() * colors.length)],
                startDayOffset: diffTime, durationDays: (state.scale < 1.5) ? settings.defaultEventDurationDays : 1,
                notes: { day: "", week: "", month: "" }, dailyTimes: {}, people: "", goals: "", repeat: "none"
            };

            if (state.scale >= 1.5) {
                const cellTopPlane = state.calendarStartY + 70 + r * state.rowHeight;
                const yInsideCell = localY - cellTopPlane;
                const totalDayHours = settings.dayEndHour - settings.dayStartHour;

                let startH = settings.dayStartHour + (yInsideCell / state.rowHeight) * totalDayHours;
                const snapHours = settings.snapMinutes / 60;
                startH = Math.floor(startH / snapHours) * snapHours;

                if (startH < settings.dayStartHour) startH = settings.dayStartHour;

                newItem.dailyTimes[diffTime] = {
                    startHour: startH,
                    durationH: settings.defaultEventDurationHours
                };
            }
            state.items.push(newItem);
            setActiveTool('select'); selectItem(newItem.id); renderItems();
            saveData();
        }
    }
});

function deleteItem(id) {
    if (!id) return;
    const item = state.items.find(i => i.id === id);
    if (!item) return;

    if (!confirm(`Are you sure you want to delete "${item.title}"?`)) return;

    state.items = state.items.filter(i => i.id !== id);
    state.selectedItemIds = state.selectedItemIds.filter(sid => sid !== id);

    renderItems();
    syncDocWindows();
    saveData();

    if (state.selectedItemIds.length === 0) {
        let hasPinned = false;
        document.querySelectorAll('.doc-window').forEach(win => {
            const pb = win.querySelector('.pin-btn');
            if (win.style.display !== 'none' && pb && pb.dataset.pinned === "true" && win.dataset.loadedItem) {
                hasPinned = true;
            }
        });
        if (!hasPinned) toggleDocsPane(false);
    }
}

function selectItem(id) {
    if (!id) {
        state.selectedItemIds = [];
    } else {
        const idx = state.selectedItemIds.indexOf(id);
        if (idx > -1) {
            state.selectedItemIds.splice(idx, 1);
        } else {
            const maxWindows = isMobileMode() ? 1 : 2;
            if (state.selectedItemIds.length >= maxWindows) state.selectedItemIds.shift();
            state.selectedItemIds.push(id);
        }
    }

    document.querySelectorAll('.canvas-item').forEach(el => el.classList.toggle('selected', state.selectedItemIds.includes(el.dataset.id)));

    if (state.selectedItemIds.length > 0) {
        tryCompleteHabitFromCalendarItem(id);
        toggleDocsPane(true);
        syncDocWindows();
    } else {
        syncDocWindows();
        let hasPinned = false;
        document.querySelectorAll('.doc-window').forEach(win => {
            const pb = win.querySelector('.pin-btn');
            if (win.style.display !== 'none' && pb && pb.dataset.pinned === "true" && win.dataset.loadedItem) {
                hasPinned = true;
            }
        });
        if (!hasPinned) toggleDocsPane(false);
    }

    if (document.getElementById('mobile-day-overlay').style.display !== 'none') {
        renderMobileDayOverlay();
    }
}

function getOccurrences(item, viewStart, viewEnd) {
    if (!item.repeat || item.repeat === 'none') {
        return [{ dayOffset: item.startDayOffset, duration: item.durationDays }];
    }
    const occurrences = [];
    const itemStart = item.startDayOffset;
    const duration = item.durationDays;

    if (item.repeat === 'daily') {
        for (let d = Math.max(itemStart, viewStart); d <= viewEnd; d++) {
            occurrences.push({ dayOffset: d, duration: duration });
        }
    } else if (item.repeat === 'weekly') {
        let firstVisible = itemStart + Math.ceil(Math.max(0, viewStart - itemStart) / 7) * 7;
        for (let d = firstVisible; d <= viewEnd; d += 7) {
            occurrences.push({ dayOffset: d, duration: duration });
        }
    } else if (item.repeat === 'weekdays') {
        for (let d = Math.max(itemStart, viewStart); d <= viewEnd; d++) {
            const date = new Date(state.originDate);
            date.setDate(date.getDate() + d);
            const day = date.getDay();
            if (day !== 0 && day !== 6) {
                occurrences.push({ dayOffset: d, duration: duration });
            }
        }
    } else if (item.repeat === 'monthly') {
        const baseDate = new Date(state.originDate);
        baseDate.setDate(baseDate.getDate() + itemStart);
        const dayOfMonth = baseDate.getDate();

        const startDate = new Date(state.originDate);
        startDate.setDate(startDate.getDate() + viewStart);
        const endDate = new Date(state.originDate);
        endDate.setDate(endDate.getDate() + viewEnd);

        let iterDate = new Date(baseDate.getFullYear(), baseDate.getMonth(), dayOfMonth);
        while (iterDate < startDate) iterDate.setMonth(iterDate.getMonth() + 1);
        while (iterDate <= endDate) {
            const dOffset = Math.round((iterDate - state.originDate) / (1000 * 60 * 60 * 24));
            if (dOffset >= itemStart) occurrences.push({ dayOffset: dOffset, duration: duration });
            iterDate.setMonth(iterDate.getMonth() + 1);
        }
    } else if (item.repeat === 'yearly') {
        const baseDate = new Date(state.originDate);
        baseDate.setDate(baseDate.getDate() + itemStart);
        const month = baseDate.getMonth();
        const date = baseDate.getDate();

        const startDate = new Date(state.originDate);
        startDate.setDate(startDate.getDate() + viewStart);
        const endDate = new Date(state.originDate);
        endDate.setDate(endDate.getDate() + viewEnd);

        let iterDate = new Date(baseDate.getFullYear(), month, date);
        while (iterDate < startDate) iterDate.setFullYear(iterDate.getFullYear() + 1);
        while (iterDate <= endDate) {
            const dOffset = Math.round((iterDate - state.originDate) / (1000 * 60 * 60 * 24));
            if (dOffset >= itemStart) occurrences.push({ dayOffset: dOffset, duration: duration });
            iterDate.setFullYear(iterDate.getFullYear() + 1);
        }
    }
    return occurrences;
}

function renderItems() {
    itemsContainer.innerHTML = '';
    const isDayView = state.scale >= 1.5;
    const totalDayHours = settings.dayEndHour - settings.dayStartHour;

    // Determine visible day range
    const localLeft = (0 - state.canvasX) / state.scale;
    const localRight = (viewport.clientWidth - state.canvasX) / state.scale;
    const localTop = (0 - state.canvasY) / state.scale;
    const localBottom = (viewport.clientHeight - state.canvasY) / state.scale;

    const viewStart = getDayOffsetFromCoords(localLeft - 200, localTop - 200);
    const viewEnd = getDayOffsetFromCoords(localRight + 200, localBottom + 200);

    state.items.forEach(item => {
        const occurrences = getOccurrences(item, viewStart, viewEnd);

        occurrences.forEach(occ => {
            if (isDayView) {
                for (let i = 0; i < occ.duration; i++) {
                    let dayOff = occ.dayOffset + i;
                    let dDate = new Date(state.originDate); dDate.setDate(state.originDate.getDate() + dayOff);
                    let coords = getDateCoords(dDate);
                    if (state.activeRow !== null && coords.row !== state.activeRow) continue;

                    let tBlock = item.dailyTimes && item.dailyTimes[dayOff];
                    if (!tBlock && item.repeat && item.repeat !== 'none') {
                        // For recurring items, use the template from the original start day if no specific override
                        tBlock = item.dailyTimes && item.dailyTimes[item.startDayOffset];
                    }

                    if (!tBlock) {
                        let slotOffsetHour = (parseInt(item.id, 36) % 3) * settings.defaultEventDurationHours;
                        if (settings.dayStartHour + slotOffsetHour + settings.defaultEventDurationHours > settings.dayEndHour) {
                            slotOffsetHour = 0;
                        }
                        tBlock = {
                            startHour: settings.dayStartHour + slotOffsetHour,
                            durationH: settings.defaultEventDurationHours
                        };
                    }

                    const el = document.createElement('div');
                    el.className = `canvas-item daily-block color-${item.color}`;
                    if (item.habitId) el.classList.add('habit-item');
                    if (state.selectedItemIds.includes(item.id)) el.classList.add('selected');
                    el.dataset.id = item.id; el.dataset.dayoff = dayOff;

                    if (tBlock.startHour >= settings.dayStartHour && tBlock.startHour < settings.dayEndHour) {
                        const topPx = ((tBlock.startHour - settings.dayStartHour) / totalDayHours) * state.rowHeight;
                        const heightPx = (tBlock.durationH / totalDayHours) * state.rowHeight;
                        el.style.left = `${coords.x + 65}px`; el.style.top = `${coords.y + topPx}px`;
                        el.style.width = `${state.colWidth - 75}px`; el.style.height = `${heightPx}px`;

                        const sTime = formatTime(tBlock.startHour);
                        const eTime = formatTime(tBlock.startHour + tBlock.durationH);
                        let habitBadge = '';
                        if (item.habitId) {
                            const habit = identityService.getHabits().find(h => h.id === item.habitId);
                            const todayStr = new Date().toISOString().split('T')[0];
                            const done = habit && identityService.isCompletedOnDate(item.habitId, todayStr);
                            const streak = habit ? (habit.streak || 0) : 0;
                            habitBadge = `<span style="float:right;font-size:10px;opacity:0.8">${done ? '✓' : ''}${streak > 0 ? ` ${streak}🔥` : ''}</span>`;
                        }
                        el.innerHTML = `<div class="item-title">${item.title}${item.repeat !== 'none' ? ' 🔄' : ''}${habitBadge}</div><div style="font-size:11px; margin-top:4px; opacity:0.8">${sTime} - ${eTime}</div>`;

                        const handleT = document.createElement('div'); handleT.className = 'resize-handle top'; el.appendChild(handleT);
                        const handleB = document.createElement('div'); handleB.className = 'resize-handle bottom'; el.appendChild(handleB);
                    } else {
                        const slotOffset = (parseInt(item.id, 36) % 3) * 20;
                        el.style.left = `${coords.x + 65}px`; el.style.top = `${coords.y + 4 + slotOffset}px`;
                        el.style.width = `${state.colWidth - 75}px`; el.style.height = `18px`;
                        el.innerHTML = `<div class="item-title" style="font-size:11px">${item.title}</div>`;
                    }
                    itemsContainer.appendChild(el);
                }
            } else {
                let currentSegment = null; const slotOffset = (parseInt(item.id, 36) % 3) * 32;
                let numSegments = 0;
                for (let i = 0; i < occ.duration; i++) {
                    let dDate = new Date(state.originDate); dDate.setDate(state.originDate.getDate() + occ.dayOffset + i);
                    let coords = getDateCoords(dDate);
                    if (!currentSegment) {
                        currentSegment = { startX: coords.x, y: coords.y, length: 1 };
                    } else {
                        let expectedX = Math.round(currentSegment.startX + currentSegment.length * state.colWidth);
                        if (Math.round(coords.y) === Math.round(currentSegment.y) && Math.round(coords.x) === expectedX) currentSegment.length++;
                        else {
                            drawSegment(item, currentSegment, slotOffset, numSegments === 0, false);
                            numSegments++;
                            currentSegment = { startX: coords.x, y: coords.y, length: 1 };
                        }
                    }
                }
                if (currentSegment) drawSegment(item, currentSegment, slotOffset, numSegments === 0, true);
            }
        });
    });
}

function drawSegment(item, seg, slotOffset, isFirstSegment, isLastSegment) {
    const el = document.createElement('div');
    el.className = `canvas-item color-${item.color}`;
    if (state.selectedItemIds.includes(item.id)) el.classList.add('selected');
    el.dataset.id = item.id;

    el.style.left = `${seg.startX + 4}px`; el.style.top = `${seg.y + 35 + slotOffset}px`;
    el.style.width = `${seg.length * state.colWidth - 8}px`; el.style.height = `28px`;

    const title = document.createElement('div'); title.className = 'item-title'; title.textContent = `${item.title}${item.repeat !== 'none' ? ' 🔄' : ''}`;
    el.appendChild(title);

    if (isFirstSegment) {
        const handleL = document.createElement('div');
        handleL.className = 'resize-handle left';
        el.appendChild(handleL);
    }

    if (isLastSegment) {
        const handleR = document.createElement('div');
        handleR.className = 'resize-handle right';
        el.appendChild(handleR);
    }

    itemsContainer.appendChild(el);
}

function setActiveTool(toolName) {
    state.activeTool = toolName;
    Object.values(tools).forEach(btn => { if (btn) btn.classList.remove('active'); });
    if (tools[toolName]) tools[toolName].classList.add('active');
    viewport.style.cursor = toolName === 'pan' ? 'grab' : (toolName === 'select' ? 'default' : 'crosshair');
}
Object.entries(tools).forEach(([name, btn]) => { if (btn) btn.addEventListener('click', () => setActiveTool(name)); });

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setActiveTool('select');
});

document.getElementById('zoom-in').addEventListener('click', () => zoomAt(window.innerWidth / 2, window.innerHeight / 4, 1.5));
document.getElementById('zoom-out').addEventListener('click', () => zoomAt(window.innerWidth / 2, window.innerHeight / 4, 1 / 1.5));
document.getElementById('zoom-reset').addEventListener('click', () => {
    state.scale = 1; document.body.className = 'zoom-week';
    state.canvasX = window.innerWidth / 2 - (state.calendarStartX + (state.colWidth * 3.5)); state.canvasY = window.innerHeight / 4 - state.calendarStartY;
    updateTransform();
});
const btnToggleView = document.getElementById('btn-toggle-view');
if (btnToggleView) btnToggleView.addEventListener('click', toggleView);

let isResizingH = false, isResizingV = false;
let resizeHStartY = 0, resizeHStartHeight = 0;
document.getElementById('h-resizer').addEventListener('mousedown', (e) => { isResizingH = true; resizeHStartY = getCoords(e).y; resizeHStartHeight = document.getElementById('docs-pane').offsetHeight; document.body.style.userSelect = 'none'; });
document.getElementById('h-resizer').addEventListener('touchstart', (e) => { isResizingH = true; resizeHStartY = getCoords(e).y; resizeHStartHeight = document.getElementById('docs-pane').offsetHeight; document.body.style.userSelect = 'none'; e.preventDefault(); }, { passive: false });
document.getElementById('v-resizer').addEventListener('mousedown', (e) => { isResizingV = true; document.body.style.userSelect = 'none'; });
document.getElementById('v-resizer').addEventListener('touchstart', (e) => { isResizingV = true; document.body.style.userSelect = 'none'; e.preventDefault(); }, { passive: false });

/* Mobile Handle Resizing */
const mobileHandle = document.getElementById('docs-mobile-handle');
if (mobileHandle) {
    mobileHandle.addEventListener('touchstart', (e) => {
        isResizingH = true;
        resizeHStartY = e.touches[0].clientY;
        resizeHStartHeight = document.getElementById('docs-pane').getBoundingClientRect().height;
        document.body.style.userSelect = 'none';
        e.preventDefault();
        e.stopPropagation();
    }, { passive: false });
}

// Moved logic into handleMove shared function

document.querySelectorAll('.pin-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
        const isPinned = btn.dataset.pinned === "true"; btn.dataset.pinned = (!isPinned).toString(); btn.classList.toggle('active', !isPinned);
        btn.textContent = !isPinned ? "📌 Pinned View" : "⚡ Dynamic View";

        const win = btn.closest('.doc-window');
        const viewLabelSpan = win.querySelector('.doc-view-label');
        if (!isPinned) {
            if (viewLabelSpan) viewLabelSpan.textContent = '';
        } else {
            win.dataset.loadedItem = "";
            syncDocWindows();
        }
    });
});

document.getElementById('btn-minimize-pane').addEventListener('click', () => {
    toggleDocsPane(false);
});

document.getElementById('btn-delete-doc-1').addEventListener('click', () => {
    const id = document.getElementById('doc-1').dataset.loadedItem;
    if (id) deleteItem(id);
});

document.getElementById('btn-delete-doc-2').addEventListener('click', () => {
    const id = document.getElementById('doc-2').dataset.loadedItem;
    if (id) deleteItem(id);
});

document.getElementById('btn-add-doc-2').addEventListener('click', () => {
    document.getElementById('doc-2').style.display = 'flex';
    document.getElementById('v-resizer').style.display = 'flex';
    document.getElementById('btn-add-doc-2').style.display = 'none';
    document.getElementById('btn-close-doc-1').style.display = 'inline-block';
    document.getElementById('btn-swap-docs').style.display = 'inline-block';
    syncDocWindows();
});

function closeDocSplit() {
    document.getElementById('doc-2').style.display = 'none';
    document.getElementById('v-resizer').style.display = 'none';
    document.getElementById('btn-add-doc-2').style.display = 'inline-block';
    document.getElementById('btn-close-doc-1').style.display = 'none';
    document.getElementById('btn-swap-docs').style.display = 'none';

    syncDocWindows();

    if (state.selectedItemIds.length === 0) {
        let hasPinned = false;
        if (document.querySelector('#doc-1 .pin-btn').dataset.pinned === "true" && document.getElementById('doc-1').dataset.loadedItem) {
            hasPinned = true;
        }
        if (!hasPinned) toggleDocsPane(false);
    }
}

document.getElementById('btn-close-doc-1').addEventListener('click', () => {
    const doc1 = document.getElementById('doc-1');
    const doc2 = document.getElementById('doc-2');

    doc1.dataset.loadedItem = doc2.dataset.loadedItem || "";
    const pin1 = doc1.querySelector('.pin-btn');
    const pin2 = doc2.querySelector('.pin-btn');
    pin1.dataset.pinned = pin2.dataset.pinned;
    pin1.classList.toggle('active', pin1.dataset.pinned === "true");
    pin1.textContent = pin1.dataset.pinned === "true" ? "📌 Pinned View" : "⚡ Dynamic View";

    closeDocSplit();
});

document.getElementById('btn-close-doc-2').addEventListener('click', closeDocSplit);

document.getElementById('btn-swap-docs').addEventListener('click', () => {
    const doc1 = document.getElementById('doc-1');
    const doc2 = document.getElementById('doc-2');

    const pin1 = doc1.querySelector('.pin-btn');
    const pin2 = doc2.querySelector('.pin-btn');

    const p1Pinned = pin1.dataset.pinned;
    const p2Pinned = pin2.dataset.pinned;

    pin1.dataset.pinned = p2Pinned;
    pin1.classList.toggle('active', p2Pinned === "true");
    pin1.textContent = p2Pinned === "true" ? "📌 Pinned View" : "⚡ Dynamic View";

    pin2.dataset.pinned = p1Pinned;
    pin2.classList.toggle('active', p1Pinned === "true");
    pin2.textContent = p1Pinned === "true" ? "📌 Pinned View" : "⚡ Dynamic View";

    const tmpItem = doc1.dataset.loadedItem;
    doc1.dataset.loadedItem = doc2.dataset.loadedItem || "";
    doc2.dataset.loadedItem = tmpItem || "";

    if (state.selectedItemIds.length > 1) {
        state.selectedItemIds = [state.selectedItemIds[1], state.selectedItemIds[0]];
    }

    syncDocWindows();
});

function syncDocWindows() {
    const dynamicWindows = [];
    const pinnedIds = [];

    document.querySelectorAll('.doc-window').forEach((win) => {
        if (win.style.display === 'none') {
            win.dataset.loadedItem = "";
            return;
        }

        const isPinned = win.querySelector('.pin-btn') && win.querySelector('.pin-btn').dataset.pinned === "true";
        if (isPinned && win.dataset.loadedItem) {
            pinnedIds.push(win.dataset.loadedItem);
            loadItemIntoDocWindow(win, win.dataset.loadedItem);
            return;
        }

        dynamicWindows.push(win);
    });

    if (isMobileMode() && dynamicWindows.length > 0) {
        // Enforce only one dynamic window on mobile
        const win = dynamicWindows[0];
        const targetId = state.selectedItemIds[0] || null;
        win.dataset.loadedItem = targetId || "";
        loadItemIntoDocWindow(win, targetId);

        // Hide others if any
        for (let i = 1; i < dynamicWindows.length; i++) {
            dynamicWindows[i].dataset.loadedItem = "";
            dynamicWindows[i].style.display = 'none';
        }
        return;
    }

    const unpinnedSelectedIds = state.selectedItemIds.filter(id => !pinnedIds.includes(id));

    dynamicWindows.forEach((win, index) => {
        const targetId = unpinnedSelectedIds[index] || null;
        win.dataset.loadedItem = targetId || "";

        const viewLabelSpan = win.querySelector('.doc-view-label');
        if (viewLabelSpan) {
            viewLabelSpan.textContent = targetId ? `(${currentViewLevel.toUpperCase()})` : '';
        }

        loadItemIntoDocWindow(win, targetId);
    });
}

function loadItemIntoDocWindow(win, loadedItemId) {
    const title = win.querySelector('.doc-title'); const editor = win.querySelector('.doc-editor');
    const metadataBlock = win.querySelector('.doc-metadata');
    const timeLabel = win.querySelector('.meta-time-label');
    const timeEditGroup = win.querySelector('.meta-time-edit-group');
    const metaDatePrefix = win.querySelector('.meta-date-prefix');
    const metaTimeStart = win.querySelector('.meta-time-start');
    const metaTimeEnd = win.querySelector('.meta-time-end');
    const metaDuration = win.querySelector('.meta-duration');
    const peopleInput = win.querySelector('.meta-people');
    const goalsInput = win.querySelector('.meta-goals');
    const repeatSelect = win.querySelector('.meta-repeat');

    if (!loadedItemId) {
        title.value = ""; title.placeholder = "Select an event or project in calendar..."; editor.value = ""; editor.disabled = true; title.disabled = true;
        const delBtn = win.querySelector('.btn-delete');
        if (delBtn) delBtn.style.display = 'none';
        if (metadataBlock) metadataBlock.style.display = 'none'; return;
    }

    const item = state.items.find(i => i.id === loadedItemId);
    if (!item) return;

    title.disabled = false; editor.disabled = false; title.value = item.title;
    const delBtn = win.querySelector('.btn-delete');
    if (delBtn) delBtn.style.display = 'flex';
    if (metadataBlock) metadataBlock.style.display = 'flex';

    if (typeof item.notes === 'string') item.notes = { day: item.notes, week: item.notes, month: item.notes };
    else if (!item.notes) item.notes = { day: "", week: "", month: "" };

    let startD = new Date(state.originDate); startD.setDate(startD.getDate() + item.startDayOffset);
    let endD = new Date(startD); endD.setDate(startD.getDate() + item.durationDays - 1);

    let isDaySingle = currentViewLevel === 'day' && item.durationDays === 1 && item.dailyTimes && item.dailyTimes[item.startDayOffset];

    if (isDaySingle) {
        let tb = item.dailyTimes[item.startDayOffset];
        timeLabel.classList.add('hidden');
        timeEditGroup.classList.remove('hidden');

        metaDatePrefix.textContent = `${startD.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, `;
        metaTimeStart.value = decimalToTimeInput(tb.startHour);
        metaTimeEnd.value = decimalToTimeInput(tb.startHour + tb.durationH);
        metaDuration.value = tb.durationH;
        metaDuration.step = (settings.snapMinutes / 60).toString();

        metaTimeStart.onchange = (e) => {
            let [h, m] = e.target.value.split(':').map(Number);
            item.dailyTimes[item.startDayOffset].startHour = h + (m / 60);
            renderItems(); syncDocWindows();
        };
        metaTimeEnd.onchange = (e) => {
            let [h, m] = e.target.value.split(':').map(Number);
            let tbObj = item.dailyTimes[item.startDayOffset];
            tbObj.durationH = Math.max((settings.snapMinutes / 60), (h + (m / 60)) - tbObj.startHour);
            renderItems(); syncDocWindows();
        };
        metaDuration.onchange = (e) => {
            item.dailyTimes[item.startDayOffset].durationH = Math.max((settings.snapMinutes / 60), parseFloat(e.target.value));
            renderItems(); syncDocWindows();
        };
    } else {
        timeLabel.classList.remove('hidden');
        timeEditGroup.classList.add('hidden');
        timeLabel.textContent = `${startD.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${endD.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} (${item.durationDays} Days)`;
    }

    peopleInput.value = item.people || "";
    goalsInput.value = item.goals || "";
    repeatSelect.value = item.repeat || "none";
    editor.value = item.notes[currentViewLevel] || "";

    title.oninput = (e) => { item.title = e.target.value; renderItems(); saveData(); };
    peopleInput.oninput = (e) => { item.people = e.target.value; saveData(); };
    goalsInput.oninput = (e) => { item.goals = e.target.value; saveData(); };
    repeatSelect.onchange = (e) => { item.repeat = e.target.value; renderItems(); saveData(); };
    editor.oninput = (e) => { item.notes[currentViewLevel] = e.target.value; saveData(); };
}

const modal = document.getElementById('settings-modal');
document.getElementById('btn-settings').addEventListener('click', () => {
    document.getElementById('set-start-hour').value = settings.dayStartHour;
    document.getElementById('set-end-hour').value = settings.dayEndHour;
    document.getElementById('set-snap-mins').value = settings.snapMinutes;
    document.getElementById('set-def-hours').value = settings.defaultEventDurationHours;
    document.getElementById('set-time-format').value = settings.timeFormat;
    modal.classList.remove('hidden');
});
document.getElementById('cancel-settings').addEventListener('click', () => modal.classList.add('hidden'));
document.getElementById('save-settings').addEventListener('click', () => {
    settings.dayStartHour = parseInt(document.getElementById('set-start-hour').value);
    settings.dayEndHour = parseInt(document.getElementById('set-end-hour').value);
    settings.snapMinutes = parseInt(document.getElementById('set-snap-mins').value);
    settings.defaultEventDurationHours = parseFloat(document.getElementById('set-def-hours').value);
    settings.timeFormat = document.getElementById('set-time-format').value;
    modal.classList.add('hidden');
    applySettings();
});

function setupDummyData() {
    state.items.push({
        id: generateId(), type: 'project', title: 'Market Research Sprint', color: 'pink',
        startDayOffset: 0, durationDays: 1,
        notes: { day: "Daily agenda for testing...", week: "Schedule users this week.", month: "Platform validation." },
        dailyTimes: { 0: { startHour: 9.5, durationH: 4 } },
        people: "Alice, Bob", goals: "User interviews", repeat: "none"
    });
}

function setupAuth() {
    initAuth((user, cloudData) => {
        if (user) {
            if (cloudData) {
                state.items = cloudData;
            } else {
                // First time login - sync existing local data to cloud
                saveToCloud(state.items);
            }
        } else {
            // Load from local storage for guests
            const local = localStorage.getItem('nexus_items');
            if (local) {
                try {
                    state.items = JSON.parse(local);
                } catch (e) {
                    console.error("Local load error", e);
                }
            }
        }
        renderItems();
        syncDocWindows();
    });
}

function saveData() {
    localStorage.setItem('nexus_items', JSON.stringify(state.items));
    saveToCloud(state.items);
}

// ─── Identity Blueprint & Habit Tracking ─────────────────────────────────────

let _habitModalTargetIdentityId = null;

function setupIdentityUI() {
    identityService.loadIdentityData().then(() => renderIdentityPane());

    document.getElementById('btn-toggle-identity').addEventListener('click', () => {
        const pane = document.getElementById('identity-pane');
        pane.classList.toggle('collapsed');
        if (!pane.classList.contains('collapsed')) renderIdentityPane();
    });

    document.getElementById('add-identity').addEventListener('click', () => {
        const name = prompt('Identity statement (e.g. "I am a disciplined athlete"):');
        if (!name || !name.trim()) return;
        const colors = ['blue', 'purple', 'green', 'pink', 'orange'];
        const color = colors[identityService.getIdentities().length % colors.length];
        identityService.addIdentity(name.trim(), color);
        identityService.saveIdentityData();
        renderIdentityPane();
    });

    // Goal modal wiring
    document.getElementById('cancel-goal').addEventListener('click', () => {
        document.getElementById('goal-modal').classList.add('hidden');
    });

    document.getElementById('save-goal').addEventListener('click', () => {
        const title = document.getElementById('goal-title').value.trim();
        if (!title) return;
        const identityId = document.getElementById('goal-identity').value || null;
        identityService.addGoal({
            identityId,
            title,
            description: document.getElementById('goal-description').value.trim(),
            targetDate: document.getElementById('goal-target-date').value || null
        });
        identityService.saveIdentityData();
        document.getElementById('goal-modal').classList.add('hidden');
        renderIdentityPane();
    });

    // Habit modal wiring
    document.getElementById('cancel-habit').addEventListener('click', () => {
        document.getElementById('habit-modal').classList.add('hidden');
    });

    document.getElementById('save-habit').addEventListener('click', () => {
        const name = document.getElementById('habit-name').value.trim();
        if (!name) return;
        const timeVal = document.getElementById('habit-start-time').value;
        let startHour = null;
        if (timeVal) {
            const [h, m] = timeVal.split(':').map(Number);
            startHour = h + m / 60;
        }
        const habit = identityService.addHabit({
            identityId: _habitModalTargetIdentityId,
            name,
            frequency: document.getElementById('habit-frequency').value,
            cue: document.getElementById('habit-cue').value.trim(),
            reward: document.getElementById('habit-reward').value.trim(),
            startHour,
            durationH: parseFloat(document.getElementById('habit-duration').value) || 0.5
        });

        // If a time was given, create a recurring calendar event for this habit
        if (startHour !== null) {
            const repeatMap = { daily: 'daily', weekdays: 'weekdays', weekly: 'weekly' };
            const calItem = {
                id: generateId(), type: 'task', title: habit.name,
                color: getIdentityColor(_habitModalTargetIdentityId),
                startDayOffset: 0, durationDays: 1,
                notes: { day: '', week: '', month: '' },
                dailyTimes: { 0: { startHour, durationH: habit.durationH } },
                people: '', goals: '', repeat: repeatMap[habit.frequency] || 'daily',
                habitId: habit.id
            };
            state.items.push(calItem);
            saveData();
            renderItems();
        }

        identityService.saveIdentityData();
        document.getElementById('habit-modal').classList.add('hidden');
        renderIdentityPane();
    });
}

function getIdentityColor(identityId) {
    const identity = identityService.getIdentities().find(i => i.id === identityId);
    return identity ? identity.color : 'blue';
}

function renderIdentityPane() {
    const list = document.getElementById('identity-list');
    const identities = identityService.getIdentities();
    const habits = identityService.getHabits();
    list.innerHTML = '';

    let totalVotes = 0;
    identities.forEach(identity => {
        totalVotes += identity.votes || 0;
        const identityHabits = habits.filter(h => h.identityId === identity.id);
        list.appendChild(buildIdentityCard(identity, identityHabits));
    });

    if (identities.length === 0) {
        list.innerHTML = '<p style="color:var(--text-muted);font-size:12px;padding:20px;text-align:center;">Click + to define your first identity.</p>';
    }

    document.getElementById('total-votes').textContent = totalVotes;
}

function buildIdentityCard(identity, habits) {
    const card = document.createElement('div');
    card.className = 'identity-card';

    const today = new Date().toISOString().split('T')[0];
    const completedToday = habits.filter(h => identityService.isCompletedOnDate(h.id, today)).length;
    const allDoneToday = habits.length > 0 && completedToday === habits.length;

    const accentColor = `var(--color-${identity.color})`;

    const headerHTML = `
        <div class="identity-card-header">
            <span class="identity-dot" style="background:${accentColor}"></span>
            <span class="identity-name">${identity.name}</span>
            <button class="identity-delete-btn" data-id="${identity.id}" title="Delete Identity">×</button>
        </div>
        <div class="identity-votes-row">
            <span class="identity-votes-label">${identity.votes || 0} identity votes</span>
            ${allDoneToday ? '<span class="identity-done-badge">✓ All done today!</span>' : `<span class="identity-progress">${completedToday}/${habits.length} habits today</span>`}
        </div>
        <div class="vote-bar-container">
            <div class="vote-bar" style="background:${accentColor}; width:${Math.min(100, (identity.votes || 0))}%"></div>
        </div>
    `;

    const habitsHTML = habits.map(h => buildHabitRowHTML(h, today)).join('');

    const identityGoals = identityService.getGoalsByIdentity(identity.id);
    const goalsHTML = identityGoals.map(g => buildGoalRowHTML(g)).join('');

    card.innerHTML = `
        ${headerHTML}
        <div class="habits-list">${habitsHTML}</div>
        <button class="add-habit-btn" data-identity="${identity.id}">+ Add Habit</button>
        <div class="goals-panel">
            <div class="goals-panel-header">Goals</div>
            <div class="goals-list">${goalsHTML || '<span class="goals-empty">No goals yet.</span>'}</div>
            <button class="add-goal-btn" data-identity="${identity.id}">+ Add Goal</button>
        </div>
    `;

    // Habit check buttons
    card.querySelectorAll('.habit-check-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const habitId = btn.dataset.habit;
            const wasNew = identityService.completeHabit(habitId, today);
            if (wasNew) {
                identity.votes = (identity.votes || 0) + 1;
                showVoteFlash(btn, accentColor);
            }
            identityService.saveIdentityData();
            renderIdentityPane();
        });
    });

    // Habit uncomplete buttons
    card.querySelectorAll('.habit-uncheck-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const habitId = btn.dataset.habit;
            identityService.uncompleteHabit(habitId, today);
            identity.votes = Math.max(0, (identity.votes || 0) - 1);
            identityService.saveIdentityData();
            renderIdentityPane();
        });
    });

    // Habit delete buttons
    card.querySelectorAll('.habit-delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            identityService.deleteHabit(btn.dataset.habit);
            identityService.saveIdentityData();
            renderIdentityPane();
        });
    });

    // Goal check/delete buttons
    card.querySelectorAll('.goal-check-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const goal = identityService.getGoals().find(g => g.id === btn.dataset.goal);
            if (goal) identityService.updateGoal(goal.id, { completed: !goal.completed });
            identityService.saveIdentityData();
            renderIdentityPane();
        });
    });

    card.querySelectorAll('.goal-delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            identityService.deleteGoal(btn.dataset.goal);
            identityService.saveIdentityData();
            renderIdentityPane();
        });
    });

    // Add goal button
    card.querySelector('.add-goal-btn').addEventListener('click', () => {
        const select = document.getElementById('goal-identity');
        select.innerHTML = identityService.getIdentities()
            .map(i => `<option value="${i.id}" ${i.id === identity.id ? 'selected' : ''}>${i.name}</option>`)
            .join('');
        document.getElementById('goal-title').value = '';
        document.getElementById('goal-description').value = '';
        document.getElementById('goal-target-date').value = '';
        document.getElementById('goal-modal').classList.remove('hidden');
    });

    // Add habit button
    card.querySelector('.add-habit-btn').addEventListener('click', () => {
        _habitModalTargetIdentityId = identity.id;
        document.getElementById('habit-name').value = '';
        document.getElementById('habit-cue').value = '';
        document.getElementById('habit-reward').value = '';
        document.getElementById('habit-frequency').value = 'daily';
        document.getElementById('habit-start-time').value = '';
        document.getElementById('habit-duration').value = '0.5';
        document.getElementById('habit-modal').classList.remove('hidden');
    });

    // Identity delete
    card.querySelector('.identity-delete-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        if (!confirm(`Delete identity "${identity.name}" and all its habits?`)) return;
        // Remove linked calendar items
        state.items = state.items.filter(item => {
            const habit = identityService.getHabits().find(h => h.identityId === identity.id && h.id === item.habitId);
            return !habit;
        });
        identityService.deleteIdentity(identity.id);
        identityService.saveIdentityData();
        saveData();
        renderIdentityPane();
        renderItems();
    });

    return card;
}

function buildHabitRowHTML(habit, today) {
    const done = identityService.isCompletedOnDate(habit.id, today);
    const streak = habit.streak || 0;
    const streakIcon = streak >= 7 ? '🔥' : streak >= 3 ? '⚡' : '';
    const freqLabel = { daily: 'Daily', weekdays: 'Weekdays', weekly: 'Weekly' }[habit.frequency] || habit.frequency;
    const cueHint = habit.cue ? `<span class="habit-cue-hint">After: ${habit.cue}</span>` : '';

    return `
        <div class="habit-row ${done ? 'habit-done' : ''}">
            <div class="habit-row-main">
                <button class="habit-check-btn ${done ? 'checked' : ''}" data-habit="${habit.id}" title="${done ? 'Mark incomplete' : 'Mark complete for today'}">
                    ${done ? '✓' : ''}
                </button>
                <div class="habit-info">
                    <span class="habit-name">${habit.name}</span>
                    <span class="habit-meta">${freqLabel} ${streakIcon ? `· ${streak}d ${streakIcon}` : streak > 0 ? `· ${streak}d streak` : ''}</span>
                    ${cueHint}
                </div>
                <button class="habit-delete-btn" data-habit="${habit.id}" title="Remove habit">×</button>
            </div>
        </div>
    `;
}

function buildGoalRowHTML(goal) {
    const dateLabel = goal.targetDate ? `<span class="goal-date">by ${goal.targetDate}</span>` : '';
    const descLabel = goal.description ? `<span class="goal-desc">${goal.description}</span>` : '';
    return `
        <div class="goal-item ${goal.completed ? 'completed' : ''}">
            <button class="goal-check-btn ${goal.completed ? 'checked' : ''}" data-goal="${goal.id}" title="${goal.completed ? 'Mark incomplete' : 'Mark complete'}">
                ${goal.completed ? '✓' : ''}
            </button>
            <div class="goal-info">
                <span class="goal-title">${goal.title}</span>
                ${descLabel}
                ${dateLabel}
            </div>
            <button class="goal-delete-btn" data-goal="${goal.id}" title="Remove goal">×</button>
        </div>
    `;
}

function showVoteFlash(el, color) {
    const flash = document.createElement('div');
    flash.className = 'vote-flash';
    flash.textContent = '+1 vote';
    flash.style.color = color;
    el.parentElement.appendChild(flash);
    setTimeout(() => flash.remove(), 1200);
}

// Mark habit complete when its calendar event is clicked in the day view
function tryCompleteHabitFromCalendarItem(itemId) {
    const item = state.items.find(i => i.id === itemId);
    if (!item || !item.habitId) return;
    const today = new Date().toISOString().split('T')[0];
    const wasNew = identityService.completeHabit(item.habitId, today);
    if (wasNew) {
        const habit = identityService.getHabits().find(h => h.id === item.habitId);
        const identity = identityService.getIdentities().find(i => i.id === habit?.identityId);
        if (identity) identity.votes = (identity.votes || 0) + 1;
        identityService.saveIdentityData();
        renderIdentityPane();
    }
}

init();

/* Onboarding Tutorial Logic */
function initOnboarding() {
    const onboarded = localStorage.getItem('nexus_onboarded');
    if (onboarded) return;

    const wrap = document.getElementById('onboarding-wrap');
    const btnNext = document.getElementById('btn-next-step');
    const steps = document.querySelectorAll('#onboarding-steps .step');
    const dots = document.querySelectorAll('.step-dots .dot');
    let currentStep = 0;

    // Mobile-specific text adjustments
    if (isMobileMode()) {
        const p2 = document.getElementById('onboarding-p2');
        const p3 = document.getElementById('onboarding-p3');
        const p4 = document.getElementById('onboarding-p4');

        if (p2) p2.innerHTML = "<b>Pinch</b> to zoom in/out and <b>swipe</b> horizontally to move through the timeline or change days.";
        if (p3) p3.innerHTML = "Tap the <b>Floating Action Button (+)</b> to quickly add a new Project, Meeting, or Task to your schedule.";
        if (p4) p4.innerHTML = "Tap any event to view and edit its <b>Documentation</b>. Manage your goals and notes in a native-feeling mobile pane.";
    }

    if (wrap) wrap.classList.remove('hidden');

    if (btnNext) {
        btnNext.addEventListener('click', () => {
            steps[currentStep].classList.remove('active');
            dots[currentStep].classList.remove('active');
            
            currentStep++;
            
            if (currentStep < steps.length) {
                steps[currentStep].classList.add('active');
                dots[currentStep].classList.add('active');
                if (currentStep === steps.length - 1) {
                    btnNext.textContent = "Get Started";
                }
            } else {
                if (wrap) {
                    wrap.style.opacity = '0';
                    setTimeout(() => {
                        wrap.classList.add('hidden');
                    }, 400);
                }
                localStorage.setItem('nexus_onboarded', 'true');
            }
        });
    }
}

initOnboarding();