// Só no navegador. Foto de celular sai com 4–8 MB; no 4G do técnico isso
// trava o envio. Reduz pro lado maior de `max` px em JPEG antes de mandar —
// suficiente pra ler plaqueta de motor. Se o navegador não conseguir
// decodificar (formato raro), manda o arquivo como veio.
export async function fotoReduzidaDataUrl(file: File, max = 1600, qualidade = 0.82): Promise<string> {
  const original = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = original;
    });
    const escala = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * escala);
    canvas.height = Math.round(img.naturalHeight * escala);
    const ctx = canvas.getContext('2d');
    if (!ctx) return original;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', qualidade);
  } catch {
    return original;
  }
}
