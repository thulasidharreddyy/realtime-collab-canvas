# Real-Time Collaborative Drawing Canvas

A multi-user drawing canvas built with vanilla TypeScript, raw HTML5 2D canvas, and a Node.js WebSocket backend.

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

1. Open `http://localhost:3000` in a browser window.
2. Open a second window (or an incognito tab) at `http://localhost:3000`.
3. **Real-Time Drawing**: Draw with the brush or eraser in Window 1. The stroke renders in Window 2 incrementally as points arrive, rather than waiting for pointer release.
4. **Presence Cursors**: Move the cursor in Window 1. Window 2 shows the colored cursor and name tag updating on the overlay layer.
5. **Global Multi-User Undo / Redo**:
   - Draw a blue stroke in Window 1 (User 1).
   - Draw a red stroke across it in Window 2 (User 2).
   - Press `Ctrl+Z` (or click Undo) in Window 1. The stroke from Window 2 is undone on both windows.
   - Press `Ctrl+Y` (or click Redo) in Window 1 to restore it on both windows.
6. **Room Switching**:
   - Open `http://localhost:3000/?room=design-critique`. Clients only receive events for the room they joined.

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

The frontend is written in vanilla TypeScript using raw DOM APIs and the 2D canvas context—no UI frameworks or canvas libraries (like Fabric or Konva).

- **Canvas rendering**: Strokes are smoothed using midpoint quadratic bezier curves (`quadraticCurveTo`). The eraser uses `destination-out` composite operations so it clears drawn pixels rather than painting white. Resolution is scaled by `devicePixelRatio` on startup and resize to keep lines sharp on high-DPI screens.
- **Layering**: The canvas uses two stacked `<canvas>` elements. The bottom layer holds committed and in-progress strokes. The top layer handles remote cursors and selection overlays at 60fps without clearing or redrawing the drawing buffer.
- **Network streaming**: Local input renders immediately in the `pointermove` handler (client-side prediction). To avoid saturating the socket at high pointer frequencies (120–1000Hz), intermediate points are buffered and flushed once per frame via `requestAnimationFrame`. Cursor position broadcasts are throttled to ~30ms.
- **Ordering and state**: The server assigns each stroke an incrementing sequence number (`seq`) on `stroke_start`. Global undo/redo traverses this shared operation log, marking strokes active or undone (tombstoning) and broadcasting a sync event. Clients replay active strokes in sequence order on undo/redo, keeping canvas state deterministic across browsers.

---

## UI Features

- **Color selection**: 14 curated swatches, a native color picker, and a recent-colors strip that tracks the last 5 selected colors.
- **Stroke width**: Adjustable slider with a dynamic preview circle reflecting the selected diameter.
- **Keyboard shortcuts**: Overlay modal (`?`) listing hotkeys for brush (`B`), eraser (`E`), undo (`Ctrl+Z`), redo (`Ctrl+Y`), zoom (`+`/`-`/`0`), and grid (`G`).
- **View controls**: Bottom-left controls for canvas zoom (25%–300%) and background switching (dots, graph paper, blank).
- **Presence notifications**: Corner toasts announce when collaborators join or leave.
- **Room sharing**: A share dialog with one-click link copying and an inline room switcher.
- **Export**: Generates a PNG export of the artwork on a solid background.

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

### Phase 1: Core Real-Time Engine (~13 hours)
*Covers the real-time drawing mechanics, WebSocket protocol, presence cursors, micro-batching, global undo/redo, conflict resolution, and automated test suite.*
- Canvas Drawing Engine & Smoothing: ~2.5 hours
- WebSocket Protocol & Server State Synchronization: ~2 hours
- Live Presence Cursors & Overlay Layer: ~1.5 hours
- `requestAnimationFrame` Micro-Batching & Throttling: ~1.5 hours
- Global Undo/Redo Operational History & Conflict Resolution: ~3.5 hours
- Testing, Verification Suite & Documentation: ~2 hours

### Phase 2: UI/UX Polish Pass (~3.5 hours)
*Covers the UI overhaul: expanded palette, custom picker, recent colors strip, zoom/grid controls, shortcuts overlay, presence toasts, room-share flow, and responsive styling.*
- Color Palette Expansion, Custom Picker & Recent Colors: ~1 hour
- Canvas Zoom Controls & Grid Paper Toggle: ~0.75 hours
- Keyboard Shortcuts Overlay & Button Micro-Interactions: ~0.5 hours
- Presence Join/Leave Toasts & Cursor Fade Transitions: ~0.5 hours
- Room-Share Modal Hero Flow & Link Copy Animation: ~0.75 hours

**Total Project Time**: ~16.5 hours
