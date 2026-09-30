"use client";

import { useActionState, useState } from "react";
import type { FormState } from "./actions";
import {
  createCommentAction,
  deleteCommentAction,
  updateCommentAction,
} from "./actions";

type CommentItem = {
  id: string;
  authorId: string;
  authorName: string;
  content: string;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type EventItem = {
  id: string;
  actorType: "human" | "ai" | "system";
  actorName: string | null;
  action: string;
  oldValue: unknown;
  newValue: unknown;
  createdAt: Date | string;
};

const ACTION_LABEL: Record<string, string> = {
  created: "创建了任务",
  updated: "更新了任务信息",
  status_changed: "变更了任务状态",
  assignee_changed: "变更了负责人",
  due_date_changed: "变更了截止日期",
  priority_changed: "变更了优先级",
  completion_note_changed: "更新了完成情况",
  comment_created: "发表了评论",
  comment_updated: "编辑了评论",
  comment_deleted: "删除了评论",
  deleted: "删除了任务",
};

export function TaskCollaboration({
  projectId,
  taskId,
  currentUserId,
  initialComments,
  initialEvents,
}: {
  projectId: string;
  taskId: string;
  currentUserId: string;
  initialComments: CommentItem[];
  initialEvents: EventItem[];
}) {
  const [comments] = useState(initialComments);
  const [events] = useState(initialEvents);
  const [tab, setTab] = useState<"comments" | "activity">("comments");
  const [editingId, setEditingId] = useState<string | null>(null);

  const [createState, createAction, creating] = useActionState<FormState, FormData>(
    createCommentAction,
    null,
  );
  const [updateState, updateAction, updating] = useActionState<FormState, FormData>(
    updateCommentAction,
    null,
  );
  const [, deleteAction, deleting] = useActionState<FormState, FormData>(
    deleteCommentAction,
    null,
  );

  return (
    <section className="mt-4 border-t border-line pt-4">
      <div className="flex items-center gap-1 border-b border-line">
        <button
          type="button"
          onClick={() => setTab("comments")}
          className={`border-b-2 px-3 py-2 text-sm ${tab === "comments" ? "border-primary text-primary" : "border-transparent text-ink-soft"}`}
        >
          讨论 {comments.length > 0 && `(${comments.length})`}
        </button>
        <button
          type="button"
          onClick={() => setTab("activity")}
          className={`border-b-2 px-3 py-2 text-sm ${tab === "activity" ? "border-primary text-primary" : "border-transparent text-ink-soft"}`}
        >
          动态 {events.length > 0 && `(${events.length})`}
        </button>
      </div>

      {tab === "comments" ? (
        <div className="space-y-3 pt-3">
          {comments.length === 0 ? (
            <p className="text-sm text-ink-faint">还没有讨论，留下第一条评论吧。</p>
          ) : (
            comments.map((comment) => (
              <article key={comment.id} className="rounded-field bg-sunken p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="text-sm font-semibold text-ink">{comment.authorName}</span>
                    <time className="ml-2 text-xs text-ink-faint">
                      {new Date(comment.createdAt).toLocaleString("zh-CN")}
                    </time>
                  </div>
                  {comment.authorId === currentUserId && editingId !== comment.id && (
                    <button
                      type="button"
                      className="text-xs text-ink-faint hover:text-primary"
                      onClick={() => setEditingId(comment.id)}
                    >
                      编辑
                    </button>
                  )}
                </div>
                {editingId === comment.id ? (
                  <form action={updateAction} className="mt-2 space-y-2">
                    <input type="hidden" name="projectId" value={projectId} />
                    <input type="hidden" name="commentId" value={comment.id} />
                    <textarea name="content" defaultValue={comment.content} className="ac-field text-sm" rows={3} />
                    {updateState && "error" in updateState && (
                      <p className="text-xs text-high">{updateState.error}</p>
                    )}
                    <div className="flex gap-2">
                      <button disabled={updating} className="ac-btn text-xs">保存</button>
                      <button type="button" className="ac-btn-ghost text-xs" onClick={() => setEditingId(null)}>
                        取消
                      </button>
                    </div>
                  </form>
                ) : (
                  <p className="mt-2 whitespace-pre-wrap text-sm text-ink-soft">{comment.content}</p>
                )}
                {comment.authorId === currentUserId && editingId !== comment.id && (
                  <form action={deleteAction} className="mt-2">
                    <input type="hidden" name="projectId" value={projectId} />
                    <input type="hidden" name="commentId" value={comment.id} />
                    <button disabled={deleting} className="text-xs text-ink-faint hover:text-high">
                      删除
                    </button>
                  </form>
                )}
              </article>
            ))
          )}
          <form action={createAction} className="space-y-2">
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="taskId" value={taskId} />
            <textarea
              name="content"
              className="ac-field text-sm"
              rows={3}
              placeholder="写下你的进展、问题或需要协调的事项…"
              required
            />
            {createState && "error" in createState && (
              <p className="text-xs text-high">{createState.error}</p>
            )}
            <button disabled={creating} className="ac-btn text-xs">
              {creating ? "发送中…" : "发表评论"}
            </button>
          </form>
        </div>
      ) : (
        <div className="space-y-3 pt-3">
          {events.length === 0 ? (
            <p className="text-sm text-ink-faint">暂无活动记录。</p>
          ) : (
            events.map((event) => (
              <div key={event.id} className="flex gap-3 text-sm">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
                <div>
                  <p className="text-ink">
                    <span className="font-medium">{event.actorName ?? event.actorType}</span>{" "}
                    {ACTION_LABEL[event.action] ?? event.action}
                  </p>
                  <time className="text-xs text-ink-faint">
                    {new Date(event.createdAt).toLocaleString("zh-CN")}
                  </time>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
}
