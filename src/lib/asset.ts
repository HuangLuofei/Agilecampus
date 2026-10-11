import { mkdir, unlink, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/db";
import { assets, documents, tasks, users, type AssetType } from "@/db/schema";
import { AppError, ForbiddenError } from "./errors";
import { getProjectForUser } from "./project";

// 上传目录：开发阶段落 public/，经 /uploads/<name> 直取；生产须换对象存储（public 在 standalone 构建时静态复制）
const UPLOAD_DIR = "uploads";
// MVP 单文件上限 50MB
const MAX_FILE_SIZE = 50 * 1024 * 1024;
// 后缀白名单（统一小写比较）
const ALLOWED_EXTENSIONS = new Set([
  "pdf", "png", "jpg", "jpeg", "gif", "webp", "svg",
  "doc", "docx", "xls", "xlsx", "ppt", "pptx",
  "md", "txt", "csv", "json",
  "zip", "rar", "7z",
  "mp4", "mp3", "wav",
]);

const NAME_MAX = 120;

function normalizeName(raw: string) {
  const name = raw.trim();
  if (!name) throw new AppError("资产名不能为空");
  if (name.length > NAME_MAX) throw new AppError(`资产名不可超过 ${NAME_MAX} 字`);
  return name;
}

// 项目访问收敛：经 projectId → team 校验，非团队成员 Forbidden（沿用 getProjectForUser 口径）
async function requireProjectAccess(actorId: string, projectId: string) {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new ForbiddenError();
  return access;
}

// 取资产 + 校验访问：不存在报「资产不存在」，非项目成员抛 Forbidden（与 task/document 同口径）
async function requireAssetAccess(actorId: string, assetId: string) {
  const [asset] = await db.select().from(assets).where(eq(assets.id, assetId));
  if (!asset) throw new AppError("资产不存在");
  await requireProjectAccess(actorId, asset.projectId);
  return asset;
}

// 归档锁定：编辑/删除/绑定一律禁止（403）
function assertNotArchived(asset: { isArchived: boolean }) {
  if (asset.isArchived) throw new ForbiddenError("资产已归档，禁止修改或删除");
}

// 任务须属于资产所在项目（防跨项目绑定）
async function assertTaskInProject(projectId: string, taskId: string) {
  const [t] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId)));
  if (!t) throw new AppError("任务不属于该项目");
}

// 文档须属于资产所在项目
async function assertDocInProject(projectId: string, docId: string) {
  const [d] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.id, docId), eq(documents.projectId, projectId)));
  if (!d) throw new AppError("文档不属于该项目");
}

// 简易文件上传：后缀白名单 + 大小上限 + 写入 public/uploads，返回相对 url
export async function saveUploadedFile(file: File): Promise<string> {
  const ext = extname(file.name).slice(1).toLowerCase();
  if (!ext || !ALLOWED_EXTENSIONS.has(ext)) throw new AppError("不支持的文件类型");
  if (file.size > MAX_FILE_SIZE) throw new AppError("文件过大（上限 50MB）");

  const filename = `${nanoid()}.${ext}`;
  const dir = join(process.cwd(), "public", UPLOAD_DIR);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, filename), Buffer.from(await file.arrayBuffer()));
  return `/${UPLOAD_DIR}/${filename}`;
}

// 上传（须项目成员）：供「先传文件后建资产」或后续「文档上传归入资产库」复用
export async function uploadAssetFile(actorId: string, projectId: string, file: File): Promise<string> {
  await requireProjectAccess(actorId, projectId);
  return saveUploadedFile(file);
}

export interface CreateAssetInput {
  projectId: string;
  name: string;
  assetType: AssetType;
  description?: string;
  url?: string;
  file?: File;
  taskId?: string;
  docId?: string;
}

export async function createAsset(actorId: string, input: CreateAssetInput) {
  await requireProjectAccess(actorId, input.projectId);
  const name = normalizeName(input.name);

  let url = input.url?.trim() || undefined;
  let fileMime: string | null = null;
  let fileSize: number | null = null;

  if (input.assetType === "link") {
    if (!url) throw new AppError("外部链接资产需提供 url");
  } else {
    // file 型：优先内嵌上传，否则引用已上传的 url
    if (input.file) {
      url = await saveUploadedFile(input.file);
      fileMime = input.file.type || null;
      fileSize = input.file.size ?? null;
    } else if (!url) {
      throw new AppError("文件资产需上传文件或提供 url");
    }
  }

  if (input.taskId) await assertTaskInProject(input.projectId, input.taskId);
  if (input.docId) await assertDocInProject(input.projectId, input.docId);

  const [asset] = await db
    .insert(assets)
    .values({
      projectId: input.projectId,
      name,
      description: input.description?.trim() || null,
      assetType: input.assetType,
      url: url!,
      fileMime,
      fileSize,
      taskId: input.taskId ?? null,
      docId: input.docId ?? null,
      uploadUserId: actorId,
    })
    .returning();
  return asset;
}

// 按项目列资产：默认不含已归档，includeArchived 时全量
export async function listProjectAssets(
  actorId: string,
  projectId: string,
  opts: { includeArchived?: boolean } = {},
) {
  await requireProjectAccess(actorId, projectId);
  return db
    .select({
      id: assets.id,
      projectId: assets.projectId,
      taskId: assets.taskId,
      docId: assets.docId,
      uploadUserId: assets.uploadUserId,
      uploadUserName: users.name,
      name: assets.name,
      description: assets.description,
      assetType: assets.assetType,
      url: assets.url,
      fileMime: assets.fileMime,
      fileSize: assets.fileSize,
      isArchived: assets.isArchived,
      createdAt: assets.createdAt,
      updatedAt: assets.updatedAt,
    })
    .from(assets)
    .leftJoin(users, eq(assets.uploadUserId, users.id))
    .where(
      and(
        eq(assets.projectId, projectId),
        ...(opts.includeArchived ? [] : [eq(assets.isArchived, false)]),
      ),
    )
    .orderBy(desc(assets.createdAt));
}

// 编辑：归档中仅允许「取消归档」（isArchived=false 且无其他字段变更），其余变更一律 403
export async function updateAsset(
  actorId: string,
  assetId: string,
  patch: { name?: string; description?: string | null; url?: string; isArchived?: boolean },
) {
  const asset = await requireAssetAccess(actorId, assetId);

  if (asset.isArchived) {
    const onlyUnarchive =
      patch.isArchived === false &&
      patch.name === undefined &&
      patch.description === undefined &&
      patch.url === undefined;
    if (!onlyUnarchive) throw new ForbiddenError("资产已归档，禁止修改或删除");
  }

  const name = patch.name === undefined ? undefined : normalizeName(patch.name);
  const [updated] = await db
    .update(assets)
    .set({
      ...(name !== undefined && { name }),
      ...(patch.description !== undefined && { description: patch.description }),
      ...(patch.url !== undefined && { url: patch.url }),
      ...(patch.isArchived !== undefined && { isArchived: patch.isArchived }),
      updatedAt: new Date(),
    })
    .where(eq(assets.id, assetId))
    .returning();
  return updated;
}

// 删除本地上传文件（仅 /uploads/ 内、file 型、文件名不含路径分隔），失败静默
async function removeUploadedFile(asset: { assetType: AssetType; url: string }) {
  if (asset.assetType !== "file" || !asset.url) return;
  const prefix = `/${UPLOAD_DIR}/`;
  if (!asset.url.startsWith(prefix)) return;
  const rel = asset.url.slice(prefix.length);
  if (!rel || rel.includes("..") || rel.includes("/") || rel.includes("\\")) return;
  try {
    await unlink(join(process.cwd(), "public", UPLOAD_DIR, rel));
  } catch {
    // 文件不存在或已删，忽略
  }
}

export async function deleteAsset(actorId: string, assetId: string) {
  const asset = await requireAssetAccess(actorId, assetId);
  assertNotArchived(asset);
  await db.delete(assets).where(eq(assets.id, assetId));
  await removeUploadedFile(asset);
}

export async function bindTaskToAsset(actorId: string, assetId: string, taskId: string) {
  const asset = await requireAssetAccess(actorId, assetId);
  assertNotArchived(asset);
  await assertTaskInProject(asset.projectId, taskId);
  const [updated] = await db
    .update(assets)
    .set({ taskId, updatedAt: new Date() })
    .where(eq(assets.id, assetId))
    .returning();
  return updated;
}

export async function bindDocToAsset(actorId: string, assetId: string, docId: string) {
  const asset = await requireAssetAccess(actorId, assetId);
  assertNotArchived(asset);
  await assertDocInProject(asset.projectId, docId);
  const [updated] = await db
    .update(assets)
    .set({ docId, updatedAt: new Date() })
    .where(eq(assets.id, assetId))
    .returning();
  return updated;
}
