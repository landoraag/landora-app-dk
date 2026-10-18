// Upload de imagens via Cloudinary (plano gratuito, sem cartão de crédito).
// Usa "unsigned upload preset" — configurado direto no painel do Cloudinary,
// sem precisar de servidor nem expor nenhuma chave secreta no código.

const CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
const UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;

export async function uploadImage(file, folder = "landora/landing-pages") {
  if (!CLOUD_NAME || !UPLOAD_PRESET) {
    throw new Error(
      "Cloudinary não configurado: preencha VITE_CLOUDINARY_CLOUD_NAME e VITE_CLOUDINARY_UPLOAD_PRESET no .env"
    );
  }

  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", UPLOAD_PRESET);
  formData.append("folder", folder);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || "Falha ao enviar a imagem para o Cloudinary.");
  }

  const data = await res.json();
  return { url: data.secure_url, publicId: data.public_id };
}

// Envia qualquer arquivo. resourceType: "auto" (o Cloudinary descobre: áudio, por exemplo)
// ou "raw" (documentos e compactados: PDF, Word, Excel, ZIP… guardados exatamente como são).
export async function uploadFile(file, folder = "landora/chat", resourceType = "auto") {
  if (!CLOUD_NAME || !UPLOAD_PRESET) {
    throw new Error(
      "Cloudinary não configurado: preencha VITE_CLOUDINARY_CLOUD_NAME e VITE_CLOUDINARY_UPLOAD_PRESET no .env"
    );
  }
  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", UPLOAD_PRESET);
  formData.append("folder", folder);
  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/${resourceType}/upload`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || "Falha ao enviar o arquivo para o Cloudinary.");
  }
  const data = await res.json();
  return { url: data.secure_url, publicId: data.public_id, duration: data.duration || 0 };
}

// Link que faz o navegador BAIXAR o arquivo do Cloudinary (em vez de só abrir).
export function downloadUrl(url) {
  // Arquivos "raw" (documentos) não aceitam esse ajuste: o navegador já baixa ou abre direto.
  if (!url || url.includes("/raw/upload/")) return url;
  return url.includes("/upload/") ? url.replace("/upload/", "/upload/fl_attachment/") : url;
}
