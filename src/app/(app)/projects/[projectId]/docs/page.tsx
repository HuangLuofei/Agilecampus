import Link from "next/link";
import { z } from "zod";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getProjectForUser } from "@/lib/project";
import { listProjectDocuments, listDocumentCategories } from "@/lib/document";
import { NewDocForm } from "./new-doc-form";
import { BackButton } from "@/components/back-button";
import { scopedHref } from "@/lib/workbench-navigation";

function fmtDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export default async function DocsPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { projectId } = await params;
  const sp = await searchParams;
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!z.uuid().safeParse(projectId).success) notFound();

  const access = await getProjectForUser(session.user.id, projectId);
  if (!access) notFound();
  const teamId = sp.team === access.project.teamId ? access.project.teamId : null;

  const q = typeof sp.q === "string" ? sp.q : "";
  const category = typeof sp.category === "string" ? sp.category : "";

  const [docs, categories] = await Promise.all([
    listProjectDocuments(session.user.id, projectId, { q, category }),
    listDocumentCategories(session.user.id, projectId),
  ]);

  return (
    <main className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-3">
        <BackButton fallbackHref={scopedHref(`/projects/${projectId}`, teamId)} />
        <Link href={scopedHref("/projects", teamId)} className="text-sm text-primary">返回工作台</Link>
        <h1 className="font-display text-2xl font-semibold text-ink">
          {access.project.name} · 文档
        </h1>
        <p className="text-sm text-ink-soft">项目内的共享 Markdown 文档，全员可编辑。</p>
      </header>

      <NewDocForm projectId={projectId} teamId={teamId} />

      <section className="space-y-3">
        <form method="get" className="ac-card flex flex-wrap items-end gap-3 p-4">
          {teamId && <input type="hidden" name="team" value={teamId} />}
          <label className="min-w-48 flex-1 space-y-1">
            <span className="text-xs font-medium text-ink-soft">搜索</span>
            <input
              name="q"
              defaultValue={q}
              placeholder="按标题或正文关键词搜索"
              className="ac-field"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-ink-soft">分类</span>
            <select name="category" defaultValue={category} className="ac-field">
              <option value="">全部分类</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <button className="ac-btn">搜索</button>
        </form>

        {docs.length === 0 ? (
          <div className="ac-card p-8 text-center text-sm text-ink-soft">
            暂无文档——用上方表单新建第一篇。
          </div>
        ) : (
          <ul className="space-y-2">
            {docs.map((d) => (
              <li key={d.id}>
                <Link
                  href={scopedHref(`/projects/${projectId}/docs/${d.id}`, teamId)}
                  className="ac-card flex items-center justify-between gap-4 p-4 transition-colors hover:border-primary"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-ink">{d.title}</span>
                      {d.category && (
                        <span className="ac-badge bg-primary-soft text-primary">{d.category}</span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-ink-soft">
                      {d.updatedByName ?? "已注销成员"} · 更新于 {fmtDay(d.updatedAt)}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
