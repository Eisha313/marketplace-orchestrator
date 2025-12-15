import Link from 'next/link';
import { ArrowRight, Store, Zap, Shield, BarChart3 } from 'lucide-react';

/**
 * Marketplace home page showcasing featured vendors and products
 * Serves as the main entry point for customers
 */
export default function HomePage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      {/* Hero Section */}
      <section className="container mx-auto px-4 py-20">
        <div className="text-center max-w-4xl mx-auto">
          <h1 className="text-5xl font-bold text-slate-900 mb-6">
            Your Multi-Vendor
            <span className="text-indigo-600"> Marketplace</span>
          </h1>
          <p className="text-xl text-slate-600 mb-8">
            Discover products from trusted vendors with real-time pricing,
            instant inventory updates, and secure transactions.
          </p>
          <div className="flex gap-4 justify-center">
            <Link
              href="/products"
              className="inline-flex items-center gap-2 bg-indigo-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-indigo-700 transition-colors"
            >
              Browse Products
              <ArrowRight className="w-5 h-5" />
            </Link>
            <Link
              href="/vendor/register"
              className="inline-flex items-center gap-2 border-2 border-slate-300 text-slate-700 px-6 py-3 rounded-lg font-semibold hover:border-slate-400 transition-colors"
            >
              Become a Vendor
            </Link>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="container mx-auto px-4 py-16">
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
          <FeatureCard
            icon={<Store className="w-8 h-8 text-indigo-600" />}
            title="Multi-Vendor Platform"
            description="Shop from hundreds of verified vendors in one seamless marketplace experience."
          />
          <FeatureCard
            icon={<Zap className="w-8 h-8 text-indigo-600" />}
            title="Dynamic Pricing"
            description="Get the best prices with AI-driven pricing that responds to market demand."
          />
          <FeatureCard
            icon={<Shield className="w-8 h-8 text-indigo-600" />}
            title="Secure Payments"
            description="Protected transactions with escrow and automated dispute resolution."
          />
          <FeatureCard
            icon={<BarChart3 className="w-8 h-8 text-indigo-600" />}
            title="Real-time Inventory"
            description="Always know product availability with live inventory synchronization."
          />
        </div>
      </section>

      {/* CTA Section */}
      <section className="bg-indigo-600 py-16 mt-16">
        <div className="container mx-auto px-4 text-center">
          <h2 className="text-3xl font-bold text-white mb-4">
            Ready to Start Selling?
          </h2>
          <p className="text-indigo-100 mb-8 max-w-2xl mx-auto">
            Join our marketplace and reach thousands of customers. Automated payouts,
            inventory management, and powerful analytics included.
          </p>
          <Link
            href="/vendor/register"
            className="inline-flex items-center gap-2 bg-white text-indigo-600 px-8 py-4 rounded-lg font-semibold hover:bg-indigo-50 transition-colors"
          >
            Get Started Today
            <ArrowRight className="w-5 h-5" />
          </Link>
        </div>
      </section>
    </main>
  );
}

interface FeatureCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
}

function FeatureCard({ icon, title, description }: FeatureCardProps) {
  return (
    <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 hover:shadow-md transition-shadow">
      <div className="mb-4">{icon}</div>
      <h3 className="text-lg font-semibold text-slate-900 mb-2">{title}</h3>
      <p className="text-slate-600 text-sm">{description}</p>
    </div>
  );
}