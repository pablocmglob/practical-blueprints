# UI/UX Implementation Specification (T-101-B)

## 1. Canvas Layout & Grid Architecture
The core interface must reflect the standard Practical Experience Blueprint format:
- **Horizontal Axis (X)**: Represents time/sequence. Displays Phases grouped over Steps. Strictly single linear path.
- **Vertical Axis (Y)**: Represents depth (Surface-to-Core). Displays Layer Categories.
- **Grid Intersection**: The intersection of a Step (column) and a Layer Category (row) forms a drop-zone for LayerItems (sticky notes).

## 2. Visual Hierarchy & Heat Mapping
- **Step Visibility**: Visually distinguish Frontstage (visible) steps with a light/white background and Backstage (hidden) steps with a dark background.
- **Color-Coding**: Enforce strict color-coding for LayerItems (e.g., Roles = Green, Touchpoints = Blue, Policies = Orange, Critical Moments = Red, Opportunities = Yellow). 
- **Dynamic Heat Mapping**: As items stack vertically under a single step, the UI should naturally expand the column. Steps with deep backend dependencies or numerous critical moments will visually protrude, creating an instant "heat map" of operational complexity.

## 3. Checklist-Driven Input
- The left-hand sticky sidebar must list the Layer Categories as a prompt/checklist. 
- When a user selects a Step, the UI should offer an inline prompt mapped to the layer taxonomy (e.g., "What systems are required here?" -> Technology, "What rules govern this?" -> Policy) to guide comprehensive data entry.
- **Input Constraints**: All sticky notes (including Touchpoints) are text-only. The UI must not support file uploads, image attachments, or media blobs.

## 4. Strict Linearity
- The UI must enforce a single continuous storyline. No branching UI, process mapping graphs, or variant toggling is permitted on the canvas. If concurrent events occur, users must arrange them sequentially left-to-right.
