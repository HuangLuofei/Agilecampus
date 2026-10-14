import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { SkillTagsEditor } from "./skill-tags-editor";

export default async function ProfilePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const [me] = await db
    .select({ skillTags: users.skillTags })
    .from(users)
    .where(eq(users.id, session.user.id));

  return (
    <main className="mx-auto max-w-2xl space-y-6">
      <header className="space-y-1">
        <h1 className="font-display text-2xl font-semibold text-ink">我的技能标签</h1>
        <p className="text-sm text-ink-soft">
          由你自己点亮或填写，会展示在成员列表与新建/编辑任务的负责人选择处，供团队分工参考。
        </p>
      </header>
      <SkillTagsEditor initialTags={me?.skillTags ?? []} />
    </main>
  );
}
