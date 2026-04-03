## Current Goals


[]Add a galaxy background to everything, this should be simple yet modern and attractive, there should be stars, galaxies, etc. The galaxy stays stationary even if everything else moves.

[ ] TASK: When an event is selected in the mobile day view, show a duration-drag affordance
    that aligns with the selection highlight border.
    - When selected, render a drag zone at the bottom edge of the event (inside the highlight border)
      showing a visible handle — e.g. a pill/bar with a resize cursor icon or double-arrow symbol
    - Dragging this zone up/down changes the event duration in real time (same logic as bottom
      resize handle, but triggered from this new UI element rather than a thin top/bottom bar)
    - The affordance should only appear when the event is selected (state.selectedItemIds includes
      the item id), so it doesn't clutter unselected events
    - On release, snap duration to nearest 30-minute interval and save

## Research Notes for Gemini Architect
When implementing touch drag interactions on mobile web, best practices include:
- Use touch-action: none on draggable elements to prevent scroll interference
- Call e.preventDefault() in touchmove handlers (requires passive: false)
- Use requestAnimationFrame to batch DOM writes and avoid layout thrashing
- Track pointerId or touch identifier to handle multi-touch correctly
- Apply will-change: transform to elements being animated for GPU compositing