import React from 'react';
import { LocationProvider } from './context/LocationContext';
import { AuthProvider } from './context/AuthContext';
import Dashboard from './components/Dashboard';

function App() {
  return (
    <AuthProvider>
      <LocationProvider>
        <Dashboard />
      </LocationProvider>
    </AuthProvider>
  );
}

export default App;
