"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { markTaskEventReadAction } from "../../actions";

export function MarkTaskEventRead({ eventId }: { eventId: string }) {
  const router = useRouter();
  useEffect(() => {
    void markTaskEventReadAction(eventId).then(() => router.refresh());
  }, [eventId, router]);
  return null;
}
