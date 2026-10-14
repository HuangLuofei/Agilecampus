"use client";

import { useActionState } from "react";
import { updateStudentIdAction, type StudentIdState } from "./actions";

// 学号补填/修改卡片：老账号注册时没有学号，在此补填后即可用学号登录
export function StudentIdForm({ initial }: { initial: string | null }) {
  const [state, formAction, pending] = useActionState<StudentIdState, FormData>(
    updateStudentIdAction,
    null,
  );

  return (
    <form action={formAction} className="ac-card space-y-3 p-5">
      <div>
        <h2 className="font-medium text-ink">登录学号</h2>
        <p className="mt-1 text-xs text-ink-faint">
          14 位数字，设置后可用学号代替邮箱登录，保存后立即生效。
        </p>
      </div>
      <div className="flex gap-2">
        <input
          name="studentId"
          defaultValue={initial ?? ""}
          placeholder={initial ? initial : "如 20231234567890"}
          className="ac-field"
        />
        <button disabled={pending} className="ac-btn shrink-0">
          {pending ? "保存中…" : "保存"}
        </button>
      </div>
      {state && "error" in state && <p className="text-sm text-high">{state.error}</p>}
      {state && "ok" in state && <p className="text-sm text-done">已保存。</p>}
    </form>
  );
}
