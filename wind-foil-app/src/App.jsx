import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { LocationProvider } from './context/LocationContext';
import { AuthProvider } from './context/AuthContext';
import ForecastPage from './pages/ForecastPage';
import SessionsPage from './pages/SessionsPage';
import SessionDetailPage from './pages/SessionDetailPage';
import BottomNav from './components/BottomNav';

function App() {
  return (
    <AuthProvider>
      <LocationProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<ForecastPage />} />
            <Route path="/sessions" element={<SessionsPage />} />
            <Route path="/session/:id" element={<SessionDetailPage />} />
          </Routes>
          <BottomNav />
        </BrowserRouter>
      </LocationProvider>
    </AuthProvider>
  );
}

export default App;
