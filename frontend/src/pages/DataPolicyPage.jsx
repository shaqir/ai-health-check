export default function DataPolicyPage() {
  return (
    <div className="max-w-3xl">
      <h2 className="text-xl font-semibold text-gray-900 mb-6">Data Handling & Privacy Routing</h2>

      <div className="space-y-4">
        {/* What data is stored */}
        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-sm font-medium text-gray-900 mb-3">What data is stored locally?</h3>
          <p className="text-sm text-gray-600 leading-relaxed">
            All application data is stored in a local SQLite database file (aiops.db) on the server
            where this application runs. This includes: registered AI service metadata, evaluation
            results and quality scores, incident records and maintenance plans, the full audit log,
            and telemetry metrics. User passwords are stored as bcrypt hashes — never in plain text.
          </p>
        </section>

        {/* What goes to the cloud */}
        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-sm font-medium text-gray-900 mb-3">What data is sent to Anthropic's API?</h3>
          <p className="text-sm text-gray-600 leading-relaxed mb-3">
            This application uses Anthropic's Claude API as its LLM provider. The following data
            leaves the server and is sent to Anthropic's cloud endpoint:
          </p>
          <ul className="text-sm text-gray-600 space-y-2 ml-4">
            <li className="flex gap-2"><span className="text-blue-500 font-bold">•</span> Test connection prompts (a short "hello" prompt — no user data)</li>
            <li className="flex gap-2"><span className="text-blue-500 font-bold">•</span> Evaluation test case prompts (synthetic data only — never real company data)</li>
            <li className="flex gap-2"><span className="text-blue-500 font-bold">•</span> Incident details (service name, severity, symptoms) when generating LLM summaries</li>
          </ul>
          <div className="mt-4 p-3 bg-amber-50 rounded-lg">
            <p className="text-xs text-amber-700">
              <strong>Important:</strong> No real employee, customer, or company data is ever sent to
              the LLM. All test data is synthetic. Incident symptoms are operational descriptions only.
            </p>
          </div>
        </section>

        {/* Prompt logging */}
        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-sm font-medium text-gray-900 mb-3">Are prompts logged?</h3>
          <p className="text-sm text-gray-600 leading-relaxed">
            Prompts sent to the LLM are <strong>not stored</strong> in our database by default. Only the
            result metadata (latency, status, quality score) is recorded. The response snippets from
            test connections are stored for debugging purposes only. Per Anthropic's data retention
            policy, API inputs and outputs are not used for model training and are retained for a
            limited period for abuse monitoring.
          </p>
        </section>

        {/* Sensitivity labels and routing */}
        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-sm font-medium text-gray-900 mb-3">How do sensitivity labels affect routing?</h3>
          <p className="text-sm text-gray-600 leading-relaxed mb-3">
            Every registered AI service is tagged with one of three sensitivity labels:
          </p>
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <span className="px-2 py-1 rounded text-xs font-medium bg-green-100 text-green-700 w-24 text-center">public</span>
              <span className="text-sm text-gray-600">Non-sensitive data. Full LLM features enabled.</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="px-2 py-1 rounded text-xs font-medium bg-yellow-100 text-yellow-700 w-24 text-center">internal</span>
              <span className="text-sm text-gray-600">Internal business data. LLM features enabled with caution.</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="px-2 py-1 rounded text-xs font-medium bg-red-100 text-red-700 w-24 text-center">confidential</span>
              <span className="text-sm text-gray-600">Highly sensitive. LLM features require explicit approval; consider local model.</span>
            </div>
          </div>
          <p className="text-sm text-gray-600 leading-relaxed mt-3">
            The sensitivity label is displayed on every service card and is recorded in the audit log
            when changed. Organizations handling confidential data should consider switching to a
            local LLM (e.g., Ollama) — our REST wrapper in llm/client.py is designed to make
            provider swapping a one-file change.
          </p>
        </section>

        {/* LLM wrapper architecture */}
        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-sm font-medium text-gray-900 mb-3">How is the LLM connection architected?</h3>
          <p className="text-sm text-gray-600 leading-relaxed">
            All LLM calls are routed through a single REST wrapper module (backend/app/services/llm_client.py).
            No API route handler touches the Anthropic SDK directly. This abstraction layer means the
            LLM provider can be swapped (e.g., from Claude to Ollama or OpenAI) by editing one file,
            without touching any business logic. The wrapper exposes three functions: test_connection(),
            run_eval_prompt(), and generate_summary().
          </p>
        </section>
      </div>
    </div>
  );
}
