import React, { createContext, useContext, useState, useCallback } from 'react';
import { CheckCircle2, AlertTriangle, AlertCircle, Info, X } from 'lucide-react';

const ToastContext = createContext();

export const ToastProvider = ({ children }) => {
    const [toasts, setToasts] = useState([]);

    const removeToast = useCallback((id) => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
    }, []);

    const showToast = useCallback((message, type = 'info', duration = 3500) => {
        const id = Date.now() + Math.random().toString(36).substring(2, 7);
        setToasts((prev) => [...prev, { id, message, type }]);

        if (duration > 0) {
            setTimeout(() => {
                removeToast(id);
            }, duration);
        }
        return id;
    }, [removeToast]);

    const getIcon = (type) => {
        switch (type) {
            case 'success':
                return <CheckCircle2 size={18} color="var(--status-success)" />;
            case 'error':
                return <AlertCircle size={18} color="var(--status-error)" />;
            case 'warning':
                return <AlertTriangle size={18} color="var(--status-warning)" />;
            default:
                return <Info size={18} color="var(--accent-primary)" />;
        }
    };

    const getBorderColor = (type) => {
        switch (type) {
            case 'success':
                return 'rgba(74, 222, 128, 0.4)';
            case 'error':
                return 'rgba(248, 113, 113, 0.4)';
            case 'warning':
                return 'rgba(251, 191, 36, 0.4)';
            default:
                return 'rgba(56, 189, 248, 0.4)';
        }
    };

    return (
        <ToastContext.Provider value={{ showToast, removeToast }}>
            {children}
            {/* Toast Container */}
            <div
                style={{
                    position: 'fixed',
                    bottom: '80px', // Just above bottom nav (64px + margin)
                    right: '16px',
                    zIndex: 2000,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                    maxWidth: '380px',
                    width: 'calc(100vw - 32px)',
                    pointerEvents: 'none',
                }}
            >
                {toasts.map((toast) => (
                    <div
                        key={toast.id}
                        className="glass-panel"
                        style={{
                            pointerEvents: 'auto',
                            padding: '12px 14px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '10px',
                            borderColor: getBorderColor(toast.type),
                            background: 'rgba(15, 23, 42, 0.92)',
                            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)',
                            animation: 'fadeIn 0.2s ease-out',
                        }}
                    >
                        <div style={{ flexShrink: 0 }}>{getIcon(toast.type)}</div>
                        <div style={{ flex: 1, fontSize: '0.85rem', color: 'var(--text-primary)', wordBreak: 'break-word', lineHeight: 1.4 }}>
                            {toast.message}
                        </div>
                        <button
                            type="button"
                            onClick={() => removeToast(toast.id)}
                            style={{
                                background: 'none',
                                border: 'none',
                                padding: '2px',
                                cursor: 'pointer',
                                color: 'var(--text-secondary)',
                                display: 'flex',
                                alignItems: 'center',
                                flexShrink: 0,
                            }}
                        >
                            <X size={14} />
                        </button>
                    </div>
                ))}
            </div>
        </ToastContext.Provider>
    );
};

export const useToast = () => {
    const context = useContext(ToastContext);
    if (!context) {
        return {
            showToast: (msg) => console.log('[Toast fallback]', msg),
            removeToast: () => {},
        };
    }
    return context;
};
