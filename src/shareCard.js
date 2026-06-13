// Generates a shareable score card as a PNG image, drawn on an offscreen canvas.
// Returns a Blob the caller can hand to the Web Share API or offer as a download.
// Pure canvas (no fonts to load) so it works offline and never blocks gameplay.

const ACCENT = '#00e5c0';
const RED = '#ff4655';

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

const FONT = '-apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

/**
 * Draws the score card and resolves to a PNG Blob.
 * @param {{name:string, score:number, accuracy:number, split:number, text:object}} opts
 *   `text` carries the localized strings (cardLabelScore, cardLabelAcc, cardLabelSplit, cardTagline).
 */
export function generateShareCard({ name, score, accuracy, split, text }) {
  const W = 1080;
  const H = 1080;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  // --- Background -----------------------------------------------------------
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#101a21');
  bg.addColorStop(1, '#0a0f13');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Red glow (top-right) + accent glow (bottom-left) for depth.
  const glowR = ctx.createRadialGradient(W * 0.85, H * 0.12, 0, W * 0.85, H * 0.12, W * 0.7);
  glowR.addColorStop(0, 'rgba(255,70,85,0.20)');
  glowR.addColorStop(1, 'rgba(255,70,85,0)');
  ctx.fillStyle = glowR;
  ctx.fillRect(0, 0, W, H);

  const glowA = ctx.createRadialGradient(W * 0.12, H * 0.9, 0, W * 0.12, H * 0.9, W * 0.7);
  glowA.addColorStop(0, 'rgba(0,229,192,0.14)');
  glowA.addColorStop(1, 'rgba(0,229,192,0)');
  ctx.fillStyle = glowA;
  ctx.fillRect(0, 0, W, H);

  // Inner border frame.
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 2;
  roundRect(ctx, 48, 48, W - 96, H - 96, 48);
  ctx.stroke();

  ctx.textAlign = 'center';

  // --- Header ---------------------------------------------------------------
  ctx.fillStyle = RED;
  ctx.font = `800 30px ${FONT}`;
  ctx.fillText(spaced('VALORANT AIM TRAINER'), W / 2, 170);

  // Accent divider.
  ctx.fillStyle = ACCENT;
  ctx.fillRect(W / 2 - 60, 196, 120, 4);

  // --- Player name ----------------------------------------------------------
  ctx.fillStyle = '#ffffff';
  ctx.font = `900 76px ${FONT}`;
  ctx.fillText(clip(name || 'Agent', 16), W / 2, 320);

  // --- Score label + big number --------------------------------------------
  ctx.fillStyle = 'rgba(148,163,184,0.9)';
  ctx.font = `700 32px ${FONT}`;
  ctx.fillText(spaced(text.cardLabelScore), W / 2, 430);

  ctx.fillStyle = ACCENT;
  ctx.font = `900 220px ${FONT}`;
  ctx.shadowColor = 'rgba(0,229,192,0.35)';
  ctx.shadowBlur = 40;
  ctx.fillText(formatNum(score), W / 2, 660);
  ctx.shadowBlur = 0;

  // --- Two stat boxes (accuracy / split) -----------------------------------
  const boxW = 380;
  const boxH = 150;
  const gap = 40;
  const totalW = boxW * 2 + gap;
  const startX = (W - totalW) / 2;
  const boxY = 740;
  drawStat(ctx, startX, boxY, boxW, boxH, text.cardLabelAcc, `${Math.round(accuracy || 0)}%`);
  drawStat(ctx, startX + boxW + gap, boxY, boxW, boxH, text.cardLabelSplit, `${Math.round(split || 0)}ms`);

  // --- Footer ---------------------------------------------------------------
  ctx.fillStyle = 'rgba(226,232,240,0.85)';
  ctx.font = `600 34px ${FONT}`;
  ctx.fillText(text.cardTagline, W / 2, 980);

  ctx.fillStyle = ACCENT;
  ctx.font = `800 38px ${FONT}`;
  ctx.fillText('aimku.xyz', W / 2, 1030);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Card render failed'));
    }, 'image/png');
  });
}

function drawStat(ctx, x, y, w, h, label, value) {
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  roundRect(ctx, x, y, w, h, 28);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 2;
  roundRect(ctx, x, y, w, h, 28);
  ctx.stroke();

  ctx.fillStyle = 'rgba(148,163,184,0.9)';
  ctx.font = `700 26px ${FONT}`;
  ctx.fillText(spaced(label), x + w / 2, y + 52);

  ctx.fillStyle = '#ffffff';
  ctx.font = `900 64px ${FONT}`;
  ctx.fillText(value, x + w / 2, y + 118);
}

// Letter-spacing emulation (canvas has no tracking) — inserts thin spaces.
function spaced(str) {
  return String(str).split('').join(' ');
}

function clip(str, max) {
  const s = String(str);
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function formatNum(n) {
  return Number(n || 0).toLocaleString('en-US');
}
