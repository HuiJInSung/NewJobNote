import dns from "node:dns";
import { MongoClient, type Db } from "mongodb";

// Node on Windows sometimes reports only 127.0.0.1 as its DNS server, which breaks
// the SRV lookup that mongodb+srv:// URIs need. Fall back to public resolvers then.
function fixDnsServers() {
  const custom = process.env.MONGODB_DNS_SERVERS?.split(",").map((s) => s.trim()).filter(Boolean);
  const fallback = custom?.length ? custom : ["8.8.8.8", "1.1.1.1"];
  const loopbackOnly = (servers: string[]) =>
    servers.length === 0 || servers.every((s) => s.startsWith("127.") || s === "::1");
  // dns and dns.promises can hold separate server lists; the driver uses dns.promises.
  if (loopbackOnly(dns.getServers())) dns.setServers(fallback);
  if (loopbackOnly(dns.promises.getServers())) dns.promises.setServers(fallback);
}

type GlobalWithMongo = typeof globalThis & {
  _mongoClientPromise?: Promise<MongoClient>;
  _mongoIndexesReady?: Promise<void>;
};
const g = globalThis as GlobalWithMongo;

function dbNameFromUri(u: string): string {
  const m = u.match(/^mongodb(?:\+srv)?:\/\/[^/]+\/([^?]+)/);
  return m && m[1] ? decodeURIComponent(m[1]) : "newjobnote";
}

export async function getDb(): Promise<Db> {
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) throw new Error("缺少環境變數 MONGODB_URI（請檢查 .env.local）");
  if (!g._mongoClientPromise) {
    fixDnsServers();
    g._mongoClientPromise = new MongoClient(uri).connect().catch((e) => {
      g._mongoClientPromise = undefined; // allow retry on next request
      throw e;
    });
  }
  const client = await g._mongoClientPromise;
  const db = client.db(process.env.MONGODB_DB || dbNameFromUri(uri));
  if (!g._mongoIndexesReady) {
    g._mongoIndexesReady = Promise.all([
      db.collection("nodes").createIndex({ parentId: 1, order: 1 }),
      db.collection("images").createIndex({ nodeId: 1 }),
    ]).then(
      () => undefined,
      (e) => {
        g._mongoIndexesReady = undefined;
        throw e;
      },
    );
  }
  await g._mongoIndexesReady;
  return db;
}
