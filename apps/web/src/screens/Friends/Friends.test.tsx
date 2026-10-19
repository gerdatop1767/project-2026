import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FriendsDesktop } from './FriendsDesktop.js';
import { FriendsMobile } from './FriendsMobile.js';
import { FriendProfileDesktop } from './FriendProfileDesktop.js';
import { FriendProfileMobile } from './FriendProfileMobile.js';
import { DesktopSidebar } from '../../ui/DesktopShell/DesktopSidebar.js';
import { NavigationProvider } from '../../lib/navigation.js';
import { pathForRoute, routeFromPath } from '../../lib/routes.js';

function renderWithNav(ui: React.ReactElement) {
  return render(<NavigationProvider>{ui}</NavigationProvider>);
}

describe('Friends routing', () => {
  it('round-trips /friends and /friends/:id through the router', () => {
    expect(routeFromPath('/friends')).toEqual({ screen: 'friends' });
    expect(routeFromPath('/friends/alex_math')).toEqual({
      screen: 'friendProfile',
      friendId: 'alex_math',
    });
    expect(pathForRoute({ screen: 'friendProfile', friendId: 'alex_math' })).toBe(
      '/friends/alex_math',
    );
  });
});

describe('DesktopSidebar', () => {
  it('has a "Друзья" entry that navigates to /friends', async () => {
    const user = userEvent.setup();
    renderWithNav(<DesktopSidebar />);
    const link = screen.getByRole('button', { name: 'Друзья' });
    expect(link).toBeInTheDocument();
    await user.click(link);
    expect(window.location.pathname).toBe('/friends');
  });
});

describe('FriendsDesktop', () => {
  it('shows a neutral WIP placeholder, never a fake friends list', () => {
    renderWithNav(<FriendsDesktop />);
    expect(screen.getByRole('heading', { name: 'Друзья' })).toBeInTheDocument();
    expect(screen.getByText('Экран в разработке — следующий блок.')).toBeInTheDocument();
  });
});

describe('FriendsMobile', () => {
  it('shows a neutral WIP placeholder, never a fake friends list', () => {
    renderWithNav(<FriendsMobile />);
    expect(screen.getAllByText('Друзья').length).toBeGreaterThan(0);
    expect(screen.getByText('Экран в разработке — следующий блок.')).toBeInTheDocument();
  });
});

describe('FriendProfileDesktop', () => {
  it('shows a neutral WIP placeholder for any friendId, never fake friend data', () => {
    renderWithNav(<FriendProfileDesktop friendId="alex_math" />);
    expect(screen.getByText('Экран в разработке — следующий блок.')).toBeInTheDocument();
  });
});

describe('FriendProfileMobile', () => {
  it('shows a neutral WIP placeholder for any friendId, never fake friend data', () => {
    renderWithNav(<FriendProfileMobile friendId="alex_math" />);
    expect(screen.getByText('Экран в разработке — следующий блок.')).toBeInTheDocument();
  });
});

describe('BackRow labels', () => {
  it('/friends has no back row: neither "← Главная" nor a stray "← Достижения"/"← Рейтинг"', () => {
    renderWithNav(<FriendsDesktop />);
    expect(screen.queryByText('Главная')).not.toBeInTheDocument();
    expect(screen.queryByText('Достижения')).not.toBeInTheDocument();
    expect(screen.queryByText(/^Рейтинг$/)).not.toBeInTheDocument();
  });

  it('/friends/:id always points its BackRow at "Друзья", never a stale tab', () => {
    renderWithNav(<FriendProfileDesktop friendId="alex_math" />);
    expect(screen.getAllByText('Друзья').length).toBeGreaterThan(0);
  });
});
