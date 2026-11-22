import { connection } from "next/server";
import { getDb } from "@/lib/mongodb";
import { toId } from "@/lib/nodes";
import { handle, jsonError } from "@/lib/http";

export async function GET(_req: Request, ctx: RouteContext<"/api/images/[id]">) {
  await connection();
  return handle(async () => {
    const id = toId((await ctx.params).id);
    if (!id) return jsonError("無效的 id");
    const db = await getDb();
    const img = await db.collection("images").findOne({ _id: id });
    if (!img) return jsonError("找不到圖片", 404);
    return new Response(new Uint8Array(img.data.buffer), {
      headers: {
        "Content-Type": img.contentType,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  });
}
