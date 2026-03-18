import { ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react';

export default function MetricCard({ title, value, icon: Icon, trend, trendValue, color = 'blue' }) {
  const colorMap = {
    blue: 'bg-blue-50 text-blue-600 border-blue-100',
    green: 'bg-emerald-50 text-emerald-600 border-emerald-100',
    amber: 'bg-amber-50 text-amber-600 border-amber-100',
    red: 'bg-rose-50 text-rose-600 border-rose-100',
    purple: 'bg-purple-50 text-purple-600 border-purple-100',
    slate: 'bg-slate-50 text-slate-600 border-slate-100',
  };

  const iconClass = colorMap[color] || colorMap.blue;

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm hover:shadow-md transition-shadow duration-200">
      <div className="flex justify-between items-start">
        <div>
          <p className="text-sm font-medium text-slate-500 mb-1">{title}</p>
          <h3 className="text-2xl font-semibold text-slate-900 tracking-tight">{value}</h3>
        </div>
        <div className={`p-2.5 rounded-lg border ${iconClass}`}>
          <Icon size={20} />
        </div>
      </div>
      
      {trend && (
        <div className="mt-4 flex items-center text-sm">
          {trend === 'up' && <ArrowUpRight size={16} className="text-emerald-500 mr-1" />}
          {trend === 'down' && <ArrowDownRight size={16} className="text-rose-500 mr-1" />}
          {trend === 'neutral' && <Minus size={16} className="text-slate-400 mr-1" />}
          
          <span className={`font-medium ${
            trend === 'up' ? 'text-emerald-600' : 
            trend === 'down' ? 'text-rose-600' : 
            'text-slate-500'
          }`}>
            {trendValue}
          </span>
          <span className="text-slate-500 ml-1">vs last period</span>
        </div>
      )}
    </div>
  );
}
