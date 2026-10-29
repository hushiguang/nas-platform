"use client";

import { useState } from "react";

export function ReportExportBar({ markdown, week, title }: { markdown: string; week: string; title: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const query = `week=${week}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(markdown);
      setFailed(false);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
      setFailed(true);
    }
  }

  return (
    <div className="work-actions">
      <button type="button" className="btn ghost" onClick={copy}>
        {copied ? "已复制" : failed ? "复制失败" : "复制周报"}
      </button>
      <a className="btn" href={`/api/report?${query}&format=md`} download={`${title}.md`}>
        导出 Markdown
      </a>
      <a className="btn ghost" href={`/api/report?${query}&format=xlsx`} download={`${title}.xlsx`}>
        导出 Excel
      </a>
    </div>
  );
}
