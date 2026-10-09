import { alias } from "drizzle-orm/pg-core";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { documents, users } from "@/db/schema";
import { AppError, ForbiddenError } from "./errors";
import { getProjectForUser } from "./project";

// 同一张 users 表需两次关联（创建者/更新者），用别名区分
const updater = alias(users, "updater");

const DOC_TITLE_MAX = 120;

function normalizeTitle(raw: string) {
  const title = raw.trim();
  if (!title) throw new AppError("文档标题不可为空");
  if (title.length > DOC_TITLE_MAX)
    throw new AppError(`文档标题不可超过 ${DOC_TITLE_MAX} 字`);
  return title;
}

function normalizeCategory(raw?: string | null) {
  const c = (raw ?? "").trim();
  return c || null;
}

// ILIKE 通配符转义，配合 ESCAPE '\'
function escapeLike(raw: string) {
  return raw.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// 全文搜索：中文不适合 PG 默认分词器，用 ILIKE 匹配标题/正文
function contains(q: string) {
  const pattern = `%${escapeLike(q)}%`;
  return sql`(${documents.title} ilike ${pattern} escape '\\' or ${documents.content} ilike ${pattern} escape '\\')`;
}

// 文档访问收敛点：取到文档并校验访问者为其项目成员；不存在/越权抛错
async function requireDocumentAccess(actorId: string, documentId: string) {
  const [doc] = await db.select().from(documents).where(eq(documents.id, documentId));
  if (!doc) throw new AppError("文档不存在");
  const access = await getProjectForUser(actorId, doc.projectId);
  if (!access) throw new ForbiddenError();
  return doc;
}

// 列举项目文档（倒序），支持按关键词搜索与按分类过滤
export async function listProjectDocuments(
  actorId: string,
  projectId: string,
  opts: { q?: string; category?: string } = {},
) {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new ForbiddenError();

  const q = opts.q?.trim();
  const category = opts.category?.trim();

  return db
    .select({
      id: documents.id,
      title: documents.title,
      category: documents.category,
      createdAt: documents.createdAt,
      updatedAt: documents.updatedAt,
      updatedByName: updater.name,
    })
    .from(documents)
    .leftJoin(updater, eq(documents.updatedById, updater.id))
    .where(
      and(
        eq(documents.projectId, projectId),
        ...(q ? [contains(q)] : []),
        ...(category ? [eq(documents.category, category)] : []),
      ),
    )
    .orderBy(desc(documents.updatedAt));
}

// 去重返回项目的分类列表（忽略空分类）
export async function listDocumentCategories(actorId: string, projectId: string) {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new ForbiddenError();

  const rows = await db
    .selectDistinct({ category: documents.category })
    .from(documents)
    .where(eq(documents.projectId, projectId));

  return rows
    .map((r) => r.category?.trim())
    .filter((c): c is string => Boolean(c))
    .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

// 取单文档（含创建/更新人姓名）；不存在或无访问权返回 null，供页面 notFound()
export async function getDocument(actorId: string, documentId: string) {
  const [doc] = await db
    .select({
      id: documents.id,
      projectId: documents.projectId,
      title: documents.title,
      content: documents.content,
      category: documents.category,
      createdByName: users.name,
      updatedById: documents.updatedById,
      updatedByName: updater.name,
      createdAt: documents.createdAt,
      updatedAt: documents.updatedAt,
    })
    .from(documents)
    .innerJoin(users, eq(documents.createdById, users.id))
    .leftJoin(updater, eq(documents.updatedById, updater.id))
    .where(eq(documents.id, documentId));
  if (!doc) return null;

  const access = await getProjectForUser(actorId, doc.projectId);
  if (!access) return null;
  return doc;
}

// 新建文档：项目内任一成员可建（全员可编辑口径）
export async function createDocument(
  actorId: string,
  projectId: string,
  input: { title: string; content?: string; category?: string | null },
) {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new ForbiddenError();

  const title = normalizeTitle(input.title);
  const [doc] = await db
    .insert(documents)
    .values({
      projectId,
      title,
      content: input.content ?? "",
      category: normalizeCategory(input.category),
      createdById: actorId,
      updatedById: actorId,
    })
    .returning();
  return doc;
}

// 编辑文档：白名单构造 set（勿 ...patch 展开，防夹带越权字段），并刷新更新人/时间
export async function updateDocument(
  actorId: string,
  documentId: string,
  patch: { title?: string; content?: string; category?: string | null },
) {
  await requireDocumentAccess(actorId, documentId);

  const title = patch.title === undefined ? undefined : normalizeTitle(patch.title);
  const category =
    patch.category === undefined ? undefined : normalizeCategory(patch.category);

  const [updated] = await db
    .update(documents)
    .set({
      ...(title !== undefined && { title }),
      ...(patch.content !== undefined && { content: patch.content }),
      ...(category !== undefined && { category }),
      updatedAt: new Date(),
      updatedById: actorId,
    })
    .where(eq(documents.id, documentId))
    .returning();
  return updated;
}

// 删除文档：项目内任一成员可删
export async function deleteDocument(actorId: string, documentId: string) {
  await requireDocumentAccess(actorId, documentId);
  await db.delete(documents).where(eq(documents.id, documentId));
}
