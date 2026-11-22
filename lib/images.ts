// Shrink big screenshots/photos in the browser before upload, then send to /api/images.

const MAX_SIDE = 2400;
const SOFT_LIMIT = 1.5 * 1024 * 1024;

async function shrink(file: File): Promise<Blob> {
  if (file.type === "image/gif") return file;
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return file;
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  if (scale === 1 && file.size <= SOFT_LIMIT) {
    bmp.close();
    return file;
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/webp", 0.9));
  return blob && blob.size < file.size ? blob : file;
}

export async function uploadImage(file: File, nodeId: string): Promise<string> {
  const blob = await shrink(file);
  const ext = blob.type.split("/")[1] ?? "png";
  const form = new FormData();
  form.append("file", new File([blob], `paste.${ext}`, { type: blob.type || file.type }));
  form.append("nodeId", nodeId);
  const res = await fetch("/api/images", { method: "POST", body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "圖片上傳失敗");
  return data.url as string;
}
