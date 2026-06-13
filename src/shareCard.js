// Generates a shareable score card as a PNG image, drawn on an offscreen canvas.
// Returns a Blob the caller can hand to the Web Share API or offer as a download.
// Portrait 1080x1920 (9:16) — sized for Instagram / WhatsApp Stories.
// Pure canvas (no fonts to load) so it works offline and never blocks gameplay.

const ACCENT = '#00e5c0';
const RED = '#ff4655';
const SLATE = 'rgba(148,163,184,0.92)';
const FONT = '-apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

// Round-rect path helper (older Safari lacks ctx.roundRect).
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Draws the score card and resolves to a PNG Blob.
 * @param {{name:string, score:number, accuracy:number, split:number, text:object}} opts
 *   `text` carries the localized strings (cardLabelScore, cardLabelAcc, cardLabelSplit, cardTagline).
 */
export function generateShareCard({ name, score, accuracy, split, text }) {
  const W = 1080;
  const H = 1920;
  const CX = W / 2;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  // --- Background: deep vertical gradient + soft glows ----------------------
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#0e171e');
  bg.addColorStop(1, '#070b0e');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Red glow up top, accent glow around the score — gives depth without clutter.
  paintGlow(ctx, CX, H * 0.07, W * 0.8, 'rgba(255,70,85,0.16)');
  paintGlow(ctx, CX, H * 0.46, W * 0.85, 'rgba(0,229,192,0.12)');
  paintGlow(ctx, CX, H * 0.95, W * 0.7, 'rgba(255,70,85,0.08)');

  // Thin inner frame.
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 2;
  roundRect(ctx, 44, 44, W - 88, H - 88, 56);
  ctx.stroke();

  ctx.textAlign = 'center';

  // --- Crosshair logo + brand ----------------------------------------------
  drawCrosshair(ctx, CX, 210, 30, 10, 5);

  ctx.fillStyle = RED;
  ctx.font = `800 30px ${FONT}`;
  ctx.fillText(spaced('VALORANT AIM TRAINER'), CX, 320);

  ctx.fillStyle = ACCENT;
  ctx.fillRect(CX - 56, 346, 112, 4);

  // --- Decorative ring behind the score ------------------------------------
  const ringY = 900;
  ctx.strokeStyle = 'rgba(0,229,192,0.16)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(CX, ringY, 360, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.beginPath();
  ctx.arc(CX, ringY, 300, 0, Math.PI * 2);
  ctx.stroke();

  // --- Player name ----------------------------------------------------------
  ctx.fillStyle = '#ffffff';
  ctx.font = `900 78px ${FONT}`;
  ctx.fillText(clip(name || 'Agent', 18), CX, 660);

  // --- Score label + big number --------------------------------------------
  ctx.fillStyle = SLATE;
  ctx.font = `700 32px ${FONT}`;
  ctx.fillText(spaced(text.cardLabelScore), CX, 800);

  ctx.fillStyle = ACCENT;
  ctx.font = `900 230px ${FONT}`;
  ctx.shadowColor = 'rgba(0,229,192,0.4)';
  ctx.shadowBlur = 48;
  ctx.fillText(formatNum(score), CX, ringY + 78);
  ctx.shadowBlur = 0;

  // --- Stats: accuracy | split, split by a hairline -------------------------
  const statsY = 1280;
  drawStat(ctx, CX - 190, statsY, text.cardLabelAcc, `${Math.round(accuracy || 0)}%`);
  drawStat(ctx, CX + 190, statsY, text.cardLabelSplit, `${Math.round(split || 0)}ms`);
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(CX, statsY - 60);
  ctx.lineTo(CX, statsY + 44);
  ctx.stroke();

  // --- Footer: tagline + domain --------------------------------------------
  ctx.fillStyle = 'rgba(226,232,240,0.9)';
  ctx.font = `600 40px ${FONT}`;
  ctx.fillText(text.cardTagline, CX, 1720);

  ctx.fillStyle = ACCENT;
  ctx.font = `800 50px ${FONT}`;
  ctx.fillText('aimku.xyz', CX, 1800);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Card render failed'));
    }, 'image/png');
  });
}

// A soft radial glow centred at (cx, cy).
function paintGlow(ctx, cx, cy, radius, color) {
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  g.addColorStop(0, color);
  g.addColorStop(1, color.replace(/[\d.]+\)$/, '0)'));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
}

// Minimal Valorant-style crosshair (four ticks around a centre gap).
function drawCrosshair(ctx, cx, cy, len, gap, thick) {
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = thick;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx, cy - gap); ctx.lineTo(cx, cy - gap - len); // up
  ctx.moveTo(cx, cy + gap); ctx.lineTo(cx, cy + gap + len); // down
  ctx.moveTo(cx - gap, cy); ctx.lineTo(cx - gap - len, cy); // left
  ctx.moveTo(cx + gap, cy); ctx.lineTo(cx + gap + len, cy); // right
  ctx.stroke();
  ctx.lineCap = 'butt';
}

// A single stat: big value above a small spaced label, centred on cx.
function drawStat(ctx, cx, y, label, value) {
  ctx.fillStyle = '#ffffff';
  ctx.font = `900 78px ${FONT}`;
  ctx.fillText(value, cx, y);
  ctx.fillStyle = SLATE;
  ctx.font = `700 26px ${FONT}`;
  ctx.fillText(spaced(label), cx, y + 48);
}

// Letter-spacing emulation (canvas has no tracking) — inserts spaces.
function spaced(str) {
  return String(str).split('').join(' ');
}

function clip(str, max) {
  const s = String(str);
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function formatNum(n) {
  return Number(n || 0).toLocaleString('en-US');
}
