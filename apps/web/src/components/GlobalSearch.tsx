/**
 * Global Search Component
 * 
 * Provides a search bar that searches across all modules:
 * buyers, inquiries, quotations, orders, invoices, products, suppliers
 */
import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X, Users, FileText, ShoppingCart, Package, Building2, Loader2 } from 'lucide-react';
import { searchApi } from '@/lib/api';
import { cn } from '@/lib/utils';

interface SearchResult {
  id: string;
  type: 'buyer' | 'inquiry' | 'quotation' | 'order' | 'invoice' | 'product' | 'supplier';
  title: string;
  subtitle: string;
  highlight?: string;
}

const TYPE_CONFIG: Record<string, { icon: typeof Users; color: string; path: string }> = {
  buyer: { icon: Users, color: 'text-blue-600 bg-blue-50', path: '/buyers' },
  inquiry: { icon: FileText, color: 'text-purple-600 bg-purple-50', path: '/inquiries' },
  quotation: { icon: FileText, color: 'text-amber-600 bg-amber-50', path: '/quotations' },
  order: { icon: ShoppingCart, color: 'text-green-600 bg-green-50', path: '/orders' },
  invoice: { icon: FileText, color: 'text-red-600 bg-red-50', path: '/invoices' },
  product: { icon: Package, color: 'text-cyan-600 bg-cyan-50', path: '/products' },
  supplier: { icon: Building2, color: 'text-orange-600 bg-orange-50', path: '/suppliers' },
};

export function GlobalSearch() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  // Search with debounce
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setIsLoading(true);
      try {
        const response = await searchApi.search(query, { limit: 10 });
        setResults(response.data.results || []);
        setSelectedIndex(0);
      } catch (error) {
        console.error('Search failed:', error);
        setResults([]);
      } finally {
        setIsLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query]);

  // Close on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Keyboard navigation
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!isOpen) return;

      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          setSelectedIndex(i => Math.min(i + 1, results.length - 1));
          break;
        case 'ArrowUp':
          event.preventDefault();
          setSelectedIndex(i => Math.max(i - 1, 0));
          break;
        case 'Enter':
          event.preventDefault();
          if (results[selectedIndex]) {
            navigateToResult(results[selectedIndex]);
          }
          break;
        case 'Escape':
          setIsOpen(false);
          inputRef.current?.blur();
          break;
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, results, selectedIndex]);

  const navigateToResult = (result: SearchResult) => {
    const config = TYPE_CONFIG[result.type];
    if (config) {
      navigate(`${config.path}/${result.id}`);
      setIsOpen(false);
      setQuery('');
    }
  };

  return (
    <div ref={containerRef} className="relative">
      {/* Search Input */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          ref={inputRef}
          data-search-input
          type="text"
          placeholder="Search... (Press /)"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          className="w-64 pl-9 pr-8 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-500 focus:border-transparent"
        />
        {query && (
          <button
            onClick={() => {
              setQuery('');
              setResults([]);
              inputRef.current?.focus();
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Results Dropdown */}
      {isOpen && (query.trim() || results.length > 0) && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-lg shadow-lg border border-gray-200 max-h-96 overflow-y-auto z-50">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
              <span className="ml-2 text-sm text-gray-500">Searching...</span>
            </div>
          ) : results.length > 0 ? (
            <ul className="py-2">
              {results.map((result, index) => {
                const config = TYPE_CONFIG[result.type];
                const Icon = config?.icon || FileText;
                
                return (
                  <li key={`${result.type}-${result.id}`}>
                    <button
                      onClick={() => navigateToResult(result)}
                      className={cn(
                        'w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors',
                        index === selectedIndex && 'bg-gray-50'
                      )}
                    >
                      <div className={cn('p-2 rounded-lg', config?.color || 'bg-gray-100')}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-gray-900 truncate">
                          {result.title}
                        </div>
                        <div className="text-sm text-gray-500 truncate">
                          {result.subtitle}
                        </div>
                        {result.highlight && (
                          <div className="text-xs text-gray-400 mt-1 truncate">
                            ...{result.highlight}...
                          </div>
                        )}
                      </div>
                      <span className="text-xs text-gray-400 capitalize bg-gray-100 px-2 py-1 rounded">
                        {result.type}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : query.trim() ? (
            <div className="py-8 text-center text-gray-500">
              <Search className="w-8 h-8 mx-auto mb-2 text-gray-300" />
              <p className="text-sm">No results found for "{query}"</p>
              <p className="text-xs text-gray-400 mt-1">Try a different search term</p>
            </div>
          ) : null}

          {/* Footer with keyboard hints */}
          {results.length > 0 && (
            <div className="px-4 py-2 border-t border-gray-100 bg-gray-50 text-xs text-gray-500 flex items-center gap-4">
              <span><kbd className="px-1.5 py-0.5 bg-white border rounded">↑↓</kbd> Navigate</span>
              <span><kbd className="px-1.5 py-0.5 bg-white border rounded">Enter</kbd> Open</span>
              <span><kbd className="px-1.5 py-0.5 bg-white border rounded">Esc</kbd> Close</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
