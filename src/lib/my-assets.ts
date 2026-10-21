import { alias } from "drizzle-orm/pg-core";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { assets, documents, users } from "@/db/schema";

// ILIKE 通配符转义，配合 ESCAPE '\'（与 lib/document.ts 一致；中文不分词，用 ILIKE）
function escapeLike(raw: string) {
  return raw.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// 同一张 users 表：文档取「更新人」需与上传人区分，用别名
const updater = alias(users, "updater");

const LIST_LIMIT = 500;
const SNIPPET_LEN = 80;

export type MyAssetKind = "document" | "asset";

export type MyAssetRow = {
  kind: MyAssetKind;
  id: string;
  projectId: string;
  title: string;
  snippet: string;
  updatedAt: Date;
  authorName: string | null;
  category: string | null;
  assetType: "file" | "link" | null;
  url: string | null;
  fileSize: number | null;
  fileMime: string | null;
};

// 正文摘要：命中关键词时截取命中处附近，否则取开头；换行折成空格
function excerpt(content: string, q: string): string {
  const text = content.replace(/\s+/g, " ").trim();
  if (!text) return "";
  const term = q.trim();
  if (term) {
    const idx = text.toLowerCase().indexOf(term.toLowerCase());
    if (idx >= 0) {
      const start = Math.max(0, idx - 30);
      return text.slice(start, start + SNIPPET_LEN);
    }
  }
  return text.slice(0, SNIPPET_LEN);
}

// 我的资产口径 = 我参与的全部项目下的 云文档 + 未归档资料
export async function countMyAssets(projectIds: string[]): Promise<number> {
  if (projectIds.length === 0) return 0;
  const [d, a] = await Promise.all([
    db
      .select({ c: sql<number>`count(*)::int` })
      .from(documents)
      .where(inArray(documents.projectId, projectIds)),
    db
      .select({ c: sql<number>`count(*)::int` })
      .from(assets)
      .where(and(inArray(assets.projectId, projectIds), eq(assets.isArchived, false))),
  ]);
  return (d[0]?.c ?? 0) + (a[0]?.c ?? 0);
}

// 汇总我参与的全部项目下的文档与资料，混排（updatedAt 倒序）；
// q 非空时按「文档标题/正文」「资料名称/描述」ILIKE 过滤。
export async function listMyAssets(
  projectIds: string[],
  opts: { q?: string } = {},
): Promise<MyAssetRow[]> {
  if (projectIds.length === 0) return [];
  const q = opts.q?.trim() ?? "";
  const pat = q ? `%${escapeLike(q)}%` : null;

  const [docs, assetRows] = await Promise.all([
    db
      .select({
        id: documents.id,
        projectId: documents.projectId,
        title: documents.title,
        content: documents.content,
        category: documents.category,
        updatedAt: documents.updatedAt,
        updatedByName: updater.name,
      })
      .from(documents)
      .leftJoin(updater, eq(documents.updatedById, updater.id))
      .where(
        and(
          inArray(documents.projectId, projectIds),
          ...(pat
            ? [
                sql`(${documents.title} ilike ${pat} escape '\\' or ${documents.content} ilike ${pat} escape '\\')`,
              ]
            : []),
        ),
      )
      .orderBy(desc(documents.updatedAt))
      .limit(LIST_LIMIT),

    db
      .select({
        id: assets.id,
        projectId: assets.projectId,
        name: assets.name,
        description: assets.description,
        assetType: assets.assetType,
        url: assets.url,
        fileSize: assets.fileSize,
        fileMime: assets.fileMime,
        updatedAt: assets.updatedAt,
        uploadUserName: users.name,
      })
      .from(assets)
      .leftJoin(users, eq(assets.uploadUserId, users.id))
      .where(
        and(
          inArray(assets.projectId, projectIds),
          eq(assets.isArchived, false),
          ...(pat
            ? [
                sql`(${assets.name} ilike ${pat} escape '\\' or coalesce(${assets.description}, '') ilike ${pat} escape '\\')`,
              ]
            : []),
        ),
      )
      .orderBy(desc(assets.updatedAt))
      .limit(LIST_LIMIT),
  ]);

  const rows: MyAssetRow[] = [
    ...docs.map((d) => ({
      kind: "document" as const,
      id: d.id,
      projectId: d.projectId,
      title: d.title,
      snippet: excerpt(d.content, q),
      updatedAt: d.updatedAt,
      authorName: d.updatedByName,
      category: d.category,
      assetType: null,
      url: null,
      fileSize: null,
      fileMime: null,
    })),
    ...assetRows.map((a) => ({
      kind: "asset" as const,
      id: a.id,
      projectId: a.projectId,
      title: a.name,
      snippet: a.description ?? "",
      updatedAt: a.updatedAt,
      authorName: a.uploadUserName,
      category: null,
      assetType: a.assetType,
      url: a.url,
      fileSize: a.fileSize,
      fileMime: a.fileMime,
    })),
  ];

  rows.sort((x, y) => y.updatedAt.getTime() - x.updatedAt.getTime());
  return rows;
}
