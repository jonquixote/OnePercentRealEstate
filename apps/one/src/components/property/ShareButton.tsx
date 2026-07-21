'use client';

import { useState } from 'react';
import { Share2 } from 'lucide-react';

interface Props {
  title: string;
  url: string;
}

export default function ShareButton({ title, url }: Props) {
  const [copied, setCopied] = useState(false);

  const handleClick = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title, text: title, url });
      } catch {
        // User cancelled — do nothing
      }
    } else {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <button
      onClick={handleClick}
      title="Share"
      aria-label="Share"
      className="flex items-center justify-center rounded-full border border-line w-9 h-9 text-haze hover:text-foreground hover:border-foreground transition-colors"
    >
      {copied ? (
        <span className="text-xs font-medium">Copied</span>
      ) : (
        <Share2 className="h-4 w-4" />
      )}
    </button>
  );
}
