import { db } from "@/db";
import { users } from "@/db/schema";
import { and, eq, ne, or } from "drizzle-orm";
import { hashPassword } from "./password";
import { AppError, isUniqueViolation } from "./errors";
import { normalizeSkillTags } from "./skill-tags";

export async function createUser(input: {
  email: string;
  password: string;
  name: string;
  studentId?: string;
}) {
  const email = input.email.toLowerCase();
  const studentId = input.studentId?.trim();
  const [existing] = await db
    .select({ id: users.id, email: users.email, studentId: users.studentId })
    .from(users)
    .where(or(eq(users.email, email), studentId ? eq(users.studentId, studentId) : undefined));
  if (existing) {
    throw new AppError(existing.email === email ? "该邮箱已被注册" : "该学号已被注册");
  }

  const passwordHash = await hashPassword(input.password);
  try {
    const [user] = await db
      .insert(users)
      .values({ email, passwordHash, name: input.name, studentId: studentId || null })
      .returning({ id: users.id, email: users.email, name: users.name });
    return user;
  } catch (e) {
    // 查重与插入之间的并发窗口：另一请求已抢先注册，由 DB 唯一约束兜底
    if (isUniqueViolation(e)) throw new AppError("该邮箱或学号已被注册");
    throw e;
  }
}

// 更新当前用户自报的技能标签（个人资料页）。清洗规则见 lib/skill-tags.ts。
export async function updateMySkillTags(userId: string, tags: string[]) {
  const normalized = normalizeSkillTags(tags);
  await db.update(users).set({ skillTags: normalized }).where(eq(users.id, userId));
  return normalized;
}

// 补填/修改登录学号（个人资料页）。学号唯一，撞号时给出友好错误。
export async function updateMyStudentId(userId: string, studentId: string) {
  const id = studentId.trim();
  const [clash] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.studentId, id), ne(users.id, userId)));
  if (clash) throw new AppError("该学号已被其他账号使用");

  try {
    await db.update(users).set({ studentId: id }).where(eq(users.id, userId));
  } catch (e) {
    if (isUniqueViolation(e)) throw new AppError("该学号已被其他账号使用");
    throw e;
  }
  return id;
}
