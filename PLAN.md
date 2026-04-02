## Current Goals

[ ] TASK: Fix event drag-to-move in mobile day view so it feels smooth and responsive.
    - The hold threshold (currently 150ms) should use a visual feedback cue (e.g. subtle scale/glow)
      to confirm the drag has activated before the user moves their finger
    - During drag, the event should follow the finger in real time with no jitter
    - Use requestAnimationFrame to throttle DOM updates during touchmove for smooth 60fps movement
    - On release, snap to nearest 30-minute slot with a brief spring/ease transition

[ ] TASK: Fix resize handles (top and bottom bars) on events in the mobile day view.
    - Top handle: dragging up/down shifts the start time, keeping end time fixed
    - Bottom handle: dragging up/down changes the duration, keeping start time fixed
    - Both handles must initialize item.dailyTimes[dayOff] if it doesn't exist yet
      (recurring events fail silently because dailyTimes[dayOff] is undefined — this is the current bug)
    - Use requestAnimationFrame during touchmove for smooth resize feedback
    - Snap to 30-minute intervals on release

[ ] TASK: Make the mdo-doc-panel (the event detail sheet that slides up when tapping an event)
    resizable by dragging the handle pill at the top.
    - Dragging the handle pill upward should expand the panel (max 90vh)
    - Dragging downward should shrink it (min ~120px, below which it dismisses with animation)
    - Use the same delta-from-start-position technique used in the main docs pane resize
      (record startY and startHeight at touchstart, compute newH = startHeight + (startY - currentY))
    - The resize should be smooth and not use window.innerHeight as an absolute reference
    - Add a galaxy background to everything, this should be simple yet modern and attractive

## Research Notes for Gemini Architect
When implementing touch drag interactions on mobile web, best practices include:
- Use touch-action: none on draggable elements to prevent scroll interference
- Call e.preventDefault() in touchmove handlers (requires passive: false)
- Use requestAnimationFrame to batch DOM writes and avoid layout thrashing
- Track pointerId or touch identifier to handle multi-touch correctly
- Apply will-change: transform to elements being animated for GPU compositing