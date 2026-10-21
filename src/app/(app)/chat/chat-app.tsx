"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar } from "./avatar";
import { sortRooms, type MessageSortMode } from "@/lib/message-sort";

export type ChatOverview = {
  projects: { id: string; name: string; teamName: string; members: { id: string; name: string }[] }[];
  groupRooms: Record<string, { roomId: string; unread: number }>;
  dmRooms: Record<string, { roomId: string; unread: number }>;
  unreadTotal: number;
};

export type ChatPreferences = {
  chatSortMode: MessageSortMode;
  notificationSortMode: MessageSortMode;
  chatFilterMode: "all" | "important";
};

export type ConversationSummary = {
  roomId: string;
  type: "group" | "dm";
  title: string;
  lastActivityAt: Date | string | number;
  unread: number;
};

type MessageFlags = { isImportant: boolean; savedByMe: boolean };

type Message = {
  id: string;
  senderId: string;
  senderName: string;
  content: string;
  createdAt: string;
  mine: boolean;
  flags?: MessageFlags;
  readBy?: { id: string; name: string }[];
};

type Member = { id: string; name: string };

type Room = { roomId: string; title: string; type: "group" | "dm"; canManageImportant?: boolean };

const POLL_MS = 4000;

function fmtTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// 渲染消息正文：把 @名字 高亮（群聊艾特；@word 一律标色，中文名/邮箱均适用）
function renderContent(content: string) {
  return content.split(/(@[^\s@]+)/g).map((part, i) =>
    part.startsWith("@") ? (
      <span key={i} className="font-medium text-primary">
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

// 解析输入末尾正在进行的 @ 艾特：返回 @ 的位置与后续已输入片段；无则 null
function parseMention(value: string): { start: number; query: string } | null {
  const at = value.lastIndexOf("@");
  if (at < 0) return null;
  const rest = value.slice(at + 1);
  if (/\s/.test(rest)) return null; // @ 后已接空格 = 已完成的艾特，不再弹窗
  return { start: at, query: rest };
}

export function ChatApp({
  userId,
  userName,
  initial,
  initialRoomId,
  initialPreferences,
  initialPinned,
  initialConversations,
}: {
  userId: string;
  userName: string;
  initial: ChatOverview;
  initialRoomId?: string | null;
  initialPreferences: ChatPreferences;
  initialPinned: string[];
  initialConversations: ConversationSummary[];
}) {
  const router = useRouter();
  const [groupRooms, setGroupRooms] = useState(initial.groupRooms);
  const [dmRooms, setDmRooms] = useState(initial.dmRooms);
  const [selected, setSelected] = useState<Room | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const unreadTotalRef = useRef<number | null>(null);

  // 消息中心偏好：聊天排序 / 消息过滤 / 置顶（只影响本人视图）
  const [chatSortMode, setChatSortMode] = useState<MessageSortMode>(initialPreferences.chatSortMode);
  const [filterMode, setFilterMode] = useState<"all" | "important">(initialPreferences.chatFilterMode);
  const [pinned, setPinned] = useState<Set<string>>(new Set(initialPinned));
  const [conversations, setConversations] = useState<ConversationSummary[]>(initialConversations);

  function clearUnread(roomId: string) {
    const zero = (map: Record<string, { roomId: string; unread: number }>) => {
      const next = { ...map };
      for (const k in next) if (next[k].roomId === roomId) next[k] = { ...next[k], unread: 0 };
      return next;
    };
    setGroupRooms(zero);
    setDmRooms(zero);
    setConversations((list) => list.map((c) => (c.roomId === roomId ? { ...c, unread: 0 } : c)));
  }

  function selectRoom(room: Room) {
    setSelected(room);
    setMessages([]);
    setMembers([]);
    setMention(null);
    setError(null);
    clearUnread(room.roomId);
    void fetch("/api/messages/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomId: room.roomId }),
    }).catch(() => {});
  }

  // 深链：从通知「群聊提及」跳来时按 roomId 自动打开对应会话
  useEffect(() => {
    if (!initialRoomId || selected) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/messages?roomId=${encodeURIComponent(initialRoomId)}`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (data.room) {
          setSelected({
            roomId: data.room.id,
            title: data.room.title,
            type: data.room.type,
            canManageImportant: data.room.canManageImportant,
          });
          setMembers(data.members ?? []);
          clearUnread(data.room.id);
        }
      } catch {
        /* 忽略，用户可手动选择 */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialRoomId]);

  // 选中会话后：立即拉取 + 每 4s 轮询（刷新消息、成员与侧栏未读红点）
  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch(`/api/messages?roomId=${selected!.roomId}`, { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled) return;
        setMessages(data.messages);
        setMembers(data.members ?? []);
        setGroupRooms(data.groupRooms);
        setDmRooms(data.dmRooms);
        // 会话摘要的未读随轮询同步（排序依据之一）
        if (Array.isArray(data.groupRooms) === false) {
          const unreadByRoomId = new Map<string, number>();
          for (const v of Object.values(data.groupRooms ?? {}) as { roomId: string; unread: number }[])
            unreadByRoomId.set(v.roomId, v.unread);
          for (const v of Object.values(data.dmRooms ?? {}) as { roomId: string; unread: number }[])
            unreadByRoomId.set(v.roomId, v.unread);
          setConversations((list) =>
            list.map((c) =>
              unreadByRoomId.has(c.roomId) ? { ...c, unread: unreadByRoomId.get(c.roomId)! } : c,
            ),
          );
        }
        if (data.room) {
          setSelected((prev) =>
            prev && prev.roomId === data.room.id
              ? { ...prev, canManageImportant: data.room.canManageImportant }
              : prev,
          );
        }
        // 已读已在服务端确认，同时更新 layout 内的「消息／对话」角标。
        // 首次拉取也刷新，避免侧栏沿用上一个页面的未读数；后续仅在数量变化时刷新。
        if (unreadTotalRef.current !== data.unreadTotal) {
          unreadTotalRef.current = data.unreadTotal;
          router.refresh();
        }
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
  }, [selected, router]);

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
        setConversations((list) =>
          list.some((c) => c.roomId === roomId)
            ? list
            : [
                ...list,
                {
                  roomId,
                  type: "group" as const,
                  title: groupName,
                  lastActivityAt: new Date().toISOString(),
                  unread: 0,
                },
              ],
        );
      } catch {
        setError("网络异常，请重试");
        return;
      }
    }
    selectRoom({ roomId, title: groupName, type: "group" });
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
        setConversations((list) =>
          list.some((c) => c.roomId === roomId)
            ? list
            : [
                ...list,
                {
                  roomId,
                  type: "dm" as const,
                  title: memberName,
                  lastActivityAt: new Date().toISOString(),
                  unread: 0,
                },
              ],
        );
      } catch {
        setError("网络异常，请重试");
        return;
      }
    }
    selectRoom({ roomId, title: memberName, type: "dm" });
  }

  async function send() {
    const text = input.trim();
    if (!text || pending || !selected) return;
    setInput("");
    setMention(null);
    setPending(true);
    setError(null);

    const temp: Message = {
      id: `temp-${Date.now()}`,
      senderId: userId,
      senderName: userName,
      content: text,
      createdAt: new Date().toISOString(),
      mine: true,
      flags: { isImportant: false, savedByMe: false },
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
      // 发消息只更新最近活动时间，不改动用户选择的排序/过滤偏好
      setConversations((list) =>
        list.map((c) =>
          c.roomId === selected.roomId ? { ...c, lastActivityAt: new Date().toISOString() } : c,
        ),
      );
    } catch {
      setError("网络异常，请重试");
    } finally {
      setPending(false);
    }
  }

  // ── 排序 / 过滤 / 置顶 ──────────────────────────────────────────────

  function switchSortMode(next: MessageSortMode) {
    if (next === chatSortMode) return;
    setChatSortMode(next);
    void fetch("/api/messages/preferences", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatSortMode: next }),
    }).catch(() => setChatSortMode(chatSortMode));
  }

  function switchFilterMode(next: "all" | "important") {
    if (next === filterMode) return;
    setFilterMode(next);
    void fetch("/api/messages/preferences", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatFilterMode: next }),
    }).catch(() => setFilterMode(filterMode));
  }

  function togglePin(roomId: string) {
    const next = new Set(pinned);
    const willPin = !next.has(roomId);
    if (willPin) next.add(roomId);
    else next.delete(roomId);
    setPinned(next);
    void fetch("/api/messages/pin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomId, pinned: willPin }),
    }).catch(() => setPinned(pinned));
  }

  function toggleMessageFlag(messageId: string, kind: "important" | "saved", value: boolean) {
    setMessages((list) =>
      list.map((m) =>
        m.id === messageId
          ? {
              ...m,
              flags: {
                isImportant: kind === "important" ? value : (m.flags?.isImportant ?? false),
                savedByMe: kind === "saved" ? value : (m.flags?.savedByMe ?? false),
              },
            }
          : m,
      ),
    );
    void fetch("/api/messages/flags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId, kind, value }),
    }).catch(() => {
      // 失败回滚
      setMessages((list) =>
        list.map((m) =>
          m.id === messageId
            ? {
                ...m,
                flags: {
                  isImportant: kind === "important" ? !value : (m.flags?.isImportant ?? false),
                  savedByMe: kind === "saved" ? !value : (m.flags?.savedByMe ?? false),
                },
              }
            : m,
        ),
      );
    });
  }

  const sortedConversations = useMemo(
    () => sortRooms(conversations, chatSortMode, pinned),
    [conversations, chatSortMode, pinned],
  );

  // 仅重要：小组级重要 或 我收藏的（与服务端 isImportantToUser 同口径）
  const visibleMessages = useMemo(
    () =>
      filterMode === "important"
        ? messages.filter((m) => m.flags?.isImportant || m.flags?.savedByMe)
        : messages,
    [messages, filterMode],
  );

  function onInputChange(value: string) {
    setInput(value);
    setMention(parseMention(value));
  }

  function applyMention(member: Member) {
    if (!mention) return;
    const next =
      input.slice(0, mention.start) +
      `@${member.name} ` +
      input.slice(mention.start + 1 + mention.query.length);
    setInput(next);
    setMention(null);
    inputRef.current?.focus();
  }

  const mentionMatches = useMemo(() => {
    if (!mention) return [];
    const q = mention.query.toLowerCase();
    return members
      .filter((m) => m.id !== userId && (q === "" || m.name.toLowerCase().includes(q)))
      .slice(0, 6);
  }, [mention, members, userId]);

  const otherMembers = members.filter((m) => m.id !== userId);

  return (
    <div className="flex gap-4">
      <aside className="w-64 shrink-0 space-y-5">
        {/* 会话列表：置顶 →（未读优先时）未读 → 最近活动倒序 */}
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-ink">会话</h2>
            <div className="flex items-center gap-1 rounded-field border border-line p-0.5">
              {(
                [
                  ["time", "按时间"],
                  ["unread", "未读优先"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => switchSortMode(value)}
                  className={`rounded-[calc(var(--radius-field)-2px)] px-2 py-0.5 text-xs transition-colors ${
                    chatSortMode === value
                      ? "bg-primary-soft font-medium text-primary"
                      : "text-ink-soft hover:text-ink"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {sortedConversations.length === 0 ? (
            <p className="text-xs text-ink-faint">还没有会话</p>
          ) : (
            <ul className="space-y-0.5">
              {sortedConversations.map((c) => (
                <li key={c.roomId} className="group/conv flex items-center gap-1">
                  <button
                    onClick={() => selectRoom({ roomId: c.roomId, title: c.title, type: c.type })}
                    className={`flex flex-1 items-center gap-2 rounded-field px-1 py-1.5 text-left text-sm transition-colors hover:bg-primary-soft ${
                      selected?.roomId === c.roomId ? "bg-primary-soft" : ""
                    }`}
                  >
                    <span
                      className={`grid h-7 w-7 shrink-0 place-items-center rounded-md text-xs font-semibold ${
                        c.type === "group"
                          ? "bg-primary-soft text-primary"
                          : "bg-sunken text-ink-soft"
                      }`}
                    >
                      {c.type === "group" ? "群" : <Avatar name={c.title} size="sm" />}
                    </span>
                    <span className="flex-1 truncate text-ink">{c.title}</span>
                    <UnreadDot count={c.unread} />
                  </button>
                  {c.type === "group" && (
                    <button
                      type="button"
                      onClick={() => togglePin(c.roomId)}
                      title={pinned.has(c.roomId) ? "取消置顶" : "置顶该群聊"}
                      className={`shrink-0 rounded px-1 py-1 text-xs transition-opacity ${
                        pinned.has(c.roomId)
                          ? "text-accent"
                          : "text-ink-faint opacity-0 group-hover/conv:opacity-100"
                      }`}
                    >
                      {pinned.has(c.roomId) ? "📌" : "📍"}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 发起会话：项目群聊 + 成员私聊入口 */}
        <div className="space-y-1">
          <h2 className="text-sm font-semibold text-ink">发起会话</h2>
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
        </div>
      </aside>

      <section className="flex min-h-[70vh] flex-1 flex-col ac-card overflow-hidden">
        {selected ? (
          <>
            <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="font-display text-base font-semibold text-ink">
                  {selected.title}
                </span>
                {pinned.has(selected.roomId) && <span className="text-xs text-accent">📌 已置顶</span>}
              </div>
              <div className="flex items-center gap-2">
                {/* 全部 / 仅重要 */}
                <div className="flex items-center gap-1 rounded-field border border-line p-0.5">
                  {(
                    [
                      ["all", "全部"],
                      ["important", "仅重要"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => switchFilterMode(value)}
                      className={`rounded-[calc(var(--radius-field)-2px)] px-2 py-0.5 text-xs transition-colors ${
                        filterMode === value
                          ? "bg-primary-soft font-medium text-primary"
                          : "text-ink-soft hover:text-ink"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {selected.type === "group" && (
                  <span className="text-xs text-ink-faint">群成员 {otherMembers.length} 人</span>
                )}
              </div>
            </header>
            <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto p-4">
              {visibleMessages.length === 0 && (
                <p className="text-sm text-ink-faint">
                  {filterMode === "important" ? "还没有重要消息。" : "还没有消息，说点什么吧。"}
                </p>
              )}
              {visibleMessages.map((m) => (
                <div
                  key={m.id}
                  className={`group/msg flex gap-2.5 rounded-lg px-2 py-1.5 hover:bg-sunken/60 ${
                    m.flags?.isImportant ? "border-l-2 border-accent bg-accent-soft/30" : ""
                  }`}
                >
                  {selected.type === "group" && !m.mine ? (
                    <button
                      type="button"
                      onClick={() => openDm(m.senderId, m.senderName)}
                      title={`与 ${m.senderName} 私聊`}
                      className="shrink-0"
                    >
                      <Avatar name={m.senderName} size="sm" />
                    </button>
                  ) : (
                    <Avatar name={m.senderName} size="sm" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-medium text-ink">{m.senderName}</span>
                      <span className="text-xs text-ink-faint">{fmtTime(m.createdAt)}</span>
                      {m.flags?.isImportant && (
                        <span className="ac-badge bg-accent-soft text-accent">重要</span>
                      )}
                      {m.flags?.savedByMe && (
                        <span className="ac-badge bg-primary-soft text-primary">已收藏</span>
                      )}
                    </div>
                    <p className="whitespace-pre-wrap text-sm text-ink">{renderContent(m.content)}</p>
                    {m.mine && (
                      <ReadReceipt
                        message={m}
                        type={selected.type}
                        totalReaders={otherMembers.length}
                      />
                    )}
                    {/* 消息操作：收藏（所有人）/ 标记重要（仅组长） */}
                    <div className="mt-1 flex items-center gap-2 text-xs opacity-0 transition-opacity group-hover/msg:opacity-100">
                      <button
                        type="button"
                        onClick={() => toggleMessageFlag(m.id, "saved", !m.flags?.savedByMe)}
                        className="text-ink-soft hover:text-primary"
                      >
                        {m.flags?.savedByMe ? "★ 取消收藏" : "☆ 收藏"}
                      </button>
                      {selected.type === "group" && selected.canManageImportant && (
                        <button
                          type="button"
                          onClick={() => toggleMessageFlag(m.id, "important", !m.flags?.isImportant)}
                          className="text-ink-soft hover:text-accent"
                        >
                          {m.flags?.isImportant ? "取消重要" : "标为重要"}
                        </button>
                      )}
                    </div>
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
              className="relative flex gap-2 border-t border-line p-3"
            >
              {mention && mentionMatches.length > 0 && (
                <div className="absolute bottom-full left-3 mb-1 w-56 overflow-hidden rounded-field border border-line bg-surface shadow-lg">
                  {mentionMatches.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => applyMention(m)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink hover:bg-primary-soft"
                    >
                      <Avatar name={m.name} size="sm" />
                      <span className="truncate">{m.name}</span>
                    </button>
                  ))}
                </div>
              )}
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => onInputChange(e.target.value)}
                placeholder="输入消息，@ 可艾特成员…"
                className="ac-field flex-1 text-sm"
              />
              <button disabled={pending || !input.trim()} className="ac-btn">
                {pending ? "发送中…" : "发送"}
              </button>
            </form>
          </>
        ) : (
          <div className="grid flex-1 place-items-center p-8 text-center text-sm text-ink-soft">
            左侧选择一个会话，开始对话。
          </div>
        )}
      </section>

      {selected?.type === "group" && (
        <aside className="w-48 shrink-0 space-y-2">
          <h2 className="text-sm font-semibold text-ink">群成员</h2>
          {otherMembers.length === 0 ? (
            <p className="text-xs text-ink-faint">暂无成员</p>
          ) : (
            <ul className="space-y-1">
              {otherMembers.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => openDm(m.id, m.name)}
                    title={`与 ${m.name} 私聊`}
                    className="flex w-full items-center gap-2 rounded-field px-2 py-1.5 text-left text-sm text-ink transition-colors hover:bg-primary-soft"
                  >
                    <Avatar name={m.name} size="sm" />
                    <span className="truncate">{m.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
      )}
    </div>
  );
}

function UnreadDot({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="inline-grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-alert px-1 text-[10px] font-semibold text-white">
      {count > 99 ? "99+" : count}
    </span>
  );
}

// 已读回执：仅自己发的消息展示。私聊「已读/未读」；群聊「已读 N/M」，悬停显示已读成员名。
function ReadReceipt({
  message,
  type,
  totalReaders,
}: {
  message: Message;
  type: "group" | "dm";
  totalReaders: number;
}) {
  const readers = message.readBy ?? [];
  if (readers.length === 0) {
    return <span className="mt-0.5 block text-right text-[11px] leading-none text-ink-faint">未读</span>;
  }
  const label = type === "dm" ? "已读" : `已读 ${readers.length}/${totalReaders}`;
  const names = type === "group" ? readers.map((r) => r.name).join("、") : "";
  return (
    <span
      className="mt-0.5 block text-right text-[11px] leading-none text-primary"
      title={names ? `已读：${names}` : undefined}
    >
      {label}
    </span>
  );
}
