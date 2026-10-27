import Link from "next/link";
import { z } from "zod";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getProjectForUser } from "@/lib/project";
import { getDocument } from "@/lib/document";
import { MarkdownBody } from "../markdown";
import { deleteDocumentAction } from "../actions";
import { BackButton } from "@/components/back-button";
import { scopedHref } from "@/lib/workbench-navigation";

function fmtTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default async function DocViewPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string; documentId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { projectId, documentId } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!z.uuid().safeParse(projectId).success || !z.uuid().safeParse(documentId).success)
    notFound();

  const access = await getProjectForUser(session.user.id, projectId);
  if (!access) notFound();
  const sp = await searchParams;
  const teamId = sp.team === access.project.teamId ? access.project.teamId : null;

  const doc = await getDocument(session.user.id, documentId);
  if (!doc || doc.projectId !== projectId) notFound();

  return (
    <main className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-3">
        <BackButton fallbackHref={scopedHref(`/projects/${projectId}/docs`, teamId)} />
        <Link href={scopedHref("/projects", teamId)} className="text-sm text-primary">返回工作台</Link>
        <div className="flex items-start justify-between gap-3">
          <h1 className="font-display text-2xl font-semibold text-ink">{doc.title}</h1>
          <div className="flex shrink-0 gap-2">
            <Link href={scopedHref(`/projects/${projectId}/docs/${documentId}/edit`, teamId)} className="ac-btn-ghost">
              编辑
            </Link>
            <form action={deleteDocumentAction}>
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="documentId" value={documentId} />
              {teamId && <input type="hidden" name="team" value={teamId} />}
              <button className="ac-btn-ghost text-high hover:border-high hover:text-high">
                删除
              </button>
            </form>
          </div>
        </div>
        <p className="flex flex-wrap items-center gap-2 text-xs text-ink-faint">
          {doc.category && (
            <span className="ac-badge bg-primary-soft text-primary">{doc.category}</span>
          )}
          <span>
            {doc.createdByName} 创建于 {fmtTime(doc.createdAt)} · 更新于 {fmtTime(doc.updatedAt)} ·{" "}
            {doc.updatedByName ?? "—"}
          </span>
        </p>
      </header>

      <article className="ac-card p-6">
        {doc.content.trim() ? (
          <MarkdownBody content={doc.content} />
        ) : (
          <p className="text-sm text-ink-faint">（空文档，点右上角「编辑」补充正文）</p>
        )}
      </article>
    </main>
  );
}
