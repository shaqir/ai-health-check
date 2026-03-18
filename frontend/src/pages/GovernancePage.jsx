export default function GovernancePage() {
  return (
    <div>
      <h2 className="text-xl font-semibold text-gray-900 mb-6">Governance & Compliance</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-sm font-medium text-gray-700 mb-2">Audit Log</h3>
          <p className="text-xs text-gray-400">Module 4 — Week 4 (Jeewanjot)</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-sm font-medium text-gray-700 mb-2">RBAC Management</h3>
          <p className="text-xs text-gray-400">Admin, Maintainer, Viewer roles</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-sm font-medium text-gray-700 mb-2">Compliance Evidence Export</h3>
          <p className="text-xs text-gray-400">PDF/JSON with evals, incidents, audit log</p>
        </div>
      </div>
    </div>
  );
}
