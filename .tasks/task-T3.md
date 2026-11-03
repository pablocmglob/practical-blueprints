# T3 — Frontend canvas UI (T-101-B)

State: In Progress
Owner: ux-implementer (worktree `coda/ui-canvas`)
Created: 2026-11-03
Spec: `docs/implementation/ui_spec.md` (strict architectural guideline)

## Brief

Build the web canvas per `docs/implementation/ui_spec.md`:

- **Grid**: X = time/sequence (phases over steps, single linear path);
  Y = depth (layer categories as rows). Step-column × category-row
  intersections are drop-zones for text sticky notes.
- **Visuals**: frontstage steps light background, backstage dark;
  strict color-coding (Roles=Green, Touchpoints=Blue, Policies=Orange,
  Critical Moments=Red, Opportunities=Yellow, plus the rest of the
  taxonomy); columns expand as items stack → natural heat map.
- **Checklist sidebar**: left sidebar lists layer categories as a
  prompt/checklist; selecting a step offers inline prompts mapped to the
  taxonomy ("What systems are required here?" → Technology, etc.).
- **Text-only**: no file upload, image attachment, or media blob input
  anywhere; drag-drop of non-text must be rejected with a clear message.
- **Linearity**: no branching UI, graphs, or variant toggling; concurrent
  events are arranged left-to-right.
- **Live updates**: consume the backend SSE stream so MCP-injected items
  appear without refresh.

## Done when

- UI served by the backend (static) and usable against the live API.
- All spec sections implemented; overflow handled by scrolling with
  sticky headers/row labels (QA T4 extreme-load case passes).
- Behaviour reference updated in the same change.
