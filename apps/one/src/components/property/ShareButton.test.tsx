// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import ShareButton from './ShareButton';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ShareButton', () => {
  it('calls navigator.share with title, text, and url', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { share });

    render(<ShareButton title="Deal Title" url="https://example.com/deal/123" />);

    fireEvent.click(screen.getByRole('button', { name: /share/i }));

    expect(share).toHaveBeenCalledWith({
      title: 'Deal Title',
      text: 'Deal Title',
      url: 'https://example.com/deal/123',
    });
  });

  it('falls back to clipboard and shows Copied when navigator.share is undefined', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { share: undefined, clipboard: { writeText } });

    render(<ShareButton title="Deal Title" url="https://example.com/deal/123" />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /share/i }));
    });

    expect(writeText).toHaveBeenCalledWith('https://example.com/deal/123');
    expect(screen.getByText('Copied')).toBeTruthy();
  });

  it('does not show Copied when navigator.share rejects (user cancels)', async () => {
    const share = vi.fn().mockRejectedValue(new Error('AbortError'));
    const writeText = vi.fn();
    vi.stubGlobal('navigator', { share, clipboard: { writeText } });

    render(<ShareButton title="Deal Title" url="https://example.com/deal/123" />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /share/i }));
    });

    expect(share).toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
    expect(screen.queryByText('Copied')).toBeNull();
  });
});
