import { Shield, Database, Globe, Lock, ArrowRight, Server } from 'lucide-react';
import PageHeader from '../components/common/PageHeader';
import StatusBadge from '../components/common/StatusBadge';

export default function DataPolicyPage() {
  return (
    <div className="space-y-5 max-w-4xl">
      <PageHeader title="Data Policy" description="How AIHealthCheck handles data and interacts with external LLM providers." />

      {/* Architecture diagram */}
      <div className="bg-surface rounded-lg border border-border p-5 shadow-sm">
        <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-4">Data Flow</h3>
        <div className="flex flex-col md:flex-row items-center justify-between gap-3 p-4 bg-surface-elevated rounded-md border border-border">
          <FlowNode icon={Globe} label="User" sublabel="Browser" />
          <ArrowRight size={16} strokeWidth={1.5} className="text-text-subtle hidden md:block" />
          <div className="flex flex-col gap-2 w-full md:w-40">
            <FlowBox label="React Frontend" sublabel="Dashboards" />
            <FlowBox label="FastAPI Backend" sublabel="llm_client.py" />
          </div>
          <ArrowRight size={16} strokeWidth={1.5} className="text-text-subtle hidden md:block" />
          <div className="flex flex-col gap-2 w-full md:w-36">
            <FlowNode icon={Database} label="SQLite" sublabel="Local storage" />
            <FlowNode icon={Server} label="Claude API" sublabel="Cloud inference" />
          </div>
        </div>
      </div>

      {/* Policy sections */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <PolicySection icon={Database} title="What is stored locally?">
          All application data is stored in a local SQLite database (aiops.db). This includes: service metadata,
          evaluation results, incident records, audit log, telemetry, and API usage logs. Passwords are stored
          as bcrypt hashes. Prompt safety scan results and risk scores are logged per API call.
        </PolicySection>

        <PolicySection icon={Globe} title="What is sent to Anthropic?">
          <p className="mb-2">Data dispatched to Claude API:</p>
          <ul className="space-y-1.5">
            <li className="flex items-start gap-2"><Dot /> Test connection prompts (short "hello" prompt)</li>
            <li className="flex items-start gap-2"><Dot /> Evaluation test case prompts (synthetic data)</li>
            <li className="flex items-start gap-2"><Dot /> Incident details for LLM summary generation</li>
            <li className="flex items-start gap-2"><Dot /> Dashboard and compliance report generation requests</li>
          </ul>
          <p className="mt-2 text-text-subtle">All inputs are scanned by the safety scanner before transmission.</p>
        </PolicySection>

        <PolicySection icon={Lock} title="Are prompts logged?">
          Prompts sent to the LLM are not stored in the database by default. Only metadata is recorded:
          latency, token counts, cost estimate, safety flags, and risk score. Response snippets from test
          connections are stored for debugging. Per Anthropic's policy, API inputs/outputs are not used
          for model training.
        </PolicySection>

        <PolicySection icon={Shield} title="Sensitivity label routing">
          <p className="mb-3">Every registered service is tagged with a sensitivity label that governs LLM feature access:</p>
          <div className="space-y-2">
            <SensitivityRow status="public" desc="Non-sensitive. Full LLM features enabled." />
            <SensitivityRow status="internal" desc="Business data. LLM features enabled with caution." />
            <SensitivityRow status="confidential" desc="Highly sensitive. LLM requires explicit approval." />
          </div>
        </PolicySection>
      </div>

      {/* Safety note */}
      <div className="flex items-start gap-3 px-4 py-3 bg-status-healthy-muted border border-status-healthy/20 rounded-lg">
        <Shield size={14} strokeWidth={1.5} className="text-status-healthy shrink-0 mt-0.5" />
        <div className="text-xs text-text-muted">
          <span className="font-medium text-text">Prompt Safety Scanner active.</span> All inputs are checked
          for injection patterns, PII, and length limits before reaching Claude. Blocked calls are logged
          with safety flags and risk scores. Budget enforcement prevents cost overruns.
        </div>
      </div>
    </div>
  );
}

/* ── Local sub-components ── */

function PolicySection({ icon: Icon, title, children }) {
  return (
    <section className="bg-surface rounded-lg border border-border p-4 shadow-sm">
      <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2 flex items-center gap-1.5">
        <Icon size={12} strokeWidth={1.5} /> {title}
      </h3>
      <div className="text-sm text-text-muted leading-relaxed">{children}</div>
    </section>
  );
}

function FlowNode({ icon: Icon, label, sublabel }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="w-10 h-10 rounded-md bg-surface border border-border flex items-center justify-center">
        <Icon size={16} strokeWidth={1.5} className="text-text-subtle" />
      </div>
      <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">{label}</span>
      {sublabel && <span className="text-[10px] text-text-subtle">{sublabel}</span>}
    </div>
  );
}

function FlowBox({ label, sublabel }) {
  return (
    <div className="px-3 py-2 bg-surface border border-border rounded-md text-center">
      <p className="text-xs font-medium text-text">{label}</p>
      {sublabel && <p className="text-[10px] text-text-subtle">{sublabel}</p>}
    </div>
  );
}

function SensitivityRow({ status, desc }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="w-24 shrink-0"><StatusBadge status={status} /></div>
      <span className="text-xs text-text-muted">{desc}</span>
    </div>
  );
}

function Dot() {
  return <span className="w-1 h-1 rounded-full bg-text-subtle shrink-0 mt-2" aria-hidden="true" />;
}
