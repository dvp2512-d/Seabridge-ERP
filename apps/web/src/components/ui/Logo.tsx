import { useState } from 'react';
import { Ship } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Company logo.
 *
 * Two variants are shipped because the artwork is single-colour:
 *   /logo.png       white on transparent - for the navy sidebar and login panel
 *   /logo-blue.png  brand blue on transparent - for white and light surfaces
 *
 * Picking by surface avoids the navy plate that a white-only logo needed, so the
 * mark sits directly on the page as it does on the printed documents.
 *
 * If the file is missing or fails to load, it falls back to the ship icon so a
 * header never renders as a broken image.
 */
interface LogoProps {
  /** Height utility class, e.g. "h-9". Width scales automatically. */
  className?: string;
  /** Show the wordmark beside the icon in the fallback state. */
  showTextFallback?: boolean;
  /** True when the surface behind the logo is already dark. */
  onDark?: boolean;
  /** Empty string when a nearby heading already names the company. */
  alt?: string;
}

export default function Logo({
  className,
  showTextFallback = true,
  onDark = false,
  alt = 'SeaBridge Exports',
}: LogoProps) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <span className="inline-flex items-center gap-2">
        <Ship className={cn('text-gold-500', className ?? 'h-8 w-8')} />
        {showTextFallback && (
          <span className={cn('font-bold', onDark ? 'text-white' : 'text-navy-900')}>
            SeaBridge
          </span>
        )}
      </span>
    );
  }

  return (
    <img
      src={onDark ? '/logo.png' : '/logo-blue.png'}
      alt={alt}
      onError={() => setFailed(true)}
      className={cn('w-auto object-contain', className ?? 'h-8')}
    />
  );
}
