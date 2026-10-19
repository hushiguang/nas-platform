"use client";

import { useMemo, useState } from "react";

/**
 * 人员输入。大部分参建的人没有系统账号，所以允许直接手填名字，回车或逗号落成一个词条。
 * suggestions 是项目预设的参加人员：输入时模糊匹配出下拉，也可以在下方一键勾选。
 * 每个词条生成一个 hidden 输入，随表单一起提交。
 */
export function PersonPicker({
  suggestions = [],
  fieldName,
  initial = [],
  placeholder = "输入姓名，回车添加",
  emptyHint,
  quickPick = false,
}: {
  suggestions?: string[];
  fieldName: string;
  initial?: string[];
  placeholder?: string;
  emptyHint?: string;
  /** 在输入框下方平铺预设人员，点一下就选中，省得先输字再从下拉里找 */
  quickPick?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>(() => dedupe(initial));

  const pool = useMemo(() => dedupe(suggestions), [suggestions]);
  const chosen = useMemo(() => new Set(selected), [selected]);
  const keyword = query.trim().toLowerCase();
  const matches = useMemo(
    () => pool.filter((name) => !chosen.has(name) && (!keyword || name.toLowerCase().includes(keyword))).slice(0, 40),
    [pool, chosen, keyword],
  );
  const quick = useMemo(() => (quickPick ? pool.filter((name) => !chosen.has(name)) : []), [quickPick, pool, chosen]);

  function add(name: string) {
    const value = name.replace(/\s+/g, " ").trim();
    if (!value) return;
    setSelected((prev) => (prev.includes(value) ? prev : [...prev, value]));
    setQuery("");
  }

  function remove(name: string) {
    setSelected((prev) => prev.filter((item) => item !== name));
  }

  return (
    <div className="person-wrap">
      <div className="person-picker">
        {selected.map((name) => (
        <span className="person-chip" key={name}>
          <input type="hidden" name={fieldName} value={name} />
          {name}
          <button type="button" className="person-chip-x" onClick={() => remove(name)} aria-label={`移除${name}`}>
            ×
          </button>
        </span>
      ))}
      <input
        className="field person-picker-input"
        value={query}
        placeholder={selected.length === 0 ? placeholder : "继续添加"}
        onChange={(event) => {
          const value = event.target.value;
          const [head, ...rest] = value.split(/[,，、;；]/);
          if (rest.length > 0) {
            add(head);
            for (const piece of rest) add(piece);
            return;
          }
          setQuery(value);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            const value = query.trim();
            if (value) add(value);
          }
          if (event.key === "Backspace" && !query && selected.length > 0) remove(selected[selected.length - 1]);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 160)}
      />
      {open && matches.length > 0 ? (
        <div className="person-menu">
          {matches.length > 1 ? <div className="person-menu-label">预设人员</div> : null}
          {matches.map((name) => (
            <button
              type="button"
              key={name}
              className="person-option"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => add(name)}
            >
              {name}
            </button>
          ))}
        </div>
      ) : null}
      {open && matches.length === 0 && !keyword && emptyHint ? (
        <div className="person-menu person-menu-empty">{emptyHint}</div>
      ) : null}
      {quick.length > 0 ? (
        <div className="person-quick">
          {quick.map((name) => (
            <button
              key={name}
              type="button"
              className="person-quick-btn"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => add(name)}
            >
              {name}
            </button>
          ))}
        </div>
      ) : null}
      </div>
    </div>
  );
}

function dedupe(names: string[]): string[] {
  const out: string[] = [];
  for (const raw of names) {
    const name = raw.replace(/\s+/g, " ").trim();
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}