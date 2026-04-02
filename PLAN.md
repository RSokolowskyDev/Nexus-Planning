## Current Goals

[ ] TASK: Add a Goals section to the app where users can create, track, and manage their own goals.
    - Goals should be accessible from the main UI (a dedicated panel or section)
    - Each goal should have: a title, optional description, a target date, and a completion status
    - Goals should persist to localStorage (guests) and Firestore (signed-in users), same pattern
      as identities/habits in identity-service.js
    - Completed goals should be visually distinct (strikethrough or checkmark)
    - Goals should be linkable to identities in the Identity Blueprint pane
