export default function HomePage() {
  return (
    <div>
      <div className="page-head">
        <div>
          <span className="page-eyebrow">nas-platform</span>
          <h1>孕期</h1>
        </div>
      </div>
      <p className="muted" style={{ fontSize: 13, marginBottom: 20 }}>
        全周期节点与每日状态
      </p>
      <div
        className="card"
        style={{
          display: "grid",
          placeItems: "center",
          minHeight: 180,
          borderStyle: "dashed",
          fontSize: 13,
          color: "var(--muted)",
        }}
      >
        建设中
      </div>
    </div>
  );
}
