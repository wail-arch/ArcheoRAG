import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { MessageSquare, Library, Settings, Landmark, DollarSign, Sun, Moon } from 'lucide-react';
import { getTotalCost } from '../pages/ChatPage';

const navItems = [
  { to: '/', label: 'Chat', icon: MessageSquare },
  { to: '/library', label: 'Bibliothèque', icon: Library },
  { to: '/settings', label: 'Paramètres', icon: Settings },
];

function getInitialDark(): boolean {
  const stored = localStorage.getItem('archeoqa-dark-mode');
  if (stored !== null) return stored === 'true';
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export default function Sidebar() {
  const location = useLocation();
  const [cost, setCost] = useState(getTotalCost);
  const [dark, setDark] = useState(getInitialDark);

  useEffect(() => {
    const update = () => setCost(getTotalCost());
    window.addEventListener('archeoqa-cost-update', update);
    return () => window.removeEventListener('archeoqa-cost-update', update);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('archeoqa-dark-mode', String(dark));
  }, [dark]);

  return (
    <aside className="w-64 bg-gray-900 text-white flex flex-col min-h-screen">
      {/* Logo */}
      <div className="p-6 border-b border-gray-700">
        <div className="flex items-center gap-3">
          <Landmark className="w-8 h-8 text-amber-400" />
          <div>
            <h1 className="text-xl font-bold">ArcheoQA</h1>
            <p className="text-xs text-gray-400">Plateforme de recherche</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-1">
        {navItems.map(({ to, label, icon: Icon }) => {
          const isActive = location.pathname === to;
          return (
            <Link
              key={to}
              to={to}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                isActive
                  ? 'bg-amber-600 text-white'
                  : 'text-gray-300 hover:bg-gray-800 hover:text-white'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="font-medium">{label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-gray-700 space-y-3">
        {cost > 0 && (
          <div className="flex items-center gap-1.5 text-xs text-amber-400">
            <DollarSign className="w-3.5 h-3.5" />
            <span>Session: ${cost.toFixed(4)}</span>
          </div>
        )}
        <button
          onClick={() => setDark(!dark)}
          className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
        >
          {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          <span>{dark ? 'Mode clair' : 'Mode sombre'}</span>
        </button>
        <p className="text-xs text-gray-500">Powered by PaperQA2</p>
      </div>
    </aside>
  );
}
