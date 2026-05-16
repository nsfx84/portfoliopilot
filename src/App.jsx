import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext.jsx'
import { Layout } from './components/Layout.jsx'
import { CgtReport } from './pages/CgtReport.jsx'
import { Dashboard } from './pages/Dashboard.jsx'
import { IncomeReport } from './pages/IncomeReport.jsx'
import { Import } from './pages/Import.jsx'
import { Login } from './pages/Login.jsx'
import { Settings } from './pages/Settings.jsx'
import { Transactions } from './pages/Transactions.jsx'

function AppRoutes() {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900 text-slate-400">
        Loading…
      </div>
    )
  }

  if (!user) {
    return <Login />
  }

  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="transactions" element={<Transactions />} />
        <Route path="import" element={<Import />} />
        <Route path="cgt-report" element={<CgtReport />} />
        <Route path="income-report" element={<IncomeReport />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  )
}
