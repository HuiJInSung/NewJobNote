import { connection } from "next/server";
import { getDb } from "@/lib/mongodb";
import { ensureCategories, serialize } from "@/lib/nodes";
import { handle } from "@/lib/http";

export async function GET() {
  await connection();
  return handle(async () => {
    await ensureCategories();
    const db = await getDb();
    const docs = await db
      .collection("nodes")
      .find({}, { projection: { content: 0 } })
      .sort({ level: 1, order: 1, createdAt: 1 })
      .toArray();
    return Response.json({ nodes: docs.map(serialize) });
  });
}
