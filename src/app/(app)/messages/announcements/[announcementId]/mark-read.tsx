"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { markAnnouncementReadAction } from "../../actions";

// 打开详情页即标读本人那份；随后 refresh 让页面上的「X/Y 人已读」立刻把本人计入
export function MarkAnnouncementRead({ announcementId }: { announcementId: string }) {
  const router = useRouter();
  useEffect(() => {
    void markAnnouncementReadAction(announcementId).then(() => router.refresh());
  }, [announcementId, router]);
  return null;
}
