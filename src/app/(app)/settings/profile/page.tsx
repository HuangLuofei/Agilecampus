import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { SkillTagsEditor } from "./skill-tags-editor";
import { StudentIdForm } from "./student-id-form";

export default async function ProfilePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const [me] = await db
    .select({ skillTags: users.skillTags, studentId: users.studentId })
    .from(users)
    .where(eq(users.id, session.user.id));

  return (
    <main className="mx-auto max-w-2xl space-y-6">
      <header className="space-y-1">
        <h1 className="font-display text-2xl font-semibold text-ink">个人资料</h1>
        <p className="text-sm text-ink-soft">
          技能标签会展示在成员列表与负责人选择处，供团队分工参考；学号用于登录。
        </p>
      </header>
      <StudentIdForm initial={me?.studentId ?? null} />
      <SkillTagsEditor initialTags={me?.skillTags ?? []} />
    </main>
  );
}
