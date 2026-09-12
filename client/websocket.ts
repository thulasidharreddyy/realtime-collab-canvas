import { ClientMessage, ServerMessage, Stroke, Point, User } from '../shared/types.js';

export interface WebSocketClientCallbacks {
  onInitState: (state: {
    userId: string;
    userColor: string;
    userName: string;
    roomId: string;
    users: User[];
    strokes: Stroke[];
  }) => void;
  onUserJoined: (user: User) => void;
  onUserLeft: (userId: string) => void;
  onCursorUpdate: (userId: string, x: number, y: number) => void;
  onRemoteStrokeStart: (stroke: Stroke) => void;
  onRemoteStrokeChunk: (strokeId: string, points: Point[]) => void;
  onRemoteStrokeEnd: (stroke: Stroke) => void;
  onHistorySync: (strokes: Stroke[], undoneCount: number) => void;
  onConnectionChange: (status: 'connected' | 'connecting' | 'disconnected') => void;
  onLatencyUpdate: (latencyMs: number) => void;
}

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private url: string;
  private callbacks: WebSocketClientCallbacks;
  private reconnectAttempts = 0;
  private maxReconnectDelay = 5000;
  private pingIntervalId: number | null = null;
  private isIntentionallyClosed = false;

  // --- Batching & Throttling State ---
  // Micro-batching for stroke points: accumulates points during rapid pointer movements
  private pendingStrokeId: string | null = null;
  private pendingStrokePoints: Point[] = [];
  private batchFlushRafId: number | null = null;

  // Throttling for cursor movement (max ~30-40 updates per second)
  private lastCursorSentTime = 0;
  private pendingCursorPos: { x: number; y: number } | null = null;
  private cursorThrottleMs = 30; // ~33Hz cursor refresh
  private cursorTimerId: number | null = null;

  constructor(callbacks: WebSocketClientCallbacks) {
    this.callbacks = callbacks;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.url = `${protocol}//${window.location.host}`;
  }

  public connect(roomId: string = 'default', name?: string): void {
    this.isIntentionallyClosed = false;
    this.callbacks.onConnectionChange('connecting');

    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.callbacks.onConnectionChange('connected');

        this.send({
          type: 'join',
          roomId,
          name,
        });

        this.startPingLoop();
      };

      this.ws.onmessage = (event) => {
        try {
          const msg: ServerMessage = JSON.parse(event.data);
          this.handleMessage(msg);
        } catch (err) {
          console.error('Failed to parse server message:', err);
        }
      };

      this.ws.onclose = () => {
        this.stopPingLoop();
        this.flushPendingStrokeChunk(); // flush any lingering points
        this.callbacks.onConnectionChange('disconnected');
        if (!this.isIntentionallyClosed) {
          this.scheduleReconnect(roomId, name);
        }
      };

      this.ws.onerror = (err) => {
        console.warn('WebSocket encountered error:', err);
      };
    } catch (err) {
      console.error('WebSocket connection failure:', err);
      this.scheduleReconnect(roomId, name);
    }
  }

  private scheduleReconnect(roomId: string, name?: string): void {
    const delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts), this.maxReconnectDelay);
    this.reconnectAttempts++;
    setTimeout(() => {
      if (!this.isIntentionallyClosed) {
        this.connect(roomId, name);
      }
    }, delay);
  }

  private handleMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case 'init_state':
        this.callbacks.onInitState(msg);
        break;
      case 'user_joined':
        this.callbacks.onUserJoined(msg.user);
        break;
      case 'user_left':
        this.callbacks.onUserLeft(msg.userId);
        break;
      case 'cursor_update':
        this.callbacks.onCursorUpdate(msg.userId, msg.x, msg.y);
        break;
      case 'remote_stroke_start':
        this.callbacks.onRemoteStrokeStart(msg.stroke);
        break;
      case 'remote_stroke_chunk':
        this.callbacks.onRemoteStrokeChunk(msg.strokeId, msg.points);
        break;
      case 'remote_stroke_end':
        this.callbacks.onRemoteStrokeEnd(msg.stroke);
        break;
      case 'history_sync':
        this.callbacks.onHistorySync(msg.strokes, msg.undoneCount);
        break;
      case 'pong': {
        const latency = Date.now() - msg.clientTime;
        this.callbacks.onLatencyUpdate(latency);
        break;
      }
    }
  }

  public send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  /**
   * Helper: Round point coordinates to 1 decimal place to minimize wire payload
   */
  private serializePoint(p: Point): Point {
    return {
      x: Math.round(p.x * 10) / 10,
      y: Math.round(p.y * 10) / 10,
      pressure: p.pressure ? Math.round(p.pressure * 100) / 100 : undefined,
    };
  }

  public sendStrokeStart(stroke: Stroke): void {
    // Flush any leftover batch from a previous stroke
    this.flushPendingStrokeChunk();

    const serializedStroke: Stroke = {
      ...stroke,
      points: stroke.points.map((p) => this.serializePoint(p)),
    };
    this.pendingStrokeId = stroke.id;
    this.send({ type: 'stroke_start', stroke: serializedStroke });
  }

  /**
   * Queue intermediate points into micro-batch.
   * Dispatched on next animation frame (~60fps) to avoid saturating WebSocket.
   */
  public queueStrokePoint(strokeId: string, point: Point): void {
    if (this.pendingStrokeId !== strokeId) {
      this.flushPendingStrokeChunk();
      this.pendingStrokeId = strokeId;
    }

    this.pendingStrokePoints.push(this.serializePoint(point));

    if (this.batchFlushRafId === null) {
      this.batchFlushRafId = requestAnimationFrame(() => {
        this.flushPendingStrokeChunk();
      });
    }
  }

  /**
   * Immediately flush accumulated points over the socket.
   */
  public flushPendingStrokeChunk(): void {
    if (this.batchFlushRafId !== null) {
      cancelAnimationFrame(this.batchFlushRafId);
      this.batchFlushRafId = null;
    }

    if (this.pendingStrokeId && this.pendingStrokePoints.length > 0) {
      this.send({
        type: 'stroke_chunk',
        strokeId: this.pendingStrokeId,
        points: this.pendingStrokePoints,
      });
      this.pendingStrokePoints = [];
    }
  }

  /**
   * Complete stroke: flush remaining points and send stroke_end.
   */
  public sendStrokeEnd(strokeId: string, finalPoints: Point[]): void {
    this.flushPendingStrokeChunk();
    this.pendingStrokeId = null;

    const serialized = finalPoints.map((p) => this.serializePoint(p));
    this.send({ type: 'stroke_end', strokeId, finalPoints: serialized });
  }

  /**
   * Throttled cursor broadcast. Uses 30ms window to prevent socket flooding.
   */
  public sendCursorMove(x: number, y: number): void {
    const now = performance.now();
    const roundedX = Math.round(x * 10) / 10;
    const roundedY = Math.round(y * 10) / 10;

    if (now - this.lastCursorSentTime >= this.cursorThrottleMs) {
      this.lastCursorSentTime = now;
      this.send({ type: 'cursor_move', x: roundedX, y: roundedY });
    } else {
      // Store latest position to emit once throttle interval elapses
      this.pendingCursorPos = { x: roundedX, y: roundedY };
      if (this.cursorTimerId === null) {
        this.cursorTimerId = window.setTimeout(() => {
          this.cursorTimerId = null;
          if (this.pendingCursorPos) {
            this.lastCursorSentTime = performance.now();
            this.send({
              type: 'cursor_move',
              x: this.pendingCursorPos.x,
              y: this.pendingCursorPos.y,
            });
            this.pendingCursorPos = null;
          }
        }, this.cursorThrottleMs - (now - this.lastCursorSentTime));
      }
    }
  }

  public sendUndo(): void {
    this.flushPendingStrokeChunk();
    this.send({ type: 'undo' });
  }

  public sendRedo(): void {
    this.flushPendingStrokeChunk();
    this.send({ type: 'redo' });
  }

  public sendClear(): void {
    this.flushPendingStrokeChunk();
    this.send({ type: 'clear' });
  }

  private startPingLoop(): void {
    this.stopPingLoop();
    this.pingIntervalId = window.setInterval(() => {
      this.send({ type: 'ping', clientTime: Date.now() });
    }, 3000);
  }

  private stopPingLoop(): void {
    if (this.pingIntervalId !== null) {
      clearInterval(this.pingIntervalId);
      this.pingIntervalId = null;
    }
  }

  public disconnect(): void {
    this.isIntentionallyClosed = true;
    this.stopPingLoop();
    this.flushPendingStrokeChunk();
    if (this.ws) {
      this.ws.close();
    }
  }
}
