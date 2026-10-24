import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ProfileAvatar } from './ProfileAvatar.js';

const fallback = <span>ИК</span>;

describe('ProfileAvatar', () => {
  it('shows the neutral fallback while the picture loads, then the picture', () => {
    const { container } = render(
      <ProfileAvatar src="/api/v1/me/avatars/vk?v=1" fallback={fallback} />,
    );
    const img = container.querySelector('img')!;
    expect(screen.getByText('ИК')).toBeInTheDocument();
    expect(img).toHaveStyle({ display: 'none' });
    fireEvent.load(img);
    expect(screen.queryByText('ИК')).not.toBeInTheDocument();
    expect(img).not.toHaveStyle({ display: 'none' });
  });

  it('keeps the fallback when the image fails', () => {
    const { container } = render(
      <ProfileAvatar src="https://t.me/i/userpic/1.jpg" fallback={fallback} />,
    );
    fireEvent.error(container.querySelector('img')!);
    expect(screen.getByText('ИК')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });

  it('no URL: only the fallback, nothing is requested', () => {
    const { container } = render(<ProfileAvatar src={null} fallback={fallback} />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('ИК')).toBeInTheDocument();
  });
});
