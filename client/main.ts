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

// UI Event Handlers: Colors
function selectColor(hex: string): void {
  engine.color = hex;
  colorCustomInput.value = hex;
  colorCustomPreview.style.backgroundColor = hex;

  colorSwatches.forEach((el) => {
    if (el.getAttribute('data-color') === hex) {
      el.classList.add('active');
    } else {
      el.classList.remove('active');
    }
  });

  if (engine.tool === 'eraser') {
    engine.tool = 'brush';
    toolBrushBtn.classList.add('active');
    toolEraserBtn.classList.remove('active');
  }

  updatePreviewDot();
}

colorSwatches.forEach((swatch) => {
  swatch.addEventListener('click', () => {
    const color = swatch.getAttribute('data-color');
    if (color) selectColor(color);
  });
});

colorCustomInput.addEventListener('input', (e) => {
  const color = (e.target as HTMLInputElement).value;
  selectColor(color);
});

// UI Event Handlers: Stroke Width
function updatePreviewDot(): void {
  const size = engine.strokeWidth;
  strokePreviewDot.style.width = `${Math.min(size, 16)}px`;
  strokePreviewDot.style.height = `${Math.min(size, 16)}px`;
  strokePreviewDot.style.backgroundColor = engine.tool === 'eraser' ? '#94a3b8' : engine.color;
}

strokeSlider.addEventListener('input', (e) => {
  const width = parseInt((e.target as HTMLInputElement).value, 10);
  engine.strokeWidth = width;
  updatePreviewDot();
});

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

// Global Keyboard Shortcuts
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
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
