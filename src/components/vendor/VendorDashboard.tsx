'use client';

import { useState, useEffect } from 'react';

interface VendorStats {
  totalRevenue: number;
  totalOrders: number;
  totalProducts: number;
  averageRating: number;
  pendingPayouts: number;
}

interface VendorDashboardProps {
  vendorId: string;
}

export function VendorDashboard({ vendorId }: VendorDashboardProps) {
  const [stats, setStats] = useState<VendorStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchDashboardData() {
      try {
        const response = await fetch(`/api/vendors/${vendorId}/dashboard`);
        if (!response.ok) throw new Error('Failed to fetch dashboard data');
        const data = await response.json();
        setStats(data.stats);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred');
      } finally {
        setLoading(false);
      }
    }

    fetchDashboardData();
  }, [vendorId]);

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-32 bg-gray-200 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <p className="text-red-600">{error}</p>
      </div>
    );
  }

  if (!stats) return null;

  const statCards = [
    {
      title: 'Total Revenue',
      value: `$${stats.totalRevenue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
      icon: '💰',
      color: 'bg-green-50 text-green-700',
    },
    {
      title: 'Total Orders',
      value: stats.totalOrders.toLocaleString(),
      icon: '📦',
      color: 'bg-blue-50 text-blue-700',
    },
    {
      title: 'Products',
      value: stats.totalProducts.toLocaleString(),
      icon: '🏷️',
      color: 'bg-purple-50 text-purple-700',
    },
    {
      title: 'Average Rating',
      value: stats.averageRating.toFixed(1),
      icon: '⭐',
      color: 'bg-yellow-50 text-yellow-700',
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((stat) => (
          <div
            key={stat.title}
            className={`rounded-lg p-6 ${stat.color}`}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium opacity-80">{stat.title}</p>
                <p className="text-2xl font-bold mt-1">{stat.value}</p>
              </div>
              <span className="text-3xl">{stat.icon}</span>
            </div>
          </div>
        ))}
      </div>

      {stats.pendingPayouts > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <div className="flex items-center gap-2">
            <span className="text-amber-600">💵</span>
            <p className="text-amber-800">
              You have <strong>${stats.pendingPayouts.toFixed(2)}</strong> in pending payouts
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export function VendorQuickActions() {
  const actions = [
    { label: 'Add Product', href: '/vendor/products/new', icon: '➕' },
    { label: 'View Orders', href: '/vendor/orders', icon: '📋' },
    { label: 'Manage Inventory', href: '/vendor/inventory', icon: '📊' },
    { label: 'Settings', href: '/vendor/settings', icon: '⚙️' },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {actions.map((action) => (
        <a
          key={action.label}
          href={action.href}
          className="flex flex-col items-center justify-center p-4 bg-white border border-gray-200 rounded-lg hover:border-blue-500 hover:shadow-md transition-all"
        >
          <span className="text-2xl mb-2">{action.icon}</span>
          <span className="text-sm font-medium text-gray-700">{action.label}</span>
        </a>
      ))}
    </div>
  );
}