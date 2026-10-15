// Reduz imagens grandes antes de enviar (fotos de celular e prints em tela cheia costumam ter vários MB).
// GIFs são enviados como estão, para não perder a animação.
export async function shrinkImage(file, maxSide = 1600, quality = 0.86) {
  if (file.type === "image/gif") return file;
  let bmp;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    return file; // formato que o navegador não consegue abrir: envia como está
  }
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  if (scale === 1 && file.size < 1.5 * 1024 * 1024) return file;

  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff"; // fundo branco para PNGs com transparência virarem JPEG
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  return blob ? new File([blob], "imagem.jpg", { type: "image/jpeg" }) : file;
}
