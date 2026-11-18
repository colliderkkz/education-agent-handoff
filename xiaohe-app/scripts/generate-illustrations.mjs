/**
 * 题目插图生成脚本。
 *
 * 用法：node scripts/generate-illustrations.mjs
 *
 * 设计约束：
 * - 图形内容由 content/bank/figures.json 声明，脚本只负责把规格画成 SVG。
 * - 图形内部只出现 ASCII 数字与几何符号，绝不出现中文字符 ——
 *   SVG 转 PNG 走 librsvg/pango，没有中文字体的机器会把中文渲染成方块，
 *   而本机 Windows 正常、CI 异常，极难排查。中文标签一律放在 HTML 层。
 * - 文件名不含内容 hash：题目配图路径本身是稳定路径，
 *   缓存失效由渲染层拼接 ?v=<题目版本号> 解决（改图必然产生新版本号）。
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bankRoot = join(root, "content/bank");
const outRoot = join(root, "public/illustrations");

const INK = "#244d3d";
const LINE = "#3c7a58";
const MUTED = "#7b8c84";
const FILL = "#eef6ee";
const ACCENT = "#23865f";
const GRID = "#dfe8e2";

const esc = (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const label = (x, y, text, options = {}) =>
  `<text x="${x}" y="${y}" font-family="Inter, 'Segoe UI', sans-serif" font-size="${options.size ?? 13}" fill="${options.fill ?? INK}" text-anchor="${options.anchor ?? "middle"}"${options.weight ? ` font-weight="${options.weight}"` : ""}>${esc(text)}</text>`;
const line = (x1, y1, x2, y2, options = {}) =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${options.stroke ?? LINE}" stroke-width="${options.width ?? 2}"${options.dash ? ` stroke-dasharray="${options.dash}"` : ""}${options.cap ? ` stroke-linecap="${options.cap}"` : ""}/>`;

function svg(width, height, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img"><rect width="${width}" height="${height}" fill="#ffffff"/>${body}</svg>\n`;
}

/** 长方形：宽 w 高 h，可标注两条边长。 */
function rectangle(spec) {
  const width = spec.width ?? 360;
  const height = spec.height ?? 200;
  const margin = 48;
  const boxW = width - margin * 2;
  const boxH = height - margin * 2;
  const body = [
    `<rect x="${margin}" y="${margin}" width="${boxW}" height="${boxH}" fill="${FILL}" stroke="${LINE}" stroke-width="2.5" rx="4"/>`,
    spec.width2 ? label(margin + boxW / 2, margin - 12, spec.width2, { fill: ACCENT, weight: 600 }) : "",
    spec.height2 ? label(margin - 16, margin + boxH / 2, spec.height2, { fill: ACCENT, weight: 600 }) : "",
    spec.width2 ? line(margin + boxW * 0.25, margin - 18, margin + boxW * 0.75, margin - 18, { stroke: ACCENT, width: 1.5 }) : "",
    spec.height2 ? line(margin - 24, margin + boxH * 0.25, margin - 24, margin + boxH * 0.75, { stroke: ACCENT, width: 1.5 }) : "",
  ].join("");
  return svg(width, height, body);
}

/** 正方形。 */
function square(spec) {
  return rectangle({ ...spec, width2: spec.side, height2: spec.side });
}

/** 三角形：底 base，高 height。 */
function triangle(spec) {
  const width = spec.width ?? 360;
  const height = spec.height ?? 200;
  const margin = 52;
  const boxW = width - margin * 2;
  const boxH = height - margin * 2;
  const apexX = margin + boxW * (spec.skew ?? 0.42);
  const body = [
    `<path d="M ${margin} ${margin + boxH} L ${apexX} ${margin} L ${margin + boxW} ${margin + boxH} Z" fill="${FILL}" stroke="${LINE}" stroke-width="2.5" stroke-linejoin="round"/>`,
    spec.base ? label(margin + boxW / 2, margin + boxH + 18, spec.base, { fill: ACCENT, weight: 600 }) : "",
    spec.height2 ? line(apexX + 14, margin, apexX + 14, margin + boxH, { stroke: ACCENT, width: 1.5, dash: "5 4" }) : "",
    spec.height2 ? label(apexX + 22, margin + boxH / 2, spec.height2, { fill: ACCENT, anchor: "start", weight: 600 }) : "",
    spec.right ? label(margin + boxW - 6, margin + boxH - 10, spec.right, { fill: ACCENT, anchor: "end", weight: 600 }) : "",
  ].join("");
  return svg(width, height, body);
}

/** 平行四边形：底 base，高 height，斜切 skew。 */
function parallelogram(spec) {
  const width = spec.width ?? 360;
  const height = spec.height ?? 200;
  const margin = 52;
  const boxW = width - margin * 2;
  const boxH = height - margin * 2;
  const shift = boxW * (spec.skew ?? 0.22);
  const body = [
    `<path d="M ${margin + shift} ${margin} L ${margin + boxW} ${margin} L ${margin + boxW - shift} ${margin + boxH} L ${margin} ${margin + boxH} Z" fill="${FILL}" stroke="${LINE}" stroke-width="2.5" stroke-linejoin="round"/>`,
    spec.base ? label(margin + boxW / 2, margin + boxH + 18, spec.base, { fill: ACCENT, weight: 600 }) : "",
    spec.height2 ? line(margin + boxW - shift / 2 - 26, margin, margin + boxW - shift / 2 - 26, margin + boxH, { stroke: ACCENT, width: 1.5, dash: "5 4" }) : "",
    spec.height2 ? label(margin + boxW - shift / 2 - 32, margin + boxH / 2, spec.height2, { fill: ACCENT, anchor: "end", weight: 600 }) : "",
  ].join("");
  return svg(width, height, body);
}

/** 梯形：上底 a、下底 b、高 height。 */
function trapezoid(spec) {
  const width = spec.width ?? 360;
  const height = spec.height ?? 200;
  const margin = 52;
  const boxW = width - margin * 2;
  const boxH = height - margin * 2;
  const topW = boxW * (spec.topRatio ?? 0.55);
  const offset = (boxW - topW) / 2;
  const body = [
    `<path d="M ${margin + offset} ${margin} L ${margin + offset + topW} ${margin} L ${margin + boxW} ${margin + boxH} L ${margin} ${margin + boxH} Z" fill="${FILL}" stroke="${LINE}" stroke-width="2.5" stroke-linejoin="round"/>`,
    spec.top ? label(margin + offset + topW / 2, margin - 12, spec.top, { fill: ACCENT, weight: 600 }) : "",
    spec.bottom ? label(margin + boxW / 2, margin + boxH + 18, spec.bottom, { fill: ACCENT, weight: 600 }) : "",
    spec.height2 ? line(margin + offset + topW + 16, margin, margin + offset + topW + 16, margin + boxH, { stroke: ACCENT, width: 1.5, dash: "5 4" }) : "",
    spec.height2 ? label(margin + offset + topW + 24, margin + boxH / 2, spec.height2, { fill: ACCENT, anchor: "start", weight: 600 }) : "",
  ].join("");
  return svg(width, height, body);
}

/** 角的度量：顶点在左下，标出角度数值与角弧。 */
function angle(spec) {
  const width = spec.width ?? 360;
  const height = spec.height ?? 200;
  const originX = 72;
  const originY = height - 46;
  const arm = spec.arm ?? 190;
  const degrees = spec.degrees ?? 60;
  const radians = (degrees * Math.PI) / 180;
  const endX = originX + arm * Math.cos(radians);
  const endY = originY - arm * Math.sin(radians);
  const arcR = 46;
  const arcEndX = originX + arcR * Math.cos(radians);
  const arcEndY = originY - arcR * Math.sin(radians);
  const body = [
    line(originX, originY, originX + arm, originY),
    line(originX, originY, endX, endY),
    `<path d="M ${originX + arcR} ${originY} A ${arcR} ${arcR} 0 0 0 ${arcEndX} ${arcEndY}" fill="none" stroke="${ACCENT}" stroke-width="2"/>`,
    label(originX + arcR + 22, originY - 14, `${degrees}°`, { fill: ACCENT, weight: 700, size: 15 }),
    `<circle cx="${originX}" cy="${originY}" r="4" fill="${INK}"/>`,
  ].join("");
  return svg(width, height, body);
}

/** 两条平行线与一条截线：初中平行线判定与性质的基本图形。 */
function parallel(spec) {
  const width = spec.width ?? 360;
  const height = spec.height ?? 220;
  const margin = 40;
  const topY = margin + 34;
  const botY = height - margin - 34;
  const tx0 = margin + 52;
  const ty0 = height - 12;
  const tx1 = width - margin - 18;
  const ty1 = 12;
  const parts = [
    line(margin, topY, width - margin, topY, { stroke: LINE, width: 2.5 }),
    line(margin, botY, width - margin, botY, { stroke: LINE, width: 2.5 }),
    line(tx0, ty0, tx1, ty1, { stroke: INK, width: 2 }),
  ];
  // 截线与两条平行线的交点。
  const crossing = (y) => {
    const t = (y - ty0) / (ty1 - ty0);
    return { x: tx0 + t * (tx1 - tx0), y };
  };
  // 截线自左下指向右上；-d 是交点处指向左下的射线。
  const length = Math.hypot(tx1 - tx0, ty1 - ty0);
  const down = { x: -(tx1 - tx0) / length, y: -(ty1 - ty0) / length };
  const arcR = 30;
  for (const angle of spec.angles ?? []) {
    const at = crossing(angle.at === 1 ? botY : topY);
    // 水平射线：side 指明取左半还是右半。
    const along = angle.side === "left" ? { x: -1, y: 0 } : { x: 1, y: 0 };
    const a1 = Math.atan2(along.y, along.x);
    const a2 = Math.atan2(down.y, down.x);
    let diff = a2 - a1;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff <= -Math.PI) diff += 2 * Math.PI;
    const forward = diff > 0;
    const start = forward ? a1 : a2;
    const end = forward ? a2 : a1;
    const sweep = forward ? 1 : 0;
    const p1 = { x: at.x + arcR * Math.cos(start), y: at.y + arcR * Math.sin(start) };
    const p2 = { x: at.x + arcR * Math.cos(end), y: at.y + arcR * Math.sin(end) };
    const mid = start + diff / 2;
    parts.push(`<path d="M ${p1.x.toFixed(1)} ${p1.y.toFixed(1)} A ${arcR} ${arcR} 0 0 ${sweep} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}" fill="none" stroke="${ACCENT}" stroke-width="2"/>`);
    parts.push(label(at.x + arcR * 1.55 * Math.cos(mid), at.y + arcR * 1.55 * Math.sin(mid) + 5, `${angle.deg}°`, { fill: ACCENT, weight: 700, size: 14 }));
  }
  return svg(width, height, parts.join(""));
}

/** 圆：可画半径、弦、直径与切线，供圆与切线、垂径定理、圆周角等题目使用。 */
function circle(spec) {
  const width = spec.width ?? 340;
  const height = spec.height ?? 280;
  const cx = width / 2;
  const cy = height / 2;
  const r = spec.r ?? 84;
  const rad = (deg) => ({ x: cx + r * Math.cos((deg * Math.PI) / 180), y: cy - r * Math.sin((deg * Math.PI) / 180) });
  const parts = [];
  parts.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${FILL}" stroke="${LINE}" stroke-width="2.5"/>`);
  parts.push(`<circle cx="${cx}" cy="${cy}" r="4" fill="${INK}"/>`);
  parts.push(label(cx - 16, cy + 18, spec.center ?? "O", { fill: INK, weight: 600, size: 13 }));
  const pointA = spec.diameter ? rad(180) : rad(205);
  const pointB = spec.diameter ? rad(0) : rad(-25);
  const pointC = spec.pointC ? rad(spec.pointCAngle ?? 62) : null;
  if (spec.showRadius !== false) {
    parts.push(line(cx, cy, pointA.x, pointA.y, { stroke: ACCENT, width: 2 }));
    if (spec.radius) parts.push(label((cx + pointA.x) / 2 - 8, (cy + pointA.y) / 2 + 18, spec.radius, { fill: ACCENT, weight: 600, size: 13 }));
  }
  if (spec.diameter) {
    parts.push(line(pointA.x, pointA.y, pointB.x, pointB.y, { stroke: ACCENT, width: 2 }));
    if (spec.diameterLabel) parts.push(label(cx, cy - 12, spec.diameterLabel, { fill: ACCENT, weight: 600, size: 13 }));
  } else if (spec.showChord) {
    parts.push(line(pointA.x, pointA.y, pointB.x, pointB.y, { stroke: ACCENT, width: 2 }));
  }
  if (spec.chordAC && pointC) parts.push(line(pointA.x, pointA.y, pointC.x, pointC.y, { stroke: ACCENT, width: 2 }));
  if (spec.chordBC && pointC) parts.push(line(pointB.x, pointB.y, pointC.x, pointC.y, { stroke: ACCENT, width: 2 }));
  if (spec.showTangent) {
    const ox = pointA.x - cx;
    const oy = pointA.y - cy;
    const len = Math.hypot(ox, oy) || 1;
    const nx = -oy / len;
    const ny = ox / len;
    const ext = 58;
    parts.push(line(pointA.x - nx * ext, pointA.y - ny * ext, pointA.x + nx * ext, pointA.y + ny * ext, { stroke: INK, width: 2 }));
    parts.push(label(pointA.x + nx * ext + 10, pointA.y + ny * ext - 10, spec.tangentLabel ?? "l", { fill: INK, size: 13 }));
  }
  parts.push(label(pointA.x - 16, pointA.y + 18, spec.pointA ?? "A", { fill: INK, weight: 600, size: 13 }));
  if (!spec.diameter) parts.push(label(pointB.x + 10, pointB.y + 16, spec.pointB ?? "B", { fill: INK, weight: 600, size: 13 }));
  if (pointC) parts.push(label(pointC.x + 10, pointC.y - 6, spec.pointCLabel ?? "C", { fill: INK, weight: 600, size: 13 }));
  return svg(width, height, parts.join(""));
}

/**
 * 菱形：两条对角线互相垂直平分，四条边相等。
 * 可选画出两条对角线并标出交点 O —— 涉及对角线的题目需要它。
 */
function rhombus(spec) {
  const width = spec.width ?? 340;
  const height = spec.height ?? 240;
  const cx = width / 2;
  const cy = height / 2;
  const halfW = (width - 150) / 2;
  const halfH = (height - 110) / 2;
  // 顶点按顺序 A（下）、B（右）、C（上）、D（左），两条对角线 AC 与 BD 互相垂直。
  const A = { x: cx, y: cy + halfH };
  const B = { x: cx + halfW, y: cy };
  const C = { x: cx, y: cy - halfH };
  const D = { x: cx - halfW, y: cy };
  const body = [
    `<path d="M ${A.x} ${A.y} L ${B.x} ${B.y} L ${C.x} ${C.y} L ${D.x} ${D.y} Z" fill="${FILL}" stroke="${LINE}" stroke-width="2.5" stroke-linejoin="round"/>`,
  ];
  if (spec.diagonals !== false) {
    body.push(line(A.x, A.y, C.x, C.y, { stroke: ACCENT, width: 1.8, dash: "5 4" }));
    body.push(line(B.x, B.y, D.x, D.y, { stroke: ACCENT, width: 1.8, dash: "5 4" }));
    body.push(label(cx + 8, cy + 14, "O", { fill: ACCENT, weight: 600, size: 12 }));
  }
  if (spec.side) body.push(label((A.x + B.x) / 2 + 6, (A.y + B.y) / 2 + 16, spec.side, { fill: ACCENT, weight: 600, size: 13 }));
  body.push(label(A.x - 12, A.y + 18, "A", { fill: INK, weight: 600, size: 13 }));
  body.push(label(B.x + 12, B.y + 6, "B", { fill: INK, weight: 600, size: 13 }));
  body.push(label(C.x - 12, C.y - 8, "C", { fill: INK, weight: 600, size: 13 }));
  body.push(label(D.x - 14, D.y + 6, "D", { fill: INK, weight: 600, size: 13 }));
  return svg(width, height, body.join(""));
}

/** 平面直角坐标系：坐标轴、方格与若干点（坐标与标号均为 ASCII）。画布按点自动留白。 */
function axes(spec) {
  const unit = spec.unit ?? 34;
  const pad = 34;
  const points = spec.points ?? [];
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(0, ...xs);
  const maxX = Math.max(0, ...xs);
  const minY = Math.min(0, ...ys);
  const maxY = Math.max(0, ...ys);
  const width = spec.width ?? Math.max(320, (maxX - minX) * unit + pad * 2 + 24);
  const height = spec.height ?? Math.max(280, (maxY - minY) * unit + pad * 2 + 24);
  // 原点放在画布里，让所有点都落在留白之内。
  const originX = spec.originX ?? pad - minX * unit;
  const originY = spec.originY ?? height - pad + minY * unit;
  const parts = [];
  const cols = Math.floor((width - originX) / unit);
  const rows = Math.floor((originY - 16) / unit);
  for (let c = -Math.floor(originX / unit); c <= cols; c += 1) {
    const x = originX + c * unit;
    if (x < 0 || x > width) continue;
    parts.push(line(x, 0, x, height, { stroke: GRID, width: 1 }));
  }
  for (let r = -Math.floor((height - originY) / unit); r <= rows; r += 1) {
    const y = originY - r * unit;
    if (y < 0 || y > height) continue;
    parts.push(line(0, y, width, y, { stroke: GRID, width: 1 }));
  }
  parts.push(line(0, originY, width - 6, originY, { stroke: INK, width: 2 }));
  parts.push(line(originX, height, originX, 10, { stroke: INK, width: 2 }));
  parts.push(`<path d="M ${width - 6} ${originY} L ${width - 18} ${originY - 5} L ${width - 18} ${originY + 5} Z" fill="${INK}"/>`);
  parts.push(`<path d="M ${originX} 10 L ${originX - 5} 22 L ${originX + 5} 22 Z" fill="${INK}"/>`);
  parts.push(label(width - 20, originY + 18, "x", { fill: INK, size: 13 }));
  parts.push(label(originX + 10, 18, "y", { fill: INK, size: 13 }));
  parts.push(label(originX - 13, originY + 17, "O", { fill: INK, weight: 600, size: 13 }));
  for (const outline of spec.outline ?? []) {
    const [x1, y1, x2, y2] = outline;
    parts.push(`<rect x="${Math.min(originX + x1 * unit, originX + x2 * unit).toFixed(1)}" y="${Math.min(originY - y1 * unit, originY - y2 * unit).toFixed(1)}" width="${(Math.abs(x2 - x1) * unit).toFixed(1)}" height="${(Math.abs(y2 - y1) * unit).toFixed(1)}" fill="none" stroke="${ACCENT}" stroke-width="2.5"/>`);
  }
  for (const point of points) {
    const x = originX + point.x * unit;
    const y = originY - point.y * unit;
    parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4.5" fill="${ACCENT}"/>`);
    if (point.label) parts.push(label(x + 9, y - 8, point.label, { fill: ACCENT, weight: 600, size: 13 }));
  }
  return svg(width, height, parts.join(""));
}

/**
 * 任意线段图形：由规格直接给出线段、折线、点与标号。
 * 适合平行线+截线、折叠、坐标系中的多边形等没有专用渲染器的情形。
 */
function lines(spec) {
  const width = spec.width ?? 360;
  const height = spec.height ?? 240;
  const parts = [];
  for (const segment of spec.segments ?? []) {
    parts.push(line(segment[0], segment[1], segment[2], segment[3], { stroke: LINE, width: 2.5 }));
  }
  for (const segment of spec.dashed ?? []) {
    parts.push(line(segment[0], segment[1], segment[2], segment[3], { stroke: ACCENT, width: 1.8, dash: "5 4" }));
  }
  for (const poly of spec.polys ?? []) {
    const points = poly.map(point => `${point[0]} ${point[1]}`).join(" L ");
    parts.push(`<path d="M ${points} Z" fill="${FILL}" stroke="${LINE}" stroke-width="2.5" stroke-linejoin="round"/>`);
  }
  for (const dot of spec.dots ?? []) {
    parts.push(`<circle cx="${dot[0]}" cy="${dot[1]}" r="4" fill="${INK}"/>`);
  }
  for (const text of spec.texts ?? []) {
    parts.push(label(text[0], text[1], text[2], { fill: text[3] === "accent" ? ACCENT : INK, weight: text[3] === "accent" ? 700 : 600, size: text[4] ?? 13 }));
  }
  return svg(width, height, parts.join(""));
}

/** 条形统计图：values 与 labels 均为 ASCII（数字或单字母）。 */
function bars(spec) {
  const width = spec.width ?? 420;
  const height = spec.height ?? 240;
  const values = spec.values ?? [];
  const labels = spec.labels ?? [];
  const marginLeft = 46;
  const marginBottom = 40;
  const marginTop = 22;
  const plotW = width - marginLeft - 22;
  const plotH = height - marginTop - marginBottom;
  const max = Math.max(...values, 1);
  const slot = plotW / Math.max(values.length, 1);
  const barW = Math.min(46, slot * 0.55);
  const parts = [line(marginLeft, marginTop + plotH, marginLeft + plotW, marginTop + plotH, { stroke: INK, width: 1.5 })];
  values.forEach((value, index) => {
    const barH = (value / max) * plotH;
    const x = marginLeft + slot * index + (slot - barW) / 2;
    const y = marginTop + plotH - barH;
    parts.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${barH.toFixed(1)}" fill="${ACCENT}" opacity="0.88" rx="3"/>`);
    parts.push(label(x + barW / 2, y - 7, value, { fill: INK, weight: 600, size: 12 }));
    if (labels[index] !== undefined) parts.push(label(x + barW / 2, marginTop + plotH + 18, labels[index], { fill: MUTED, size: 12 }));
  });
  parts.push(line(marginLeft, marginTop, marginLeft, marginTop + plotH, { stroke: INK, width: 1.5 }));
  if (spec.scale) for (let step = 1; step <= 4; step += 1) {
    const y = marginTop + plotH - (plotH * step) / 5;
    parts.push(line(marginLeft - 5, y, marginLeft, y, { stroke: INK, width: 1 }));
    parts.push(label(marginLeft - 9, y + 4, Math.round((max * step) / 5), { fill: MUTED, anchor: "end", size: 10 }));
  }
  return svg(width, height, parts.join(""));
}

/** 方格纸：每格 side 个单位（仅数字标注）。 */
function grid(spec) {
  const width = spec.width ?? 300;
  const height = spec.height ?? 240;
  const cell = spec.cell ?? 40;
  const cols = Math.floor(width / cell);
  const rows = Math.floor(height / cell);
  const parts = [];
  for (let c = 0; c <= cols; c += 1) parts.push(line(c * cell, 0, c * cell, rows * cell, { stroke: GRID, width: 1 }));
  for (let r = 0; r <= rows; r += 1) parts.push(line(0, r * cell, cols * cell, r * cell, { stroke: GRID, width: 1 }));
  if (spec.shade) for (const [x0, y0, x1, y1] of spec.shade) {
    parts.push(`<rect x="${x0 * cell}" y="${y0 * cell}" width="${(x1 - x0) * cell}" height="${(y1 - y0) * cell}" fill="${ACCENT}" opacity="0.2"/>`);
  }
  if (spec.outline) for (const [x1, y1, x2, y2] of spec.outline) {
    parts.push(`<rect x="${Math.min(x1, x2) * cell}" y="${Math.min(y1, y2) * cell}" width="${Math.abs(x2 - x1) * cell}" height="${Math.abs(y2 - y1) * cell}" fill="none" stroke="${LINE}" stroke-width="2.5"/>`);
  }
  return svg(cols * cell, rows * cell, parts.join(""));
}

/** 数轴：min..max，刻度与标记。 */
function numberLine(spec) {
  const width = spec.width ?? 420;
  const height = spec.height ?? 120;
  const margin = 40;
  const min = spec.min ?? 0;
  const max = spec.max ?? 10;
  const y = height / 2 + 8;
  const plotW = width - margin * 2;
  const parts = [line(margin, y, width - margin, y, { stroke: INK, width: 2 })];
  const step = spec.step ?? 1;
  for (let value = min; value <= max; value += step) {
    const x = margin + ((value - min) / (max - min)) * plotW;
    parts.push(line(x, y - 7, x, y + 7, { stroke: INK, width: 1.5 }));
    parts.push(label(x, y + 24, value, { fill: MUTED, size: 11 }));
  }
  for (const [value, mark] of spec.marks ?? []) {
    const x = margin + ((value - min) / (max - min)) * plotW;
    parts.push(`<circle cx="${x.toFixed(1)}" cy="${y}" r="6" fill="${ACCENT}"/>`);
    if (mark) parts.push(label(x, y - 20, mark, { fill: ACCENT, weight: 600, size: 12 }));
  }
  return svg(width, height, parts.join(""));
}

/**
 * 长方体 / 正方体 ABCD-A₁B₁C₁D₁（斜二测画法）。
 * spec: { width, height, w, h, depth, labels, dims, axes }
 */
function cube(spec) {
  const width = spec.width ?? 360;
  const height = spec.height ?? 300;
  const w = spec.w ?? 150;
  const h = spec.h ?? 120;
  const dx = spec.depth ?? 42;
  const dy = (spec.depth ?? 42) * 0.62;
  const x0 = 58;
  const y0 = height - 52;
  const A = [x0, y0], B = [x0 + w, y0], D = [x0 + dx, y0 - dy], C = [x0 + w + dx, y0 - dy];
  const up = (point) => [point[0], point[1] - h];
  const A1 = up(A), B1 = up(B), C1 = up(C), D1 = up(D);
  const parts = [];
  const edge = (p, q, hidden = false) => parts.push(line(p[0], p[1], q[0], q[1], { stroke: hidden ? MUTED : LINE, width: hidden ? 1.6 : 2.5, dash: hidden ? "5 4" : undefined }));
  // 底面与顶面
  edge(A, B); edge(B, C); edge(C, D, true); edge(D, A);
  edge(A1, B1); edge(B1, C1); edge(C1, D1); edge(D1, A1);
  // 竖棱
  edge(A, A1); edge(B, B1); edge(C, C1); edge(D, D1, true);
  // 顶点标号
  const names = { A, B, C, D, A1, B1, C1, D1 };
  const offsets = { A: [-16, 18], B: [16, 18], C: [18, 12], D: [-26, 6], A1: [-18, -8], B1: [18, -8], C1: [18, -8], D1: [-20, -8] };
  for (const [key, point] of Object.entries(names)) {
    const [ox, oy] = offsets[key];
    const defaultLabel = { A1: "A₁", B1: "B₁", C1: "C₁", D1: "D₁" }[key] ?? key;
    parts.push(label(point[0] + ox, point[1] + oy, (spec.labels ?? {})[key] ?? defaultLabel, { fill: INK, weight: 600, size: 13, anchor: key === "A" || key === "D" || key === "A1" || key === "D1" ? "end" : "start" }));
  }
  // 棱长标注
  if (spec.dims) {
    parts.push(label((A[0] + B[0]) / 2, A[1] + 20, spec.dims.ab ?? "", { fill: ACCENT, weight: 600, size: 12 }));
    parts.push(label((D[0] + C[0]) / 2, D[1] - 8, spec.dims.dc ?? "", { fill: ACCENT, weight: 600, size: 12 }));
    parts.push(label(A1[0] - 10, (A1[1] + A[1]) / 2, spec.dims.aa1 ?? "", { fill: ACCENT, weight: 600, size: 12, anchor: "end" }));
  }
  // 以 A 为原点的三条坐标轴
  if (spec.axes) {
    parts.push(line(A[0], A[1], A[0] - 34, A[1], { stroke: MUTED, width: 1.4 }));
    parts.push(line(A[0], A[1], A[0] + 6, A[1] + 30, { stroke: MUTED, width: 1.4 }));
    parts.push(line(A[0], A[1], A[0] + 20, A[1] - 34, { stroke: MUTED, width: 1.4 }));
    parts.push(label(A[0] - 42, A[1] + 4, "x", { fill: MUTED, size: 12, anchor: "end" }));
    parts.push(label(A[0] + 10, A[1] + 40, "y", { fill: MUTED, size: 12 }));
    parts.push(label(A[0] + 26, A[1] - 40, "z", { fill: MUTED, size: 12 }));
  }
  return svg(width, height, parts.join(""));
}

/** 圆柱：底面椭圆 + 两条侧边，可标注半径与高。 */
function cylinder(spec) {
  const width = spec.width ?? 300;
  const height = spec.height ?? 300;
  const rx = spec.rx ?? 62;
  const ry = spec.ry ?? 20;
  const cx = width / 2;
  const topY = spec.top ?? 62;
  const bottomY = height - 54;
  const parts = [
    `<ellipse cx="${cx}" cy="${topY}" rx="${rx}" ry="${ry}" fill="${FILL}" stroke="${LINE}" stroke-width="2.5"/>`,
    `<path d="M ${cx - rx} ${topY} A ${rx} ${ry} 0 0 0 ${cx + rx} ${topY} L ${cx + rx} ${bottomY} A ${rx} ${ry} 0 0 1 ${cx - rx} ${bottomY} Z" fill="${FILL}" stroke="${LINE}" stroke-width="2.5" stroke-linejoin="round"/>`,
    `<ellipse cx="${cx}" cy="${bottomY}" rx="${rx}" ry="${ry}" fill="none" stroke="${MUTED}" stroke-width="1.6" stroke-dasharray="5 4"/>`,
  ];
  if (spec.radius) parts.push(label(cx + rx / 2, bottomY + ry + 18, spec.radius, { fill: ACCENT, weight: 600, size: 13 }));
  if (spec.height) {
    parts.push(line(cx + rx + 14, topY, cx + rx + 14, bottomY, { stroke: ACCENT, width: 1.5, dash: "5 4" }));
    parts.push(label(cx + rx + 22, (topY + bottomY) / 2, spec.height, { fill: ACCENT, weight: 600, size: 13, anchor: "start" }));
  }
  return svg(width, height, parts.join(""));
}

/** 圆锥：底面椭圆 + 顶点。 */
function cone(spec) {
  const width = spec.width ?? 300;
  const height = spec.height ?? 280;
  const rx = spec.rx ?? 66;
  const ry = spec.ry ?? 20;
  const cx = width / 2;
  const baseY = height - 52;
  const apexY = spec.apex ?? 46;
  const parts = [
    `<path d="M ${cx - rx} ${baseY} L ${cx} ${apexY} L ${cx + rx} ${baseY} A ${rx} ${ry} 0 0 1 ${cx - rx} ${baseY} Z" fill="${FILL}" stroke="${LINE}" stroke-width="2.5" stroke-linejoin="round"/>`,
    `<ellipse cx="${cx}" cy="${baseY}" rx="${rx}" ry="${ry}" fill="none" stroke="${MUTED}" stroke-width="1.6" stroke-dasharray="5 4"/>`,
  ];
  if (spec.radius) parts.push(label(cx + rx / 2, baseY + ry + 18, spec.radius, { fill: ACCENT, weight: 600, size: 13 }));
  if (spec.height) {
    parts.push(line(cx - rx - 16, apexY + 20, cx - rx - 16, baseY, { stroke: ACCENT, width: 1.5, dash: "5 4" }));
    parts.push(label(cx - rx - 24, (apexY + baseY) / 2, spec.height, { fill: ACCENT, weight: 600, size: 13, anchor: "end" }));
  }
  return svg(width, height, parts.join(""));
}

/** 球：圆 + 赤道椭圆（虚线）。 */
function sphere(spec) {
  const width = spec.width ?? 260;
  const height = spec.height ?? 260;
  const cx = width / 2;
  const cy = height / 2;
  const r = spec.r ?? 82;
  const parts = [
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${FILL}" stroke="${LINE}" stroke-width="2.5"/>`,
    `<ellipse cx="${cx}" cy="${cy}" rx="${r}" ry="${r * 0.26}" fill="none" stroke="${MUTED}" stroke-width="1.6" stroke-dasharray="5 4"/>`,
  ];
  if (spec.radius) {
    const angle = (spec.angle ?? 205) * Math.PI / 180;
    const px = cx + r * Math.cos(angle), py = cy - r * Math.sin(angle);
    parts.push(line(cx, cy, px, py, { stroke: ACCENT, width: 2 }));
    parts.push(label((cx + px) / 2 - 10, (cy + py) / 2 + 18, spec.radius, { fill: ACCENT, weight: 600, size: 13 }));
  }
  parts.push(label(cx - 14, cy + 18, spec.center ?? "O", { fill: INK, weight: 600, size: 13 }));
  return svg(width, height, parts.join(""));
}

/** 半球：半圆 + 平底。 */
function hemisphere(spec) {
  const width = spec.width ?? 280;
  const height = spec.height ?? 200;
  const cx = width / 2;
  const baseY = height - 46;
  const r = spec.r ?? 84;
  const parts = [
    `<path d="M ${cx - r} ${baseY} A ${r} ${r} 0 0 1 ${cx + r} ${baseY} Z" fill="${FILL}" stroke="${LINE}" stroke-width="2.5" stroke-linejoin="round"/>`,
    line(cx - r, baseY, cx + r, baseY, { stroke: LINE, width: 2.5 }),
  ];
  if (spec.radius) parts.push(label(cx + r / 2, baseY - 16, spec.radius, { fill: ACCENT, weight: 600, size: 13 }));
  return svg(width, height, parts.join(""));
}

/** 四棱锥：底面正方形 + 顶点（顶点投影落在底面中心）。 */
function pyramid(spec) {
  const width = spec.width ?? 320;
  const height = spec.height ?? 280;
  const cx = width / 2;
  const baseY = height - 54;
  const w = spec.w ?? 130;
  const dx = spec.depth ?? 34;
  const dy = (spec.depth ?? 34) * 0.6;
  const apex = [cx, spec.apex ?? 48];
  const A = [cx - w / 2 - dx / 2, baseY], B = [cx + w / 2 - dx / 2, baseY];
  const C = [cx + w / 2 + dx / 2, baseY - dy], D = [cx - w / 2 + dx / 2, baseY - dy];
  const parts = [
    `<path d="M ${A[0]} ${A[1]} L ${B[0]} ${B[1]} L ${C[0]} ${C[1]} L ${D[0]} ${D[1]} Z" fill="#ffffff" stroke="${LINE}" stroke-width="2.5" stroke-linejoin="round"/>`,
    line(apex[0], apex[1], A[0], A[1], { stroke: LINE, width: 2 }),
    line(apex[0], apex[1], B[0], B[1], { stroke: LINE, width: 2 }),
    line(apex[0], apex[1], C[0], C[1], { stroke: LINE, width: 2 }),
    line(apex[0], apex[1], D[0], D[1], { stroke: LINE, width: 2 }),
  ];
  const names = { P: apex, A, B, C, D };
  for (const [key, point] of Object.entries(names)) {
    parts.push(label(point[0] + (key === "P" ? 0 : key === "A" || key === "D" ? -12 : 12), point[1] + (key === "P" ? -12 : 16), key, { fill: INK, weight: 600, size: 13 }));
  }
  if (spec.height) {
    parts.push(line(cx, baseY, cx, apex[1], { stroke: ACCENT, width: 1.5, dash: "5 4" }));
    parts.push(label(cx + 10, (baseY + apex[1]) / 2, spec.height, { fill: ACCENT, weight: 600, size: 13, anchor: "start" }));
  }
  return svg(width, height, parts.join(""));
}

/** 扇形（圆锥侧面展开图）：圆心角标注。 */
function sector(spec) {
  const width = spec.width ?? 300;
  const height = spec.height ?? 240;
  const cx = width / 2;
  const cy = height - 40;
  const r = spec.r ?? 150;
  const start = (spec.start ?? 200) * Math.PI / 180;
  const sweep = ((spec.degrees ?? 120) * Math.PI) / 180;
  const x1 = cx + r * Math.cos(start), y1 = cy + r * Math.sin(start);
  const x2 = cx + r * Math.cos(start + sweep), y2 = cy + r * Math.sin(start + sweep);
  const parts = [
    `<path d="M ${cx} ${cy} L ${x1.toFixed(1)} ${y1.toFixed(1)} A ${r} ${r} 0 ${sweep > Math.PI ? 1 : 0} 1 ${x2.toFixed(1)} ${y2.toFixed(1)} Z" fill="${FILL}" stroke="${LINE}" stroke-width="2.5" stroke-linejoin="round"/>`,
    label(cx + 12, cy + 4, spec.center ?? "O", { fill: INK, weight: 600, size: 13, anchor: "start" }),
  ];
  if (spec.degrees) {
    const mid = start + sweep / 2;
    parts.push(label(cx + (r + 26) * Math.cos(mid), cy + (r + 26) * Math.sin(mid), `${spec.degrees}°`, { fill: ACCENT, weight: 600, size: 13 }));
  }
  if (spec.radius) parts.push(label(cx + (r / 2) * Math.cos(start), cy + (r / 2) * Math.sin(start) - 8, spec.radius, { fill: ACCENT, weight: 600, size: 13 }));
  if (spec.arc) parts.push(label(cx + (r + 18) * Math.cos(start + sweep / 2), cy + (r + 18) * Math.sin(start + sweep / 2) - 14, spec.arc, { fill: ACCENT, weight: 600, size: 12 }));
  return svg(width, height, parts.join(""));
}

/**
 * 圆锥曲线：坐标系上的椭圆或双曲线，可标焦点与关键点。
 * spec: { shape: "ellipse" | "hyperbola", a, b, c, unit, points, segments, dashed }
 */
function conic(spec) {
  const width = spec.width ?? 340;
  const height = spec.height ?? 300;
  const unit = spec.unit ?? 26;
  const originX = spec.originX ?? width / 2;
  const originY = spec.originY ?? height / 2;
  const a = (spec.a ?? 5) * unit;
  const b = (spec.b ?? 3) * unit;
  const parts = [];
  parts.push(line(0, originY, width - 6, originY, { stroke: INK, width: 1.6 }));
  parts.push(line(originX, height, originX, 10, { stroke: INK, width: 1.6 }));
  parts.push(`<path d="M ${width - 6} ${originY} L ${width - 18} ${originY - 5} L ${width - 18} ${originY + 5} Z" fill="${INK}"/>`);
  parts.push(`<path d="M ${originX} 10 L ${originX - 5} 22 L ${originX + 5} 22 Z" fill="${INK}"/>`);
  parts.push(label(width - 22, originY + 18, "x", { fill: INK, size: 12 }));
  parts.push(label(originX + 10, 18, "y", { fill: INK, size: 12 }));
  parts.push(label(originX - 12, originY + 16, "O", { fill: INK, weight: 600, size: 12 }));
  if (spec.shape === "hyperbola") {
    // 双曲线用双曲参数方程画：x = a·cosh t，y = b·sinh t，标出的点才真在曲线上。
    const branch = (sign) => {
      const points = [];
      for (let step = 0; step <= 24; step += 1) {
        const t = (step / 24) * 1.5;
        points.push(`${(originX + sign * a * Math.cosh(t)).toFixed(1)} ${(originY - b * Math.sinh(t)).toFixed(1)}`);
      }
      return `<path d="M ${points.join(" L ")}" fill="none" stroke="${LINE}" stroke-width="2.5" stroke-linecap="round"/>`;
    };
    parts.push(branch(-1), branch(1));
  } else {
    parts.push(`<ellipse cx="${originX}" cy="${originY}" rx="${a}" ry="${b}" fill="${FILL}" stroke="${LINE}" stroke-width="2.5"/>`);
  }
  if (spec.c) {
    for (const sign of [-1, 1]) {
      const fx = originX + sign * spec.c * unit;
      parts.push(`<circle cx="${fx.toFixed(1)}" cy="${originY}" r="4" fill="${ACCENT}"/>`);
      parts.push(label(fx, originY + 20, sign < 0 ? (spec.leftFocus ?? "F₁") : (spec.rightFocus ?? "F₂"), { fill: ACCENT, weight: 600, size: 12 }));
    }
  }
  for (const point of spec.points ?? []) {
    const px = originX + point[0] * unit, py = originY - point[1] * unit;
    parts.push(`<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="4.5" fill="${INK}"/>`);
    if (point[2]) parts.push(label(px + 10, py - 8, point[2], { fill: INK, weight: 600, size: 12, anchor: "start" }));
  }
  // 直线（割线 / 切线）：坐标用曲线所在的单位制。
  for (const segment of spec.segments ?? []) {
    parts.push(line(originX + segment[0] * unit, originY - segment[1] * unit, originX + segment[2] * unit, originY - segment[3] * unit, { stroke: ACCENT, width: 2 }));
  }
  for (const segment of spec.dashed ?? []) {
    parts.push(line(originX + segment[0] * unit, originY - segment[1] * unit, originX + segment[2] * unit, originY - segment[3] * unit, { stroke: MUTED, width: 1.6, dash: "5 4" }));
  }
  return svg(width, height, parts.join(""));
}

/**
 * 函数图象：坐标系上的曲线（折线近似），可标关键点。
 * spec: { points: [[x,y], ...], marks: [[x,y,label]], width, height, unit }
 */
function curve(spec) {
  const width = spec.width ?? 340;
  const height = spec.height ?? 280;
  const unit = spec.unit ?? 26;
  const originX = spec.originX ?? width / 2;
  const originY = spec.originY ?? height / 2;
  const parts = [];
  parts.push(line(0, originY, width - 6, originY, { stroke: INK, width: 1.6 }));
  parts.push(line(originX, height, originX, 10, { stroke: INK, width: 1.6 }));
  parts.push(`<path d="M ${width - 6} ${originY} L ${width - 18} ${originY - 5} L ${width - 18} ${originY + 5} Z" fill="${INK}"/>`);
  parts.push(`<path d="M ${originX} 10 L ${originX - 5} 22 L ${originX + 5} 22 Z" fill="${INK}"/>`);
  parts.push(label(width - 22, originY + 18, "x", { fill: INK, size: 12 }));
  parts.push(label(originX + 10, 18, "y", { fill: INK, size: 12 }));
  parts.push(label(originX - 12, originY + 16, "O", { fill: INK, weight: 600, size: 12 }));
  const points = (spec.points ?? []).map(point => `${(originX + point[0] * unit).toFixed(1)} ${(originY - point[1] * unit).toFixed(1)}`);
  if (points.length > 1) parts.push(`<path d="M ${points.join(" L ")}" fill="none" stroke="${LINE}" stroke-width="2.5" stroke-linecap="round"/>`);
  for (const mark of spec.marks ?? []) {
    const px = originX + mark[0] * unit, py = originY - mark[1] * unit;
    parts.push(`<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="4.5" fill="${ACCENT}"/>`);
    if (mark[2]) parts.push(label(px + 10, py - 8, mark[2], { fill: ACCENT, weight: 600, size: 12, anchor: "start" }));
  }
  return svg(width, height, parts.join(""));
}

const renderers = { rectangle, square, triangle, parallelogram, trapezoid, angle, bars, grid, numberLine, parallel, circle, rhombus, axes, lines, cube, cylinder, cone, sphere, hemisphere, pyramid, sector, conic, curve };

const digest = (value) => createHash("sha256").update(value).digest("hex");

// 图形规格可能分批产出（figures-<unitId>.json），这里读取全部并合并。
const specFiles = (await readdir(bankRoot)).filter(name => name.startsWith("figures") && name.endsWith(".json")).sort();
const spec = {};
for (const file of specFiles) {
  const part = JSON.parse(await readFile(join(bankRoot, file), "utf8"));
  for (const [key, figure] of Object.entries(part)) {
    if (spec[key]) {
      // 同一份规格可能被写进多个批次文件；内容一致就跳过，不一致才是真冲突。
      if (JSON.stringify(spec[key]) === JSON.stringify(figure)) continue;
      throw new Error(`插图规格重复且不一致：${key}（来自 ${file}）`);
    }
    spec[key] = figure;
  }
}
if (!specFiles.length) {
  console.log("没有找到插图规格文件（content/bank/figures*.json），跳过。");
  process.exit(0);
}
const written = [];
for (const [key, figure] of Object.entries(spec)) {
  const render = renderers[figure.kind];
  if (!render) throw new Error(`未知的插图类型：${figure.kind}（${key}）`);
  const markup = render(figure);
  // 图形内只允许 ASCII 数字与几何符号（° × ÷ − 这类符号字体都有）。
  // 真正的风险是「字母类」字符——中文或其他文字在缺字体的机器上会渲染成方块。
  const stripped = markup.replace(/<\/?svg[^>]*>|<\/?text[^>]*>|font-family="[^"]*"|fill="#[0-9a-fA-F]{6}"|stroke="#[0-9a-fA-F]{6}"/g, "");
  const bad = [...new Set(stripped.match(/[^\x00-\x7F]/g) ?? [])].filter(character => /\p{L}/u.test(character));
  if (bad.length) throw new Error(`插图 ${key} 含有文字字符（${bad.join(" ")}），缺字体的机器上会渲染成方块`);
  const target = join(outRoot, `${key}.svg`);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, markup, "utf8");
  written.push({ key, bytes: Buffer.byteLength(markup, "utf8"), digest: digest(markup).slice(0, 12) });
}

console.log(JSON.stringify({ generated: written.length, files: written.map(item => item.key) }, null, 2));
