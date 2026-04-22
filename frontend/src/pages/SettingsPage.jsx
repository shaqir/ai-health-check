import { useState, useEffect } from 'react';
import {
  Brain, DollarSign, Zap, ShieldCheck, Activity, Gauge, CreditCard,
  Shield, BarChart3, Ban, Cpu, LineChart as LineChartIcon,
  Regex, Bot, UserX, AlertOctagon, Maximize2, FileWarning,
  Clock, KeyRound, ServerCrash, FileX, HelpCircle, TimerReset,
  Lock, Coins, Hash
} from 'lucide-react';
import api from '../utils/api';
import PageHeader from '../components/common/PageHeader';
import ErrorState from '../components/common/ErrorState';
import EmptyState from '../components/common/EmptyState';
import LoadingSkeleton from '../components/common/LoadingSkeleton';
import DataTable from '../components/common/DataTable';
import StatusBadge from '../components/common/StatusBadge';
import ModelBadge from '../components/common/ModelBadge';
import Modal from '../components/common/Modal';
import { InfoTip } from '../components/common/Tooltip';

// Explainer content for each safety flag the scanner can emit. Keyed by the
// literal flag string the backend puts into `flag_breakdown`. Every field is
// optional except title + description — renderer handles missing pieces.
//
// Source of truth for when each flag fires: `backend/app/services/safety.py`
// (scan_input / scan_output).
const FLAG_EXPLAINERS = {
  injection_attempt: {
    icon: Regex,
    layer: 'Input · Layer 1',
    layerTone: 'accent',
    action: 'Contributes to risk score (blocks at ≥80)',
    title: 'Regex injection tripwire',
    description:
      'Cheap, deterministic first-pass scan of the user prompt. Fires when the input matches any of ~15 hardcoded prompt-injection patterns.',
    examples: [
      '"Ignore all previous instructions…"',
      '"Disregard the system prompt above"',
      '"You are now DAN / jailbreak mode"',
    ],
    how:
      'Iterates compiled regexes over the input. Each match adds to risk_score (weighted per match) and the matched spans are stored under details.injection_matches.',
    source: 'safety.py::scan_input — step 2 "Regex injection tripwire"',
  },
  llm_injection: {
    icon: Bot,
    layer: 'Input · Layer 2',
    layerTone: 'accent',
    action: 'Raises risk_score to max(existing, classifier_confidence)',
    title: 'LLM injection classifier',
    description:
      'Second opinion from a small Haiku-based classifier (detect_injection). Catches paraphrased or novel injection attempts the regex layer never saw.',
    examples: [
      'Obfuscated phrasing that dodges the regex ("ig\\u200bnore previous…")',
      'Indirect jailbreaks wrapped in storytelling / role-play',
      'Non-English injection attempts',
    ],
    how:
      'Sends the input to Haiku 4.5 with a classifier prompt. Returns {injection: bool, confidence: 0–100, reason}. Fail-open: a classifier outage leaves the regex layer authoritative and is silently degraded.',
    source: 'safety.py::scan_input — step 4 + llm_client.detect_injection',
  },
  model_refusal: {
    icon: UserX,
    layer: 'Output',
    layerTone: 'degraded',
    action: 'Flag only — response still returned',
    title: 'Model refusal detected',
    description:
      "Claude's response matched a refusal phrase. Often means the model declined a sensitive request, but in eval contexts it may mask the judge returning a non-numeric answer.",
    examples: [
      '"I cannot / I\'m not able to / I won\'t…"',
      '"I apologize, but I cannot…"',
      '"As an AI, I…"',
    ],
    how:
      'Regex pass over the response text (case-insensitive). Tracks that the model refused so dashboards can distinguish "refused" from "answered with error".',
    source: 'safety.py::scan_output — step 2 "Refusal detection"',
  },
  pii_detected: {
    icon: FileWarning,
    layer: 'Input',
    layerTone: 'accent',
    action: 'Adds to risk_score',
    title: 'PII in input',
    description:
      'User-submitted prompt contains what looks like personally identifiable information — email, phone, SSN, credit card, etc.',
    how: 'Pattern set in safety.py::_PII_PATTERNS. Each match type adds a fixed weight to risk_score.',
    source: 'safety.py::scan_input — step 3 "PII detection"',
  },
  length_exceeded: {
    icon: Maximize2,
    layer: 'Input',
    layerTone: 'failing',
    action: 'Auto-block (risk_score += 100)',
    title: 'Prompt too long',
    description:
      'Input exceeded max_prompt_length (default 10,000 chars). Hard block — never reaches the model.',
    source: 'safety.py::scan_input — step 1 "Length check"',
  },
  length_warning: {
    icon: Maximize2,
    layer: 'Input',
    layerTone: 'degraded',
    action: 'Flag only',
    title: 'Prompt nearing length limit',
    description: 'Input is over 80% of max_prompt_length. Allowed through but flagged.',
    source: 'safety.py::scan_input — step 1 "Length check"',
  },
  toxicity_detected: {
    icon: AlertOctagon,
    layer: 'Output',
    layerTone: 'failing',
    action: 'Flag only',
    title: 'Toxic content in response',
    description:
      "Response matched one of the hardcoded toxicity patterns (violence + instructions, hate speech targeting protected classes, illegal-activity how-tos).",
    source: 'safety.py::scan_output — step 3 "Toxicity / content policy"',
  },
  error_response: {
    icon: AlertOctagon,
    layer: 'Output',
    layerTone: 'failing',
    action: 'Flag only',
    title: 'Error response from model',
    description: 'Response text started with "ERROR:" — wrapper signalling upstream failure rather than a real answer.',
    source: 'safety.py::scan_output — step 4',
  },
};

// PII flags on OUTPUT come through prefixed, e.g. `output_pii_email`.
// Resolver handles both exact matches and the prefix family.
function resolveFlagExplainer(flag) {
  if (FLAG_EXPLAINERS[flag]) return FLAG_EXPLAINERS[flag];
  if (flag && flag.startsWith('output_pii_')) {
    const kind = flag.slice('output_pii_'.length);
    return {
      icon: FileWarning,
      layer: 'Output',
      layerTone: 'failing',
      action: 'Flag only',
      title: `PII in response (${kind})`,
      description: `Response appears to contain ${kind}. Scanner pattern-matched on the outbound text before returning to the caller.`,
      source: 'safety.py::scan_output — step 1 "PII in response"',
    };
  }
  return {
    icon: Shield,
    layer: 'Unknown',
    layerTone: 'accent',
    title: flag || 'Unknown flag',
    description: 'This flag is not in the frontend explainer map yet. It comes from the safety scanner but no metadata is registered here.',
    source: 'safety.py',
  };
}

// Explainers for the Performance tab's error pills. Keys match the post-strip
// keys the backend emits: `error_breakdown = {row[0].replace("error_", ""): count}`.
// So `error_unknown` in the DB surfaces as `unknown` in the pill.
//
// Source of truth for when each error fires:
//   backend/app/services/llm_client.py::_make_api_call_core (except blocks)
const ERROR_EXPLAINERS = {
  rate_limit: {
    icon: TimerReset,
    tone: 'degraded',
    title: 'Anthropic rate limit (HTTP 429)',
    description:
      "Anthropic returned 429 — the account or this specific model tripped its per-minute or per-day request limit. The call already retried with exponential backoff and still couldn't get through.",
    cause: [
      'Traffic spike — too many concurrent eval runs or scheduled health checks firing simultaneously.',
      "Workspace key is shared with another app that's saturating the limit.",
      'The model tier (Sonnet vs Haiku) has a lower TPM/RPM ceiling than this workload needs.',
    ],
    fix:
      'Reduce api_max_calls_per_minute in config, stagger scheduled jobs, or request a higher quota from Anthropic. Check the Cost tab to see if retries are inflating spend.',
    retried: '2× exponential backoff + jitter before surfacing as an error.',
    source: 'llm_client.py:345 anthropic.RateLimitError',
  },
  timeout: {
    icon: Clock,
    tone: 'degraded',
    title: 'API connection error / timeout',
    description:
      "The HTTPS call to Anthropic didn't complete. Either the connection never established, was cut mid-stream, or didn't return within llm_timeout_seconds (default 30).",
    cause: [
      'Transient network blip between the backend host and api.anthropic.com.',
      'Anthropic edge node dropped the connection (rare but happens).',
      'The model is generating unusually long output that exceeds the timeout — not the Anthropic SDK raising internally, but the socket timing out.',
    ],
    fix:
      'If spiking, check outbound egress / DNS. If persistent and latency is high, consider raising llm_timeout_seconds. Does not indicate a bad prompt or bad key.',
    retried: '2× exponential backoff + jitter before surfacing as an error.',
    source: 'llm_client.py:353 anthropic.APIConnectionError',
  },
  server: {
    icon: ServerCrash,
    tone: 'failing',
    title: 'Anthropic internal server error (HTTP 5xx)',
    description:
      'Anthropic returned a 5xx. Their side, not ours. The SDK raised InternalServerError — request was well-formed but their API could not complete it.',
    cause: [
      'Anthropic platform incident — check status.anthropic.com.',
      'Rare — routing/capacity hiccup for a specific model in a specific region.',
    ],
    fix:
      "Nothing you can do locally. The code already retries. If the rate stays elevated, open a support ticket with Anthropic and reference the timestamp(s) from this panel.",
    retried: '2× exponential backoff + jitter before surfacing as an error.',
    source: 'llm_client.py:361 anthropic.InternalServerError',
  },
  auth: {
    icon: KeyRound,
    tone: 'failing',
    title: 'Authentication error (HTTP 401)',
    description:
      "Anthropic rejected the API key. The SDK raised AuthenticationError, and we fail IMMEDIATELY — no retries, because retrying a bad key just keeps failing.",
    cause: [
      'anthropic_api_key in .env is missing, malformed, revoked, or rotated.',
      'Key belongs to a workspace that lost access to the requested model.',
      'Stray whitespace or unescaped characters around the key when loaded.',
    ],
    fix:
      'Verify ANTHROPIC_API_KEY. Rotate if it was ever committed or shared. This is a configuration error — any recurrence means the fix never took.',
    retried: 'No — non-retryable.',
    source: 'llm_client.py:369 anthropic.AuthenticationError',
  },
  bad_request: {
    icon: FileX,
    tone: 'failing',
    title: 'Bad request (HTTP 400)',
    description:
      "Anthropic rejected the request shape. SDK raised BadRequestError — malformed payload, exceeded max_tokens ceiling, empty messages array, etc. Not retried (retrying won't fix a shape problem).",
    cause: [
      'max_tokens requested exceeds the model\'s hard ceiling.',
      'Prompt exceeds the model context window (post-tokenization).',
      'Invalid content block structure (rare — would mean an SDK/backend code bug).',
    ],
    fix:
      "Open APIUsageLog for the matching row and inspect prompt_text / caller. If it's a code bug, fix the request shape. If it's user input length, tighten max_prompt_length in safety config.",
    retried: 'No — non-retryable.',
    source: 'llm_client.py:374 anthropic.BadRequestError',
  },
  unknown: {
    icon: HelpCircle,
    tone: 'failing',
    title: 'Unknown / uncategorised error',
    description:
      "Caught by the bare except Exception block after none of the specific handlers (rate-limit, timeout, 5xx, auth, bad-request) matched. Usually means something failed inside our code AFTER the Anthropic response came back, or a new Anthropic exception class we haven't wired up yet.",
    cause: [
      'Response parsing bug on our side (e.g. content[0].text on an empty content list).',
      "A new or deprecated anthropic SDK exception we don't catch explicitly yet.",
      'Downstream code raised (safety scanner, usage logger, pricing calc) before the call finalised cleanly.',
      'OS-level issue — disk full while writing APIUsageLog, etc.',
    ],
    fix:
      "Find the matching APIUsageLog rows (status='error_unknown') and cross-reference backend logs for the stack trace. If the same root cause repeats, add a specific except clause above the bare Exception handler so it stops hiding.",
    retried: 'No — the bare except re-raises immediately after finalising the reservation.',
    source: 'llm_client.py:382 except Exception',
  },
};

function resolveErrorExplainer(type) {
  if (ERROR_EXPLAINERS[type]) return ERROR_EXPLAINERS[type];
  return {
    icon: HelpCircle,
    tone: 'failing',
    title: type || 'Unknown error type',
    description:
      "No explainer registered for this error key. It's coming from APIUsageLog.status — check the backend for a matching error_* status that isn't mapped in the frontend yet.",
    source: 'backend/app/services/llm_client.py',
  };
}

function ErrorDetailModal({ errorType, count, onClose }) {
  if (!errorType) return null;
  const info = resolveErrorExplainer(errorType);
  const Icon = info.icon || HelpCircle;
  const tone = info.tone || 'failing';
  return (
    <Modal isOpen={Boolean(errorType)} onClose={onClose} title="API error explainer" maxWidth="max-w-xl">
      <div className="space-y-4 text-[13px] text-text-muted leading-relaxed">
        <div className="flex items-start gap-3">
          <div className={`w-9 h-9 rounded-lg bg-status-${tone}-muted flex items-center justify-center shrink-0`}>
            <Icon size={18} strokeWidth={1.75} className={`text-status-${tone}`} />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <code className="font-mono text-[13px] font-semibold text-text bg-surface-elevated px-1.5 py-0.5 rounded">error_{errorType}</code>
              {count != null && (
                <span className="text-[11px] text-text-subtle">{count}× today</span>
              )}
            </div>
            <p className="text-[14px] font-semibold text-text mt-1">{info.title}</p>
          </div>
        </div>

        <p>{info.description}</p>

        {info.cause && info.cause.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold text-text-subtle uppercase tracking-[0.09em] mb-1.5">Common causes</p>
            <ul className="space-y-1 pl-4 list-disc marker:text-text-subtle">
              {info.cause.map((c) => <li key={c}>{c}</li>)}
            </ul>
          </div>
        )}

        {info.fix && (
          <div>
            <p className="text-[11px] font-semibold text-text-subtle uppercase tracking-[0.09em] mb-1">How to address it</p>
            <p>{info.fix}</p>
          </div>
        )}

        {info.retried && (
          <div className="rounded-md bg-surface-elevated/60 border border-hairline px-3 py-2 text-[12px]">
            <span className="font-semibold text-text">Retry policy: </span>{info.retried}
          </div>
        )}

        <p className="text-[11px] text-text-subtle pt-2 border-t border-hairline">
          Source: <code className="font-mono">{info.source}</code>
        </p>
      </div>
    </Modal>
  );
}

function FlagDetailModal({ flag, count, onClose }) {
  if (!flag) return null;
  const info = resolveFlagExplainer(flag);
  const Icon = info.icon || Shield;
  const tone = info.layerTone || 'accent';
  return (
    <Modal isOpen={Boolean(flag)} onClose={onClose} title="Safety flag explainer" maxWidth="max-w-xl">
      <div className="space-y-4 text-[13px] text-text-muted leading-relaxed">
        <div className="flex items-start gap-3">
          <div className={`w-9 h-9 rounded-lg bg-status-${tone}-muted flex items-center justify-center shrink-0`}>
            <Icon size={18} strokeWidth={1.75} className={`text-status-${tone}`} />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <code className="font-mono text-[13px] font-semibold text-text bg-surface-elevated px-1.5 py-0.5 rounded">{flag}</code>
              <span className={`text-[10px] uppercase tracking-[0.09em] font-semibold px-2 py-0.5 rounded-pill bg-status-${tone}-muted text-status-${tone}`}>
                {info.layer}
              </span>
              {count != null && (
                <span className="text-[11px] text-text-subtle">· {count}× today</span>
              )}
            </div>
            <p className="text-[14px] font-semibold text-text mt-1">{info.title}</p>
          </div>
        </div>

        <p>{info.description}</p>

        {info.examples && info.examples.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold text-text-subtle uppercase tracking-[0.09em] mb-1.5">Example triggers</p>
            <ul className="space-y-1 pl-4 list-disc marker:text-text-subtle">
              {info.examples.map((ex) => (
                <li key={ex}><span className="font-mono text-[12px] text-text">{ex}</span></li>
              ))}
            </ul>
          </div>
        )}

        {info.how && (
          <div>
            <p className="text-[11px] font-semibold text-text-subtle uppercase tracking-[0.09em] mb-1">How it's detected</p>
            <p>{info.how}</p>
          </div>
        )}

        {info.action && (
          <div>
            <p className="text-[11px] font-semibold text-text-subtle uppercase tracking-[0.09em] mb-1">What happens</p>
            <p>{info.action}</p>
            <p className="text-[11px] text-text-subtle mt-1">
              A prompt is blocked when its total risk_score ≥ 80. Non-blocking flags still appear here for visibility.
            </p>
          </div>
        )}

        <p className="text-[11px] text-text-subtle pt-2 border-t border-hairline">
          Source: <code className="font-mono">{info.source}</code>
        </p>
      </div>
    </Modal>
  );
}

const SECTIONS = [
  { id: 'model', label: 'Model & Pricing', icon: Cpu },
  { id: 'evaluation', label: 'Evaluation', icon: Activity },
  { id: 'limits', label: 'API Limits', icon: Lock },
  { id: 'usage', label: 'API Usage', icon: Zap },
  { id: 'safety', label: 'Safety', icon: Shield },
  { id: 'performance', label: 'Performance', icon: LineChartIcon },
];

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [config, setConfig] = useState(null);
  const [apiUsage, setApiUsage] = useState(null);
  const [performance, setPerformance] = useState(null);
  const [safety, setSafety] = useState(null);
  // Hard caps + live usage from the single-gatekeeper endpoint. Read-only —
  // configured via env vars, surfaced here so reviewers can see what the
  // gatekeeper is actually enforcing.
  const [limits, setLimits] = useState(null);
  // Selected flag for the explainer modal — `{name, count}` or null.
  const [flagDetail, setFlagDetail] = useState(null);
  // Selected API error type for its explainer modal — `{type, count}` or null.
  const [errorDetail, setErrorDetail] = useState(null);
  // Initialize active section from URL hash so /settings#safety deep-links
  // straight into the Safety tab. Falls back to 'model' when the hash is
  // empty or points at an unknown section.
  const [active, setActive] = useState(() => {
    const hash = typeof window !== 'undefined' ? window.location.hash.replace('#', '') : '';
    return SECTIONS.some(s => s.id === hash) ? hash : 'model';
  });
  // Live refresh indicator — matches Dashboard / Evaluations / Incidents.
  const [lastFetchAt, setLastFetchAt] = useState(Date.now());
  const [nowTick, setNowTick] = useState(Date.now());

  const handleSectionChange = (id) => {
    setActive(id);
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', `#${id}`);
    }
  };

  const fetchAll = async (showLoading = false) => {
    if (showLoading) setError(null);
    // Fetch each endpoint with Promise.allSettled so a single failing
    // endpoint doesn't black-hole the whole page. Partial data still
    // renders the sections whose fetch succeeded.
    const endpoints = [
      ['settings',   '/dashboard/settings',   setConfig],
      ['api-usage',  '/dashboard/api-usage',  setApiUsage],
      ['performance','/dashboard/performance', setPerformance],
      ['api-safety', '/dashboard/api-safety',  setSafety],
      ['limits',     '/settings/limits',      setLimits],
    ];
    const results = await Promise.allSettled(
      endpoints.map(([, url]) => api.get(url))
    );
    const failures = [];
    results.forEach((res, i) => {
      const [name, , setter] = endpoints[i];
      if (res.status === 'fulfilled') {
        setter(res.value.data);
      } else {
        const err = res.reason;
        const status = err?.response?.status;
        const detail = err?.response?.data?.detail || err?.message || 'unknown error';
        // eslint-disable-next-line no-console
        console.error(`[SettingsPage] ${name} failed:`, status, detail, err);
        failures.push(`${name}${status ? ` (${status})` : ''}: ${detail}`);
      }
    });
    setLastFetchAt(Date.now());
    if (showLoading) {
      setError(failures.length === endpoints.length ? failures.join(' · ') : null);
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll(true);
    // 60s — the data on this page (daily spend, token totals, blocked calls)
    // only changes on LLM-call cadence. 10s was overkill.
    const interval = setInterval(() => fetchAll(false), 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const secsSinceFetch = Math.max(0, Math.floor((nowTick - lastFetchAt) / 1000));
  const updatedLabel = secsSinceFetch < 1 ? 'just now' : `${secsSinceFetch}s ago`;

  const callColumns = [
    {
      key: 'timestamp',
      label: 'Time',
      render: v => {
        if (!v) return <span className="font-mono text-xs text-text-subtle">—</span>;
        const d = new Date(v);
        if (Number.isNaN(d.getTime())) return <span className="font-mono tabular-nums text-xs">{v}</span>;
        const short = d.toLocaleString(undefined, {
          month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
        });
        return (
          <span
            className="font-mono tabular-nums text-xs"
            title={`${d.toLocaleString()} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`}
          >
            {short}
          </span>
        );
      },
    },
    {
      key: 'caller',
      label: 'Purpose',
      render: v => {
        // Humanize the internal caller string so a non-engineer panel
        // reviewer doesn't have to guess what `detect_hallucination` means.
        // Raw caller id still shows on hover for engineers.
        const HUMAN = {
          run_eval_prompt: 'Actor call',
          test_connection: 'Connection probe',
          score_factuality: 'Factuality judge',
          detect_hallucination: 'Hallucination judge',
          detect_injection: 'Injection detector',
          generate_summary: 'Incident summary',
          generate_dashboard_insight: 'Dashboard insight',
          generate_compliance_summary: 'Compliance report',
        };
        const label = HUMAN[v] || v;
        return (
          <span className="text-xs" title={v}>
            {label}
          </span>
        );
      },
    },
    { key: 'model', label: 'Model', render: v => <ModelBadge model={v} /> },
    { key: 'input_tokens', label: 'In', render: v => <span className="font-mono tabular-nums">{v?.toLocaleString()}</span> },
    { key: 'output_tokens', label: 'Out', render: v => <span className="font-mono tabular-nums">{v?.toLocaleString()}</span> },
    { key: 'cost_usd', label: 'Cost', render: v => <span className="font-mono tabular-nums font-medium">${v?.toFixed(4)}</span> },
    { key: 'latency_ms', label: 'Latency', render: v => <span className="font-mono tabular-nums">{v?.toFixed(0)}ms</span> },
    {
      key: 'status',
      label: 'Status',
      render: v => {
        // Richer status taxonomy: blocked_safety is not the same as a generic
        // failure — the safety layer fired correctly. Error_* covers infra.
        const MAP = {
          success: 'healthy',
          blocked_safety: 'blocked_safety',
          error_rate_limit: 'failed',
          error_timeout: 'failed',
          error_server: 'failed',
          error_auth: 'failed',
          error_bad_request: 'failed',
          error_unknown: 'failed',
          reserved: 'investigating',
        };
        return <StatusBadge status={MAP[v] || 'failed'} />;
      },
    },
  ];

  if (loading) return (
    <div className="space-y-5" aria-busy="true">
      <div className="h-5 w-40 bg-surface-elevated rounded-md animate-pulse" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4"><LoadingSkeleton type="card" /><LoadingSkeleton type="card" /></div>
    </div>
  );

  if (error) return <ErrorState message={error} onRetry={() => window.location.reload()} />;

  return (
    <div className="space-y-6">
      <FlagDetailModal
        flag={flagDetail?.name}
        count={flagDetail?.count}
        onClose={() => setFlagDetail(null)}
      />
      <ErrorDetailModal
        errorType={errorDetail?.type}
        count={errorDetail?.count}
        onClose={() => setErrorDetail(null)}
      />
      <PageHeader title="API & Settings" description="Model configuration, cost monitoring, safety scanner, and performance.">
        <div
          className="flex items-center gap-1.5"
          aria-label={`Last refreshed ${updatedLabel}, auto-refreshing every 60 seconds`}
          title={`Refreshes every 60 seconds. Last: ${updatedLabel}.`}
        >
          <span
            key={lastFetchAt}
            className="dash-pulse w-1.5 h-1.5 rounded-full bg-status-healthy"
            aria-hidden="true"
          />
          <span className="text-[11px] font-medium text-text-subtle tracking-tight tabular-nums">
            Updated {updatedLabel}
          </span>
        </div>
      </PageHeader>

      <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-6">
        {/* Left secondary nav */}
        <aside className="lg:sticky lg:top-24 self-start">
          <nav className="flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible" aria-label="Settings sections">
            {SECTIONS.map(({ id, label, icon: Icon }) => {
              const isActive = active === id;
              return (
                <button
                  key={id}
                  onClick={() => handleSectionChange(id)}
                  aria-current={isActive ? 'true' : undefined}
                  className={`shrink-0 flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] text-left transition-standard ${
                    isActive
                      ? 'bg-accent-weak text-text font-medium'
                      : 'text-text-muted hover:bg-surface-elevated hover:text-text'
                  }`}
                >
                  <Icon size={15} strokeWidth={1.5} className={isActive ? 'text-accent' : 'text-text-subtle'} />
                  {label}
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Right content panel */}
        <div className="space-y-5 min-w-0">
          {active === 'model' && config && (
            <>
              <Card icon={Brain} title="AI model">
                <Row label="Provider" value={config.ai_model.provider} />
                <Row label="Model" value={<span className="font-mono text-[12px] bg-surface-elevated px-1.5 py-0.5 rounded-xs">{config.ai_model.model}</span>} />
                <Row label="Max tokens" value={config.ai_model.max_tokens.toLocaleString()} mono />
                <Row label="Timeout" value={`${config.ai_model.timeout_seconds}s`} mono />
              </Card>
              <Card icon={CreditCard} title="Pricing">
                <Row label="Input" value={`$${config.pricing.input_per_million_usd} / 1M tokens`} mono />
                <Row label="Output" value={`$${config.pricing.output_per_million_usd} / 1M tokens`} mono />
                <p className="text-[11px] text-text-subtle pt-3 border-t border-hairline mt-2">Estimated from API response token counts.</p>
              </Card>
            </>
          )}

          {active === 'evaluation' && config && (
            <Card icon={Activity} title="Evaluation">
              <Row
                label="Drift threshold"
                value={`${config.evaluation.drift_threshold_pct}%`}
                mono
                tooltip="Quality score below which drift is flagged. Runs scoring lower than this trigger alerts."
              />
              <Row
                label="Health check"
                value={`${config.evaluation.health_check_schedule_minutes} min`}
                mono
                tooltip="How often the system pings each service to confirm it's reachable."
              />
              <Row
                label="Auto eval"
                value={`${config.evaluation.eval_schedule_minutes} min`}
                mono
                tooltip="How often the background scheduler runs evaluations against every active, non-confidential service with test cases. Saved as scheduled runs; drift alerts fire on threshold breach."
              />
            </Card>
          )}

          {active === 'limits' && limits && (
            <>
              <Card
                icon={Lock}
                title="Hard caps — single gatekeeper"
                badge="Read-only · configured via env"
              >
                <p className="text-[12px] text-text-muted mb-3 leading-relaxed">
                  Every Claude call in the system passes through one function
                  (<code className="font-mono text-[12px] bg-surface-elevated px-1 py-0.5 rounded">enforce_call_limits</code>)
                  that rejects requests exceeding these hard caps <em>before</em>
                  the network call. This is defense against bugs and misuse;
                  normal operation never hits these.
                </p>
                <div className="grid grid-cols-3 gap-3 mb-3">
                  <LimitStat
                    icon={Coins}
                    label="Cost per call"
                    value={`$${limits.hard_caps.max_cost_per_call_usd.toFixed(4)}`}
                    sub="worst-case per single call"
                    tooltip="Rejects any call whose worst-case cost (max_tokens × output rate for the chosen model) would exceed this. Per-model pricing means Haiku passes where Sonnet fails for the same token count."
                  />
                  <LimitStat
                    icon={Hash}
                    label="Tokens per call"
                    value={limits.hard_caps.max_tokens_per_call.toLocaleString()}
                    sub="max_tokens ceiling"
                    tooltip="Maximum max_tokens regardless of what the caller requested. Blocks accidental 100k-token asks."
                  />
                  <LimitStat
                    icon={FileWarning}
                    label="Prompt length"
                    value={`${limits.hard_caps.max_prompt_chars.toLocaleString()} chars`}
                    sub="hard ceiling"
                    tooltip="Hard ceiling on input text length. Checked before any tokenization or DB work — cheapest reject path."
                  />
                </div>
                <p className="text-[11px] text-text-subtle pt-3 border-t border-hairline">
                  Configured via <code className="font-mono">HARD_MAX_*</code> environment variables. Raise in <code className="font-mono">.env</code> if your use case is genuinely larger.
                </p>
              </Card>

              <Card
                icon={ShieldCheck}
                title="Soft limits"
                badge="Read-only · configured via env"
              >
                <p className="text-[12px] text-text-muted mb-3 leading-relaxed">
                  Aggregated ceilings that reject calls only <em>after</em> the limit is reached (based on usage-log history).
                </p>
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                  <LimitStat
                    icon={CreditCard}
                    label="Daily budget"
                    value={`$${limits.soft_limits.daily_budget_usd.toFixed(2)}`}
                    sub="total spend cap / day"
                    tooltip="Blocks new Claude calls once today's total API spend reaches this amount. Resets at midnight UTC."
                  />
                  <LimitStat
                    icon={CreditCard}
                    label="Monthly budget"
                    value={`$${limits.soft_limits.monthly_budget_usd.toFixed(2)}`}
                    sub="total spend cap / month"
                    tooltip="Blocks new Claude calls once this month's total API spend reaches this amount. Resets on the 1st."
                  />
                  <LimitStat
                    icon={Gauge}
                    label="Global rate"
                    value={`${limits.soft_limits.calls_per_minute}`}
                    sub="calls/minute (all users)"
                    tooltip="Maximum Claude calls across the whole system per rolling 60-second window. Prevents bursts that would trigger provider-side throttling."
                  />
                  <LimitStat
                    icon={UserX}
                    label="Per-user rate"
                    value={`${limits.soft_limits.calls_per_user_per_minute}`}
                    sub="calls/minute per user"
                    tooltip="Maximum Claude calls that a single authenticated user can fire per rolling 60-second window."
                  />
                  <LimitStat
                    icon={FileWarning}
                    label="Prompt length (soft)"
                    value={`${limits.soft_limits.max_prompt_length_soft.toLocaleString()} chars`}
                    sub="regex-scanner threshold"
                    tooltip="The regex safety scanner flags prompts above 80% of this length as a length_warning, and blocks at 100%. Independent from the hard prompt_chars cap above."
                  />
                </div>
              </Card>

              <Card
                icon={BarChart3}
                title="Current usage"
                badge="Live · refresh every 60s"
              >
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <LimitStat
                    icon={DollarSign}
                    label="Today"
                    value={`$${limits.current_usage.today_usd.toFixed(4)}`}
                    sub={`/ $${limits.soft_limits.daily_budget_usd.toFixed(2)} daily`}
                    pct={limits.soft_limits.daily_budget_usd > 0
                      ? (limits.current_usage.today_usd / limits.soft_limits.daily_budget_usd) * 100
                      : null}
                    tooltip="Sum of estimated cost for every Claude call today (all users, all callers). Compared against the daily budget."
                  />
                  <LimitStat
                    icon={DollarSign}
                    label="This month"
                    value={`$${limits.current_usage.month_usd.toFixed(4)}`}
                    sub={`/ $${limits.soft_limits.monthly_budget_usd.toFixed(2)} monthly`}
                    pct={limits.soft_limits.monthly_budget_usd > 0
                      ? (limits.current_usage.month_usd / limits.soft_limits.monthly_budget_usd) * 100
                      : null}
                    tooltip="Sum of estimated cost for every Claude call this month (all users, all callers). Compared against the monthly budget."
                  />
                  <LimitStat
                    icon={Gauge}
                    label="Last minute (all)"
                    value={`${limits.current_usage.calls_last_minute}`}
                    sub={`/ ${limits.soft_limits.calls_per_minute} cap`}
                    pct={limits.soft_limits.calls_per_minute > 0
                      ? (limits.current_usage.calls_last_minute / limits.soft_limits.calls_per_minute) * 100
                      : null}
                    tooltip="Claude calls in the last 60 seconds across all users. Compared against the global rate limit."
                  />
                  <LimitStat
                    icon={UserX}
                    label="Last minute (you)"
                    value={`${limits.current_usage.calls_last_minute_by_user}`}
                    sub={`/ ${limits.soft_limits.calls_per_user_per_minute} cap`}
                    pct={limits.soft_limits.calls_per_user_per_minute > 0
                      ? (limits.current_usage.calls_last_minute_by_user / limits.soft_limits.calls_per_user_per_minute) * 100
                      : null}
                    tooltip="Claude calls fired by your user account in the last 60 seconds. Compared against the per-user rate limit."
                  />
                </div>
              </Card>
            </>
          )}

          {active === 'usage' && apiUsage && config && (
            <>
              <Card icon={ShieldCheck} title="Budget & rate limits" badge="Configured in .env">
                <div className="grid grid-cols-3 gap-3 mb-4">
                  <BudgetCard
                    label="Daily"
                    spent={apiUsage.daily.cost_usd}
                    budget={apiUsage.daily.budget_usd}
                    pct={apiUsage.daily.budget_pct_used}
                    tooltip="Total USD spent on the Claude API today vs. the daily cap. New calls are blocked at 100%."
                  />
                  <BudgetCard
                    label="Monthly"
                    spent={apiUsage.monthly.cost_usd}
                    budget={apiUsage.monthly.budget_usd}
                    pct={apiUsage.monthly.budget_pct_used}
                    tooltip="Total USD spent this month vs. the monthly cap. Prevents runaway costs."
                  />
                  <div className="bg-surface-elevated rounded-lg p-3">
                    <div className="flex items-center gap-1.5 mb-2">
                      <Gauge size={12} strokeWidth={1.5} className="text-text-subtle" />
                      <span className="text-[10px] font-medium text-text-subtle tracking-tight">Rate limit</span>
                      <InfoTip content="Max API calls per minute. Prevents bursts that could trigger provider-side throttling." size={10} />
                    </div>
                    <p className="text-xl font-semibold font-mono tabular-nums text-text">{config.budget.rate_limit_per_min}</p>
                    <p className="text-[10px] text-text-subtle">calls/min</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[12px] text-text-muted">
                  <div className="flex items-center gap-1.5"><ShieldCheck size={12} strokeWidth={1.5} className="text-accent shrink-0" /> Budget blocks calls at limit</div>
                  <div className="flex items-center gap-1.5"><Gauge size={12} strokeWidth={1.5} className="text-accent shrink-0" /> Rate limiter prevents bursts</div>
                </div>
              </Card>

              <Card icon={Zap} title="Token usage">
                <div className="grid grid-cols-4 gap-3 mb-4">
                  <Stat label="Today calls" value={apiUsage.daily.calls} tooltip="Number of Claude API calls made today." />
                  <Stat label="Today tokens" value={apiUsage.daily.total_tokens.toLocaleString()} tooltip="Total input + output tokens used today. Tokens are roughly 4 characters each." />
                  <Stat label="Month calls" value={apiUsage.monthly.calls} tooltip="Total API calls made this calendar month." />
                  <Stat label="Month tokens" value={apiUsage.monthly.total_tokens.toLocaleString()} tooltip="Total tokens consumed this month, input and output combined." />
                </div>
                {apiUsage.breakdown.length > 0 && (
                  <div className="pt-3 border-t border-hairline space-y-1.5">
                    <h4 className="text-[11px] font-medium text-text-subtle tracking-tight mb-2">Cost by function</h4>
                    {apiUsage.breakdown.map(b => (
                      <div key={b.function} className="flex items-center justify-between px-3 py-2 bg-surface-elevated rounded-lg text-[12px]">
                        <span className="font-mono text-text-muted">{b.function}</span>
                        <div className="flex items-center gap-3 font-mono tabular-nums">
                          <span className="text-text-subtle">{b.calls} calls</span>
                          <span className="font-medium text-text">${b.cost_usd.toFixed(4)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              <div>
                <h3 className="text-[13px] font-semibold text-text tracking-tight mb-3">Recent API calls</h3>
                {apiUsage?.recent_calls?.length > 0 ? (
                  <DataTable columns={callColumns} data={apiUsage.recent_calls} searchPlaceholder="Search calls..." />
                ) : (
                  <EmptyState icon={Zap} title="No API calls yet" description="Usage appears here when Claude API features are used." />
                )}
              </div>
            </>
          )}

          {active === 'safety' && safety && (
            <Card icon={Shield} title="Prompt safety scanner">
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
                <Stat label="Scanned" value={safety.total_scanned_today} tooltip="Total prompts checked by the safety scanner today, before reaching the model." />
                <Stat label="Blocked" value={safety.blocked_today} danger={safety.blocked_today > 0} tooltip="Prompts rejected outright today — prompt-injection, PII, or policy violations." />
                <Stat label="Flagged" value={safety.flagged_today} warn={safety.flagged_today > 0} tooltip="Prompts that raised a warning but were still allowed through today." />
                <Stat label="Avg risk" value={safety.avg_risk_score} tooltip="Average risk score (0–100) of inputs scanned today. Higher means more flags per prompt." />
                <Stat label="Blocked MTD" value={safety.blocked_this_month} danger={safety.blocked_this_month > 0} tooltip="Total prompts blocked month-to-date. Promoted out of the footer line so month-over-month scanner load is scannable at a glance." />
              </div>
              {Object.keys(safety.flag_breakdown).length > 0 && (
                <div className="mb-3">
                  <h4 className="text-[11px] font-medium text-text-subtle tracking-tight mb-2 flex items-center gap-1.5">
                    Flags
                    <InfoTip content="Click a flag to see what the scanner is checking and how it's detected." size={11} />
                  </h4>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(safety.flag_breakdown).map(([flag, count]) => (
                      <button
                        key={flag}
                        type="button"
                        onClick={() => setFlagDetail({ name: flag, count })}
                        className="px-2.5 py-0.5 bg-status-failing-muted text-status-failing rounded-pill text-[11px] font-medium tracking-tight hover:bg-status-failing hover:text-white transition-standard focus:outline-none focus:ring-2 focus:ring-accent/50"
                        title={`Click to see what "${flag}" means`}
                      >
                        {flag}: {count}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {safety.recent_blocked.length > 0 && (
                <div className="space-y-1.5 pt-3 border-t border-hairline">
                  <h4 className="text-[11px] font-medium text-text-subtle tracking-tight mb-1">Recently blocked</h4>
                  {safety.recent_blocked.map((b, i) => {
                    // safety_flags comes as a comma-separated string; split so
                    // each individual flag becomes its own clickable chip.
                    const flagList = (b.safety_flags || '')
                      .split(',')
                      .map((f) => f.trim())
                      .filter(Boolean);
                    return (
                      <div key={i} className="flex items-center justify-between px-3 py-2 bg-status-failing-muted rounded-lg text-[12px] gap-3">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <Ban size={11} strokeWidth={1.5} className="text-status-failing shrink-0" />
                          <span className="font-mono text-text truncate">{b.caller}</span>
                        </div>
                        <div className="flex flex-wrap gap-1 justify-end">
                          {flagList.length > 0 ? flagList.map((f) => (
                            <button
                              key={f}
                              type="button"
                              onClick={() => setFlagDetail({ name: f, count: null })}
                              className="font-mono text-[11px] text-status-failing bg-surface/60 hover:bg-surface border border-status-failing/30 hover:border-status-failing rounded px-1.5 py-0.5 transition-standard"
                              title={`Click to see what "${f}" means`}
                            >
                              {f}
                            </button>
                          )) : (
                            <span className="font-mono text-text-subtle">—</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="mt-3 flex items-center gap-1.5 text-[12px] text-status-healthy">
                <ShieldCheck size={12} strokeWidth={1.5} />
                <span>Scanner active — every prompt is checked before transmission.</span>
              </div>
            </Card>
          )}

          {active === 'performance' && performance && (
            <Card icon={BarChart3} title="Performance">
              <h4 className="text-[11px] font-medium text-text-subtle tracking-tight mb-2 flex items-center gap-1.5">
                API latency · today
                <InfoTip content="Response times today across all Claude API calls, in milliseconds. Percentile labels describe where a given value sits in the distribution." />
              </h4>
              <div className="grid grid-cols-6 gap-2 mb-4">
                {[
                  { key: 'min', tip: 'Fastest response time today.' },
                  { key: 'p50', tip: 'Median — half of all calls were faster than this.' },
                  { key: 'avg', tip: 'Arithmetic mean. Can be skewed by outliers.' },
                  { key: 'p95', tip: '95% of calls were faster than this. Shows slow-tail.' },
                  { key: 'p99', tip: '99% of calls were faster. Extreme-tail outliers.' },
                  { key: 'max', tip: 'Slowest single call today.' },
                ].map(({ key, tip }) => (
                  <div key={key} className="text-center p-2.5 bg-surface-elevated rounded-lg">
                    <p className="text-[10px] font-medium text-text-subtle tracking-tight uppercase flex items-center justify-center gap-1">
                      {key}
                      <InfoTip content={tip} size={10} />
                    </p>
                    <p className="text-[15px] font-semibold font-mono tabular-nums text-text mt-0.5">{performance.latency[key]}ms</p>
                  </div>
                ))}
              </div>
              {Object.keys(performance.error_breakdown).length > 0 && (
                <div className="mb-3 pt-3 border-t border-hairline">
                  <h4 className="text-[11px] font-medium text-text-subtle tracking-tight mb-2 flex items-center gap-1.5">
                    Errors
                    <InfoTip content="Click an error type to see what triggers it, the retry behaviour, and how to address it." size={11} />
                  </h4>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(performance.error_breakdown).map(([type, count]) => (
                      <button
                        key={type}
                        type="button"
                        onClick={() => setErrorDetail({ type, count })}
                        className="px-2.5 py-0.5 bg-status-failing-muted text-status-failing rounded-pill text-[11px] font-medium tracking-tight hover:bg-status-failing hover:text-white transition-standard focus:outline-none focus:ring-2 focus:ring-accent/50"
                        title={`Click to see what "${type}" means`}
                      >
                        {type}: {count}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="grid grid-cols-4 gap-3 pt-3 border-t border-hairline">
                <Stat label="Calls" value={performance.throughput.calls_today} tooltip="Total API calls made today." />
                <Stat label="Tokens" value={performance.throughput.tokens_today.toLocaleString()} tooltip="Total tokens processed today (input + output)." />
                <Stat label="Cost/call" value={`$${performance.efficiency.avg_cost_per_call.toFixed(4)}`} tooltip="Average USD cost per API call today. Lower is more efficient." />
                <Stat label="Tokens/$" value={performance.efficiency.tokens_per_dollar.toLocaleString()} tooltip="Tokens received per dollar spent. Higher is more efficient." />
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Local sub-components ── */

function Card({ icon: Icon, title, badge, children }) {
  return (
    <div className="bg-surface rounded-xl border border-hairline shadow-xs overflow-hidden">
      <div className="px-5 py-3.5 border-b border-hairline flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon size={14} strokeWidth={1.75} className="text-text-subtle" />
          <h3 className="text-[13px] font-semibold text-text tracking-tight">{title}</h3>
        </div>
        {badge && <span className="text-[11px] text-text-subtle">{badge}</span>}
      </div>
      <div className="p-5 space-y-2.5">{children}</div>
    </div>
  );
}

function Row({ label, value, mono, tooltip }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-[13px] text-text-muted flex items-center gap-1.5">
        {label}
        {tooltip && <InfoTip content={tooltip} size={11} />}
      </span>
      <span className={`text-[13px] font-medium text-text ${mono ? 'font-mono tabular-nums' : ''}`}>{value}</span>
    </div>
  );
}

function BudgetCard({ label, spent, budget, pct, tooltip }) {
  const barColor = pct > 90 ? 'bg-status-failing' : pct > 70 ? 'bg-status-degraded' : 'bg-accent';
  const remaining = Math.max(budget - spent, 0);
  return (
    <div className="bg-surface-elevated rounded-lg p-3">
      <div className="flex items-center gap-1.5 mb-2">
        <DollarSign size={12} strokeWidth={1.5} className="text-text-subtle" />
        <span className="text-[10px] font-medium text-text-subtle tracking-tight">{label}</span>
        {tooltip && <InfoTip content={tooltip} size={10} />}
      </div>
      {/* Spent is the hero; cap is shown as denominator so users see how
          much headroom is left without needing to subtract mentally. */}
      <div className="flex items-baseline gap-1.5">
        <p className="text-xl font-semibold font-mono tabular-nums text-text">${spent.toFixed(4)}</p>
        <span className="text-[11px] text-text-subtle font-mono tabular-nums">/ ${budget.toFixed(2)}</span>
      </div>
      <div className="w-full bg-hairline rounded-pill h-1.5 my-1.5">
        <div className={`h-1.5 rounded-pill transition-all ${barColor}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <div className="flex justify-between text-[10px] text-text-subtle font-mono tabular-nums">
        <span>{pct.toFixed(1)}% used</span>
        <span>${remaining.toFixed(2)} left</span>
      </div>
    </div>
  );
}

function LimitStat({ icon: Icon, label, value, sub, pct, tooltip }) {
  // `pct` is optional. When provided, renders a tiny progress bar that
  // goes yellow >70%, red >90% — same palette as BudgetCard so reviewers
  // read "approaching cap" consistently across the page.
  const barColor = pct == null
    ? null
    : pct > 90 ? 'bg-status-failing' : pct > 70 ? 'bg-status-degraded' : 'bg-accent';
  return (
    <div className="bg-surface-elevated rounded-lg p-3">
      <div className="flex items-center gap-1.5 mb-2">
        {Icon && <Icon size={12} strokeWidth={1.5} className="text-text-subtle" />}
        <span className="text-[10px] font-medium text-text-subtle tracking-tight">{label}</span>
        {tooltip && <InfoTip content={tooltip} size={10} />}
      </div>
      <p className="text-xl font-semibold font-mono tabular-nums text-text">{value}</p>
      {sub && <p className="text-[10px] text-text-subtle mt-0.5">{sub}</p>}
      {pct != null && (
        <>
          <div className="w-full bg-hairline rounded-pill h-1.5 mt-2">
            <div className={`h-1.5 rounded-pill transition-all ${barColor}`} style={{ width: `${Math.min(pct, 100)}%` }} />
          </div>
          <div className="text-[10px] text-text-subtle font-mono tabular-nums mt-0.5">
            {pct.toFixed(1)}% of cap
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, danger, warn, tooltip }) {
  const color = danger ? 'text-status-failing' : warn ? 'text-status-degraded' : 'text-text';
  return (
    <div className="text-center p-2.5 bg-surface-elevated rounded-lg">
      <p className="text-[10px] font-medium text-text-subtle tracking-tight flex items-center justify-center gap-1">
        {label}
        {tooltip && <InfoTip content={tooltip} size={10} />}
      </p>
      <p className={`text-[15px] font-semibold font-mono tabular-nums mt-0.5 ${color}`}>{value}</p>
    </div>
  );
}
