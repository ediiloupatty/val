// Generates a shareable score card as a PNG image, drawn on an offscreen canvas.
// Portrait 1080x1920 (9:16) — sized for Instagram / WhatsApp Stories.
// Eight visual templates (pick via `template`) and an optional weekly-rank badge
// (`rank`). Pure canvas (no fonts to load) so it works offline.

const ACCENT = '#00e5c0';
const RED = '#ff4655';
const SANS = '-apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

// Template registry — id + label used to build the picker in the UI.
export const CARD_TEMPLATES = [
  { id: 'neon', name: 'Neon' },
  { id: 'minimal', name: 'Minimal' },
  { id: 'agent', name: 'Agent' },
  { id: 'gradient', name: 'Gradient' },
  { id: 'mono', name: 'Mono' },
  { id: 'aurora', name: 'Aurora' },
  { id: 'blueprint', name: 'Blueprint' },
  { id: 'spotlight', name: 'Spotlight' },
];

/**
 * Draws the chosen template and resolves to a PNG Blob.
 * @param {{name, score, accuracy, split, text, template, rank}} opts
 *   `rank` (number) draws a "RANK #n" badge; null/undefined hides it.
 */
export function generateShareCard({ name, score, accuracy, split, text, template = 'neon', rank = null }) {
  const W = 1080;
  const H = 1920;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  const d = {
    W, H, CX: W / 2,
    name: clip(name || 'Agent', 18),
    score: formatNum(score),
    acc: `${Math.round(accuracy || 0)}%`,
    split: `${Math.round(split || 0)}ms`,
    rank: rank ? Number(rank) : null,
    text,
  };

  const draw = TEMPLATES[template] || TEMPLATES.neon;
  draw(ctx, d);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Card render failed'))), 'image/png');
  });
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

const TEMPLATES = {
  // 1) NEON — dark, cyan ring focal point, soft glows.
  neon(ctx, d) {
    const { W, H, CX, text } = d;
    fillGradient(ctx, W, H, [['#0e171e', 0], ['#070b0e', 1]]);
    paintGlow(ctx, CX, H * 0.07, W * 0.8, 'rgba(255,70,85,0.16)');
    paintGlow(ctx, CX, H * 0.46, W * 0.85, 'rgba(0,229,192,0.12)');
    paintGlow(ctx, CX, H * 0.95, W * 0.7, 'rgba(255,70,85,0.08)');
    frame(ctx, W, H, 'rgba(255,255,255,0.07)');

    drawCrosshair(ctx, CX, 210, ACCENT, 30, 10, 5);
    txt(ctx, spaced('VALORANT AIM TRAINER'), CX, 320, `800 30px ${SANS}`, RED);
    bar(ctx, CX, 346, 112, 4, ACCENT);
    if (d.rank) rankBadge(ctx, CX, 470, rankLabel(d), { fg: ACCENT, bg: 'rgba(0,229,192,0.12)', border: 'rgba(0,229,192,0.5)' });

    ring(ctx, CX, 920, 360, 'rgba(0,229,192,0.16)');
    ring(ctx, CX, 920, 300, 'rgba(255,255,255,0.04)');

    txt(ctx, d.name, CX, 680, `900 78px ${SANS}`, '#ffffff');
    txt(ctx, spaced(text.cardLabelScore), CX, 820, `700 32px ${SANS}`, slate(0.92));
    glowText(ctx, d.score, CX, 998, `900 230px ${SANS}`, ACCENT, 'rgba(0,229,192,0.4)', 48);

    statPair(ctx, CX, 1300, d, { value: '#fff', label: slate(0.92), divider: 'rgba(255,255,255,0.10)' });
    txt(ctx, text.cardTagline, CX, 1720, `600 40px ${SANS}`, 'rgba(226,232,240,0.9)');
    txt(ctx, 'aimku.xyz', CX, 1800, `800 50px ${SANS}`, ACCENT);
  },

  // 2) MINIMAL — light background, ink type, one hairline accent.
  minimal(ctx, d) {
    const { W, H, CX, text } = d;
    const INK = '#0f1419';
    const SUB = '#5b6672';
    const A = '#0bbfa6';
    fillGradient(ctx, W, H, [['#f7f8fa', 0], ['#e8ebef', 1]]);
    frame(ctx, W, H, 'rgba(15,20,25,0.08)');

    drawCrosshair(ctx, CX, 220, A, 28, 9, 5);
    txt(ctx, spaced('VALORANT AIM TRAINER'), CX, 330, `800 28px ${SANS}`, INK);
    bar(ctx, CX, 356, 90, 4, A);
    if (d.rank) rankBadge(ctx, CX, 490, rankLabel(d), { fg: A, bg: 'rgba(11,191,166,0.10)', border: 'rgba(11,191,166,0.5)' });

    txt(ctx, d.name, CX, 740, `900 76px ${SANS}`, INK);
    txt(ctx, spaced(text.cardLabelScore), CX, 870, `700 30px ${SANS}`, SUB);
    txt(ctx, d.score, CX, 1080, `900 220px ${SANS}`, INK);
    bar(ctx, CX, 1130, 160, 6, A);

    statPair(ctx, CX, 1400, d, { value: INK, label: SUB, divider: 'rgba(15,20,25,0.12)' });
    txt(ctx, text.cardTagline, CX, 1720, `600 38px ${SANS}`, SUB);
    txt(ctx, 'aimku.xyz', CX, 1800, `800 48px ${SANS}`, A);
  },

  // 3) AGENT — red-dominant, bold diagonal stripe.
  agent(ctx, d) {
    const { W, H, CX, text } = d;
    fillGradient(ctx, W, H, [['#2a0d11', 0], ['#0a0506', 1]]);
    paintGlow(ctx, CX, H * 0.1, W * 0.9, 'rgba(255,70,85,0.22)');
    ctx.save();
    ctx.translate(CX, H * 0.5);
    ctx.rotate(-0.18);
    ctx.fillStyle = 'rgba(255,70,85,0.10)';
    ctx.fillRect(-W, -120, W * 2, 240);
    ctx.restore();
    frame(ctx, W, H, 'rgba(255,70,85,0.22)');

    drawCrosshair(ctx, CX, 210, RED, 30, 10, 6);
    txt(ctx, spaced('VALORANT AIM TRAINER'), CX, 320, `800 30px ${SANS}`, '#ffffff');
    bar(ctx, CX, 346, 112, 4, RED);
    if (d.rank) rankBadge(ctx, CX, 480, rankLabel(d), { fg: '#fff', bg: 'rgba(255,70,85,0.18)', border: RED });

    txt(ctx, d.name, CX, 720, `900 80px ${SANS}`, '#ffffff');
    txt(ctx, spaced(text.cardLabelScore), CX, 860, `700 32px ${SANS}`, 'rgba(255,180,186,0.95)');
    glowText(ctx, d.score, CX, 1040, `900 230px ${SANS}`, '#ffffff', 'rgba(255,70,85,0.55)', 50);

    statPair(ctx, CX, 1340, d, { value: '#fff', label: 'rgba(255,180,186,0.95)', divider: 'rgba(255,70,85,0.3)' });
    txt(ctx, text.cardTagline, CX, 1720, `700 40px ${SANS}`, '#ffffff');
    txt(ctx, 'aimku.xyz', CX, 1800, `800 50px ${SANS}`, RED);
  },

  // 4) GRADIENT — vibrant diagonal gradient + glassmorphism card.
  gradient(ctx, d) {
    const { W, H, CX, text } = d;
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#22d3ee');
    g.addColorStop(0.5, '#6366f1');
    g.addColorStop(1, '#1e1b4b');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    paintGlow(ctx, CX, H * 0.2, W * 0.7, 'rgba(255,255,255,0.18)');

    ctx.save();
    roundRect(ctx, 110, 360, W - 220, 1200, 56);
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    drawCrosshair(ctx, CX, 250, '#ffffff', 28, 9, 5);
    txt(ctx, spaced('VALORANT AIM TRAINER'), CX, 470, `800 28px ${SANS}`, 'rgba(255,255,255,0.95)');
    if (d.rank) rankBadge(ctx, CX, 580, rankLabel(d), { fg: '#fff', bg: 'rgba(255,255,255,0.18)', border: 'rgba(255,255,255,0.5)' });

    txt(ctx, d.name, CX, 740, `900 76px ${SANS}`, '#ffffff');
    txt(ctx, spaced(text.cardLabelScore), CX, 860, `700 30px ${SANS}`, 'rgba(255,255,255,0.8)');
    glowText(ctx, d.score, CX, 1050, `900 220px ${SANS}`, '#ffffff', 'rgba(255,255,255,0.45)', 40);

    statPair(ctx, CX, 1350, d, { value: '#fff', label: 'rgba(255,255,255,0.85)', divider: 'rgba(255,255,255,0.3)' });
    txt(ctx, text.cardTagline, CX, 1700, `600 38px ${SANS}`, 'rgba(255,255,255,0.95)');
    txt(ctx, 'aimku.xyz', CX, 1780, `800 48px ${SANS}`, '#ffffff');
  },

  // 5) MONO — terminal aesthetic: grid, monospace, window frame.
  mono(ctx, d) {
    const { W, H, CX, text } = d;
    ctx.fillStyle = '#0a0e0c';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(0,229,192,0.05)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= W; x += 60) line(ctx, x, 0, x, H);
    for (let y = 0; y <= H; y += 60) line(ctx, 0, y, W, y);

    const wx = 90, wy = 300, ww = W - 180, wh = 1320;
    ctx.fillStyle = 'rgba(8,18,15,0.85)';
    roundRect(ctx, wx, wy, ww, wh, 28); ctx.fill();
    ctx.strokeStyle = 'rgba(0,229,192,0.35)'; ctx.lineWidth = 2;
    roundRect(ctx, wx, wy, ww, wh, 28); ctx.stroke();
    [RED, '#ffcc00', ACCENT].forEach((c, i) => { ctx.fillStyle = c; dot(ctx, wx + 50 + i * 44, wy + 50, 13); });
    txt(ctx, 'aim_score.sh', CX, wy + 60, `600 30px ${MONO}`, 'rgba(148,163,184,0.8)');

    txt(ctx, '// VALORANT_AIM_TRAINER', CX, wy + 170, `700 30px ${MONO}`, ACCENT);
    if (d.rank) txt(ctx, `[ ${rankLabel(d)} ]`, CX, wy + 250, `700 36px ${MONO}`, '#ffcc00');
    txt(ctx, `user: ${d.name}`, CX, wy + 360, `700 52px ${MONO}`, '#e2e8f0');
    txt(ctx, `> ${text.cardLabelScore.toLowerCase().replace(/\s/g, '_')}`, CX, wy + 470, `600 30px ${MONO}`, 'rgba(148,163,184,0.85)');
    glowText(ctx, d.score, CX, wy + 650, `800 200px ${MONO}`, ACCENT, 'rgba(0,229,192,0.4)', 44);

    txt(ctx, `acc=${d.acc}   split=${d.split}`, CX, wy + 800, `600 40px ${MONO}`, '#e2e8f0');
    bar(ctx, CX, wy + 860, ww - 120, 2, 'rgba(0,229,192,0.25)');
    txt(ctx, text.cardTagline, CX, wy + 970, `600 34px ${MONO}`, 'rgba(148,163,184,0.9)');

    txt(ctx, '> aimku.xyz', CX, 1740, `800 50px ${MONO}`, ACCENT);
  },

  // 6) AURORA — dark canvas with flowing aurora colour glows up top.
  aurora(ctx, d) {
    const { W, H, CX, text } = d;
    ctx.fillStyle = '#0a0f14';
    ctx.fillRect(0, 0, W, H);
    paintGlow(ctx, W * 0.30, H * 0.13, W * 0.6, 'rgba(52,211,153,0.28)');
    paintGlow(ctx, W * 0.68, H * 0.17, W * 0.6, 'rgba(34,211,238,0.24)');
    paintGlow(ctx, W * 0.50, H * 0.04, W * 0.7, 'rgba(167,139,250,0.20)');
    paintGlow(ctx, CX, H * 0.95, W * 0.7, 'rgba(34,211,238,0.10)');
    frame(ctx, W, H, 'rgba(255,255,255,0.08)');

    drawCrosshair(ctx, CX, 210, ACCENT, 30, 10, 5);
    txt(ctx, spaced('VALORANT AIM TRAINER'), CX, 320, `800 30px ${SANS}`, 'rgba(255,255,255,0.95)');
    bar(ctx, CX, 346, 112, 4, '#34d399');
    if (d.rank) rankBadge(ctx, CX, 480, rankLabel(d), { fg: '#a7f3d0', bg: 'rgba(52,211,153,0.12)', border: 'rgba(52,211,153,0.5)' });

    txt(ctx, d.name, CX, 720, `900 78px ${SANS}`, '#ffffff');
    txt(ctx, spaced(text.cardLabelScore), CX, 860, `700 32px ${SANS}`, slate(0.92));
    glowText(ctx, d.score, CX, 1040, `900 230px ${SANS}`, '#a7f3d0', 'rgba(52,211,153,0.45)', 48);

    statPair(ctx, CX, 1340, d, { value: '#fff', label: slate(0.92), divider: 'rgba(255,255,255,0.10)' });
    txt(ctx, text.cardTagline, CX, 1720, `600 40px ${SANS}`, 'rgba(226,232,240,0.9)');
    txt(ctx, 'aimku.xyz', CX, 1800, `800 50px ${SANS}`, '#34d399');
  },

  // 7) BLUEPRINT — deep blue technical drawing with white grid + corner ticks.
  blueprint(ctx, d) {
    const { W, H, CX, text } = d;
    fillGradient(ctx, W, H, [['#0a2540', 0], ['#06182b', 1]]);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= W; x += 54) line(ctx, x, 0, x, H);
    for (let y = 0; y <= H; y += 54) line(ctx, 0, y, W, y);
    frame(ctx, W, H, 'rgba(255,255,255,0.18)');
    cornerTicks(ctx, W, H, 'rgba(255,255,255,0.4)');

    txt(ctx, spaced('VALORANT AIM TRAINER'), CX, 320, `800 30px ${SANS}`, 'rgba(255,255,255,0.95)');
    bar(ctx, CX, 346, 112, 4, ACCENT);
    if (d.rank) rankBadge(ctx, CX, 480, rankLabel(d), { fg: '#fff', bg: 'rgba(255,255,255,0.10)', border: 'rgba(255,255,255,0.45)' });

    txt(ctx, d.name, CX, 720, `900 78px ${SANS}`, '#ffffff');
    txt(ctx, spaced(`${text.cardLabelScore} //`), CX, 860, `700 30px ${SANS}`, 'rgba(255,255,255,0.6)');
    glowText(ctx, d.score, CX, 1050, `900 230px ${SANS}`, '#ffffff', 'rgba(0,229,192,0.25)', 30);

    statPair(ctx, CX, 1350, d, { value: '#fff', label: 'rgba(255,255,255,0.6)', divider: 'rgba(255,255,255,0.2)' });
    txt(ctx, text.cardTagline, CX, 1720, `600 38px ${SANS}`, 'rgba(255,255,255,0.85)');
    txt(ctx, 'aimku.xyz', CX, 1800, `800 50px ${SANS}`, ACCENT);
  },

  // 8) SPOTLIGHT — pure black, one soft spotlight behind the score. Dramatic.
  spotlight(ctx, d) {
    const { W, H, CX, text } = d;
    ctx.fillStyle = '#050607';
    ctx.fillRect(0, 0, W, H);
    paintGlow(ctx, CX, 980, W * 0.62, 'rgba(255,255,255,0.13)');
    paintGlow(ctx, CX, 980, W * 0.4, 'rgba(0,229,192,0.10)');

    txt(ctx, spaced('VALORANT AIM TRAINER'), CX, 300, `700 28px ${SANS}`, 'rgba(255,255,255,0.55)');
    bar(ctx, CX, 326, 80, 3, ACCENT);
    if (d.rank) rankBadge(ctx, CX, 470, rankLabel(d), { fg: ACCENT, bg: 'rgba(0,229,192,0.10)', border: 'rgba(0,229,192,0.4)' });

    txt(ctx, d.name, CX, 720, `900 80px ${SANS}`, '#ffffff');
    txt(ctx, spaced(text.cardLabelScore), CX, 860, `700 30px ${SANS}`, 'rgba(255,255,255,0.45)');
    glowText(ctx, d.score, CX, 1060, `900 240px ${SANS}`, '#ffffff', 'rgba(255,255,255,0.35)', 44);

    statPair(ctx, CX, 1360, d, { value: '#fff', label: 'rgba(255,255,255,0.45)', divider: 'rgba(255,255,255,0.12)' });
    txt(ctx, text.cardTagline, CX, 1720, `600 38px ${SANS}`, 'rgba(255,255,255,0.7)');
    txt(ctx, 'aimku.xyz', CX, 1800, `800 48px ${SANS}`, ACCENT);
  },
};

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------

function txt(ctx, s, x, y, font, color, align = 'center') {
  ctx.textAlign = align;
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.fillText(s, x, y);
}

function glowText(ctx, s, x, y, font, color, glow, blur) {
  ctx.shadowColor = glow;
  ctx.shadowBlur = blur;
  txt(ctx, s, x, y, font, color);
  ctx.shadowBlur = 0;
}

function rankLabel(d) {
  return `${d.text.cardRankShort} #${d.rank}`;
}

// Pill badge sized to its text, centred on cx.
function rankBadge(ctx, cx, y, label, c) {
  const font = `800 30px ${SANS}`;
  ctx.font = font;
  const w = ctx.measureText(label).width + 60;
  const h = 64;
  ctx.fillStyle = c.bg;
  roundRect(ctx, cx - w / 2, y - h / 2, w, h, h / 2);
  ctx.fill();
  if (c.border) {
    ctx.strokeStyle = c.border;
    ctx.lineWidth = 2;
    roundRect(ctx, cx - w / 2, y - h / 2, w, h, h / 2);
    ctx.stroke();
  }
  txt(ctx, label, cx, y + 11, font, c.fg);
}

// Accuracy | split pair split by a centre hairline.
function statPair(ctx, CX, y, d, c) {
  txt(ctx, d.acc, CX - 190, y, `900 78px ${SANS}`, c.value);
  txt(ctx, spaced(d.text.cardLabelAcc), CX - 190, y + 48, `700 26px ${SANS}`, c.label);
  txt(ctx, d.split, CX + 190, y, `900 78px ${SANS}`, c.value);
  txt(ctx, spaced(d.text.cardLabelSplit), CX + 190, y + 48, `700 26px ${SANS}`, c.label);
  ctx.strokeStyle = c.divider;
  ctx.lineWidth = 2;
  line(ctx, CX, y - 60, CX, y + 44);
}

function fillGradient(ctx, W, H, stops) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  stops.forEach(([c, p]) => g.addColorStop(p, c));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

function frame(ctx, W, H, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  roundRect(ctx, 44, 44, W - 88, H - 88, 56);
  ctx.stroke();
}

// Technical L-shaped ticks at the four frame corners.
function cornerTicks(ctx, W, H, color) {
  const m = 44, len = 60;
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  const corners = [
    [m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1],
  ];
  for (const [x, y, sx, sy] of corners) {
    line(ctx, x, y, x + len * sx, y);
    line(ctx, x, y, x, y + len * sy);
  }
}

function ring(ctx, cx, cy, r, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
}

function bar(ctx, cx, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(cx - w / 2, y, w, h);
}

function dot(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function line(ctx, x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function paintGlow(ctx, cx, cy, radius, color) {
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  g.addColorStop(0, color);
  g.addColorStop(1, color.replace(/[\d.]+\)$/, '0)'));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
}

function drawCrosshair(ctx, cx, cy, color, len, gap, thick) {
  ctx.strokeStyle = color;
  ctx.lineWidth = thick;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx, cy - gap); ctx.lineTo(cx, cy - gap - len);
  ctx.moveTo(cx, cy + gap); ctx.lineTo(cx, cy + gap + len);
  ctx.moveTo(cx - gap, cy); ctx.lineTo(cx - gap - len, cy);
  ctx.moveTo(cx + gap, cy); ctx.lineTo(cx + gap + len, cy);
  ctx.stroke();
  ctx.lineCap = 'butt';
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function slate(a) { return `rgba(148,163,184,${a})`; }
function spaced(str) { return String(str).split('').join(' '); }
function clip(str, max) { const s = String(str); return s.length > max ? s.slice(0, max - 1) + '…' : s; }
function formatNum(n) { return Number(n || 0).toLocaleString('en-US'); }
