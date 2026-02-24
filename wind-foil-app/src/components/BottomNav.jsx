import React from 'react';
import { NavLink } from 'react-router-dom';
import { Wind, Book } from 'lucide-react';

const BottomNav = () => {
    return (
        <nav className="bottom-nav">
            <NavLink
                to="/"
                end
                className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}
            >
                <Wind size={22} />
                <span>Forecast</span>
            </NavLink>
            <NavLink
                to="/sessions"
                className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}
            >
                <Book size={22} />
                <span>Sessions</span>
            </NavLink>
        </nav>
    );
};

export default BottomNav;
