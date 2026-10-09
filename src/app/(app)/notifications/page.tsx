import { redirect } from "next/navigation";

export default function NotificationsPage() {
  redirect("/messages?tab=notifications");
}
