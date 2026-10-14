import { z } from "zod";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getProjectForUser } from "@/lib/project";
import { getDocument } from "@/lib/document";
import { BackButton } from "@/components/back-button";
import { DocEditor } from "../../doc-editor";

export default async function DocEditPage({
  params,
}: {
  params: Promise<{ projectId: string; documentId: string }>;
}) {
  const { projectId, documentId } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!z.uuid().safeParse(projectId).success || !z.uuid().safeParse(documentId).success)
    notFound();

  const access = await getProjectForUser(session.user.id, projectId);
  if (!access) notFound();

  const doc = await getDocument(session.user.id, documentId);
  if (!doc || doc.projectId !== projectId) notFound();

  return (
    <main className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-3">
        <BackButton fallbackHref={`/projects/${projectId}/docs/${documentId}`} label="返回文档" />
        <h1 className="font-display text-2xl font-semibold text-ink">编辑文档</h1>
      </header>

      <DocEditor
        projectId={projectId}
        documentId={documentId}
        initialTitle={doc.title}
        initialCategory={doc.category ?? ""}
        initialContent={doc.content}
      />
    </main>
  );
}
