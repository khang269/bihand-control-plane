import React from 'react';
import { useAvatar } from '../lib/avatarCache';
import { Bot, Loader2 } from 'lucide-react';

interface AvatarImageProps {
  hash: string | null | undefined;
  className?: string;
  alt?: string;
  fallbackSize?: number;
}

export const AvatarImage: React.FC<AvatarImageProps> = ({
  hash,
  className = "w-12 h-12 rounded object-cover border border-border shrink-0",
  alt = "Avatar",
  fallbackSize = 20
}) => {
  const { thumbnailSrc } = useAvatar(hash);

  if (hash) {
    if (thumbnailSrc) {
      return <img src={thumbnailSrc} alt={alt} className={className} />;
    }

    // Display a loader or spinner when actively loading/downloading the thumbnail
    return (
      <div className={`${className} bg-secondary flex items-center justify-center border border-border`}>
        <Loader2 className="animate-spin text-foreground shrink-0" size={fallbackSize} />
      </div>
    );
  }

  return (
    <div className={`${className} bg-secondary text-muted-foreground flex items-center justify-center`}>
      <Bot size={fallbackSize} />
    </div>
  );
};
