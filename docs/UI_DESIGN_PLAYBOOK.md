# WhisperClick UI Design Playbook

## Purpose

Use this playbook to keep UI decisions intentional and consistent.
Every change should improve clarity, hierarchy, and usability.

## Core Principles

1. One primary action per screen.
2. Strong visual hierarchy: primary, secondary, tertiary.
3. Prefer calm density over empty space.
4. Keep state changes obvious (idle, recording, processing, done).
5. Remove decorative elements that do not improve comprehension.

## Layout Rules

1. Use an 8px spacing scale (`4, 8, 12, 16, 24, 32`).
2. Group related controls in visible containers.
3. Keep top toolbar compact and functional.
4. Keep the recording area as the visual anchor.
5. Avoid stacked center piles unless they communicate one flow.

## Control Rules

1. Primary action button should be clearly dominant but not oversized.
2. Secondary controls should never compete with the primary action.
3. Inputs and dropdowns should have stable width and truncation behavior.
4. Interactive states must be visible: `hover`, `active`, `open`, `disabled`.
5. Close buttons and window controls must appear anchored to a control group.

## Typography Rules

1. Labels: small uppercase or muted helper style.
2. Live values (timer/status): larger and high contrast.
3. Body text: readable line-height, no oversized blocks.
4. Keep no more than 3 visual text tiers on one panel.

## Motion Rules

1. Use motion for state feedback, not decoration.
2. Duration bands:
   - micro interactions: `120-180ms`
   - panel transitions: `200-280ms`
   - status pulses: `1200-1800ms`
3. Avoid multiple competing animations in the same area.

## Recording Area Contract

1. Must show:
   - clear primary record control
   - live state label
   - timer
   - voice activity visualization
2. State behavior:
   - `IDLE`: subtle, low-energy visualizer
   - `RECORDING`: highest visual emphasis
   - `PROCESSING`: reduced control emphasis, clear progress status
   - `DONE`: return to neutral with result focus
3. Pass/fail checks:
   - user can identify current state in under 1 second
   - primary action is unambiguous
   - no overlapping visual hierarchy conflicts

## Accessibility Baseline

1. Minimum text contrast: WCAG AA.
2. Keyboard focus must remain visible.
3. Click targets should be at least `36x36` for desktop.
4. State should not rely on color only.

## Review Checklist (Run Before Merge)

1. What is the single primary action on this view?
2. Do spacing and alignment follow the same rhythm?
3. Are state transitions understandable without explanation?
4. Are any elements visually floating without structural anchor?
5. Is the design simpler than before?
