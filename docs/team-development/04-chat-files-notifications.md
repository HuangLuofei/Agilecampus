# 成员 4：聊天重点、未读排序开关、小组置顶与文件图标

## 目标

支持重要信息、只看重要、按时间/未读优先切换、个人小组置顶，以及 PDF/表格等文件类型图标。

## 当前代码线索

- `src/db/schema.ts`：聊天、通知、资产表
- `src/lib/chat.ts`、`src/app/(app)/chat/chat-app.tsx`
- `src/app/(app)/messages/page.tsx`、`notifications-panel.tsx`
- `src/lib/notification.ts`
- `src/app/(app)/projects/[projectId]/assets`、`src/app/(app)/assets/page.tsx`
- `src/app/(app)/projects/[projectId]/assets/asset-types.ts`

## 需要完成的功能

### 1. 重要信息与只看重要

建议新增 `chatMessageFlags` 关联表，区分：

- `isImportant`：小组级标记，由组长设置；
- `savedByUser`：个人收藏，由每个成员独立设置。

聊天界面提供“全部 / 仅重要”。仅重要模式显示小组级重要消息和当前用户收藏消息，并持久化当前过滤状态。

### 2. 排序开关

建议新增 `userMessagePreferences`：`userId/messageSortMode`，另以 `userPinnedRooms` 保存个人置顶。

- `time`：纯按最近活动时间排序，类似微信；未读不自动移动到顶部。
- `unread`：未读会话在已读会话前，同组内按最近活动时间。
- 小组置顶：个人视图中项目群聊置顶，不改变其他成员。
- 通知 Tab 也支持时间/未读优先，但聊天和通知的设置要能分别解释。
- 新消息不覆盖用户选择，只更新最近活动和未读数。

推荐排序键：`pinned DESC` →（未读模式时）`hasUnread DESC` → `lastActivityAt DESC`。

### 3. 文件类型图标

在 `asset-types.ts` 增加 `getAssetIcon(fileMime, name, assetType)` 和 `getAssetTypeLabel`：PDF、表格、文档、演示、图片、压缩包、音频、视频、其他、链接。优先 MIME，缺失时使用扩展名。项目资产列表、全局资产页、任务附件选择器统一调用。

## 测试与验收

- 时间排序下未读不强行置顶；未读优先下未读会话在已读会话前，同组内按最近活动倒序。
- 小组置顶只影响当前用户，取消后恢复原排序。
- 重要消息过滤在刷新、重新进入会话后保持正确。
- PDF、xlsx、docx、pptx、png、zip、mp4、未知类型图标稳定，大小写不影响判断。
- 更新 `tests/chat.test.ts`，新增 `tests/message-preferences.test.ts`、`tests/asset-types.test.ts`。

## 与其他人的接口

- 使用成员 1 的权限判断组长级重要标记。
- 给成员 2 提供“只看重要消息”的查询，默认不读取普通聊天冗余。
- 给成员 5 提供消息中心设置入口和未读统计字段。
