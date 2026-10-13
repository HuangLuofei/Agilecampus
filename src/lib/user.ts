import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { hashPassword } from "./password";
import { AppError, isUniqueViolation } from "./errors";
import { normalizeSkillTags } from "./skill-tags";

export async function createUser(input: {
  email: string;
  password: string;
  name: string;
}) {
  const email = input.email.toLowerCase();
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email));
  if (existing) throw new AppError("该邮箱已被注册");

  const passwordHash = await hashPassword(input.password);
  try {
    const [user] = await db
      .insert(users)
      .values({ email, passwordHash, name: input.name })
      .returning({ id: users.id, email: users.email, name: users.name });
    return user;
  } catch (e) {
    // 查重与插入之间的并发窗口：另一请求已抢先注册，由 DB 唯一约束兜底
    if (isUniqueViolation(e)) throw new AppError("该邮箱已被注册");
    throw e;
  }
}

// 更新当前用户自报的技能标签（个人资料页）。清洗规则见 lib/skill-tags.ts。
export async function updateMySkillTags(userId: string, tags: string[]) {
  const normalized = normalizeSkillTags(tags);
  await db.update(users).set({ skillTags: normalized }).where(eq(users.id, userId));
  return normalized;
}
