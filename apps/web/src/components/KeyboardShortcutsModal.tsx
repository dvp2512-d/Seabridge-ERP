/**
 * Modal showing all available keyboard shortcuts.
 * Triggered by pressing '?' or clicking Help in the UI.
 */
import { useEffect, useState } from 'react';
import { X, Keyboard } from 'lucide-react';
import { KEYBOARD_SHORTCUTS } from '../hooks/useKeyboardShortcuts';

interface KeyboardShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function KeyboardShortcutsModal({ isOpen, onClose }: KeyboardShortcutsModalProps) {
  if (!isOpen) return null;
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div 
        className="bg-white rounded-lg shadow-xl max-w-md w-full max-h-[80vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-navy-50">
          <div className="flex items-center gap-2">
            <Keyboard className="w-5 h-5 text-navy-700" />
            <h2 className="text-lg font-semibold text-navy-900">Keyboard Shortcuts</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-full hover:bg-navy-100 text-gray-500 hover:text-gray-700"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        
        {/* Content */}
        <div className="p-4 overflow-y-auto max-h-[60vh]">
          <div className="space-y-1">
            {KEYBOARD_SHORTCUTS.map((shortcut, index) => (
              <div 
                key={index}
                className="flex items-center justify-between py-2 px-3 rounded hover:bg-gray-50"
              >
                <span className="text-gray-700">{shortcut.description}</span>
                <kbd className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-gray-600 bg-gray-100 border border-gray-200 rounded">
                  {shortcut.keys.split(' ').map((key, i) => (
                    <span key={i}>
                      {i > 0 && <span className="mx-1 text-gray-400">then</span>}
                      <span className="px-1 py-0.5 bg-white border border-gray-300 rounded shadow-sm">
                        {key}
                      </span>
                    </span>
                  ))}
                </kbd>
              </div>
            ))}
          </div>
          
          <div className="mt-6 p-3 bg-blue-50 rounded-lg text-sm text-blue-800">
            <p className="font-medium mb-1">Pro tip:</p>
            <p>Press <kbd className="px-1 bg-white border rounded">g</kbd> followed by a letter to quickly navigate. For example, <kbd className="px-1 bg-white border rounded">g</kbd> then <kbd className="px-1 bg-white border rounded">d</kbd> goes to Dashboard.</p>
          </div>
        </div>
        
        {/* Footer */}
        <div className="p-3 border-t border-gray-200 bg-gray-50">
          <p className="text-xs text-center text-gray-500">
            Press <kbd className="px-1 py-0.5 text-xs bg-white border rounded">Esc</kbd> to close
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Hook to manage the keyboard shortcuts modal state.
 * Listens for the custom event dispatched by the '?' shortcut.
 */
export function useKeyboardShortcutsModal() {
  const [isOpen, setIsOpen] = useState(false);
  
  useEffect(() => {
    const handleShowModal = () => setIsOpen(true);
    window.addEventListener('show-shortcuts-modal', handleShowModal);
    return () => window.removeEventListener('show-shortcuts-modal', handleShowModal);
  }, []);
  
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen]);
  
  return {
    isOpen,
    open: () => setIsOpen(true),
    close: () => setIsOpen(false),
  };
}
