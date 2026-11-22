import qrcode from 'qrcode-generator';

/** Draws a QR Code (black on white, 4-module quiet zone) as close to `size` CSS pixels as whole cells allow. */
export function drawQr(canvas: HTMLCanvasElement, text: string, size: number): void {
  const qr = qrcode(0, 'M'); // 0 = the smallest version that fits
  qr.addData(text, 'Alphanumeric');
  qr.make();
  const modules = qr.getModuleCount();
  const total = modules + 8;
  const cell = Math.max(1, Math.floor((size * devicePixelRatio) / total));

  canvas.width = canvas.height = total * cell;
  canvas.style.width = canvas.style.height = `${(total * cell) / devicePixelRatio}px`;

  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  for (let r = 0; r < modules; r++) {
    for (let c = 0; c < modules; c++) {
      if (qr.isDark(r, c)) ctx.fillRect((c + 4) * cell, (r + 4) * cell, cell, cell);
    }
  }
}
