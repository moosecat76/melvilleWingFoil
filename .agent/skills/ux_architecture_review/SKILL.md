---
name: ux_architecture_review
description: Inspects implementation plans and built applications to ensure optimal User Experience (UX), Application Architecture, and Information Architecture (IA).
---

# UX and Architecture Review Skill

This skill is designed to ensure that the application's User Experience (UX), Application Architecture, and Information Architecture (IA) are optimized for the user. It operates in two main phases: Planning Review and Built Application Review.

## 1. Planning Phase Review (Forward Planning)

When the user or agent presents an implementation plan (e.g., `implementation_plan.md` or a proposed feature list):

1.  **Analyze the User Goals**: Re-read the initial user request and the stated goals of the plan. Does the proposed solution directly address the user's needs with minimal friction?
2.  **Review Information Architecture (IA)**:
    *   Check the proposed data structure and relationships. Are they logical?
    *   Verify the navigation structure (if specified). Is it intuitive?
    *   Ensure consistent terminology is used across the plan.
3.  **Review User Experience (UX)**:
    *   Walk through the proposed user flows. Are there dead ends or unnecessary steps?
    *   Check for accessibility considerations.
    *   Assess the "Wow Factor" potential. Does the plan include provisions for high-quality visuals and interactions (animations, transitions)?
4.  **Review Application Architecture**:
    *   Evaluate the component hierarchy. Is it modular and reusable?
    *   Check the technology choices (e.g., state management, routing). Are they appropriate for the scale of the app?
5.  **Output**: Provide specific, actionable feedback on the plan. Suggest improvements *before* code is written.

## 2. Built Application Review

When the application or a feature is built (using `list_dir`, `view_file`, or browser tools):

1.  **Visual Inspection**:
    *   Check for visual consistency (colors, typography, spacing).
    *   Verify that the design feels "premium" and "dynamic" (as per the `web_application_development` instructions).
2.  **Functional UX Walkthrough**:
    *   Simulate user actions. does the app respond as expected?
    *   Check for loading states and error handling. The user should never be left wondering what is happening.
3.  **Code Architecture Check**:
    *   Review the actual file structure. consistently naming and organization?
    *   Check actual component code. Is business logic separated from presentation?
4.  **Output**: Create a list of "Polish Tasks" or "Refactoring Tasks" to address any issues found.

## Tools Strategy

*   Use `view_file` to inspect plans (`implementation_plan.md`) and source code.
*   Use `list_dir` to understand the project structure.
*   Use `browser_subagent` (if available) or `read_browser_page` to inspect the running application visually and functionally.

## Goal

The ultimate goal is to act as a "Senior Product Designer" and "Lead Architect" who ensures that what is built is not just functional, but delightful and well-engineered.
