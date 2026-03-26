import { useState, useEffect } from 'react';
import { Activity, Clock, AlertTriangle, Server, AlertCircle } from 'lucide-react';
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer
} from 'recharts';
import MetricCard from '../components/common/MetricCard';
import StatusBadge from '../components/common/StatusBadge';
import DataTable from '../components/common/DataTable';
import LoadingSkeleton from '../components/common/LoadingSkeleton';

export default function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [activeService, setActiveService] = useState('all');

  // MOCK DATA
  const latencyData = [
    { time: '00:00', ms: 140 }, { time: '04:00', ms: 152 }, { time: '08:00', ms: 190 },
    { time: '12:00', ms: 165 }, { time: '16:00', ms: 210 }, { time: '20:00', ms: 180 }, { time: '24:00', ms: 145 }
  ];

  const qualityData = [
    { run: 'Run 1', score: 85 }, { run: 'Run 2', score: 88 }, { run: 'Run 3', score: 92 },
    { run: 'Run 4', score: 78 }, { run: 'Run 5', score: 89 }, { run: 'Run 6', score: 95 }
  ];

  const errorData = [
    { time: 'Mon', rate: 0.5 }, { time: 'Tue', rate: 1.2 }, { time: 'Wed', rate: 0.8 },
    { time: 'Thu', rate: 2.1 }, { time: 'Fri', rate: 1.5 }, { time: 'Sat', rate: 0.4 }, { time: 'Sun', rate: 0.2 }
  ];

  const recentEvals = [
    { id: 1, timestamp: '2026-03-18 14:30', score: 92, drift: false, type: 'Scheduled' },
    { id: 2, timestamp: '2026-03-18 12:00', score: 78, drift: true, type: 'Manual' },
    { id: 3, timestamp: '2026-03-18 09:15', score: 89, drift: false, type: 'Scheduled' },
    { id: 4, timestamp: '2026-03-17 14:30', score: 95, drift: false, type: 'Scheduled' },
  ];

  const evalColumns = [
    { key: 'timestamp', label: 'Timestamp' },
    { key: 'score', label: 'Quality Score', render: (val) => <span className="font-semibold text-slate-700">{val}%</span> },
    { key: 'type', label: 'Run Type' },
    { 
      key: 'drift', 
      label: 'Status', 
      render: (val) => <StatusBadge status={val ? 'Drift Detected' : 'Healthy'} type={val ? 'severity' : 'default'} /> 
    }
  ];

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 800);
    return () => clearTimeout(timer);
  }, []);

  if (loading) {
    return (
      <div className="space-y-6 animate-in fade-in duration-300">
        <div className="h-8 bg-slate-200 rounded w-48 mb-6 animate-pulse"></div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <LoadingSkeleton type="card" />
          <LoadingSkeleton type="card" />
          <LoadingSkeleton type="card" />
          <LoadingSkeleton type="card" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <LoadingSkeleton type="chart" />
          <LoadingSkeleton type="chart" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-12">
      
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Platform Overview</h1>
          <p className="text-sm text-slate-500 mt-1">Real-time metrics and evaluations across all connected services</p>
        </div>
        
        <div className="flex items-center gap-3 bg-white p-1 rounded-lg border border-slate-200 shadow-sm">
          {['all', 'production', 'staging'].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveService(tab)}
              className={`px-4 py-1.5 text-sm font-medium rounded-md capitalize transition-colors ${
                activeService === tab 
                  ? 'bg-slate-100 text-slate-900 shadow-sm' 
                  : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Drift Alert Banner */}
      <div className="bg-gradient-to-r from-rose-50 to-orange-50 border border-rose-200 rounded-xl p-4 flex items-start sm:items-center justify-between gap-4 shadow-sm">
        <div className="flex items-start sm:items-center gap-3">
          <div className="p-2 bg-rose-100 rounded-lg shrink-0">
            <AlertCircle size={20} className="text-rose-600" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-rose-900">Concept Drift Detected</h3>
            <p className="text-sm text-rose-700 mt-0.5">Customer Support Bot QA score dropped below 80% threshold during recent evaluation run.</p>
          </div>
        </div>
        <button className="whitespace-nowrap px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-sm font-medium rounded-lg transition-colors shadow-sm">
          Create Incident
        </button>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard title="Avg API Latency" value="168ms" icon={Clock} trend="down" trendValue="-12ms" color="blue" />
        <MetricCard title="Error Rate" value="1.2%" icon={AlertTriangle} trend="up" trendValue="+0.4%" color="amber" />
        <MetricCard title="Avg Quality Score" value="89.5" icon={Activity} trend="neutral" trendValue="+0.0" color="green" />
        <MetricCard title="Active Services" value="24" icon={Server} trend="up" trendValue="+2" color="slate" />
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Latency Chart */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-sm font-semibold text-slate-800">Response Latency (24h)</h3>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={latencyData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                <XAxis dataKey="time" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748B' }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748B' }} dx={-10} />
                <RechartsTooltip 
                  contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                />
                <Line type="monotone" dataKey="ms" stroke="#3B82F6" strokeWidth={3} dot={{ r: 4, strokeWidth: 2 }} activeDot={{ r: 6 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Quality Chart */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-sm font-semibold text-slate-800">Quality Scores per Run</h3>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={qualityData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                <XAxis dataKey="run" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748B' }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748B' }} dx={-10} domain={[0, 100]} />
                <RechartsTooltip 
                  contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  cursor={{ fill: '#F1F5F9' }}
                />
                <Bar dataKey="score" fill="#10B981" radius={[4, 4, 0, 0]} barSize={32} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Error Area Chart */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm lg:col-span-2">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-sm font-semibold text-slate-800">Error Rate Trend (%)</h3>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={errorData}>
                <defs>
                  <linearGradient id="colorRate" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#F59E0B" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#F59E0B" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                <XAxis dataKey="time" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748B' }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748B' }} dx={-10} />
                <RechartsTooltip 
                  contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                />
                <Area type="monotone" dataKey="rate" stroke="#F59E0B" strokeWidth={3} fillOpacity={1} fill="url(#colorRate)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Recent Evaluations Table */}
      <div>
        <h3 className="text-lg font-semibold text-slate-900 mb-4">Recent Evaluations</h3>
        <DataTable 
          columns={evalColumns}
          data={recentEvals}
          searchPlaceholder="Search evaluations..."
        />
      </div>

    </div>
  );
}
