import { Point, Stroke, ToolType, User } from '../shared/types.js';

export interface CanvasEngineOptions {
  container: HTMLElement;
  onStrokeStart?: (stroke: Stroke) => void;
  onStrokeChunk?: (strokeId: string, points: Point[]) => void;
  onStrokeEnd?: (strokeId: string, finalPoints: Point[]) => void;
  onPointerMove?: (point: Point) => void;
}

export class CanvasEngine {
  private container: HTMLElement;
  public drawCanvas: HTMLCanvasElement;
  public overlayCanvas: HTMLCanvasElement;
  public drawCtx: CanvasRenderingContext2D;
  public overlayCtx: CanvasRenderingContext2D;

  private dpr: number = 1;
  public width: number = 0;
  public height: number = 0;

  // Active local drawing state
  private isDrawing: boolean = false;
  private currentStroke: Stroke | null = null;
  private currentPoints: Point[] = [];
  private activePointerId: number | null = null;

  // Tool settings
  public tool: ToolType = 'brush';
  public color: string = '#2563eb'; // Default blue
  public strokeWidth: number = 4;
  public userId: string = 'local-user';

  // Remote strokes in progress: strokeId -> array of points rendered so far
  private remoteInflightStrokes: Map<string, { stroke: Stroke; lastRenderedIndex: number }> = new Map();

  // Remote presence cursors
  private remoteUsers: Map<string, User> = new Map();
  private animFrameId: number | null = null;

  // Callbacks for networking
  public onStrokeStart?: (stroke: Stroke) => void;
  public onStrokeChunk?: (strokeId: string, points: Point[]) => void;
  public onStrokeEnd?: (strokeId: string, finalPoints: Point[]) => void;
  public onPointerMove?: (point: Point) => void;

  constructor(options: CanvasEngineOptions) {
    this.container = options.container;
    this.onStrokeStart = options.onStrokeStart;
    this.onStrokeChunk = options.onStrokeChunk;
    this.onStrokeEnd = options.onStrokeEnd;
    this.onPointerMove = options.onPointerMove;

    // Layer 1: Persistent drawing canvas
    this.drawCanvas = document.createElement('canvas');
    this.drawCanvas.className = 'canvas-layer draw-layer';

    // Layer 2: Transparent overlay canvas for remote cursors and annotations
    this.overlayCanvas = document.createElement('canvas');
    this.overlayCanvas.className = 'canvas-layer overlay-layer';

    this.container.appendChild(this.drawCanvas);
    this.container.appendChild(this.overlayCanvas);

    const drawCtx = this.drawCanvas.getContext('2d', { alpha: true });
    const overlayCtx = this.overlayCanvas.getContext('2d', { alpha: true });

    if (!drawCtx || !overlayCtx) {
      throw new Error('Failed to acquire 2D canvas rendering context.');
    }

    this.drawCtx = drawCtx;
    this.overlayCtx = overlayCtx;

    this.resize();
    this.initEventListeners();
    this.startCursorRenderLoop();
  }

  public resize(): void {
    const rect = this.container.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.width = Math.floor(rect.width);
    this.height = Math.floor(rect.height);

    this.drawCanvas.width = Math.floor(this.width * this.dpr);
    this.drawCanvas.height = Math.floor(this.height * this.dpr);
    this.overlayCanvas.width = Math.floor(this.width * this.dpr);
    this.overlayCanvas.height = Math.floor(this.height * this.dpr);

    this.drawCanvas.style.width = `${this.width}px`;
    this.drawCanvas.style.height = `${this.height}px`;
    this.overlayCanvas.style.width = `${this.width}px`;
    this.overlayCanvas.style.height = `${this.height}px`;

    this.drawCtx.resetTransform();
    this.drawCtx.scale(this.dpr, this.dpr);

    this.overlayCtx.resetTransform();
    this.overlayCtx.scale(this.dpr, this.dpr);

    this.setupContextDefaults(this.drawCtx);
    this.setupContextDefaults(this.overlayCtx);
  }

  private setupContextDefaults(ctx: CanvasRenderingContext2D): void {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }

  private initEventListeners(): void {
    this.overlayCanvas.addEventListener('pointerdown', this.handlePointerDown.bind(this));
    this.overlayCanvas.addEventListener('pointermove', this.handlePointerMove.bind(this));
    this.overlayCanvas.addEventListener('pointerup', this.handlePointerUp.bind(this));
    this.overlayCanvas.addEventListener('pointercancel', this.handlePointerCancel.bind(this));

    window.addEventListener('resize', () => {
      this.resize();
    });
  }

  public getCanvasPoint(e: PointerEvent): Point {
    const rect = this.overlayCanvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      pressure: e.pressure > 0 ? e.pressure : 0.5,
    };
  }

  private handlePointerDown(e: PointerEvent): void {
    // Prevent default touch gesture behaviors like pull-to-refresh or page bounce
    if (e.pointerType === 'touch' || e.pointerType === 'pen') {
      e.preventDefault();
    }

    if (e.button !== 0 && e.pointerType === 'mouse') return;

    this.activePointerId = e.pointerId;
    this.overlayCanvas.setPointerCapture(e.pointerId);

    const point = this.getCanvasPoint(e);
    this.isDrawing = true;
    this.currentPoints = [point];

    const strokeId = `${this.userId}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    this.currentStroke = {
      id: strokeId,
      userId: this.userId,
      tool: this.tool,
      color: this.color,
      width: this.strokeWidth,
      points: [point],
      status: 'active',
      timestamp: Date.now(),
    };

    this.drawDot(this.drawCtx, point, this.color, this.strokeWidth, this.tool);

    if (this.onStrokeStart) {
      this.onStrokeStart(this.currentStroke);
    }
  }

  private handlePointerMove(e: PointerEvent): void {
    const point = this.getCanvasPoint(e);

    // Stream cursor position
    if (this.onPointerMove) {
      this.onPointerMove(point);
    }

    if (!this.isDrawing || !this.currentStroke) return;

    const lastPoint = this.currentPoints[this.currentPoints.length - 1];
    if (lastPoint && lastPoint.x === point.x && lastPoint.y === point.y) {
      return;
    }

    this.currentPoints.push(point);
    this.currentStroke.points.push(point);

    this.renderIncrementalSegment(
      this.drawCtx,
      this.currentPoints,
      this.currentStroke.color,
      this.currentStroke.width,
      this.currentStroke.tool
    );

    if (this.onStrokeChunk) {
      this.onStrokeChunk(this.currentStroke.id, [point]);
    }
  }

  private handlePointerUp(e: PointerEvent): void {
    if (!this.isDrawing || !this.currentStroke) return;
    if (this.activePointerId !== null && e.pointerId !== this.activePointerId) return;

    const point = this.getCanvasPoint(e);
    if (this.currentPoints.length > 0) {
      const lastPoint = this.currentPoints[this.currentPoints.length - 1];
      if (lastPoint.x !== point.x || lastPoint.y !== point.y) {
        this.currentPoints.push(point);
        this.currentStroke.points.push(point);
      }
    }

    if (this.onStrokeEnd) {
      this.onStrokeEnd(this.currentStroke.id, this.currentPoints);
    }

    this.isDrawing = false;
    this.currentStroke = null;
    this.currentPoints = [];
    this.activePointerId = null;

    try {
      this.overlayCanvas.releasePointerCapture(e.pointerId);
    } catch {
      // Ignored if capture lost
    }
  }

  private handlePointerCancel(e: PointerEvent): void {
    this.handlePointerUp(e);
  }

  private drawDot(
    ctx: CanvasRenderingContext2D,
    point: Point,
    color: string,
    width: number,
    tool: ToolType
  ): void {
    ctx.save();
    if (tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0,0,0,1)';
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = color;
    }

    ctx.beginPath();
    ctx.arc(point.x, point.y, width / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private renderIncrementalSegment(
    ctx: CanvasRenderingContext2D,
    points: Point[],
    color: string,
    width: number,
    tool: ToolType
  ): void {
    const len = points.length;
    if (len < 2) return;

    ctx.save();
    this.setupContextDefaults(ctx);

    if (tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = color;
    }
    ctx.lineWidth = width;

    if (len === 2) {
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      ctx.lineTo(points[1].x, points[1].y);
      ctx.stroke();
    } else {
      const p0 = points[len - 3];
      const p1 = points[len - 2];
      const p2 = points[len - 1];

      const mid1 = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
      const mid2 = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };

      ctx.beginPath();
      ctx.moveTo(mid1.x, mid1.y);
      ctx.quadraticCurveTo(p1.x, p1.y, mid2.x, mid2.y);
      ctx.stroke();
    }

    ctx.restore();
  }

  public renderCompleteStroke(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
    const pts = stroke.points;
    if (pts.length === 0) return;

    if (pts.length === 1) {
      this.drawDot(ctx, pts[0], stroke.color, stroke.width, stroke.tool);
      return;
    }

    ctx.save();
    this.setupContextDefaults(ctx);

    if (stroke.tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = stroke.color;
    }
    ctx.lineWidth = stroke.width;

    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);

    if (pts.length === 2) {
      ctx.lineTo(pts[1].x, pts[1].y);
    } else {
      for (let i = 1; i < pts.length - 1; i++) {
        const midX = (pts[i].x + pts[i + 1].x) / 2;
        const midY = (pts[i].y + pts[i + 1].y) / 2;
        ctx.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY);
      }
      const last = pts[pts.length - 1];
      ctx.lineTo(last.x, last.y);
    }

    ctx.stroke();
    ctx.restore();
  }

  public redrawAll(strokes: Stroke[]): void {
    this.drawCtx.clearRect(0, 0, this.width, this.height);

    // Authoritative Conflict Resolution: deterministic replay in ascending server sequence order
    const canonicalOrder = [...strokes].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));

    for (const stroke of canonicalOrder) {
      if (stroke.status === 'active') {
        this.renderCompleteStroke(this.drawCtx, stroke);
      }
    }
  }

  public handleRemoteStrokeStart(stroke: Stroke): void {
    this.remoteInflightStrokes.set(stroke.id, {
      stroke: { ...stroke, points: [...stroke.points] },
      lastRenderedIndex: 0,
    });

    if (stroke.points.length > 0) {
      this.drawDot(this.drawCtx, stroke.points[0], stroke.color, stroke.width, stroke.tool);
    }
  }

  public handleRemoteStrokeChunk(strokeId: string, newPoints: Point[]): void {
    const entry = this.remoteInflightStrokes.get(strokeId);
    if (!entry) return;

    for (const pt of newPoints) {
      entry.stroke.points.push(pt);
      this.renderIncrementalSegment(
        this.drawCtx,
        entry.stroke.points,
        entry.stroke.color,
        entry.stroke.width,
        entry.stroke.tool
      );
    }
    entry.lastRenderedIndex = entry.stroke.points.length - 1;
  }

  public handleRemoteStrokeEnd(strokeId: string, finalPoints?: Point[]): Stroke | null {
    const entry = this.remoteInflightStrokes.get(strokeId);
    if (!entry) return null;

    if (finalPoints && finalPoints.length > entry.stroke.points.length) {
      const remainder = finalPoints.slice(entry.stroke.points.length);
      this.handleRemoteStrokeChunk(strokeId, remainder);
    }

    this.remoteInflightStrokes.delete(strokeId);
    return entry.stroke;
  }

  /**
   * Update remote users presence for cursor rendering.
   */
  public updateRemoteUsers(users: Map<string, User>): void {
    this.remoteUsers = users;
  }

  /**
   * Continuous requestAnimationFrame loop to render remote cursors smoothly
   * on the overlay canvas without triggering redraws of the drawing layer.
   */
  private startCursorRenderLoop(): void {
    const render = () => {
      this.overlayCtx.clearRect(0, 0, this.width, this.height);
      const now = Date.now();

      this.remoteUsers.forEach((user) => {
        // Skip current user (they have native system cursor)
        if (user.id === this.userId || !user.cursor) return;

        // Skip cursors inactive for > 15 seconds
        if (user.lastActive && now - user.lastActive > 15000) return;

        this.drawRemoteCursor(this.overlayCtx, user);
      });

      this.animFrameId = requestAnimationFrame(render);
    };

    this.animFrameId = requestAnimationFrame(render);
  }

  /**
   * Draw an elegant pointer arrow and labeled pill badge for a remote user.
   */
  private drawRemoteCursor(ctx: CanvasRenderingContext2D, user: User): void {
    if (!user.cursor) return;
    const { x, y } = user.cursor;
    const color = user.color || '#3b82f6';
    const name = user.name || 'User';

    ctx.save();

    // 1. Draw cursor pointer arrow
    ctx.shadowColor = 'rgba(0, 0, 0, 0.2)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 2;

    ctx.fillStyle = color;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;

    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y + 15);
    ctx.lineTo(x + 4, y + 12);
    ctx.lineTo(x + 8, y + 18);
    ctx.lineTo(x + 11, y + 17);
    ctx.lineTo(x + 7, y + 11);
    ctx.lineTo(x + 13, y + 11);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // 2. Draw user name badge pill beside cursor
    ctx.shadowColor = 'transparent';
    ctx.font = '600 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    const textMetrics = ctx.measureText(name);
    const badgeWidth = textMetrics.width + 12;
    const badgeHeight = 18;
    const badgeX = x + 12;
    const badgeY = y + 14;
    const radius = 4;

    // Badge background
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect
      ? ctx.roundRect(badgeX, badgeY, badgeWidth, badgeHeight, radius)
      : ctx.rect(badgeX, badgeY, badgeWidth, badgeHeight);
    ctx.fill();

    // Badge text
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, badgeX + 6, badgeY + badgeHeight / 2);

    ctx.restore();
  }

  /**
   * Export the artwork as a PNG data URL with a solid white background.
   */
  public exportAsDataUrl(): string {
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = this.drawCanvas.width;
    exportCanvas.height = this.drawCanvas.height;
    const ctx = exportCanvas.getContext('2d');
    if (!ctx) return '';

    // Solid white background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);

    // Draw the artwork layer
    ctx.drawImage(this.drawCanvas, 0, 0);
    return exportCanvas.toDataURL('image/png');
  }
}
