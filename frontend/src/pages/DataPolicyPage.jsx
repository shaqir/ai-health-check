import { Shield, Database, Cpu, Globe, ArrowRight, Lock, Server } from 'lucide-react';

export default function DataPolicyPage() {
  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-12 max-w-4xl mx-auto">
      
      {/* Banner */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-center gap-3 shadow-sm">
        <div className="p-2 bg-blue-100 rounded-lg shrink-0">
          <Shield size={20} className="text-blue-600" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-blue-900">Privacy & Data Handling</h3>
          <p className="text-sm text-blue-800 mt-0.5">This page explains how AIHealthCheck handles your data and interacts with external LLM providers.</p>
        </div>
      </div>

      <h1 className="text-2xl font-bold text-slate-900 tracking-tight mt-8 mb-6">Data Architecture & Policy</h1>

      {/* Architecture Diagram */}
      <div className="bg-white rounded-xl border border-slate-200 p-8 shadow-sm">
        <h3 className="text-base font-semibold text-slate-800 mb-6 flex items-center gap-2">
          <Cpu size={18} className="text-slate-400" />
          High-Level Data Flow Architecture
        </h3>
        
        <div className="flex flex-col md:flex-row items-center justify-between gap-4 p-6 bg-slate-50/50 border border-slate-100 rounded-xl">
          
          <div className="flex flex-col items-center gap-2 w-full md:w-32">
            <div className="w-16 h-16 bg-white border-2 border-slate-200 rounded-full flex items-center justify-center shadow-sm">
              <Globe size={24} className="text-slate-600" />
            </div>
            <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider">User / Browser</span>
          </div>

          <ArrowRight size={24} className="text-slate-300 hidden md:block" />

          <div className="flex flex-col gap-2 w-full md:w-48">
            <div className="bg-blue-50 border border-blue-200 p-4 rounded-xl shadow-sm text-center">
              <h4 className="text-sm font-bold text-blue-800">React Frontend</h4>
              <p className="text-xs text-blue-600 mt-1">Dashboards & Metrics</p>
            </div>
            <div className="bg-indigo-50 border border-indigo-200 p-4 rounded-xl shadow-sm text-center">
              <h4 className="text-sm font-bold text-indigo-800">FastAPI Backend</h4>
              <p className="text-xs text-indigo-600 mt-1">llm/client.py Wrapper</p>
            </div>
          </div>

          <div className="flex flex-row md:flex-col gap-4">
            <ArrowRight size={24} className="text-slate-300 rotate-90 md:rotate-0" />
            <ArrowRight size={24} className="text-slate-300 rotate-90 md:rotate-0" />
          </div>

          <div className="flex flex-col gap-4 w-full md:w-40">
            <div className="bg-slate-100 border border-slate-200 p-4 rounded-xl flex items-center gap-3 shadow-sm">
              <Database size={20} className="text-slate-500" />
              <div>
                <h4 className="text-xs font-bold text-slate-700">Local SQLite</h4>
                <p className="text-[10px] text-slate-500">Metadata & Logs</p>
              </div>
            </div>
            <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-xl flex items-center gap-3 shadow-sm">
              <Server size={20} className="text-emerald-600" />
              <div>
                <h4 className="text-xs font-bold text-emerald-800">Claude API</h4>
                <p className="text-[10px] text-emerald-600">Cloud Inferencing</p>
              </div>
            </div>
          </div>

        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Local Storage */}
        <section className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2">
            <Database size={16} className="text-blue-500" /> What data is stored locally?
          </h3>
          <p className="text-sm text-slate-600 leading-relaxed">
            All application data is stored in a local SQLite database file (aiops.db) on the server.
            This includes: registered AI service metadata, evaluation results, incident records, the full audit log,
            and telemetry metrics. Passwords are stored as bcrypt hashes — never in plain text.
          </p>
        </section>

        {/* Cloud API */}
        <section className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2">
            <Globe size={16} className="text-emerald-500" /> What is sent to Anthropic's API?
          </h3>
          <p className="text-sm text-slate-600 leading-relaxed mb-3">
            This application uses Anthropic's Claude API. The following data is dispatched to the cloud:
          </p>
          <ul className="text-sm text-slate-600 space-y-2 ml-1">
            <li className="flex gap-2 items-start"><span className="text-emerald-500 mt-0.5">•</span> Test connection prompts (a short "hello" prompt)</li>
            <li className="flex gap-2 items-start"><span className="text-emerald-500 mt-0.5">•</span> Evaluation test case prompts (synthetic data only)</li>
            <li className="flex gap-2 items-start"><span className="text-emerald-500 mt-0.5">•</span> Incident details when generating LLM summaries</li>
          </ul>
        </section>

        {/* Logging */}
        <section className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2">
            <Lock size={16} className="text-slate-500" /> Are prompts logged?
          </h3>
          <p className="text-sm text-slate-600 leading-relaxed">
            Prompts sent to the LLM are <strong>not stored</strong> in our database by default. Only the
            result metadata (latency, status, quality score) is recorded. The response snippets from
            test connections are stored for debugging purposes only. Per Anthropic's data retention
            policy, API inputs and outputs are not used for model training.
          </p>
        </section>

        {/* Routing */}
        <section className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-900 mb-3">How do sensitivity labels affect routing?</h3>
          <p className="text-sm text-slate-600 leading-relaxed mb-4">
            Every registered AI service is tagged with one of three sensitivity labels:
          </p>
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <span className="px-2 py-0.5 border border-emerald-200 rounded text-[10px] uppercase font-bold bg-emerald-50 text-emerald-700 w-24 text-center shrink-0">Public</span>
              <span className="text-xs text-slate-600 leading-tight">Non-sensitive data. Full LLM features enabled.</span>
            </div>
            <div className="flex items-start gap-3">
              <span className="px-2 py-0.5 border border-amber-200 rounded text-[10px] uppercase font-bold bg-amber-50 text-amber-700 w-24 text-center shrink-0">Internal</span>
              <span className="text-xs text-slate-600 leading-tight">Internal business data. LLM features enabled with caution.</span>
            </div>
            <div className="flex items-start gap-3">
              <span className="px-2 py-0.5 border border-rose-200 rounded text-[10px] uppercase font-bold bg-rose-50 text-rose-700 w-24 text-center shrink-0">Confidential</span>
              <span className="text-xs text-slate-600 leading-tight">Highly sensitive. LLM features require explicit approval; consider local model.</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
