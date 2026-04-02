## Current Goal

[ ] TASK: When a user taps an event in the mobile day view, the docs pane should slide up
    OVER the day view as an overlay — the day view must stay visible behind it.
    Currently tapping an event closes the day view entirely and opens docs in the main calendar,
    which is wrong. The fix is: do NOT call closeMobileDayView() on event tap. Instead, show
    the docs pane as an overlay on top of the mobile-day-overlay element, with a close/dismiss
    button to hide it again.
