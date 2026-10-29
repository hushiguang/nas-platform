"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

interface ImportError {
  row: number;
  project: string;
  message: string;
}

interface ImportResult {
  created: number;
  updated: number;
  errors: ImportError[];
}

/** 导入 Excel：上传导出模板填好的 xlsx，同名项目按导入更新，没有的新增。 */
export function ImportButton() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function run() {
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await fetch("/api/import", { method: "POST", body: form });
      const payload = await response.json();
      if (!payload.ok) {
        setError(payload.message ?? "导入失败");
        return;
      }
      setResult(payload.result);
      setFile(null);
      router.refresh();
    } catch {
      setError("导入失败，稍后再试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="btn ghost"
        onClick={() => {
          setError(null);
          setResult(null);
          setFile(null);
          dialogRef.current?.showModal();
        }}
      >
        导入 Excel
      </button>
      <dialog
        ref={dialogRef}
        className="work-dialog"
        aria-labelledby="import-dialog-title"
        onClose={() => {
          setError(null);
          setResult(null);
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) dialogRef.current?.close();
        }}
      >
        <div className="work-dialog-head">
          <h2 id="import-dialog-title">导入 Excel</h2>
          <button type="button" className="btn ghost sm" onClick={() => dialogRef.current?.close()}>
            关闭
          </button>
        </div>

        <div className="form-stack">
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>
            用「导出 Excel」拿到的表填写，表头不要改。
            按「项目」列全名匹配，同名的直接更新，没有的新增。
          </p>
          <ul className="muted" style={{ fontSize: 12.5, margin: 0, paddingLeft: 18, lineHeight: 1.9 }}>
            <li>涉及人员按角色进阶段：项目经理→商务，研发→研发/上线准备/上线阶段，测试→SIT/UAT</li>
            <li>表里的人全是系统外人员，不核对系统账号</li>
            <li>负责人取项目经理的名字；系统内部归属记在你名下</li>
            <li>同名项目会按表里的内容重写阶段日期和阶段人员</li>
          </ul>
          <input
            ref={fileRef}
            className="field"
            type="file"
            accept=".xlsx,.xlsm"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          {file ? <span className="muted" style={{ fontSize: 12.5 }}>{file.name}</span> : null}
          {error ? <div className="notice">{error}</div> : null}
          {result ? (
            <div className="notice">
              <div>
                导入完成：新增 {result.created} 个，更新 {result.updated} 个
                {result.errors.length > 0 ? `，失败 ${result.errors.length} 行` : ""}
              </div>
              {result.errors.length > 0 ? (
                <div style={{ marginTop: 6, maxHeight: 180, overflow: "auto" }}>
                  {result.errors.map((item) => (
                    <div key={`${item.row}-${item.project}`}>
                      第 {item.row} 行 {item.project}：{item.message}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          <button type="button" className="btn sm" disabled={!file || busy} onClick={run}>
            {busy ? "导入中…" : "开始导入"}
          </button>
        </div>
      </dialog>
    </>
  );
}
