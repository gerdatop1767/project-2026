import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { NavigationProvider } from './lib/navigation.js';
import { LearningSessionProvider } from './lib/learningSessionContext.js';
import { StreakProvider } from './lib/streakContext.js';
import { AuthProvider } from './lib/authContext.js';
import { ToastProvider } from './ui/Toast/ToastProvider.js';
import 'katex/dist/katex.min.css';
import './index.css';

const root = document.getElementById('root');
if (!root) {
  throw new Error('Root element #root not found');
}

// The design-exploration gallery (S1 Block 5) is a self-contained,
// visual-only route reached at #/design-exploration — never linked
// from the production app shell, and switched here rather than in
// App/navigation so the production screen tree stays untouched.
const isDesignExploration = window.location.hash === '#/design-exploration';
// Its own chunk: ten concept screens no visitor of the real app needs to
// download or parse.
const DesignExploration = lazy(() =>
  import('./design-exploration/DesignExploration.js').then((m) => ({
    default: m.DesignExploration,
  })),
);

createRoot(root).render(
  <StrictMode>
    {isDesignExploration ? (
      <Suspense fallback={null}>
        <DesignExploration />
      </Suspense>
    ) : (
      <NavigationProvider>
        <AuthProvider>
          <LearningSessionProvider>
            <StreakProvider>
              <ToastProvider>
                <App />
              </ToastProvider>
            </StreakProvider>
          </LearningSessionProvider>
        </AuthProvider>
      </NavigationProvider>
    )}
  </StrictMode>,
);
