import { z } from "zod";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getProjectForUser } from "@/lib/project";
import { AssetPanel } from "./asset-panel";
import { BackButton } from "@/components/back-button";

export default async function AssetsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!z.uuid().safeParse(projectId).success) notFound();

  const access = await getProjectForUser(session.user.id, projectId);
  if (!access) notFound();

  return (
    <main className="mx-auto max-w-4xl space-y-6">
      <header className="space-y-3">
        <BackButton fallbackHref={`/projects/${projectId}`} />
        <h1 className="font-display text-2xl font-semibold text-ink">
          {access.project.name} · 资产管理
        </h1>
        <p className="text-sm text-ink-soft">项目内共享的文件与外部链接，团队成员可见、可上传。</p>
      </header>

      <AssetPanel projectId={projectId} projectArchived={access.project.status === "archived"} />
    </main>
  );
}
