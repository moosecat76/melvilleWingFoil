---
name: visual_verification
description: Performs a visual check of the application to ensure it is running and rendering correctly.
---

# Visual Verification Skill

This skill guides the agent to visually verify the "Wind Foil" application is running and functional.

## Prerequisites

- The application text stack is React (Vite).
- Standard port is 5173.

## Instructions

1.  **Check Dev Server**:
    - Use `command_status` or list active terminals to see if `npm run dev` (or similar) is running.
    - If not, start it using `run_command` with `npm run dev` in the background.

2.  **Open Browser**:
    - Use `browser_subagent` (or `open_browser`) to navigate to `http://localhost:5173` (or the port shown in the terminal).

3.  **Visual Checks**:
    - **Header**: Verify the title "Melville Waters" (or current location) is displayed.
    - **Dashboard**:
        - Check that the "Current Conditions" card is visible.
        - Check that the "Best Time to Go" card is visible and shows time blocks.
        - Check that the "7-Day Forecast" chart is rendered.
    - **Journal**:
        - Check that "Session Journal" is visible.
        - Click "+ Add New Gear" (if safe/interactive) or just verify the button exists.

4.  **Reporting**:
    - If all checks pass, report "Visual Verification Passed".
    - If any check fails, describe the visible issue (e.g. "White screen", "Error connection refused", "Component X missing").
