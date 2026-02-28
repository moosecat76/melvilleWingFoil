import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { db } from '../services/firebaseSetup';
import { doc, getDoc } from 'firebase/firestore';

const DebugOverlay = () => {
    const { user } = useAuth();
    const [dbStatus, setDbStatus] = useState('Checking...');
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        // Show debug info only on localhost or if 'debug=true' in URL
        const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        const hasDebugFlag = window.location.search.includes('debug=true');
        if (isLocal || hasDebugFlag) {
            setIsVisible(true);
        }
    }, []);

    useEffect(() => {
        const checkConnection = async () => {
            if (!db) {
                setDbStatus('Firebase Not Initialized');
                return;
            }
            if (user?.uid) {
                try {
                    // Try to read a document to test permissions and connectivity
                    setDbStatus('Testing read...');
                    const testDoc = doc(db, 'users', user.uid, 'settings', 'gear');
                    await getDoc(testDoc);
                    setDbStatus('Connected (OK)');
                } catch (e) {
                    console.error("Firebase read test failed:", e);
                    setDbStatus(`Error: ${e.message.substring(0, 30)}`);
                }
            } else {
                setDbStatus('Ready (Waiting for Auth)');
            }
        };

        checkConnection();
    }, [user?.uid]);

    if (!isVisible) return null;

    return (
        <div style={{
            position: 'fixed',
            bottom: '70px', // above bottom nav
            left: '10px',
            background: 'rgba(0,0,0,0.85)',
            border: '1px solid #0f0',
            color: '#0f0',
            padding: '8px',
            borderRadius: '4px',
            fontSize: '11px',
            zIndex: 9999,
            pointerEvents: 'none',
            fontFamily: 'monospace',
            maxWidth: '300px',
            wordWrap: 'break-word'
        }}>
            <div><strong style={{ color: '#fff' }}>Debug Info</strong></div>
            <div>App Build: 1.0.1 (Firestore Sync)</div>
            <div>Env Mode: {import.meta.env.MODE}</div>
            <div>Auth: {user ? `Logged In (${user.uid.substring(0, 5)}...)` : 'Logged Out (Local DB)'}</div>
            <div>Store: {dbStatus}</div>
        </div>
    );
};

export default DebugOverlay;
