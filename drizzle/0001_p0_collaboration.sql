CREATE TYPE "public"."notification_type" AS ENUM('task_assigned', 'task_reassigned', 'task_completed', 'task_commented', 'task_updated', 'ai_committed', 'system');--> statement-breakpoint
CREATE TYPE "public"."actor_type" AS ENUM('human', 'ai', 'system');--> statement-breakpoint
CREATE TYPE "public"."task_event_action" AS ENUM('created', 'updated', 'status_changed', 'assignee_changed', 'due_date_changed', 'priority_changed', 'completion_note_changed', 'comment_created', 'comment_updated', 'comment_deleted', 'deleted');--> statement-breakpoint
ALTER TABLE "notifications" ALTER COLUMN "type" SET DATA TYPE "notification_type" USING "type"::"notification_type";--> statement-breakpoint
ALTER TABLE "task_comments" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "task_events" ALTER COLUMN "actor_type" SET DATA TYPE "actor_type" USING "actor_type"::"actor_type";--> statement-breakpoint
ALTER TABLE "task_events" ALTER COLUMN "action" SET DATA TYPE "task_event_action" USING "action"::"task_event_action";--> statement-breakpoint
CREATE INDEX "notifications_user_created_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_user_unread_idx" ON "notifications" USING btree ("user_id","is_read");--> statement-breakpoint
CREATE INDEX "task_comments_task_created_idx" ON "task_comments" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE INDEX "task_events_task_created_idx" ON "task_events" USING btree ("task_id","created_at");
