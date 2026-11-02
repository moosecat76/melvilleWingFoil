import React, { useState, useMemo } from 'react';
import { Layers, ArrowRight, CheckCircle2, AlertCircle, X, Sparkles, Loader2, ShieldCheck } from 'lucide-react';
import { analyzeQuiverRationalisation } from '../services/quiverService';
import { batchUpdateJournalGear, saveUserGear } from '../services/dbService';
import { useToast } from '../context/ToastContext';

const QuiverRationaliserModal = ({
    isOpen,
    onClose,
    sessions = [],
    userGear = [],
    uid,
    onSuccess,
}) => {
    const { showToast } = useToast();
    const [isApplying, setIsApplying] = useState(false);

    const analysis = useMemo(() => {
        return analyzeQuiverRationalisation(sessions, userGear);
    }, [sessions, userGear]);

    if (!isOpen) return null;

    const {
        hasChanges,
        sessionUpdates,
        replacementList,
        totalAffectedSessions,
        cleanedUserGear,
    } = analysis;

    const handleApply = async () => {
        setIsApplying(true);
        try {
            if (uid) {
                if (sessionUpdates.length > 0) {
                    await batchUpdateJournalGear(uid, sessionUpdates);
                }
                await saveUserGear(uid, cleanedUserGear);
            }

            showToast(
                `Rationalised ${totalAffectedSessions} session${totalAffectedSessions === 1 ? '' : 's'} and cleaned quiver!`,
                'success'
            );

            if (typeof onSuccess === 'function') {
                onSuccess({ cleanedUserGear, sessionUpdates });
            }

            onClose();
        } catch (err) {
            console.error('[QuiverRationaliser] Failed to apply rationalisation:', err);
            showToast('Failed to apply rationalisation. Please try again.', 'error');
        } finally {
            setIsApplying(false);
        }
    };

    return (
        <div style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(4px)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1rem',
        }}>
            <div
                className="glass-panel"
                style={{
                    maxWidth: '620px',
                    width: '100%',
                    maxHeight: '90vh',
                    overflowY: 'auto',
                    padding: '1.75rem',
                    position: 'relative',
                    border: '1px solid var(--accent-primary)',
                    boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
                }}
            >
                {/* Close Button */}
                <button
                    onClick={onClose}
                    disabled={isApplying}
                    style={{
                        position: 'absolute',
                        top: '14px',
                        right: '14px',
                        background: 'none',
                        border: 'none',
                        color: 'var(--text-secondary)',
                        cursor: 'pointer',
                    }}
                >
                    <X size={20} />
                </button>

                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '1.25rem' }}>
                    <div style={{
                        background: 'rgba(167, 139, 250, 0.2)',
                        padding: '8px',
                        borderRadius: '8px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}>
                        <Layers size={22} color="var(--accent-primary)" />
                    </div>
                    <div>
                        <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700 }}>
                            Rationalise Quiver & Sessions
                        </h3>
                        <p style={{ margin: '2px 0 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                            Merge duplicates, fix spelling typos, and unify gear performance metrics.
                        </p>
                    </div>
                </div>

                {!hasChanges ? (
                    <div style={{
                        textAlign: 'center',
                        padding: '2.5rem 1rem',
                        background: 'rgba(74, 222, 128, 0.08)',
                        borderRadius: '8px',
                        border: '1px solid rgba(74, 222, 128, 0.25)',
                    }}>
                        <CheckCircle2 size={40} color="#4ade80" style={{ margin: '0 auto 12px' }} />
                        <h4 style={{ margin: '0 0 6px 0', color: '#4ade80', fontSize: '1.05rem' }}>
                            Quiver & Sessions are 100% Rationalised
                        </h4>
                        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                            No duplicates, formatting mismatches, or typos were detected in your sessions.
                        </p>
                    </div>
                ) : (
                    <>
                        {/* Assurance Banner */}
                        <div style={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: '10px',
                            padding: '12px 14px',
                            background: 'rgba(56, 189, 248, 0.1)',
                            border: '1px solid rgba(56, 189, 248, 0.3)',
                            borderRadius: '8px',
                            marginBottom: '1.25rem',
                            fontSize: '0.82rem',
                            color: '#e0f2fe',
                        }}>
                            <ShieldCheck size={18} color="#38bdf8" style={{ flexShrink: 0, marginTop: '2px' }} />
                            <div>
                                <span style={{ fontWeight: 600 }}>Zero Data Loss Guarantee:</span> All GPS tracks, foil time, distances, max speeds, wind telemetry, and ratings will remain completely untouched. Only the gear tagging string is canonicalised.
                            </div>
                        </div>

                        {/* Merge List */}
                        <div style={{ marginBottom: '1.25rem' }}>
                            <div style={{
                                fontSize: '0.85rem',
                                fontWeight: 600,
                                color: 'var(--text-secondary)',
                                textTransform: 'uppercase',
                                letterSpacing: '0.05em',
                                marginBottom: '8px',
                            }}>
                                Detected Merge Mappings ({replacementList.length})
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '220px', overflowY: 'auto' }}>
                                {replacementList.map((rep) => (
                                    <div
                                        key={rep.original}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            padding: '8px 12px',
                                            background: 'var(--bg-secondary)',
                                            borderRadius: '6px',
                                            border: '1px solid var(--border-color)',
                                            fontSize: '0.85rem',
                                        }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: 0 }}>
                                            <span style={{
                                                color: '#f87171',
                                                textDecoration: 'line-through',
                                                fontFamily: 'monospace',
                                                fontSize: '0.82rem',
                                            }}>
                                                {rep.original}
                                            </span>
                                            <ArrowRight size={14} color="var(--text-secondary)" style={{ flexShrink: 0 }} />
                                            <span style={{
                                                color: '#4ade80',
                                                fontWeight: 600,
                                            }}>
                                                {rep.canonical}
                                            </span>
                                        </div>
                                        <span style={{
                                            fontSize: '0.75rem',
                                            padding: '2px 8px',
                                            background: 'rgba(255,255,255,0.06)',
                                            borderRadius: '10px',
                                            color: 'var(--text-secondary)',
                                            whiteSpace: 'nowrap',
                                            marginLeft: '8px',
                                        }}>
                                            {rep.count} session{rep.count === 1 ? '' : 's'}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Cleaned Quiver Items */}
                        <div style={{ marginBottom: '1.5rem' }}>
                            <div style={{
                                fontSize: '0.85rem',
                                fontWeight: 600,
                                color: 'var(--text-secondary)',
                                textTransform: 'uppercase',
                                letterSpacing: '0.05em',
                                marginBottom: '8px',
                            }}>
                                Resulting Canonical Quiver ({cleanedUserGear.length} items)
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                {cleanedUserGear.map((item, idx) => {
                                    const unit = item.type === 'board' ? 'L' : item.type === 'foil' ? 'cm²' : 'm';
                                    return (
                                        <span
                                            key={item.id || idx}
                                            style={{
                                                fontSize: '0.78rem',
                                                padding: '4px 8px',
                                                background: 'rgba(255, 255, 255, 0.05)',
                                                border: '1px solid var(--border-color)',
                                                borderRadius: '4px',
                                                color: 'var(--text-primary)',
                                            }}
                                        >
                                            <span style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>
                                                {item.size}{unit}
                                            </span>{' '}
                                            {item.model}
                                        </span>
                                    );
                                })}
                            </div>
                        </div>
                    </>
                )}

                {/* Footer Buttons */}
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                    gap: '10px',
                    borderTop: '1px solid var(--border-color)',
                    paddingTop: '1.25rem',
                    marginTop: '1.25rem',
                }}>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={isApplying}
                        className="btn-secondary"
                        style={{ padding: '0.5rem 1rem', fontSize: '0.85rem', cursor: 'pointer' }}
                    >
                        {hasChanges ? 'Cancel' : 'Close'}
                    </button>

                    {hasChanges && (
                        <button
                            type="button"
                            onClick={handleApply}
                            disabled={isApplying}
                            style={{
                                background: 'var(--accent-primary)',
                                color: '#000',
                                border: 'none',
                                padding: '0.5rem 1.25rem',
                                borderRadius: '4px',
                                fontWeight: 700,
                                fontSize: '0.85rem',
                                cursor: isApplying ? 'not-allowed' : 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                            }}
                        >
                            {isApplying ? (
                                <>
                                    <Loader2 size={16} className="animate-spin" />
                                    Applying Changes...
                                </>
                            ) : (
                                <>
                                    <Sparkles size={16} />
                                    Apply Rationalisation ({totalAffectedSessions} session{totalAffectedSessions === 1 ? '' : 's'})
                                </>
                            )}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default QuiverRationaliserModal;
