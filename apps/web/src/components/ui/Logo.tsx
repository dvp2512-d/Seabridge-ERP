import { useState } from 'react';
import { Ship } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Company logo.
 *
 * Served from /logo.png (apps/web/public/logo.png).
 *
 * The supplied artwork is WHITE on a transparent background, so it is only
 * legible on a dark surface. On the navy sidebar and the navy login panel it is
 * drawn directly; anywhere light, it sits on a navy plate so it stays readable
 * instead of disappearing into the page.
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

  const img = (
    <img
      src="/logo.png"
      alt={alt}
      onError={() => setFailed(true)}
      className={cn('w-auto object-contain', className ?? 'h-8')}
    />
  );

  // White artwork needs a dark plate to be visible on light backgrounds.
  if (onDark) return img;

  return (
    <span className="inline-flex items-center justify-center rounded-lg bg-navy-900 px-3 py-2">
      {img}
    </span>
  );
}
