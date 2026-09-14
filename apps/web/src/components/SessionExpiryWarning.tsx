/**
 * Session Expiry Warning Component
 * 
 * Displays a warning modal when the user's session is about to expire,
 * giving them the option to extend their session or log out.
 * 
 * The access token expires after 15 minutes, so this shows a warning
 * 2 minutes before expiry.
 */
import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '@/store/authStore';
import { authApi } from '@/lib/api';
import Modal from '@/components/ui/Modal';
import { Clock, LogOut, RefreshCw } from 'lucide-react';

// Show warning 2 minutes before expiry
const WARNING_BEFORE_EXPIRY_MS = 2 * 60 * 1000;

/**
 * Decode JWT to get expiration time without external library
 */
function getTokenExpiry(token: string): number | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    
    const payload = JSON.parse(atob(parts[1]));
    if (payload.exp) {
      return payload.exp * 1000; // Convert to milliseconds
    }
    return null;
  } catch {
    return null;
  }
}

export function SessionExpiryWarning() {
  const { token, refreshToken, isAuthenticated, logout, setTokens } = useAuthStore();
  const [showWarning, setShowWarning] = useState(false);
  const [timeLeft, setTimeLeft] = useState(0);
  const [extending, setExtending] = useState(false);

  const extendSession = useCallback(async () => {
    if (!refreshToken) return;
    
    setExtending(true);
    try {
      const response = await authApi.refresh(refreshToken);
      const { accessToken, refreshToken: newRefreshToken } = response.data.data;
      setTokens(accessToken, newRefreshToken);
      setShowWarning(false);
    } catch (error) {
      // Refresh failed, force logout
      logout();
    } finally {
      setExtending(false);
    }
  }, [refreshToken, setTokens, logout]);

  useEffect(() => {
    if (!isAuthenticated || !token) return;

    const checkExpiry = () => {
      const expiry = getTokenExpiry(token);
      if (!expiry) return;

      const now = Date.now();
      const remaining = expiry - now;

      // If already expired, logout
      if (remaining <= 0) {
        logout();
        return;
      }

      // If within warning threshold, show warning
      if (remaining <= WARNING_BEFORE_EXPIRY_MS) {
        setTimeLeft(Math.ceil(remaining / 1000));
        setShowWarning(true);
      } else {
        setShowWarning(false);
      }
    };

    // Check immediately
    checkExpiry();

    // Check every 10 seconds
    const interval = setInterval(checkExpiry, 10000);

    return () => clearInterval(interval);
  }, [token, isAuthenticated, logout]);

  // Countdown timer when warning is shown
  useEffect(() => {
    if (!showWarning) return;

    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          logout();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [showWarning, logout]);

  if (!showWarning) return null;

  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;

  return (
    <Modal 
      isOpen={showWarning} 
      onClose={() => {}} // Prevent closing by clicking outside
      title="Session Expiring Soon"
      size="sm"
    >
      <div className="p-6 text-center space-y-4">
        <div className="w-16 h-16 mx-auto bg-amber-100 rounded-full flex items-center justify-center">
          <Clock className="w-8 h-8 text-amber-600" />
        </div>
        
        <div>
          <p className="text-gray-700 mb-2">
            Your session will expire in
          </p>
          <p className="text-3xl font-bold text-amber-600">
            {minutes}:{seconds.toString().padStart(2, '0')}
          </p>
        </div>
        
        <p className="text-sm text-gray-500">
          Click "Extend Session" to continue working, or "Log Out" to end your session now.
        </p>
        
        <div className="flex gap-3 pt-2">
          <button
            onClick={() => {
              setShowWarning(false);
              logout();
            }}
            className="btn btn-secondary flex-1"
          >
            <LogOut className="w-4 h-4 mr-2" />
            Log Out
          </button>
          <button
            onClick={extendSession}
            disabled={extending}
            className="btn btn-primary flex-1"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${extending ? 'animate-spin' : ''}`} />
            {extending ? 'Extending...' : 'Extend Session'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export default SessionExpiryWarning;
