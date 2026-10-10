"use client";

import { useActionState, useState } from "react";
import type { FormState } from "../../actions";
import {
  createTaskEventCommentAction,
  deleteTaskEventCommentAction,
  updateTaskEventCommentAction,
} from "../../actions";

type CommentItem = {
  id: string;
  authorId: string;
  authorName: string;
  content: string;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export function ChangeComments({
  eventId,
  currentUserId,
  initialComments,
}: {
  eventId: string;
  currentUserId: string;
  initialComments: CommentItem[];
}) {
  const [comments] = useState(initialComments);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [createState, createAction, creating] = useActionState<FormState, FormData>(
    createTaskEventCommentAction,
    null,
  );
  const [updateState, updateAction, updating] = useActionState<FormState, FormData>(
    updateTaskEventCommentAction,
    null,
  );
  const [, deleteAction, deleting] = useActionState<FormState, FormData>(
    deleteTaskEventCommentAction,
    null,
  );

  return (
    <section className="ac-card space-y-4 p-6">
      <h2 className="font-display text-base font-semibold text-ink">
        讨论 {comments.length > 0 && `(${comments.length})`}
      </h2>

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
                <input type="hidden" name="eventId" value={eventId} />
                <input type="hidden" name="commentId" value={comment.id} />
                <textarea
                  name="content"
                  defaultValue={comment.content}
                  className="ac-field text-sm"
                  rows={3}
                />
                {updateState && "error" in updateState && (
                  <p className="text-xs text-high">{updateState.error}</p>
                )}
                <div className="flex gap-2">
                  <button disabled={updating} className="ac-btn text-xs">
                    保存
                  </button>
                  <button
                    type="button"
                    className="ac-btn-ghost text-xs"
                    onClick={() => setEditingId(null)}
                  >
                    取消
                  </button>
                </div>
              </form>
            ) : (
              <p className="mt-2 whitespace-pre-wrap text-sm text-ink-soft">{comment.content}</p>
            )}
            {comment.authorId === currentUserId && editingId !== comment.id && (
              <form action={deleteAction} className="mt-2">
                <input type="hidden" name="eventId" value={eventId} />
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
        <input type="hidden" name="eventId" value={eventId} />
        <textarea
          name="content"
          className="ac-field text-sm"
          rows={3}
          placeholder="写下你的评论…"
          required
        />
        {createState && "error" in createState && (
          <p className="text-xs text-high">{createState.error}</p>
        )}
        <button disabled={creating} className="ac-btn text-xs">
          {creating ? "发送中…" : "发表评论"}
        </button>
      </form>
    </section>
  );
}
