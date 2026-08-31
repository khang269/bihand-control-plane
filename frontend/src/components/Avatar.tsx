import React from 'react';
import { Bot } from 'lucide-react';

interface AvatarProps {
  /** Used to derive initials. No name (or an unnamed agent) falls back to a bot icon. */
  name?: string | null;
  className?: string;
  fallbackSize?: number;
}

function initialsFor(name?: string | null): string | null {
  if (!name) return null;
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * A local, initials-based avatar placeholder. Replaces the old AvatarImage, which fetched
 * a generated 3D avatar sticker from an external service this open-source build doesn't
 * include.
 */
export const Avatar: React.FC<AvatarProps> = ({
  name,
  className = "w-12 h-12 rounded object-cover border border-border shrink-0",
  fallbackSize = 20,
}) => {
  const initials = initialsFor(name);

  return (
    <div className={`${className} bg-secondary text-muted-foreground flex items-center justify-center font-semibold`}>
      {initials || <Bot size={fallbackSize} />}
    </div>
  );
};

export default Avatar;
