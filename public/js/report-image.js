/**
 * 学习报告导出 PNG：用 Canvas 画一张适合保存 / 分享的卡片。
 * 不依赖第三方截图库，也不需要联网。
 */

const WIDTH = 1080;
const HEIGHT = 1740;
const PAD = 64;
const INNER = WIDTH - PAD * 2;

const COLORS = {
  bg: '#f4f5fa',
  card: '#ffffff',
  text: '#17181c',
  muted: '#5b6172',
  hint: '#9aa0b0',
  brand: '#3f5bd9',
  brandSoft: '#ecf0ff',
  track: '#eef0f7',
  correct: '#1e8e5a',
  correctBg: '#e4f6ec',
  star: '#f0a028',
};
const FONT = '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", "Segoe UI", sans-serif';

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function setFont(ctx, size, weight = '400') {
  ctx.font = `${weight} ${size}px ${FONT}`;
}

function clipText(ctx, text, maxWidth) {
  const value = String(text == null ? '' : text);
  if (ctx.measureText(value).width <= maxWidth) return value;
  let out = value;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) out = out.slice(0, -1);
  return `${out}…`;
}

function text(ctx, value, x, y, { size = 20, weight = '400', color = COLORS.text, align = 'left', maxWidth = 0 } = {}) {
  setFont(ctx, size, weight);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  const out = maxWidth ? clipText(ctx, value, maxWidth) : value;
  ctx.fillText(out, x, y);
}

function card(ctx, x, y, w, h, radius = 26) {
  roundRect(ctx, x, y, w, h, radius);
  ctx.fillStyle = COLORS.card;
  ctx.fill();
}

function progress(ctx, x, y, w, h, percent, color = COLORS.brand) {
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = COLORS.track;
  ctx.fill();
  const width = Math.max(0, Math.min(w, (w * Math.max(0, Math.min(100, percent))) / 100));
  if (width > 0) {
    roundRect(ctx, x, y, width, h, h / 2);
    ctx.fillStyle = color;
    ctx.fill();
  }
}

function drawHeader(ctx, data) {
  text(ctx, 'WordDrill 单词练习', PAD, 66, { size: 20, color: COLORS.muted });
  text(ctx, '学习报告', PAD, 126, { size: 48, weight: '700' });
  const date = data.date || new Date();
  const dateText = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  text(ctx, dateText, WIDTH - PAD, 68, { size: 20, color: COLORS.hint, align: 'right' });
  text(ctx, data.bookName || '全部词库', WIDTH - PAD, 112, {
    size: 22,
    weight: '600',
    color: COLORS.brand,
    align: 'right',
    maxWidth: 360,
  });
}

function drawHero(ctx, data) {
  const x = PAD;
  const y = 164;
  const h = 250;
  card(ctx, x, y, INNER, h);
  text(ctx, '今 日 进 度', x + 32, y + 46, { size: 20, weight: '600', color: COLORS.muted });

  const answered = Number(data.summary.todayAnswered) || 0;
  const goal = Math.max(1, Number(data.goal) || 30);
  setFont(ctx, 60, '700');
  ctx.fillStyle = COLORS.text;
  ctx.textAlign = 'left';
  ctx.fillText(String(answered), x + 32, y + 126);
  const answeredWidth = ctx.measureText(String(answered)).width;
  text(ctx, `/ ${goal} 题`, x + 32 + answeredWidth + 14, y + 126, { size: 32, color: COLORS.muted });

  const percent = Math.min(100, Math.round((answered * 100) / goal));
  progress(ctx, x + 32, y + 158, INNER - 64, 16, percent);
  const hint = answered >= goal ? '今天的目标完成了' : `还差 ${goal - answered} 题完成今日目标`;
  text(ctx, hint, x + 32, y + 214, { size: 21, color: COLORS.muted });
  text(ctx, `${percent}%`, x + INNER - 32, y + 214, { size: 21, weight: '700', color: COLORS.brand, align: 'right' });
}

function drawStats(ctx, data) {
  const top = 440;
  const gap = 16;
  const width = (INNER - gap * 3) / 4;
  const h = 146;
  const accuracy = data.summary.totalAnswered
    ? Math.round((data.summary.totalCorrect * 100) / data.summary.totalAnswered)
    : 0;
  const items = [
    { value: String(data.summary.streak || 0), unit: '天', label: '连续打卡' },
    { value: String(data.summary.totalAnswered || 0), unit: '题', label: '累计答题' },
    { value: String(accuracy), unit: '%', label: '累计正确率' },
    { value: String(data.due || 0), unit: '词', label: '今天到期' },
  ];
  items.forEach((item, i) => {
    const x = PAD + i * (width + gap);
    card(ctx, x, top, width, h);
    const center = x + width / 2;
    // 数值和单位作为一个整体居中，且单位不能贴到数字上
    setFont(ctx, 42, '700');
    const valueWidth = ctx.measureText(item.value).width;
    setFont(ctx, 18, '400');
    const unitWidth = ctx.measureText(item.unit).width;
    const start = center - (valueWidth + 9 + unitWidth) / 2;
    text(ctx, item.value, start, top + 72, { size: 42, weight: '700' });
    text(ctx, item.unit, start + valueWidth + 9, top + 72, { size: 18, color: COLORS.muted });
    text(ctx, item.label, center, top + 112, { size: 19, color: COLORS.muted, align: 'center' });
  });
}

function drawWeek(ctx, data) {
  const x = PAD;
  const y = 620;
  const h = 310;
  card(ctx, x, y, INNER, h);
  text(ctx, '近 7 天', x + 32, y + 46, { size: 24, weight: '700' });

  const days = Array.isArray(data.summary.days) ? data.summary.days : [];
  const max = Math.max(1, ...days.map((day) => day.answered || 0));
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  const chartTop = y + 82;
  const chartBottom = y + 224;
  const colWidth = (INNER - 64) / Math.max(1, days.length);
  const barWidth = Math.min(58, colWidth * 0.5);

  days.forEach((day, i) => {
    const center = x + 32 + colWidth * i + colWidth / 2;
    const barHeight = Math.max(4, ((day.answered || 0) / max) * (chartBottom - chartTop));
    roundRect(ctx, center - barWidth / 2, chartBottom - barHeight, barWidth, barHeight, barWidth / 2);
    ctx.fillStyle = i === days.length - 1 ? COLORS.brand : '#b8c4f5';
    ctx.fill();
    const date = new Date(`${day.date}T12:00:00`);
    text(ctx, weekdays[date.getDay()], center, y + 268, { size: 19, color: COLORS.muted, align: 'center' });
    if (day.answered) {
      text(ctx, String(day.answered), center, chartBottom - barHeight - 10, {
        size: 16,
        weight: '600',
        color: COLORS.brand,
        align: 'center',
      });
    }
  });
}

function drawMastery(ctx, data) {
  const x = PAD;
  const y = 960;
  const h = 286;
  card(ctx, x, y, INNER, h);
  text(ctx, '掌握度', x + 32, y + 46, { size: 24, weight: '700' });

  const mastery = data.mastery || {};
  text(ctx, `${mastery.masteredPercent || 0}%`, x + 32, y + 146, { size: 58, weight: '700', color: COLORS.correct });
  text(ctx, `已掌握 ${mastery.mastered || 0} / ${mastery.total || 0} 词`, x + 32, y + 184, {
    size: 20,
    color: COLORS.muted,
  });

  const tiers = Array.isArray(mastery.tiers) ? mastery.tiers : [];
  const barX = x + 360;
  // 右侧留出数字列，进度条不要压到数量上
  const barW = INNER - 360 - 74 - 112;
  tiers.forEach((tier, i) => {
    const rowY = y + 70 + i * 52;
    text(ctx, tier.label, barX, rowY + 18, { size: 19, color: COLORS.muted });
    progress(ctx, barX + 74, rowY + 5, barW, 14, tier.percent || 0, i === 3 ? COLORS.correct : COLORS.brand);
    text(ctx, String(tier.count || 0), x + INNER - 32, rowY + 18, {
      size: 18,
      weight: '600',
      color: COLORS.muted,
      align: 'right',
    });
  });
}

function drawModes(ctx, data) {
  const x = PAD;
  const y = 1276;
  const h = 330;
  card(ctx, x, y, INNER, h);
  text(ctx, '最近 30 天分题型', x + 32, y + 46, { size: 24, weight: '700' });

  const modes = (Array.isArray(data.modeStats) ? data.modeStats : []).slice(0, 5);
  if (!modes.length) {
    text(ctx, '最近 30 天还没有答题记录', x + 32, y + 104, { size: 20, color: COLORS.hint });
    return;
  }
  modes.forEach((mode, i) => {
    const rowY = y + 82 + i * 44;
    text(ctx, mode.label || mode.mode, x + 32, rowY + 16, { size: 18, weight: '600', maxWidth: 170 });
    progress(ctx, x + 218, rowY + 3, 520, 12, mode.accuracy || 0);
    text(ctx, `${mode.accuracy || 0}%`, x + 770, rowY + 16, {
      size: 18,
      weight: '700',
      color: COLORS.brand,
      align: 'right',
    });
    text(ctx, `${mode.total || 0} 题`, x + INNER - 32, rowY + 16, {
      size: 17,
      color: COLORS.muted,
      align: 'right',
    });
  });
}

function drawFooter(ctx) {
  text(ctx, '由 WordDrill 单词练习生成 · 数据保存在本机', PAD, HEIGHT - 46, { size: 17, color: COLORS.hint });
  text(ctx, 'wordrill.zzlltt.xyz', WIDTH - PAD, HEIGHT - 46, {
    size: 17,
    color: COLORS.hint,
    align: 'right',
  });
}

/**
 * 画报告图并返回 PNG Blob。
 * @param {object} data { summary, mastery, modeStats, due, goal, bookName, date }
 * @param {object} [options] { document?: Document } 测试 / 自定义环境
 * @returns {Promise<Blob>}
 */
export async function renderReportImage(data, options = {}) {
  const doc = options.document || globalThis.document;
  if (!doc || typeof doc.createElement !== 'function') throw new Error('当前环境不支持导出图片');
  const canvas = doc.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('当前环境不支持导出图片');

  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  drawHeader(ctx, data);
  drawHero(ctx, data);
  drawStats(ctx, data);
  drawWeek(ctx, data);
  drawMastery(ctx, data);
  drawModes(ctx, data);
  drawFooter(ctx);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('生成图片失败'));
    }, 'image/png');
  });
}