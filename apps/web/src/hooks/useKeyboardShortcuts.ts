/**
 * Global keyboard shortcuts for SeaBridge ERP.
 * 
 * Provides navigation shortcuts to improve power user productivity.
 * Shortcuts are disabled when focus is inside input fields.
 */
import { useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

interface ShortcutDefinition {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  action: () => void;
  description: string;
}

/**
 * Check if the active element is an input where typing should be allowed
 */
function isInputFocused(): boolean {
  const activeElement = document.activeElement;
  if (!activeElement) return false;
  
  const tagName = activeElement.tagName.toLowerCase();
  if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
    return true;
  }
  
  // Also check for contenteditable
  if (activeElement.getAttribute('contenteditable') === 'true') {
    return true;
  }
  
  return false;
}

/**
 * Hook for registering global keyboard shortcuts.
 * Shortcuts are only active when not typing in an input field.
 */
export function useKeyboardShortcuts(shortcuts: ShortcutDefinition[]) {
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    // Skip if typing in an input
    if (isInputFocused()) return;
    
    for (const shortcut of shortcuts) {
      const keyMatch = event.key.toLowerCase() === shortcut.key.toLowerCase();
      const ctrlMatch = shortcut.ctrl ? (event.ctrlKey || event.metaKey) : !event.ctrlKey && !event.metaKey;
      const shiftMatch = shortcut.shift ? event.shiftKey : !event.shiftKey;
      const altMatch = shortcut.alt ? event.altKey : !event.altKey;
      
      if (keyMatch && ctrlMatch && shiftMatch && altMatch) {
        event.preventDefault();
        shortcut.action();
        return;
      }
    }
  }, [shortcuts]);
  
  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}

/**
 * Pre-defined navigation shortcuts for use across the app.
 * Call this in your main Layout component.
 */
export function useNavigationShortcuts() {
  const shortcuts: ShortcutDefinition[] = [
    // Navigation shortcuts (g prefix for "go to")
    { key: 'g', action: () => {}, description: 'Prefix for navigation (followed by another key)' },
    
    // Quick search (/)
    { key: '/', action: () => {
      const searchInput = document.querySelector('[data-search-input]') as HTMLInputElement;
      if (searchInput) searchInput.focus();
    }, description: 'Focus search' },
    
    // Help (?)
    { key: '?', shift: true, action: () => {
      // Show shortcuts modal - dispatch custom event
      window.dispatchEvent(new CustomEvent('show-shortcuts-modal'));
    }, description: 'Show keyboard shortcuts' },
    
    // Escape closes modals/dropdowns
    { key: 'Escape', action: () => {
      // Let native handlers deal with this
    }, description: 'Close modal/dropdown' },
  ];
  
  useKeyboardShortcuts(shortcuts);
}

/**
 * Hook for "g + key" navigation pattern.
 * Press 'g' then another key within 1 second to navigate.
 */
export function useGoToShortcuts() {
  const navigate = useNavigate();
  
  useEffect(() => {
    let gPressed = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    
    const handleKeyDown = (event: KeyboardEvent) => {
      // Skip if typing in an input
      if (isInputFocused()) return;
      
      // First 'g' press
      if (event.key.toLowerCase() === 'g' && !gPressed && !event.ctrlKey && !event.metaKey && !event.altKey) {
        gPressed = true;
        timeout = setTimeout(() => { gPressed = false; }, 1000);
        return;
      }
      
      // Second key after 'g'
      if (gPressed && !event.ctrlKey && !event.metaKey && !event.altKey) {
        gPressed = false;
        if (timeout) clearTimeout(timeout);
        
        const routes: Record<string, string> = {
          'd': '/',           // Dashboard
          'b': '/buyers',     // Buyers
          'i': '/inquiries',  // Inquiries
          'q': '/quotations', // Quotations
          'o': '/orders',     // Orders
          'v': '/invoices',   // inVoices
          'e': '/expenses',   // Expenses
          's': '/settings',   // Settings
          't': '/tasks',      // Tasks
          'p': '/products',   // Products
          'u': '/suppliers',  // sUppliers
          'x': '/exchange-rates', // eXchange rates
        };
        
        const route = routes[event.key.toLowerCase()];
        if (route) {
          event.preventDefault();
          navigate(route);
        }
      }
    };
    
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (timeout) clearTimeout(timeout);
    };
  }, [navigate]);
}

/**
 * List of all keyboard shortcuts for display in help modal.
 */
export const KEYBOARD_SHORTCUTS = [
  { keys: '/', description: 'Focus search' },
  { keys: '?', description: 'Show this help' },
  { keys: 'g d', description: 'Go to Dashboard' },
  { keys: 'g b', description: 'Go to Buyers' },
  { keys: 'g i', description: 'Go to Inquiries' },
  { keys: 'g q', description: 'Go to Quotations' },
  { keys: 'g o', description: 'Go to Orders' },
  { keys: 'g v', description: 'Go to Invoices' },
  { keys: 'g e', description: 'Go to Expenses' },
  { keys: 'g t', description: 'Go to Tasks' },
  { keys: 'g p', description: 'Go to Products' },
  { keys: 'g u', description: 'Go to Suppliers' },
  { keys: 'g x', description: 'Go to Exchange Rates' },
  { keys: 'g s', description: 'Go to Settings' },
  { keys: 'Escape', description: 'Close modal/dropdown' },
];
