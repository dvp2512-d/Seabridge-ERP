import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import Layout from '@/components/Layout';
import Login from '@/pages/Login';
import Dashboard from '@/pages/Dashboard';
import Buyers from '@/pages/Buyers';
import BuyerDetail from '@/pages/BuyerDetail';
import Products from '@/pages/Products';
import Suppliers from '@/pages/Suppliers';
import CHAs from '@/pages/CHAs';
import Transporters from '@/pages/Transporters';
import Inquiries from '@/pages/Inquiries';
import InquiryDetail from '@/pages/InquiryDetail';
import Quotations from '@/pages/Quotations';
import QuotationDetail from '@/pages/QuotationDetail';
import NewQuotation from '@/pages/NewQuotation';
import Orders from '@/pages/Orders';
import OrderDetail from '@/pages/OrderDetail';
import Invoices from '@/pages/Invoices';
import InvoiceDetail from '@/pages/InvoiceDetail';
import NewInvoice from '@/pages/NewInvoice';
import Settings from '@/pages/Settings';
import MasterData from '@/pages/MasterData';
import ExchangeRates from '@/pages/ExchangeRates';
import Expenses from '@/pages/Expenses';
import Tasks from '@/pages/Tasks';
import Users from '@/pages/Users';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthStore();
  
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  
  return <>{children}</>;
}

function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      
      <Route
        path="/*"
        element={
          <ProtectedRoute>
            <Layout>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/buyers" element={<Buyers />} />
                <Route path="/buyers/:id" element={<BuyerDetail />} />
                <Route path="/products" element={<Products />} />
                <Route path="/suppliers" element={<Suppliers />} />
                <Route path="/cha" element={<CHAs />} />
                <Route path="/transporters" element={<Transporters />} />
                <Route path="/inquiries" element={<Inquiries />} />
                <Route path="/inquiries/:id" element={<InquiryDetail />} />
                <Route path="/quotations" element={<Quotations />} />
                <Route path="/quotations/new" element={<NewQuotation />} />
                <Route path="/quotations/:id" element={<QuotationDetail />} />
                <Route path="/orders" element={<Orders />} />
                <Route path="/orders/:id" element={<OrderDetail />} />
                <Route path="/invoices" element={<Invoices />} />
                <Route path="/invoices/new" element={<NewInvoice />} />
                <Route path="/invoices/:id" element={<InvoiceDetail />} />
                <Route path="/master-data" element={<MasterData />} />
              <Route path="/exchange-rates" element={<ExchangeRates />} />
              <Route path="/expenses" element={<Expenses />} />
              <Route path="/tasks" element={<Tasks />} />
              <Route path="/users" element={<Users />} />
                <Route path="/settings" element={<Settings />} />
              </Routes>
            </Layout>
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}

export default App;
