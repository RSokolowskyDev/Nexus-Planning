# Sentinel Audit: Action Required

[ACTION]
Here's the plan to address the stated goals for the mobile day view:

**Goal 1: Make sure in the mobile view, it doesn't quit the "day view" when I try to add an event.**

**Steps:**

1.  **Modify `main.js` in `setupMobileDayFab` function:**
    *   Locate the `menuItems.forEach` block within `setupMobileDayFab`.
    *   Inside the click event listener for each `mdo-menu-item`, find the line `closeMobileDayView(newItem.id);`.
    *   **Remove or comment out** `closeMobileDayView(newItem.id);`.
    *   After adding the `newItem` to `state.items` and calling `saveData()`, add a call to `renderMobileDayOverlay();` to refresh the view with the new item.
    *   To provide better feedback, after `renderMobileDayOverlay();`, add logic to briefly scroll the `mdo-schedule` to the newly created item if it's not immediately visible. This will require calculating the item's `topPx` and scrolling the `mdo-schedule`'s `scrollTop`.

    ```javascript
    // In main.js, inside setupMobileDayFab:
    menuItems.forEach(item => {
        item.addEventListener('click', (e) => {
            // ... (existing code to create newItem) ...

            state.items.push(newItem);
            saveData();
            
            // --- MODIFIED SECTION ---
            renderMobileDayOverlay(); // Re-render to show the new item
            
            // Optional: Scroll to the new item for better UX
            const scheduleEl = document.getElementById('mdo-schedule');
            if (scheduleEl) {
                const hourRowHeight = 60; // px per hour
                const startHour = newItem.dailyTimes[state.activeDayOffset]?.startHour || 0;
                const scrollTarget = (startHour - settings.dayStartHour) * hourRowHeight - (scheduleEl.clientHeight / 2) + (hourRowHeight / 2);
                scheduleEl.scrollTo({
                    top: scrollTarget,
                    behavior: 'smooth'
                });
            }
            // --- END MODIFIED SECTION ---

            // Reset FAB
            fab.classList.remove('active');
            menu.classList.remove('active');
        });
    });
    ```

---

**Goal 2: Add functionality to change the amount of time of an event in the mobile day view by dragging the bottom of the event block up or down, as well as being to do that from the top.**

**Steps:**

1.  **Modify `index.css` to ensure resize handles are visible/styled (if needed):**
    *   The existing `.resize-handle` styles are good, but we need to ensure they are visible on `.mdo-event` if needed.

    ```css
    /* Add to index.css if not already covered, for example under .resize-handle */
    .mdo-event .resize-handle.top::after,
    .mdo-event .resize-handle.bottom::after {
        background: rgba(255, 255, 255, 0.6); /* Slightly more prominent for small mobile target */
    }
    ```

2.  **Modify `main.js` in `renderMobileDayOverlay` function:**
    *   When generating the `mdo-event` HTML, add `resize-handle top` and `resize-handle bottom` elements inside each `.mdo-event` div.
    *   These handles will need appropriate positioning (e.g., `position: absolute; left:0; right:0;` for top/bottom handles, similar to desktop calendar items).
    *   Add a new `data-type="mobile-daily-block"` or similar to the `mdo-event` to easily identify it in event listeners.

    ```javascript
    // In main.js, inside renderMobileDayOverlay, within the eventsHTML.push block:
    // ...
    eventsHTML.push(`<div class="mdo-event color-${item.color}"
        style="top:${topPx}px; height:${heightPx}px; left: 62px; right: 8px;"
        data-id="${item.id}" data-dayoff="${off}" data-type="mobile-daily-block">
        <div class="mdo-event-title">${item.title}${item.repeat !== 'none' ? ' 🔄' : ''}${habitBadge}</div>
        <div class="mdo-event-time">${sTime} – ${eTime}</div>
        <div class="resize-handle top"></div>
        <div class="resize-handle bottom"></div>
    </div>`);
    // ...
    ```

3.  **Modify `main.js` to handle mobile day overlay event resizing:**
    *   **Adapt `handleStart`:**
        *   Inside `handleStart`, extend the `if (resizeHandle ...)` block.
        *   Check if `e.target.closest('.mdo-event')` exists. If so, initialize a new `resizingDailyContext` (or a similar dedicated context like `resizingMDOEventContext`) but using touch coordinates and specific `mdo-event` data.
        *   The `resizingDailyContext` (or new context) needs to capture `item`, `edge`, `dayOff`, `startMouseY`, `initialStartHour`, `initialDurationH`. The `dayOff` will come from `itemEl.dataset.dayoff`.

    ```javascript
    // In main.js, modify handleStart function:
    function handleStart(e) {
        // ... (existing double tap and pinch logic) ...

        const coords = getCoords(e);
        const resizeHandle = e.target.closest('.resize-handle');
        const mdoEventEl = e.target.closest('.mdo-event'); // Check for MDO event resize

        if (resizeHandle && (state.activeTool === 'select' || state.activeTool === 'pan' || mdoEventEl)) { // Added mdoEventEl check
            const itemEl = resizeHandle.closest('.canvas-item') || mdoEventEl; // Use mdoEventEl if it's there
            const id = itemEl.dataset.id;
            let edge = 'right';
            if (resizeHandle.classList.contains('left')) edge = 'left';
            else if (resizeHandle.classList.contains('top')) edge = 'top';
            else if (resizeHandle.classList.contains('bottom')) edge = 'bottom';
            const item = state.items.find(i => i.id === id);
            if (state.activeTool === 'select' && itemEl.classList.contains('canvas-item')) selectItem(id); // Only select if it's a main canvas item

            if (itemEl.dataset.type === 'mobile-daily-block' && (edge === 'top' || edge === 'bottom')) { // Handle MDO event resize
                 const handleDayOff = parseInt(itemEl.dataset.dayoff);
                 if (!item.dailyTimes) item.dailyTimes = {};
                 if (!item.dailyTimes[handleDayOff]) {
                     let slotOffsetHour = (parseInt(item.id, 36) % 3) * settings.defaultEventDurationHours;
                     if (settings.dayStartHour + slotOffsetHour + settings.defaultEventDurationHours > settings.dayEndHour) slotOffsetHour = 0;
                     item.dailyTimes[handleDayOff] = { startHour: settings.dayStartHour + slotOffsetHour, durationH: settings.defaultEventDurationHours };
                 }

                 resizingDailyContext = { // Re-using resizingDailyContext
                     item: item, edge: edge, dayOff: handleDayOff,
                     startMouseY: coords.y,
                     initialStartHour: item.dailyTimes[handleDayOff].startHour,
                     initialDurationH: item.dailyTimes[handleDayOff].durationH,
                     isMobileMDO: true // Flag to indicate mobile day overlay resize
                 };
            } else if (edge === 'left' || edge === 'right') { // Existing desktop horizontal resize
                resizingBlockContext = {
                    item: item, edge: edge,
                    startXLocal: (coords.x - viewport.getBoundingClientRect().left - state.canvasX) / state.scale,
                    initialDuration: item.durationDays,
                    initialStartDayOffset: item.startDayOffset
                };
            } else if (edge === 'top' || edge === 'bottom') { // Existing desktop vertical resize
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

        // ... (rest of handleStart function) ...
    }
    ```

    *   **Adapt `handleMove`:**
        *   Inside `handleMove`, if `resizingDailyContext` is active and `resizingDailyContext.isMobileMDO` is true, adjust the logic to re-render only the mobile day overlay schedule, not the main calendar canvas.
        *   The `pxPerHour` will be a fixed `hourRowHeight` (60px) from `renderMobileDayOverlay`.

    ```javascript
    // In main.js, modify handleMove function:
    function handleMove(e) {
        // ... (existing pinch, panning, draggingBlock, resizingBlockContext logic) ...

        else if (resizingDailyContext) {
            const item = resizingDailyContext.item;
            const hourRowHeight = 60; // For MDO, it's a fixed height. For desktop, it's based on scaled state.rowHeight.
            const currentPxPerHour = resizingDailyContext.isMobileMDO ? hourRowHeight : (state.rowHeight / (settings.dayEndHour - settings.dayStartHour));

            const dy = (coords.y - resizingDailyContext.startMouseY); // No scaling here, as it's pixel delta on screen
            const snapHours = settings.snapMinutes / 60;
            let hourShift = Math.round((dy / currentPxPerHour) / snapHours) * snapHours;
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
            if (needsRender) {
                if (resizingDailyContext.isMobileMDO) {
                    renderMobileDayOverlay(); // Only refresh MDO
                } else {
                    renderItems(); // Refresh main canvas
                }
                syncDocWindows();
            }
            if (e.type === 'touchmove') e.preventDefault();
        }

        // ... (rest of handleMove function) ...
    }
    ```

    *   **Adapt `finalizeDrags`:**
        *   Ensure that after `resizingDailyContext` is cleared, `saveData()` is called.

    ```javascript
    // In main.js, modify finalizeDrags function:
    function finalizeDrags() {
        // ... (existing logic) ...
        if (resizingDailyContext) {
            resizingDailyContext = null;
            saveData(); // Save changes after resizing
        }
        // ... (rest of finalizeDrags function) ...
    }
    ```

These changes will allow mobile users to add events without leaving the day view and provide top/bottom drag handles for resizing event durations within the mobile day overlay.