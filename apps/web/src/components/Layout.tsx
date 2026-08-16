import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { cn, getInitials } from '@/lib/utils';
import { can, type Permission } from '@/lib/permissions';
import {
  LayoutDashboard,
  Users,
  Package,
  Truck,
  FileText,
  ShoppingCart,
  DollarSign,
  Settings,
  LogOut,
  Menu,
  X,
  ChevronDown,
  Building2,
  Ship,
  ClipboardList,
  Anchor,
  Database,
} from 'lucide-react';

interface LayoutProps {
  children: React.ReactNode;
}

/**
 * Each entry declares the permission required to reach it, so a user is never
 * shown a link that would fail with a 403.
 */
const navigation: {
  name: string;
  href: string;
  icon: typeof LayoutDashboard;
  permission: Permission;
}[] = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard, permission: 'MASTER_VIEW' },
  { name: 'Buyers', href: '/buyers', icon: Users, permission: 'BUYER_VIEW' },
  { name: 'Products', href: '/products', icon: Package, permission: 'MASTER_VIEW' },
  { name: 'Suppliers', href: '/suppliers', icon: Building2, permission: 'MASTER_VIEW' },
  { name: 'CHA Agents', href: '/cha', icon: Anchor, permission: 'MASTER_VIEW' },
  { name: 'Transporters', href: '/transporters', icon: Truck, permission: 'MASTER_VIEW' },
  { name: 'Inquiries', href: '/inquiries', icon: ClipboardList, permission: 'SALES_VIEW' },
  { name: 'Quotations', href: '/quotations', icon: FileText, permission: 'SALES_VIEW' },
  { name: 'Orders', href: '/orders', icon: ShoppingCart, permission: 'OPERATIONS_VIEW' },
  { name: 'Invoices', href: '/invoices', icon: DollarSign, permission: 'FINANCE_VIEW' },
  { name: 'Master Data', href: '/master-data', icon: Database, permission: 'MASTER_MANAGE' },
];

export default function Layout({ children }: LayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();

  const visibleNavigation = navigation.filter((item) =>
    can(user?.role, item.permission)
  );

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-gray-900/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          // flex-col is required for `flex-1` on the nav to work, which keeps the
          // Settings link pinned to the bottom and makes long menus scroll.
          'fixed inset-y-0 left-0 z-50 w-64 bg-navy-900 flex flex-col transform transition-transform duration-200 lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {/* Logo */}
        <div className="flex items-center justify-between h-16 px-4 border-b border-navy-800 flex-shrink-0">
          <Link to="/" className="flex items-center gap-2" onClick={() => setSidebarOpen(false)}>
            <Ship className="w-8 h-8 text-gold-500" />
            <div>
              <div className="text-lg font-bold text-white">SeaBridge</div>
              <div className="text-xs text-navy-300">Founder OS</div>
            </div>
          </Link>
          <button
            className="lg:hidden text-white"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close navigation"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {visibleNavigation.map((item) => {
            const isActive = location.pathname === item.href || 
              (item.href !== '/' && location.pathname.startsWith(item.href));
            
            return (
              <Link
                key={item.name}
                to={item.href}
                // Close the drawer after navigating on mobile, otherwise it stays
                // open on top of the page the user just opened.
                onClick={() => setSidebarOpen(false)}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-navy-800 text-white'
                    : 'text-navy-200 hover:bg-navy-800 hover:text-white'
                )}
              >
                <item.icon className="w-5 h-5" />
                {item.name}
              </Link>
            );
          })}
        </nav>

        {/* Settings link */}
        <div className="px-3 py-4 border-t border-navy-800 flex-shrink-0">
          <Link
            to="/settings"
            onClick={() => setSidebarOpen(false)}
            className={cn(
              'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
              location.pathname === '/settings'
                ? 'bg-navy-800 text-white'
                : 'text-navy-200 hover:bg-navy-800 hover:text-white'
            )}
          >
            <Settings className="w-5 h-5" />
            Settings
          </Link>
        </div>
      </aside>

      {/* Main content */}
      <div className="lg:pl-64">
        {/* Top bar */}
        <header className="sticky top-0 z-30 bg-white border-b border-gray-200">
          <div className="flex items-center justify-between h-16 px-4">
            <button
              className="lg:hidden text-gray-500 hover:text-gray-700"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu className="w-6 h-6" />
            </button>

            {/* Page title area - can be used for breadcrumbs */}
            <div className="flex-1" />

            {/* User menu */}
            <div className="relative">
              <button
                className="flex items-center gap-3 hover:bg-gray-50 rounded-lg px-3 py-2"
                onClick={() => setUserMenuOpen(!userMenuOpen)}
              >
                <div className="w-8 h-8 rounded-full bg-navy-900 text-white flex items-center justify-center text-sm font-medium">
                  {getInitials(user?.firstName, user?.lastName)}
                </div>
                <div className="hidden sm:block text-left">
                  <div className="text-sm font-medium text-gray-900">
                    {user?.firstName} {user?.lastName}
                  </div>
                  <div className="text-xs text-gray-500">{user?.role}</div>
                </div>
                <ChevronDown className="w-4 h-4 text-gray-400" />
              </button>

              {userMenuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setUserMenuOpen(false)}
                  />
                  <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-200 z-50">
                    <div className="py-1">
                      <Link
                        to="/settings"
                        className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                        onClick={() => setUserMenuOpen(false)}
                      >
                        <Settings className="w-4 h-4" />
                        Settings
                      </Link>
                      <button
                        className="flex items-center gap-2 w-full px-4 py-2 text-sm text-red-600 hover:bg-gray-50"
                        onClick={handleLogout}
                      >
                        <LogOut className="w-4 h-4" />
                        Logout
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="p-6">{children}</main>
      </div>
    </div>
  );
}
