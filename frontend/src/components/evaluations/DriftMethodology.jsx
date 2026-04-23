import { useState } from 'react';
import {
  Info, ChevronDown, ChevronUp, ArrowRight,
  Play, Gauge, LineChart, SignalHigh, ListChecks,
  ShieldCheck, ShieldAlert, ShieldX,
} from 'lucide-react';

/**
 * Standalone methodology reference card — explains the drift pipeline,
 * severity rules, and scoring math without being embedded inside
 * DriftAnalysis (where it previously hid the live chart below a wall
 * of reference content).
 *
 * Collapsed by default. Props:
 *   - threshold: the drift_threshold number the backend is enforcing
 *     (drives the "Healthy / Warning / Critical" trigger chips).
 *   - trendScoreCount: current service's trend window (optional). When
 *     unknown, renders "N" in the "Trend direction" explainer.
 */
export default function DriftMethodology({ threshold = 75, trendScoreCount = null }) {
  const [open, setOpen] = useState(false);
  const warnCeiling = threshold + 10;

  return (
    <div className="rounded-xl border border-hairline bg-surface shadow-xs overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-surface-elevated/60 transition-standard"
      >
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-md bg-accent-weak flex items-center justify-center shrink-0">
            <Info size={15} strokeWidth={1.75} className="text-accent" />
          </div>
          <div className="text-left">
            <h3 className="text-[14px] font-semibold text-text tracking-tight leading-tight">How drift detection works</h3>
            <p className="text-[11.5px] text-text-subtle leading-tight mt-0.5">
              Pipeline, severity rules, and the math behind each score.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <span className="text-[11px] font-semibold text-text-subtle tracking-wider uppercase bg-surface-elevated px-2.5 py-1 rounded-pill border border-hairline">
            Reference
          </span>
          {open
            ? <ChevronUp size={15} strokeWidth={1.75} className="text-text-subtle" />
            : <ChevronDown size={15} strokeWidth={1.75} className="text-text-subtle" />
          }
        </div>
      </button>

      {open && (
        <div className="px-5 pb-5 pt-1 space-y-5 border-t border-hairline bg-surface-elevated/30">
          {/* Pipeline */}
          <div>
            <p className="text-[11px] font-semibold text-text-subtle tracking-wider uppercase mb-2.5 mt-4">
              Pipeline
            </p>
            <div className="flex items-stretch gap-1.5 overflow-x-auto">
              {[
                { icon: Play, label: 'Run tests', desc: 'Send every prompt to the model' },
                { icon: Gauge, label: 'Score each', desc: 'Judge factuality · parse JSON · detect hallucination' },
                { icon: LineChart, label: 'Compare history', desc: 'Split-half trend vs. recent runs' },
                { icon: SignalHigh, label: 'Classify', desc: 'Healthy · Warning · Critical' },
              ].map((step, i, arr) => (
                <div key={step.label} className="flex items-center gap-1.5 flex-1 min-w-0">
                  <div className="flex-1 min-w-0 rounded-lg bg-surface border border-hairline p-3">
                    <div className="flex items-center gap-1.5 mb-1">
                      <div className="w-5 h-5 rounded-full bg-accent-weak flex items-center justify-center shrink-0">
                        <span className="text-[10px] font-mono font-semibold text-accent tabular-nums">{i + 1}</span>
                      </div>
                      <step.icon size={13} strokeWidth={1.75} className="text-text-muted shrink-0" />
                      <span className="text-[13px] font-semibold text-text truncate">{step.label}</span>
                    </div>
                    <p className="text-[12px] text-text-muted leading-snug">{step.desc}</p>
                  </div>
                  {i < arr.length - 1 && <ArrowRight size={14} strokeWidth={1.5} className="text-text-subtle shrink-0" />}
                </div>
              ))}
            </div>
          </div>

          {/* Severity levels */}
          <div>
            <p className="text-[11px] font-semibold text-text-subtle tracking-wider uppercase mb-2.5">
              Severity levels
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
              {[
                {
                  icon: ShieldCheck, label: 'Healthy', tone: 'healthy',
                  trigger: `score ≥ ${warnCeiling}%`,
                  desc: 'Quality sits comfortably above the threshold and trend isn\u2019t declining. No action needed.',
                },
                {
                  icon: ShieldAlert, label: 'Warning', tone: 'degraded',
                  trigger: `${threshold}\u2013${warnCeiling}% · or declining`,
                  desc: 'Within 10 pts of the threshold, or trend is declining. Investigate before it breaks.',
                },
                {
                  icon: ShieldX, label: 'Critical', tone: 'failing',
                  trigger: `score < ${threshold}% · or 15+ pt drop`,
                  desc: 'Below the threshold, or a sudden 15+ pt drop vs. the recent average. Page oncall.',
                },
              ].map(sev => (
                <div key={sev.label} className={`rounded-lg border border-hairline bg-status-${sev.tone}-muted/30 p-3.5`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <sev.icon size={15} strokeWidth={1.75} className={`text-status-${sev.tone}`} />
                      <span className={`text-[14px] font-semibold text-status-${sev.tone}`}>{sev.label}</span>
                    </div>
                    <span className={`text-[11px] font-mono tabular-nums text-status-${sev.tone} bg-surface border border-hairline rounded-pill px-2 py-0.5`}>
                      {sev.trigger}
                    </span>
                  </div>
                  <p className="text-[12.5px] text-text-muted leading-snug">{sev.desc}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Behind the numbers */}
          <div>
            <p className="text-[11px] font-semibold text-text-subtle tracking-wider uppercase mb-2.5">
              Behind the numbers
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
              <div className="rounded-lg bg-surface border border-hairline p-3.5">
                <div className="flex items-center gap-2 mb-2">
                  <Gauge size={14} strokeWidth={1.75} className="text-accent" />
                  <span className="text-[13px] font-semibold text-text">Quality score</span>
                </div>
                <p className="text-[12.5px] text-text-muted leading-relaxed">
                  Mean of per-test-case scores in a run. Factuality is LLM-judged; JSON format parses the response. <span className="text-text">One failing case can pull the mean down sharply.</span>
                </p>
              </div>
              <div className="rounded-lg bg-surface border border-hairline p-3.5">
                <div className="flex items-center gap-2 mb-2">
                  <LineChart size={14} strokeWidth={1.75} className="text-accent" />
                  <span className="text-[13px] font-semibold text-text">Trend direction</span>
                </div>
                <p className="text-[12.5px] text-text-muted leading-relaxed">
                  Split the last <span className="font-mono tabular-nums">{trendScoreCount ?? 'N'}</span> runs in half, compare averages. {'>'} 3 pts flips to <span className="text-status-healthy font-medium">improving</span> or <span className="text-status-failing font-medium">declining</span>. Confidence: <span className="text-text-subtle">low</span> ≤ 2 runs · <span className="text-text-muted">medium</span> 3&ndash;4 · <span className="text-text">high</span> 5+.
                </p>
              </div>
              <div className="rounded-lg bg-surface border border-hairline p-3.5">
                <div className="flex items-center gap-2 mb-2">
                  <ListChecks size={14} strokeWidth={1.75} className="text-accent" />
                  <span className="text-[13px] font-semibold text-text">Per-test breakdown</span>
                </div>
                <p className="text-[12.5px] text-text-muted leading-relaxed">
                  Aggregates hide which case broke. The drift panel&rsquo;s per-test list shows each case&rsquo;s current score, delta vs. its own recent average, and its own trend — so you <span className="text-text">pinpoint the regressing prompt</span>, not the service.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
