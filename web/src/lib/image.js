// Redimensiona a imagem escolhida para um quadrado e devolve um data URL pequeno
// (avatar e ícone de servidor ficam no banco como data URL).
export function pickImage(size = 256) {
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
        canvas.width = canvas.height = size;
        const side = Math.min(img.width, img.height);
        canvas.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
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
