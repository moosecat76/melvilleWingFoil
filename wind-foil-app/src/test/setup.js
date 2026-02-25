import '@testing-library/jest-dom';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Mock Firebase modules globally to prevent initialization in tests
vi.mock('firebase/app', () => ({
    initializeApp: vi.fn(() => ({})),
}));

vi.mock('firebase/auth', () => ({
    getAuth: vi.fn(() => ({})),
    GoogleAuthProvider: vi.fn(),
    signInWithPopup: vi.fn(),
    signOut: vi.fn(),
    onAuthStateChanged: vi.fn(() => vi.fn()), // returns unsubscribe
}));

vi.mock('firebase/firestore', () => ({
    getFirestore: vi.fn(() => ({})),
    collection: vi.fn(),
    doc: vi.fn(),
    getDocs: vi.fn().mockResolvedValue({ docs: [] }),
    getDoc: vi.fn().mockResolvedValue({ exists: () => false, data: () => null }),
    setDoc: vi.fn().mockResolvedValue(undefined),
    addDoc: vi.fn().mockResolvedValue({ id: 'test-id' }),
    updateDoc: vi.fn().mockResolvedValue(undefined),
    deleteDoc: vi.fn().mockResolvedValue(undefined),
    query: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    serverTimestamp: vi.fn(() => new Date()),
}));

// Cleanup after each test case (e.g. clearing jsdom)
afterEach(() => {
    cleanup();
});

// Mock ResizeObserver for Recharts
class ResizeObserver {
    observe() { }
    unobserve() { }
    disconnect() { }
}

window.ResizeObserver = ResizeObserver;

// Mock window.matchMedia if needed (often needed for charts/responsive designs)
Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(query => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(), // deprecated
        removeListener: vi.fn(), // deprecated
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
    })),
});
