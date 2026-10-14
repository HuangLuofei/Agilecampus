import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { listMyProjects } from "@/lib/project";
import { listMyAssets, type MyAssetRow } from "@/lib/my-assets";
import { formatSize } from "@/app/(app)/projects/[projectId]/assets/asset-types";
import { BackButton } from "@/components/back-button";
import { AssetCreator, AssetDeleteButton } from "./asset-actions";

function fmtDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// 命中处高亮：返回 React 节点（React 自动转义，禁用 dangerouslySetInnerHTML）。
// 中文安全：toLowerCase() 对 CJK 无变化，indexOf/slice 按 UTF-16 码元处理。
function highlight(text: string, q: string): React.ReactNode {
  const term = q.trim();
  if (!term) return text;
  const lower = text.toLowerCase();
  const t = term.toLowerCase();
  const out: React.ReactNode[] = [];
  let i = 0;
  let k = 0;
  for (;;) {
    const idx = lower.indexOf(t, i);
    if (idx === -1) {
      out.push(text.slice(i));
      break;
    }
    if (idx > i) out.push(text.slice(i, idx));
    out.push(
      <mark key={k++} className="rounded bg-accent/35 px-0.5 font-semibold text-ink">
        {text.slice(idx, idx + term.length)}
      </mark>,
    );
    i = idx + term.length;
  }
  return out;
}

export default async function MyAssetsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";

  const projects = await listMyProjects(session.user.id);
  const rows = await listMyAssets(
    projects.map((p) => p.id),
    { q },
  );

  const groups = projects
    .map((project) => ({
      project,
      items: rows.filter((r) => r.projectId === project.id),
    }))
    .filter((g) => g.items.length > 0);

  return (
    <main className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-3">
        <BackButton fallbackHref="/projects" />
        <h1 className="font-display text-2xl font-semibold text-ink">我的资产</h1>
        <p className="text-sm text-ink-soft">我参与的全部项目下的云文档与资料。</p>
      </header>

      {projects.length === 0 ? (
        <div className="ac-card p-10 text-center text-sm text-ink-soft">
          暂无项目——加入团队后即可在此查看资产。
        </div>
      ) : (
        <>
          <AssetCreator
            projects={projects.map((p) => ({
              id: p.id,
              name: p.name,
              teamName: p.teamName,
              archived: p.status === "archived",
            }))}
          />

          <form method="get" className="ac-card flex flex-wrap items-end gap-3 p-4">
            <label className="min-w-48 flex-1 space-y-1">
              <span className="text-xs font-medium text-ink-soft">搜索</span>
              <input
                name="q"
                defaultValue={q}
                placeholder="按文档标题/正文、资料名称/描述搜索"
                className="ac-field"
              />
            </label>
            <button className="ac-btn">搜索</button>
            {q && (
              <Link href="/assets" className="ac-btn-ghost">
                清除
              </Link>
            )}
          </form>

          {rows.length === 0 ? (
            <div className="ac-card p-8 text-center text-sm text-ink-soft">
              {q ? "没有找到匹配的文档或资产。" : "暂无文档或资料。"}
            </div>
          ) : (
            <div className="space-y-8">
              {groups.map(({ project, items }) => (
                <section key={project.id} className="space-y-3">
                  <div className="flex items-center gap-2">
                    <span aria-hidden className="h-4 w-1 rounded-full bg-primary" />
                    <Link
                      href={`/projects/${project.id}`}
                      className="font-display text-base font-semibold text-ink hover:text-primary"
                    >
                      {project.name}
                    </Link>
                    <span className="text-xs text-ink-faint">{project.teamName}</span>
                    <span className="ml-auto text-xs text-ink-faint">{items.length} 项</span>
                  </div>
                  <ul className="space-y-2">
                    {items.map((row) => (
                      <AssetRowItem
                        key={`${row.kind}-${row.id}`}
                        row={row}
                        q={q}
                        archived={project.status === "archived"}
                      />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </>
      )}
    </main>
  );
}

function AssetRowItem({ row, q, archived }: { row: MyAssetRow; q: string; archived: boolean }) {
  const isDoc = row.kind === "document";
  const isFile = row.assetType === "file";
  const icon = isDoc ? "📄" : isFile ? "📎" : "🔗";
  const kindLabel = isDoc ? "文档" : isFile ? "文件" : "链接";

  const body = (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <span aria-hidden>{icon}</span>
        <span className="font-medium text-ink">{highlight(row.title, q)}</span>
        <span className="ac-badge bg-primary-soft text-primary">{kindLabel}</span>
        {isDoc && row.category && (
          <span className="ac-badge bg-accent-soft text-accent">{row.category}</span>
        )}
        {!isDoc && row.fileSize != null && (
          <span className="text-xs text-ink-faint">{formatSize(row.fileSize)}</span>
        )}
      </div>
      {row.snippet && (
        <p className="mt-0.5 line-clamp-2 text-xs text-ink-soft">
          {highlight(row.snippet, q)}
        </p>
      )}
      <p className="mt-0.5 text-xs text-ink-faint">
        {row.authorName ?? "已注销成员"} · 更新于 {fmtDay(row.updatedAt)}
      </p>
    </div>
  );

  return (
    <li>
      <div className="ac-card flex items-center justify-between gap-4 p-4 transition-colors hover:border-primary">
        {isDoc ? (
          <Link
            href={`/projects/${row.projectId}/docs/${row.id}`}
            className="min-w-0 flex-1"
          >
            {body}
          </Link>
        ) : (
          <a
            href={row.url ?? "#"}
            target="_blank"
            rel="noreferrer"
            className="min-w-0 flex-1"
          >
            {body}
          </a>
        )}
        {isFile && (
          <a
            href={row.url ?? "#"}
            download={row.title}
            className="shrink-0 text-xs text-primary hover:underline"
          >
            下载
          </a>
        )}
        {!isDoc && !archived && <AssetDeleteButton assetId={row.id} />}
      </div>
    </li>
  );
}
