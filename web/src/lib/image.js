// Recorta a imagem escolhida no centro, na proporção pedida, e devolve um data URL pequeno
// (avatar, ícone e banner de servidor ficam no banco como data URL).
export function pickImage(width = 256, height = width) {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp,image/gif';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const scale = Math.min(img.width / width, img.height / height);
        const sw = width * scale;
        const sh = height * scale;
        canvas.getContext('2d').drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, 0, 0, width, height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/webp', 0.85));
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Não foi possível ler essa imagem.'));
      };
      img.src = url;
    };
    input.click();
  });
}
