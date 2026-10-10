export interface MapObject {
  x: number;
  y: number;
  color: string;
  radius: number;
}

const PADDING = 4;
const TRACK_LIMIT = 1500;

/** North-up map of the course, the boat and its recent track. */
export class Minimap {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly track: number[] = [];
  private bounds = { minX: 0, maxX: 1, minY: 0, maxY: 1 };

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas unavailable");
    this.ctx = ctx;
  }

  setExtent(points: { x: number; y: number }[]): void {
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    this.bounds = {
      minX: Math.min(...xs) - PADDING,
      maxX: Math.max(...xs) + PADDING,
      minY: Math.min(...ys) - PADDING,
      maxY: Math.max(...ys) + PADDING,
    };
  }

  clearTrack(): void {
    this.track.length = 0;
  }

  draw(objects: MapObject[], boatX: number, boatY: number, yaw: number): void {
    const last = this.track.length;
    if (last === 0 || Math.hypot(this.track[last - 2] - boatX, this.track[last - 1] - boatY) > 0.3) {
      this.track.push(boatX, boatY);
      if (this.track.length > TRACK_LIMIT * 2) this.track.splice(0, 2);
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (this.canvas.width !== Math.round(width * dpr)) this.canvas.width = Math.round(width * dpr);
    if (this.canvas.height !== Math.round(height * dpr)) this.canvas.height = Math.round(height * dpr);
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const b = {
      minX: Math.min(this.bounds.minX, boatX - 3),
      maxX: Math.max(this.bounds.maxX, boatX + 3),
      minY: Math.min(this.bounds.minY, boatY - 3),
      maxY: Math.max(this.bounds.maxY, boatY + 3),
    };
    const scale = Math.min(width / (b.maxX - b.minX), height / (b.maxY - b.minY));
    const ox = (width - (b.maxX - b.minX) * scale) / 2;
    const oy = (height - (b.maxY - b.minY) * scale) / 2;
    const px = (x: number) => ox + (x - b.minX) * scale;
    const py = (y: number) => height - oy - (y - b.minY) * scale;

    ctx.strokeStyle = "rgba(152, 207, 212, 0.18)";
    ctx.lineWidth = 1;
    const step = 10;
    for (let x = Math.ceil(b.minX / step) * step; x <= b.maxX; x += step) {
      ctx.beginPath();
      ctx.moveTo(px(x), 0);
      ctx.lineTo(px(x), height);
      ctx.stroke();
    }
    for (let y = Math.ceil(b.minY / step) * step; y <= b.maxY; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, py(y));
      ctx.lineTo(width, py(y));
      ctx.stroke();
    }

    if (this.track.length >= 4) {
      ctx.strokeStyle = "rgba(152, 207, 212, 0.75)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(px(this.track[0]), py(this.track[1]));
      for (let i = 2; i < this.track.length; i += 2) ctx.lineTo(px(this.track[i]), py(this.track[i + 1]));
      ctx.stroke();
    }

    for (const object of objects) {
      ctx.fillStyle = object.color;
      ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
      ctx.lineWidth = 0.75;
      ctx.beginPath();
      ctx.arc(px(object.x), py(object.y), Math.max(2, object.radius * scale), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    ctx.save();
    ctx.translate(px(boatX), py(boatY));
    ctx.rotate(-yaw);
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.moveTo(7, 0);
    ctx.lineTo(-5, 4.5);
    ctx.lineTo(-3, 0);
    ctx.lineTo(-5, -4.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
    ctx.font = "10px 'DM Mono', monospace";
    ctx.fillText("N ↑", width - 26, 13);
    ctx.fillText("10 m grid", 6, height - 6);
  }
}
