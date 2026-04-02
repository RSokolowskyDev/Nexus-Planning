# Sentinel Audit: Action Required

[ACTION]
To address Goal 3 in PLAN.md, perform the following steps:

1.  **Increase visibility of lines in Mobile Day View schedule:**
    *   In `index.css`, locate the `.mdo-hour-row` rule.
    *   Modify its `border-bottom` property to make the horizontal lines thicker and more prominent:
        *   Change `border-bottom: 1px solid rgba(255,255,255,0.1);` to `border-bottom: 2px solid rgba(255,255,255,0.2);`
    *   In `index.css`, locate the `.mdo-hour-content` rule.
    *   Modify its `border-left` property to make the vertical lines thicker and more prominent:
        *   Change `border-left: 1px solid rgba(255,255,255,0.15);` to `border-left: 2px solid rgba(255,255,255,0.25);`