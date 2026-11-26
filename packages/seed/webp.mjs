import sharp from 'sharp';

/**
 * SVG -> square WebP raster with alpha. Fluent Emoji SVGs are heavy (gradients,
 * up to 130 KB) and slow to draw in long grids on Android; a 192 px WebP is a
 * few KB and decodes fast.
 */
export function svgToWebp(svg, size = 192) {
  return sharp(Buffer.from(svg), { density: 300 })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .webp({ quality: 85, alphaQuality: 90, effort: 6 })
    .toBuffer();
}
