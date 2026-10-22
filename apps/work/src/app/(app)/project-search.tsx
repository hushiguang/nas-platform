"use client";

interface ProjectSearchProps {
  value: string;
  onChange: (value: string) => void;
}

/** 项目列表的关键字搜索框，输入即过滤，不发请求 */
export function ProjectSearch({ value, onChange }: ProjectSearchProps) {
  return (
    <div className="work-search" role="search">
      <svg className="work-search-icon" viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.7" />
        <path d="M13 13l4 4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
      <input
        type="search"
        value={value}
        maxLength={40}
        placeholder="搜项目名称 / 代号 / 负责人 / 成员"
        aria-label="搜索项目"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onChange("");
        }}
      />
      {value ? (
        <button type="button" className="work-search-clear" aria-label="清除搜索" onClick={() => onChange("")}>
          ×
        </button>
      ) : null}
    </div>
  );
}
