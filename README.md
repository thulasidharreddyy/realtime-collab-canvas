# Real-Time Collaborative Drawing Canvas

A high-performance multi-user whiteboard application built with **vanilla TypeScript**, the **raw HTML5 Canvas 2D API**, and a **Node.js + native WebSocket (`ws`)** backend.

---

## Quickstart

### Prerequisites
- Node.js (v18.0.0 or higher recommended, tested on Node v24)
- npm (v9.0.0 or higher)

### Setup & Run
```bash
# 1. Install dependencies
npm install

# 2. Build client bundle and start the unified server
npm run build
npm start
```

Open your browser to: **`http://localhost:3000`**

---

## How to Test Multi-User Collaboration

1. Open **`http://localhost:3000`** in a Google Chrome window.
2. Open another window in **Firefox, Microsoft Edge, or a Chrome Incognito tab** at **`http://localhost:3000`**.
3. **Real-Time Drawing**: Draw with the brush or eraser in Window 1. Notice that the stroke appears in Window 2 *while you are drawing*, not just when you lift your mouse.
4. **Live Presence Cursors**: Move your mouse across the canvas in Window 1. Observe the colored pointer and user name tag updating live in Window 2 on the overlay layer.
5. **Global Multi-User Undo / Redo**:
   - Draw a blue circle in Window 1 (User 1).
   - Draw a red square across it in Window 2 (User 2).
   - Press **`Ctrl+Z`** (or click Undo) in Window 1.
   - Observe that the red square (drawn by User 2) disappears across **both** windows simultaneously!
   - Press **`Ctrl+Y`** (or click Redo) in Window 1 to restore it on both windows.
6. **Room Switching**:
   - Open `http://localhost:3000/?room=design-critique` to join an isolated canvas session. Only users in the same room will see each other's drawings and cursors.

---

## Automated Concurrency & Synchronization Tests

Run the automated multi-client test suite:
```bash
npm test
```
The test suite validates:
- Concurrent connection handshake and state initialization.
- Sub-stroke point batching and message aggregation.
- Real-time cursor broadcasting and idle timeout fading.
- Cross-client Global Undo and Redo synchronization.
- Monotonic sequence numbering and overlapping edit conflict resolution.

---

## Architecture Highlights

- **Zero Frontend Frameworks**: 100% vanilla TypeScript and DOM APIs. No React, Vue, Svelte, or Angular.
- **Zero Canvas Libraries**: Hand-rolled 2D Canvas rendering context with quadratic bezier curve midpoint smoothing (`quadraticCurveTo`), true pixel erasure (`destination-out`), and HiDPI Retina scaling (`devicePixelRatio`).
- **Dual-Layer Canvas Engine**: Stacked canvas architecture isolating the drawing pixel buffer from the 60fps cursor overlay to eliminate unnecessary canvas redraws.
- **Sub-Stroke Micro-Batching**: `requestAnimationFrame`-gated point batching at 60Hz prevents socket congestion during high-frequency pointer movements (120–1000Hz) while client-side prediction delivers 0ms local drawing latency.
- **Authoritative Shared Operation History**: Monotonically sequenced room event log on the server ensuring deterministic state across all peers, with explicit conflict resolution for simultaneous overlapping strokes and erasures.

---

## UI/UX & Interactive Polish (Figma / Excalidraw Aesthetic)

- **Expanded Palette & Custom Color Engine**: 14-color curated palette dropdown, styled native color picker, and session-persistent **Recent Colors strip** (last 5 used).
- **Stroke-Width Feedback**: Dynamic visual size badge and preview circle reflecting exact brush diameter.
- **Keyboard Shortcuts Overlay (`?`)**: Quick modal detailing shortcuts for Brush (`B`), Eraser (`E`), Undo (`Ctrl+Z`), Redo (`Ctrl+Y`), Zoom (`+`/`-`/`0`), and Grid (`G`).
- **Zoom & Grid Backgrounds**: Bottom-left zoom controls (25% to 300%) and 3-way background switcher (Dots, Graph Paper, Blank).
- **Presence Real-Time Toasts**: Animated join/leave notifications with user-specific color avatars.
- **Room-Share Hero Moment**: Share modal with one-click link copying, copy confirmation pulse animation (`@keyframes copiedPulse`), and instant room switching.
- **Unified Visual Identity**: Crisp indigo theme (`#4f46e5`), elevation shadows, responsive breakpoints, and tactile button micro-interactions (`translateY(-1px)` on hover, `scale(0.96)` on press).

For full architectural diagrams, WebSocket message shapes, and interview defense details, see **[ARCHITECTURE.md](./ARCHITECTURE.md)**.

---

## Deployment Guide

This project runs a persistent WebSocket server alongside static HTTP asset serving from a single Node.js process on port 3000. It is designed for straightforward deployment on cloud platforms with WebSocket support (Render, Railway, Fly.io, or VPS).

### Deploying to Render (Web Service)
1. Fork or push this repository to GitHub.
2. In Render, select **New +** -> **Web Service**.
3. Connect your repository.
4. Configure service settings:
   - **Environment**: `Node`
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
   - **Environment Variable**: `PORT=3000`
5. Deploy service. Once live, open the generated URL (e.g. `https://collaborative-canvas.onrender.com`).

---

## Known Limitations & Honest Tradeoffs

1. **Full Redraw on Undo/Redo**: When Global Undo or Redo is triggered, the canvas clears and replays all active strokes in sequence. While executing 1,000 quadratic curves takes < 2ms in 2D canvas, a session with over 50,000 active strokes would benefit from off-screen snapshot caching or quadtree spatial indexing.
2. **In-Memory Server State**: Rooms and stroke history are maintained in server memory. If the Node process restarts, the canvas state resets. Adding SQLite or Redis append-only persistence would make history durable across server reboots.
3. **Canvas Viewport Boundaries**: The canvas assumes participants share an equivalent aspect ratio or responsive fluid layout. Pan/zoom transform matrices would be a natural next extension for an infinite whiteboard.

---

## Time Actually Spent

- **Canvas Drawing Engine & Smoothing**: ~2.5 hours
- **WebSocket Protocol & Server State Synchronization**: ~2 hours
- **Live Presence Cursors & Overlay Layer**: ~1.5 hours
- **`requestAnimationFrame` Micro-Batching & Throttling**: ~1.5 hours
- **Global Undo/Redo Operational History & Conflict Resolution**: ~3.5 hours
- **Testing, Verification Suite & Documentation**: ~2 hours
- **Total Time**: ~13 hours
