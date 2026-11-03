import { createCanvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import { detectOcclusionRectsByOcr } from '../ocr';

// Real OCR regression: requires the English Tesseract model (downloaded on first run).
describe('real image label OCR', () => {
  it.each([12, 32])('reads complete %i px labels with correctly normalized boxes', async (size) => {
    const canvas = createCanvas(1200, 800);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 1200, 800);
    ctx.fillStyle = 'black'; ctx.font = `${size}px Arial`;
    const labels = ['Left atrium', 'Right ventricle', 'Aorta', 'Pulmonary artery'];
    labels.forEach((label, i) => ctx.fillText(label, 100 + (i % 2) * 550, 180 + Math.floor(i / 2) * 350));
    const rects = await detectOcclusionRectsByOcr(canvas.toBuffer('image/png'));
    expect(rects.map(r => r.label)).toEqual(labels);
    rects.forEach((r, i) => {
      expect(r.x).toBeCloseTo((100 + (i % 2) * 550) / 1200, 2);
      expect(r.y).toBeLessThan((180 + Math.floor(i / 2) * 350) / 800);
      expect(r.x + r.width).toBeLessThanOrEqual(1);
      expect(r.y + r.height).toBeLessThanOrEqual(1);
    });
  }, 30000);
  it('does not invent labels on a blank image', async () => {
    const canvas = createCanvas(1200, 800);
    const ctx = canvas.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 1200, 800);
    expect(await detectOcclusionRectsByOcr(canvas.toBuffer('image/png'))).toEqual([]);
  }, 30000);
});
