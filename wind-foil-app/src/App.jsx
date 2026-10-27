import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { LocationProvider } from './context/LocationContext';
import { AuthProvider } from './context/AuthContext';
import { PreferencesProvider } from './context/PreferencesContext';
import { ToastProvider } from './context/ToastContext';
import ForecastPage from './pages/ForecastPage';
import SessionsPage from './pages/SessionsPage';
import SessionDetailPage from './pages/SessionDetailPage';
import StatsPage from './pages/StatsPage';
import BottomNav from './components/BottomNav';
import DebugOverlay from './components/DebugOverlay';

function App() {
  return (
    <AuthProvider>
      <LocationProvider>
        <PreferencesProvider>
          <ToastProvider>
            <BrowserRouter>
              <Routes>
                <Route path="/" element={<ForecastPage />} />
                <Route path="/sessions" element={<SessionsPage />} />
                <Route path="/session/:id" element={<SessionDetailPage />} />
                <Route path="/stats" element={<StatsPage />} />
              </Routes>
              <BottomNav />
              <DebugOverlay />
            </BrowserRouter>
          </ToastProvider>
        </PreferencesProvider>
      </LocationProvider>
    </AuthProvider>
  );
}

export default App;
