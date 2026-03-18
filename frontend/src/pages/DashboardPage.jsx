import { useState, useEffect } from 'react';
import { Activity, Clock, AlertTriangle } from 'lucide-react';

export default function DashboardPage() {
  // TODO: Replace with real API calls in Week 2 (Sakir)
  const metrics = [
    { label: 'Avg Latency', value: '—', icon: Clock, color: 'blue' },
    { label: 'Error Rate', value: '—', icon: AlertTriangle, color: 'amber' },
    { label: 'Quality Score', value: '—', icon: Activity, color: 'green' },
  ];

  return (
    <div>
      <h2 className="text-xl font-semibold text-gray-900 mb-6">Monitoring Dashboard</h2>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        {metrics.map((m) => (
          <div key={m.label} className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 bg-gray-100 rounded-lg">
                <m.icon size={18} className="text-gray-600" />
              </div>
              <span className="text-sm text-gray-500">{m.label}</span>
            </div>
            <p className="text-2xl font-semibold text-gray-900">{m.value}</p>
          </div>
        ))}
      </div>

      {/* Chart placeholder */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-sm font-medium text-gray-700 mb-4">Metrics Over Time</h3>
        <div className="h-64 flex items-center justify-center text-gray-400 text-sm">
          Recharts integration — Week 2 (Sakir)
        </div>
      </div>
    </div>
  );
}
