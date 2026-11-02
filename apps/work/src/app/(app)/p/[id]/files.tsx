"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AttachmentFiles, type AttachmentItem } from "@nas/ui";

export function ProjectFiles({
  projectId,
  initial,
  canEdit,
}: {
  projectId: number;
  initial: AttachmentItem[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const signature = initial.map((item) => item.id).join("|");
  const [seen, setSeen] = useState(signature);
  if (seen !== signature) {
    setSeen(signature);
    setItems(initial);
  }

  return (
    <AttachmentFiles
      items={items}
      href={(item, kind) => `/api/attachments/${item.id}${kind === "download" ? "?download=1" : ""}`}
      uploadFile={
        canEdit
          ? async (file) => {
              const body = new FormData();
              body.append("file", file);
              body.append("refId", String(projectId));
              const res = await fetch("/api/attachments", { method: "POST", body });
              const data = await res.json().catch(() => ({}));
              if (!res.ok) throw new Error(data.message || "上传失败");
              return data.attachment as AttachmentItem;
            }
          : undefined
      }
      onChange={
        canEdit
          ? async (next) => {
              const removed = items.filter((item) => !next.some((row) => row.id === item.id));
              for (const item of removed) {
                const res = await fetch(`/api/attachments/${item.id}`, { method: "DELETE" });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.message || "删除失败");
              }
              setItems(next);
              router.refresh();
            }
          : undefined
      }
    />
  );
}
