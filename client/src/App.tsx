import { useEffect } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import Login from './os/Login';
import OSLayout from './os/OSLayout';
import Dashboard from './os/Dashboard';
import Orders from './os/Orders';
import Board from './os/Board';
import Customers from './os/Customers';
import ProductsAdmin from './os/ProductsAdmin';
import Tasks from './os/Tasks';
import Messages from './os/Messages';
import Reports from './os/Reports';
import Settings from './os/Settings';
import JobTicket from './os/JobTicket';
import { useAuth } from './lib/store';
import { Spinner } from './components/kit';

function ScrollTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

/** Everything in this app is login-gated — there is no public storefront here. */
function RequireAuth({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  const { pathname } = useLocation();
  if (loading) return <div className="min-h-screen grid place-items-center text-ink-500"><Spinner className="h-6 w-6" /></div>;
  if (!user) return <Navigate to="/login" replace state={{ from: pathname }} />;
  return children;
}

function RootRedirect() {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen grid place-items-center text-ink-500"><Spinner className="h-6 w-6" /></div>;
  return <Navigate to={user ? '/dashboard' : '/login'} replace />;
}

export default function App() {
  return (
    <>
      <ScrollTop />
      <Routes>
        <Route path="/" element={<RootRedirect />} />
        <Route path="/login" element={<Login />} />

        {/* printable views live outside the chrome */}
        <Route path="/ticket/:id" element={<RequireAuth><JobTicket /></RequireAuth>} />

        <Route element={<RequireAuth><OSLayout /></RequireAuth>}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/orders/:id" element={<Orders />} />
          <Route path="/board" element={<Board />} />
          <Route path="/customers" element={<Customers />} />
          <Route path="/customers/:id" element={<Customers />} />
          <Route path="/products" element={<ProductsAdmin />} />
          <Route path="/tasks" element={<Tasks />} />
          <Route path="/messages" element={<Messages />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/settings" element={<Settings />} />
        </Route>

        <Route path="*" element={
          <div className="min-h-screen grid place-items-center px-6 text-center">
            <div>
              <p className="label text-dpred">404</p>
              <h1 className="mt-3 text-[28px] font-black">That screen came off the press blank</h1>
              <p className="mt-2 text-ink-500 text-[14.5px]">No such page in the OS.</p>
              <Link className="btn-primary btn-sm mt-5" to="/dashboard">Back to dashboard</Link>
            </div>
          </div>
        } />
      </Routes>
    </>
  );
}
