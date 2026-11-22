import { connection } from "next/server";
import { getDb } from "@/lib/mongodb";
import { collectSubtree, noteHasContent, serialize, serializeDetail, toId } from "@/lib/nodes";
import { handle, jsonError } from "@/lib/http";

export async function GET(_req: Request, ctx: RouteContext<"/api/nodes/[id]">) {
  await connection();
  return handle(async () => {
    const id = toId((await ctx.params).id);
    if (!id) return jsonError("無效的 id");
    const db = await getDb();
    const doc = await db.collection("nodes").findOne({ _id: id });
    if (!doc) return jsonError("找不到這個節點", 404);
    return Response.json({ node: serializeDetail(doc) });
  });
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/nodes/[id]">) {
  return handle(async () => {
    const id = toId((await ctx.params).id);
    if (!id) return jsonError("無效的 id");
    const body = await request.json().catch(() => null);
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof body?.name === "string") {
      const name = body.name.trim().slice(0, 80);
      if (!name) return jsonError("名稱不可空白");
      set.name = name;
    }
    if (typeof body?.content === "string") {
      if (body.content.length > 4_000_000) return jsonError("筆記內容過長");
      set.content = body.content;
      set.hasNote = noteHasContent(body.content);
    }
    const db = await getDb();
    const doc = await db
      .collection("nodes")
      .findOneAndUpdate({ _id: id }, { $set: set }, { returnDocument: "after", projection: { content: 0 } });
    if (!doc) return jsonError("找不到這個節點", 404);
    return Response.json({ node: serialize(doc) });
  });
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/nodes/[id]">) {
  return handle(async () => {
    const id = toId((await ctx.params).id);
    if (!id) return jsonError("無效的 id");
    const db = await getDb();
    const doc = await db.collection("nodes").findOne({ _id: id }, { projection: { _id: 1 } });
    if (!doc) return jsonError("找不到這個節點", 404);
    const ids = await collectSubtree(id);
    await db.collection("nodes").deleteMany({ _id: { $in: ids } });
    await db.collection("images").deleteMany({ nodeId: { $in: ids } });
    return Response.json({ deleted: ids.map(String) });
  });
}
