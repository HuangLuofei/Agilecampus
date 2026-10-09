"use client";

import { useEffect, useRef, useState } from "react";
import { Avatar } from "./avatar";

export type ChatOverview = {
  projects: { id: string; name: string; teamName: string; members: { id: string; name: string }[] }[];
  groupRooms: Record<string, { roomId: string; unread: number }>;
  dmRooms: Record<string, { roomId: string; unread: number }>;
  unreadTotal: number;
};

type Message = {
  id: string;
  senderId: string;
  senderName: string;
  content: string;
  createdAt: string;
  mine: boolean;
};

const POLL_MS = 4000;

function fmtTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function ChatApp({
  userId,
  userName,
  initial,
}: {
  userId: string;
  userName: string;
  initial: ChatOverview;
}) {
  const [groupRooms, setGroupRooms] = useState(initial.groupRooms);
  const [dmRooms, setDmRooms] = useState(initial.dmRooms);
  const [selected, setSelected] = useState<{ roomId: string; title: string } | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  function clearUnread(roomId: string) {
    const zero = (map: Record<string, { roomId: string; unread: number }>) => {
      const next = { ...map };
      for (const k in next) if (next[k].roomId === roomId) next[k] = { ...next[k], unread: 0 };
      return next;
    };
    setGroupRooms(zero);
    setDmRooms(zero);
  }

  function selectRoom(roomId: string, title: string) {
    setSelected({ roomId, title });
    setMessages([]);
    setError(null);
    clearUnread(roomId);
    void fetch("/api/messages/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomId }),
    }).catch(() => {});
  }

  // 选中会话后：立即拉取 + 每 4s 轮询（刷新消息与侧栏未读红点）
  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch(`/api/messages?roomId=${selected!.roomId}`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        setMessages(data.messages);
        setGroupRooms(data.groupRooms);
        setDmRooms(data.dmRooms);
      } catch {
        /* 网络抖动忽略，下一轮再试 */
      }
    }
    void poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [selected]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  async function openGroup(projectId: string, groupName: string) {
    let roomId = groupRooms[projectId]?.roomId;
    if (!roomId) {
      try {
        const res = await fetch("/api/messages/room", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "group", projectId }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "打开群聊失败");
          return;
        }
        roomId = data.roomId;
        setGroupRooms((g) => ({ ...g, [projectId]: { roomId, unread: 0 } }));
      } catch {
        setError("网络异常，请重试");
        return;
      }
    }
    selectRoom(roomId, groupName);
  }

  async function openDm(memberId: string, memberName: string) {
    let roomId = dmRooms[memberId]?.roomId;
    if (!roomId) {
      try {
        const res = await fetch("/api/messages/room", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "dm", userId: memberId }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "发起会话失败");
          return;
        }
        roomId = data.roomId;
        setDmRooms((d) => ({ ...d, [memberId]: { roomId, unread: 0 } }));
      } catch {
        setError("网络异常，请重试");
        return;
      }
    }
    selectRoom(roomId, memberName);
  }

  async function send() {
    const text = input.trim();
    if (!text || pending || !selected) return;
    setInput("");
    setPending(true);
    setError(null);

    const temp: Message = {
      id: `temp-${Date.now()}`,
      senderId: userId,
      senderName: userName,
      content: text,
      createdAt: new Date().toISOString(),
      mine: true,
    };
    setMessages((m) => [...m, temp]);

    try {
      const res = await fetch("/api/messages/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId: selected.roomId, content: text }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "发送失败");
        setMessages((m) => m.filter((x) => x.id !== temp.id));
        return;
      }
      setMessages((m) => m.map((x) => (x.id === temp.id ? (data.message as Message) : x)));
    } catch {
      setError("网络异常，请重试");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex gap-4">
      <aside className="w-64 shrink-0 space-y-5">
        <h1 className="font-display text-2xl font-semibold text-ink">对话</h1>
        {initial.projects.length === 0 ? (
          <p className="text-sm text-ink-soft">你还没有项目——加入团队并创建项目后即可对话。</p>
        ) : (
          initial.projects.map((p) => (
            <div key={p.id} className="space-y-1">
              <button
                onClick={() => openGroup(p.id, `${p.name}-${p.teamName}`)}
                className="flex w-full items-center gap-2 rounded-field px-1 py-1.5 text-left text-sm font-medium text-ink transition-colors hover:bg-primary-soft"
              >
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-primary-soft text-xs font-semibold text-primary">
                  群
                </span>
                <span className="flex-1 truncate">
                  {p.name}-{p.teamName}
                </span>
                <UnreadDot count={groupRooms[p.id]?.unread ?? 0} />
              </button>
              {p.members
                .filter((m) => m.id !== userId)
                .map((m) => (
                  <button
                    key={m.id}
                    onClick={() => openDm(m.id, m.name)}
                    className="flex w-full items-center gap-2 rounded-field py-1.5 pl-4 pr-1 text-left text-sm text-ink transition-colors hover:bg-primary-soft"
                  >
                    <Avatar name={m.name} size="sm" />
                    <span className="flex-1 truncate">{m.name}</span>
                    <UnreadDot count={dmRooms[m.id]?.unread ?? 0} />
                  </button>
                ))}
            </div>
          ))
        )}
      </aside>

      <section className="flex min-h-[70vh] flex-1 flex-col ac-card overflow-hidden">
        {selected ? (
          <>
            <header className="border-b border-line px-4 py-3 font-display text-base font-semibold text-ink">
              {selected.title}
            </header>
            <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto p-4">
              {messages.length === 0 && (
                <p className="text-sm text-ink-faint">还没有消息，说点什么吧。</p>
              )}
              {messages.map((m) => (
                <div key={m.id} className="flex gap-2.5 rounded-lg px-2 py-1.5 hover:bg-sunken/60">
                  <Avatar name={m.senderName} size="sm" />
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-medium text-ink">{m.senderName}</span>
                      <span className="text-xs text-ink-faint">{fmtTime(m.createdAt)}</span>
                    </div>
                    <p className="whitespace-pre-wrap text-sm text-ink">{m.content}</p>
                  </div>
                </div>
              ))}
            </div>
            {error && <p className="px-4 text-sm text-high">{error}</p>}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
              className="flex gap-2 border-t border-line p-3"
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="输入消息…"
                className="ac-field flex-1 text-sm"
              />
              <button disabled={pending || !input.trim()} className="ac-btn">
                {pending ? "发送中…" : "发送"}
              </button>
            </form>
          </>
        ) : (
          <div className="grid flex-1 place-items-center p-8 text-center text-sm text-ink-soft">
            左侧选择一个群聊或成员，开始对话。
          </div>
        )}
      </section>
    </div>
  );
}

function UnreadDot({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="inline-grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-high px-1 text-[10px] font-semibold text-white">
      {count > 99 ? "99+" : count}
    </span>
  );
}
