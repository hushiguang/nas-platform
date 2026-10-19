import type { PhaseView } from "@/server";

function days(start: string, end: string): number {
  const from = Date.parse(`${start}T00:00:00Z`);
  const to = Date.parse(`${end}T00:00:00Z`);
  return Math.round((to - from) / 86_400_000) + 1;
}

/** 进度条按阶段切开。天蓝是这一段的预期，珊瑚是这一段的实际。 */
export function PhaseMeter({ phases }: { phases: PhaseView[] }) {
  const enabled = phases.filter((phase) => phase.enabled);
  if (enabled.length === 0) return <div className="work-dual" />;
  const dated = enabled.every(
    (phase) => phase.startDate && phase.endDate && phase.endDate >= phase.startDate,
  );
  return (
    <div className="work-segments" aria-hidden="true">
      {enabled.map((phase) => (
        <span
          key={phase.id}
          style={{ flexGrow: dated ? days(phase.startDate, phase.endDate) : 1 }}
          title={`${phase.label} 实际 ${phase.progress}%`}
        >
          {phase.expected != null ? <i className="expected" style={{ width: `${phase.expected}%` }} /> : null}
          <i className="actual" style={{ width: `${phase.progress}%` }} />
        </span>
      ))}
    </div>
  );
}

export function PhasePercent({ phase }: { phase: PhaseView }) {
  return (
    <span className="phase-pct">
      <b>{phase.progress}%</b>
      <span>预期 {phase.expected == null ? "—" : `${phase.expected}%`}</span>
    </span>
  );
}
