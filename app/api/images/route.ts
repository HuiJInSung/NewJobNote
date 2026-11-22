import { Binary } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { toId } from "@/lib/nodes";
import { handle, jsonError } from "@/lib/http";

const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export async function POST(request: Request) {
  return handle(async () => {
    const form = await request.formData();
    const file = form.get("file");
    const nodeId = toId(String(form.get("nodeId") ?? ""));
    if (!(file instanceof File)) return jsonError("沒有收到圖片");
    if (!nodeId) return jsonError("缺少節點 id");
    if (!ALLOWED.includes(file.type)) return jsonError("只支援 PNG、JPEG、WebP、GIF 圖片");
    if (file.size > MAX_BYTES) return jsonError("圖片超過 8MB，請縮小後再貼上");

    const db = await getDb();
    const res = await db.collection("images").insertOne({
      nodeId,
      contentType: file.type,
      size: file.size,
      data: new Binary(Buffer.from(await file.arrayBuffer())),
      createdAt: new Date(),
    });
    return Response.json({ url: `/api/images/${res.insertedId}` }, { status: 201 });
  });
}
