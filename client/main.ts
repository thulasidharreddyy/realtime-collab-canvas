import { CanvasEngine } from './canvas.js';
import { WebSocketClient } from './websocket.js';
import { Stroke, Point, User } from '../shared/types.js';

// DOM Elements
const container = document.getElementById('canvas-container') as HTMLElement;
const toolBrushBtn = document.getElementById('tool-brush') as HTMLButtonElement;
const toolEraserBtn = document.getElementById('tool-eraser') as HTMLButtonElement;
const colorSwatches = document.querySelectorAll('.color-swatch');
const colorCustomInput = document.getElementById('color-custom') as HTMLInputElement;
const colorCustomPreview = document.getElementById('color-custom-preview') as HTMLElement;
const strokeSlider = document.getElementById('stroke-slider') as HTMLInputElement;
const strokePreviewDot = document.getElementById('stroke-preview-dot') as HTMLElement;
const undoBtn = document.getElementById('btn-undo') as HTMLButtonElement;
const redoBtn = document.getElementById('btn-redo') as HTMLButtonElement;
const clearBtn = document.getElementById('btn-clear') as HTMLButtonElement;
const usersList = document.getElementById('users-list') as HTMLElement;
const statusDot = document.getElementById('status-dot') as HTMLElement;
const statusText = document.getElementById('status-text') as HTMLElement;
const roomDisplay = document.getElementById('room-display') as HTMLElement;
const statPing = document.getElementById('stat-ping') as HTMLElement;
const statStrokes = document.getElementById('stat-strokes') as HTMLElement;

// State
let currentRoomId = new URLSearchParams(window.location.search).get('room') || 'default';
roomDisplay.textContent = `room: ${currentRoomId}`;

let activeUsers: Map<string, User> = new Map();
let currentUserId = '';
let roomStrokes: Stroke[] = [];

// WebSocket Client declaration
let wsClient: WebSocketClient;

// Initialize Canvas Engine
export const engine = new CanvasEngine({
  container,
  onStrokeStart: (stroke) => {
    if (wsClient) {
      wsClient.sendStrokeStart(stroke);
    }
  },
  onStrokeChunk: (strokeId, points) => {
    if (wsClient) {
      for (const pt of points) {
        wsClient.queueStrokePoint(strokeId, pt);
      }
    }
  },
  onStrokeEnd: (strokeId, finalPoints) => {
    if (wsClient) {
      wsClient.sendStrokeEnd(strokeId, finalPoints);
    }
  },
  onPointerMove: (point) => {
    if (wsClient) {
      wsClient.sendCursorMove(point.x, point.y);
    }
  },
});

let currentUndoneCount = 0;

function updateStrokeCount(undoneCount?: number): void {
  if (undoneCount !== undefined) {
    currentUndoneCount = undoneCount;
  }
  const activeCount = roomStrokes.filter((s) => s.status === 'active').length;
  statStrokes.textContent = `${activeCount} strokes`;
  undoBtn.disabled = activeCount === 0;
  redoBtn.disabled = currentUndoneCount === 0;
}

function renderUsersList(): void {
  usersList.innerHTML = '';
  activeUsers.forEach((user) => {
    const badge = document.createElement('div');
    badge.className = `user-badge ${user.id === currentUserId ? 'current-user' : ''}`;

    const dot = document.createElement('span');
    dot.className = 'user-dot';
    dot.style.backgroundColor = user.color;

    const nameSpan = document.createElement('span');
    nameSpan.textContent = user.id === currentUserId ? `${user.name} (You)` : user.name;

    badge.appendChild(dot);
    badge.appendChild(nameSpan);
    usersList.appendChild(badge);
  });
}

// Instantiate and Connect WebSocket Client
wsClient = new WebSocketClient({
  onInitState: (state) => {
    currentUserId = state.userId;
    engine.userId = state.userId;

    // Set initial user color assigned by server
    selectColor(state.userColor);

    // Populate active users
    activeUsers.clear();
    state.users.forEach((u) => activeUsers.set(u.id, u));
    renderUsersList();
    engine.updateRemoteUsers(activeUsers);

    // Load initial room strokes onto canvas
    roomStrokes = state.strokes;
    engine.redrawAll(roomStrokes);
    updateStrokeCount();
  },

  onUserJoined: (user) => {
    activeUsers.set(user.id, user);
    renderUsersList();
    engine.updateRemoteUsers(activeUsers);
  },

  onUserLeft: (userId) => {
    activeUsers.delete(userId);
    renderUsersList();
    engine.updateRemoteUsers(activeUsers);
  },

  onCursorUpdate: (userId, x, y) => {
    const user = activeUsers.get(userId);
    if (user) {
      user.cursor = { x, y };
      user.lastActive = Date.now();
      engine.updateRemoteUsers(activeUsers);
    }
  },

  onRemoteStrokeStart: (stroke) => {
    roomStrokes.push(stroke);
    engine.handleRemoteStrokeStart(stroke);
    updateStrokeCount();
  },

  onRemoteStrokeChunk: (strokeId, points) => {
    engine.handleRemoteStrokeChunk(strokeId, points);
  },

  onRemoteStrokeEnd: (stroke) => {
    const existing = roomStrokes.find((s) => s.id === stroke.id);
    if (existing) {
      existing.points = stroke.points;
    }
    engine.handleRemoteStrokeEnd(stroke.id, stroke.points);
  },

  onHistorySync: (strokes, undoneCount) => {
    roomStrokes = strokes;
    engine.redrawAll(roomStrokes);
    updateStrokeCount(undoneCount);
  },

  onConnectionChange: (status) => {
    statusDot.className = `status-dot ${status !== 'connected' ? status : ''}`;
    statusText.textContent =
      status === 'connected'
        ? 'Connected'
        : status === 'connecting'
        ? 'Connecting...'
        : 'Disconnected';
  },

  onLatencyUpdate: (latencyMs) => {
    statPing.textContent = `${latencyMs} ms`;
  },
});

wsClient.connect(currentRoomId);

// UI Event Handlers: Tools
toolBrushBtn.addEventListener('click', () => {
  engine.tool = 'brush';
  toolBrushBtn.classList.add('active');
  toolEraserBtn.classList.remove('active');
  updatePreviewDot();
});

toolEraserBtn.addEventListener('click', () => {
  engine.tool = 'eraser';
  toolEraserBtn.classList.add('active');
  toolBrushBtn.classList.remove('active');
  updatePreviewDot();
});

// Color Popover & Custom Picker Elements
const btnColorPopover = document.getElementById('btn-color-popover') as HTMLButtonElement;
const colorPopover = document.getElementById('color-popover') as HTMLElement;
const colorActiveCircle = document.getElementById('color-active-circle') as HTMLElement;
const recentColorsGrid = document.getElementById('recent-colors-grid') as HTMLElement;

// Recent Colors State (Session memory, up to 5 colors)
let recentColors: string[] = ['#2563eb', '#ef4444', '#10b981', '#f59e0b', '#0f172a'];

function renderRecentColors(): void {
  if (!recentColorsGrid) return;
  recentColorsGrid.innerHTML = '';
  if (recentColors.length === 0) {
    recentColorsGrid.innerHTML = '<span class="recent-empty-hint">No colors used yet</span>';
    return;
  }

  recentColors.forEach((color) => {
    const swatch = document.createElement('div');
    swatch.className = `color-swatch ${color === engine.color ? 'active' : ''}`;
    swatch.style.backgroundColor = color;
    swatch.setAttribute('data-color', color);
    swatch.title = `Recent: ${color}`;
    swatch.addEventListener('click', (e) => {
      e.stopPropagation();
      selectColor(color);
    });
    recentColorsGrid.appendChild(swatch);
  });
}

function addToRecentColors(hex: string): void {
  const norm = hex.toLowerCase();
  recentColors = [norm, ...recentColors.filter((c) => c.toLowerCase() !== norm)].slice(0, 5);
  renderRecentColors();
}

// UI Event Handlers: Colors
function selectColor(hex: string): void {
  engine.color = hex;
  if (colorCustomInput) colorCustomInput.value = hex;
  if (colorActiveCircle) colorActiveCircle.style.backgroundColor = hex;

  // Highlight all matching swatches across quick-swatches and curated palette
  document.querySelectorAll('.color-swatch').forEach((el) => {
    if (el.getAttribute('data-color')?.toLowerCase() === hex.toLowerCase()) {
      el.classList.add('active');
    } else {
      el.classList.remove('active');
    }
  });

  addToRecentColors(hex);

  if (engine.tool === 'eraser') {
    engine.tool = 'brush';
    toolBrushBtn.classList.add('active');
    toolEraserBtn.classList.remove('active');
  }

  updatePreviewDot();
}

// Bind all initial static swatches (quick-swatches and curated palette)
function bindPaletteSwatches(): void {
  document.querySelectorAll('.color-swatch').forEach((swatch) => {
    swatch.addEventListener('click', (e) => {
      e.stopPropagation();
      const color = swatch.getAttribute('data-color');
      if (color) selectColor(color);
    });
  });
}
bindPaletteSwatches();

// Custom Color Input Event
if (colorCustomInput) {
  colorCustomInput.addEventListener('input', (e) => {
    const color = (e.target as HTMLInputElement).value;
    selectColor(color);
  });
  colorCustomInput.addEventListener('change', (e) => {
    const color = (e.target as HTMLInputElement).value;
    selectColor(color);
  });
}

// Popover Toggle & Click Outside Handler
if (btnColorPopover && colorPopover) {
  btnColorPopover.addEventListener('click', (e) => {
    e.stopPropagation();
    const isClosed = colorPopover.classList.contains('hidden');
    if (isClosed) {
      colorPopover.classList.remove('hidden');
      btnColorPopover.classList.add('active');
    } else {
      colorPopover.classList.add('hidden');
      btnColorPopover.classList.remove('active');
    }
  });

  document.addEventListener('click', (e) => {
    const target = e.target as Node;
    if (!colorPopover.contains(target) && !btnColorPopover.contains(target)) {
      colorPopover.classList.add('hidden');
      btnColorPopover.classList.remove('active');
    }
  });
}

renderRecentColors();

// UI Event Handlers: Stroke Width
const strokeValBadge = document.getElementById('stroke-val-badge') as HTMLElement;

function updatePreviewDot(): void {
  const size = engine.strokeWidth;
  strokePreviewDot.style.width = `${Math.min(size, 18)}px`;
  strokePreviewDot.style.height = `${Math.min(size, 18)}px`;
  strokePreviewDot.style.backgroundColor = engine.tool === 'eraser' ? '#94a3b8' : engine.color;
  if (strokeValBadge) {
    strokeValBadge.textContent = `${size}px`;
  }
}

strokeSlider.addEventListener('input', (e) => {
  const width = parseInt((e.target as HTMLInputElement).value, 10);
  engine.strokeWidth = width;
  updatePreviewDot();
});

// Shortcuts Modal Elements
const btnShortcuts = document.getElementById('btn-shortcuts') as HTMLButtonElement;
const shortcutsModal = document.getElementById('shortcuts-modal') as HTMLElement;
const btnCloseShortcuts = document.getElementById('btn-close-shortcuts') as HTMLButtonElement;

function toggleShortcutsModal(show?: boolean): void {
  if (!shortcutsModal) return;
  const isHidden = shortcutsModal.classList.contains('hidden');
  const shouldOpen = show !== undefined ? show : isHidden;
  if (shouldOpen) {
    shortcutsModal.classList.remove('hidden');
  } else {
    shortcutsModal.classList.add('hidden');
  }
}

if (btnShortcuts) {
  btnShortcuts.addEventListener('click', () => toggleShortcutsModal(true));
}
if (btnCloseShortcuts) {
  btnCloseShortcuts.addEventListener('click', () => toggleShortcutsModal(false));
}
if (shortcutsModal) {
  shortcutsModal.addEventListener('click', (e) => {
    if (e.target === shortcutsModal) toggleShortcutsModal(false);
  });
}

// Undo / Redo buttons dispatch to WebSocket server
undoBtn.addEventListener('click', () => {
  wsClient.sendUndo();
});

redoBtn.addEventListener('click', () => {
  wsClient.sendRedo();
});

clearBtn.addEventListener('click', () => {
  wsClient.sendClear();
});

// Export Canvas Artwork as PNG
const exportBtn = document.getElementById('btn-export') as HTMLButtonElement;
if (exportBtn) {
  exportBtn.addEventListener('click', () => {
    const dataUrl = engine.exportAsDataUrl();
    if (dataUrl) {
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `whiteboard-${currentRoomId}-${Date.now()}.png`;
      a.click();
    }
  });
}

// Room Switching and Share Link
roomDisplay.addEventListener('click', () => {
  const currentUrl = window.location.href;
  const target = prompt(
    `Current Room Link:\n${currentUrl}\n\nEnter a new room name to join, or click Cancel:`,
    currentRoomId
  );
  if (target && target.trim() && target.trim() !== currentRoomId) {
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set('room', target.trim());
    window.location.href = nextUrl.toString();
  }
});

// FPS Counter Loop
const statFps = document.getElementById('stat-fps') as HTMLElement;
let frameCount = 0;
let lastFpsTime = performance.now();

function updateFps(now: number): void {
  frameCount++;
  if (now - lastFpsTime >= 1000) {
    const fps = Math.round((frameCount * 1000) / (now - lastFpsTime));
    if (statFps) {
      statFps.textContent = `${fps} FPS`;
    }
    frameCount = 0;
    lastFpsTime = now;
  }
  requestAnimationFrame(updateFps);
}
requestAnimationFrame(updateFps);

// View Controls: Zoom & Grid Paper Toggle
const btnZoomIn = document.getElementById('btn-zoom-in') as HTMLButtonElement;
const btnZoomOut = document.getElementById('btn-zoom-out') as HTMLButtonElement;
const btnZoomReset = document.getElementById('btn-zoom-reset') as HTMLButtonElement;
const btnToggleGrid = document.getElementById('btn-toggle-grid') as HTMLButtonElement;
const gridModeText = document.getElementById('grid-mode-text') as HTMLElement;

function updateZoomDisplay(val: number): void {
  if (btnZoomReset) {
    btnZoomReset.textContent = `${Math.round(val * 100)}%`;
  }
}

if (btnZoomIn) {
  btnZoomIn.addEventListener('click', () => {
    const next = engine.setZoom(engine.zoom + 0.15);
    updateZoomDisplay(next);
  });
}

if (btnZoomOut) {
  btnZoomOut.addEventListener('click', () => {
    const next = engine.setZoom(engine.zoom - 0.15);
    updateZoomDisplay(next);
  });
}

if (btnZoomReset) {
  btnZoomReset.addEventListener('click', () => {
    const next = engine.setZoom(1.0);
    updateZoomDisplay(next);
  });
}

// Grid Paper Modes: 'dots' | 'lines' | 'blank'
type GridMode = 'dots' | 'lines' | 'blank';
let currentGridMode: GridMode = 'dots';
container.classList.add('grid-dots');

function cycleGridMode(): void {
  container.classList.remove('grid-dots', 'grid-lines', 'grid-blank');
  if (currentGridMode === 'dots') {
    currentGridMode = 'lines';
    container.classList.add('grid-lines');
    if (gridModeText) gridModeText.textContent = 'Grid: Lines';
  } else if (currentGridMode === 'lines') {
    currentGridMode = 'blank';
    container.classList.add('grid-blank');
    if (gridModeText) gridModeText.textContent = 'Grid: Blank';
  } else {
    currentGridMode = 'dots';
    container.classList.add('grid-dots');
    if (gridModeText) gridModeText.textContent = 'Grid: Dots';
  }
}

if (btnToggleGrid) {
  btnToggleGrid.addEventListener('click', cycleGridMode);
}

// Global Keyboard Shortcuts
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
    return;
  }

  // Close modals on Escape
  if (e.key === 'Escape') {
    toggleShortcutsModal(false);
    if (colorPopover) colorPopover.classList.add('hidden');
    if (btnColorPopover) btnColorPopover.classList.remove('active');
    return;
  }

  // Toggle shortcuts help with '?'
  if (e.key === '?' || (e.shiftKey && e.key === '/')) {
    e.preventDefault();
    toggleShortcutsModal();
    return;
  }

  // Zoom shortcuts
  if (e.key === '+' || e.key === '=') {
    e.preventDefault();
    btnZoomIn?.click();
    return;
  }
  if (e.key === '-' || e.key === '_') {
    e.preventDefault();
    btnZoomOut?.click();
    return;
  }
  if (e.key === '0') {
    e.preventDefault();
    btnZoomReset?.click();
    return;
  }

  // Grid toggle shortcut
  if (e.key === 'g' || e.key === 'G') {
    e.preventDefault();
    cycleGridMode();
    return;
  }

  if (e.key === 'b' || e.key === 'B') {
    toolBrushBtn.click();
  } else if (e.key === 'e' || e.key === 'E') {
    toolEraserBtn.click();
  }

  if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
    e.preventDefault();
    undoBtn.click();
  }

  if (
    ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) ||
    ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'z' || e.key === 'Z'))
  ) {
    e.preventDefault();
    redoBtn.click();
  }
});

// Initial visual setup
updatePreviewDot();
updateStrokeCount();
