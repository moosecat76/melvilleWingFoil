import React, { createContext, useState, useContext } from 'react';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
    // Placeholder user object. In future, this will be populated by Google Sign-In.
    // Structure: { uid: string, displayName: string, email: string, photoURL: string }
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(false);

    const login = async () => {
        setLoading(true);
        // Future: specific Google Sign-In logic here
        // For now, we simulate a login
        setTimeout(() => {
            setUser({
                uid: '12345',
                displayName: 'Guest User',
                email: 'guest@example.com',
                photoURL: 'https://via.placeholder.com/150'
            });
            setLoading(false);
        }, 500);
    };

    const logout = () => {
        setUser(null);
    };

    return (
        <AuthContext.Provider value={{ user, loading, login, logout }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => useContext(AuthContext);
